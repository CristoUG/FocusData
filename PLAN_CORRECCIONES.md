# Plan de correcciones — FocusData

> **Qué es este documento:** un prompt de ejecución. Contiene instrucciones literales,
> ordenadas por fases independientes, para corregir los defectos detectados en la
> auditoría del proyecto sin romper el comportamiento actual.
>
> **Cómo usarlo:** ejecuta las fases **en orden**. Cada fase es desplegable y
> verificable por separado. No pases a la siguiente hasta que la verificación de la
> fase actual pase. Si una instrucción choca con lo que ves en el código, **detente y
> pregunta** en vez de improvisar.

---

## 1. Contexto del proyecto

App Flask + SQLite de seguimiento de estudio (Pomodoro), multiusuario.

| Archivo | Rol | Tamaño |
|---|---|---|
| `app.py` | Backend completo: rutas, API, auth, migraciones | ~550 líneas |
| `static/index.html` | SPA completa: CSS + HTML + JS en un solo archivo | ~1920 líneas |
| `static/login.html` | Pantalla de login/registro | ~437 líneas |
| `wsgi.py` | Entrada WSGI (PythonAnywhere) | 11 líneas |
| `ver_db.py` | Script de inspección de la DB | 22 líneas |

**Patrón de datos clave:** el frontend mantiene una copia de las sesiones en
`localStorage` y calcula **todas** las estadísticas en cliente. `syncSessions()`
(index.html:1868) reconcilia con el backend: descarga el remoto, detecta los
registros que solo existen en local (`localOnly`), los sube, y fusiona. El backend
es la fuente de verdad; `localStorage` es caché + buffer offline.

**Estado actual de la DB (verificado):** 3 usuarios, 5 carpetas, 137 sesiones —
**todas del `user_id = 3`**. Cero filas con `user_id` o `category_id` NULL.
`mode` solo toma 3 valores: `pomodoro` (87), `break` (41), `manual` (9).
`minutes` va de 5 a 60. `time` siempre en formato `HH:MM`. Codificación UTF-8 correcta.

---

## 2. Reglas invariables

Se aplican a **todas** las fases:

1. **No cambiar el esquema de datos existente.** Nada de `DROP`, `RENAME` ni borrado
   de columnas. Solo `CREATE INDEX IF NOT EXISTS` está permitido en la DB.
2. **No romper `syncSessions()`.** La deduplicación depende de que `ts` se conserve
   byte a byte entre cliente y servidor. Cualquier cambio que normalice, trunque o
   reformatee `ts` duplicaría todo el historial.
3. **No añadir dependencias** más allá de `flask` y `flask-login` sin autorización
   explícita. La app corre en PythonAnywhere con recursos limitados.
4. **No introducir un build step.** El frontend es HTML plano servido por
   `send_from_directory`. Sigue siendo un solo archivo sin transpilar.
5. **Preservar la forma de las respuestas JSON.** El frontend consume claves
   concretas (`ok`, `error`, `category_id`, `category_name`, `id`, ...). Se pueden
   **añadir** claves; nunca renombrar ni eliminar las existentes.
6. **Los mensajes de error visibles van en español**, coherentes con los actuales.
7. **Un commit por fase**, con el mensaje indicado al final de cada fase.

---

## 3. Evidencia verificada (por qué estos cambios son seguros)

Estas comprobaciones ya se hicieron sobre el código real. Son la base de las
decisiones de las fases siguientes; **no hace falta repetirlas**, pero sí conocerlas:

- **Los 8 bloques `with get_db() as conn:` que escriben ya llaman a `conn.commit()`
  explícitamente** (líneas 148, 218, 294, 328, 382, 404, 461, 543). Ningún camino
  depende del commit implícito del context manager de `sqlite3`. → Cambiar a
  `closing()` es seguro.
- **`mode` solo vale `pomodoro | break | manual`** en toda la DB. → La lista blanca
  de validación es completa y no rechazará datos históricos.
- **No hay filas con `user_id` NULL ni `category_id` NULL.** → La migración de
  `init_db()` ya se aplicó correctamente; no hay huérfanos que rescatar.
- **`toast()` (index.html:1562) usa `textContent`**, y `renderHeatmap()` solo
  interpola fechas y números generados. → **No** son vectores XSS; no los toques.
- **`login.html` ya muestra `data.error` ante cualquier respuesta no-2xx**
  (login.html:409-412). → El mensaje del límite de intentos (HTTP 429) se mostrará
  solo, sin cambios en el frontend.
- **`catSelectHtml(r)` devuelve HTML**, no texto. → Es la única interpolación de
  `renderLog()` que **NO** debe escaparse.
- **Las llamadas de inicio síncronas (index.html:1581) son
  `renderClock(); updateSideInfo(); renderTypeRecos(); paintAllSliders();`** y se
  ejecutan antes de que resuelva `/api/me`. `updateSideInfo()` y `renderTypeRecos()`
  leen `db`. → Con `db = []` inicial renderizan ceros un instante y `syncSessions()`
  los vuelve a pintar. Es aceptable y no lanza errores.
- **`DELETE /api/sessions/all`, `GET /api/export/csv` y `GET /api/export/json` son
  código muerto**: el frontend nunca los llama.
- **`login.html` tiene `minlength="4"` en el campo de contraseña** (línea 333) y el
  formulario es el mismo para login y registro. → Subir ese atributo a 8 impediría
  entrar a los usuarios existentes con contraseñas cortas. Ver Fase 1.2.

---

## FASE 0 — Pre-vuelo (obligatoria, antes de tocar código)

**Objetivo:** garantizar que ningún dato se pierda en la Fase 3, que reinicia el
`localStorage`.

1. Copia de seguridad de la base de datos:
   ```bash
   cp study.db "study.db.pre-fix-$(date +%Y%m%d)"
   ```
2. Confirma que el árbol de git está limpio (`git status`). Si no, haz commit o stash
   antes de empezar.
3. **Vaciado del buffer local (crítico).** Con el código **actual, sin modificar**,
   abre la app en el navegador e inicia sesión **con cada cuenta que se haya usado en
   ese navegador**. Espera a que la pestaña Historial cargue. Esto fuerza a
   `syncSessions()` a subir al backend cualquier registro que solo exista en
   `localStorage`.
4. Verifica el total y anótalo:
   ```bash
   python ver_db.py
   ```
   **Al terminar la Fase 3, ese número no debe haber bajado.**

> **Por qué:** la Fase 3 cambia la clave de `localStorage`. El blob antiguo se
> archiva (no se borra), pero deja de leerse automáticamente. Si un registro existía
> *solo* en local y nunca se subió, quedaría fuera de las estadísticas. Este paso
> elimina esa posibilidad.

---

## FASE 1 — Backend: fuga de conexiones, validación de entrada e índices

Solo se toca `app.py`. El frontend no cambia.

### 1.1 — Cerrar las conexiones SQLite

**Problema:** `with get_db() as conn:` hace commit/rollback pero **no cierra la
conexión**. Cada request deja una conexión viva hasta que pase el recolector de basura.

**Instrucciones:**

1. Añade el import al inicio de `app.py`, junto a los demás:
   ```python
   from contextlib import closing
   ```
2. Sustituye **las 16 apariciones** de la cadena exacta:
   ```
   with get_db() as conn:
   ```
   por:
   ```
   with closing(get_db()) as conn, conn:
   ```
   (Están en las líneas 60, 80, 206, 231, 250, 281, 305, 323, 338, 395, 421, 445,
   470, 500, 523, 541. Respeta la indentación de cada una.)

**Por qué esta forma exacta y no `with closing(get_db()) as conn:` a secas:** la
doble entrada `..., conn` mantiene el context manager de la conexión, es decir el
commit al salir sin excepción y el rollback al salir con ella. Cambia **solo** el
cierre. Con `closing()` solo, se perdería el rollback automático de `register()`
ante `IntegrityError`.

**Riesgo:** ninguno. Verificado que los 8 caminos de escritura hacen `commit()`
explícito.

### 1.2 — Validar la entrada de las rutas POST

**Problema:** `add_session()` accede a `data["minutes"]`, `data["type"]` y
`data["mode"]` sin `.get()` → un cuerpo incompleto produce `KeyError` → **HTTP 500**.
`register()` y `login()` hacen `request.get_json()` sin `silent=True` → una petición
sin `Content-Type: application/json` produce `AttributeError` → **HTTP 500**.

**Instrucciones:**

1. Junto a `VALID_THEMES` y `HEX_RE` (líneas 259-261), añade las constantes:
   ```python
   # Validación de entrada de sesiones
   VALID_MODES  = {"pomodoro", "break", "manual"}
   DATE_RE      = re.compile(r"^\d{4}-\d{2}-\d{2}$")
   TIME_RE      = re.compile(r"^\d{1,2}:\d{2}$")
   TYPE_MAX     = 40
   TS_MAX       = 40
   MINUTES_MIN  = 1
   MINUTES_MAX  = 600
   USERNAME_MAX = 30
   PASSWORD_MIN = 8
   ```

2. Reemplaza el cuerpo completo de `add_session()` (líneas 439-462) por:
   ```python
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
   ```

3. En `register()` (línea 194), cambia:
   ```python
   data = request.get_json()
   username = data.get("username", "").strip()
   password = data.get("password", "")
   ```
   por:
   ```python
   data = request.get_json(silent=True) or {}
   username = data.get("username").strip() if isinstance(data.get("username"), str) else ""
   password = data.get("password") if isinstance(data.get("password"), str) else ""
   ```
   Y en las validaciones que siguen, añade el tope de longitud de usuario y sube el
   mínimo de contraseña:
   ```python
   if len(username) < 3 or len(username) > USERNAME_MAX:
       return jsonify({"error": f"El usuario debe tener entre 3 y {USERNAME_MAX} caracteres"}), 400
   if len(password) < PASSWORD_MIN:
       return jsonify({"error": f"La contraseña debe tener al menos {PASSWORD_MIN} caracteres"}), 400
   ```

4. En `login()` (línea 226), aplica el mismo saneado de `data`:
   ```python
   data = request.get_json(silent=True) or {}
   username = data.get("username").strip() if isinstance(data.get("username"), str) else ""
   password = data.get("password") if isinstance(data.get("password"), str) else ""
   ```
   **No** apliques `PASSWORD_MIN` aquí.

5. En `update_session()` (línea 390), sustituye el uso directo de
   `data.get("category_id")` por una coerción explícita antes de la consulta:
   ```python
   try:
       cid_req = int(data.get("category_id"))
   except (TypeError, ValueError):
       return jsonify({"error": "Carpeta no válida"}), 400
   ```
   y usa `cid_req` en el `SELECT ... WHERE id = ? AND user_id = ?`.

6. **En `static/login.html`: NO cambies el `minlength="4"`** del campo de contraseña
   (línea 333). El formulario es compartido por login y registro, y subirlo a 8
   impediría entrar a los usuarios existentes. En su lugar, ajústalo dinámicamente
   al alternar de modo: allí donde el script cambia entre login y registro, añade
   ```js
   document.getElementById('password').minLength = (mode === 'register') ? 8 : 4;
   ```
   Si el mínimo del servidor rechaza igualmente una contraseña corta, el mensaje ya
   se muestra correctamente (login.html:409-412), así que este paso es solo UX.

**Análisis de riesgo:**

- ✅ **`PASSWORD_MIN = 8` solo afecta a registros nuevos.** `login()` no valida
  longitud, así que los 3 usuarios existentes (algunos con contraseñas de 4
  caracteres) siguen entrando sin cambios.
- ✅ **La lista blanca de `mode` cubre el 100 % de los datos históricos** (verificado).
- ✅ **`minutes` entre 1 y 600** contiene holgadamente el rango real (5-60).
- ✅ **`TIME_RE` acepta `H:MM` y `HH:MM`** porque el cliente genera la hora con
  `toLocaleTimeString('es', ...)`, cuyo formato puede variar según el navegador.
- ✅ **`ts` no se normaliza, solo se trunca a 40 caracteres.** Los `ts` reales
  (`2026-08-26T14:05:00`, 19 caracteres) no se ven afectados → la deduplicación sigue
  intacta (regla invariable nº 2).
- ⚠️ **Efecto secundario menor:** si un registro antiguo del `localStorage` de algún
  navegador fallara la validación, `syncSessions()` lo reintentaría en cada carga sin
  éxito. Es inofensivo (solo un 400 en consola) y muy improbable dados los rangos
  reales. Se resuelve solo con la Fase 3.

### 1.3 — Índices

**Instrucciones:** dentro de `init_db()`, **inmediatamente antes** de `conn.commit()`
(línea 148), añade:
```python
conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_ts   ON sessions(user_id, ts)")
conn.execute("CREATE INDEX IF NOT EXISTS idx_categories_user    ON categories(user_id)")
```

**Riesgo:** ninguno. `IF NOT EXISTS` es idempotente y `init_db()` ya se ejecuta en
cada arranque.

### Verificación de la Fase 1

```bash
python -c "import app; app.init_db(); print('init_db OK')"
python app.py   # arranca sin errores
```

Con la app corriendo y sesión iniciada, comprueba que estos devuelven **400 y no 500**:

```bash
curl -i -X POST localhost:5000/api/sessions -H 'Content-Type: application/json' -d '{}'
curl -i -X POST localhost:5000/api/register -d 'no-soy-json'
curl -i -X POST localhost:5000/api/login    -d 'no-soy-json'
```

Y que el camino feliz sigue funcionando: inicia un Pomodoro de 5 min en la UI, espera
a que termine y confirma con `python ver_db.py` que la sesión se guardó.

**Commit:** `Backend: cierra conexiones SQLite, valida entrada de la API y añade índices`

---

## FASE 2 — Backend: endurecimiento de la sesión

Solo se toca `app.py` (y una nota en `README.md`).

### 2.1 — Configuración de la cookie de sesión

**Instrucciones:** justo después de `app.secret_key = load_secret_key()` (línea 34),
añade:
```python
# Endurecimiento de la cookie de sesión.
# SECURE se activa por variable de entorno: forzarlo en local (http://) impediría
# el login por completo, porque el navegador no enviaría la cookie.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("FOCUSDATA_HTTPS", "").lower() in ("1", "true", "yes"),
)
```

Y documenta en `README.md`, junto a la nota de `SECRET_KEY`, que en producción
(PythonAnywhere, que sirve por HTTPS) hay que definir además `FOCUSDATA_HTTPS=1`.

**Análisis de riesgo:**

- ✅ `SAMESITE="Lax"` no rompe nada: la app es de un solo origen y el único flujo de
  navegación entre rutas (`/login` → `/`, `/logout` → `/login`) son redirecciones GET
  de nivel superior, que Lax permite.
- ✅ `HTTPONLY=True` no rompe nada: ningún JS del proyecto lee `document.cookie`.
- ⚠️ `SECURE` **debe** quedar desactivado en local. Por eso va detrás de la variable
  de entorno y **no** se activa por defecto.

**Sobre CSRF:** *no* añadas `Flask-WTF` / `CSRFProtect`. Obligaría a inyectar un token
en las 12 llamadas `fetch()` del frontend, con alto riesgo de romper alguna, a cambio
de poco: toda la API muta estado únicamente mediante peticiones con
`Content-Type: application/json`, lo que fuerza un *preflight* CORS y bloquea el
envío cruzado desde otro sitio. `SameSite=Lax` cierra el hueco restante (el
`GET /logout`, que un tercero podría disparar con un `<img src>` para cerrarte la
sesión). Es la relación coste/beneficio correcta para este proyecto.

### 2.2 — Límite de intentos de login

**Problema:** `/api/login` no tiene ningún freno ante fuerza bruta.

**Instrucciones:**

1. Añade `time` a los imports de la línea 5.
2. Antes de la ruta `login()`, añade:
   ```python
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
   ```
3. Dentro de `login()`, tras sanear `data`, añade al principio:
   ```python
   ip = request.remote_addr or "desconocida"
   retry = _login_retry_after(ip)
   if retry:
       return jsonify({"error": f"Demasiados intentos fallidos. Reintenta en {retry} segundos."}), 429
   ```
4. En la rama de credenciales incorrectas, registra el fallo antes de responder:
   ```python
   if not row or not check_password_hash(row["password"], password):
       _record_login_fail(ip)
       return jsonify({"error": "Usuario o contraseña incorrectos"}), 401
   ```
5. Tras un login correcto, limpia el contador:
   ```python
   _login_fails.pop(ip, None)
   ```

**Análisis de riesgo:**

- ✅ **No hace falta tocar el frontend:** `login.html:409-412` ya renderiza
  `data.error` ante cualquier respuesta no-2xx, así que el mensaje del 429 se muestra
  tal cual (verificado).
- ✅ 8 fallos en 5 minutos es holgado para un humano que se equivoca.
- ⚠️ **Limitación asumida y documentada:** el contador es por proceso. Con varios
  workers en PythonAnywhere, el límite efectivo se multiplica por el nº de workers.
  Sigue frenando la fuerza bruta automatizada, que es el objetivo.

### 2.3 — Exponer el `id` de usuario en `/api/me`

**Necesario para la Fase 3.** En `me()` (línea 247), añade `"id": current_user.id`
como primera clave del `jsonify`. **No elimines ni renombres ninguna clave existente.**

### Verificación de la Fase 2

1. `curl -s localhost:5000/api/me` con sesión iniciada → el JSON incluye `id`.
2. Falla el login 9 veces seguidas con una contraseña incorrecta → la novena responde
   429 y la pantalla muestra "Demasiados intentos fallidos...".
3. Acierta el login → entra con normalidad y el contador se reinicia.
4. **Sin** definir `FOCUSDATA_HTTPS`, el login en `http://127.0.0.1:5000` sigue
   funcionando. (Si esto falla, `SESSION_COOKIE_SECURE` quedó activo por error.)

**Commit:** `Backend: cookie de sesión endurecida y freno de fuerza bruta en el login`

---

## FASE 3 — Frontend: aislar el localStorage por usuario

**El defecto más grave. Depende de la Fase 2.3.** Solo se toca `static/index.html`.

**Problema:** `STORAGE_KEY = 'studylog_v1'` (index.html:902) es global y `/logout` no
limpia nada. Si el usuario A cierra sesión y entra el usuario B en el mismo
navegador, B ve las sesiones de A en sus estadísticas y —peor— `syncSessions()` las
detecta como `localOnly` y **las sube al backend como sesiones de B**, contaminando la
base de datos de forma permanente.

**Instrucciones:**

1. Reemplaza las líneas 902-904:
   ```js
   const STORAGE_KEY = 'studylog_v1';
   let db = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
   const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
   ```
   por:
   ```js
   // El historial en caché se guarda bajo una clave propia de cada usuario: compartir
   // una clave global filtraba las sesiones de una cuenta a otra en el mismo navegador
   // (y syncSessions() acababa subiéndolas a la cuenta equivocada).
   const LEGACY_STORAGE_KEY = 'studylog_v1';
   let storageKey = null;          // se resuelve al conocer el id del usuario
   let db = [];
   const save = () => {
     if (storageKey) localStorage.setItem(storageKey, JSON.stringify(db));
   };

   function initStorage(uid) {
     storageKey = `studylog_v1_u${uid}`;
     const own = localStorage.getItem(storageKey);
     if (own !== null) {
       try { db = JSON.parse(own) || []; } catch { db = []; }
       return;
     }
     // Primera carga con clave por usuario. El blob antiguo era de propiedad
     // ambigua, así que no se importa: se archiva por si hiciera falta rescatarlo
     // a mano y se deja que syncSessions() repueble desde el backend.
     const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
     if (legacy !== null) {
       localStorage.setItem('studylog_v1_backup', legacy);
       localStorage.removeItem(LEGACY_STORAGE_KEY);
     }
     db = [];
   }
   ```

2. En el bloque de arranque `fetch('/api/me')` (líneas 1902-1918), llama a
   `initStorage()` **antes** de `loadCategories()` y `syncSessions()`:
   ```js
   }).then(data => {
     if (data && data.username) {
       initStorage(data.id);          // ← primero: fija storageKey y carga la caché
       document.getElementById('user-display').textContent = data.username;
       ...
       loadCategories();
       syncSessions();
     }
   })
   ```
   El resto del bloque no cambia.

3. **No toques** ninguna otra llamada a `save()` (líneas 1162, 1551, 1751, 1830, 1892):
   siguen funcionando igual, ahora protegidas por la guarda de `storageKey`.

**Análisis de riesgo:**

- ✅ **`db` pasa a inicializarse vacío y se llena de forma asíncrona.** Las llamadas
  síncronas de arranque (`renderClock(); updateSideInfo(); renderTypeRecos();
  paintAllSliders();`, línea 1581) leen `db`, pero con `[]` renderizan ceros sin
  lanzar errores; `syncSessions()` las vuelve a invocar al terminar (verificado en
  index.html:1893-1895).
- ✅ **`save()` no escribe hasta que `storageKey` esté resuelto.** Sin la guarda,
  cualquier escritura anterior a `/api/me` iría a la clave literal `"null"`.
- ✅ **No hay pérdida de datos:** el backend tiene las 137 sesiones y la Fase 0 forzó
  la subida de cualquier registro pendiente. Además, el blob antiguo queda archivado
  en `studylog_v1_backup`, recuperable a mano desde la consola del navegador.
- ✅ **No se importa el blob antiguo automáticamente**, y es deliberado: su propiedad
  es exactamente lo que estaba mal definido. Importarlo reintroduciría el fallo una
  última vez, en la cuenta que entrase primero.

### Verificación de la Fase 3

1. `python ver_db.py` → el total sigue siendo **≥** el anotado en la Fase 0.
2. Entra con la cuenta principal → tras un instante, el historial y las estadísticas
   se ven completos (repoblados desde el backend).
3. En DevTools → Application → Local Storage: existe `studylog_v1_u<id>` y ya **no**
   existe `studylog_v1`.
4. **Prueba del defecto:** cierra sesión, entra con una cuenta distinta. Su historial
   debe estar **vacío**. Cierra sesión, vuelve a la primera cuenta: su historial sigue
   intacto.
5. `python ver_db.py` una vez más → el total **no ha subido**. (Si subió, alguna
   sesión se re-subió a la cuenta equivocada: revierte y revisa.)

**Commit:** `Frontend: caché de historial aislada por usuario en localStorage`

---

## FASE 4 — Frontend: escapar HTML en las interpolaciones

Solo se toca `static/index.html`.

**Problema:** los nombres de tipo de sesión y de carpeta son texto libre del usuario y
se inyectan sin escapar en plantillas `innerHTML`.

**Instrucciones:**

1. Justo después del bloque de `initStorage`, añade el helper:
   ```js
   // Escapa texto de usuario antes de interpolarlo en plantillas innerHTML.
   const esc = s => String(s ?? '').replace(/[&<>"']/g,
     c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
   ```

2. Aplica `esc()` en **exactamente** estos puntos:

   | Línea aprox. | Función | Cambio |
   |---|---|---|
   | 1397 | `renderTypeBreakdown` (leyenda del donut) | `${t}` → `${esc(t)}` |
   | 1403 | `renderTypeBreakdown` (etiqueta de barra) | `${t}` → `${esc(t)}` |
   | 1528 | `catSelectHtml` (`<option>`) | `${c.name}` → `${esc(c.name)}` |
   | 1530 | `catSelectHtml` (`onchange`) | `reassignSession('${r.ts}'` → `reassignSession('${esc(r.ts)}'` |
   | 1544 | `renderLog` (fila de la tabla) | `${r.type}` → `${esc(r.type)}` y el **texto** del badge `${r.mode}` → `${esc(r.mode)}` |
   | 1681 | `renderCategoryUI` (filtro global) | `${c.name}` → `${esc(c.name)}` |
   | 1689 | `renderCategoryUI` (select de carpeta activa) | `${c.name}` → `${esc(c.name)}` |
   | 1705 | `renderCategoryUI` (lista de ajustes) | `${c.name}` → `${esc(c.name)}` y `background:${c.color}` → `background:${esc(c.color)}` |

3. **NO escapes** (verificado: romperías la UI o no aporta nada):
   - `${catSelectHtml(r)}` en la línea 1544 — **devuelve HTML**; escaparlo mostraría
     las etiquetas como texto plano.
   - `renderHeatmap()` (1339-1360) — solo interpola fechas y números generados.
   - `toast()` (1562) — ya usa `textContent`.
   - `${c.id}`, `${r.minutes}`, `${peakH}`, los porcentajes y los anchos `width:` —
     son números.
   - `badge-${r.mode}` en el atributo `class` — `mode` queda validado contra lista
     blanca en el servidor tras la Fase 1.

**Análisis de riesgo:** `esc()` solo transforma 5 caracteres. Los tipos y carpetas
reales (`Ayudantía Programación`, `Cálculo`, `Semestre 1`...) no contienen ninguno, así
que la UI se ve idéntica. El alcance del fallo era limitado (cada usuario solo ve sus
propios datos), pero el vector queda cerrado.

### Verificación de la Fase 4

Crea una carpeta llamada `<img src=x onerror=alert(1)>` y registra una sesión manual
con ese mismo tipo. En Historial, Estadísticas y Ajustes debe verse **el texto
literal**, sin ningún `alert`. Bórralas después.

**Commit:** `Frontend: escapa nombres de tipo y carpeta en las plantillas HTML`

---

## FASE 5 — Frontend: corregir el filtro de días del historial

Solo se toca `static/index.html`.

**Problema:** `renderLog()` (línea 1533) filtra con `new Date(r.date)`, y JavaScript
parsea `YYYY-MM-DD` como **UTC**, no como hora local. En Chile (UTC-4/-3) el filtro
"últimos N días" descarta un día de más en el borde. Es justo lo que los helpers
`localDateStr` / `localISOString` evitan con cuidado en el resto del archivo.

**Instrucciones:** sustituye la línea:
```js
if (filterDays > 0) { const cutoff = new Date(today); cutoff.setDate(today.getDate()-filterDays); recs = recs.filter(r => new Date(r.date) >= cutoff); }
```
por:
```js
if (filterDays > 0) {
  // Comparación como cadena YYYY-MM-DD: evita el desfase de new Date(), que
  // interpreta ese formato como UTC en vez de hora local.
  const cutoff = new Date(today);
  cutoff.setDate(today.getDate() - filterDays);
  const cutoffStr = localDateStr(cutoff);
  recs = recs.filter(r => r.date >= cutoffStr);
}
```

**Análisis de riesgo:** ninguno. El formato `YYYY-MM-DD` con relleno de ceros ordena
lexicográficamente igual que cronológicamente, y `localDateStr()` ya existe y se usa en
todo el archivo. `today` sigue declarada y usada más arriba en la misma función.

### Verificación de la Fase 5

Con el filtro en "Últimos 7 días", cuenta las sesiones mostradas y compáralas con las
de los últimos 7 días naturales. Presta atención al registro más antiguo del borde: ya
no debe desaparecer.

**Commit:** `Frontend: corrige el desfase de zona horaria del filtro de días`

---

## FASE 6 — Reconectar el código muerto del backend

Tres endpoints del backend nunca se llaman desde el frontend, y las funciones que los
sustituyen tienen defectos.

### 6.1 — "Limpiar" no borra nada en el servidor

**Problema:** `clearLog()` (index.html:1549) avisa *"Esto no se puede deshacer"*, pero
solo vacía `localStorage`. `DELETE /api/sessions/all` existe y no se usa nunca: en la
siguiente carga, `syncSessions()` vuelve a descargar todo del backend y los registros
"borrados" reaparecen.

**Instrucciones:** reemplaza `clearLog()` por:
```js
function clearLog() {
  if (!confirm('¿Borrar todos los registros? Esto no se puede deshacer.')) return;
  fetch('/api/sessions/all', { method: 'DELETE' })
    .then(r => r.json())
    .then(d => {
      if (!d.ok) { toast('No se pudieron borrar los registros'); return; }
      db = []; save();
      renderLog(); updateSideInfo(); renderTypeRecos();
      if (document.getElementById('tab-stats').classList.contains('active')) renderStats();
      toast('Registros eliminados');
    })
    .catch(() => toast('Error de conexión'));
}
```

**Riesgo:** el botón pasa a borrar de verdad, que es lo que su texto ya prometía. El
`confirm()` sigue delante. **Avisa al usuario de este cambio de comportamiento antes de
desplegarlo.**

### 6.2 — Exportación CSV mal formada

**Problema:** `exportCSV()` (index.html:1554) construye el CSV con `r.join(',')`, sin
comillas ni escapado: cualquier tipo de sesión que contenga una coma parte la fila. No
lleva BOM, así que Excel muestra los acentos rotos. `GET /api/export/csv` ya hace las
dos cosas bien (usa `csv.writer` y escribe `﻿`) y nunca se llama.

**Instrucciones:** reemplaza el cuerpo de `exportCSV()` por:
```js
function exportCSV() {
  // El backend genera el CSV con escapado correcto y BOM para Excel.
  window.location.href = '/api/export/csv';
  toast('CSV exportado ✓');
}
```

**Riesgo asumido y aceptable:** el endpoint del backend **ignora el filtro global de
carpeta** y exporta todas las sesiones del usuario (excluyendo los descansos, igual que
la vista actual). Es un cambio de comportamiento menor a cambio de un archivo correcto.
Si prefieres conservar el filtro, la alternativa es añadir un parámetro `?category_id=`
a `export_csv()` en `app.py` y pasarlo desde el frontend — hazlo solo si te lo piden
explícitamente.

### 6.3 — Protección anti-inyección CSV (backend)

**Problema:** un tipo de sesión que empiece por `=`, `+`, `-` o `@` es interpretado
como fórmula al abrir el CSV en Excel.

**Instrucciones:** en `export_csv()` (app.py:496), antes de `w.writerows(rows)`, añade:
```python
def _csv_safe(v):
    """Neutraliza la inyección de fórmulas al abrir el CSV en Excel/Sheets."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s
```
y sustituye `w.writerows(rows)` por:
```python
w.writerows([[_csv_safe(v) for v in row] for row in rows])
```

### Verificación de la Fase 6

1. Exporta el CSV desde el botón del Historial → se descarga
   `estudio_AAAA-MM-DD.csv`, se abre en Excel **con los acentos correctos** y cada
   sesión ocupa exactamente una fila.
2. Con una cuenta de prueba desechable (**nunca la principal**): pulsa "Limpiar",
   confirma, recarga la página → el historial sigue vacío. Comprueba con
   `python ver_db.py` que las filas de esa cuenta desaparecieron.

**Commit:** `Reconecta los endpoints de borrado y exportación; protege el CSV de inyección de fórmulas`

---

## FASE 7 — Higiene del repositorio (opcional)

1. `static/index.html` carga Chart.js desde `cdnjs` sin atributo de integridad, y la
   app deja de funcionar sin internet. Opciones: añadir `integrity` +
   `crossorigin="anonymous"` con el hash SRI oficial de la versión 4.4.1 (mínimo), o
   descargar el archivo a `static/vendor/chart.umd.js` y servirlo local (mejor, y
   arregla además el uso sin conexión).
2. `study.db.bak` está en la raíz del proyecto. Muévelo fuera del repositorio o
   bórralo (ya está cubierto por `.gitignore`, así que nunca se subió).
3. `DOCUMENTACION.pdf` ocupa 887 KB y **sí está versionado**, junto a su fuente
   `DOCUMENTACION.md`. Considera dejar solo el `.md` y generar el PDF cuando haga falta.
4. No hay ni un solo test. Un `tests/test_api.py` con `pytest` y el cliente de pruebas
   de Flask cubriría en unas 80 líneas los caminos críticos: registro, login,
   aislamiento entre usuarios (que A no vea las sesiones de B) y los 400 de validación
   de la Fase 1. Es la mejor inversión pendiente del proyecto.

---

## Checklist final de regresión

Ejecútalo completo tras la última fase, con una sesión iniciada:

- [ ] Login y registro funcionan; un login fallido muestra el mensaje de error.
- [ ] Un Pomodoro completo registra la sesión y aparece en el Historial.
- [ ] Un descanso se registra pero **no** suma en las estadísticas.
- [ ] "Registrar sesión manual" funciona y valida los minutos vacíos.
- [ ] Crear, renombrar, archivar y restaurar carpetas funciona.
- [ ] No se puede archivar la única carpeta activa (sigue devolviendo 400).
- [ ] El filtro global de carpeta cambia estadísticas e historial a la vez.
- [ ] Reasignar una sesión a otra carpeta desde el Historial funciona.
- [ ] Los 4 temas y el color de acento se guardan y sobreviven a una recarga.
- [ ] Los gráficos (semana, donut, horas, heatmap) se pintan con datos reales.
- [ ] Exportar CSV produce un archivo bien formado.
- [ ] Cerrar sesión y entrar con otra cuenta **no** muestra datos de la anterior.
- [ ] `python ver_db.py` → el total de registros coincide con lo esperado.

---

## Fuera de alcance

No hagas nada de esto sin pedirlo explícitamente:

- Migrar a `templates/` o a un framework de frontend.
- Dividir `index.html` en archivos separados de CSS/JS.
- Añadir CSRF con `Flask-WTF` (ver el razonamiento en la Fase 2.1).
- Cambiar SQLite por otro motor de base de datos.
- Rediseñar la interfaz.
- Añadir borrado de sesiones individuales o de carpetas (son **funcionalidades
  nuevas**, no correcciones de defectos).
