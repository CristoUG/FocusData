"""
Tests de la API de FocusData.

Cubren los caminos críticos identificados en la auditoría (PLAN_CORRECCIONES.md,
Fase 7.4): registro, login, aislamiento de datos entre usuarios y las
validaciones de entrada de la Fase 1.

Cada test usa una base de datos SQLite temporal propia (fixture `client`), así
que nunca tocan study.db. Ejecutar con:

    pip install -r requirements-dev.txt
    pytest
"""
import importlib
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app as app_module


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Cliente de pruebas de Flask con una DB SQLite aislada por test."""
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(app_module, "DB", str(db_path))
    app_module.init_db()
    app_module.app.config.update(TESTING=True)
    # El freno de fuerza bruta vive en un dict de módulo, keyed por IP: se
    # reinicia para que un test no herede los fallos de otro (el test client
    # siempre reporta la misma IP).
    app_module._login_fails.clear()
    with app_module.app.test_client() as c:
        yield c


def register(client, username="user1", password="12345678"):
    return client.post("/api/register", json={"username": username, "password": password})


def login(client, username="user1", password="12345678"):
    return client.post("/api/login", json={"username": username, "password": password})


# ── Registro y login ────────────────────────────────────

def test_register_login_logout_flow(client):
    r = register(client)
    assert r.status_code == 200
    assert r.get_json()["username"] == "user1"

    r = client.get("/api/me")
    assert r.status_code == 200
    data = r.get_json()
    assert data["username"] == "user1"
    assert isinstance(data["id"], int)          # necesario para aislar localStorage (Fase 3)

    client.get("/logout")
    r = client.get("/api/me")
    assert r.status_code == 401

    r = login(client)
    assert r.status_code == 200


def test_register_duplicate_username_rejected(client):
    register(client, "dup")
    client.get("/logout")
    r = register(client, "dup")
    assert r.status_code == 409


def test_register_password_too_short_rejected(client):
    r = register(client, "shortpass", password="1234")
    assert r.status_code == 400
    assert "8 caracteres" in r.get_json()["error"]


def test_register_username_too_short_rejected(client):
    r = register(client, "ab")
    assert r.status_code == 400


def test_login_wrong_password_rejected(client):
    register(client, "wrongpass")
    client.get("/logout")
    r = login(client, "wrongpass", "otra-clave")
    assert r.status_code == 401


def test_login_short_password_still_allowed(client):
    """Login no exige PASSWORD_MIN: cuentas antiguas con contraseñas cortas
    (creadas antes de endurecer el registro) deben poder seguir entrando."""
    r = client.post("/api/register", json={"username": "legacyuser", "password": "12345678"})
    assert r.status_code == 200
    # Simula una cuenta preexistente con una contraseña de 4 caracteres,
    # insertada directamente (sin pasar por la validación de /api/register).
    from werkzeug.security import generate_password_hash
    with app_module.closing(app_module.get_db()) as conn, conn:
        conn.execute("UPDATE users SET password = ? WHERE username = ?",
                     (generate_password_hash("abcd"), "legacyuser"))
        conn.commit()
    client.get("/logout")
    r = login(client, "legacyuser", "abcd")
    assert r.status_code == 200


# ── Malformed / missing bodies: nunca deben producir 500 ────────────────

@pytest.mark.parametrize("path,method", [
    ("/api/register", "post"),
    ("/api/login", "post"),
    ("/api/sessions", "post"),
])
def test_non_json_body_never_500s(client, path, method):
    r = getattr(client, method)(path, data="esto no es json")
    assert r.status_code < 500
    assert r.is_json


def test_update_session_non_json_body_returns_json_error(client):
    register(client)
    r = client.patch("/api/sessions/1", data="esto no es json")
    assert r.status_code == 400
    assert r.is_json
    assert r.get_json()["error"]


# ── Freno de fuerza bruta ────────────────────────────────

def test_login_rate_limit_blocks_after_max_fails_and_resets_on_success(client):
    register(client, "bruteforce")
    client.get("/logout")

    for _ in range(app_module.LOGIN_MAX_FAILS):
        r = login(client, "bruteforce", "clave-incorrecta")
        assert r.status_code == 401

    r = login(client, "bruteforce", "clave-incorrecta")
    assert r.status_code == 429
    assert "Reintenta" in r.get_json()["error"]

    # Incluso con la contraseña correcta, sigue bloqueado dentro de la ventana.
    r = login(client, "bruteforce", "12345678")
    assert r.status_code == 429

    # Tras limpiar el contador (equivalente a que expire la ventana), entra normal.
    app_module._login_fails.clear()
    r = login(client, "bruteforce", "12345678")
    assert r.status_code == 200


# ── Validación de /api/sessions (Fase 1) ────────────────

def test_add_session_missing_fields_rejected(client):
    register(client)
    r = client.post("/api/sessions", json={})
    assert r.status_code == 400


@pytest.mark.parametrize("payload,expected_fragment", [
    ({"minutes": 0, "type": "Estudio", "mode": "pomodoro"}, "minutes"),
    ({"minutes": 601, "type": "Estudio", "mode": "pomodoro"}, "minutes"),
    ({"minutes": "no-numero", "type": "Estudio", "mode": "pomodoro"}, "minutes"),
    ({"minutes": 25, "type": "", "mode": "pomodoro"}, "type"),
    ({"minutes": 25, "type": "Estudio", "mode": "no-valido"}, "mode"),
    ({"minutes": 25, "type": "Estudio", "mode": "pomodoro", "date": "26-08-2026"}, "date"),
    ({"minutes": 25, "type": "Estudio", "mode": "pomodoro", "time": "no-es-hora"}, "time"),
])
def test_add_session_invalid_input_rejected(client, payload, expected_fragment):
    register(client)
    r = client.post("/api/sessions", json=payload)
    assert r.status_code == 400
    assert expected_fragment in r.get_json()["error"]


def test_add_session_valid_input_persists_and_keeps_ts_intact(client):
    register(client)
    ts = "2026-08-26T10:00:00"
    r = client.post("/api/sessions", json={
        "minutes": 25, "type": "Cálculo", "mode": "pomodoro", "ts": ts,
    })
    assert r.status_code == 200

    rows = client.get("/api/sessions?include_breaks=1").get_json()
    assert len(rows) == 1
    # `ts` es la clave de deduplicación de syncSessions(): debe guardarse
    # exactamente como llegó, sin normalizar.
    assert rows[0]["ts"] == ts
    assert rows[0]["type"] == "Cálculo"


def test_break_sessions_excluded_from_stats_by_default(client):
    register(client)
    client.post("/api/sessions", json={"minutes": 25, "type": "Estudio", "mode": "pomodoro"})
    client.post("/api/sessions", json={"minutes": 5, "type": "Descanso", "mode": "break"})

    stats = client.get("/api/stats").get_json()
    assert stats["total"] == 25

    only_study = client.get("/api/sessions").get_json()
    assert len(only_study) == 1
    with_breaks = client.get("/api/sessions?include_breaks=1").get_json()
    assert len(with_breaks) == 2


# ── Aislamiento de datos entre usuarios ─────────────────

def test_sessions_isolated_between_users(client):
    register(client, "alice")
    client.post("/api/sessions", json={"minutes": 25, "type": "Alice-only", "mode": "pomodoro"})
    client.get("/logout")

    register(client, "bob")
    r = client.get("/api/sessions?include_breaks=1")
    assert r.get_json() == []          # Bob no debe ver nada de Alice

    client.post("/api/sessions", json={"minutes": 10, "type": "Bob-only", "mode": "pomodoro"})
    bob_sessions = client.get("/api/sessions?include_breaks=1").get_json()
    assert len(bob_sessions) == 1
    assert bob_sessions[0]["type"] == "Bob-only"

    client.get("/logout")
    login(client, "alice")
    alice_sessions = client.get("/api/sessions?include_breaks=1").get_json()
    assert len(alice_sessions) == 1
    assert alice_sessions[0]["type"] == "Alice-only"


def test_cannot_reassign_session_to_another_users_category(client):
    register(client, "alice2")
    r = client.post("/api/sessions", json={"minutes": 25, "type": "Estudio", "mode": "pomodoro"})
    sid = client.get("/api/sessions?include_breaks=1").get_json()[0]["id"]
    client.get("/logout")

    register(client, "bob2")
    bob_cat = client.get("/api/categories").get_json()[0]["id"]
    client.get("/logout")

    login(client, "alice2")
    r = client.patch(f"/api/sessions/{sid}", json={"category_id": bob_cat})
    assert r.status_code == 400
    assert r.get_json()["error"] == "Carpeta no válida"


# ── Categorías ───────────────────────────────────────────

def test_category_crud_and_cannot_archive_last_active(client):
    register(client)
    r = client.post("/api/categories", json={"name": "Trabajo", "color": "#ff0000"})
    assert r.status_code == 200
    cid = r.get_json()["id"]

    r = client.patch(f"/api/categories/{cid}", json={"name": "Trabajo renombrado"})
    assert r.status_code == 200
    assert r.get_json()["name"] == "Trabajo renombrado"

    # La carpeta por defecto ("General") sigue activa; archivar la nueva es OK.
    r = client.patch(f"/api/categories/{cid}", json={"archived": True})
    assert r.status_code == 200

    # Pero no se puede archivar la única carpeta activa restante.
    default_cat = next(c for c in client.get("/api/categories").get_json() if not c["archived"])
    r = client.patch(f"/api/categories/{default_cat['id']}", json={"archived": True})
    assert r.status_code == 400


def test_category_duplicate_name_rejected(client):
    register(client)
    client.post("/api/categories", json={"name": "Repetida"})
    r = client.post("/api/categories", json={"name": "Repetida"})
    assert r.status_code == 409


# ── Borrado y exportación (Fase 6) ──────────────────────

def test_delete_all_actually_deletes_serverside(client):
    register(client)
    client.post("/api/sessions", json={"minutes": 25, "type": "Estudio", "mode": "pomodoro"})
    assert len(client.get("/api/sessions").get_json()) == 1

    r = client.delete("/api/sessions/all")
    assert r.status_code == 200
    assert r.get_json()["ok"] is True
    assert client.get("/api/sessions").get_json() == []


def test_export_csv_has_bom_and_escapes_formula_injection(client):
    register(client)
    # Un tipo que empieza por '=' sería interpretado como fórmula en Excel.
    client.post("/api/sessions", json={"minutes": 25, "type": "=cmd|'/c calc'", "mode": "pomodoro"})

    r = client.get("/api/export/csv")
    assert r.status_code == 200
    body = r.get_data()
    assert body.startswith(b"\xef\xbb\xbf")             # BOM UTF-8 para Excel
    text = body.decode("utf-8-sig")
    assert "'=cmd" in text                              # neutralizado con comilla inicial
    assert "\n=cmd" not in text and not text.split("\n")[1].startswith("=cmd")


# ── Cookie de sesión (Fase 2) ────────────────────────────

def test_session_cookie_has_httponly_and_samesite(client):
    r = register(client, "cookieuser")
    set_cookie = r.headers.get("Set-Cookie", "")
    assert "HttpOnly" in set_cookie
    assert "SameSite=Lax" in set_cookie


# ── Jerarquía de carpetas ────────────────────────────────

def _cat_id(client, name):
    return next(c["id"] for c in client.get("/api/categories").get_json() if c["name"] == name)


def test_create_subcategory(client):
    register(client)
    padre = client.get("/api/categories").get_json()[0]["id"]
    r = client.post("/api/categories", json={"name": "Cálculo", "parent_id": padre})
    assert r.status_code == 200
    assert r.get_json()["parent_id"] == padre


def test_same_name_allowed_under_different_parents(client):
    """El objetivo de la jerarquía: 'Álgebra' puede existir en dos ramas."""
    register(client)
    a = client.post("/api/categories", json={"name": "Semestre 1"}).get_json()["id"]
    b = client.post("/api/categories", json={"name": "Semestre 2"}).get_json()["id"]
    assert client.post("/api/categories", json={"name": "Álgebra", "parent_id": a}).status_code == 200
    assert client.post("/api/categories", json={"name": "Álgebra", "parent_id": b}).status_code == 200


def test_same_name_rejected_under_same_parent(client):
    register(client)
    a = client.post("/api/categories", json={"name": "Semestre 1"}).get_json()["id"]
    client.post("/api/categories", json={"name": "Álgebra", "parent_id": a})
    r = client.post("/api/categories", json={"name": "Álgebra", "parent_id": a})
    assert r.status_code == 409


def test_categories_return_depth_and_path(client):
    register(client)
    a = client.post("/api/categories", json={"name": "Uni"}).get_json()["id"]
    b = client.post("/api/categories", json={"name": "Sem1", "parent_id": a}).get_json()["id"]
    client.post("/api/categories", json={"name": "Cálculo", "parent_id": b})
    cats = {c["name"]: c for c in client.get("/api/categories").get_json()}
    assert cats["Uni"]["depth"] == 0
    assert cats["Cálculo"]["depth"] == 2
    assert cats["Cálculo"]["path"] == "Uni › Sem1 › Cálculo"


def test_cannot_move_category_into_its_own_descendant(client):
    register(client)
    a = client.post("/api/categories", json={"name": "A"}).get_json()["id"]
    b = client.post("/api/categories", json={"name": "B", "parent_id": a}).get_json()["id"]
    r = client.patch(f"/api/categories/{a}", json={"parent_id": b})
    assert r.status_code == 400


def test_cannot_be_its_own_parent(client):
    register(client)
    a = client.post("/api/categories", json={"name": "A"}).get_json()["id"]
    assert client.patch(f"/api/categories/{a}", json={"parent_id": a}).status_code == 400


def test_move_category_to_another_branch(client):
    register(client)
    a = client.post("/api/categories", json={"name": "A"}).get_json()["id"]
    b = client.post("/api/categories", json={"name": "B"}).get_json()["id"]
    hija = client.post("/api/categories", json={"name": "Hija", "parent_id": a}).get_json()["id"]
    assert client.patch(f"/api/categories/{hija}", json={"parent_id": b}).status_code == 200
    cats = {c["name"]: c for c in client.get("/api/categories").get_json()}
    assert cats["Hija"]["parent_id"] == b


def test_archiving_parent_cascades_to_descendants(client):
    register(client)
    a = client.post("/api/categories", json={"name": "A"}).get_json()["id"]
    b = client.post("/api/categories", json={"name": "B", "parent_id": a}).get_json()["id"]
    client.post("/api/categories", json={"name": "C", "parent_id": b})
    assert client.patch(f"/api/categories/{a}", json={"archived": True}).status_code == 200
    cats = {c["name"]: c for c in client.get("/api/categories").get_json()}
    assert cats["A"]["archived"] and cats["B"]["archived"] and cats["C"]["archived"]


def test_unarchiving_child_restores_ancestors(client):
    """Invariante: una carpeta activa siempre tiene ancestros activos."""
    register(client)
    a = client.post("/api/categories", json={"name": "A"}).get_json()["id"]
    b = client.post("/api/categories", json={"name": "B", "parent_id": a}).get_json()["id"]
    client.patch(f"/api/categories/{a}", json={"archived": True})
    client.patch(f"/api/categories/{b}", json={"archived": False})
    cats = {c["name"]: c for c in client.get("/api/categories").get_json()}
    assert not cats["B"]["archived"]
    assert not cats["A"]["archived"]


def test_archiving_parent_reassigns_active_category(client):
    """La carpeta activa puede ser un DESCENDIENTE de la que se archiva."""
    register(client)
    client.post("/api/categories", json={"name": "Otra"})
    padre = client.post("/api/categories", json={"name": "Padre"}).get_json()["id"]
    hija = client.post("/api/categories", json={"name": "Hija", "parent_id": padre}).get_json()["id"]
    client.post("/api/preferences", json={"active_category_id": hija})
    assert client.get("/api/me").get_json()["active_category_id"] == hija

    client.patch(f"/api/categories/{padre}", json={"archived": True})
    activa = client.get("/api/me").get_json()["active_category_id"]
    cats = {c["id"]: c for c in client.get("/api/categories").get_json()}
    assert activa not in (padre, hija)
    assert not cats[activa]["archived"]


def test_cannot_create_subcategory_of_another_user(client):
    register(client, "ana")
    ajena = client.get("/api/categories").get_json()[0]["id"]
    client.get("/logout")
    register(client, "beto")
    r = client.post("/api/categories", json={"name": "Intrusa", "parent_id": ajena})
    assert r.status_code == 400


def test_max_depth_enforced(client):
    register(client)
    padre = client.get("/api/categories").get_json()[0]["id"]
    ultimo, creadas = padre, 0
    for i in range(app_module.MAX_CATEGORY_DEPTH + 3):
        r = client.post("/api/categories", json={"name": f"N{i}", "parent_id": ultimo})
        if r.status_code != 200:
            assert r.status_code == 400
            break
        ultimo = r.get_json()["id"]
        creadas += 1
    else:
        pytest.fail("El tope de profundidad no se aplicó")
    assert creadas < app_module.MAX_CATEGORY_DEPTH + 3


# ── Modo cronómetro ──────────────────────────────────────

def test_cronometro_mode_accepted(client):
    register(client)
    r = client.post("/api/sessions", json={"minutes": 45, "type": "Tesis", "mode": "cronometro"})
    assert r.status_code == 200
    assert client.get("/api/sessions").get_json()[0]["mode"] == "cronometro"


def test_cronometro_counts_as_study_not_break(client):
    register(client)
    client.post("/api/sessions", json={"minutes": 45, "type": "Tesis", "mode": "cronometro"})
    assert client.get("/api/stats").get_json()["total"] == 45
