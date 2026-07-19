
from flask import Flask, request, jsonify, send_file, send_from_directory, redirect, url_for
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3, csv, json, io, os, re, secrets
from datetime import datetime, timedelta

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
DB = os.path.join(BASE_DIR, "study.db")

# Preferencias por defecto (fuente única de verdad; el DEFAULT de SQL puede quedar
# obsoleto en tablas ya creadas, así que se aplican explícitamente al registrar).
DEFAULT_THEME = "dark"
DEFAULT_ACCENT = "#3b82f6"

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
    with get_db() as conn:
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
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT    UNIQUE NOT NULL,
                password TEXT    NOT NULL,
                theme    TEXT    NOT NULL DEFAULT 'dark',
                accent   TEXT    NOT NULL DEFAULT '#3b82f6'
            )
        """)
        # Migración: añadir columnas de preferencias si la tabla ya existía sin ellas
        existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "theme" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'")
        if "accent" not in existing_cols:
            conn.execute("ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT '#3b82f6'")
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
        conn.commit()

# ── Auth Routes ─────────────────────────────────────────

@app.route("/login")
def login_page():
    if current_user.is_authenticated:
        return redirect("/")
    return send_from_directory('static', 'login.html')

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return jsonify({"error": "Usuario y contraseña son requeridos"}), 400
    if len(username) < 3:
        return jsonify({"error": "El usuario debe tener al menos 3 caracteres"}), 400
    if len(password) < 4:
        return jsonify({"error": "La contraseña debe tener al menos 4 caracteres"}), 400

    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (username, password, theme, accent) VALUES (?, ?, ?, ?)",
                (username, generate_password_hash(password), DEFAULT_THEME, DEFAULT_ACCENT)
            )
            conn.commit()
            row = conn.execute("SELECT id, username FROM users WHERE username = ?", (username,)).fetchone()
            user = User(row["id"], row["username"])
            login_user(user)
        return jsonify({"ok": True, "username": username})
    except sqlite3.IntegrityError:
        return jsonify({"error": "Ese nombre de usuario ya existe"}), 409

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    with get_db() as conn:
        row = conn.execute("SELECT id, username, password FROM users WHERE username = ?", (username,)).fetchone()

    if not row or not check_password_hash(row["password"], password):
        return jsonify({"error": "Usuario o contraseña incorrectos"}), 401

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
    with get_db() as conn:
        row = conn.execute("SELECT theme, accent FROM users WHERE id = ?", (current_user.id,)).fetchone()
    return jsonify({
        "username": current_user.username,
        "theme": row["theme"] if row else DEFAULT_THEME,
        "accent": row["accent"] if row else DEFAULT_ACCENT,
    })

# Temas válidos y validación del color de acento (#rgb o #rrggbb)
VALID_THEMES = {"dark", "light", "ocean", "forest"}
HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

@app.route("/api/preferences", methods=["POST"])
@login_required
def save_preferences():
    data = request.get_json() or {}
    theme = data.get("theme", DEFAULT_THEME)
    accent = data.get("accent", DEFAULT_ACCENT)

    if theme not in VALID_THEMES:
        return jsonify({"error": "Tema no válido"}), 400
    if not isinstance(accent, str) or not HEX_RE.match(accent):
        return jsonify({"error": "Color de acento no válido"}), 400

    with get_db() as conn:
        conn.execute("UPDATE users SET theme = ?, accent = ? WHERE id = ?", (theme, accent, current_user.id))
        conn.commit()
    return jsonify({"ok": True, "theme": theme, "accent": accent})

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
    with get_db() as conn:
        q = "SELECT * FROM sessions WHERE user_id = ?" if include_breaks \
            else "SELECT * FROM sessions WHERE mode != 'break' AND user_id = ?"
        params = [uid]
        if days > 0:
            cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
            q += " AND date >= ?"
            params.append(cutoff)
        if stype:
            q += " AND type = ?"
            params.append(stype)
        q += " ORDER BY ts DESC"
        rows = conn.execute(q, params).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/sessions", methods=["POST"])
@login_required
def add_session():
    data = request.get_json()
    now  = datetime.now()
    uid = current_user.id
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sessions (user_id,date,hour,time,minutes,type,mode,ts) VALUES (?,?,?,?,?,?,?,?)",
            (
                uid,
                data.get("date", now.strftime("%Y-%m-%d")),
                data.get("hour", now.hour),
                data.get("time", now.strftime("%H:%M")),
                int(data["minutes"]),
                data["type"],
                data["mode"],
                data.get("ts", now.isoformat()),
            )
        )
        conn.commit()
    return jsonify({"ok": True})

@app.route("/api/stats")
@login_required
def get_stats():
    today = datetime.now().strftime("%Y-%m-%d")
    week_cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    uid = current_user.id
    with get_db() as conn:
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
    with get_db() as conn:
        rows = conn.execute("SELECT date,time,hour,minutes,type,mode,ts FROM sessions WHERE mode!='break' AND user_id=? ORDER BY ts DESC", (uid,)).fetchall()
    buf = io.StringIO()
    buf.write("\ufeff")          # BOM para Excel
    w = csv.writer(buf)
    w.writerow(["fecha","hora","hora_num","minutos","tipo","modo","timestamp"])
    w.writerows(rows)
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
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM sessions WHERE user_id=? ORDER BY ts DESC", (uid,)).fetchall()
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
    with get_db() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
        conn.commit()
    return jsonify({"ok": True})

if __name__ == "__main__":
    init_db()
    print("\n  FocusData corriendo en http://127.0.0.1:5000\n")
    app.run(debug=True)
