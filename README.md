# FocusData — Flask + SQLite

App web para registrar tus sesiones de estudio con temporizador Pomodoro configurable.
Incluye **autenticación de usuarios** (registro / login) con Flask-Login, de modo que cada usuario ve solo sus propias sesiones.

**Funciones principales**
- Tres formas de registrar: **Pomodoro** configurable, **Cronómetro** libre que cuenta hacia adelante y **sesión manual**, con tipos de estudio 100% manuales y recomendaciones de los 3 tipos más usados.
- **Carpetas de sesiones con subcarpetas anidadas** (ej. "Semestre 1 › Cálculo › Unidad 1", hasta 10 niveles): cada sesión pertenece a una carpeta; se gestionan desde la vista Carpetas (crear, renombrar, mover, archivar en cascada, eliminar, color) y un filtro global en el header focaliza las estadísticas y el historial en una carpeta **y todas sus descendientes**.
- Sincronización del historial con el backend (SQLite) para no perder datos entre dispositivos.
- Diseño inspirado en Copilot / Fluent: barra lateral plegable con carpetas y sesiones recientes, menús desplegables, modo claro y oscuro, y color de acento.
- **Escenas de fondo** (Carretera, Cerezos, Atardecer, Océano, Bosque, Nebulosa o ninguna) y **fondos propios**: cada usuario puede subir hasta 6 imágenes, que se guardan en su cuenta.
- **Música de concentración**: Lo-fi y Ambiente (música generativa), Lluvia, Bosque, Olas, Chimenea y Ruido marrón, generados en el navegador con Web Audio, más pistas propias opcionales. Se puede sincronizar con el temporizador para que suene solo mientras trabajas.
- **Notificaciones** al terminar cada pomodoro y cada descanso (se eligen por separado en Configuración). En Chrome y Edge incluyen un botón para empezar la siguiente fase sin volver a la app.
- Estadísticas avanzadas: racha actual/máxima, índice de regularidad semanal (IRS), ratio de descanso activo (RDA), enfoque Pomodoro, calendario de consistencia, distribución por tema, últimos 7 días y densidad por hora (0–23).

## Instalación

```bash
# 1. Crear entorno virtual (recomendado)
python -m venv venv
#source venv/bin/activate        # Mac/Linux
venv\Scripts\activate           # Windows

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Ejecutar
python app.py
```

Abre **http://127.0.0.1:5000** en tu navegador. La app te redirige a `/login` si no has iniciado sesión.

> **Producción:** define la variable de entorno `SECRET_KEY` con un valor secreto propio.
> El valor por defecto en `app.py` es solo para desarrollo y **no** debe usarse en el servidor real.
> En producción (PythonAnywhere, que sirve por HTTPS) define además `FOCUSDATA_HTTPS=1` para asegurar las cookies de sesión con el atributo `Secure`.

## Estructura

```
FocusData/
├── app.py              ← Backend Flask + rutas API + autenticación
├── wsgi.py             ← Punto de entrada WSGI (PythonAnywhere)
├── ver_db.py           ← Script para inspeccionar la base de datos
├── study.db            ← Base de datos SQLite (se crea automáticamente)
├── requirements.txt    ← Dependencias de producción (flask, flask-login)
├── requirements-dev.txt ← Dependencias de desarrollo (pytest)
├── tests/test_api.py   ← 63 tests de la API (base de datos temporal por test)
├── uploads/            ← Fondos subidos por los usuarios (se crea sola; no se versiona)
└── static/
    ├── index.html      ← Interfaz principal (requiere login)
    ├── login.html      ← Pantalla de registro / inicio de sesión
    ├── sw.js           ← Service worker mínimo de las notificaciones (no guarda caché)
    ├── css/            ← tokens.css (tema) y app.css (interfaz)
    ├── js/             ← Módulos ES: app, store, util, ui, timer, metrics, stats, log, folders, settings, scenes, music, notifications (13 en total)
    ├── img/icons.svg   ← Iconos Fluent UI System Icons (MIT)
    ├── scenes/         ← Fotos de las escenas del catálogo (ver su README)
    └── music/          ← Pistas de música opcionales y tracks.json (ver su README)
```

> Los HTML se sirven directamente desde `static/` con `send_from_directory` (no se usa la carpeta `templates/`).
> El frontend no necesita compilación: los módulos `static/js/*.js` se cargan con `<script type="module">`.

## API endpoints

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/login` | Pantalla de registro / inicio de sesión |
| POST | `/api/register` | Crear cuenta (inicia sesión automáticamente) |
| POST | `/api/login` | Iniciar sesión |
| GET | `/logout` | Cerrar sesión |
| GET | `/api/me` | Datos del usuario actual (incluye `theme`, `accent`, `scene` y `active_category_id`) |
| POST | `/api/preferences` | Guardar preferencias (parcial: `theme`, `accent`, `scene` y/o `active_category_id`). `scene` es un id del catálogo o `bg:<id>` de un fondo propio |

### Fondos propios _(requieren login)_
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/backgrounds` | Listar los fondos del usuario (`id`, `name`, `colors`, `url`, `thumb_url`) |
| POST | `/api/backgrounds` | Subir un fondo (multipart: `file`, `thumb` opcional, `name`, `colors`). JPG/PNG/WebP, hasta 4 MB y 6 fondos por usuario |
| GET | `/api/backgrounds/<id>/image` | Imagen del fondo (`?size=thumb` para la miniatura). Solo para su dueño |
| DELETE | `/api/backgrounds/<id>` | Eliminar un fondo; si estaba en uso, la escena vuelve a la de por defecto |

### Carpetas _(requieren login)_
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/categories` | Listar carpetas del usuario en **preorden**, con `parent_id`, `depth` y `path` (incluye archivadas) |
| POST | `/api/categories` | Crear carpeta o subcarpeta: `{name, color?, parent_id?}` (`parent_id: 0` = raíz) |
| PATCH | `/api/categories/<id>` | Actualizar carpeta (parcial: `name`, `color`, `parent_id`, `archived`). Archivar baja en cascada; restaurar sube a los ancestros |
| DELETE | `/api/categories/<id>` | Eliminar la carpeta y todo su subárbol: `{content: "move", target_id}` mueve sus sesiones, `{content: "delete"}` las borra |
| PATCH | `/api/sessions/<id>` | Mover una sesión a otra carpeta: `{category_id}` |

### Sesiones de estudio _(requieren login)_
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Interfaz web |
| GET | `/api/sessions` | Listar sesiones. Parámetros: `?days=7`, `?type=Matemáticas`, `?include_breaks=1` (incluir descansos, necesario para el RDA) |
| POST | `/api/sessions` | Guardar sesión (estudio `pomodoro`/`manual`/`cronometro` o descanso `break`) |
| GET | `/api/stats` | Estadísticas del backend (totales, por día, por tipo) |
| GET | `/api/export/csv` | Descargar CSV |
| GET | `/api/export/json` | Descargar JSON |
| DELETE | `/api/sessions/all` | Borrar todas las sesiones del usuario |

> Nota: las estadísticas de la interfaz se calculan en el cliente a partir del historial sincronizado; `/api/stats` es un endpoint alternativo del backend.

## Base de datos (SQLite)

### Tabla `users`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | INTEGER | Clave primaria |
| username | TEXT | Nombre de usuario (único) |
| password | TEXT | Hash de la contraseña (Werkzeug) |
| theme | TEXT | Tema de la interfaz (`dark` por defecto) |
| accent | TEXT | Color de acento (`#3b82f6` por defecto) |
| scene | TEXT | Escena de fondo (`road` por defecto) o `bg:<id>` de un fondo propio |
| active_category_id | INTEGER | Carpeta activa donde se registran las nuevas sesiones (FK → `categories.id`) |

### Tabla `categories`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | INTEGER | Clave primaria |
| user_id | INTEGER | Usuario propietario (FK → `users.id`) |
| parent_id | INTEGER | Carpeta padre. **`0` = raíz**, no `NULL` (en SQLite los `NULL` se comparan como distintos y el `UNIQUE` dejaría pasar raíces duplicadas) |
| name | TEXT | Nombre de la carpeta, 1–30 caracteres (único por usuario **y nivel**) |
| color | TEXT | Color de la carpeta (`#6366f1` por defecto) |
| archived | INTEGER | 1 si está archivada (no aparece en selectores de registro) |

> `UNIQUE(user_id, parent_id, name)`: dos carpetas pueden llamarse igual si cuelgan de padres distintos. Profundidad máxima: **10 niveles**.

### Tabla `sessions`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | INTEGER | Clave primaria |
| user_id | INTEGER | Usuario propietario (FK → `users.id`) |
| date | TEXT | Fecha (YYYY-MM-DD) |
| hour | INTEGER | Hora del día (0-23) |
| time | TEXT | Hora formateada (HH:MM) |
| minutes | INTEGER | Duración en minutos |
| type | TEXT | Tipo de estudio |
| mode | TEXT | `pomodoro` / `manual` / `cronometro` / `break` |
| ts | TEXT | Timestamp ISO completo (clave de deduplicación en la sincronización) |
| category_id | INTEGER | Carpeta de la sesión (FK → `categories.id`) |

### Tabla `backgrounds`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | INTEGER | Clave primaria |
| user_id | INTEGER | Usuario propietario (FK → `users.id`) |
| name | TEXT | Nombre del fondo (hasta 40 caracteres) |
| file | TEXT | Archivo en `uploads/backgrounds/<user_id>/` (fuera de `static/`) |
| thumb | TEXT | Archivo de la miniatura (cadena vacía si no hay) |
| colors | TEXT | JSON con hasta 3 colores dominantes, para teñir el anillo y la marca |
| created_at | TEXT | Fecha de subida |

### Tabla `migrations`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| name | TEXT | Clave primaria: nombre de la migración de datos ya aplicada |
| applied_at | TEXT | Cuándo se aplicó |

### Índices

```sql
idx_sessions_user_date  ON sessions(user_id, date)
idx_sessions_user_ts    ON sessions(user_id, ts)
idx_categories_user     ON categories(user_id)
idx_categories_parent   ON categories(parent_id)
idx_backgrounds_user    ON backgrounds(user_id)
```

> **Migraciones automáticas:** al arrancar, `init_db()` añade las columnas que falten en bases de datos antiguas (`users.theme`, `users.accent`, `users.scene`, `sessions.user_id`, `sessions.category_id`, `users.active_category_id`) y reconstruye `categories` para añadir `parent_id` y cambiar `UNIQUE(user_id, name)` por `UNIQUE(user_id, parent_id, name)` (SQLite no permite alterar una restricción de tabla con `ALTER`). Los usuarios existentes sin carpetas reciben una llamada **"Semestre 1"** con todas sus sesiones asignadas; las cuentas **nuevas** empiezan con una carpeta **"General"**. No requiere intervención manual. Las migraciones de datos que solo deben aplicarse una vez (por ejemplo, pasar a modo oscuro las cuentas que tenían el claro) quedan registradas en la tabla `migrations` para no repetirse.

## Tests

```bash
pip install -r requirements-dev.txt
pytest                                # 63 tests, cada uno con su base de datos temporal
```

> Para la explicación extendida de la arquitectura y de cada archivo, ver [`DOCUMENTACION.md`](DOCUMENTACION.md).
