# FocusData — Flask + SQLite

App web para registrar tus sesiones de estudio con temporizador Pomodoro configurable.
Incluye **autenticación de usuarios** (registro / login) con Flask-Login, de modo que cada usuario ve solo sus propias sesiones.

**Funciones principales**
- Temporizador Pomodoro configurable con tipos de estudio 100% manuales y recomendaciones de los 3 tipos más usados.
- **Carpetas de sesiones** (ej. "Semestre 1", "Trabajo"): cada sesión pertenece a una carpeta; se gestionan desde Ajustes (crear, renombrar, archivar, color) y un filtro global en el header focaliza todas las estadísticas y el historial en una sola carpeta.
- Sincronización del historial con el backend (SQLite) para no perder datos entre dispositivos.
- Personalización de apariencia por usuario: 4 temas (`dark`, `light`, `ocean`, `forest`) y color de acento.
- Estadísticas avanzadas: racha actual/máxima, índice de regularidad semanal (IRS), ratio de descanso activo (RDA), enfoque Pomodoro, heatmap de consistencia, radar de balance temático, tendencia de 7 días y densidad por hora (0–23).

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
study_tracker/
├── app.py              ← Backend Flask + rutas API + autenticación
├── wsgi.py             ← Punto de entrada WSGI (PythonAnywhere)
├── ver_db.py           ← Script para inspeccionar la base de datos
├── study.db            ← Base de datos SQLite (se crea automáticamente)
├── requirements.txt
└── static/
    ├── index.html      ← Interfaz principal (requiere login)
    └── login.html      ← Pantalla de registro / inicio de sesión
```

> Los HTML se sirven directamente desde `static/` con `send_from_directory` (no se usa la carpeta `templates/`).

## API endpoints

### Autenticación
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/login` | Pantalla de registro / inicio de sesión |
| POST | `/api/register` | Crear cuenta (inicia sesión automáticamente) |
| POST | `/api/login` | Iniciar sesión |
| GET | `/logout` | Cerrar sesión |
| GET | `/api/me` | Datos del usuario actual (incluye `theme`, `accent` y `active_category_id`) |
| POST | `/api/preferences` | Guardar preferencias (parcial: `theme`, `accent` y/o `active_category_id`) |

### Carpetas _(requieren login)_
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/categories` | Listar carpetas del usuario (incluye archivadas) |
| POST | `/api/categories` | Crear carpeta: `{name, color?}` |
| PATCH | `/api/categories/<id>` | Actualizar carpeta (parcial: `name`, `color`, `archived`) |
| PATCH | `/api/sessions/<id>` | Mover una sesión a otra carpeta: `{category_id}` |

### Sesiones de estudio _(requieren login)_
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/` | Interfaz web |
| GET | `/api/sessions` | Listar sesiones. Parámetros: `?days=7`, `?type=Matemáticas`, `?include_breaks=1` (incluir descansos, necesario para el RDA) |
| POST | `/api/sessions` | Guardar sesión (estudio `pomodoro`/`manual` o descanso `break`) |
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
| accent | TEXT | Color de acento (`#6366f1` por defecto) |
| active_category_id | INTEGER | Carpeta activa donde se registran las nuevas sesiones (FK → `categories.id`) |

### Tabla `categories`

| Columna | Tipo | Descripción |
|---------|------|-------------|
| id | INTEGER | Clave primaria |
| user_id | INTEGER | Usuario propietario (FK → `users.id`) |
| name | TEXT | Nombre de la carpeta (único por usuario) |
| color | TEXT | Color de la carpeta (`#6366f1` por defecto) |
| archived | INTEGER | 1 si está archivada (no aparece en selectores de registro) |

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
| mode | TEXT | `pomodoro` / `manual` / `break` |
| ts | TEXT | Timestamp ISO completo (clave de deduplicación en la sincronización) |
| category_id | INTEGER | Carpeta de la sesión (FK → `categories.id`) |

> **Migraciones automáticas:** al arrancar, `init_db()` añade las columnas que falten en bases de datos antiguas (`users.theme`, `users.accent`, `sessions.user_id`, `sessions.category_id`, `users.active_category_id`). Los usuarios existentes sin carpetas reciben una llamada **"Semestre 1"** con todas sus sesiones asignadas. No requiere intervención manual.
