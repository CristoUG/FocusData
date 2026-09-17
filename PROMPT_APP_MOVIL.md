# Prompt de ejecución — FocusData Móvil (iOS + Android)

> **Qué es este documento:** un prompt para un agente de código (Claude Code u otro).
> Contiene todo el contexto de la plataforma actual y las instrucciones, en fases
> verificables, para crear la **app móvil nativa** de FocusData conectada al mismo
> backend y a las mismas cuentas que la web, **sin que la web deje de funcionar**.
>
> **Cómo usarlo:** abre el agente en la raíz del repositorio `FocusData` y pégale:
> *"Lee `PROMPT_APP_MOVIL.md` completo y ejecuta la Fase 0. Tras cada fase, detente,
> muéstrame la verificación y espera mi confirmación antes de seguir."*
>
> **¿Sin presupuesto?** Existe además `PROMPT_APP_MOVIL_GRATIS.md`: un complemento que
> adapta este plan a **costo cero** (solo Android, APK instalado a mano, sin cuentas de
> pago). Si el usuario lo indica, ese documento **manda sobre este** en lo que cambie.
>
> Si una instrucción choca con lo que ves en el código o en la documentación vigente de
> una librería, **detente y pregunta** en vez de improvisar. Este documento describe el
> código tal como estaba el 2026-09-15 (commit `7145e1a`, rediseño estilo Copilot con
> escenas, música y notificaciones) y el estado de las librerías a esa fecha.

---

## 0. Rol y objetivo

Actúa como ingeniero senior de React Native + Flask. Tu objetivo es entregar una app
móvil que:

1. Tenga **paridad funcional** con la web en lo esencial: Timer (Pomodoro y Cronómetro),
   sesión manual, Estadísticas, Registro, Carpetas anidadas, Apariencia (tema, acento y
   **escena de fondo**) y **música lo-fi** sincronizada con el temporizador.
2. Use **las mismas cuentas y los mismos datos**: una sesión registrada en el móvil
   aparece en la web y al revés; la escena elegida en un sitio se ve en el otro.
3. Tenga un **sistema de notificaciones propio de una app de temporizador**: aviso puntual
   al terminar cada fase aunque la app esté cerrada, **temporizador en curso** visible
   fuera de la app (notificación con cuenta atrás en Android, Live Activity y Dynamic
   Island en iPhone) y **resumen semanal**.
4. Permita **entrar con Google** (web, Android e iPhone) y **con Apple** (iPhone), además
   de usuario y contraseña, y vincular esas cuentas a una cuenta existente.
5. Aproveche lo que la web no puede hacer: **música con la pantalla bloqueada**, registro
   **offline** con cola de envío, vibración y pantalla siempre encendida.
6. **Conviva con la web**: web y móvil son dos clientes del mismo backend. Todo cambio
   de backend es aditivo, y la web solo recibe el arreglo de sincronización de la Fase 3
   y el inicio de sesión con Google de la Fase 14.

```
   Navegador (web)                 App móvil (Expo)
   cookie de sesión                token Bearer (SecureStore)
   caché en localStorage           caché SQLite + cola de envío
          │                               │
          └──────────►  Flask (app.py)  ◄─┘
                        PythonAnywhere
                        study.db  ← fuente de verdad
                            │
               verifica tokens de Google y Apple
```

---

## 1. Decisiones ya tomadas

| Decisión | Elegido |
|---|---|
| **Framework** | **React Native con Expo** (SDK estable más reciente), **TypeScript** en modo `strict`, Nueva Arquitectura |
| **Navegación** | `expo-router` con pestañas inferiores |
| **Ubicación del código** | Carpeta **`mobile/`** dentro de este mismo repo (monorepo): backend, web y app cambian juntos en la misma rama y los mismos commits |
| **Equipo de desarrollo** | **Windows 11**. No hay simulador de iOS: Android se prueba en el emulador de Android Studio o en un teléfono físico; iOS en un **iPhone físico**. Las compilaciones de iOS se hacen en la nube con **EAS Build** |
| **Builds de desarrollo** | Fases 4–6 se pueden probar en **Expo Go**. Desde la **Fase 7** (notificaciones, Live Activities, audio en segundo plano, Google) hacen falta ***development builds*** de EAS. En iPhone eso exige **cuenta de Apple Developer** (de pago) |
| **Autenticación móvil** | **Token Bearer** emitido por el backend (nuevo), guardado en `expo-secure-store`. La web sigue con su cookie de sesión intacta |
| **Inicio de sesión** | Usuario y contraseña (como hoy) + **Google** en web, Android e iPhone + **Apple** en iPhone. La guía 4.8 de Apple exige ofrecer una opción como Apple si la app ofrece Google. Las cuentas existentes vinculan Google o Apple desde Ajustes. El backend verifica los tokens con `PyJWT[crypto]` |
| **Almacenamiento local** | `expo-sqlite` (sesiones, carpetas y fondos en caché, cola de envío) |
| **Estado de UI** | `zustand` |
| **Gráficos** | Componentes propios con `react-native-svg` (columnas, dona, calendario, anillo), igual que la web, que ya no usa Chart.js |
| **Hojas/diálogos** | Bottom sheets (`@gorhom/bottom-sheet` + `react-native-reanimated` + `react-native-gesture-handler`) en lugar de menús desplegables y modales |
| **Notificaciones** | **`react-native-notify-kit`** (fork mantenido de Notifee, que Invertase archivó en abril de 2026) para **todas** las notificaciones locales: fin de fase con alarma exacta, temporizador en curso con cuenta atrás nativa en Android y resumen semanal. **Live Activity** en iPhone con **`expo-widgets`** + `@expo/ui`. **No** se instala `expo-notifications`, para que dos librerías no compitan por las mismas pulsaciones. Nada de push remoto |
| **Sonido / háptica / pantalla** | `expo-audio`, `expo-haptics`, `expo-keep-awake` |
| **Exportar** | `expo-file-system` + `expo-sharing` |
| **Tipografía** | **Open Sans** (`@expo-google-fonts/open-sans`, 400/600/700). La web usa Segoe UI Variable en Windows y Open Sans en el resto; Segoe no se puede empaquetar |
| **Iconos** | Los **mismos de la web**: el sprite Fluent UI System Icons (MIT) de [static/img/icons.svg](static/img/icons.svg), convertido a componentes `react-native-svg` con un script. No se añade librería de iconos |
| **Escenas de fondo** | **Se eligen desde el móvil**: las 7 escenas del catálogo y los fondos propios que el usuario ya subió desde la web. **Subir y borrar fondos sigue siendo solo de la web** |
| **Música de concentración** | **Lo-fi** en el móvil (el resto de sonidos de la web, no). El generador de la web se **renderiza a un bucle de audio** (`.m4a`, ~5 min) empaquetado en la app y reproducido con `expo-audio`: suena igual, funciona sin conexión y **sigue sonando con la pantalla bloqueada** |
| **Tests** | `jest-expo` para la lógica de dominio; `pytest` para el backend |
| **Idioma** | Toda la interfaz y los mensajes **en español** |
| **Qué funciona offline** | **Registrar sesiones**, **la música lo-fi** y **las notificaciones locales**. Carpetas, preferencias (incluida la escena), reasignar, borrar, exportar e iniciar sesión requieren conexión y lo dicen claramente |

Instala siempre con `npx expo install <paquete>` para obtener versiones compatibles con
el SDK. **No confíes en tu memoria para las APIs**: consulta la documentación de la
versión instalada antes de usar `react-native-notify-kit`, `expo-widgets`, `@expo/ui`,
`expo-audio`, `expo-sqlite`, `expo-router`, `expo-apple-authentication` o la librería de
Google, y comprueba qué funciona en Expo Go y qué exige un *development build*.

---

## 2. Qué es FocusData hoy

App web para **registrar y analizar tiempo de estudio/trabajo**.

- **Backend:** Flask 3 + Flask-Login + SQLite, un solo archivo [app.py](app.py)
  (~1130 líneas). Desplegado en **PythonAnywhere** (HTTPS) vía [wsgi.py](wsgi.py), que
  fija `FOCUSDATA_HTTPS=1` y llama a `init_db()`. Los fondos subidos viven en
  `uploads/backgrounds/<user_id>/` (no versionado). Dependencias: solo `flask` y
  `flask-login`.
- **Frontend web (sin build):** [static/index.html](static/index.html) (~385 líneas, solo
  la estructura) + módulos ES en [static/js/](static/js/):
  `app` (arranque y navegación) · `store` (estado, caché y sincronización) · `util`
  (fechas, formato, API) · `ui` (menús, modales) · `timer` · `metrics` · `stats` ·
  `log` · `folders` · `settings` · `scenes` · `notifications` · `music`.
  Estilos en `static/css/tokens.css` (tokens de tema) y `app.css`. Service worker mínimo
  [static/sw.js](static/sw.js) solo para notificaciones. Login en
  [static/login.html](static/login.html). Fotos de escenas en `static/scenes/` y pistas
  opcionales en `static/music/` (hoy `tracks.json` está vacío).
- **Cuentas:** tabla `users` con `username` único y `password` (hash), sin email. **No hay
  forma de recuperar una contraseña olvidada**; vincular Google o Apple será la vía de
  recuperación.
- **Tests:** [tests/test_api.py](tests/test_api.py), **63 tests** (55 funciones, algunas
  parametrizadas) con DB temporal por test.
- **Documentación:** `README.md` está casi al día (su tabla de carpetas no menciona
  `parent_id` ni `DELETE`): **la fuente de verdad es `app.py`**. `DOCUMENTACION.md` y los
  `PLAN_*.md` están desactualizados o son históricos: no los uses como fuente.
  `nuevo diseño/` son bocetos ignorados por git.

### Estructura de la web
| Zona | Contenido |
|---|---|
| **Barra lateral** (plegable) | Marca · **Nueva sesión** · navegación Timer / Estadísticas / Registro · árbol de **Carpetas** (tocar = filtrar; `⋯` = acciones; horas por carpeta incluyendo subcarpetas) · **Recientes** (hoy y ayer) · menú de cuenta (Configuración, Carpetas, Ayuda, Tema, Cerrar sesión) |
| **Barra superior** | Selector **Filtro** · selector de **Escena** · **Música** · botón sol/luna |
| **Timer** | Saludo + "¿En qué te concentras hoy?" · anillo con reloj y fase · línea `Sesión · Ciclo · ● carpeta activa` · compositor: "¿Qué vas a estudiar?" + menú **Modo** (Pomodoro / Cronómetro / Registrar sesión manual…) + **Carpeta activa** + rueda de **Tiempos** + Guardar (cronómetro) + Reiniciar + Iniciar/Pausar · **Recomendados** · 3 mini-métricas (Racha, Hoy, Semana) |
| **Estadísticas** | 8 indicadores · calendario de consistencia · distribución por tema · últimos 7 días · densidad por hora |
| **Registro** | Tabla filtrable por tipo y periodo · cambiar carpeta por fila · Exportar CSV/JSON · Borrar historial |
| **Carpetas** | Lista del árbol con insignias y horas · formulario de nueva carpeta (nombre, color, ubicación) |
| **Configuración** | Tema · Escena de fondo · Color de acento · Tiempos del Pomodoro · Notificaciones · Música · Datos y exportación · Cuenta |
| **Ayuda** | Temporizador · Carpetas · Estadísticas y Registro · Fondos y apariencia · Música · Tus datos |

---

## 3. Contrato de la API existente

Base: `https://<usuario>.pythonanywhere.com` en producción, `http://<IP-del-PC>:5000` en
desarrollo. Todas las respuestas son JSON salvo exportaciones e imágenes. Los errores
tienen la forma `{"error": "mensaje en español"}` y **se muestran al usuario tal cual**.
Cualquier ruta `/api/*` sin autenticación responde `401 {"error": "No autorizado"}`.
Las rutas nuevas se definen en las Fases 1, 2 y 13.

### 3.1 Autenticación y preferencias
| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/api/register` | `{username, password}` | `200 {ok, username}` · `400` validación · `409 "Ese nombre de usuario ya existe"`. Crea la carpeta "General" activa; tema `dark`, acento `#3b82f6`, escena `road` |
| POST | `/api/login` | `{username, password}` | `200 {ok, username}` · `401 "Usuario o contraseña incorrectos"` · `429 "Demasiados intentos fallidos. Reintenta en N segundos."` tras 8 fallos en 5 min (por IP, en memoria del proceso) |
| GET | `/logout` | — | Redirección HTML (**no sirve para móvil**) |
| GET | `/api/me` | — | `{id, username, theme, accent, scene, active_category_id}` |
| POST | `/api/preferences` | **parcial**: `{theme?, accent?, scene?, active_category_id?}` | `{ok}` · `400` si un valor no es válido (`"Escena no válida"` si `scene` no es del catálogo ni un fondo del usuario) |

### 3.2 Carpetas
| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| GET | `/api/categories` | — | `[{id, parent_id, name, color, archived, depth, path}]` en **preorden** (cada hija justo tras su padre, hermanas alfabéticas). `parent_id = 0` es raíz. `archived` es `0/1`. `path` usa `" › "` como separador |
| POST | `/api/categories` | `{name, color?, parent_id?}` | `{ok, id, name, color, archived: 0, parent_id}` · `400` · `409 "Ya existe una carpeta con ese nombre en el mismo nivel"` |
| PATCH | `/api/categories/<id>` | parcial: `{name?, color?, parent_id?, archived?}` | `{ok, id, name, color, archived}` (**sin** `parent_id/depth/path`: recarga la lista tras cualquier PATCH) · `400` · `404` · `409` |
| DELETE | `/api/categories/<id>` | `{content: "move", target_id}` o `{content: "delete"}` | `{ok, deleted_ids, deleted_folders, moved_sessions, deleted_sessions, active_category_id}` · `400` (p. ej. `"No puedes eliminar tu única carpeta activa"`) · `404` |

### 3.3 Sesiones
| Método | Ruta | Body / query | Respuesta |
|---|---|---|---|
| GET | `/api/sessions` | `?include_breaks=1` (**obligatorio para el RDA**), opcional `?days=N&type=X` | `[{id, user_id, date, hour, time, minutes, type, mode, ts, category_id, category_name, category_color}]` ordenado por `ts` DESC. **Sin paginación** |
| POST | `/api/sessions` | `{minutes, type, mode, date, hour, time, ts, category_id}` | `{ok, category_id}` (el backend corrige `category_id` si no es válido: activa → primera no archivada → crea "General"). **Hoy inserta siempre, aunque el `ts` ya exista** (lo corrige la Fase 2) |
| PATCH | `/api/sessions/<id>` | `{category_id}` | `{ok, category_id, category_name}` (acepta carpetas archivadas) |
| DELETE | `/api/sessions/all` | — | `{ok}` |
| GET | `/api/export/csv` · `/api/export/json` | — | Archivo adjunto. CSV con BOM, sin descansos, columnas `fecha,hora,hora_num,minutos,tipo,modo,carpeta,timestamp`. JSON con descansos |
| GET | `/api/stats` | — | Existe, **no lo uses**: las métricas se calculan en el cliente |

### 3.4 Fondos propios (el móvil los lista y los elige; no sube ni borra)
| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/backgrounds` | `[{id, name, colors, url, thumb_url}]` (`colors`: hasta 3 colores `#rrggbb` o `hsl(H S% L%)`; `url`/`thumb_url` son rutas relativas a la base) |
| GET | `/api/backgrounds/<id>/image` | Imagen (`?size=thumb` para la miniatura). Solo para su dueño; `Cache-Control: private, max-age=31536000, immutable` (una URL nunca cambia de imagen) |
| POST · DELETE | `/api/backgrounds[/<id>]` | Subir (multipart) y borrar: **el móvil no los usa**. Borrar el fondo en uso devuelve la escena de la cuenta a `road` |

Para elegir una escena o fondo se usa `POST /api/preferences {scene}` (§3.1).

### 3.5 Validaciones del backend (replícalas en el cliente para no provocar 400)
| Campo | Regla |
|---|---|
| `username` | 3–30 caracteres (tras `trim`) |
| `password` | registro ≥ 8 caracteres (el login acepta contraseñas antiguas más cortas) |
| `minutes` | entero **1–600** |
| `type` | 1–40 caracteres tras `trim` (la web también limita a **40**) |
| `mode` | `pomodoro` · `break` · `manual` · `cronometro` |
| `date` | `^\d{4}-\d{2}-\d{2}$` |
| `time` | `^\d{1,2}:\d{2}$` → **genera siempre `HH:MM` en 24 h** |
| `hour` | 0–23 |
| `ts` | máx. 40 caracteres, se guarda **byte a byte**: es la clave de deduplicación |
| `theme` | `dark` · `light` · `ocean` · `forest` (los dos últimos son legado: se muestran como tema `dark` con la escena del mismo nombre) |
| `accent` / `color` | `^#(?:[0-9a-fA-F]{3}\|[0-9a-fA-F]{6})$` |
| `scene` | `none, road, blossom, ocean, forest, dusk, nebula` o `bg:<id>` de un fondo del propio usuario. **El móvil solo envía ids del catálogo o `bg:<id>` de un fondo presente en `/api/backgrounds`** |
| Carpeta `name` | 1–30 caracteres; único por `(usuario, padre)` |
| Profundidad | máx. 10 niveles |

---

## 4. Reglas de negocio que el móvil debe replicar exactamente

Todo esto vive en `static/js/`. Pórtalo a **funciones puras en TypeScript**
(`mobile/src/domain/`) con tests; la UI solo las llama. Entre paréntesis, dónde está en
la web.

### 4.1 Fechas y marcas de tiempo (crítico para la sincronización) (`util.js`)
- `date` = fecha **local** `YYYY-MM-DD` (nunca `toISOString()`, que es UTC).
- `ts` = `YYYY-MM-DDTHH:MM:SS` **local, sin milisegundos ni zona** (igual que
  `localISOString()` de la web). Web y móvil deben producir el mismo formato.
- `time` = `HH:MM` 24 h con ceros. **No uses `toLocaleTimeString`**: según el idioma del
  teléfono produce `2:05 p. m.` y el backend lo rechaza (la web aún lo usa; la Fase 3 lo
  corrige).
- `hour` = hora local 0–23.
- **Envía siempre `date`, `hour`, `time` y `ts`**: si faltan, el servidor usa su propia
  hora (la del servidor de PythonAnywhere, no la del usuario).
- `daysAgo(n)` = fecha local de hoy menos `n` días. Las comparaciones de fechas son de
  cadenas `YYYY-MM-DD`.

### 4.2 Temporizador Pomodoro (`timer.js`, `store.js`)
- **Tiempos** (por defecto 25/5/15/4): **Trabajo** 5–60 paso 5 · **Descanso corto** 1–15
  paso 1 · **Descanso largo** 10–30 paso 5 · **Ciclos hasta el descanso largo** 2–6 paso 1.
  Botones −/+ (avanzan un paso y se deshabilitan en los límites) + slider; todo valor se
  redondea y se acota al rango. **Restablecer** vuelve a los valores por defecto. Se
  guardan **en el dispositivo** (la web usa `localStorage`; no hay campo en el backend).
  Resumen: `{work} min de trabajo · {short} y {long} de descanso · {cycles} ciclos`.
- Estado: `phase` (`work`/`short`/`long`), `session` (desde 1), `cycleCount` (desde 0),
  `phaseTotal` (segundos con los que arrancó la fase), `remaining`, `endTime`,
  `running`, `paused`.
- **El tiempo se calcula siempre desde el reloj de pared** (`endTime - ahora`), nunca
  contando ticks.
- **Iniciar** desde reposo: `phaseTotal = remaining`, `endTime = ahora + remaining`.
  **Reanudar**: `endTime = ahora + remaining`. **Pausar**: `remaining = max(0,
  round((endTime − ahora)/1000))`. **Reiniciar**: fase `work`, sesión 1, ciclo 0,
  `remaining = phaseTotal = work·60`, ni en marcha ni en pausa.
- Cambiar un tiempo **en reposo** (ni en marcha ni en pausa, modo Pomodoro) solo reajusta
  el reloj si esa duración es la de la fase en pantalla (`key === phase`); `cycles` no
  reajusta nada. Cambiarlo con la fase en marcha o en pausa **no** altera la fase actual
  (manda `phaseTotal`).
- **Fin de fase** (una sola vez por fase):
  - Suena la alarma.
  - Minutos registrados = `max(1, round(phaseTotal / 60))` (lo que la fase duró de
    verdad, no lo que digan los ajustes ahora).
  - Si era `work`: registra `mode: "pomodoro"` con el tipo actual; `cycleCount++`;
    siguiente fase = `long` si `cycleCount % cycles === 0`, si no `short`. Aviso:
    `Sesión guardada. Toca un descanso largo.` / `Sesión guardada. Toca un descanso corto.`
  - Si era descanso: registra `type: "Descanso"`, `mode: "break"`; `session++`; fase
    `work`. Aviso: `Descanso terminado. ¡A concentrarse!`
  - `phaseTotal = remaining = duración de la nueva fase`, y queda **en reposo**: la
    siguiente fase **no arranca sola**.
- Pantalla: reloj `MM:SS` · anillo = `1 − remaining/phaseTotal` (acotado 0–1; con 0 %
  el trazo se oculta para no dejar un punto suelto) · debajo del reloj `Tiempo de
  trabajo` / `Descanso corto` / `Descanso largo` · línea `Sesión {session} · Ciclo
  {min(cycles, cycleCount % cycles + 1)} de {cycles}` + punto de color y ruta de la
  carpeta activa · trazo con **degradado de los 3 colores de la escena** en trabajo y
  color `break` en descansos.
- Botón principal con icono play/pausa y etiqueta accesible `Iniciar` / `Pausar` /
  `Reanudar`. Pulsar Intro en el campo de tipo inicia si no está en marcha.

### 4.3 Cronómetro (`timer.js`)
- Cuenta hacia adelante: `startedAt = ahora − elapsed`; `elapsed = round((ahora −
  startedAt)/1000)`. Nunca termina solo.
- Pantalla: `H:MM:SS` si hay horas (la hora sin cero a la izquierda), si no `MM:SS` ·
  anillo = `(elapsed % 3600) / 3600` (una vuelta por hora) · debajo del reloj
  `Cronómetro` · línea `Contando…` / `En pausa` / `Una vuelta del anillo = 1 hora` · trazo
  con el degradado de la escena.
- **Guardar sesión**: pausa si corre; `mins = round(elapsed/60)`.
  - `mins < 1` → error `Muy corto para registrar: el mínimo es 1 minuto`, **no registra
    ni reinicia**.
  - `mins > 600` → registra 600 y avisa `Sesión muy larga: se registran 600 min (10 h)`.
  - Registra `mode: "cronometro"`, aviso `Sesión de {fmtMin} registrada`, reinicia.
- En modo Cronómetro los tiempos del Pomodoro se pueden ver pero con la nota
  `En modo Cronómetro estos tiempos no se usan.`
- Cambiar de modo con algo en marcha **o en pausa** pide confirmación: título `Cambiar de
  modo`, mensaje `El temporizador actual se reiniciará y el tiempo en curso no se
  guardará.`, botón `Cambiar de modo`. Al aceptar se cambia el modo y se reinicia.

### 4.4 Sesión manual, tipo y saludo (`timer.js`)
- **Manual**: título `Registrar sesión manual`, subtítulo `Se guarda como {tipo} en {ruta
  de la carpeta activa}.`, campo `Minutos` (placeholder `Por ejemplo, 45`, teclado
  numérico). Valor redondeado; fuera de 1–600 → error `Escribe un número de minutos entre
  1 y 600`. Registra `mode: "manual"` con fecha/hora = ahora, aviso `Sesión manual de
  {fmtMin} registrada`.
- **Tipo**: campo libre "¿Qué vas a estudiar?" (máx. 40), vacío = `General`.
- **Recomendados**: los **3 tipos más frecuentes** (por número de sesiones, sin
  descansos, **sin** aplicar el filtro de carpeta). Tocar uno rellena el campo; el chip
  igual al texto del campo se resalta. Sin historial → no se muestran.
- Toda sesión nueva se registra en la **carpeta activa**.
- **Saludo**: `{saludo}, {usuario}` con `Buenas noches` si hora < 6, `Buenos días` < 13,
  `Buenas tardes` < 20, si no `Buenas noches`.

### 4.5 Carpetas (`folders.js`, `store.js`)
- **Activa ≠ Filtro.** *Activa* = dónde se guardan las sesiones nuevas (persistida en
  el backend como `active_category_id`; solo carpetas no archivadas). *Filtro* = qué se
  ve en mini-métricas, Estadísticas y Registro (solo local; primera opción `Todas las
  carpetas`; muestra las archivadas con la nota `archivada`).
- **Filtrar por una carpeta incluye todos sus descendientes** (`descendantIds`: recorre
  `parent_id` con tope de 100 iteraciones para no colgarse con datos corruptos).
- Al recargar carpetas: si la activa desaparece o está archivada → pasa a la primera no
  archivada. Si la filtrada desaparece → filtro a "Todas".
- **Lista/árbol**: se pinta tal como llega (ya viene en preorden) con sangría por
  `depth`; punto de color + nombre; insignias `activa` y `archivada`; horas de estudio de
  la carpeta **sumando sus subcarpetas** (sin descansos, sobre todo el historial, con
  `fmtHours`, o `—` si no hay). `path` completo como descripción accesible.
- **Menús con buscador**: si hay más de 7 opciones aparece `Buscar…`; busca en la ruta
  completa sin distinguir mayúsculas ni acentos (minúsculas + NFD sin marcas diacríticas).
- **Acciones de una carpeta** (en este orden): `Usar como carpeta activa` (deshabilitada
  si está archivada o ya es la activa) · `Filtrar por esta carpeta` / `Quitar filtro` ·
  `Nueva subcarpeta…` (deshabilitada si está archivada) · `Renombrar…` · `Mover…` ·
  `Archivar` / `Restaurar` · `Eliminar…` (en rojo).
- **Crear**: nombre (máx. 30) + color + ubicación (`En la raíz` o una carpeta no
  archivada). Aviso `Carpeta «{nombre}» creada`. **Subcarpeta**: solo pide el nombre
  (placeholder `Por ejemplo, Unidad 1`, texto `Se creará dentro de {ruta}.`) y hereda el
  color del padre.
- **Renombrar**: actualiza también `category_name` en la caché local. Aviso `Carpeta
  renombrada`.
- **Mover**: texto `Elige dónde debe quedar {nombre}. Sus subcarpetas se mueven con
  ella.`; destinos = `En la raíz (sin carpeta padre)` + carpetas **no archivadas**,
  deshabilitando ella misma y sus descendientes; valor inicial = su padre actual. Aviso
  `Carpeta movida`.
- **Archivar** baja en cascada a los descendientes; **restaurar** sube a los ancestros.
  No se puede archivar la única carpeta activa (el backend lo impide; muestra su error).
  Avisos `Carpeta archivada` / `Carpeta restaurada`.
- **Eliminar** (definitivo, subárbol completo):
  - Resumen: `Vas a eliminar {nombre} [y su subcarpeta | y sus N subcarpetas]. Contiene
    {1 sesión | N sesiones}.` (el recuento incluye descansos) + aviso `No se puede
    deshacer. Si solo quieres quitarla de en medio sin perder nada, archívala.`
  - Si hay sesiones, pregunta `¿Qué hacemos con esa sesión?` / `¿Qué hacemos con esas
    sesiones?` con **Moverla(s) a otra carpeta** (*El tiempo registrado se conserva en tus
    estadísticas.*; solo si hay destinos) y **Eliminarla(s) también** (*Desaparece(n) del
    historial y de las estadísticas para siempre.*). Por defecto, mover si se puede.
  - Destinos para mover: carpetas no archivadas fuera del subárbol (sin raíz). Destino
    inicial = su carpeta padre si es válida, si no el primero.
  - **Solo si se van a borrar sesiones** hay que escribir `ELIMINAR` (sin distinguir
    mayúsculas) para habilitar el botón.
  - Tras la respuesta: refleja el cambio en la caché local (reasignar o quitar las
    sesiones de `deleted_ids`), quita el filtro si apuntaba a una borrada, toma
    `active_category_id` de la respuesta y recarga carpetas. Aviso `Carpeta eliminada ·
    N sesiones movidas` / `Carpeta eliminada · N sesiones eliminadas` / `Carpeta
    eliminada`.
- **Reasignar una sesión** solo es posible si ya tiene id de servidor; el selector
  muestra las carpetas no archivadas más la actual aunque esté archivada. Aviso `Sesión
  movida a {nombre}`. Las pendientes de sincronizar muestran el nombre sin selector.

### 4.6 Métricas y gráficos (`metrics.js`, `stats.js`)
Sobre `S` = sesiones del filtro actual **sin** `mode === "break"`. Orden de los 8
indicadores:

| Indicador | Valor | Texto secundario |
|---|---|---|
| Esta semana | Σ min de `S` con `date >= daysAgo(6)` (`fmtMin`) | Compara con `daysAgo(13)…daysAgo(7)`: sin datos → `sin datos de la semana anterior`; `d = round((sem − ant)/ant·100)`; 0 → `igual que la semana anterior`; si no `+d% vs. semana anterior` (color `good`) o `−d% vs. semana anterior` (signo menos U+2212, color `danger`) |
| Hoy | Σ min con `date === hoy` (`fmtMin`) | `1 sesión` / `N sesiones` |
| Racha | `N día` / `N días` (actual) | `máx. N día(s)`. Un día cuenta con ≥ **1** min. Máx. = mayor tramo de días consecutivos. Actual = empieza en hoy si hay registro, si no en ayer, si no 0; cuenta hacia atrás |
| Regularidad | `round(activos / 7 · 100)` % | `{activos} de 7 días con 20+ min` (activos = días `daysAgo(0..6)` con ≥ 20 min) |
| Total estudiado | Σ min de `S` (`fmtHours`) | `en todo tu historial` |
| Sesiones | `S.length` | `de estudio registradas` |
| Descanso activo | Sobre el filtro **con** descansos: `round(min_descanso / min_estudio · 100)` % (0 si no hay estudio) | Sin descansos → `sin descansos registrados`; < 15 → `bajo · meta ~20%`; ≤ 30 → `en el rango ideal`; si no `alto · meta ~20%` |
| Enfoque Pomodoro | `round(min pomodoro / total · 100)` % (0 si total 0) | `del tiempo estudiado` |

**Mini-métricas del Timer** (respetan el Filtro): Racha `N día(s)` · Hoy `fmtMin` ·
Semana `fmtMin`.

**Formato:**
- `fmtMin(m)`: `< 60` → `45 min`; si no `2 h` (exacto) o `2 h 05 min` (resto con 2 dígitos).
- `fmtHours(m)`: `>= 60` → `round(m/60) h`; si no `m min`.
- `prettyDate`: `Hoy`, `Ayer` o `{día} {n} {mes}` con días `dom lun mar mié jue vie sáb`
  y meses `ene feb mar abr may jun jul ago sep oct nov dic`.
- Subtítulo de la pantalla: `Filtrado por {ruta}` o `Todas las carpetas`.

**Gráficos:**
- **Escala de columnas** (`niceScale`): pasos `[15, 30, 60, 120, 180, 300, 600, 1200,
  1800, 3000, 6000, 12000]`; se elige el primero con `max/paso <= 4`; tope =
  `max(paso·2, ceil(max/paso)·paso)`; marcas de 0 al tope; etiqueta en horas
  (`+(v/60).toFixed(1) h`) si el paso es ≥ 60, si no el número. Columnas con extremo
  superior redondeado, color acento al **42 %** de opacidad y **100 %** las resaltadas;
  líneas de guía color `line`; textos 11 px color `muted`; etiquetas de valor en `text`
  600.
- **Últimos 7 días**: días `daysAgo(6) … hoy`; etiqueta del eje `hoy` para el último y
  `dom…sáb` para el resto; hoy resaltado; etiqueta de valor sobre hoy y sobre el máximo.
  Detalle al tocar: `{fmtMin}` + `Hoy` o `{día} {n} {mes}`. Vacío → `Aún no hay sesiones
  en este periodo`.
- **Densidad por hora** (`hoursSeries`): la sesión se registra al **terminar**, así que
  sus minutos se reparten **hacia atrás** desde `time` (o `hour·60+30` si falta),
  cruzando la medianoche si hace falta. Se resaltan todas las horas con el máximo; eje
  cada 3 horas `HH:00`; etiqueta de valor sobre el máximo. Subtítulo `tu franja más
  productiva: HH:00–HH:00` (con ` y ` para un segundo pico; máximo 2) o `tiempo por hora
  del día`. Detalle: `{fmtMin}` + `de HH:00 a HH:00`.
- **Distribución por tema** (dona + leyenda): totales por `type` sobre `S`, orden desc;
  con más de 6 tipos se muestran los 5 primeros + `Otros`. **El color sigue al tipo**:
  se ordenan los tipos por su total en **todo** el historial (sin filtro, sin descansos;
  empates alfabéticos) y el índice `i < 8` usa `cat-{i+1}`; el resto y `Otros` usan
  `cat-other`. Separación de ~2 px entre porciones. Centro: `fmtHours(total)` + `en
  total`. Leyenda: color, nombre, `fmtHours`, `%`. Vacío → `Aún no hay sesiones
  registradas`.
- **Calendario de consistencia**: últimas **26 semanas** en columnas que empiezan en
  **lunes** (inicio = hoy − días desde el lunes − 25·7); celdas futuras vacías; nivel por
  minutos/día: 0 → 0 · < 25 → 1 · < 60 → 2 · < 120 → 3 · resto → 4; colores: `track` y
  acento mezclado sobre `track` al 30/55/78/100 %. Etiqueta de mes sobre la columna
  cuando cambia (se omite en la primera si su fecha es > 24). Leyenda `Menos … Más`.
  Detalle: `{fmtMin | Sin estudio}` + `{día} {n} {mes}`. En móvil: scroll horizontal que
  arranca mostrando hoy.

### 4.7 Registro (`log.js`)
- Filas: sesiones del filtro sin descansos, **más recientes primero**; filtros **tipo**
  (tipos reales del filtro actual, ordenados alfabéticamente, primera opción `Todos los
  tipos`) y **periodo** `Hoy` · `Últimos 7 días` (por defecto) · `Últimos 30 días` ·
  `Todo el historial` (desde `daysAgo(días − 1)`).
- Resumen: `N sesión/sesiones · {fmtMin del total}`.
- Cada sesión: fecha (`prettyDate`), hora, duración (`fmtMin`), tipo, insignia de modo
  (`Pomodoro` / `Cronómetro` / `Manual`) y carpeta (ruta + ` (archivada)` si lo está).
- Insignias: fondo acento al 18 % (pomodoro), `cat-2` al 20 % (manual), `cat-3` al 20 %
  (cronómetro); texto color `text`.
- Vacío: `No hay sesiones con estos filtros. Prueba con otra carpeta o un periodo más
  largo.`
- **Borrar historial**: título `Borrar todo el historial`, mensaje `Se eliminan todas tus
  sesiones, también en el servidor. No se puede deshacer.`, botón `Borrar historial` →
  aviso `Historial borrado`.

### 4.8 Apariencia y escenas (`settings.js`, `scenes.js`, `app.js`, `tokens.css`)
- Tema **oscuro** (por defecto) o **claro**, sincronizado con `POST /api/preferences
  {theme}`.
- **Acento** por defecto `#3b82f6`; presets `#3b82f6` Azul · `#6366f1` Índigo ·
  `#0ea5e9` Celeste · `#10b981` Verde · `#f59e0b` Ámbar · `#ec4899` Rosa · `#ef4444` Rojo;
  más un campo hex validado con la regex del backend. Se aplica al instante y se guarda
  con `{accent}` (con el personalizado, espera 600 ms sin cambios antes de enviarlo).
- **Catálogo de escenas**, en este orden, con sus 3 colores (`s1, s2, s3`):

  | id | Nombre | Foto y miniatura | Colores |
  |---|---|---|---|
  | `road` (por defecto) | Carretera | `static/scenes/road.jpg` · `road-thumb.jpg` | `#E8875F #B77AA8 #F2B36F` |
  | `blossom` | Cerezos | `static/scenes/blossom.jpg` · `blossom-thumb.jpg` | `#E59BC4 #78B4E4 #B69AD8` |
  | `dusk` | Atardecer | — | `#FB923C #DB2777 #FBBF24` |
  | `ocean` | Océano | — | `#38BDF8 #6366F1 #2DD4BF` |
  | `forest` | Bosque | — | `#4ADE80 #A3E635 #2DD4BF` |
  | `nebula` | Nebulosa | — | `#E879F9 #A855F7 #6366F1` |
  | `none` | Sin escena | — | `#A8A29E #78716C #D6D3D1` |

  Empaqueta las 4 imágenes existentes. En la web, `dusk`, `ocean` y `forest` están
  preparadas para tener foto pero hoy no hay archivo: se ven solo con sus colores. Si
  algún día se añaden fotos a `static/scenes/`, habrá que copiarlas a la app y publicar
  una versión nueva (anótalo en `mobile/README.md`).
- **Fondos propios** `bg:<id>`: nombre, colores e imágenes desde `/api/backgrounds`
  (descargadas con el Bearer y cacheadas; nunca cambian para una misma URL). Una escena
  desconocida o un `bg:<id>` que ya no está en la lista se muestra como `road`.
- **Cómo se ve**: la foto va **detrás del Timer y del login**, con el velo
  `rgba(21,20,19,.40) → .66 (55 %) → .82` y textos encima en `#F4F2EE` /
  `rgba(244,242,238,.8)` en ambos temas. Sin foto: fondo liso `bg`. Los 3 colores de la
  escena tiñen el **anillo**, la **marca** y la **Live Activity** en toda la app; con
  fondos propios se usan sus `colors` (completando con los de `road` si faltan).
- **Elegir escena en el móvil** (hoja `Escena de fondo`, abierta desde un botón con el
  icono `image` en la cabecera del Timer y desde Ajustes › Apariencia):
  - Sección `Escenas`: una baldosa por escena del catálogo con su miniatura, o un
    degradado a 135° de sus 3 colores si no tiene foto, y su nombre.
  - Sección `Tus fondos` (solo si hay): baldosas con `thumb_url` y el nombre del fondo.
  - La baldosa elegida lleva una marca de verificación y `accessibilityState.selected`.
  - Nota al pie: `Para subir o borrar tus propios fondos, usa la web.`
  - Al tocar una: se aplica al instante (foto, anillo, marca), se actualiza la copia
    local de la apariencia y se envía `POST /api/preferences {scene}`. Si el backend
    responde error, muéstralo tal cual; la siguiente sincronización de `/api/me` deja la
    escena que haya en el servidor.
  - Sin conexión: baldosas deshabilitadas con el texto `Necesitas conexión para cambiar
    la escena.`
- **Temas de legado**: si `/api/me` trae `theme` `ocean` o `forest`, muestra tema oscuro
  con esa escena y, como hace la web (`app.js`), envía una vez `{theme: "dark", scene}`.
- Guarda una copia local de la apariencia (tema, acento, escena, colores y ruta local de
  la foto) para pintar sin parpadeo antes de `/api/me`.

**Tokens de diseño (copiar de `static/css/tokens.css`):**

| Token | Oscuro | Claro |
|---|---|---|
| `bg` | `#151413` | `#F7F6F4` |
| `side` (barra de pestañas) | `#1C1B19` | `#EDEBE7` |
| `surface` | `rgba(44,41,38,.55)` | `rgba(255,255,255,.6)` |
| `surfaceSolid` | `#262422` | `#FFFFFF` |
| `text` | `#F2F0EC` | `#1C1B19` |
| `muted` | `#A8A39B` | `#69655E` |
| `line` | `rgba(242,240,236,.11)` | `rgba(28,27,25,.10)` |
| `hover` | `rgba(242,240,236,.07)` | `rgba(28,27,25,.06)` |
| `selBg` | `rgba(242,240,236,.1)` | `rgba(28,27,25,.085)` |
| `track` | `rgba(242,240,236,.09)` | `rgba(28,27,25,.08)` |
| `ink` / `inkFg` (botón primario) | `#F2F0EC` / `#151413` | `#1C1B19` / `#FFFFFF` |
| `focus` | `#7FB0FF` | `#2F6FEB` |
| `good` | `#6CCB5F` | `#107C10` |
| `danger` / `dangerSolid` | `#FF99A4` / `#D13438` | `#C42B1C` / `#C42B1C` |
| `break` | `#5CC8B8` | `#0E8A7A` |
| `menuBg` (hojas) | `#2A2826` | `#FFFFFF` |
| `overlay` | `rgba(0,0,0,.55)` | `rgba(20,18,16,.35)` |
| `toastBg` / `toastFg` | `#F2F0EC` / `#151413` | `#1C1B19` / `#FFFFFF` |
| `cat-1…8` | `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767` | `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #4a3aa7 #e34948` |
| `cat-other` | `#6f6b66` | `#a8a29e` |

Comunes: tarjetas con radio 20 y borde de 1 px `line` · botones en píldora (radio =
alto/2) · campos radio 12 · compositor radio 26 · hojas radio 22 · anillo con trazo de
5/120 del diámetro y extremos redondeados · reloj en Open Sans 600, 50 pt (42 en
pantallas estrechas) con **cifras tabulares** · indicadores 26 pt 600 · marca: icono
`timer` blanco sobre un cuadrado con radios 9/9/9/3 y degradado cónico de los colores de
la escena.

### 4.9 Música lo-fi (`music.js`)
- **El sonido**: `buildLofi()` genera en tiempo real un lo-fi a **74 BPM** (semicorcheas
  con swing de 0,33) con piano eléctrico FM, bajo triangular, bombo, caja, charles, siseo
  y chasquidos de vinilo, saturación de cinta y ondulación de afinación. Recorre
  `LOFI_PROGRESSIONS` y cambia de progresión al azar cada 8 compases; la batería entra en
  el segundo compás y descansa uno de cada 16. Nivel del sonido `0.85`. En el móvil se
  usa **ese mismo generador renderizado a un archivo** (Fase 8).
- **Preferencias** (por dispositivo; la web usa `localStorage`): `sound` (`null` = sin
  música, o `lofi`), `volume` 0–100 (por defecto **60**), `sync` (por defecto **sí**).
  Ganancia aplicada = `(volume/100)²`.
- **Controles** (panel de la barra superior y Configuración › Música en la web):
  - Baldosas `Sin música` (*silencio*) y `Lo-fi` (*beats relajados*, degradado
    `#FDBA74 → #9333EA`, barras de ecualizador animadas mientras suena).
  - Tocar `Lo-fi` la reproduce; tocarla mientras suena la pausa. `Sin música` la detiene
    y quita la selección.
  - Botón play/pausa (`Reproducir música` / `Pausar música`): si no hay nada elegido,
    elige `Lo-fi`.
  - Slider de volumen con el porcentaje al lado.
  - Interruptor `Sincronizar con el temporizador` · *Suena mientras trabajas y se pausa en
    las pausas y los descansos*.
  - Estado: `Sonando: Lo-fi` / `En pausa: Lo-fi` / sin elección `Lo-fi para concentrarte`
    (la web dice `Lo-fi, lluvia, olas y más`; en el móvil solo hay lo-fi).
- **Sincronización con el temporizador**: *quiere música* = en marcha **y** (modo
  cronómetro **o** fase `work`). Solo se actúa **cuando ese valor cambia**, con `sync`
  activado y un sonido elegido: pasa a sí → reproducir; pasa a no → pausar. Reiniciar un
  reloj parado no pausa nada. Activar `sync` mientras el temporizador *quiere música* la
  arranca.
- **Fundidos**: al reproducir sube al volumen en ~0,6 s (la primera vez, ~1,5 s); al
  pausar baja a 0 en ~0,5 s y después se pausa de verdad (no gasta batería en silencio).
- **La alarma se oye por encima**: al terminar una fase la música baja al **20 %** en
  0,15 s, se mantiene hasta los 2,2 s y vuelve al 100 % a los 3,5 s.

### 4.10 Notificaciones del móvil (textos de fin de fase tomados de `notifications.js`)
Tres tipos, cada uno con su interruptor en Ajustes › Notificaciones (todos activados por
defecto una vez concedido el permiso). *Actividad* = el tipo escrito, o `concentración`
si es `General`.

| Tipo | Cuándo | Contenido | Al tocar |
|---|---|---|---|
| **Fin de fase** (dos interruptores: pomodoros y descansos, como en la web) | En el `endTime` de una fase Pomodoro en marcha | Trabajo: título `Pomodoro terminado`, texto `{fmtMin} de {actividad}. Toca un descanso {corto\|largo} de {fmtMin del descanso}.`, acción `Empezar descanso`. Descanso: `Descanso terminado` / `Es hora de volver: {fmtMin del trabajo} de {actividad}.`, acción `Empezar pomodoro` | Abre el Timer |
| **Temporizador en curso** | Mientras un Pomodoro o un Cronómetro está en marcha o en pausa | Android: notificación fija con cronómetro nativo. iPhone: Live Activity en la pantalla de bloqueo y la Dynamic Island | Abre el Timer |
| **Resumen semanal** | Domingo a las **19:00** hora local (hora configurable) | Ver abajo | Abre Estadísticas |

**Fin de fase**
- Se programa al iniciar o reanudar y se cancela al pausar, reiniciar o cambiar de modo.
  En modo Cronómetro no se programa nada.
- La fase siguiente se calcula al programar: larga si `(cycleCount + 1) % cycles === 0`.
- Sonido = la alarma de la app (`.wav` empaquetado; en iOS ≤ 30 s) + vibración. Android:
  canal `Fin de fase`, importancia alta. iOS: nivel de interrupción **`timeSensitive`**
  (necesita el entitlement `com.apple.developer.usernotifications.time-sensitive`) para
  que atraviese los modos de concentración si el usuario lo permite.
- **Con la app en primer plano no se muestra el aviso del sistema**: basta la alarma y el
  aviso dentro de la app (la web hace lo mismo).
- La acción **Empezar…** solo arranca la fase si, tras completar la anterior, el reloj
  sigue esperando **esa misma fase** (modo Pomodoro, en reposo, `phase` igual). En Android
  se procesa **sin abrir la app** (evento en segundo plano); en iPhone abre la app y
  arranca la fase.

**Temporizador en curso — Android**
- Canal `Temporizador en curso`, importancia baja, sin sonido ni vibración; `ongoing`
  mientras corre (no se descarta deslizando).
- Título `{Tiempo de trabajo | Descanso corto | Descanso largo | Cronómetro} ·
  {actividad}`; texto: ruta de la carpeta activa; color de acento: `s1` de la escena.
- **En marcha**: cronómetro nativo **hacia atrás hasta `endTime`** (Pomodoro) o **hacia
  delante desde `startedAt`** (Cronómetro), sin que la app tenga que actualizarlo. Acción
  `Pausar`. En Pomodoro desaparece sola en `endTime` (`timeoutAfter`) y deja paso al fin
  de fase.
- **En pausa**: texto fijo `En pausa · quedan MM:SS` (Pomodoro) o `En pausa · H:MM:SS`
  (Cronómetro) y acción `Reanudar`.
- Pausar y Reanudar desde la notificación **con la app cerrada** aplican el mismo
  `reduce()` sobre el estado persistido y vuelven a planificar todas las notificaciones.
- Si la música suena, Android mostrará además su notificación multimedia: es aceptable.

**Temporizador en curso — iPhone (Live Activity, iOS 16.1+)**
- Pantalla de bloqueo: marca, fase y actividad, tiempo con **contador nativo**
  (`Text` con `timerInterval` de `@expo/ui`: `countsDown` hasta `endTime` en Pomodoro, o
  hacia delante desde `startedAt` en Cronómetro) y una barra o anillo con los colores de
  la escena. En pausa: tiempo fijo y `En pausa`.
- Dynamic Island: compacta = icono `timer` + tiempo; mínima = icono; expandida = fase,
  actividad, tiempo y carpeta.
- Se inicia al empezar, se actualiza al pausar y reanudar, y se termina (retirada
  inmediata) al reiniciar, cambiar de modo, cerrar sesión o procesar el fin de fase.
  `staleDate = endTime` para que el sistema la marque como vencida si la app no se
  despierta a tiempo.
- Botones `Pausar`/`Reanudar` **solo** si `expo-widgets` permite acciones interactivas en
  el SDK instalado sin abrir la app; si no, tocarla abre el Timer.

**Resumen semanal**
- Título `Tu semana en FocusData`.
- Con estudio: `{fmtMin de la semana} de estudio · {comparación} · racha de {N} día(s)`,
  donde comparación = `+d% que la semana anterior` / `−d% que la semana anterior` /
  `igual que la semana anterior`, y se omite si la semana anterior no tiene datos. La
  racha se omite si es 0.
- Sin estudio: `Esta semana no registraste estudio. ¿Empezamos el lunes?`
- Semana = los 7 días que terminan ese domingo (coincide con "Esta semana" de §4.6),
  **todas las carpetas**, sin descansos.
- Solo existe **una** notificación programada (la del próximo domingo). Su texto se
  calcula al programarla con las sesiones que conoce el teléfono, y se vuelve a calcular
  al arrancar, tras cada sincronización, al registrar una sesión y al cambiar el ajuste.
  Texto de ayuda en Ajustes: `Se calcula con lo sincronizado en este teléfono.`
- Android: canal `Resumen semanal`, importancia normal. iOS: nivel `active`.

**Permisos**
- Explicación propia **antes** del diálogo del sistema, la primera vez que se pulsa
  Iniciar o se activa un aviso: título `Activa los avisos`, texto `Te avisamos al terminar
  cada pomodoro y cada descanso, te mostramos el tiempo que queda en la pantalla de
  bloqueo y cada domingo te enviamos tu resumen.`, botones `Activar` / `Ahora no`.
  `Ahora no` no vuelve a preguntar sola; Ajustes ofrece activarlos.
- Denegado → Ajustes muestra `Bloqueadas en el sistema` + `Abrir ajustes`. Se revisa al
  volver a primer plano.
- **Android 13+**: permiso `POST_NOTIFICATIONS`.
- **Android 12+, avisos a la hora exacta**: `SCHEDULE_EXACT_ALARM`, que en Android 14 viene
  **denegado por defecto**. Fila `Avisos a la hora exacta` con el texto `Sin este permiso,
  Android puede retrasar el aviso de fin de fase varios minutos.` y el botón `Permitir`
  (abre la pantalla del sistema). Sin permiso se programa inexacto; la notificación en
  curso sigue mostrando la hora correcta. **No declares `USE_EXACT_ALARM`**: Android lo
  reserva para apps de calendario y de despertador.
- iOS: si el usuario desactivó los avisos urgentes (*time-sensitive*) o las Live
  Activities en el sistema, Ajustes lo indica.

**Coherencia**
- Una función pura `planNotifications(timer, prefs, permisos, resumen, ahora)` devuelve
  el conjunto deseado: ids fijos `fase`, `en-curso`, `resumen-semanal` + estado de la Live
  Activity. Un aplicador lo compara con lo programado y crea, actualiza o cancela.
- Se ejecuta tras cada transición del timer, al arrancar, al volver a primer plano, tras
  sincronizar, al cambiar ajustes o permisos y al cerrar sesión (que lo cancela todo).
- Tras **reiniciar el teléfono**, el fin de fase pendiente debe seguir llegando; si la
  librería no vuelve a registrar las alarmas al arrancar, se reconcilia al abrir la app y
  se documenta.
- Ajustes incluye `Probar notificación`.

---

## 5. Problemas de la web: estado actual y qué hace el móvil

| # | Problema | Estado en la web | Móvil |
|---|---|---|---|
| 1 | **Resurrección de sesiones borradas.** `syncSessions()` ([store.js](static/js/store.js)) sube *cualquier registro local que no esté en el servidor*. Si otro dispositivo borró sesiones (Borrar historial o eliminar carpeta), esa caché las vuelve a subir | **Abierto** → lo corrige la **Fase 3**. Con dos clientes pasará a menudo | **Cola de envío explícita** (Fase 5): solo sube lo que él mismo creó y aún no confirmó |
| 2 | **Envíos no idempotentes.** El POST inserta aunque el `ts` exista; un reintento o dos pestañas abiertas duplican sesiones | **Abierto** → lo corrige la **Fase 2** en el servidor | Reintenta sin miedo gracias a la Fase 2 |
| 3 | **Pérdida al registrar sin red.** Si falla por red, la sesión queda en la caché y se sube al volver a abrir la web; no hay reintento ni aviso | Parcial (errores del servidor sí se avisan) | Cola con reintentos y contador visible de pendientes |
| 4 | **`time` depende del idioma del navegador** (`toLocaleTimeString('es')`) | **Abierto** → lo corrige la **Fase 3** | Genera `HH:MM` a mano (§4.1) |
| 5 | **Estado del timer en memoria.** Recargar pierde el conteo | Abierto (fuera de alcance) | Estado persistido (Fase 6) |
| 6 | **Límite de intentos de login por `remote_addr`**: detrás del proxy de PythonAnywhere todos los usuarios podrían compartir IP | Abierto | Verifica qué cabecera llega (p. ej. `X-Real-IP`) antes de publicar; si hay que cambiarlo, **pregunta** |
| 7 | **Sin recuperación de contraseña** (no se guarda email) | Abierto | Vincular Google o Apple (Fases 13–15) da una vía de recuperación |
| — | "Esta semana" dependiente de la zona horaria · filtro de tipos con lista fija | **Corregidos** en el rediseño | Replica la definición actual (§4.6, §4.7) |

---

## 6. Reglas invariables

1. **No romper la web.** No cambies ni elimines rutas, claves JSON ni el flujo de cookie.
   Solo **añadir**. Los **63 tests** actuales pasan en todas las fases sin modificarlos.
2. **Compatibilidad hacia atrás permanente.** La web se actualiza al desplegar, la app no:
   siempre habrá versiones antiguas instaladas. Ningún campo ni ruta que use la app se
   renombra o elimina después de publicarla.
3. **La web solo se toca en las Fases 3 y 14**, y solo en lo que esas fases indican. El
   renderizado de la música (Fase 8) **copia** el código de `music.js` a un script de
   `mobile/`; no modifica `music.js`.
4. **Migraciones idempotentes** en `init_db()`: las de esquema protegidas con
   `PRAGMA table_info` / `CREATE ... IF NOT EXISTS`; las de datos que deben aplicarse una
   sola vez, registradas en la tabla `migrations` (patrón ya existente). Haz copia de
   `study.db` antes de tocar el esquema.
5. **`ts`, `date`, `time`, `hour`** con los formatos de §4.1. Nunca normalices ni
   reformatees un `ts` recibido.
6. **Credenciales.** El token de la app nunca va a AsyncStorage, logs ni mensajes de
   error: solo SecureStore. En el servidor los tokens de la app se guardan **hasheados**
   (SHA-256). Los tokens de Google **no se guardan**. El *refresh token* de Apple se
   guarda **cifrado** y solo para poder revocarlo.
7. **Lógica de dominio pura** (timer, métricas, árbol, fechas, formato, música,
   planificación de notificaciones) en `mobile/src/domain/` sin importar React ni Expo,
   con tests unitarios.
8. **Textos en español.** Accesibilidad: `accessibilityLabel` en todo control con solo
   icono, objetivos táctiles ≥ 44 pt, respeto a *reducir movimiento*.
9. **No inventes endpoints** más allá de los de las Fases 1, 2 y 13. Si falta algo,
   pregunta.
10. **Un commit por fase** con el mensaje indicado. Rama `feature/app-movil`.
11. **Sin secretos en el repo.** La URL de la API va en `EXPO_PUBLIC_API_URL`
    (`mobile/.env`, ignorado por git; incluye `mobile/.env.example`). Los ids de cliente
    de Google van en variables de entorno de EAS y del servidor. La clave `.p8` de Apple,
    la clave de cifrado y cualquier secreto del servidor van en variables de entorno o en
    archivos **fuera del repo** en PythonAnywhere. `node_modules/`, `.expo/`, los
    artefactos de compilación y los `.wav` intermedios de `mobile/` también se ignoran.
12. **No instales programas en el sistema** (Android Studio, ffmpeg, versiones de Node…)
    ni crees cuentas o proyectos en Google Cloud o Apple Developer: pide al usuario que
    lo haga o que lo autorice.

---

## FASE 0 — Pre-vuelo

1. `git status`: si el único cambio es este documento sin versionar, **pregunta** si
   confirmarlo en `main` antes de crear la rama. Con el árbol limpio, crea
   `feature/app-movil`.
2. Copia de seguridad: `cp study.db "study.db.pre-movil-$(date +%Y%m%d)"`.
3. Línea base: `venv/Scripts/python.exe -m pytest -q` → **63 en verde**;
   `venv/Scripts/python.exe ver_db.py` → anota el total de sesiones. **Ese número no debe
   bajar.**
4. Herramientas (solo comprobar e informar):
   - `node -v`, comparada con las versiones que admite el SDK de Expo según su
     documentación. Hay instalada una Node 26; si no es compatible, pregunta antes de
     instalar una LTS.
   - Android Studio o emulador: `adb` no está en el PATH hoy.
   - `ffmpeg` (necesario en la Fase 8): hoy **no está instalado**; se puede instalar con
     `winget`.
   - Google Chrome y Microsoft Edge **sí están instalados**.
5. Pregunta al usuario, sin bloquear las primeras fases:
   - si tiene **cuenta de Apple Developer** (necesaria desde la Fase 7 para probar en
     iPhone y en las Fases 15–16);
   - si tiene un **proyecto de Google Cloud** (necesario en las Fases 13–15);
   - si su cuenta de PythonAnywhere es gratuita o de pago. Las gratuitas solo pueden
     conectar con dominios permitidos; hoy la lista incluye `.googleapis.com`,
     `.google.com` y `.apple.com`, que son los que usa la Fase 13.
6. Lee `app.py`, `tests/test_api.py` y, de `static/js/`, `store.js`, `util.js`,
   `timer.js`, `metrics.js`, `stats.js`, `log.js`, `folders.js`, `settings.js`,
   `scenes.js`, `app.js`, `notifications.js` y, de `music.js`, las partes de lo-fi
   (`buildLofi`, `LOFI_PROGRESSIONS`, `tapeSaturation` y sus auxiliares) y de
   reproducción y sincronización (`play`, `pause`, `pick`, `initMusic`). Lee también
   `static/login.html`. Confirma que este documento sigue siendo fiel e informa de
   cualquier diferencia antes de continuar.

**Sin commit.**

---

## FASE 1 — Backend: autenticación por token

Solo se tocan `app.py` y `tests/test_api.py`.

### 1.1 Tabla
```sql
CREATE TABLE IF NOT EXISTS api_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    token_hash   TEXT    NOT NULL UNIQUE,
    device_name  TEXT    NOT NULL DEFAULT '',
    created_at   TEXT    NOT NULL,
    last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
```

### 1.2 Carga de usuario por cabecera
Añade un `@login_manager.request_loader` que lea `Authorization: Bearer <token>`, busque
`sha256(token)` en `api_tokens`, actualice `last_used_at` y devuelva `User`. Así
**todas** las rutas `@login_required` existentes (incluidas `/api/backgrounds/*` y las
exportaciones) funcionan con token sin tocarlas, y la cookie de la web sigue igual.
Genera tokens con `secrets.token_urlsafe(32)`.

### 1.3 Endpoints nuevos
| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/api/auth/login` | `{username, password, device_name?}` | `200 {ok, token, user: {id, username}}` · mismos 401/429 que `/api/login` |
| POST | `/api/auth/register` | `{username, password, device_name?}` | `200 {ok, token, user}` · mismos 400/409 que `/api/register` (misma carpeta "General" activa y mismas preferencias por defecto) |
| POST | `/api/auth/logout` | — (token en cabecera) | `{ok}` y revoca **ese** token |

- **No dupliques lógica**: extrae la validación y creación de cuenta, la emisión de
  tokens y la comprobación de credenciales (con el freno de fuerza bruta) a funciones
  compartidas que usen tanto las rutas antiguas como las nuevas. La Fase 13 las
  reutilizará.
- Las rutas `/api/auth/*` **no** llaman a `login_user()` (no crean cookie).
- `device_name` se trunca a 60 caracteres.

### Verificación
Tests nuevos: login por token devuelve token; `GET /api/me` con Bearer → 200 y sin
cabecera → 401; token inválido → 401; logout revoca (el mismo token da 401 después);
el token de un usuario no ve datos de otro; `GET /api/backgrounds/<id>/image` y
`POST /api/preferences {scene}` funcionan con Bearer; el freno 429 aplica también a
`/api/auth/login`; registro por token crea la carpeta activa; la base guarda el hash y no
el token. `pytest -q` → 63 + nuevos en verde.

**Commit:** `Backend: autenticación por token Bearer para la app móvil`

---

## FASE 2 — Backend: robustez para clientes offline y requisitos de tienda

Solo `app.py` y tests.

1. **`POST /api/sessions` idempotente por `(user_id, ts)`.** Antes de insertar, busca una
   sesión del usuario con el mismo `ts` (ya truncado a `TS_MAX`; el índice
   `idx_sessions_user_ts` ya existe). Si existe, no insertes y responde
   `200 {ok, id, category_id, duplicate: true}` con los datos de la existente. Si no,
   inserta y responde `{ok, id, category_id}` (se **añade** `id`). No crees un índice
   `UNIQUE`: puede haber duplicados antiguos en producción. Si algún test existente
   depende de insertar dos veces el mismo `ts`, **detente y pregunta**.
2. **`DELETE /api/account`** con body `{password}`: verifica la contraseña (con el freno de
   fuerza bruta), borra en una transacción sesiones, carpetas, fondos, tokens y usuario;
   después elimina `uploads/backgrounds/<user_id>/`; cierra la sesión de cookie si la hay
   y responde `{ok}`. **Apple exige borrar la cuenta desde la app** si la app permite
   crearla. La Fase 13 lo amplía para cuentas sin contraseña.

### Verificación
Tests: mismo `ts` dos veces → una fila y la segunda respuesta trae `duplicate: true` con
el mismo `id`; `ts` distintos → dos filas; borrar cuenta con contraseña errónea → 401 y no
borra; con la correcta → 200, el usuario ya no puede entrar, sus fondos desaparecen del
disco y los datos de **otros** usuarios siguen intactos. `pytest -q` en verde. Actualiza
la tabla de endpoints de `README.md` (incluye de paso `parent_id` y `DELETE` en carpetas).

**Commit:** `Backend: POST de sesiones idempotente y borrado de cuenta`

---

## FASE 3 — Web: preparar la convivencia con el móvil

Solo `static/js/store.js` y, si hace falta un ayudante de fecha, `static/js/util.js`.
Nada más.

1. **No resucitar sesiones.** En `syncSessions()`, un registro local que no está en el
   servidor **y ya tenía `remote_id`** fue borrado desde otro dispositivo: se descarta de
   la caché. Solo se vuelven a subir los que **no** tienen `remote_id`.
2. **Marcar lo confirmado al instante.** Cuando el POST de `logSession()` (y los reenvíos
   de `syncSessions()`) responden `ok` con `id` (Fase 2), asigna `remote_id = id` a ese
   registro, guarda la caché y emite `sessions`. Así una sesión recién creada ya no se
   reenvía si otro dispositivo la borra antes de la siguiente sincronización, y el
   Registro permite cambiarle la carpeta sin recargar.
3. **`time` sin depender del idioma**: sustituye `toLocaleTimeString('es', …)` por un
   `HH:MM` construido a mano (añade `localTimeStr()` en `util.js` junto a
   `localISOString()`).

Límite conocido (anótalo en el resumen): una caché muy antigua con sesiones subidas pero
nunca sincronizadas carece de `remote_id`; si alguien las borra desde otro dispositivo,
se resubirían una vez. Tras la primera sincronización correcta ya no ocurre.

### Verificación
Manual (la web no tiene tests de JS), con el Flask local y dos navegadores (o uno normal y
otro de incógnito) en la misma cuenta:
- A registra una sesión manual → B recarga y la ve → A **Borrar historial** → B recarga →
  **no reaparece**; A recarga → sigue vacío.
- Lo mismo eliminando una carpeta con sesiones (opción *Eliminarlas también*).
- En A, DevTools sin conexión → registrar sesión → volver a conexión y recargar → aparece
  **una sola vez** en B.
- Una sesión recién registrada permite cambiar su carpeta en el Registro sin recargar.
- La hora de la sesión en el Registro sale `HH:MM`.
- `pytest -q` sigue en verde.

**Commit:** `Web: la sincronización ya no resucita sesiones borradas en otro dispositivo`

> **Despliegue:** las Fases 1–3 son compatibles con la web actual y deben estar **en
> producción antes** de que la app apunte a PythonAnywhere. Orden: copia de la base de
> producción → `git pull` en PythonAnywhere → *Reload* de la web app → comprobar login,
> timer y registro en la web. El `git pull` también traerá `mobile/` más adelante: es
> inofensivo (Flask no lo sirve y `node_modules` no se versiona). **Pide confirmación al
> usuario antes de desplegar**; no lo hagas por tu cuenta. Lo mismo vale para las Fases
> 13–14, que además requieren `pip install -r requirements.txt` y variables de entorno
> en el servidor.

---

## FASE 4 — App: esqueleto, diseño y acceso

1. Crea el proyecto con `create-expo-app` en `mobile/` usando la plantilla por defecto
   con TypeScript + `expo-router` (consulta la documentación para el comando exacto).
   Nombre visible **FocusData**; `bundleIdentifier`/`package` =
   `com.<placeholder>.focusdata` (déjalo marcado como TODO para el usuario: **debe
   fijarse antes de la Fase 7**, porque las credenciales de Google, Apple y EAS dependen
   de él).
2. Estructura:
   ```
   mobile/
     app/(auth)/login.tsx  choose-username.tsx
     app/(tabs)/_layout.tsx  index.tsx(Timer)  stats.tsx  log.tsx  folders.tsx  settings.tsx
     app/help.tsx  app/settings/notifications.tsx
     scripts/build-icons.mjs   ← lee ../static/img/icons.svg y genera src/ui/icons/
     scripts/render-lofi/      ← renderizado del bucle de música (Fase 8)
     src/api/        client.ts (fetch + Bearer + errores {error} + 401 → cerrar sesión) · endpoints.ts (tipado)
     src/auth/       sesión, Google y Apple (Fase 15)
     src/db/         esquema SQLite, migraciones, repositorios
     src/sync/       outbox.ts · syncEngine.ts
     src/domain/     time.ts · format.ts · timer.ts · stats.ts · folders.ts · search.ts · scenes.ts · music.ts · notifications.ts
     src/state/      stores zustand (auth, prefs, timer, filtros, música, notificaciones)
     src/ui/         theme.ts (tokens §4.8) · icons/ · componentes base (Card, Kpi, Pill, Sheet, Toast, FolderPicker, SceneBackground, SceneSheet, MusicSheet)
     src/music/      reproductor (Fase 8)
     src/notifications/  aplicador, canales, eventos en segundo plano (Fase 7)
     widgets/        Live Activity (Fase 7)
     assets/scenes/  road.jpg · road-thumb.jpg · blossom.jpg · blossom-thumb.jpg (copiados de static/scenes)
     assets/sounds/  alarm.wav (Fase 6)
     assets/music/   lofi.m4a (Fase 8)
     __tests__/
   ```
3. Tema: tokens de §4.8 para oscuro y claro, acento y colores de escena dinámicos, Open
   Sans cargada antes de ocultar el splash, `StatusBar` acorde al tema (clara sobre la
   foto), áreas seguras. Iconos generados del sprite de la web (`timer`, `stats`,
   `calendar`, `folder`, `settings`, `image`, `music`, `play`, `pause`, `reset`, `save`,
   `edit`, `check`, `alert`, etc.).
4. `src/domain/scenes.ts`: catálogo de §4.8 y `resolveScene(id, backgrounds)` →
   `{id, label, colors, photo}` con los respaldos de §4.8 (desconocida → `road`; colores
   que falten → los de `road`). Con tests.
5. **Login/Registro** fiel a `login.html`: foto de la escena en caché (o `road`) con velo
   · píldora de marca · título `Tu tiempo de estudio, claro y medible` · subtítulo `Entra
   para seguir con tus sesiones, carpetas y estadísticas.` · control segmentado `Iniciar
   sesión` / `Crear cuenta` · campos `Usuario` (placeholder `Tu nombre de usuario`, máx.
   30) y `Contraseña` (`Tu contraseña`) · en registro, pista `Usa al menos 8 caracteres.`
   · botón con indicador de carga `Entrando…` / `Creando cuenta…` · errores de cliente
   `Escribe tu usuario y tu contraseña.` y `La contraseña debe tener al menos 8
   caracteres.` · errores del backend tal cual · sin red: `No hay conexión con el
   servidor. Revisa tu internet e inténtalo de nuevo.` · tras registrar, `Cuenta creada.
   Entrando…` · pie `Tus sesiones se guardan en tu cuenta y te siguen en cualquier
   dispositivo.` Usa `/api/auth/*`; guarda el token en SecureStore; `device_name` = modelo
   del dispositivo. Deja sitio sobre el formulario para los botones de Apple y Google de
   la Fase 15.
6. Arranque: si hay token → `/api/me` → pestañas; 401 → borrar token → login.
7. Pestañas inferiores: **Timer**, **Estadísticas**, **Registro**, **Carpetas**,
   **Ajustes**. El selector **Filtro** vive en la cabecera de Estadísticas y Registro.

### Verificación
Arranca el backend **accesible en la red y con `init_db()`** (ni `flask run` ni
`python app.py` sirven: el primero no crea las tablas nuevas y el segundo solo escucha en
127.0.0.1):
`venv/Scripts/python.exe -c "from app import app, init_db; init_db(); app.run(host='0.0.0.0', port=5000, debug=True)"`.
Si el teléfono no conecta, el Firewall de Windows está bloqueando el puerto 5000: indica
al usuario cómo permitirlo en redes privadas. Emulador de Android → `http://10.0.2.2:5000`;
teléfono o iPhone físico en la misma Wi-Fi → `http://<IP-del-PC>:5000`.
Prueba en Android **y** en un iPhone físico (Expo Go): registro, login, error de
credenciales, 429 tras 8 fallos, cierre de sesión y reapertura con sesión recordada. Tema
claro/oscuro y foto de escena correctos. `npx tsc --noEmit` sin errores; tests de
`scenes.ts` en verde.

**Commit:** `Móvil: esqueleto Expo, diseño base y acceso con token`

---

## FASE 5 — App: datos locales, cola de envío y sincronización

### 5.1 Esquema SQLite local
- `sessions(local_id TEXT PK, remote_id INTEGER NULL, ts TEXT UNIQUE, date, hour, time,
  minutes, type, mode, category_id, category_name, sync_state TEXT)` — `sync_state` ∈
  `pending` · `synced` · `failed`.
- `categories(id PK, parent_id, name, color, archived, depth, path, ord)` — caché de
  `GET /api/categories` (`ord` conserva el preorden).
- `backgrounds(id PK, name, colors JSON, thumb_uri, image_uri NULL)` — caché de
  `GET /api/backgrounds`: miniaturas de todos; imagen completa solo de los que se usan o
  se han usado.
- `outbox(id PK, session_local_id, payload JSON, attempts, last_error, created_at)`.
- `kv(key PK, value)` — `last_sync_at`, tiempos del Pomodoro, filtro, apariencia, estado
  del timer, preferencias de música y de notificaciones, etc.
- Separa los datos por usuario (una base por `user.id`) y bórralos al cerrar sesión
  (las preferencias de música y notificaciones pueden quedarse en el dispositivo).

### 5.2 Motor de sincronización
1. **Vaciar la cola**: POST de cada pendiente en orden. `200` (con o sin `duplicate`) →
   `synced` + `remote_id` de la respuesta. `400` → `failed` + mensaje visible (no
   reintentar sin fin). Error de red/5xx → reintento con espera exponencial. `401` →
   cerrar sesión **sin borrar la cola** hasta que el usuario decida.
2. **Descargar**: `GET /api/sessions?include_breaks=1` → **sustituye** todas las filas
   `synced` por lo recibido (el servidor manda: los borrados de otros dispositivos
   desaparecen) y conserva `pending`/`failed`.
3. `GET /api/categories`, `GET /api/me` (tema, acento, escena, carpeta activa) y
   `GET /api/backgrounds`: actualiza la caché (quita los fondos borrados en la web,
   descarga las miniaturas nuevas y la imagen completa del fondo en uso) y aplica la
   escena resultante.
4. Emite un evento `synced` (lo usará el resumen semanal de la Fase 7).

Disparadores: arranque, volver a primer plano, deslizar para refrescar, tras registrar
una sesión y al recuperar conexión. Nunca dos sincronizaciones a la vez.

### 5.3 Registrar una sesión
`logSession(minutes, type, mode, at: Date)` → construye `date/hour/time/ts` desde `at`
(§4.1), `category_id` = activa → inserta `pending` + entrada en la cola → dispara sync.
La UI se actualiza al instante desde SQLite.

### Verificación
Tests unitarios de `time.ts` (formatos en zonas horarias distintas, horas < 10, cambio
de día) y del motor con la API simulada. En dispositivo: modo avión → registrar 3
sesiones → volver → aparecen en la web y no se duplican aunque un POST se reintente;
borrar todo desde la web → tras sincronizar el móvil **no** las resucita; y al revés,
borrar desde el móvil → la web (con la Fase 3) tampoco; sesión inválida → queda `failed`
con su mensaje. Cambiar la escena en la web → tras sincronizar el móvil la muestra.

**Commit:** `Móvil: almacenamiento local, cola de envío y sincronización`

---

## FASE 6 — App: Timer y selector de escena

### 6.1 Máquina de estados pura
`src/domain/timer.ts`: `reduce(state, action, nowMs) → { state, effects[] }` con acciones
`START · PAUSE · RESET · TICK · SET_MODE · SET_CONFIG · SAVE_CRONO · APP_FOREGROUND ·
START_IF_WAITING(phase)` y efectos `LOG_SESSION · PLAY_ALARM · TOAST`. Implementa
**exactamente** §4.2–4.3. `START_IF_WAITING` solo arranca si el reloj está en modo
Pomodoro, en reposo y en esa fase. Tests que cubran cada regla de esas secciones
(incluido el bug ya corregido en la web: cambiar el descanso en reposo tras un pomodoro
no puede dejar el reloj en negativo ni con minutos de trabajo sobre un total de descanso).

### 6.2 Persistencia y segundo plano
- Persiste el estado del timer en cada transición (no en cada tick). El store expone
  `running`, `mode`, `phase`, `endTime`, `startedAt` y `remaining` para que se suscriban
  las notificaciones (Fase 7) y la música (Fase 8); `PLAY_ALARM` también se publica para
  que la música se atenúe.
- Al **volver a primer plano o arrancar en frío** con el estado `running` y `ahora >=
  endTime`: completa la fase **una sola vez**, registrando la sesión con `at = endTime`
  (no con la hora de apertura). El cambio de estado se persiste **antes** de registrar, y
  la idempotencia por `ts` cubre cualquier carrera.
- Alarma en primer plano: sonido empaquetado `assets/sounds/alarm.wav` igual al de la web
  (senoidales Do5 523,25 Hz – Mi5 659,25 Hz – Sol5 783,99 Hz escalonadas 0,25 s; se repite
  al segundo; menos de 30 s para poder usarlo también como sonido de notificación en iOS)
  + vibración. Debe poder sonar a la vez que la música de la app.
- Ajustes locales: sonido de la alarma · vibración · mantener pantalla encendida mientras
  corre.

### 6.3 Pantalla (vertical)
De arriba abajo, sobre la foto de la escena: cabecera con botones **Escena** (icono
`image`, abre la hoja de §4.8) y **Música** (icono `music`, hoja de la Fase 8; déjalo
preparado y conéctalo en esa fase) · saludo + `¿En qué te concentras hoy?` · anillo
grande con reloj y fase · línea `Sesión · Ciclo · ● ruta activa` · campo `¿Qué vas a
estudiar?` + chips **Recomendados** · fila de controles: **Modo** (Pomodoro / Cronómetro
/ Registrar sesión manual…), **Carpeta activa** (hoja con árbol y buscador), **Tiempos**
(hoja con −/+, sliders y `Restablecer`), Reiniciar, Guardar (solo cronómetro) y botón
principal grande · mini-métricas Racha / Hoy / Semana.

La hoja **Escena de fondo** se implementa en esta fase con las reglas de §4.8.

### Verificación
Pomodoro de 1 min (usa temporalmente un rango de prueba solo en desarrollo) en primer
plano → alarma, aviso y sesión registrada. Ir a otra app y volver tras `endTime` → la
fase se completa **una vez** con la hora de fin. Matar la app a mitad de fase → reabrir
tras `endTime` → registrada una vez. Cronómetro: pausar/reanudar, guardar < 1 min (avisa,
nada registrado), guardar > 1 min (insignia verde en el Registro). Manual con 0 y 601 →
error en cliente. Elegir `Cerezos` y un fondo propio en el móvil → cambian foto y anillo
al instante y la web los muestra al recargar; sin conexión las baldosas salen
deshabilitadas con su texto. Tests de `timer.ts` en verde.

**Commit:** `Móvil: temporizador y selector de escena`

---

## FASE 7 — App: sistema de notificaciones

Implementa **§4.10** completo. Desde esta fase se trabaja con *development builds*.

### 7.1 Builds de desarrollo
- Crea `eas.json` con el perfil `development` y genera un *development build* de Android.
  Si el usuario tiene cuenta de Apple Developer, también uno de iOS para su iPhone
  registrado; si no, avisa y continúa verificando solo Android hasta que la tenga.
- Explica al usuario los pasos que le tocan a él (iniciar sesión en EAS, registrar el
  iPhone).

### 7.2 Verificar las librerías antes de programar
Lee la documentación y, si hace falta, el código de las versiones instaladas y confirma:
- **`react-native-notify-kit`**: compatibilidad con el SDK de Expo y su plugin de
  configuración; cuenta atrás nativa en Android (`showChronometer` +
  `chronometerDirection: 'down'` + `timestamp`); `timeoutAfter`; `ongoing`; canales;
  acciones con la app cerrada (`onBackgroundEvent`); triggers con `AlarmManager` exacto y
  su comportamiento tras reiniciar; en iOS, `interruptionLevel`, sonido propio y
  categorías con acciones.
- **`expo-widgets` + `@expo/ui`**: iniciar, actualizar y terminar una Live Activity;
  `Text` con `timerInterval`/`countsDown`; `staleDate`; si admite botones interactivos.
- Si falta algo esencial (sobre todo la cuenta atrás nativa de Android o las acciones con
  la app cerrada), **detente y propón** la alternativa: `expo-notifications` + un módulo
  local de Expo en Kotlin solo para la notificación en curso. Espera la decisión del
  usuario.

### 7.3 Planificador y aplicador
- `src/domain/notifications.ts` (puro, con tests): `planNotifications(...)` de §4.10 y
  `weeklySummary(sesiones, ahora)` (texto y fecha del próximo domingo a la hora elegida).
- `src/notifications/`: canales de Android, categorías de iOS, aplicador de diferencias,
  manejador de eventos en primer plano (suprime el aviso de fin de fase si la app está
  activa) y manejador en segundo plano **registrado fuera de React, lo antes posible**,
  que carga el estado persistido, aplica `reduce()` (Pausar, Reanudar,
  `START_IF_WAITING`), persiste y replanifica.
- Disparadores de §4.10 › Coherencia, incluido el evento `synced` de la Fase 5.

### 7.4 Fin de fase, temporizador en curso y resumen
- Fin de fase con sonido, vibración, canal, `timeSensitive` y acciones de §4.10.
  Configura el entitlement de avisos urgentes y el sonido en la configuración de la app.
- Notificación en curso de Android con cuenta atrás nativa y Pausar/Reanudar.
- Live Activity de iPhone en `widgets/` con los colores de la escena y el contador nativo.
- Resumen semanal con la hora configurable.

### 7.5 Permisos y Ajustes › Notificaciones
- Hoja de explicación previa y peticiones de permiso de §4.10.
- Pantalla `app/settings/notifications.tsx`: estado del permiso (+ `Abrir ajustes`) ·
  `Avisos a la hora exacta` (solo Android 12+) · `Al terminar un pomodoro` · `Al terminar
  un descanso` · `Temporizador en curso` (Android: *En la barra de notificaciones*;
  iPhone: *En la pantalla de bloqueo y la Dynamic Island*) · `Resumen semanal` + hora ·
  `Probar notificación`. Todo se guarda en el dispositivo.

### Verificación
En dispositivo (Android físico o emulador y, si hay cuenta de Apple, iPhone):
- Pomodoro de 1 min → bloquear → el aviso llega **a la hora** con la alarma. En Android,
  repetirlo sin el permiso de alarmas exactas y anotar el retraso observado.
- `Empezar descanso`: en Android arranca el descanso sin abrir la app (al abrirla, el
  reloj está en marcha); en iPhone abre la app y arranca.
- Con la app en primer plano al terminar la fase → sin aviso del sistema; alarma y aviso
  dentro de la app.
- Android: notificación en curso con cuenta atrás que avanza con la app cerrada;
  `Pausar` desde la notificación con la app matada → al abrir, el reloj está en pausa y
  el fin de fase ya no llega; `Reanudar` → vuelve a programarse; la notificación
  desaparece en `endTime`; en Cronómetro cuenta hacia delante.
- iPhone: Live Activity en la pantalla de bloqueo y la Dynamic Island con el tiempo
  avanzando; se actualiza al pausar y desaparece al reiniciar.
- Resumen semanal: en desarrollo, programarlo para dentro de 1 minuto → el texto coincide
  con "Esta semana" de Estadísticas con el filtro en "Todas"; con una semana vacía sale el
  texto sin estudio.
- Reiniciar el teléfono Android con una fase en marcha → el aviso sigue llegando (o
  queda documentado lo que ocurre y cómo se reconcilia).
- Cerrar sesión → no queda ninguna notificación ni Live Activity.
- Denegar el permiso → Ajustes lo indica y ofrece abrir los ajustes del sistema.
- Tests de `notifications.ts` en verde; `npx tsc --noEmit` sin errores.

**Commit:** `Móvil: sistema de notificaciones (fin de fase, temporizador en curso y resumen semanal)`

---

## FASE 8 — App: música lo-fi

### 8.1 Renderizar el bucle desde el generador de la web
Objetivo: `mobile/assets/music/lofi.m4a`, un bucle **sin corte audible** de **96
compases** (compás = 4 · 60/74 s ≈ 3,243 s → ~5 min 11 s), que suene como el lo-fi de la
web.

1. En `mobile/scripts/render-lofi/` crea una página (`index.html` + `render.js`) que
   **copie** de `static/js/music.js` `buildLofi`, `LOFI_PROGRESSIONS`, `tapeSaturation` y
   los auxiliares que usan (`gainNode`, `filterNode`, `panNode`, `noiseBuffer`,
   `noiseLoop`, `loopSource`, `lfo`, `modulate`, `burst`, `rand`, `poisson`, `midi`),
   con estas adaptaciones y ningún cambio musical:
   - Usa un `OfflineAudioContext` (44 100 Hz, estéreo) y sustituye `every()` por un bucle
     que programa **todos** los eventos de antemano hasta el final del render (en un
     contexto offline no hay temporizadores).
   - Sustituye `Math.random` por un generador con semilla fija (p. ej. `mulberry32`),
     escrita en el script, para que el archivo se pueda regenerar idéntico.
   - Aplica el nivel del sonido (`0.85`). Omite el fundido de entrada de `startVoice`:
     los fundidos los hace el reproductor de la app.
2. Renderiza **8 compases de calentamiento + 96 compases + 4 s de cola**. Quédate con los
   96 compases posteriores al calentamiento y funde (potencia constante) los 4 s de cola
   sobre el inicio para que el final empalme con el principio. Exporta un WAV de 16 bits.
3. Ejecútalo en **Chrome** (instalado; es el motor en el que suena la web). Automatízalo
   con Playwright usando el navegador instalado (`channel: 'chrome'`, sin descargar
   navegadores) como dependencia de desarrollo de `mobile/`, o, si el usuario prefiere no
   añadirla, deja la página lista para abrirla a mano y descargar el WAV.
4. Con **ffmpeg** (hoy no está instalado: **pide permiso** antes de
   `winget install --id Gyan.FFmpeg`), normaliza a unos −16 LUFS (`loudnorm`) y codifica
   AAC 128 kbps estéreo en `lofi.m4a` (≤ 6 MB). Versiona el `.m4a`, no el `.wav`.
5. Documenta en `mobile/scripts/render-lofi/README.md` cómo regenerarlo. El script debe
   admitir añadir más sonidos de `music.js` más adelante, pero **solo se empaqueta el
   lo-fi**.
6. Es música generada por el propio código del proyecto: no hay licencias de terceros.

### 8.2 Reproducción en la app
- `src/domain/music.ts` (puro, con tests): preferencias de §4.9, `level(volume)` y
  `musicTransition(prev, next, prefs)` que decide *reproducir / pausar / nada* según las
  reglas de sincronización de §4.9.
- `src/music/`: reproductor de `expo-audio` con el `.m4a` en bucle nativo. Los fundidos y
  la atenuación por la alarma se hacen variando el volumen en pasos cortos (~50 ms).
  Reanudar continúa donde se pausó.
- **Segundo plano**: la música **sigue sonando con la pantalla bloqueada o la app en
  segundo plano**. Consulta en la documentación de `expo-audio` qué configuración exige
  (modo de audio en segundo plano en iOS, servicio o notificación multimedia en Android)
  y aplícala; si la plataforma obliga a mostrar controles multimedia, implementa los
  mínimos (título `Lo-fi · FocusData`, reproducir/pausar) y dilo en el resumen.
- **Interrupciones**: una llamada u otra app que toma el audio pausa la música; no se
  reanuda sola salvo que la plataforma lo indique y el temporizador siga *queriendo
  música*.
- **Fin de fase con la pantalla bloqueada**: comprueba en iPhone y Android si el proceso
  sigue activo mientras suena la música y, por tanto, si la música se pausa a la hora
  exacta al empezar el descanso. Si el sistema no lo permite, la pausa se aplica al
  volver a la app (al procesar `APP_FOREGROUND`); documenta lo observado.
- **UI**: hoja **Música de concentración** desde el botón `music` del Timer (con barras
  de ecualizador animadas mientras suena; estáticas con *reducir movimiento*), con los
  controles y textos de §4.9. Los mismos controles en Ajustes › Música (Fase 12).

### Verificación
Sin conexión, `Lo-fi` suena. Escuchar el punto de bucle (último compás → primero): sin
chasquido ni salto de volumen. Comparar de oído con la web: mismo carácter. Bloquear el
teléfono con la música sonando → sigue sonando (iPhone y Android). Con `sync` activado:
iniciar un pomodoro → empieza; pausar → se pausa; fin de fase → la alarma se oye por
encima y la música se pausa en el descanso; cronómetro en marcha → suena. Recibir una
llamada → se pausa. Volumen y `sync` se conservan al reiniciar la app. La notificación en
curso y la de la música conviven sin romperse. Tests de `music.ts` en verde;
`npx tsc --noEmit` sin errores.

**Commit:** `Móvil: música lo-fi sincronizada con el temporizador`

---

## FASE 9 — App: Estadísticas

1. `src/domain/stats.ts`: una función por indicador de §4.6 + series de los gráficos
   (incluidos `niceScale`, `hoursSeries` y la asignación de colores por tipo). Tests con un
   historial de ejemplo fijo (incluye descansos, cronómetro, manual, varias carpetas
   anidadas, una sesión que cruza la medianoche y una racha que cruza un cambio de mes) y
   resultados esperados calculados a mano. Guarda ese historial y sus resultados en
   `mobile/__tests__/fixtures/` como JSON para poder contrastarlos con la web. El resumen
   semanal de la Fase 7 debe reutilizar estas funciones.
2. Pantalla: selector **Filtro** arriba (con indicación clara cuando no es "Todas") ·
   rejilla 2×4 de indicadores · gráficos de §4.6 con `react-native-svg` que se recolorean
   al cambiar acento/tema · tocar una columna, porción o celda muestra su detalle ·
   deslizar para refrescar.
3. Rendimiento: cálculos memorizados por (historial, filtro); la pantalla no debe tardar
   en abrirse con 5 000 sesiones.

### Verificación
Con la misma cuenta, cada indicador y gráfico coincide con la web para "Todas" y para un
filtro de carpeta padre. Tests en verde.

**Commit:** `Móvil: estadísticas y gráficos`

---

## FASE 10 — App: Registro

- `SectionList` agrupada por fecha (`prettyDate`, más reciente arriba) con las reglas de
  §4.7. Cada fila: hora, duración, tipo, chip de carpeta, insignia de modo; icono de
  "pendiente" o "error" según `sync_state`.
- Filtros: tipo, periodo y carpeta (Filtro global).
- Tocar el chip de carpeta (solo sesiones sincronizadas) → hoja de carpetas →
  `PATCH /api/sessions/<id>` → aviso `Sesión movida a {nombre}`.
- Menú: **Exportar CSV** y **Exportar JSON** (descarga con Bearer → hoja de compartir) y
  **Borrar historial** (confirmación de §4.7 → `DELETE /api/sessions/all` → limpiar local).

### Verificación
Reasignar se refleja en la web; exportar abre la hoja de compartir con un CSV que Excel
lee con acentos; borrar todo vacía web y móvil; lista fluida con 5 000 sesiones.

**Commit:** `Móvil: registro de sesiones`

---

## FASE 11 — App: Carpetas

- Lista/árbol de §4.5 con el texto de ayuda de la web: `Organiza tus sesiones en carpetas
  y subcarpetas. La carpeta activa es donde se guardan las sesiones nuevas; el filtro solo
  cambia lo que ves en Estadísticas y Registro.`
- Tocar una carpeta → hoja con las acciones de §4.5. Botón **Nueva carpeta** → hoja con
  nombre, color (presets de acento de §4.8 + hex) y ubicación.
- **Mover** y **Eliminar**: hojas con las reglas exactas de §4.5 (destinos, destino por
  defecto, confirmación `ELIMINAR` solo si se borran sesiones).
- Sin conexión: acciones deshabilitadas con el motivo.

### Verificación
Jerarquía de 3 niveles; mismo nombre en ramas distintas permitido y en la misma rama
rechazado con el mensaje del backend; mover no ofrece la propia rama; archivar el padre
archiva la rama; no se puede archivar la única activa; eliminar moviendo y eliminando
sesiones con los recuentos correctos; nombre `<img src=x onerror=alert(1)>` se ve
literal; el buscador encuentra `logistica` en `Logística`. Todo se refleja en la web.

**Commit:** `Móvil: gestión de carpetas`

---

## FASE 12 — App: Ajustes, Ayuda y cuenta

- **Cuenta**: usuario, **Cerrar sesión** (`/api/auth/logout` + borrar token y datos
  locales; si hay pendientes en la cola, avisa antes; detiene la música y cancela
  notificaciones y Live Activity), **Eliminar cuenta** (explicación + contraseña →
  `DELETE /api/account`). Las cuentas vinculadas y la contraseña se añaden en la Fase 15.
- **Apariencia**: tema oscuro/claro, acento (§4.8) y **Escena de fondo** (la misma hoja
  del Timer).
- **Notificaciones**: enlace a la pantalla de la Fase 7, con el resumen de su estado.
- **Música**: los controles de §4.9.
- **Temporizador**: tiempos del Pomodoro, sonido de la alarma, vibración, mantener
  pantalla encendida.
- **Datos**: última sincronización, nº de pendientes/errores, **Sincronizar ahora**,
  **Exportar CSV/JSON**, **Borrar historial**.
- **Ayuda**: adapta los textos de la sección Ayuda de `index.html` a la ubicación de cada
  control en el móvil. En *Fondos y apariencia*: se elige escena o fondo propio y los
  fondos se suben desde la web. En *Música*: solo lo-fi, y sigue sonando con la pantalla
  bloqueada. En *Temporizador*: avisos, notificación en curso y Live Activity, y cómo
  permitir los avisos a la hora exacta. Añade una explicación de las sesiones pendientes
  de sincronizar.
- **Acerca de**: versión y enlace a la política de privacidad (URL como TODO para el
  usuario).

### Verificación
Cambios de tema, acento y escena hechos en el móvil se ven en la web tras recargar, y los
hechos en la web se ven en el móvil tras sincronizar; borrar en la web el fondo en uso →
el móvil vuelve a `Carretera`; cerrar sesión y entrar con otra cuenta no muestra datos ni
notificaciones de la anterior; eliminar cuenta impide volver a entrar.

**Commit:** `Móvil: ajustes, ayuda y gestión de cuenta`

---

## FASE 13 — Backend: cuentas de Google y Apple

Solo `app.py`, `requirements.txt`, `tests/test_api.py` y `README.md`.

### 13.1 Configuración
- Dependencia nueva: `PyJWT[crypto]` (verificación de tokens de Google y Apple, firma
  del *client secret* de Apple y cifrado con `cryptography`). Añádela a
  `requirements.txt`.
- Variables de entorno:
  - `GOOGLE_CLIENT_IDS`: ids de cliente separados por comas (web, iOS y el que use
    Android como audiencia del ID token).
  - `GOOGLE_WEB_CLIENT_ID`: el que usa la web.
  - `APPLE_BUNDLE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY_PATH` (ruta de
    la clave `.p8`, fuera del repo).
  - `FOCUSDATA_TOKEN_KEY`: clave Fernet para cifrar los *refresh tokens* de Apple.
- Si un proveedor no está configurado, sus rutas responden
  `503 {"error": "Inicio de sesión con Google no disponible"}` (o `con Apple`) y la
  web y la app ocultan su botón. Así el desarrollo local funciona sin credenciales.
- Conexiones salientes: `https://www.googleapis.com/oauth2/v3/certs`,
  `https://appleid.apple.com/auth/keys`, `/auth/token` y `/auth/revoke`. Están dentro de
  la lista de dominios permitidos de las cuentas gratuitas de PythonAnywhere
  (`.googleapis.com`, `.apple.com`); compruébalo en producción con una prueba manual.

### 13.2 Esquema
```sql
CREATE TABLE IF NOT EXISTS oauth_identities (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id),
    provider          TEXT    NOT NULL,          -- 'google' | 'apple'
    subject           TEXT    NOT NULL,          -- claim 'sub' del token
    email             TEXT,                      -- solo para mostrarlo en Ajustes
    refresh_token_enc TEXT,                      -- solo Apple, cifrado
    created_at        TEXT    NOT NULL,
    UNIQUE(provider, subject),
    UNIQUE(user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_identities(user_id);
```
- Migración: `users.has_password INTEGER NOT NULL DEFAULT 1` (con `PRAGMA table_info`).
- Las cuentas creadas con Google o Apple guardan en `password` el hash de un secreto
  aleatorio (la columna es `NOT NULL`) y `has_password = 0`: el login por contraseña
  falla con el 401 genérico de siempre.

### 13.3 Verificación de tokens
Funciones de módulo, fáciles de sustituir en los tests:
- `verify_google_id_token(token, nonce=None)`: firma RS256 con las claves públicas de
  Google (`PyJWKClient` con caché), `aud` ∈ `GOOGLE_CLIENT_IDS`, `iss` ∈
  {`accounts.google.com`, `https://accounts.google.com`}, `exp` con 60 s de margen,
  `email_verified` si se usa el email y `nonce` si se envió. Devuelve `sub`, `email` y
  `name`.
- `verify_apple_identity_token(token, raw_nonce)`: firma con las claves de Apple,
  `iss = https://appleid.apple.com`, `aud = APPLE_BUNDLE_ID`, `exp`, y `nonce` igual a
  `sha256(raw_nonce)` en hexadecimal. Devuelve `sub` y `email` (puede faltar o ser un
  correo de reenvío privado).
- `apple_exchange_code(authorization_code)`: `POST /auth/token` con un *client secret*
  JWT ES256 firmado con la `.p8` → `refresh_token`, que se guarda cifrado.
- `apple_revoke(refresh_token)`: `POST /auth/revoke`. Apple pide revocar los tokens al
  borrar la cuenta; se llama también al desvincular. Si falla, se registra en el log y la
  operación del usuario continúa.

### 13.4 Endpoints nuevos
Las rutas web crean cookie como `/api/login`; las móviles devuelven token como
`/api/auth/login`.

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| GET | `/api/auth/providers` | — (sin login) | `{google: {web_client_id} \| null, apple: true \| false}` |
| POST | `/api/login/oauth` (web) · `/api/auth/oauth` (móvil) | `{provider: "google" \| "apple", id_token, nonce?, authorization_code?, full_name?, device_name?}` | Identidad conocida → `200 {ok, username}` (web) / `{ok, token, user}` (móvil). Desconocida → `200 {ok, needs_username: true, signup_token, suggested_username}`. Token inválido → `401 "No se pudo verificar tu cuenta de Google"` / `"… de Apple"`. No configurado → `503` |
| POST | `/api/login/oauth/complete` · `/api/auth/oauth/complete` | `{signup_token, username, device_name?}` | Crea el usuario con las mismas preferencias y carpeta "General" que el registro, más la identidad → cookie / token. `400` validación de usuario · `409 "Ese nombre de usuario ya existe"` · `400 "El registro caducó. Vuelve a intentarlo."` |
| GET | `/api/me` | — | Se **añaden** `has_password` e `identities: [{provider, email}]` |
| POST | `/api/account/identities` | `{provider, id_token, nonce?, authorization_code?}` (con login) | Vincula → `{ok, identities}` · `409 "Esa cuenta de Google ya está vinculada a otro usuario"` (o de Apple) · `409` si ya tiene ese proveedor |
| DELETE | `/api/account/identities/<provider>` | — (con login) | Desvincula (y revoca en Apple) → `{ok, identities}` · `400 "Crea una contraseña o vincula otra cuenta antes de desvincular esta"` si es su único método de acceso |
| POST | `/api/account/password` | `{current_password?, new_password}` (con login) | Si `has_password`, exige `current_password` (401 si no coincide, con el freno de fuerza bruta). `new_password` ≥ 8. Pone `has_password = 1` → `{ok}` |
| DELETE | `/api/account` (ampliado) | `{password}` **o** `{provider, id_token, nonce?}` recién obtenido | Las cuentas sin contraseña confirman con su proveedor. Antes de borrar, revoca los tokens de Apple y borra también sus identidades |

- `signup_token`: firmado con `itsdangerous.URLSafeTimedSerializer` (ya viene con Flask),
  sal propia, caducidad de **10 minutos**. Contiene proveedor, `sub`, email y, en Apple,
  el *refresh token* ya cifrado. Reutilizarlo tras crear la cuenta choca con
  `UNIQUE(provider, subject)` → `409`.
- `suggested_username`: el nombre de pila (Google `name`, Apple `full_name`, que Apple
  solo envía la primera vez) o la parte local del email, recortado a 30; si está ocupado,
  se añade un número.
- Reutiliza las funciones compartidas de la Fase 1 para crear cuentas y emitir tokens.

### Verificación
Tests (con las funciones de verificación y las llamadas a Apple sustituidas; **ninguna
conexión real**):
- Google nuevo → `needs_username` → `complete` → el token funciona y existe la carpeta
  "General"; el mismo `sub` después entra directamente.
- Token inválido → 401; proveedor sin configurar → 503; `signup_token` caducado → 400.
- La verificación en sí: un token firmado con una clave RSA generada en el test y
  `aud`/`iss`/`exp`/`nonce` incorrectos → rechazado.
- Vincular a una cuenta con contraseña → `/api/me` lo muestra; vincular una identidad de
  otro usuario → 409.
- Desvincular el único método → 400; crear contraseña en una cuenta de Google →
  `has_password` = true y ya puede entrar con usuario y contraseña.
- `/api/login` con una cuenta sin contraseña → 401.
- Borrar una cuenta de Apple sin contraseña con token reciente → se llama a
  `apple_revoke` y desaparecen usuario, identidades y datos.
- `pytest -q` en verde (63 + todos los nuevos). Documenta rutas y variables de entorno
  en `README.md`.

**Commit:** `Backend: inicio de sesión y vinculación con Google y Apple`

---

## FASE 14 — Web: inicio de sesión con Google

Solo `static/login.html`, `static/index.html` (sección Cuenta de Configuración),
`static/js/settings.js` y los estilos necesarios en `static/css/app.css`.

1. **Login** (`login.html`): pide `/api/auth/providers`. Si Google está configurado,
   carga Google Identity Services (`https://accounts.google.com/gsi/client`) y dibuja su
   botón oficial (`renderButton`, texto *continuar con*, idioma `es`, tema acorde) encima
   del formulario, con el separador `o con tu usuario`. Con la credencial →
   `POST /api/login/oauth`:
   - entra → redirige a `/`;
   - `needs_username` → la tarjeta cambia a `Elige tu nombre de usuario` (campo relleno
     con la sugerencia, pista `Es el nombre con el que te saludaremos. Entre 3 y 30
     caracteres.`, botón `Crear cuenta`) → `/api/login/oauth/complete` → redirige;
   - errores en el mismo bloque de mensajes que hoy.
   Sin Google configurado, el login queda exactamente como hoy.
2. **Configuración › Cuenta**:
   - `Cuentas vinculadas`: Google → `Vincular` (flujo de Google Identity Services) o
     `Vinculada como {email}` + `Desvincular`. Apple → si está vinculada, `Vinculada` +
     `Desvincular`; si no, el texto `Apple se vincula desde la app del iPhone.`
   - `Contraseña`: `Crear contraseña` (si `has_password` es falso, con la pista `Para
     entrar con tu usuario en otros dispositivos.`) o `Cambiar contraseña`, en un modal.
   - Errores del backend tal cual; avisos `Cuenta de Google vinculada`, `Cuenta
     desvinculada`, `Contraseña guardada`.
3. Orígenes autorizados que el usuario debe configurar en Google Cloud:
   `https://<usuario>.pythonanywhere.com`, `http://localhost:5000` y
   `http://127.0.0.1:5000`.

### Verificación
Manual con credenciales de prueba: crear cuenta con Google eligiendo usuario; salir y
volver a entrar con Google; vincular Google a una cuenta con contraseña y entrar con
Google a esa misma cuenta; crear contraseña en la cuenta de Google y entrar con usuario;
desvincular con y sin otro método; sin variables de Google, el login se ve como antes.
`pytest -q` en verde.

**Commit:** `Web: inicio de sesión y vinculación con Google`

---

## FASE 15 — App: inicio de sesión con Google y Apple

1. **Librerías** (consulta la documentación vigente antes de elegir):
   - Google: la guía de Expo presenta `react-native-nitro-google-signin` (usa Credential
     Manager en Android, que es lo que Google recomienda) y
     `@react-native-google-signin/google-signin` (Credential Manager es de pago). Prefiere
     la primera si es compatible con el SDK instalado. Necesita *development build* y su
     plugin; pide un ID token con audiencia en `GOOGLE_CLIENT_IDS` y usa `nonce` si la
     librería lo admite.
   - Apple (solo iOS): `expo-apple-authentication` con `ios.usesAppleSignIn: true`.
     Genera un `nonce` aleatorio con `expo-crypto`, pasa su SHA-256 a Apple y envía al
     backend el `nonce` en claro, `identityToken`, `authorizationCode` y `fullName` (Apple
     solo los da la primera vez).
2. **Pantalla de acceso**:
   - iPhone: botón oficial de Apple (`AppleAuthenticationButton`, tipo *Continuar*,
     blanco sobre la foto) y botón de Google con su marca (`Continuar con Google`), del
     mismo tamaño y protagonismo; debajo, `o con tu usuario` y el formulario de la Fase 4.
   - Android: botón de Google y el formulario.
   - `needs_username` → `choose-username.tsx` con los textos de la Fase 14.
   - Cancelar el diálogo de Google o Apple no muestra error.
   - Sin conexión o proveedor no configurado (`/api/auth/providers`): botones ocultos o
     deshabilitados con el motivo.
3. **Ajustes › Cuenta**: `Cuentas vinculadas` (Google en ambas plataformas; Apple
   vinculable en iPhone y, en Android, solo visible si ya está vinculada) · `Crear
   contraseña` / `Cambiar contraseña` · **Eliminar cuenta**: con contraseña si la tiene;
   si no, `Confirmar con Google` / `Confirmar con Apple`.
4. **Cerrar sesión** también cierra la sesión de la librería de Google para que la próxima
   vez aparezca el selector de cuentas.
5. **Ayuda**: `Si olvidaste tu contraseña pero vinculaste Google o Apple, entra con esa
   cuenta y crea una nueva en Ajustes › Cuenta.`
6. **Lista de TODO del usuario** en `mobile/README.md`:
   - Google Cloud: pantalla de consentimiento (externa, alcances `openid`, `email` y
     `profile`, nombre FocusData, URL de privacidad y dominio autorizado; comprueba si se
     admite el subdominio de PythonAnywhere).
   - Google Cloud: ids de cliente Web, iOS (bundle id) y Android (package + SHA-1 del
     certificado de las builds de EAS y, al publicar, de la firma de Google Play).
   - Apple Developer: capacidad *Sign in with Apple* en el App ID y una clave `.p8` para
     la API REST (Team ID, Key ID).
   - Variables de entorno en PythonAnywhere y EAS.

### Verificación
Con *development builds* y credenciales de prueba:
- Android: cuenta nueva con Google → elegir usuario → datos creados; la misma cuenta de
  Google en la web entra al mismo usuario.
- iPhone: cuenta nueva con Apple → crear contraseña en Ajustes → entrar con usuario en
  Android y en la web.
- Vincular Google a una cuenta existente desde la app → entrar con Google en la web.
- Desvincular el único método → mensaje del backend.
- Eliminar una cuenta de Apple sin contraseña confirmando con Apple → el servidor revoca
  (visible en el log) y no se puede volver a entrar.
- Cancelar los diálogos → sin errores. `npx tsc --noEmit` sin errores.

**Commit:** `Móvil: inicio de sesión y vinculación con Google y Apple`

---

## FASE 16 — Pulido y compilación

1. Accesibilidad: el lector de pantalla recorre acceso, Timer, hojas de Escena y Música,
   Registro, Carpetas y Ajustes con etiquetas en español; tamaños de texto grandes no
   rompen el reloj, los indicadores ni la Live Activity; *reducir movimiento* desactiva
   las animaciones del anillo, de la foto y del ecualizador.
2. Icono y splash con la marca (icono `timer` blanco sobre el degradado cónico de la
   escena `road`: `#E8875F`, `#B77AA8`, `#F2B36F`).
3. `eas.json` con los perfiles `preview` y `production`; build `preview` instalable en
   Android (APK); iOS preparado para TestFlight.
4. Revisión de permisos y capacidades declarados, solo los necesarios y con su
   justificación para las tiendas: notificaciones, `SCHEDULE_EXACT_ALARM`, audio en
   segundo plano, Live Activities, avisos urgentes, Sign in with Apple.
5. Privacidad: borrador de los puntos que debe cubrir la política de privacidad y de las
   respuestas para la *App Privacy* de Apple y la *Seguridad de los datos* de Google Play.
   Datos a declarar: usuario, sesiones, carpetas, fondos, identificador y email de Google
   o Apple; sin publicidad ni seguimiento.
6. `mobile/README.md`: requisitos en Windows, instalación, variables de entorno, cómo
   arrancar el Flask local accesible en la red (comando de la Fase 4 y firewall), builds
   de desarrollo, cómo probar notificaciones y Live Activities, cómo regenerar
   `lofi.m4a`, cómo añadir fotos de escenas nuevas, cómo compilar, y la lista completa de
   TODO del usuario (bundle id, URL de producción, política de privacidad, cuentas de
   Apple/Google, credenciales de la Fase 15).
7. Resumen final para el usuario con los problemas de §5 que siguen abiertos, el límite
   conocido de la Fase 3 y lo observado sobre la música y los avisos con la pantalla
   bloqueada.

**Commit:** `Móvil: accesibilidad, recursos de marca y configuración de compilación`

---

## Checklist final de regresión

- [ ] `pytest -q` en verde (63 originales + nuevos). `ver_db.py`: ninguna sesión perdida.
- [ ] La web funciona igual: login por cookie, timer, notificaciones, música, escenas y fondos propios, carpetas, registro, exportar.
- [ ] Web (Fase 3): borrar desde otro dispositivo no resucita sesiones; `time` en `HH:MM`.
- [ ] Web (Fase 14): Google para entrar, crear cuenta y vincular; sin credenciales, el login se ve como antes.
- [ ] Móvil: registro, login, cierre de sesión, 429 tras 8 fallos.
- [ ] Móvil: Google (Android e iPhone) y Apple (iPhone) para crear cuenta, entrar y vincular; crear contraseña; eliminar cuenta sin contraseña con revocación en Apple.
- [ ] Pomodoro completo en primer plano: alarma, sesión y descanso registrados, sin aviso del sistema duplicado.
- [ ] Fin de fase con la pantalla bloqueada y con la app cerrada: aviso a la hora (con el permiso de alarmas exactas), sesión registrada **una vez** con la hora de fin; *Empezar…* funciona.
- [ ] Temporizador en curso: cuenta atrás nativa en Android con Pausar/Reanudar desde la notificación; Live Activity y Dynamic Island en iPhone.
- [ ] Resumen semanal con el texto correcto; se reprograma al sincronizar y registrar.
- [ ] Permisos denegados o revocados: Ajustes lo indica y la app no falla.
- [ ] Cronómetro: < 1 min no registra; > 10 h registra 600 con aviso.
- [ ] Sesión manual 1–600 validada.
- [ ] Offline: 3 sesiones → al reconectar suben sin duplicados y aparecen en la web.
- [ ] Borrado desde la web (todo o carpeta) → el móvil no lo resucita, y viceversa.
- [ ] Sesión creada en la web aparece en el móvil al refrescar.
- [ ] Indicadores y gráficos coinciden con la web (con y sin filtro de carpeta padre).
- [ ] Carpetas: crear, subcarpeta, renombrar, mover, archivar en cascada, eliminar (mover/borrar), escapado de nombres, buscador sin acentos.
- [ ] Reasignar sesión, exportar CSV/JSON, borrar historial.
- [ ] Tema, acento y escena (catálogo y fondo propio) se cambian desde el móvil y desde la web, y cada lado ve lo que eligió el otro.
- [ ] Música lo-fi: suena sin conexión, bucle sin corte, sigue con la pantalla bloqueada, se sincroniza con el temporizador y se atenúa con la alarma.
- [ ] Cambiar de cuenta no muestra datos ni notificaciones de la anterior.
- [ ] Eliminar cuenta funciona, borra sus fondos e identidades y no afecta a otros usuarios.
- [ ] `npx tsc --noEmit` y `npx jest` en verde; Android e iPhone probados.

---

## Fuera de alcance

No lo hagas sin pedirlo explícitamente:

- Cambios en `static/` distintos de los de las Fases 3 y 14 (incluidos los problemas
  abiertos de §5).
- Subir o borrar fondos propios desde el móvil.
- Otros sonidos de la web en el móvil (Ambiente, Lluvia, Bosque, Olas, Chimenea, Ruido
  marrón) y las pistas propias de `static/music/`. El script de renderizado queda
  preparado para añadirlos.
- Controles multimedia más allá de los mínimos que exija la plataforma.
- Otras notificaciones: recordatorio diario, racha en peligro, notificaciones push
  remotas. Widgets de pantalla de inicio y Apple Watch.
- Iniciar sesión con Apple en la web o en Android, u otros proveedores (Facebook,
  Microsoft…). Eliminar la cuenta desde la web.
- Recuperar contraseña por email (el modelo no guarda email; la vía de recuperación son
  Google y Apple vinculados).
- Barra lateral y "Recientes" de la web (el móvil usa pestañas).
- Editar o borrar sesiones individuales; sesión manual con fecha/hora elegida.
- Compartir el temporizador en marcha entre web y móvil.
- Paginación o sincronización incremental de `/api/sessions`.
- Diseño específico para tablet, idiomas distintos del español, versión web de Expo (y
  por tanto CORS).
- Crear cuentas o proyectos en Google Cloud o Apple Developer, desplegar en PythonAnywhere
  o publicar en App Store / Google Play (se deja todo preparado, pero lo hace o lo
  autoriza el usuario).
