# 📚 Documentación del proyecto — FocusData

> Guía completa para entender la arquitectura, el stack y **qué hace cada archivo** del proyecto.
> Pensada para que cualquier persona (o tú mismo en el futuro) pueda situarse rápido.
>
> **Estado:** al día con el commit `7145e1a` (15 de septiembre de 2026).
> La fuente de verdad última siempre es el código: `app.py` para el backend y
> `static/js/` para el frontend.

---

## 1. ¿Qué es FocusData?

Aplicación web para **registrar y analizar sesiones de estudio o trabajo**. Ofrece un
temporizador Pomodoro configurable, un cronómetro libre y el registro manual de sesiones.
Cada usuario tiene su cuenta, ve solo sus datos, organiza el tiempo en **carpetas
anidadas**, personaliza la apariencia (tema, acento, escena de fondo y fondos propios),
escucha **música de concentración** generada en el navegador, recibe **notificaciones** al
terminar cada fase y consulta **estadísticas avanzadas** (rachas, regularidad, calendario
de consistencia, distribución por tema, densidad horaria).

Es un proyecto **full-stack minimalista**: un backend Flask + SQLite en un solo archivo y
un frontend de módulos ES nativos, **sin frameworks de JavaScript y sin proceso de build**.

---

## 2. Stack tecnológico

### Backend
| Tecnología | Rol |
|---|---|
| **Python 3** | Lenguaje del servidor |
| **Flask ≥ 3.0** | Framework web: rutas, API REST, servir archivos estáticos |
| **Flask-Login ≥ 0.6** | Sesiones de usuario, protección de rutas (`@login_required`) |
| **Werkzeug** | Hash seguro de contraseñas (`generate_password_hash` / `check_password_hash`) |
| **SQLite 3** | Base de datos embebida (módulo `sqlite3` de la stdlib, sin servidor aparte) |
| **WSGI** | Interfaz de despliegue (PythonAnywhere, vía `wsgi.py`) |
| **pytest ≥ 8** | Suite de tests de la API (solo desarrollo, `requirements-dev.txt`) |

Solo hay **dos dependencias de producción**: `flask` y `flask-login`.

### Frontend
| Tecnología | Rol |
|---|---|
| **HTML5 / CSS3** | Estructura y estilos: variables CSS (`tokens.css`), tema claro y oscuro |
| **JavaScript (ES6+) vanilla** | Toda la lógica de cliente, repartida en **14 módulos ES** sin bundler |
| **SVG generado a mano** | **Todos** los gráficos (columnas, dona, calendario, anillo del reloj). No se usa ninguna librería de charts |
| **Web Audio API** | Música de concentración **sintetizada en el navegador** (`music.js`), sin archivos de audio |
| **Notifications API + Service Worker** | Avisos de fin de fase, incluso con la app en segundo plano (`notifications.js`, `sw.js`) |
| **localStorage** | Caché del historial, preferencias locales y apariencia en caché |
| **Fluent UI System Icons** (sprite local) | Iconografía en `static/img/icons.svg` (MIT), sin CDN |
| **Google Fonts — Open Sans** (CDN) | Tipografía |

> **No hay Node/npm/bundler en ninguna parte.** El frontend son archivos estáticos que
> Flask entrega tal cual, cargados con `<script type="module">`.
> La **única** dependencia externa por CDN es Google Fonts: sin conexión la app sigue
> funcionando entera, solo cambia la tipografía.

---

## 3. Arquitectura general

```
┌────────────────────────────────────┐      HTTP / JSON      ┌──────────────────────────┐
│             NAVEGADOR              │ ────────────────────► │      FLASK (app.py)      │
│  static/index.html + static/js/*   │                       │                          │
│  · Timer / Cronómetro / Manual     │  POST /api/sessions   │  · Autenticación         │
│  · Cálculo de métricas             │  GET  /api/sessions   │  · API REST              │
│  · Gráficos SVG                    │  GET  /api/categories │  · Árbol de carpetas     │
│  · Música (Web Audio)              │  POST /api/preferences│  · Fondos subidos        │
│  · Notificaciones (sw.js)          │ ◄──────────────────── │  · Migraciones de BD     │
│  · localStorage (caché)            │      respuestas       │                          │
└────────────────────────────────────┘                       └───────────┬──────────────┘
                                                                         │ sqlite3
                                        ┌────────────────────────────────┴──────────────┐
                                        ▼                                               ▼
                             ┌──────────────────────┐              ┌─────────────────────────────┐
                             │      study.db        │              │ uploads/backgrounds/<uid>/  │
                             │ users · sessions     │              │  fondos propios (imágenes)  │
                             │ categories           │              │  fuera de /static: se       │
                             │ backgrounds          │              │  sirven con login           │
                             │ migrations           │              └─────────────────────────────┘
                             └──────────────────────┘
```

**Punto clave — doble almacenamiento sincronizado:**
- El cliente guarda las sesiones en **localStorage** (respuesta instantánea, tolera cortes
  de red). La clave está **aislada por usuario**: `studylog_v1_u<id>`.
- Al iniciar, `syncSessions()` descarga el historial real del backend y hace un
  **merge idempotente por `ts`** (timestamp local), evitando duplicados y **subiendo** al
  backend los registros que solo existían localmente (*backfill*).
- Así los datos **no se pierden entre dispositivos** y el backend es la fuente de verdad.

Las **estadísticas se calculan en el cliente** a partir de ese historial ya sincronizado.
Existe `/api/stats` como cálculo alternativo en el servidor, hoy **no usado por la UI**.

---

## 4. Estructura de carpetas

```
FocusData/
├── app.py                  ← Backend Flask: rutas, API, autenticación, migraciones (~1130 líneas)
├── wsgi.py                 ← Punto de entrada WSGI (despliegue en PythonAnywhere)
├── ver_db.py               ← Script de utilidad para inspeccionar la base de datos
├── requirements.txt        ← Dependencias de producción (flask, flask-login)
├── requirements-dev.txt    ← Dependencias de desarrollo (pytest)
├── study.db                ← Base de datos SQLite (se crea/migra automáticamente; no versionada)
├── .secret_key             ← Clave de sesión generada (no versionada)
├── README.md               ← Guía rápida de instalación y API
├── DOCUMENTACION.md        ← Este documento
├── PLAN_CORRECCIONES.md    ← Histórico: plan de auditoría ya ejecutado
├── PLAN_SUBCARPETAS.md     ← Histórico: plan de subcarpetas + cronómetro ya ejecutado
├── walkthrough.md          ← Histórico: informe de ejecución del plan de correcciones
├── PROMPT_APP_MOVIL.md     ← Prompt de ejecución para la futura app móvil (React Native)
├── tests/
│   └── test_api.py         ← 63 tests de la API con base de datos temporal por test
├── static/
│   ├── index.html          ← Estructura de la app (~385 líneas, sin lógica)
│   ├── login.html          ← Pantalla de registro / inicio de sesión
│   ├── sw.js               ← Service worker mínimo: solo notificaciones, sin caché
│   ├── favicon.svg / .png  ← Icono de la app (el .png lo usan las notificaciones)
│   ├── css/
│   │   ├── tokens.css      ← Tokens de tema: colores, radios, sombras (claro y oscuro)
│   │   └── app.css         ← Estilos de todos los componentes
│   ├── js/                 ← 14 módulos ES (ver sección 5.2)
│   ├── img/icons.svg       ← Sprite de Fluent UI System Icons (MIT)
│   ├── scenes/             ← Fotos de las escenas del catálogo (+ su README)
│   └── music/              ← Pistas propias opcionales y tracks.json (+ su README)
├── uploads/backgrounds/    ← Fondos subidos por cada usuario (no versionado, se crea solo)
├── nuevo diseño/           ← Bocetos de diseño, ignorados por git
├── venv/                   ← Entorno virtual de Python
└── __pycache__/            ← Caché de bytecode (autogenerado)
```

---

## 5. Explicación archivo por archivo

### 5.1 Backend

#### 🐍 `app.py` — El corazón del backend (~1130 líneas)

Contiene toda la lógica del servidor. Se organiza en bloques:

**a) Configuración y clave de sesión**
- **`load_secret_key()`**: obtiene la clave que firma las cookies de sesión.
  Prioridad: variable de entorno `SECRET_KEY` → archivo local `.secret_key` →
  genera una aleatoria (`secrets.token_hex(32)`) y la persiste. **No hay clave
  insegura hardcodeada.**
- **Cookie endurecida**: `HttpOnly`, `SameSite=Lax` y `Secure` activable con la variable
  de entorno `FOCUSDATA_HTTPS=1` (forzarlo en local sobre `http://` impediría el login).
- **Fondos**: `UPLOAD_DIR = uploads/backgrounds/`, máximo **6 fondos por usuario**,
  **4 MB** por imagen y **6 MB** de cuerpo total por petición (`MAX_CONTENT_LENGTH`).
- **Valores por defecto**: tema `dark`, acento `#3b82f6`, escena `road`, carpeta
  inicial `General` (color `#6366f1`).
- **Límites**: nombre de carpeta ≤ 30 caracteres, profundidad máxima **10 niveles**,
  `ROOT_PARENT_ID = 0` como centinela de raíz.

**b) Flask-Login (autenticación)**
- **`class User(UserMixin)`**: modelo mínimo (id + username).
- **`load_user(user_id)`**: recupera el usuario desde la BD a partir del id de la cookie.
- **`unauthorized()`**: responde `401 {"error": "No autorizado"}` en rutas `/api/…`
  y **redirige a `/login`** en el resto.
- **Freno de fuerza bruta**: `_login_retry_after()` / `_record_login_fail()` bloquean una
  IP con **HTTP 429** tras 8 intentos fallidos, durante 5 minutos (en memoria del proceso).

**c) Base de datos y migraciones**
- **`get_db()`**: abre una conexión SQLite con `row_factory = Row` (acceso por nombre de
  columna). Todas las rutas la cierran con `closing()`.
- **`init_db()`**: crea las cinco tablas si no existen y ejecuta las **migraciones
  automáticas** descritas en la sección 6.

**d) Helpers del árbol de carpetas**
`resolve_category()` (elige una carpeta válida para una sesión), `category_descendants()`,
`category_ancestors()`, `category_depth()`, `category_subtree_height()` y
`validate_parent()` (impide ciclos y pasar de 10 niveles).

**e) Helpers de imágenes**
`_sniff_image()` valida el formato leyendo los primeros bytes (JPG/PNG/WebP), sin fiarse
de la extensión ni del `Content-Type`. `_user_upload_dir()` aísla los archivos por usuario.

**f) Rutas** — ver la tabla completa en la sección 7.

> **Detalles importantes:**
> - `get_sessions()` filtra los descansos (`mode='break'`) por defecto; hay que pasar
>   `?include_breaks=1` para incluirlos (lo necesita el cálculo del RDA).
> - Todas las consultas llevan `WHERE user_id = ?` para **aislar los datos por usuario**.
> - `export_csv()` protege contra **inyección de fórmulas** (`_csv_safe`) y escribe BOM
>   para que Excel lo abra bien.
> - Las imágenes de fondo se sirven desde `/api/backgrounds/<id>/image` **con login**, no
>   desde `/static`, para que nadie más pueda verlas.

---

#### 🚀 `wsgi.py` — Punto de entrada para producción

Archivo que **PythonAnywhere** (u otro servidor WSGI) busca para arrancar la app. Fija
`FOCUSDATA_HTTPS=1` con `setdefault` (PythonAnywhere sirve por HTTPS), importa `app` e
`init_db` de `app.py`, ejecuta la creación/migración de la BD y expone la variable
`application`. En desarrollo no se usa: ahí se ejecuta `python app.py` directamente.

---

#### 🔍 `ver_db.py` — Utilidad de inspección de la BD

Script independiente para **mirar el contenido de `study.db`** desde la terminal sin abrir
la app. Cuenta el total de registros y muestra los últimos 20 en una tabla formateada.
Se ejecuta con `python ver_db.py`.

---

#### 🧪 `tests/test_api.py` — Suite de la API (63 tests)

Cubre autenticación, validaciones de entrada, aislamiento entre usuarios, jerarquía de
carpetas (crear, mover, archivar en cascada, eliminar con sus sesiones), modo cronómetro,
reasignación de la carpeta activa, exportaciones y fondos propios (límites, formatos,
aislamiento). Cada test usa una **base de datos temporal propia**, así que nunca toca
`study.db`. Se ejecuta con `pytest`.

---

#### 📦 `requirements.txt` y `requirements-dev.txt`

```
# requirements.txt (producción)
flask>=3.0.0
flask-login>=0.6.0

# requirements-dev.txt (desarrollo)
-r requirements.txt
pytest>=8.0.0
```

En PythonAnywhere solo hace falta `requirements.txt`.

---

#### 🗄️ `study.db` · 🔑 `.secret_key`

`study.db` es el archivo binario con todas las tablas y datos; se crea solo la primera vez
que arranca la app. `.secret_key` guarda la clave aleatoria que firma las cookies: quien la
tenga puede falsificar sesiones. **Ninguno de los dos se versiona** (ver `.gitignore`).

---

### 5.2 Frontend

El frontend **no se compila**. `index.html` solo contiene la estructura (~385 líneas) y
carga `static/js/app.js` como módulo; ese módulo importa el resto.

#### 🎨 `static/index.html` — Estructura de la app

Define el armazón y las seis vistas, que se muestran y ocultan con el atributo `hidden`
(no hay router; la vista se refleja en el hash de la URL):

| Zona | Contenido |
|---|---|
| **Barra lateral** (plegable) | Marca · **Nueva sesión** · navegación Timer / Estadísticas / Registro · árbol de **Carpetas** (tocar = filtrar; `⋯` = acciones; horas por carpeta incluyendo subcarpetas) · **Recientes** (hoy y ayer) · menú de cuenta |
| **Barra superior** | Selector **Filtro** (carpeta) · selector de **Periodo** (todo / año / mes / semana / hoy) · selector de **Escena** · **Música** · botón sol/luna |
| **Timer** | Saludo · anillo con reloj y fase · línea `Sesión · Ciclo · ● carpeta activa` · compositor (actividad + modo + carpeta + rueda de tiempos) · botón **Saltar descanso** (solo en un descanso del Pomodoro) · **Recomendados** (según el filtro de carpeta) · 3 mini-métricas |
| **Estadísticas** | 8 indicadores · calendario de consistencia · distribución por tema · distribución por carpeta (navegable) · últimos 7 días · densidad por hora |
| **Registro** | Tabla filtrable por tipo, con el periodo global (carpeta y periodo de la barra superior) · menú **⋯** por fila (renombrar, mover de carpeta, eliminar) · «Mostrar más» si hay más de 200 filas con «Todo el historial» · Exportar CSV/JSON · Borrar historial |
| **Carpetas** | Árbol con insignias y horas · formulario de nueva carpeta |
| **Configuración** | Tema · Escena · Acento · Tiempos del Pomodoro · Notificaciones · Música · Datos · Cuenta |
| **Ayuda** | Temporizador · Carpetas · Estadísticas y Registro · Fondos · Música · Tus datos |

#### 🎛️ `static/css/`
- **`tokens.css`**: la paleta como variables CSS, definida dos veces (tema oscuro por
  defecto y claro). Incluye `bg`, `surface`, `text`, `muted`, `line`, `track`, `focus`,
  `good`, `danger`, `break`, los 8 colores de categoría `cat-1…8` + `cat-other`, radios y
  sombras. El **acento** (`--accent`) lo inyecta JavaScript.
- **`app.css`**: estilos de todos los componentes (barra lateral, compositor, anillo,
  menús, modales, tarjetas, gráficos, calendario, panel de música…).

#### 📜 `static/js/` — los 14 módulos

| Módulo | Responsabilidad |
|---|---|
| **`app.js`** | **Arranque.** Inicializa todos los módulos, navega entre vistas (`go()`), pinta la píldora de filtro y las sesiones recientes, monta el menú de cuenta y ejecuta `boot()`: apariencia en caché → `/api/me` → carpetas y fondos → `syncSessions()`. También reinterpreta los temas de legado `ocean`/`forest` como tema oscuro + escena del mismo nombre |
| **`store.js`** | **Estado y datos.** El objeto `S` (usuario, sesiones, carpetas, preferencias, filtro de carpeta, filtro de periodo), la caché `localStorage` aislada por usuario, `loadCategories()`, `descendantIds()`, `minutesByFolder(recs?)` (minutos por carpeta sumando el subárbol; por defecto todo el historial, o se le pasa `periodStudyRecs()`), `logSession()`, `syncSessions()` (merge por `ts` + backfill), `reassignSession()` y `renameSession()` (ambas sobre el mismo `PATCH` interno, solo funcionan si la sesión ya tiene `remote_id`), `renameType()` (renombra o fusiona un tema en todo el historial y emite `'type-renamed'` para que la portada y los filtros lo sigan), `deleteSession()` (borra en el servidor si ya se sincronizó; si no, solo en local), `clearHistory()`, `savePrefs()`, el **filtro de carpeta** recordado en este navegador con clave por usuario (`setFilter()`, `loadFilter()`, clave `focusdata.filter.u<id>`; si la carpeta ya no existe, `loadCategories()` lo limpia), la configuración del Pomodoro (`CFG_LIMITS`, `CFG_DEFAULT`, `loadCfg`, `setCfg`) y el **filtro de periodo** (`PERIOD_OPTIONS`, `loadPeriod()`, `setPeriod()`, `periodRange()`, `periodDb()`, `periodStudyRecs()`) |
| **`util.js`** | **Utilidades comunes.** Selectores `$`/`$$`, `ic()` (iconos del sprite), `esc()` (anti-XSS), `norm()` (búsqueda sin acentos), formato (`fmtMin`, `fmtHours`, `prettyDate`), fechas **locales** (`localDateStr`, `localISOString`, `daysAgoStr`), cliente `api()`, `toast()`, bus de eventos (`on`/`emit`) y envoltorios de `localStorage` |
| **`ui.js`** | **Componentes.** Menús desplegables con buscador y navegación por teclado (`openMenu`), modales (`openModal`, `askText` —con chips opcionales de sugerencias—, `confirmDialog`), secciones plegables y tooltips |
| **`audio.js`** | **Motor de audio compartido.** Un único `AudioContext` para toda la app, usado por `timer.js` (alarma) y `music.js` (música): crear uno por módulo, o crearlo fuera de un gesto del usuario, lo deja `'suspended'` en Safari/iOS y no suena nada. `unlockAudio()` se registra una vez al arrancar y lo desbloquea con el primer toque/clic/tecla (más `navigator.audioSession = 'playback'` en iOS 16.4+, para sonar aunque el silencio físico esté activado) |
| **`timer.js`** | **Pomodoro, cronómetro y sesión manual.** El tiempo se calcula siempre desde el **reloj de pared** (`endTime − ahora`), no contando ticks. Fin de fase: alarma (vía `audio.js`), registro de la sesión y preparación de la siguiente (que **no** arranca sola). **Saltar descanso** (`skipBreak()`) termina un descanso antes de tiempo, registra solo los minutos reales transcurridos (sin alarma ni notificación) y, si la preferencia «Empezar a trabajar al saltar» está activada, arranca la fase de trabajo sola. **Descanso intermedio** del cronómetro (botón de taza: 5, 10, 15 min o «Sin límite»; congela el cronómetro, registra el descanso como `break` si dura ≥ 1 min y al volver sigue donde iba; si termina por tiempo suena la alarma y el cronómetro espera en pausa). Rueda de tiempos, saludo por hora del día y chips de tipos recomendados (los 3 más usados **en la carpeta del filtro**, con sus subcarpetas, o en todo el historial sin filtro) |
| **`metrics.js`** | **Cálculo puro de métricas**: `minutesByDate`, `computeStreaks`, `computeIRS`, `computeRDA(recs)` (recibe las filas a contar: por defecto `filteredDb()`, o `periodDb()` para que respete también el periodo), `sumMinutes`, `sumBetween` y `hoursSeries` (reparte los minutos de cada sesión **hacia atrás** desde su hora de fin) |
| **`stats.js`** | **Vista de Estadísticas**: los 8 indicadores y los gráficos, todos **SVG o HTML generados a mano** (columnas con escala `niceScale`, dona con leyenda, calendario de 26 semanas, barras horizontales de la **distribución por carpeta**). Algunos respetan el **filtro de periodo** de la barra superior y otros tienen ventana fija (ver la sección 9, «Glosario de métricas») |
| **`log.js`** | **Vista de Registro**: tabla filtrable por tipo, acotada por el filtro de carpeta y de **periodo** globales (sin selector propio de fechas), insignias de modo, menú **⋯** por fila (renombrar con sugerencias de temas ya usados, mover de carpeta, eliminar con confirmación), borrado de todo el historial y, con «Todo el historial», paginación de 200 en 200 con el botón «Mostrar más». También expone `openRenameTypeModal()` (renombrar/fusionar un tema en todo el historial, con «Fusionar» dinámico si el nombre ya existe), reutilizado desde el filtro de tipo y desde la leyenda de la dona en `stats.js` |
| **`folders.js`** | **Árbol de carpetas**: render con sangría por profundidad, horas por carpeta sumando descendientes, menú de acciones (activa, filtrar, subcarpeta, renombrar, mover, archivar/restaurar, eliminar) y los diálogos de cada una, incluido el de eliminación con confirmación escrita |
| **`settings.js`** | **Apariencia**: aplicar y persistir tema y color de acento (presets + campo hex validado, con espera de 600 ms en el personalizado) |
| **`scenes.js`** | **Escenas y fondos propios**: catálogo `SCENES`, aplicar la escena (foto de fondo, velo y los 3 colores que tiñen anillo y marca), caché de apariencia para pintar sin parpadeo, y subir/listar/borrar los fondos del usuario |
| **`music.js`** | **Música de concentración** (el módulo más grande, ~945 líneas): 7 sonidos **sintetizados con Web Audio** —Lo-fi, Ambiente, Lluvia, Bosque, Olas, Chimenea y Ruido marrón— más pistas propias opcionales de `tracks.json`. Usa el `AudioContext` compartido de `audio.js` (no lo suspende en pausa: lo necesita la alarma). Volumen con ganancia cuadrática, fundidos de entrada y salida, sincronización con el temporizador y atenuación al 20 % mientras suena la alarma |
| **`notifications.js`** | **Avisos de fin de fase** mediante el service worker (o `new Notification()` como respaldo). Interruptores independientes para pomodoros y descansos, permiso pedido una sola vez, y solo avisa si **no** estás mirando la app |

#### 🔔 `static/sw.js` — Service worker

Mínimo y deliberadamente **sin caché**: no intercepta peticiones. Solo muestra las
notificaciones y atiende sus clics. Gracias a él funciona el botón **«Empezar…»**, que
arranca la siguiente fase sin sacarte de lo que estés haciendo (Chrome y Edge), y las
notificaciones funcionan en Android.

#### 🔐 `static/login.html` — Registro e inicio de sesión

Página independiente con un formulario que alterna entre **«Iniciar sesión»** y
**«Crear cuenta»**, con la misma escena de fondo que el Timer. Envía las credenciales por
`fetch` a `/api/login` o `/api/register` y redirige a `/`. Muestra los errores del backend
tal cual (incluido el `429` del freno de fuerza bruta).

---

## 6. Esquema de la base de datos

### Tabla `users`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Clave primaria |
| `username` | TEXT | Nombre de usuario (único). **No hay email ni recuperación de contraseña** |
| `password` | TEXT | Hash de la contraseña (Werkzeug) |
| `theme` | TEXT | Tema de la interfaz (`dark` por defecto; `ocean`/`forest` son legado) |
| `accent` | TEXT | Color de acento (`#3b82f6` por defecto) |
| `scene` | TEXT | Escena de fondo (`road` por defecto) o `bg:<id>` de un fondo propio |
| `active_category_id` | INTEGER | Carpeta donde se registran las sesiones nuevas (FK → `categories.id`) |

### Tabla `categories`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Clave primaria |
| `user_id` | INTEGER | Usuario propietario (FK → `users.id`) |
| `parent_id` | INTEGER | Carpeta padre. **`0` = raíz** (no `NULL`: en SQLite los `NULL` se comparan como distintos y el `UNIQUE` dejaría pasar carpetas raíz duplicadas) |
| `name` | TEXT | Nombre (1–30 caracteres) |
| `color` | TEXT | Color de la carpeta (`#6366f1` por defecto) |
| `archived` | INTEGER | 1 si está archivada (no aparece en los selectores de registro) |

`UNIQUE(user_id, parent_id, name)`: dos carpetas pueden llamarse igual si están en niveles
distintos. Profundidad máxima: **10 niveles**.

### Tabla `sessions`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Clave primaria |
| `user_id` | INTEGER | Usuario propietario (FK → `users.id`) |
| `date` | TEXT | Fecha **local** `YYYY-MM-DD` |
| `hour` | INTEGER | Hora del día (0–23) |
| `time` | TEXT | Hora formateada `HH:MM` |
| `minutes` | INTEGER | Duración en minutos (1–600) |
| `type` | TEXT | Tipo de estudio, libre (1–40 caracteres) |
| `mode` | TEXT | `pomodoro` · `manual` · `cronometro` · `break` |
| `ts` | TEXT | Timestamp ISO local sin milisegundos — **clave de deduplicación** en la sincronización |
| `category_id` | INTEGER | Carpeta de la sesión (FK → `categories.id`) |

### Tabla `backgrounds`
| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Clave primaria |
| `user_id` | INTEGER | Usuario propietario (FK → `users.id`) |
| `name` | TEXT | Nombre del fondo (≤ 40 caracteres) |
| `file` | TEXT | Nombre del archivo en `uploads/backgrounds/<user_id>/` |
| `thumb` | TEXT | Nombre de la miniatura (cadena vacía si no hay) |
| `colors` | TEXT | JSON con hasta 3 colores dominantes, para teñir el anillo y la marca |
| `created_at` | TEXT | Fecha de subida |

### Tabla `migrations`
| Columna | Tipo | Descripción |
|---|---|---|
| `name` | TEXT | Clave primaria: nombre de la migración de datos aplicada |
| `applied_at` | TEXT | Cuándo se aplicó |

### Índices
```sql
idx_sessions_user_date  ON sessions(user_id, date)
idx_sessions_user_ts    ON sessions(user_id, ts)
idx_categories_user     ON categories(user_id)
idx_categories_parent   ON categories(parent_id)
idx_backgrounds_user    ON backgrounds(user_id)
```

### Migraciones automáticas

`init_db()` se ejecuta en cada arranque y es **idempotente**. Hay dos clases:

**De esquema** (se comprueban siempre, con `PRAGMA table_info`):
- Añade `users.theme`, `users.accent`, `users.scene` y `users.active_category_id`.
- Añade `sessions.user_id` y `sessions.category_id`.
- **Jerarquía de carpetas**: como SQLite no permite alterar una restricción de tabla con
  `ALTER`, reconstruye `categories` para añadir `parent_id` y cambiar
  `UNIQUE(user_id, name)` por `UNIQUE(user_id, parent_id, name)`.
- *Backfill*: los usuarios sin carpetas reciben una llamada **«Semestre 1»** con todas sus
  sesiones asignadas, y se rellena su carpeta activa. (Las cuentas **nuevas** empiezan con
  una carpeta llamada **«General»**.)
- Las escenas retiradas (`aurora`, `summit`, `arena`) vuelven a la escena por defecto.

**De datos** (se registran en `migrations` para **no repetirse**, porque repetirlas pisaría
lo que el usuario eligió después):
- `tema-oscuro-para-todos`: pasa a oscuro las cuentas que tenían el tema claro.

---

## 7. API REST

Todas las respuestas son JSON salvo exportaciones e imágenes. Los errores tienen la forma
`{"error": "mensaje en español"}` y la UI **los muestra tal cual**. Cualquier `/api/*` sin
autenticación responde `401 {"error": "No autorizado"}`.

### Autenticación y preferencias
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/login` | Pantalla de registro / inicio de sesión |
| POST | `/api/register` | Crear cuenta e iniciar sesión. Crea la carpeta «General» activa. `409` si el nombre existe |
| POST | `/api/login` | Iniciar sesión. `429` tras 8 fallos en 5 minutos (por IP) |
| GET | `/logout` | Cerrar sesión (redirección HTML) |
| GET | `/api/me` | `{id, username, theme, accent, scene, active_category_id}` |
| POST | `/api/preferences` | Guardado **parcial**: `{theme?, accent?, scene?, active_category_id?}` |

### Carpetas
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/categories` | `[{id, parent_id, name, color, archived, depth, path}]` en **preorden** (cada hija justo tras su padre, hermanas alfabéticas). `path` usa `" › "` |
| POST | `/api/categories` | Crear: `{name, color?, parent_id?}`. `409` si ya existe ese nombre en el mismo nivel |
| PATCH | `/api/categories/<id>` | Actualizar parcial: `{name?, color?, parent_id?, archived?}`. Archivar baja en cascada; restaurar sube a los ancestros |
| DELETE | `/api/categories/<id>` | Eliminar el subárbol: `{content: "move", target_id}` o `{content: "delete"}`. Devuelve `{deleted_ids, deleted_folders, moved_sessions, deleted_sessions, active_category_id}` |

### Sesiones
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/` | Interfaz web |
| GET | `/api/sessions` | Listar. Parámetros: `?days=7`, `?type=X`, `?include_breaks=1` (necesario para el RDA). Orden `ts` DESC, sin paginación |
| POST | `/api/sessions` | Guardar sesión. El backend corrige `category_id` si no es válido (activa → primera no archivada → crea «General») |
| POST | `/api/sessions/rename-type` | Renombrar (o fusionar) un tema en **todo** el historial: `{from, to}`. No toca los descansos. `{ok, updated}` con el número de filas afectadas |
| PATCH | `/api/sessions/<id>` | Actualizar parcial: `{category_id?, type?}` (al menos uno). Mueve de carpeta, renombra, o ambas cosas a la vez |
| DELETE | `/api/sessions/<id>` | Eliminar una sesión. `404` si no existe o es de otro usuario |
| DELETE | `/api/sessions/all` | Borrar todas las sesiones del usuario |
| GET | `/api/stats` | Estadísticas del backend. **Existe pero la UI no lo usa** |
| GET | `/api/export/csv` | CSV con BOM, sin descansos. Protegido contra inyección de fórmulas |
| GET | `/api/export/json` | JSON, con descansos |

### Fondos propios
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/backgrounds` | `[{id, name, colors, url, thumb_url}]` |
| POST | `/api/backgrounds` | Subir (multipart: `file`, `thumb?`, `name`, `colors`). JPG/PNG/WebP, ≤ 4 MB, máximo 6 por usuario |
| GET | `/api/backgrounds/<id>/image` | Imagen (`?size=thumb`). **Solo para su dueño**, con `Cache-Control: private, immutable` |
| DELETE | `/api/backgrounds/<id>` | Eliminar; si estaba en uso, la escena vuelve a `road` |

### Validaciones del backend
| Campo | Regla |
|---|---|
| `username` | 3–30 caracteres (tras `trim`) |
| `password` | Registro ≥ 8 caracteres (el login acepta contraseñas antiguas más cortas) |
| `minutes` | Entero **1–600** |
| `type` | 1–40 caracteres tras `trim` |
| `mode` | `pomodoro` · `break` · `manual` · `cronometro` |
| `date` | `^\d{4}-\d{2}-\d{2}$` |
| `time` | `^\d{1,2}:\d{2}$` |
| `hour` | 0–23 |
| `ts` | ≤ 40 caracteres, se guarda byte a byte |
| `theme` | `dark` · `light` · `ocean` · `forest` (los dos últimos, legado) |
| `accent` / `color` | `^#(?:[0-9a-fA-F]{3}\|[0-9a-fA-F]{6})$` |
| `scene` | `none, road, blossom, ocean, forest, dusk, nebula` o `bg:<id>` propio |
| Carpeta `name` | 1–30 caracteres, único por `(usuario, padre)`, profundidad ≤ 10 |

---

## 8. Flujos clave

**Registro / login** → `login.html` envía credenciales → Flask valida, aplica el freno de
fuerza bruta y crea la cookie de sesión → redirige a `/` → `index.html` carga.

**Arranque de la app** (`boot()` en `app.js`) → pinta la apariencia **en caché** para
evitar el parpadeo → inicializa los módulos → `GET /api/me` (tema, acento, escena, carpeta
activa) → `loadCategories()` + `loadBackgrounds()` en paralelo → aplica la escena real →
`syncSessions()`.

**Registrar una sesión** → el timer termina una fase (o guardas el cronómetro, o registras
una manual) → `logSession()` guarda en localStorage con `ts` **local** y hace
`POST /api/sessions` → el backend inserta la fila con `user_id` y la carpeta activa.

**Sincronización** → `GET /api/sessions?include_breaks=1` → *merge* por `ts` (idempotente)
→ *backfill* de lo que solo existía en local → re-render de la UI.

**Carpeta activa vs. filtro** → la *activa* es dónde se guardan las sesiones nuevas y se
persiste en el backend (`active_category_id`); el *filtro* es **solo local** y decide qué
se ve en las mini-métricas, Estadísticas y Registro. Filtrar por una carpeta **incluye
todos sus descendientes**.

**Cambiar apariencia** → eliges tema, acento o escena → se aplica al instante sobre las
variables CSS → `POST /api/preferences` lo persiste en tu cuenta y `cacheAppearance()` lo
guarda en local para el siguiente arranque.

**Fin de fase con la app en segundo plano** → `timer.js` avisa a `notifications.js` → el
service worker muestra la notificación con el botón «Empezar…» → al pulsarlo, `sw.js`
manda un mensaje a la pestaña abierta y la siguiente fase arranca sin cambiar de ventana.

---

## 9. Glosario de métricas (calculadas en el cliente)

Todas se calculan sobre las sesiones del **filtro de carpeta activo** (`S.filterCategoryId`),
excluyendo los descansos (salvo el RDA, que los necesita). Además, el **filtro de
periodo** (`S.period`: todo el historial, este año, este mes, esta semana u hoy —
`periodRange()` / `periodDb()` / `periodStudyRecs()` en `store.js`) acota algunas de
ellas y no otras:

- **Respetan el periodo** (su subtítulo cambia con él): Total estudiado, Sesiones,
  Descanso activo (RDA), Enfoque Pomodoro, Distribución por tema, Distribución por
  carpeta, Densidad por hora.
- **Tienen su propia ventana fija**, sea cual sea el periodo elegido: Esta semana, Hoy,
  Racha, Regularidad, Calendario de consistencia, Últimos 7 días.

| Métrica | Dónde | Ventana | Definición |
|---|---|---|---|
| **Esta semana** | `stats.js` | fija | Minutos de los últimos 7 días, comparados con los 7 anteriores (variación en %) |
| **Hoy** | `stats.js` | fija | Minutos de hoy y número de sesiones |
| **Racha** | `computeStreaks` | fija | Días consecutivos estudiando. Un día cuenta con **≥ 1 min**. Se muestra la actual y la máxima histórica |
| **Regularidad (IRS)** | `computeIRS` | fija | % de los últimos 7 días con **≥ 20 min** estudiados |
| **Total estudiado** | `stats.js` | periodo | Suma de minutos del periodo elegido |
| **Sesiones** | `stats.js` | periodo | Número de sesiones de estudio registradas en el periodo elegido |
| **Descanso activo (RDA)** | `computeRDA` | periodo | Minutos de descanso ÷ minutos de estudio, dentro del periodo elegido. Meta ~20 %: por debajo de 15 % «bajo», hasta 30 % «en el rango ideal», por encima «alto» |
| **Enfoque Pomodoro** | `stats.js` | periodo | % del tiempo de estudio del periodo hecho en modo `pomodoro` |
| **Calendario de consistencia** | `stats.js` | fija | Últimas **26 semanas** en columnas que empiezan en lunes; 5 niveles de intensidad por minutos/día (0 · <25 · <60 · <120 · resto) |
| **Distribución por tema** | `stats.js` | periodo | Dona con los totales por tipo dentro del periodo elegido; con más de 6 tipos muestra los 5 primeros + «Otros». **El color sigue al tipo** en toda la app. Cada fila de la leyenda (salvo «Otros») abre un menú para renombrar ese tema en todo el historial |
| **Distribución por carpeta** | `stats.js` | periodo | Barras horizontales por carpeta (subárbol completo), navegables: sin filtro muestra las raíces, con un filtro sus hijas directas más una fila de sesiones registradas directamente en esa carpeta. Máximo 8 filas + «Otras». Pulsar una fila baja de nivel (`setFilter`); «← …» sube uno |
| **Últimos 7 días** | `stats.js` | fija | Columnas por día, con hoy resaltado |
| **Densidad por hora** | `hoursSeries` | periodo | Minutos por hora del día, dentro del periodo elegido. Como la sesión se registra **al terminar**, sus minutos se reparten **hacia atrás** desde su hora, cruzando la medianoche si hace falta. Muestra tu franja más productiva |

**Formato** (`util.js`): `fmtMin` → `45 min` / `2 h` / `2 h 05 min`.
`fmtHours` → `3 h` si llega a 60 minutos, si no `45 min`.

---

## 10. Cómo ejecutar

```bash
python -m venv venv                       # crear entorno (una vez)
venv\Scripts\activate                     # activar (Windows)
pip install -r requirements.txt           # dependencias de producción
python app.py                             # arranca en http://127.0.0.1:5000
```

**Tests:**
```bash
pip install -r requirements-dev.txt
pytest                                    # 63 tests, con BD temporal por test
```

**Producción (PythonAnywhere):** define la variable de entorno `SECRET_KEY` y usa
`wsgi.py` como punto de entrada. `wsgi.py` ya activa `FOCUSDATA_HTTPS=1`, que pone el
atributo `Secure` en la cookie de sesión.

---

## 11. Notas y buenas prácticas

- **Fechas siempre locales.** Nunca uses `toISOString()` (es UTC): el historial se
  desplazaría un día. Usa `localDateStr()` y `localISOString()` de `util.js`, y compara
  fechas como cadenas `YYYY-MM-DD`.
- **`ts` es la clave de deduplicación.** Cualquier cambio en su formato rompería la
  sincronización entre dispositivos.
- **El tiempo del temporizador se calcula desde el reloj de pared**, no contando ticks:
  así no se desfasa cuando el navegador ralentiza las pestañas en segundo plano.
- **Escapa siempre lo que venga del usuario** en las plantillas `innerHTML`, con `esc()`
  de `util.js` (nombres de tipo, de carpeta y de fondo).
- **Las imágenes subidas no van en `/static`.** Viven en `uploads/` y se sirven con login
  desde `/api/backgrounds/<id>/image`, para que solo su dueño pueda verlas.
- **Las migraciones de datos van en la tabla `migrations`.** Si repites una en cada
  arranque, pisarás lo que el usuario eligió después.
- El servidor de desarrollo (`app.run(debug=True)`) **no** debe usarse en producción.
- `.gitignore` ya excluye `.secret_key`, `study.db*`, `venv/`, `__pycache__/`, `uploads/`,
  `nuevo diseño/` y `DOCUMENTACION.pdf`.
- **Otros documentos del repositorio:** `README.md` es la guía rápida;
  `PROMPT_APP_MOVIL.md` es el plan de la futura app móvil (React Native) y contiene el
  contrato detallado de la API; `PLAN_CORRECCIONES.md`, `PLAN_SUBCARPETAS.md` y
  `walkthrough.md` son **históricos** de trabajos ya ejecutados y no describen el estado
  actual.
