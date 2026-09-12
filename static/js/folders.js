// Carpetas: árbol de la barra lateral, página de gestión y operaciones (CRUD).
import { $, ic, esc, toast, on, api, fmtHours, lsGet, lsSet } from './util.js';
import {
  S, categoryById, descendantIds, loadCategories, setActiveCategory, setFilter,
  minutesByFolder, saveDb,
} from './store.js';
import { openMenu, openModal, closeModal, askText } from './ui.js';

// Carpetas como items de menú.
//   archived: 'hide' las oculta | 'show' las lista con nota
//   keepId:   id que se muestra aunque esté archivado (la carpeta actual de una fila)
//   exclude:  Set de ids no seleccionables
//   lead:     item fijo al principio ("Todas las carpetas", "Raíz"…)
export function folderItems({ archived = 'hide', keepId = null, exclude = null, lead = null } = {}) {
  const items = lead ? [lead] : [];
  S.categories.forEach(c => {
    if (c.archived && archived === 'hide' && +c.id !== +keepId) return;
    items.push({
      value: c.id, label: c.name, search: c.path || c.name, depth: c.depth || 0, color: c.color,
      hint: c.archived ? 'archivada' : '', disabled: exclude ? exclude.has(+c.id) : false,
    });
  });
  return items;
}

const ROOT_ITEM = { value: 0, label: 'En la raíz (sin carpeta padre)', icon: 'home' };

// Destinos válidos para mover: nunca la propia carpeta ni su descendencia, nunca una archivada.
function destinationItems(id, { withRoot = true } = {}) {
  const forbidden = id == null ? new Set() : descendantIds(id);
  return folderItems({ archived: 'hide', lead: withRoot ? ROOT_ITEM : null })
    .map(it => (it.value === 0 ? it : { ...it, disabled: forbidden.has(+it.value) }));
}

// ── Árbol de la barra lateral ──
const COLLAPSED_KEY = 'focusdata.tree.collapsed';
const collapsed = new Set(lsGet(COLLAPSED_KEY, []));

function renderSideTree() {
  const box = $('#side-tree');
  const live = S.categories.filter(c => !c.archived);
  if (!live.length) { box.innerHTML = '<div class="side-empty">Aún no hay carpetas</div>'; return; }
  const mins = minutesByFolder();
  const kids = pid => live.filter(c => +c.parent_id === +pid);
  const node = c => {
    const children = kids(c.id);
    const open = !collapsed.has(c.id);
    return `<li>
      <div class="tn${+S.filterCategoryId === c.id ? ' sel' : ''}" style="--d:${c.depth || 0}">
        ${children.length
          ? `<button type="button" class="tn-tog" data-tree-toggle="${c.id}" aria-expanded="${open}" aria-label="Plegar o desplegar ${esc(c.name)}">${ic('chev-right', 's12')}</button>`
          : '<span class="tn-pad"></span>'}
        <button type="button" class="tn-main" data-folder-filter="${c.id}" title="Filtrar por ${esc(c.path)}">
          <span class="dot" style="--c:${esc(c.color)}"></span>
          <span class="tn-name">${esc(c.name)}</span>
          <span class="tn-meta">${mins[c.id] ? fmtHours(mins[c.id]) : ''}</span>
        </button>
        <button type="button" class="icon-btn tn-more" data-folder-menu="${c.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Opciones de ${esc(c.name)}">${ic('more', 's16')}</button>
      </div>
      ${children.length
        ? `<div class="tree-sub${open ? ' open' : ''}" data-tree-sub="${c.id}"><div${open ? '' : ' inert'}><ul class="tree">${children.map(node).join('')}</ul></div></div>`
        : ''}
    </li>`;
  };
  // Raíces: las de nivel 0 (una carpeta activa siempre tiene ancestros activos).
  const roots = live.filter(c => +c.parent_id === 0 || !live.some(p => p.id === +c.parent_id));
  box.innerHTML = `<ul class="tree">${roots.map(node).join('')}</ul>`;
}

function toggleTreeNode(id) {
  const open = collapsed.has(id);
  if (open) collapsed.delete(id); else collapsed.add(id);
  lsSet(COLLAPSED_KEY, [...collapsed]);
  const sub = document.querySelector(`[data-tree-sub="${id}"]`);
  const btn = document.querySelector(`[data-tree-toggle="${id}"]`);
  if (sub) { sub.classList.toggle('open', open); sub.firstElementChild.inert = !open; }
  if (btn) btn.setAttribute('aria-expanded', String(open));
}

// ── Página de Carpetas ──
let newParent = 0;

function renderFoldersPage() {
  const list = $('#folders-list');
  if (!S.categories.length) {
    list.innerHTML = `<div class="empty">${ic('folder')}Aún no hay carpetas</div>`;
  } else {
    const mins = minutesByFolder();
    list.innerHTML = S.categories.map(c => `
      <div class="frow${c.archived ? ' archived' : ''}" style="--d:${c.depth || 0}">
        <span class="dot" style="--c:${esc(c.color)}"></span>
        <span class="name" title="${esc(c.path)}">${esc(c.name)}</span>
        ${+c.id === +S.activeCategoryId ? '<span class="badge">activa</span>' : ''}
        ${c.archived ? '<span class="badge">archivada</span>' : ''}
        <span class="meta">${mins[c.id] ? fmtHours(mins[c.id]) : '—'}</span>
        <button type="button" class="icon-btn" data-folder-menu="${c.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Opciones de ${esc(c.name)}">${ic('more')}</button>
      </div>`).join('');
  }
  const parent = categoryById(newParent);
  if (newParent && (!parent || parent.archived)) newParent = 0;
  $('#new-folder-parent-label').textContent = newParent ? categoryById(newParent).path : 'En la raíz';
}

function folderMenu(anchor, id) {
  const c = categoryById(id);
  if (!c) return;
  const isFilter = +S.filterCategoryId === c.id;
  const actions = {
    active: () => setActiveCategory(id),
    filter: () => setFilter(isFilter ? '' : id),
    sub: () => addSubcategory(id),
    rename: () => renameCategory(id),
    move: () => moveCategory(id),
    archive: () => toggleArchive(id),
    delete: () => deleteCategory(id),
  };
  openMenu({
    anchor, align: 'end', minWidth: 236,
    items: [
      { value: 'active', label: 'Usar como carpeta activa', icon: 'check-circle', action: true, disabled: !!c.archived || +S.activeCategoryId === c.id },
      { value: 'filter', label: isFilter ? 'Quitar filtro' : 'Filtrar por esta carpeta', icon: 'filter', action: true },
      { type: 'sep' },
      { value: 'sub', label: 'Nueva subcarpeta…', icon: 'folder-add', action: true, disabled: !!c.archived },
      { value: 'rename', label: 'Renombrar…', icon: 'rename', action: true },
      { value: 'move', label: 'Mover…', icon: 'move', action: true },
      { value: 'archive', label: c.archived ? 'Restaurar' : 'Archivar', icon: c.archived ? 'undo' : 'archive', action: true },
      { type: 'sep' },
      { value: 'delete', label: 'Eliminar…', icon: 'delete', action: true, danger: true },
    ],
    onSelect: v => actions[v] && actions[v](),
  });
}

// ── Operaciones ──
async function createCategory(name, color, parentId) {
  const { ok, data } = await api('/api/categories', {
    method: 'POST', body: { name, color, parent_id: parentId || undefined },
  });
  if (!ok) { toast(data.error || 'No se pudo crear la carpeta', 'error'); return false; }
  await loadCategories();
  toast(`Carpeta «${data.name}» creada`);
  return true;
}

async function renameCategory(id) {
  const c = categoryById(id);
  if (!c) return;
  const name = await askText({ title: 'Renombrar carpeta', icon: 'rename', label: 'Nombre', value: c.name, confirmLabel: 'Renombrar' });
  if (!name || name === c.name) return;
  const { ok, data } = await api(`/api/categories/${id}`, { method: 'PATCH', body: { name } });
  if (!ok) { toast(data.error || 'No se pudo renombrar', 'error'); return; }
  S.db.forEach(r => { if (+r.category_id === +id) r.category_name = data.name; });
  saveDb();
  await loadCategories();
  toast('Carpeta renombrada');
}

async function addSubcategory(parentId) {
  const parent = categoryById(parentId);
  if (!parent) return;
  const name = await askText({
    title: 'Nueva subcarpeta', icon: 'folder-add', label: 'Nombre',
    message: `Se creará dentro de <b>${esc(parent.path)}</b>.`, placeholder: 'Por ejemplo, Unidad 1', confirmLabel: 'Crear',
  });
  if (!name) return;
  await createCategory(name, parent.color, parentId);
}

async function toggleArchive(id) {
  const c = categoryById(id);
  if (!c) return;
  const { ok, data } = await api(`/api/categories/${id}`, { method: 'PATCH', body: { archived: !c.archived } });
  if (!ok) { toast(data.error || 'No se pudo archivar', 'error'); return; }
  await loadCategories();
  toast(data.archived ? 'Carpeta archivada' : 'Carpeta restaurada');
}

// Botón de un modal que abre un menú de carpetas y recuerda la elección.
function pickerButton(btn, { items, value, onPick }) {
  btn.addEventListener('click', () => openMenu({
    anchor: btn, value: value(), items: items(), search: true, minWidth: Math.max(260, btn.offsetWidth),
    onSelect: (v, it) => {
      btn.querySelector('.lbl').textContent = it.search || it.label;
      btn.querySelector('.dot').style.setProperty('--c', it.color || 'transparent');
      onPick(+v);
    },
  }));
}

function moveCategory(id) {
  const c = categoryById(id);
  if (!c) return;
  let target = +c.parent_id || 0;
  const current = categoryById(target);
  const card = openModal(`
    <h3>${ic('move')} Mover carpeta</h3>
    <p class="modal-sub">Elige dónde debe quedar <b>${esc(c.name)}</b>. Sus subcarpetas se mueven con ella.</p>
    <div class="modal-field">
      <span class="modal-label">Nueva ubicación</span>
      <button type="button" class="btn" id="move-target" aria-haspopup="menu" aria-expanded="false">
        <span class="dot" style="--c:${current ? esc(current.color) : 'transparent'}"></span>
        <span class="lbl">${current ? esc(current.path) : ROOT_ITEM.label}</span>${ic('chev-down', 's12')}
      </button>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>Cancelar</button>
      <button type="button" class="btn primary" data-ok>${ic('move', 's16')} Mover</button>
    </div>`);
  pickerButton(card.querySelector('#move-target'), { items: () => destinationItems(id), value: () => target, onPick: v => { target = v; } });
  card.querySelector('[data-cancel]').addEventListener('click', () => closeModal());
  card.querySelector('[data-ok]').addEventListener('click', async () => {
    closeModal();
    const { ok, data } = await api(`/api/categories/${id}`, { method: 'PATCH', body: { parent_id: target } });
    if (!ok) { toast(data.error || 'No se pudo mover la carpeta', 'error'); return; }
    await loadCategories();
    toast('Carpeta movida');
  });
}

function deleteCategory(id) {
  const c = categoryById(id);
  if (!c) return;
  const ids = descendantIds(id);
  const sessions = S.db.filter(r => ids.has(+r.category_id)).length;
  const subfolders = ids.size - 1;
  const destinations = destinationItems(id, { withRoot: false }).filter(it => !it.disabled);
  const canMove = sessions > 0 && destinations.length > 0;
  let mode = canMove ? 'move' : 'delete';
  let target = null;
  if (canMove) target = +(destinations.find(it => +it.value === +c.parent_id) || destinations[0]).value;
  const targetCat = () => categoryById(target);

  const what = subfolders === 0 ? `<b>${esc(c.name)}</b>`
    : subfolders === 1 ? `<b>${esc(c.name)}</b> y su subcarpeta`
    : `<b>${esc(c.name)}</b> y sus <b>${subfolders}</b> subcarpetas`;
  const count = sessions === 1 ? '1 sesión' : `${sessions} sesiones`;
  const plural = sessions === 1 ? '' : 's';

  const card = openModal(`
    <h3>${ic('delete')} Eliminar carpeta</h3>
    <p class="modal-sub">Vas a eliminar ${what}. Contiene <b>${count}</b>.</p>
    <div class="modal-warn">${ic('warning')}<span>No se puede deshacer. Si solo quieres quitarla de en medio sin perder nada, <b>archívala</b>.</span></div>
    ${sessions > 0 ? `
    <div class="modal-field">
      <span class="modal-label">¿Qué hacemos con ${sessions === 1 ? 'esa sesión' : 'esas sesiones'}?</span>
      <div class="choice-list">
        ${destinations.length ? `
        <label class="choice"><input type="radio" name="del-content" value="move" ${mode === 'move' ? 'checked' : ''}>
          <span class="choice-text">Moverla${plural} a otra carpeta<small>El tiempo registrado se conserva en tus estadísticas.</small></span></label>` : ''}
        <label class="choice"><input type="radio" name="del-content" value="delete" ${mode === 'delete' ? 'checked' : ''}>
          <span class="choice-text">Eliminarla${plural} también<small>${sessions === 1 ? 'Desaparece' : 'Desaparecen'} del historial y de las estadísticas para siempre.</small></span></label>
      </div>
    </div>` : ''}
    ${canMove ? `
    <div class="modal-field" id="del-target-field">
      <span class="modal-label">Mover a</span>
      <button type="button" class="btn" id="del-target" aria-haspopup="menu" aria-expanded="false">
        <span class="dot" style="--c:${esc(targetCat() ? targetCat().color : 'transparent')}"></span>
        <span class="lbl">${esc(targetCat() ? targetCat().path : '—')}</span>${ic('chev-down', 's12')}
      </button>
    </div>` : ''}
    <div class="modal-field" id="del-confirm-field" hidden>
      <label class="modal-label" for="del-confirm">Escribe ELIMINAR para confirmar</label>
      <input type="text" class="field" id="del-confirm" autocomplete="off" spellcheck="false" placeholder="ELIMINAR">
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>Cancelar</button>
      <button type="button" class="btn danger-solid" data-ok>${ic('delete', 's16')} Eliminar</button>
    </div>`);

  const targetField = card.querySelector('#del-target-field');
  const confirmField = card.querySelector('#del-confirm-field');
  const confirmInput = card.querySelector('#del-confirm');
  const okBtn = card.querySelector('[data-ok]');
  // Solo se exige teclear ELIMINAR cuando de verdad se pierden sesiones.
  const sync = () => {
    const losesSessions = mode === 'delete' && sessions > 0;
    if (targetField) targetField.hidden = mode !== 'move';
    confirmField.hidden = !losesSessions;
    okBtn.disabled = losesSessions ? confirmInput.value.trim().toUpperCase() !== 'ELIMINAR' : (mode === 'move' && target == null);
  };
  card.querySelectorAll('input[name="del-content"]').forEach(r => r.addEventListener('change', () => { mode = r.value; sync(); }));
  confirmInput.addEventListener('input', sync);
  if (canMove) pickerButton(card.querySelector('#del-target'), { items: () => destinations, value: () => target, onPick: v => { target = v; sync(); } });
  card.querySelector('[data-cancel]').addEventListener('click', () => closeModal());
  okBtn.addEventListener('click', () => confirmDelete(id, mode, target));
  sync();
}

async function confirmDelete(id, mode, target) {
  const targetCat = mode === 'move' ? categoryById(target) : null;
  closeModal();
  const { ok, data } = await api(`/api/categories/${id}`, {
    method: 'DELETE', body: mode === 'move' ? { content: 'move', target_id: target } : { content: 'delete' },
  });
  if (!ok) { toast(data.error || 'No se pudo eliminar la carpeta', 'error'); return; }
  const gone = new Set((data.deleted_ids || []).map(Number));
  // Espejo local: el caché tiene que decir lo mismo que la base de datos,
  // o el próximo sync resucitaría lo borrado.
  if (mode === 'move' && targetCat) {
    S.db.forEach(r => { if (gone.has(+r.category_id)) { r.category_id = targetCat.id; r.category_name = targetCat.name; } });
  } else {
    S.db = S.db.filter(r => !gone.has(+r.category_id));
  }
  saveDb();
  if (gone.has(+S.filterCategoryId)) setFilter('');
  if (data.active_category_id != null) S.activeCategoryId = +data.active_category_id;
  await loadCategories();
  const detail = data.moved_sessions ? ` · ${data.moved_sessions} sesiones movidas`
    : data.deleted_sessions ? ` · ${data.deleted_sessions} sesiones eliminadas` : '';
  toast(`Carpeta eliminada${detail}`);
}

export function initFolders() {
  document.addEventListener('click', e => {
    const tog = e.target.closest('[data-tree-toggle]');
    if (tog) { toggleTreeNode(+tog.dataset.treeToggle); return; }
    const filter = e.target.closest('[data-folder-filter]');
    if (filter) { const id = +filter.dataset.folderFilter; setFilter(+S.filterCategoryId === id ? '' : id); return; }
    const more = e.target.closest('[data-folder-menu]');
    if (more) folderMenu(more, +more.dataset.folderMenu);
  });

  $('#new-folder-parent').addEventListener('click', e => openMenu({
    anchor: e.currentTarget, value: newParent, search: true, minWidth: 280,
    items: destinationItems(null),
    onSelect: v => { newParent = +v; renderFoldersPage(); },
  }));
  $('#folder-form').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#new-folder-name');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (await createCategory(name, $('#new-folder-color').value, newParent)) input.value = '';
  });

  const render = () => { renderSideTree(); renderFoldersPage(); };
  on('categories', render);
  on('sessions', render);
  on('filter', renderSideTree);
  on('active', renderFoldersPage);
}
