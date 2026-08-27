# Plan de implementación — Subcarpetas anidadas + Cronómetro

> **Qué es este documento:** un prompt de ejecución. Instrucciones literales,
> ordenadas por fases independientes, para añadir a FocusData (a) una jerarquía de
> carpetas con anidamiento ilimitado y (b) un modo cronómetro que cuenta hacia
> adelante.
>
> **Cómo usarlo:** ejecuta las fases **en orden**. Cada fase es verificable por
> separado. No pases a la siguiente hasta que su verificación pase. Si una
> instrucción choca con lo que ves en el código, **detente y pregunta** en vez de
> improvisar.
>
> **Las fases 1-4 (subcarpetas) y 5-6 (cronómetro) son independientes entre sí.**
> Si quieres un resultado visible rápido, el cronómetro se puede hacer primero.

---

## 1. Decisiones ya tomadas

Estas cuatro decisiones están cerradas y condicionan todo el diseño. **No las
reinterpretes.**

| Decisión | Elegido |
|---|---|
| **Profundidad** | **Anidamiento ilimitado** (con un tope de seguridad de 10 niveles) |
| **Filtrar por una carpeta padre** | **Incluye las sesiones de todos sus descendientes** |
| **Registrar sesiones en una carpeta padre** | **Sí**, cualquier carpeta es seleccionable como activa |
| **Modo del cronómetro en el historial** | **Modo propio `cronometro`** |

Decisiones de comportamiento derivadas, tomadas al planificar (aplícalas tal cual):

- **Archivar** una carpeta **archiva en cascada a todos sus descendientes**.
- **Desarchivar** una carpeta **desarchiva también a sus ancestros**, para garantizar
  el invariante: *una carpeta activa siempre tiene toda su cadena de ancestros
  activa*. Sin esto se pueden crear carpetas activas pero invisibles en el árbol.
- **Mover** una carpeta a otra rama está permitido, salvo que cree un ciclo.
- **Borrar** carpetas sigue **fuera de alcance** (hoy solo se archivan).

---

## 2. Estado actual del código

**Esquema real de `categories` (verificado en tu `study.db`):**

```sql
CREATE TABLE categories (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users(id),
    name     TEXT    NOT NULL,
    color    TEXT    NOT NULL DEFAULT '#6366f1',
    archived INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, name)          -- ← esta restricción es el obstáculo principal
)
```

**Datos actuales:** 3 usuarios, 5 carpetas, 137 sesiones (todas del `user_id=3`),
cero sesiones huérfanas, `sqlite_sequence` de `categories` en 7.

**Puntos de contacto en el backend** ([app.py](app.py)): `init_db()` (líneas 130-164),
`resolve_category()` (167-198), `register()` (231-234), `me()` (303-309),
`save_preferences()` (344-351), `_category_json()` (361), `get_categories()` (364-372),
`create_category()` (374-393), `update_category()` (395-450), `update_session()`.

**Puntos de contacto en el frontend** ([static/index.html](static/index.html)):
`categoryById` (:941), `filteredDb` (:943), `catSelectHtml` (:1554),
`loadCategories` (:1710), `renderCategoryUI` (:1721), `setActiveCategory` (:1763),
`setGlobalFilter` (:1777), `createCategoryFromTimer` (:1816), `createCategory` (:1839),
`renameCategory` (:1859), `toggleArchive` (:1884).

**Máquina de estados del temporizador:** `cfg`/`state` (:962-968), `phaseDuration`
(:1023), `renderClock` (:1029), `updateToggleButton` (:1053), `toggleTimer` (:1060),
`startTimer` (:1064), `pauseTimer` (:1079), `resetTimer` (:1088), `tick` (:1101),
`phaseComplete` (:1156), `logSession` (:1180).

---

## 3. Reglas invariables

1. **No romper `syncSessions()`.** La deduplicación depende de que `ts` se conserve
   byte a byte. Nada de normalizar, truncar ni reformatear `ts`.
2. **Preservar las claves JSON existentes.** El frontend consume `id`, `name`,
   `color`, `archived`, `ok`, `error`, `category_id`, `category_name`. Se pueden
   **añadir** claves; nunca renombrar ni eliminar.
3. **No añadir dependencias** ni introducir un build step.
4. **Escapar siempre el texto de usuario** con el helper `esc()` que ya existe
   (:931) al interpolar en plantillas `innerHTML`. Los nombres de carpeta son texto
   libre.
5. **Toda migración de esquema debe ser idempotente**: `init_db()` corre en cada
   arranque. Guárdala tras una comprobación de `PRAGMA table_info`.
6. **Los mensajes de error visibles van en español.**
7. **Un commit por fase**, con el mensaje indicado al final de cada una.
8. **Los 28 tests actuales deben seguir pasando** en todas las fases.

---

## 4. Evidencia verificada

Estas comprobaciones **ya se hicieron** sobre tu base de datos real (o una copia).
Son la justificación de las decisiones técnicas; no hace falta repetirlas.

- **`WITH RECURSIVE` funciona.** SQLite 3.51.0 en tu entorno. ✅
- **La trampa de `NULL` está confirmada.** Con `UNIQUE(user_id, parent_id, name)` y
  `parent_id NULL`, SQLite **permite carpetas raíz duplicadas** (los `NULL` se
  comparan como distintos). Con el centinela `parent_id = 0` **sí bloquea**. → Por eso
  la raíz se representa con `0`, **no** con `NULL`. ✅
- **La reconstrucción de la tabla se ensayó sobre una copia de `study.db`:**
  5 categorías → 5, 137 sesiones → 137, 3 usuarios con carpeta activa → 3,
  0 sesiones huérfanas, `sqlite_sequence` preservado en 7. **Sin pérdida.** ✅
- **Las consultas recursivas se probaron sobre un árbol de 4 niveles:** conjunto de
  descendientes, ruta completa (`Universidad › Semestre 1 › Cálculo › Límites`) y
  detección de ciclos, todo correcto. ✅
- **El backend actual rechaza el cronómetro**, medido en ejecución:
  - `mode: "cronometro"` → `400 {"error": "mode no válido"}`
  - `minutes: 0` → `400 {"error": "minutes debe estar entre 1 y 600"}`
  - `minutes: 601` → `400 {"error": "minutes debe estar entre 1 y 600"}`

  → Hay que ampliar `VALID_MODES` **y** proteger los dos extremos en el frontend.
- **`test_category_duplicate_name_rejected` seguirá pasando sin cambios**: crea dos
  carpetas homónimas en la raíz, que tras la migración comparten `parent_id = 0`, así
  que el 409 se mantiene. ✅

---

## FASE 0 — Pre-vuelo (obligatoria)

1. Copia de seguridad:
   ```bash
   cp study.db "study.db.pre-subcarpetas-$(date +%Y%m%d)"
   ```
2. Árbol de git limpio (`git status`). Si no, commit o stash.
3. Línea base de tests y datos:
   ```bash
   venv/Scripts/python.exe -m pytest -q          # deben pasar 28
   python ver_db.py                              # anota el total: 137
   ```
   **Ese número no debe bajar en ninguna fase.**

---

## FASE 1 — Backend: migración del esquema

Solo se toca `app.py`. **Es la fase con más riesgo del plan**: reconstruye una tabla.

### 1.1 — Constantes

Junto a las constantes de carpetas (líneas 52-55), añade:

```python
ROOT_PARENT_ID = 0      # centinela de raíz: NO usar NULL (rompería el UNIQUE)
MAX_CATEGORY_DEPTH = 10 # tope de seguridad del anidamiento (raíz = nivel 0)
```

### 1.2 — Migración idempotente

Dentro de `init_db()`, **después** del bloque que crea `categories` y **antes** de los
`CREATE INDEX`, añade:

```python
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
```

Y añade el índice nuevo junto a los existentes:

```python
        conn.execute("CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)")
```

**Nota sobre la definición base:** el `CREATE TABLE IF NOT EXISTS categories` original
(línea 130) se deja **tal cual**, sin tocar. Sirve para instalaciones nuevas y la
migración lo actualiza acto seguido; cambiar ambos sitios duplicaría la verdad. Si
prefieres que una instalación nueva nazca ya con la forma final, entonces actualiza el
`CREATE TABLE IF NOT EXISTS` **y** deja la migración: el guard de `PRAGMA table_info`
hace que no se ejecute dos veces.

**Análisis de riesgo:**

- ✅ **Ensayado sobre una copia de tus datos reales**, sin pérdida (ver §4).
- ✅ **Idempotente**: el guard `if "parent_id" not in cat_cols` impide que se repita.
- ✅ **`AUTOINCREMENT` se preserva** porque se copian los `id` explícitamente y
  `sqlite_sequence` sobrevive al `RENAME`.
- ✅ **Las FK de `sessions.category_id` y `users.active_category_id` no se rompen**
  porque los `id` se conservan idénticos. Verificado: 0 sesiones huérfanas tras migrar.
- ⚠️ **No envuelvas esto en `PRAGMA foreign_keys=OFF` dentro de una transacción**: ese
  pragma no se puede cambiar con una transacción abierta. El proyecto no activa
  `foreign_keys` en `get_db()` (SQLite viene con las FK desactivadas por defecto), así
  que no hace falta tocarlo.
- ⚠️ **Ejecuta la Fase 0 antes.** Si algo sale mal, `study.db.pre-subcarpetas-*` es la
  vuelta atrás.

### 1.3 — Helpers de jerarquía

Añade junto a `resolve_category()`:

```python
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
```

### Verificación de la Fase 1

```bash
python -c "import app; app.init_db(); print('migración OK')"
python -c "
import sqlite3
c = sqlite3.connect('study.db')
print(c.execute(\"SELECT sql FROM sqlite_master WHERE name='categories'\").fetchone()[0])
print('categorias:', c.execute('SELECT COUNT(*) FROM categories').fetchone()[0])
print('sesiones:', c.execute('SELECT COUNT(*) FROM sessions').fetchone()[0])
print('huerfanas:', c.execute('SELECT COUNT(*) FROM sessions WHERE category_id NOT IN (SELECT id FROM categories)').fetchone()[0])
"
python -c "import app; app.init_db(); app.init_db(); print('idempotente OK')"
venv/Scripts/python.exe -m pytest -q
```

Esperado: la tabla muestra `parent_id` y `UNIQUE(user_id, parent_id, name)`;
**5 categorías, 137 sesiones, 0 huérfanas**; los 28 tests siguen pasando.

**Commit:** `Backend: migra categories a jerarquía con parent_id y UNIQUE por padre`

---

## FASE 2 — Backend: endpoints de la jerarquía

Solo se toca `app.py`.

### 2.1 — `GET /api/categories` devuelve el árbol

Reemplaza `_category_json()` y `get_categories()`:

```python
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
```

> ⚠️ Aquí `UNION ALL` es correcto y necesario (dos carpetas distintas pueden compartir
> nombre en ramas distintas, y `UNION` las fusionaría). El recorrido está acotado
> porque `parent_id` forma un árbol, invariante que garantiza la validación de ciclos
> de 2.3.

### 2.2 — `POST /api/categories` acepta `parent_id`

En `create_category()`, tras validar `name` y `color`, añade:

```python
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
```

**Nota:** el mensaje del 409 cambia de *"Ya existe una carpeta con ese nombre"* a
*"...en el mismo nivel"*, que es lo que ahora significa. Los tests que solo comprueban
el código 409 siguen pasando.

### 2.3 — `PATCH /api/categories/<cid>` acepta mover y cascada de archivado

En `update_category()`, dentro del bloque que arma `updates`, añade el tratamiento de
`parent_id` **antes** del de `archived`:

```python
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
```

Y **sustituye** el bloque de `archived` por esta versión con cascada:

```python
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
```

> **Por qué la cascada va en un `UPDATE` aparte y no en la lista `updates`:** afecta a
> varias filas, mientras que `updates` construye un `UPDATE` de una sola carpeta.
> Ojo: si `archived` es lo único que llega, `updates` queda vacío y el bloque
> `if updates:` no se ejecuta — asegúrate de que la reasignación de la carpeta activa
> y el `conn.commit()` finales corran igualmente. Reestructura el final de la función
> para que el `commit()` sea incondicional.

**Invariante que garantiza este diseño:** *toda carpeta activa tiene su cadena de
ancestros activa.* Archivar baja en cascada; desarchivar sube en cascada. Sin esto
aparecerían carpetas activas imposibles de ver en el árbol.

### 2.4 — Cambios que **NO** hay que hacer

Verificado que estas funciones siguen siendo correctas sin tocarlas:

- **`resolve_category()`**: su cascada de reservas no depende de la jerarquía.
- **`save_preferences()`** (`active_category_id`): cualquier carpeta no archivada del
  usuario vale, padre o no — coherente con la decisión de "registrar en ambas".
- **`update_session()`**: reasignar una sesión a cualquier carpeta propia sigue igual.
- **`register()`**: la carpeta inicial nace en la raíz con el `DEFAULT 0`.

### Verificación de la Fase 2

Con la app corriendo y sesión iniciada:

```bash
curl -s localhost:5000/api/categories        # cada carpeta con parent_id, depth y path
```

Crea a mano una jerarquía y comprueba: crear subcarpeta (200), nombre repetido bajo el
**mismo** padre (409), **mismo nombre bajo padres distintos** (200 ← el objetivo de la
fase), mover una carpeta dentro de su propia descendencia (400), archivar un padre
(sus hijas quedan archivadas).

**Commit:** `Backend: endpoints de jerarquía de carpetas (crear, mover, archivar en cascada)`

---

## FASE 3 — Frontend: árbol de carpetas en Ajustes

Solo se toca `static/index.html`.

### 3.1 — Helpers de jerarquía en cliente

Junto a `categoryById` (:941), añade:

```js
// El backend ya devuelve las carpetas en preorden y con `depth`/`path`, así que
// estos helpers solo navegan el array plano, sin recalcular el árbol.
const childrenOf = pid => categories.filter(c => +c.parent_id === +pid);

// IDs de una carpeta y todos sus descendientes. Con tope de iteraciones por si
// los datos llegaran corruptos: nunca debe colgar la UI.
function descendantIds(id) {
  const out = new Set([+id]);
  let cambio = true, vueltas = 0;
  while (cambio && vueltas++ < 100) {
    cambio = false;
    categories.forEach(c => {
      if (out.has(+c.parent_id) && !out.has(+c.id)) { out.add(+c.id); cambio = true; }
    });
  }
  return out;
}
```

### 3.2 — El filtro global incluye descendientes

Sustituye `filteredDb()` (:943):

```js
// Filtrar por una carpeta incluye las sesiones de todas sus subcarpetas.
const filteredDb = () => {
  if (!filterCategoryId) return db;
  const ids = descendantIds(filterCategoryId);
  return db.filter(r => ids.has(+r.category_id));
};
```

**Riesgo:** ninguno para datos planos. Con `parent_id = 0` en todas las carpetas (el
estado justo tras migrar), `descendantIds(x)` devuelve `{x}` y el comportamiento es
idéntico al actual.

### 3.3 — Árbol en Ajustes

En `renderCategoryUI()` (:1721), sustituye el bloque que pinta `.cat-list` por una
versión con sangría por nivel, botón de "añadir subcarpeta" y selector de destino
para mover:

```js
    list.innerHTML = categories.map(c => `
      <div class="cat-row${c.archived ? ' archived' : ''}" style="padding-left:${8 + c.depth * 22}px">
        ${c.depth > 0 ? '<span class="cat-branch" aria-hidden="true">└</span>' : ''}
        <span class="cat-dot" style="background:${esc(c.color)}"></span>
        <span class="cat-name" title="${esc(c.path)}">${esc(c.name)}</span>
        <span class="spacer"></span>
        <button class="cat-action" onclick="addSubcategory(${c.id})"><i class="ti ti-folder-plus" aria-hidden="true"></i> Subcarpeta</button>
        <button class="cat-action" onclick="renameCategory(${c.id})"><i class="ti ti-pencil" aria-hidden="true"></i> Renombrar</button>
        <button class="cat-action" onclick="moveCategory(${c.id})"><i class="ti ti-arrows-move" aria-hidden="true"></i> Mover</button>
        <button class="cat-action" onclick="toggleArchive(${c.id})">
          <i class="ti ti-${c.archived ? 'archive-off' : 'archive'}" aria-hidden="true"></i> ${c.archived ? 'Restaurar' : 'Archivar'}
        </button>
      </div>`).join('');
```

Añade el CSS junto al resto de reglas de `.cat-row`:

```css
    .cat-branch { color: var(--faint); margin-right: 4px; font-size: 12px; }
```

Y las dos funciones nuevas, siguiendo el patrón de `createCategory()` (:1839):

```js
function addSubcategory(parentId) {
  const padre = categoryById(parentId);
  if (!padre) return;
  const name = prompt(`Nombre de la nueva subcarpeta dentro de "${padre.name}":`, '');
  if (name === null) return;
  const limpio = name.trim();
  if (!limpio) return;
  fetch('/api/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: limpio, parent_id: parentId })
  }).then(r => r.json()).then(d => {
    if (!d.ok) { toast(d.error || 'No se pudo crear la subcarpeta'); return; }
    loadCategories().then(() => toast('Subcarpeta creada ✓'));
  }).catch(() => toast('Error de conexión'));
}

function moveCategory(id) {
  const cat = categoryById(id);
  if (!cat) return;
  // Destinos válidos: cualquier carpeta que no sea ella misma ni su descendencia.
  const prohibidos = descendantIds(id);
  const destinos = categories.filter(c => !c.archived && !prohibidos.has(+c.id));
  const opciones = ['0) Raíz (sin carpeta padre)']
    .concat(destinos.map((c, i) => `${i + 1}) ${c.path}`)).join('\n');
  const resp = prompt(`¿Dónde quieres mover "${cat.name}"?\n\n${opciones}\n\nEscribe el número:`, '0');
  if (resp === null) return;
  const idx = parseInt(resp, 10);
  if (isNaN(idx) || idx < 0 || idx > destinos.length) { toast('Destino no válido'); return; }
  const parent_id = idx === 0 ? 0 : destinos[idx - 1].id;
  fetch(`/api/categories/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_id })
  }).then(r => r.json()).then(d => {
    if (!d.ok) { toast(d.error || 'No se pudo mover la carpeta'); return; }
    loadCategories().then(() => toast('Carpeta movida ✓'));
  }).catch(() => toast('Error de conexión'));
}
```

> **Sobre `prompt()`:** es lo que ya usa `renameCategory()` (:1859), así que mantiene
> la coherencia y evita construir modales nuevos. Si más adelante quieres una UI mejor
> (arrastrar y soltar, un `<dialog>`), es un cambio aislado a estas dos funciones.

### Verificación de la Fase 3

En Ajustes: crea una jerarquía de 3 niveles y comprueba que la sangría es correcta,
que "Subcarpeta" cuelga del padre correcto, que "Mover" no ofrece como destino ni la
propia carpeta ni sus hijas, y que archivar un padre archiva la rama entera.

**Prueba de escapado (obligatoria):** crea una carpeta llamada
`<img src=x onerror=alert(1)>`; debe verse el texto literal en el árbol, en el `title`
y en los tres `<select>`. Bórrala después.

**Commit:** `Frontend: árbol de carpetas con subcarpetas, mover y archivado en cascada`

---

## FASE 4 — Frontend: rutas completas en los selectores

Solo se toca `static/index.html`. **Depende de la Fase 3.**

`<optgroup>` **no se puede anidar**, así que con profundidad arbitraria la ruta se
representa con sangría de texto dentro de cada `<option>`.

### 4.1 — Helper de etiqueta

```js
// Etiqueta de carpeta para un <option>: sangría por nivel + nombre.
// Se usa el espacio duro ( ) porque los navegadores colapsan los normales.
function catOptionLabel(c) {
  return '  '.repeat(c.depth || 0) + (c.depth ? '└ ' : '') + c.name;
}
```

### 4.2 — Aplicarlo en los tres selectores

| Línea aprox. | Selector | Cambio |
|---|---|---|
| :1723 | Filtro global del topbar | `${esc(c.name)}` → `${esc(catOptionLabel(c))}` |
| :1731 | Carpeta activa del Timer | `${esc(c.name)}` → `${esc(catOptionLabel(c))}` |
| :1556 | Reasignación en el Historial (`catSelectHtml`) | `${esc(c.name)}` → `${esc(catOptionLabel(c))}` |

**Mantén `esc()` en todos los casos** (regla invariable nº 4). No lo quites pensando
que la etiqueta ya está "procesada": `catOptionLabel` concatena el nombre crudo.

En el selector de **carpeta activa** hay un detalle: hoy filtra `!c.archived`. Con la
jerarquía, eso sigue siendo correcto gracias al invariante de la Fase 2.3 (si el padre
está archivado, las hijas también).

### 4.3 — Indicador de carpeta activa en el Timer

El punto de color y el nombre de la carpeta activa (:1735 aprox.) deberían mostrar la
**ruta completa** para que se sepa en qué rama se está registrando. Usa `c.path`, no
`c.name`, y escápalo.

### Verificación de la Fase 4

Los tres desplegables muestran la jerarquía con sangría. Cambiar la carpeta activa a
una subcarpeta profunda y registrar una sesión manual la deja en la carpeta correcta
(compruébalo en el Historial). El filtro global sobre un padre suma las sesiones de
todas sus hijas.

**Commit:** `Frontend: rutas jerárquicas en los selectores de carpeta`

---

## FASE 5 — Backend: admitir el modo cronómetro

Solo se toca `app.py`. **Independiente de las fases 1-4.**

**Instrucción:** en la lista blanca de modos, añade `"cronometro"`:

```python
VALID_MODES  = {"pomodoro", "break", "manual", "cronometro"}
```

**Análisis de riesgo:**

- ✅ **Ampliar una lista blanca no invalida datos existentes.** Los 137 registros
  actuales usan `pomodoro`/`break`/`manual` y siguen pasando la validación.
- ✅ **Sin cambio de esquema.** `mode` es una columna `TEXT` libre; la restricción vive
  solo en la validación de la API.
- ⚠️ **Efecto esperado en las métricas:** "Enfoque Pomodoro" es
  `minutos_pomodoro / minutos_totales`. Las sesiones de cronómetro cuentan como
  estudio pero no como pomodoro, así que **bajarán ese porcentaje**. Es el
  comportamiento correcto y deseado, pero conviene saberlo para no confundirlo con un
  error.
- ✅ **La racha, el IRS y el heatmap sí las cuentan**, porque solo excluyen
  `mode === 'break'`.

**Commit:** `Backend: admite el modo cronometro en las sesiones`

---

## FASE 6 — Frontend: modo cronómetro

Solo se toca `static/index.html`. **Depende de la Fase 5.**

### 6.1 — Los dos extremos que provocarían un 400

Medido en ejecución contra tu backend:

| Situación | Respuesta actual del backend | Cómo evitarlo |
|---|---|---|
| Cronómetro parado antes de 1 minuto | `400 minutes debe estar entre 1 y 600` | **No registrar**; avisar con un toast |
| Cronómetro corriendo más de 10 h | `400 minutes debe estar entre 1 y 600` | **Recortar a 600** y avisar |

Estos dos guardas **no son opcionales**: sin ellos la sesión se pierde en silencio
(`logSession` solo hace `console.error` al fallar el `fetch`).

### 6.2 — Estado

Amplía `state` (:963). **Usa `timerMode`, no `mode`**: `mode` ya significa otra cosa en
las sesiones y confundirlos sería una fuente de errores.

```js
let state = {
  running: false, paused: false, phase: 'work', session: 1,
  remaining: cfg.work * 60, endTime: null,
  type: 'General', cycleCount: 0,
  timerMode: 'pomodoro',   // 'pomodoro' | 'cronometro'
  elapsed: 0,              // segundos acumulados (solo cronómetro)
  startedAt: null          // timestamp del arranque del tramo actual
};
const CRONO_CICLO = 60 * 60;   // el anillo da una vuelta completa por hora
```

### 6.3 — Selector de modo

En el HTML, justo encima de `.btn-row` (:672), añade:

```html
          <div class="timer-mode-switch" role="tablist" aria-label="Modo del temporizador">
            <button class="mode-btn active" id="mode-btn-pomodoro" role="tab" aria-selected="true"
                    onclick="setTimerMode('pomodoro')"><i class="ti ti-clock-play" aria-hidden="true"></i> Pomodoro</button>
            <button class="mode-btn" id="mode-btn-cronometro" role="tab" aria-selected="false"
                    onclick="setTimerMode('cronometro')"><i class="ti ti-stopwatch" aria-hidden="true"></i> Cronómetro</button>
          </div>
```

CSS, junto al resto de botones:

```css
    .timer-mode-switch { display: flex; gap: 6px; justify-content: center; margin-bottom: 14px; }
    .mode-btn {
      background: var(--surface-2); color: var(--muted); border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: 7px 14px; font-size: 13px; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
    }
    .mode-btn:hover { color: var(--text); }
    .mode-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
    .badge-cronometro { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
```

> `.badge-cronometro` es **obligatorio**: el Historial pinta
> `<span class="badge badge-${r.mode}">` y sin la regla la insignia saldría sin estilo.

```js
function setTimerMode(m) {
  if (m === state.timerMode) return;
  if (state.running || state.paused) {
    if (!confirm('Cambiar de modo reiniciará el temporizador actual. ¿Continuar?')) return;
  }
  state.timerMode = m;
  resetTimer();
  document.getElementById('mode-btn-pomodoro').classList.toggle('active', m === 'pomodoro');
  document.getElementById('mode-btn-cronometro').classList.toggle('active', m === 'cronometro');
  document.getElementById('mode-btn-pomodoro').setAttribute('aria-selected', m === 'pomodoro');
  document.getElementById('mode-btn-cronometro').setAttribute('aria-selected', m === 'cronometro');
  // La tarjeta de configuración solo aplica al Pomodoro.
  document.querySelector('.config-card').style.opacity = m === 'cronometro' ? '0.45' : '';
  document.querySelector('.config-card').inert = (m === 'cronometro');
}
```

### 6.4 — Ramificar la máquina de estados

Estas cinco funciones necesitan una rama para el cronómetro. **No dupliques la
máquina**: bifurca dentro de cada una.

**`renderClock()`** (:1029) — al principio:
```js
  if (state.timerMode === 'cronometro') { renderCrono(); return; }
```
Y añade:
```js
function renderCrono() {
  const t = state.elapsed;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = n => String(n).padStart(2, '0');
  const txt = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  document.getElementById('timer-display').textContent = txt;

  // El anillo se llena progresivamente y da una vuelta por hora.
  const frac = (t % CRONO_CICLO) / CRONO_CICLO;
  const ring = document.getElementById('ring');
  ring.style.strokeDashoffset = CIRC * (1 - frac);
  ring.className.baseVal = 'ring-fg';

  const mins = Math.floor(t / 60);
  document.getElementById('timer-percent').textContent =
    mins < 1 ? 'menos de 1 minuto' : `${mins} min acumulados`;
  document.getElementById('phase-label').textContent = 'Cronómetro';
  document.getElementById('timer-meta').textContent =
    state.running ? 'Contando…' : (state.paused ? 'En pausa' : 'Listo para empezar');
  document.title = state.running ? `${txt} — FocusData` : 'FocusData';
}
```

**`startTimer()`** (:1064) — al principio:
```js
  if (state.timerMode === 'cronometro') {
    state.startedAt = Date.now() - state.elapsed * 1000;
    state.paused = false; state.running = true;
    updateToggleButton();
    interval = setInterval(tick, 250);
    return;
  }
```

**`pauseTimer()`** (:1079) — al principio:
```js
  if (state.timerMode === 'cronometro') {
    clearInterval(interval);
    state.elapsed = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    state.running = false; state.paused = true;
    updateToggleButton(); renderClock();
    return;
  }
```

**`tick()`** (:1101) — al principio:
```js
  if (state.timerMode === 'cronometro') {
    state.elapsed = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    renderClock();
    return;   // el cronómetro no termina solo: nunca llama a phaseComplete()
  }
```

**`resetTimer()`** (:1088) — añade al final, antes de `renderClock()`:
```js
  state.elapsed = 0;
  state.startedAt = null;
```

**`updateConfig()`** (:981) — la última línea reinicia `state.remaining` y pisaría el
cronómetro. Cámbiala a:
```js
  if (state.timerMode === 'pomodoro' && !state.running && !state.paused) {
    state.remaining = cfg.work * 60; renderClock();
  }
```

### 6.5 — Guardar la sesión

Añade el botón de guardar al `.btn-row`, visible solo en modo cronómetro:

```html
            <button class="btn-secondary" id="btn-crono-save" style="display:none;" onclick="saveCrono()"><i class="ti ti-device-floppy" aria-hidden="true"></i> Guardar sesión</button>
```

Muéstralo/ocúltalo dentro de `setTimerMode()`:
```js
  document.getElementById('btn-crono-save').style.display = (m === 'cronometro') ? '' : 'none';
```

```js
function saveCrono() {
  // Congela el conteo antes de leer, para no registrar un valor desfasado.
  if (state.running) pauseTimer();
  const mins = Math.round(state.elapsed / 60);

  // Los dos guardas que evitan un 400 del backend (MINUTES_MIN=1, MINUTES_MAX=600).
  if (mins < 1) { toast('Muy corto para registrar (mínimo 1 minuto)'); return; }
  const registrados = Math.min(mins, 600);
  if (registrados < mins) toast('Sesión muy larga: se registran 600 min (10 h)');

  logSession(registrados, state.type, 'cronometro');
  toast(`Sesión de ${registrados} min registrada ✓`);
  resetTimer();
}
```

### 6.6 — Limitación asumida

El estado del temporizador vive **solo en memoria** (así es hoy también para el
Pomodoro): recargar la página o cerrar la pestaña pierde el conteo en curso.
Persistirlo en `localStorage` es una mejora natural, pero queda **fuera de alcance**
de este plan para no mezclar cambios.

### Verificación de la Fase 6

1. Cambiar a Cronómetro: la tarjeta de Configuración se atenúa y queda inerte.
2. Iniciar, esperar >1 min, pausar, reanudar: el conteo continúa donde iba.
3. "Guardar sesión" → aparece en el Historial con la insignia verde `cronometro`,
   y la carpeta activa correcta.
4. Iniciar y guardar antes de 1 minuto → toast de aviso y **ninguna** sesión creada
   (compruébalo con `python ver_db.py`, el total no cambia).
5. Volver a Pomodoro: pide confirmación si había algo en marcha y funciona como antes.
6. Consola del navegador **sin errores** en todo el flujo.

**Commit:** `Frontend: modo cronómetro que cuenta hacia adelante`

---

## FASE 7 — Tests

Añade a [tests/test_api.py](tests/test_api.py). **Los 28 existentes deben seguir pasando
sin modificarlos.**

```python
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
```

**Ejecución:**
```bash
venv/Scripts/python.exe -m pytest -q     # deben pasar 28 + 13 = 41
```

**Commit:** `Tests: cubre la jerarquía de carpetas y el modo cronómetro`

---

## Checklist final de regresión

Con la app corriendo y sesión iniciada, tras la última fase:

- [ ] Login, registro y logout funcionan.
- [ ] `python ver_db.py` → **137 sesiones**, ninguna perdida.
- [ ] Un Pomodoro completo se registra igual que antes.
- [ ] Un descanso se registra pero no suma en estadísticas.
- [ ] Sesión manual sigue funcionando.
- [ ] **Cronómetro**: cuenta hacia arriba, pausa/reanuda, guarda con insignia propia.
- [ ] **Cronómetro < 1 min**: avisa y no crea ninguna sesión.
- [ ] Crear carpeta raíz y subcarpetas a 3+ niveles.
- [ ] Mismo nombre en dos ramas distintas: permitido.
- [ ] Mismo nombre bajo el mismo padre: rechazado con mensaje claro.
- [ ] Mover una carpeta dentro de su propia rama: rechazado.
- [ ] Archivar un padre archiva toda su rama; restaurar una hija restaura la cadena.
- [ ] No se puede archivar la única carpeta activa.
- [ ] Los tres selectores muestran la jerarquía con sangría.
- [ ] Filtrar por un padre suma las sesiones de todas sus subcarpetas.
- [ ] Reasignar una sesión desde el Historial funciona.
- [ ] Temas, color de acento y gráficos siguen bien.
- [ ] Exportar CSV produce un archivo correcto.
- [ ] Cerrar sesión y entrar con otra cuenta no muestra datos de la anterior.
- [ ] Consola del navegador sin errores.
- [ ] `pytest` → 41 en verde.

---

## Fuera de alcance

No hagas nada de esto sin pedirlo explícitamente:

- Borrar carpetas (hoy solo se archivan).
- Arrastrar y soltar para reorganizar el árbol (la Fase 3 usa `prompt()`, igual que el
  renombrado actual).
- Persistir el estado del temporizador en `localStorage`.
- Filtros anuales/semanales/por actividad en Estadísticas (quedan para un plan aparte).
- Heredar el color de la carpeta padre en las subcarpetas.
- Colapsar/expandir ramas del árbol.
- Mover el cálculo de estadísticas al backend.
