
from flask import Flask, request, jsonify, send_file, send_from_directory, redirect, url_for
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3, csv, json, io, os, re, secrets, time
from datetime import datetime, timedelta
from contextlib import closing

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_secret_key():
    """Clave de sesión segura, sin valor por defecto hardcodeado.

    Prioridad: variable de entorno SECRET_KEY (recomendado en producción).
    Si no existe, se genera una clave aleatoria y se persiste en un archivo
    local (.secret_key) para que las sesiones sobrevivan a los reinicios.
    """
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    key_path = os.path.join(BASE_DIR, ".secret_key")
    if os.path.exists(key_path):
        with open(key_path, "r", encoding="utf-8") as fh:
            saved = fh.read().strip()
        if saved:
            return saved
    key = secrets.token_hex(32)
    with open(key_path, "w", encoding="utf-8") as fh:
        fh.write(key)
    return key


app = Flask(__name__)
app.secret_key = load_secret_key()

# Endurecimiento de la cookie de sesión.
# SECURE se activa por variable de entorno: forzarlo en local (http://) impediría
# el login por completo, porque el navegador no enviaría la cookie.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("FOCUSDATA_HTTPS", "").lower() in ("1", "true", "yes"),
)
DB = os.path.join(BASE_DIR, "study.db")

# Fondos que sube cada usuario. Viven fuera de /static para que solo su dueño
# pueda verlos: se sirven desde /api/backgrounds/<id>/image, con login.
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads", "backgrounds")
BG_MAX_PER_USER = 6
BG_MAX_BYTES = 4 * 1024 * 1024        # el navegador ya la reduce a 2560 px antes de subirla
BG_THUMB_MAX_BYTES = 400 * 1024
BG_NAME_MAX = 40
# Tope global del cuerpo de una petición (imagen + miniatura + campos del formulario).
app.config["MAX_CONTENT_LENGTH"] = 6 * 1024 * 1024

# Preferencias por defecto (fuente única de verdad; el DEFAULT de SQL puede quedar
# obsoleto en tablas ya creadas, así que se aplican explícitamente al registrar).
DEFAULT_THEME = "dark"
DEFAULT_ACCENT = "#3b82f6"
DEFAULT_SCENE = "road"

# Carpetas (categorías) de sesiones
DEFAULT_CATEGORY_NAME = "General"
DEFAULT_CATEGORY_COLOR = "#6366f1"
CATEGORY_NAME_MAX = 30
ROOT_PARENT_ID = 0      # centinela de raíz: NO usar NULL (rompería el UNIQUE)
MAX_CATEGORY_DEPTH = 10 # tope de seguridad del anidamiento (raíz = nivel 0)

# Validación de registro (usadas por register(), más abajo)
USERNAME_MAX = 30
PASSWORD_MIN = 8

# ── Flask-Login setup ───────────────────────────────────

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login_page"

class User(UserMixin):
    def __init__(self, id, username):
        self.id = id
        self.username = username

@login_manager.user_loader
def load_user(user_id):
    with closing(get_db()) as conn, conn:
        row = conn.execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()
    if row:
        return User(row["id"], row["username"])
    return None

@login_manager.unauthorized_handler
def unauthorized():
    if request.path.startswith("/api/"):
        return jsonify({"error": "No autorizado"}), 401
    return redirect(url_for("login_page"))

# ── Database ────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with closing(get_db()) as conn, conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT    UNIQUE NOT NULL,
                password TEXT    NOT NULL,
                theme    TEXT    NOT NULL DEFAULT 'dark',
                accent   TEXT    NOT NULL DEFAULT '#3b82f6',
                scene    TEXT    NOT NULL DEFAULT 'road'
            )
        """)
        # Migración: añadir columnas de preferencias si la tabla ya existía sin ellas
        existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "theme" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'")
        if "accent" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT '#3b82f6'")
        if "scene" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN scene TEXT NOT NULL DEFAULT 'road'")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER NOT NULL,
                date     TEXT    NOT NULL,
                hour     INTEGER NOT NULL,
                time     TEXT    NOT NULL,
                minutes  INTEGER NOT NULL,
                type     TEXT    NOT NULL,
                mode     TEXT    NOT NULL,
                ts       TEXT    NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        # Migración: la tabla 'sessions' original no tenía user_id (los POST fallaban en silencio).
        session_cols = {row["name"] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}
        if "user_id" not in session_cols:
            # ALTER no admite NOT NULL sin default en tablas con filas; se añade nullable.
            conn.execute("ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER NOT NULL REFERENCES users(id),
                name     TEXT    NOT NULL,
                color    TEXT    NOT NULL DEFAULT '#6366f1',
                archived INTEGER NOT NULL DEFAULT 0,
                UNIQUE(user_id, name)
            )
        """)
        # Migración: carpetas por sesión y carpeta activa por usuario (nullable, ver nota de user_id).
        if "category_id" not in session_cols:
            conn.execute("ALTER TABLE sessions ADD COLUMN category_id INTEGER REFERENCES categories(id)")
        user_cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "active_category_id" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN active_category_id INTEGER REFERENCES categories(id)")
        # Backfill idempotente: usuarios preexistentes reciben la carpeta 'Semestre 1'
        # y sus sesiones huérfanas se asignan a su primera carpeta.
        conn.execute("""
            INSERT OR IGNORE INTO categories (user_id, name)
            SELECT id, 'Semestre 1' FROM users
            WHERE id NOT IN (SELECT DISTINCT user_id FROM categories)
        """)
        conn.execute("""
            UPDATE sessions SET category_id = (
                SELECT id FROM categories c WHERE c.user_id = sessions.user_id ORDER BY c.id LIMIT 1
            ) WHERE category_id IS NULL AND user_id IS NOT NULL
        """)
        conn.execute("""
            UPDATE users SET active_category_id = (
                SELECT id FROM categories c WHERE c.user_id = users.id AND c.archived = 0 ORDER BY c.id LIMIT 1
            ) WHERE active_category_id IS NULL
        """)
        # Migración a jerarquía: añade parent_id y cambia UNIQUE(user_id,name)
        # por UNIQUE(user_id,parent_id,name). SQLite no permite alterar una
        # restricción de tabla con ALTER, así que hay que reconstruirla.
        # La raíz se representa con parent_id = 0 y NO con NULL: en SQLite los
        # NULL se comparan como distintos, así que con NULL el UNIQUE dejaría
        # pasar carpetas raíz duplicadas.
        cat_cols = {row["name"] for row in conn.execute("PRAGMA table_info(categories)").fetchall()}
        if "parent_id" not in cat_cols:
            conn.execute("""
                CREATE TABLE categories_new (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id   INTEGER NOT NULL REFERENCES users(id),
                    parent_id INTEGER NOT NULL DEFAULT 0,
                    name      TEXT    NOT NULL,
                    color     TEXT    NOT NULL DEFAULT '#6366f1',
                    archived  INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(user_id, parent_id, name)
                )
            """)
            conn.execute("""
                INSERT INTO categories_new (id, user_id, parent_id, name, color, archived)
                SELECT id, user_id, 0, name, color, archived FROM categories
            """)
            conn.execute("DROP TABLE categories")
            conn.execute("ALTER TABLE categories_new RENAME TO categories")
        # Fondos subidos por cada usuario (el archivo vive en UPLOAD_DIR/<user_id>/).
        conn.execute("""
            CREATE TABLE IF NOT EXISTS backgrounds (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id),
                name       TEXT    NOT NULL,
                file       TEXT    NOT NULL,
                thumb      TEXT    NOT NULL DEFAULT '',
                colors     TEXT    NOT NULL DEFAULT '[]',
                created_at TEXT    NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_backgrounds_user ON backgrounds(user_id)")
        # Migración del rediseño: las escenas retiradas pasan a la escena por defecto.
        marcas = ",".join("?" * len(REMOVED_SCENES))
        conn.execute(f"UPDATE users SET scene = ? WHERE scene IN ({marcas})", [DEFAULT_SCENE, *REMOVED_SCENES])
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_ts   ON sessions(user_id, ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_categories_user    ON categories(user_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_categories_parent  ON categories(parent_id)")
        conn.commit()

def resolve_category(conn, uid, category_id):
    """Devuelve un category_id válido (del usuario y no archivado) para registrar sesiones.

    Si el recibido no sirve, cae en cascada: carpeta activa del usuario →
    primera carpeta no archivada → crear la carpeta por defecto. Nunca falla,
    para no rechazar POST de sesiones de clientes con datos antiguos.
    """
    if category_id is not None:
        row = conn.execute(
            "SELECT id FROM categories WHERE id = ? AND user_id = ? AND archived = 0",
            (category_id, uid)
        ).fetchone()
        if row:
            return row["id"]
    row = conn.execute(
        """SELECT c.id FROM users u JOIN categories c ON c.id = u.active_category_id
           WHERE u.id = ? AND c.archived = 0""", (uid,)
    ).fetchone()
    if row:
        return row["id"]
    row = conn.execute(
        "SELECT id FROM categories WHERE user_id = ? AND archived = 0 ORDER BY id LIMIT 1", (uid,)
    ).fetchone()
    if row:
        return row["id"]
    conn.execute(
        "INSERT OR IGNORE INTO categories (user_id, name) VALUES (?, ?)",
        (uid, DEFAULT_CATEGORY_NAME)
    )
    row = conn.execute(
        "SELECT id FROM categories WHERE user_id = ? ORDER BY id LIMIT 1", (uid,)
    ).fetchone()
    return row["id"]


def category_descendants(conn, uid, cid):
    """IDs de una carpeta y TODOS sus descendientes (incluye la propia).

    UNION (y no UNION ALL) es deliberado: corta el recorrido si los datos
    llegaran a contener un ciclo, en vez de colgarse.
    """
    rows = conn.execute("""
        WITH RECURSIVE d(id) AS (
            SELECT id FROM categories WHERE id = ? AND user_id = ?
            UNION
            SELECT c.id FROM categories c JOIN d ON c.parent_id = d.id WHERE c.user_id = ?
        ) SELECT id FROM d
    """, (cid, uid, uid)).fetchall()
    return [r["id"] for r in rows]


def category_ancestors(conn, uid, cid):
    """IDs de los ancestros de una carpeta, de la más cercana a la raíz."""
    rows = conn.execute("""
        WITH RECURSIVE a(id, parent_id) AS (
            SELECT id, parent_id FROM categories WHERE id = ? AND user_id = ?
            UNION
            SELECT c.id, c.parent_id FROM categories c JOIN a ON c.id = a.parent_id
        ) SELECT id FROM a WHERE id != ?
    """, (cid, uid, cid)).fetchall()
    return [r["id"] for r in rows]


def category_depth(conn, uid, cid):
    """Nivel de anidamiento: 0 para una carpeta raíz."""
    if cid == ROOT_PARENT_ID:
        return -1
    return len(category_ancestors(conn, uid, cid))


def category_subtree_height(conn, uid, cid):
    """Cuántos niveles cuelgan por debajo de una carpeta (0 si no tiene hijas)."""
    row = conn.execute("""
        WITH RECURSIVE d(id, lvl) AS (
            SELECT id, 0 FROM categories WHERE id = ? AND user_id = ?
            UNION
            SELECT c.id, d.lvl + 1 FROM categories c JOIN d ON c.parent_id = d.id WHERE c.user_id = ?
        ) SELECT MAX(lvl) AS h FROM d
    """, (cid, uid, uid)).fetchone()
    return row["h"] or 0


def validate_parent(conn, uid, parent_id):
    """Valida un parent_id de destino. Devuelve (parent_id_ok, error_o_None)."""
    if parent_id in (None, ROOT_PARENT_ID):
        return ROOT_PARENT_ID, None
    try:
        parent_id = int(parent_id)
    except (TypeError, ValueError):
        return None, "Carpeta padre no válida"
    row = conn.execute(
        "SELECT id, archived FROM categories WHERE id = ? AND user_id = ?", (parent_id, uid)
    ).fetchone()
    if not row:
        return None, "Carpeta padre no válida"
    if row["archived"]:
        return None, "No puedes crear subcarpetas dentro de una carpeta archivada"
    return parent_id, None

# ── Auth Routes ─────────────────────────────────────────

@app.route("/login")
def login_page():
    if current_user.is_authenticated:
        return redirect("/")
    return send_from_directory('static', 'login.html')

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = data.get("username").strip() if isinstance(data.get("username"), str) else ""
    password = data.get("password") if isinstance(data.get("password"), str) else ""

    if not username or not password:
        return jsonify({"error": "Usuario y contraseña son requeridos"}), 400
    if len(username) < 3 or len(username) > USERNAME_MAX:
        return jsonify({"error": f"El usuario debe tener entre 3 y {USERNAME_MAX} caracteres"}), 400
    if len(password) < PASSWORD_MIN:
        return jsonify({"error": f"La contraseña debe tener al menos {PASSWORD_MIN} caracteres"}), 400

    try:
        with closing(get_db()) as conn, conn:
            conn.execute(
                "INSERT INTO users (username, password, theme, accent, scene) VALUES (?, ?, ?, ?, ?)",
                (username, generate_password_hash(password), DEFAULT_THEME, DEFAULT_ACCENT, DEFAULT_SCENE)
            )
            row = conn.execute("SELECT id, username FROM users WHERE username = ?", (username,)).fetchone()
            # Carpeta inicial del usuario, activa por defecto
            cur = conn.execute(
                "INSERT INTO categories (user_id, name) VALUES (?, ?)",
                (row["id"], DEFAULT_CATEGORY_NAME)
            )
            conn.execute("UPDATE users SET active_category_id = ? WHERE id = ?", (cur.lastrowid, row["id"]))
            conn.commit()
            user = User(row["id"], row["username"])
            login_user(user)
        return jsonify({"ok": True, "username": username})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Ese nombre de usuario ya existe"}), 409

# ── Freno de fuerza bruta en el login ───────────────────
# Contador en memoria del proceso: se pierde al reiniciar y es por worker.
# Suficiente y proporcionado para el tamaño de esta app; si algún día hace falta
# algo estricto, habría que moverlo a la DB o a Redis.
LOGIN_MAX_FAILS      = 8
LOGIN_WINDOW_SECONDS = 300
_login_fails = {}   # ip -> (nº de fallos, inicio de la ventana en time.monotonic())

def _login_retry_after(ip):
    """Segundos que faltan para poder reintentar, o 0 si no está bloqueado."""
    entry = _login_fails.get(ip)
    if not entry:
        return 0
    count, start = entry
    elapsed = time.monotonic() - start
    if elapsed > LOGIN_WINDOW_SECONDS:
        _login_fails.pop(ip, None)
        return 0
    if count >= LOGIN_MAX_FAILS:
        return int(LOGIN_WINDOW_SECONDS - elapsed) + 1
    return 0

def _record_login_fail(ip):
    count, start = _login_fails.get(ip, (0, time.monotonic()))
    if time.monotonic() - start > LOGIN_WINDOW_SECONDS:
        count, start = 0, time.monotonic()
    _login_fails[ip] = (count + 1, start)

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username").strip() if isinstance(data.get("username"), str) else ""
    password = data.get("password") if isinstance(data.get("password"), str) else ""

    ip = request.remote_addr or "desconocida"
    retry = _login_retry_after(ip)
    if retry:
        return jsonify({"error": f"Demasiados intentos fallidos. Reintenta en {retry} segundos."}), 429

    with closing(get_db()) as conn, conn:
        row = conn.execute("SELECT id, username, password FROM users WHERE username = ?", (username,)).fetchone()

    if not row or not check_password_hash(row["password"], password):
        _record_login_fail(ip)
        return jsonify({"error": "Usuario o contraseña incorrectos"}), 401

    _login_fails.pop(ip, None)
    user = User(row["id"], row["username"])
    login_user(user)
    return jsonify({"ok": True, "username": username})

@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login_page"))

@app.route("/api/me")
@login_required
def me():
    with closing(get_db()) as conn, conn:
        row = conn.execute("SELECT theme, accent, scene, active_category_id FROM users WHERE id = ?", (current_user.id,)).fetchone()
    return jsonify({
        "id": current_user.id,
        "username": current_user.username,
        "theme": row["theme"] if row else DEFAULT_THEME,
        "accent": row["accent"] if row else DEFAULT_ACCENT,
        "scene": row["scene"] if row else DEFAULT_SCENE,
        "active_category_id": row["active_category_id"] if row else None,
    })

# Temas válidos y validación del color de acento (#rgb o #rrggbb)
VALID_THEMES = {"dark", "light", "ocean", "forest"}

# Catálogo fijo de escenas de fondo. Debe coincidir con SCENES en static/js/scenes.js.
# Además se admite "bg:<id>" para un fondo subido por el propio usuario.
VALID_SCENES = {"none", "road", "blossom", "ocean", "forest", "dusk", "nebula"}
REMOVED_SCENES = ("aurora", "summit", "arena")
BG_SCENE_RE = re.compile(r"^bg:(\d+)$")
HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# Colores que el navegador extrae de un fondo subido (se interpolan en CSS: formato estricto).
BG_COLOR_RE = re.compile(r"^(?:#[0-9a-fA-F]{6}|hsl\(\d{1,3} \d{1,3}% \d{1,3}%\))$")


def scene_is_valid(conn, uid, scene):
    """Una escena del catálogo o un fondo que pertenezca a este usuario."""
    if not isinstance(scene, str):
        return False
    if scene in VALID_SCENES:
        return True
    m = BG_SCENE_RE.match(scene)
    if not m:
        return False
    return conn.execute(
        "SELECT 1 FROM backgrounds WHERE id = ? AND user_id = ?", (int(m.group(1)), uid)
    ).fetchone() is not None

# Validación de entrada de sesiones
VALID_MODES  = {"pomodoro", "break", "manual", "cronometro"}
DATE_RE      = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE      = re.compile(r"^\d{1,2}:\d{2}$")
TYPE_MAX     = 40
TS_MAX       = 40
MINUTES_MIN  = 1
MINUTES_MAX  = 600

@app.route("/api/preferences", methods=["POST"])
@login_required
def save_preferences():
    # Actualización parcial: solo se validan y guardan las claves presentes en el JSON.
    data = request.get_json() or {}
    updates, params = [], []

    if "theme" in data:
        if data["theme"] not in VALID_THEMES:
            return jsonify({"error": "Tema no válido"}), 400
        updates.append("theme = ?")
        params.append(data["theme"])
    if "accent" in data:
        if not isinstance(data["accent"], str) or not HEX_RE.match(data["accent"]):
            return jsonify({"error": "Color de acento no válido"}), 400
        updates.append("accent = ?")
        params.append(data["accent"])
    with closing(get_db()) as conn, conn:
        if "scene" in data:
            if not scene_is_valid(conn, current_user.id, data["scene"]):
                return jsonify({"error": "Escena no válida"}), 400
            updates.append("scene = ?")
            params.append(data["scene"])
        if "active_category_id" in data:
            row = conn.execute(
                "SELECT id FROM categories WHERE id = ? AND user_id = ? AND archived = 0",
                (data["active_category_id"], current_user.id)
            ).fetchone()
            if not row:
                return jsonify({"error": "Carpeta no válida"}), 400
            updates.append("active_category_id = ?")
            params.append(row["id"])
        if updates:
            params.append(current_user.id)
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
    return jsonify({"ok": True})

# ── Categorías (carpetas) ───────────────────────────────

def _category_json(row):
    # Las claves originales (id, name, color, archived) se mantienen intactas:
    # el frontend antiguo sigue funcionando. parent_id/depth/path son añadidos.
    data = {"id": row["id"], "name": row["name"], "color": row["color"], "archived": row["archived"]}
    for extra in ("parent_id", "depth", "path"):
        if extra in row.keys():
            data[extra] = row[extra]
    return data

@app.route("/api/categories", methods=["GET"])
@login_required
def get_categories():
    # Recorrido en preorden: cada carpeta aparece justo detrás de su padre, con
    # las hermanas en orden alfabético. El frontend puede pintar el árbol
    # recorriendo la lista tal cual, sin reordenar.
    with closing(get_db()) as conn, conn:
        rows = conn.execute("""
            WITH RECURSIVE tree(id, parent_id, name, color, archived, depth, path, sortkey) AS (
                SELECT id, parent_id, name, color, archived, 0, name,
                       lower(name) || '/'
                  FROM categories WHERE user_id = ? AND parent_id = 0
                UNION ALL
                SELECT c.id, c.parent_id, c.name, c.color, c.archived,
                       t.depth + 1, t.path || ' › ' || c.name,
                       t.sortkey || lower(c.name) || '/'
                  FROM categories c JOIN tree t ON c.parent_id = t.id
                 WHERE c.user_id = ?
            )
            SELECT id, parent_id, name, color, archived, depth, path
              FROM tree ORDER BY sortkey
        """, (current_user.id, current_user.id)).fetchall()
    return jsonify([_category_json(r) for r in rows])

@app.route("/api/categories", methods=["POST"])
@login_required
def create_category():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    color = data.get("color", DEFAULT_CATEGORY_COLOR)
    if not name or len(name) > CATEGORY_NAME_MAX:
        return jsonify({"error": f"El nombre debe tener entre 1 y {CATEGORY_NAME_MAX} caracteres"}), 400
    if not isinstance(color, str) or not HEX_RE.match(color):
        return jsonify({"error": "Color no válido"}), 400
    with closing(get_db()) as conn, conn:
        parent_id, err = validate_parent(conn, current_user.id, data.get("parent_id"))
        if err:
            return jsonify({"error": err}), 400
        if parent_id != ROOT_PARENT_ID:
            if category_depth(conn, current_user.id, parent_id) + 1 >= MAX_CATEGORY_DEPTH:
                return jsonify({"error": f"No puedes anidar más de {MAX_CATEGORY_DEPTH} niveles"}), 400
        try:
            cur = conn.execute(
                "INSERT INTO categories (user_id, name, color, parent_id) VALUES (?, ?, ?, ?)",
                (current_user.id, name, color, parent_id)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            return jsonify({"error": "Ya existe una carpeta con ese nombre en el mismo nivel"}), 409
    return jsonify({"ok": True, "id": cur.lastrowid, "name": name, "color": color,
                    "archived": 0, "parent_id": parent_id})

@app.route("/api/categories/<int:cid>", methods=["PATCH"])
@login_required
def update_category(cid):
    data = request.get_json() or {}
    uid = current_user.id
    with closing(get_db()) as conn, conn:
        row = conn.execute(
            "SELECT id, name, color, archived FROM categories WHERE id = ? AND user_id = ?", (cid, uid)
        ).fetchone()
        if not row:
            return jsonify({"error": "Carpeta no encontrada"}), 404

        updates, params = [], []
        archivadas = []

        if "name" in data:
            name = (data.get("name") or "").strip()
            if not name or len(name) > CATEGORY_NAME_MAX:
                return jsonify({"error": f"El nombre debe tener entre 1 y {CATEGORY_NAME_MAX} caracteres"}), 400
            updates.append("name = ?")
            params.append(name)
        if "color" in data:
            if not isinstance(data["color"], str) or not HEX_RE.match(data["color"]):
                return jsonify({"error": "Color no válido"}), 400
            updates.append("color = ?")
            params.append(data["color"])
        if "parent_id" in data:
            new_parent, err = validate_parent(conn, uid, data["parent_id"])
            if err:
                return jsonify({"error": err}), 400
            if new_parent == cid:
                return jsonify({"error": "Una carpeta no puede ser su propia carpeta padre"}), 400
            # Prevención de ciclos: el destino no puede colgar de la propia carpeta.
            if new_parent in category_descendants(conn, uid, cid):
                return jsonify({"error": "No puedes mover una carpeta dentro de sí misma"}), 400
            nueva_prof = (0 if new_parent == ROOT_PARENT_ID
                          else category_depth(conn, uid, new_parent) + 1)
            if nueva_prof + category_subtree_height(conn, uid, cid) >= MAX_CATEGORY_DEPTH:
                return jsonify({"error": f"El movimiento superaría los {MAX_CATEGORY_DEPTH} niveles"}), 400
            updates.append("parent_id = ?")
            params.append(new_parent)
        if "archived" in data:
            archived = 1 if data["archived"] else 0
            afectadas = (category_descendants(conn, uid, cid) if archived
                         else [cid] + category_ancestors(conn, uid, cid))
            if archived and not row["archived"]:
                # Debe quedar al menos una carpeta activa DESPUÉS de la cascada.
                marcas = ",".join("?" * len(afectadas))
                otras = conn.execute(
                    f"SELECT COUNT(*) FROM categories WHERE user_id = ? AND archived = 0 AND id NOT IN ({marcas})",
                    [uid] + afectadas
                ).fetchone()[0]
                if otras == 0:
                    return jsonify({"error": "No puedes archivar tu única carpeta activa"}), 400
            marcas = ",".join("?" * len(afectadas))
            conn.execute(
                f"UPDATE categories SET archived = ? WHERE user_id = ? AND id IN ({marcas})",
                [archived, uid] + afectadas
            )
            if archived:
                archivadas = afectadas

        if updates:
            params.extend([cid, uid])
            try:
                conn.execute(f"UPDATE categories SET {', '.join(updates)} WHERE id = ? AND user_id = ?", params)
            except sqlite3.IntegrityError:
                return jsonify({"error": "Ya existe una carpeta con ese nombre en el mismo nivel"}), 409

        # Si se archivó la carpeta activa (o cualquiera de sus ancestros en cascada),
        # reasignar active_category_id a otra carpeta activa
        if archivadas:
            marcas = ",".join("?" * len(archivadas))
            conn.execute(
                f"""UPDATE users SET active_category_id = (
                        SELECT id FROM categories WHERE user_id = ? AND archived = 0 ORDER BY id LIMIT 1
                    ) WHERE id = ? AND active_category_id IN ({marcas})""",
                [uid, uid] + archivadas
            )
        conn.commit()

        row = conn.execute(
            "SELECT id, name, color, archived FROM categories WHERE id = ? AND user_id = ?", (cid, uid)
        ).fetchone()
    result = _category_json(row)
    result["ok"] = True
    return jsonify(result)

@app.route("/api/categories/<int:cid>", methods=["DELETE"])
@login_required
def delete_category(cid):
    """Borra una carpeta y TODO su subárbol, de forma definitiva.

    El cuerpo decide qué pasa con las sesiones que había dentro:
        {"content": "move", "target_id": <id>}  → se reasignan a esa carpeta
        {"content": "delete"}                   → se borran con la carpeta

    Archivar sigue siendo la opción reversible; esto no lo es.
    """
    data = request.get_json(silent=True) or {}
    uid = current_user.id
    content = data.get("content")
    if content not in ("move", "delete"):
        return jsonify({"error": "Indica qué hacer con el contenido"}), 400

    with closing(get_db()) as conn, conn:
        row = conn.execute(
            "SELECT id, name FROM categories WHERE id = ? AND user_id = ?", (cid, uid)
        ).fetchone()
        if not row:
            return jsonify({"error": "Carpeta no encontrada"}), 404

        # El subárbol entero desaparece: la carpeta y todas sus subcarpetas.
        ids = category_descendants(conn, uid, cid)
        marcas = ",".join("?" * len(ids))

        # Tiene que quedar al menos una carpeta activa donde registrar sesiones.
        quedan = conn.execute(
            f"SELECT COUNT(*) FROM categories WHERE user_id = ? AND archived = 0 AND id NOT IN ({marcas})",
            [uid] + ids
        ).fetchone()[0]
        if quedan == 0:
            return jsonify({"error": "No puedes eliminar tu única carpeta activa"}), 400

        target_id = None
        if content == "move":
            try:
                target_id = int(data.get("target_id"))
            except (TypeError, ValueError):
                return jsonify({"error": "Carpeta de destino no válida"}), 400
            # El destino no puede estar dentro de lo que se va a borrar.
            if target_id in ids:
                return jsonify({"error": "El destino no puede ser la carpeta que estás eliminando"}), 400
            destino = conn.execute(
                "SELECT id FROM categories WHERE id = ? AND user_id = ? AND archived = 0",
                (target_id, uid)
            ).fetchone()
            if not destino:
                return jsonify({"error": "Carpeta de destino no válida"}), 400

        afectadas = conn.execute(
            f"SELECT COUNT(*) FROM sessions WHERE user_id = ? AND category_id IN ({marcas})",
            [uid] + ids
        ).fetchone()[0]

        if content == "move":
            conn.execute(
                f"UPDATE sessions SET category_id = ? WHERE user_id = ? AND category_id IN ({marcas})",
                [target_id, uid] + ids
            )
        else:
            conn.execute(
                f"DELETE FROM sessions WHERE user_id = ? AND category_id IN ({marcas})",
                [uid] + ids
            )

        conn.execute(
            f"DELETE FROM categories WHERE user_id = ? AND id IN ({marcas})", [uid] + ids
        )

        # Si la carpeta activa era una de las borradas, hay que reapuntarla o el
        # próximo POST de sesión se quedaría sin destino.
        conn.execute(
            f"""UPDATE users SET active_category_id = (
                    SELECT id FROM categories WHERE user_id = ? AND archived = 0 ORDER BY id LIMIT 1
                ) WHERE id = ? AND active_category_id IN ({marcas})""",
            [uid, uid] + ids
        )
        conn.commit()

        activa = conn.execute(
            "SELECT active_category_id FROM users WHERE id = ?", (uid,)
        ).fetchone()["active_category_id"]

    return jsonify({
        "ok": True,
        "deleted_ids": ids,
        "deleted_folders": len(ids),
        "moved_sessions": afectadas if content == "move" else 0,
        "deleted_sessions": afectadas if content == "delete" else 0,
        "active_category_id": activa,
    })

@app.route("/api/sessions/<int:sid>", methods=["PATCH"])
@login_required
def update_session(sid):
    data = request.get_json(silent=True) or {}
    uid = current_user.id
    try:
        cid_req = int(data.get("category_id"))
    except (TypeError, ValueError):
        return jsonify({"error": "Carpeta no válida"}), 400
    with closing(get_db()) as conn, conn:
        if not conn.execute("SELECT id FROM sessions WHERE id = ? AND user_id = ?", (sid, uid)).fetchone():
            return jsonify({"error": "Sesión no encontrada"}), 404
        cat = conn.execute(
            "SELECT id, name FROM categories WHERE id = ? AND user_id = ?", (cid_req, uid)
        ).fetchone()
        if not cat:
            return jsonify({"error": "Carpeta no válida"}), 400
        conn.execute("UPDATE sessions SET category_id = ? WHERE id = ? AND user_id = ?", (cat["id"], sid, uid))
        conn.commit()
    return jsonify({"ok": True, "category_id": cat["id"], "category_name": cat["name"]})

# ── Fondos propios ──────────────────────────────────────

IMAGE_MIMETYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def _sniff_image(data):
    """Tipo real por los primeros bytes; nunca se confía en el nombre ni en el Content-Type."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _user_upload_dir(uid):
    return os.path.join(UPLOAD_DIR, str(int(uid)))


def _background_json(row):
    try:
        colors = json.loads(row["colors"] or "[]")
    except ValueError:
        colors = []
    url = f"/api/backgrounds/{row['id']}/image"
    return {
        "id": row["id"],
        "name": row["name"],
        "colors": colors if isinstance(colors, list) else [],
        "url": url,
        "thumb_url": f"{url}?size=thumb" if row["thumb"] else url,
    }


@app.errorhandler(413)
def request_too_large(_err):
    return jsonify({"error": "El archivo es demasiado grande"}), 413


@app.route("/api/backgrounds", methods=["GET"])
@login_required
def list_backgrounds():
    with closing(get_db()) as conn, conn:
        rows = conn.execute(
            "SELECT * FROM backgrounds WHERE user_id = ? ORDER BY id", (current_user.id,)
        ).fetchall()
    return jsonify([_background_json(r) for r in rows])


@app.route("/api/backgrounds", methods=["POST"])
@login_required
def upload_background():
    uid = current_user.id
    upload = request.files.get("file")
    if not upload:
        return jsonify({"error": "Falta la imagen"}), 400
    data = upload.read(BG_MAX_BYTES + 1)
    if not data:
        return jsonify({"error": "La imagen está vacía"}), 400
    if len(data) > BG_MAX_BYTES:
        return jsonify({"error": f"La imagen supera los {BG_MAX_BYTES // (1024 * 1024)} MB"}), 413
    ext = _sniff_image(data)
    if not ext:
        return jsonify({"error": "Formato no admitido: usa JPG, PNG o WebP"}), 400

    # La miniatura es opcional: si no llega o no es válida, se usa la imagen completa.
    thumb_data, thumb_ext = b"", None
    thumb = request.files.get("thumb")
    if thumb:
        thumb_data = thumb.read(BG_THUMB_MAX_BYTES + 1)
        thumb_ext = _sniff_image(thumb_data) if 0 < len(thumb_data) <= BG_THUMB_MAX_BYTES else None
        if not thumb_ext:
            thumb_data = b""

    name = (request.form.get("name") or "").strip()[:BG_NAME_MAX] or "Mi fondo"
    try:
        colors = json.loads(request.form.get("colors") or "[]")
    except ValueError:
        colors = []
    if not isinstance(colors, list):
        colors = []
    colors = [c for c in colors if isinstance(c, str) and BG_COLOR_RE.match(c)][:3]

    with closing(get_db()) as conn, conn:
        count = conn.execute("SELECT COUNT(*) FROM backgrounds WHERE user_id = ?", (uid,)).fetchone()[0]
        if count >= BG_MAX_PER_USER:
            return jsonify({"error": f"Puedes guardar hasta {BG_MAX_PER_USER} fondos. Elimina uno para subir otro."}), 400

        folder = _user_upload_dir(uid)
        os.makedirs(folder, exist_ok=True)
        token = secrets.token_hex(12)
        file_name = f"{token}.{ext}"
        with open(os.path.join(folder, file_name), "wb") as fh:
            fh.write(data)
        thumb_name = ""
        if thumb_data:
            thumb_name = f"{token}-thumb.{thumb_ext}"
            with open(os.path.join(folder, thumb_name), "wb") as fh:
                fh.write(thumb_data)

        cur = conn.execute(
            "INSERT INTO backgrounds (user_id, name, file, thumb, colors, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (uid, name, file_name, thumb_name, json.dumps(colors), datetime.now().isoformat(timespec="seconds"))
        )
        conn.commit()
        row = conn.execute("SELECT * FROM backgrounds WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"ok": True, "background": _background_json(row)})


@app.route("/api/backgrounds/<int:bid>/image")
@login_required
def background_image(bid):
    with closing(get_db()) as conn, conn:
        row = conn.execute(
            "SELECT file, thumb FROM backgrounds WHERE id = ? AND user_id = ?", (bid, current_user.id)
        ).fetchone()
    if not row:
        return jsonify({"error": "Fondo no encontrado"}), 404
    name = row["thumb"] if request.args.get("size") == "thumb" and row["thumb"] else row["file"]
    path = os.path.join(_user_upload_dir(current_user.id), name)
    if not os.path.isfile(path):
        return jsonify({"error": "Fondo no encontrado"}), 404
    mimetype = IMAGE_MIMETYPES.get(name.rsplit(".", 1)[-1], "application/octet-stream")
    resp = send_file(path, mimetype=mimetype, max_age=31536000)
    # Los ids nunca se reutilizan (AUTOINCREMENT), así que la imagen de una URL no cambia jamás.
    resp.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


@app.route("/api/backgrounds/<int:bid>", methods=["DELETE"])
@login_required
def delete_background(bid):
    uid = current_user.id
    with closing(get_db()) as conn, conn:
        row = conn.execute(
            "SELECT file, thumb FROM backgrounds WHERE id = ? AND user_id = ?", (bid, uid)
        ).fetchone()
        if not row:
            return jsonify({"error": "Fondo no encontrado"}), 404
        conn.execute("DELETE FROM backgrounds WHERE id = ? AND user_id = ?", (bid, uid))
        # Si era el fondo en uso, se vuelve a la escena por defecto.
        conn.execute("UPDATE users SET scene = ? WHERE id = ? AND scene = ?", (DEFAULT_SCENE, uid, f"bg:{bid}"))
        conn.commit()
        scene = conn.execute("SELECT scene FROM users WHERE id = ?", (uid,)).fetchone()["scene"]
    folder = _user_upload_dir(uid)
    for name in (row["file"], row["thumb"]):
        if name:
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass
    return jsonify({"ok": True, "scene": scene})

# ── App Routes ──────────────────────────────────────────

@app.route("/")
@login_required
def index():
    return send_from_directory('static', 'index.html')

@app.route("/api/sessions", methods=["GET"])
@login_required
def get_sessions():
    days  = request.args.get("days", 0, type=int)
    stype = request.args.get("type", "")
    include_breaks = request.args.get("include_breaks", "") in ("1", "true", "yes")
    uid = current_user.id
    with closing(get_db()) as conn, conn:
        q = ("SELECT s.*, c.name AS category_name, c.color AS category_color "
             "FROM sessions s LEFT JOIN categories c ON c.id = s.category_id "
             "WHERE s.user_id = ?")
        if not include_breaks:
            q += " AND s.mode != 'break'"
        params = [uid]
        if days > 0:
            cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
            q += " AND s.date >= ?"
            params.append(cutoff)
        if stype:
            q += " AND s.type = ?"
            params.append(stype)
        q += " ORDER BY s.ts DESC"
        rows = conn.execute(q, params).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/sessions", methods=["POST"])
@login_required
def add_session():
    data = request.get_json(silent=True) or {}
    now  = datetime.now()
    uid  = current_user.id

    try:
        minutes = int(data["minutes"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "minutes debe ser un número entero"}), 400
    if not (MINUTES_MIN <= minutes <= MINUTES_MAX):
        return jsonify({"error": f"minutes debe estar entre {MINUTES_MIN} y {MINUTES_MAX}"}), 400

    stype = data.get("type").strip() if isinstance(data.get("type"), str) else ""
    if not stype or len(stype) > TYPE_MAX:
        return jsonify({"error": f"type debe tener entre 1 y {TYPE_MAX} caracteres"}), 400

    mode = data.get("mode")
    if mode not in VALID_MODES:
        return jsonify({"error": "mode no válido"}), 400

    date = data.get("date") or now.strftime("%Y-%m-%d")
    if not isinstance(date, str) or not DATE_RE.match(date):
        return jsonify({"error": "date debe tener formato YYYY-MM-DD"}), 400

    time_ = data.get("time") or now.strftime("%H:%M")
    if not isinstance(time_, str) or not TIME_RE.match(time_):
        return jsonify({"error": "time debe tener formato HH:MM"}), 400

    try:
        hour = int(data.get("hour", now.hour))
    except (TypeError, ValueError):
        return jsonify({"error": "hour debe ser un número entero"}), 400
    if not (0 <= hour <= 23):
        return jsonify({"error": "hour debe estar entre 0 y 23"}), 400

    # `ts` es la clave de deduplicación cliente↔servidor: se guarda tal cual llega.
    ts = str(data.get("ts") or now.isoformat())[:TS_MAX]

    category_id = data.get("category_id")
    if category_id is not None:
        try:
            category_id = int(category_id)
        except (TypeError, ValueError):
            category_id = None

    with closing(get_db()) as conn, conn:
        category_id = resolve_category(conn, uid, category_id)
        conn.execute(
            "INSERT INTO sessions (user_id,date,hour,time,minutes,type,mode,ts,category_id) VALUES (?,?,?,?,?,?,?,?,?)",
            (uid, date, hour, time_, minutes, stype, mode, ts, category_id)
        )
        conn.commit()
    return jsonify({"ok": True, "category_id": category_id})

@app.route("/api/stats")
@login_required
def get_stats():
    today = datetime.now().strftime("%Y-%m-%d")
    week_cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    uid = current_user.id
    with closing(get_db()) as conn, conn:
        total  = conn.execute("SELECT COALESCE(SUM(minutes),0) FROM sessions WHERE mode!='break' AND user_id=?", (uid,)).fetchone()[0]
        week   = conn.execute("SELECT COALESCE(SUM(minutes),0) FROM sessions WHERE mode!='break' AND user_id=? AND date>=?", (uid, week_cutoff)).fetchone()[0]
        today_ = conn.execute("SELECT COALESCE(SUM(minutes),0) FROM sessions WHERE mode!='break' AND user_id=? AND date=?", (uid, today)).fetchone()[0]
        count  = conn.execute("SELECT COUNT(*) FROM sessions WHERE mode!='break' AND user_id=?", (uid,)).fetchone()[0]

        # last 7 days breakdown
        days_data = []
        for i in range(6, -1, -1):
            d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            mins = conn.execute(
                "SELECT COALESCE(SUM(minutes),0) FROM sessions WHERE mode!='break' AND user_id=? AND date=?", (uid, d)
            ).fetchone()[0]
            days_data.append({"date": d, "minutes": mins})

        # by type
        type_rows = conn.execute(
            "SELECT type, SUM(minutes) as total FROM sessions WHERE mode!='break' AND user_id=? GROUP BY type ORDER BY total DESC", (uid,)
        ).fetchall()

    return jsonify({
        "total": total, "week": week, "today": today_,
        "sessions": count, "days": days_data,
        "by_type": [dict(r) for r in type_rows]
    })

@app.route("/api/export/csv")
@login_required
def export_csv():
    uid = current_user.id
    with closing(get_db()) as conn, conn:
        rows = conn.execute(
            """SELECT s.date, s.time, s.hour, s.minutes, s.type, s.mode, COALESCE(c.name,'') AS carpeta, s.ts
               FROM sessions s LEFT JOIN categories c ON c.id = s.category_id
               WHERE s.mode != 'break' AND s.user_id = ? ORDER BY s.ts DESC""", (uid,)
        ).fetchall()
    buf = io.StringIO()
    buf.write("\ufeff")          # BOM para Excel
    w = csv.writer(buf)
    w.writerow(["fecha","hora","hora_num","minutos","tipo","modo","carpeta","timestamp"])

    def _csv_safe(v):
        """Neutraliza la inyección de fórmulas al abrir el CSV en Excel/Sheets."""
        s = "" if v is None else str(v)
        return "'" + s if s[:1] in ("=", "+", "-", "@") else s

    w.writerows([[_csv_safe(v) for v in row] for row in rows])
    buf.seek(0)
    return send_file(
        io.BytesIO(buf.getvalue().encode("utf-8")),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"estudio_{datetime.now().strftime('%Y-%m-%d')}.csv"
    )

@app.route("/api/export/json")
@login_required
def export_json():
    uid = current_user.id
    with closing(get_db()) as conn, conn:
        rows = conn.execute(
            """SELECT s.*, c.name AS category_name FROM sessions s
               LEFT JOIN categories c ON c.id = s.category_id
               WHERE s.user_id = ? ORDER BY s.ts DESC""", (uid,)
        ).fetchall()
    data = json.dumps([dict(r) for r in rows], ensure_ascii=False, indent=2)
    return send_file(
        io.BytesIO(data.encode("utf-8")),
        mimetype="application/json",
        as_attachment=True,
        download_name=f"estudio_{datetime.now().strftime('%Y-%m-%d')}.json"
    )

@app.route("/api/sessions/all", methods=["DELETE"])
@login_required
def delete_all():
    uid = current_user.id
    with closing(get_db()) as conn, conn:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        conn.commit()
    return jsonify({"ok": True})

if __name__ == "__main__":
    init_db()
    print("\n  FocusData corriendo en http://127.0.0.1:5000\n")
    app.run(debug=True)
