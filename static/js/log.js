// Registro: historial filtrable, reasignación de carpeta, exportación y borrado.
import { $, ic, esc, toast, on, fmtMin, daysAgoStr, prettyDate } from './util.js';
import { S, filteredDb, categoryById, reassignSession, renameSession, renameType, deleteSession, clearHistory } from './store.js';
import { openMenu, openModal, closeModal, askText, confirmDialog } from './ui.js';
import { folderItems } from './folders.js';

let visible = false;
const filters = { type: '', days: 7 };
const RANGES = [
  { value: 1, label: 'Hoy' },
  { value: 7, label: 'Últimos 7 días' },
  { value: 30, label: 'Últimos 30 días' },
  { value: 0, label: 'Todo el historial' },
];
const MODE_LABEL = { pomodoro: 'Pomodoro', cronometro: 'Cronómetro', manual: 'Manual' };
const TYPE_MAX = 40;   // igual que TYPE_MAX en app.py y el maxlength de #type-input

function rows() {
  let recs = filteredDb().filter(r => r.mode !== 'break');
  if (filters.type) recs = recs.filter(r => r.type === filters.type);
  if (filters.days > 0) {
    const from = daysAgoStr(filters.days - 1);
    recs = recs.filter(r => r.date >= from);
  }
  return recs.slice().reverse();
}

// Los temas ya usados en el historial, para sugerir al renombrar (evita variantes
// como "Calculo" / "Cálculo" por descuido). Excluye el propio tema actual.
function typeSuggestions(current) {
  const types = new Set(S.db.filter(r => r.mode !== 'break' && r.type).map(r => r.type));
  types.delete(current);
  return [...types].sort((a, b) => a.localeCompare(b)).slice(0, 12);
}

// La celda de carpeta y "Mover a carpeta…" del menú ⋯ abren el mismo selector.
function openFolderPicker(anchor, rec) {
  openMenu({
    anchor, value: rec.category_id, search: true, minWidth: 260,
    items: [{ type: 'head', label: 'Mover la sesión a' }, ...folderItems({ archived: 'hide', keepId: rec.category_id })],
    onSelect: v => { if (+v !== +rec.category_id) reassignSession(rec.ts, v); },
  });
}

async function renameRow(rec) {
  const name = await askText({
    title: 'Renombrar sesión', icon: 'rename', label: 'Tema', value: rec.type,
    confirmLabel: 'Renombrar', maxLength: TYPE_MAX, suggestions: typeSuggestions(rec.type),
  });
  if (!name || name === rec.type) return;
  renameSession(rec.ts, name);
}

// Renombra (o fusiona) un tema en TODO el historial de una vez: se abre desde el
// filtro de Registro y desde la leyenda de la dona en Estadísticas. El botón y el
// aviso cambian mientras se escribe, según si el nombre nuevo ya existe o no.
export function openRenameTypeModal(currentType) {
  const count = S.db.filter(r => r.mode !== 'break' && r.type === currentType).length;
  const others = typeSuggestions(currentType);
  const othersSet = new Set(others);
  const hintFor = v => (v && v !== currentType && othersSet.has(v))
    ? `Ya existe «${esc(v)}»: las sesiones se unirán a ese tema.`
    : `Afecta a ${count} ${count === 1 ? 'sesión' : 'sesiones'} en todo tu historial.`;
  const labelFor = v => ((v && v !== currentType && othersSet.has(v)) ? 'Fusionar' : 'Renombrar');

  const card = openModal(`
    <h3>${ic('rename')} Renombrar tema</h3>
    <p class="modal-sub" data-hint>${hintFor(currentType)}</p>
    <form class="modal-field" novalidate>
      <label class="modal-label" for="rt-input">Nuevo nombre</label>
      <input id="rt-input" class="field" type="text" maxlength="${TYPE_MAX}" autocomplete="off" spellcheck="false" value="${esc(currentType)}">
    </form>
    ${others.length ? `<div class="chips ask-chips">${others.map(t => `<button type="button" class="chip" data-sugg="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>Cancelar</button>
      <button type="button" class="btn primary" data-ok>Renombrar</button>
    </div>`);
  const input = card.querySelector('#rt-input');
  const hint = card.querySelector('[data-hint]');
  const okBtn = card.querySelector('[data-ok]');
  const sync = () => {
    const v = input.value.trim();
    hint.textContent = hintFor(v);
    okBtn.textContent = labelFor(v);
  };
  input.addEventListener('input', sync);
  input.select();
  const submit = () => {
    const name = input.value.trim();
    closeModal();
    if (!name || name === currentType) return;
    renameType(currentType, name);
  };
  card.querySelector('form').addEventListener('submit', e => { e.preventDefault(); submit(); });
  okBtn.addEventListener('click', submit);
  card.querySelector('[data-cancel]').addEventListener('click', () => closeModal());
  if (others.length) {
    card.querySelector('.ask-chips').addEventListener('click', e => {
      const chip = e.target.closest('[data-sugg]');
      if (!chip) return;
      input.value = chip.dataset.sugg;
      sync();
      input.focus();
    });
  }
}

function folderCell(r) {
  const cat = categoryById(r.category_id);
  const name = cat ? cat.path + (cat.archived ? ' (archivada)' : '') : (r.category_name || '—');
  if (r.remote_id == null) return `<span class="muted" title="Se podrá cambiar cuando se sincronice">${esc(name)}</span>`;
  return `<button type="button" class="cell-folder" data-reassign="${esc(r.ts)}" aria-haspopup="menu" aria-expanded="false" title="Cambiar carpeta">
      <span class="dot" style="--c:${esc(cat ? cat.color : 'transparent')}"></span><span class="lbl">${esc(name)}</span>${ic('chev-down', 's12 chev')}
    </button>`;
}

function render() {
  const list = rows();
  const minutes = list.reduce((a, r) => a + r.minutes, 0);
  $('#log-count').textContent = list.length
    ? `${list.length} ${list.length === 1 ? 'sesión' : 'sesiones'} · ${fmtMin(minutes)}`
    : '';
  $('#log-type-label').textContent = filters.type || 'Todos los tipos';
  $('#log-days-label').textContent = RANGES.find(r => r.value === filters.days).label;
  const box = $('#log-table');
  if (!list.length) {
    box.innerHTML = `<div class="empty">${ic('calendar')}No hay sesiones con estos filtros. Prueba con otra carpeta o un periodo más largo.</div>`;
    return;
  }
  box.innerHTML = `<table class="tbl"><thead><tr><th>Fecha</th><th>Hora</th><th class="num">Duración</th><th>Tipo</th><th>Modo</th><th>Carpeta</th><th class="col-actions"><span class="sr-only">Acciones</span></th></tr></thead><tbody>`
    + list.map(r => `<tr>
        <td>${prettyDate(r.date)}</td><td class="tnum">${esc(r.time)}</td><td class="num">${fmtMin(r.minutes)}</td>
        <td>${esc(r.type)}</td><td><span class="pill ${esc(r.mode)}">${esc(MODE_LABEL[r.mode] || r.mode)}</span></td>
        <td>${folderCell(r)}</td>
        <td class="col-actions"><button type="button" class="icon-btn" data-session-menu="${esc(r.ts)}" aria-haspopup="menu" aria-expanded="false" aria-label="Acciones de la sesión">${ic('more', 's16')}</button></td></tr>`).join('')
    + '</tbody></table>';
}

export function setLogVisible(v) {
  visible = v;
  if (v) render();
}

export function initLog() {
  $('#log-type').addEventListener('click', e => {
    const types = [...new Set(filteredDb().filter(r => r.mode !== 'break').map(r => r.type))].sort((a, b) => a.localeCompare(b));
    const items = [{ value: '', label: 'Todos los tipos' }, { type: 'sep' }, ...types.map(t => ({ value: t, label: t }))];
    if (filters.type) {
      items.push({ type: 'sep' }, { value: '__rename__', label: 'Renombrar este tema…', icon: 'rename', action: true });
    }
    openMenu({
      anchor: e.currentTarget, value: filters.type, search: true,
      items,
      onSelect: v => {
        if (v === '__rename__') { openRenameTypeModal(filters.type); return; }
        filters.type = v;
        render();
      },
    });
  });
  $('#log-days').addEventListener('click', e => openMenu({
    anchor: e.currentTarget, value: filters.days,
    items: RANGES,
    onSelect: v => { filters.days = +v; render(); },
  }));
  $('#log-export').addEventListener('click', e => openMenu({
    anchor: e.currentTarget, align: 'end',
    items: [
      { type: 'head', label: 'Descargar historial' },
      { value: 'csv', label: 'CSV', hint: 'Excel o Sheets', icon: 'table', action: true },
      { value: 'json', label: 'JSON', hint: 'copia completa', icon: 'download', action: true },
    ],
    onSelect: v => { window.location.href = `/api/export/${v}`; toast(`Descargando ${v.toUpperCase()}`); },
  }));
  $('#log-clear').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Borrar todo el historial',
      message: 'Se eliminan <b>todas tus sesiones</b>, también en el servidor. No se puede deshacer.',
      confirmLabel: 'Borrar historial', danger: true, icon: 'delete',
    });
    if (ok) clearHistory();
  });
  $('#log-table').addEventListener('click', e => {
    const reassignBtn = e.target.closest('[data-reassign]');
    if (reassignBtn) {
      const rec = S.db.find(r => r.ts === reassignBtn.dataset.reassign);
      if (rec) openFolderPicker(reassignBtn, rec);
      return;
    }
    const menuBtn = e.target.closest('[data-session-menu]');
    if (menuBtn) {
      const rec = S.db.find(r => r.ts === menuBtn.dataset.sessionMenu);
      if (!rec) return;
      openMenu({
        anchor: menuBtn, align: 'end', minWidth: 220,
        items: [
          { value: 'rename', label: 'Renombrar…', icon: 'rename', action: true },
          { value: 'move', label: 'Mover a carpeta…', icon: 'move', action: true },
          { type: 'sep' },
          { value: 'delete', label: 'Eliminar sesión', icon: 'delete', action: true, danger: true },
        ],
        onSelect: async v => {
          if (v === 'rename') { renameRow(rec); return; }
          if (v === 'move') { openFolderPicker(menuBtn, rec); return; }
          if (v !== 'delete') return;
          const ok = await confirmDialog({
            title: 'Eliminar sesión',
            message: `Se eliminará la sesión de <b>${esc(rec.type)}</b> del ${prettyDate(rec.date)} (${fmtMin(rec.minutes)}). No se puede deshacer.`,
            confirmLabel: 'Eliminar sesión', danger: true, icon: 'delete',
          });
          if (ok) deleteSession(rec.ts);
        },
      });
    }
  });

  const refresh = () => visible && render();
  on('sessions', refresh);
  on('filter', refresh);
  on('categories', refresh);
  // Si el tema que está filtrado se acaba de renombrar, el filtro lo sigue: si no, el
  // filtro se queda con el nombre viejo y la tabla se ve vacía hasta que se cambie a mano.
  on('type-renamed', ({ from, to }) => {
    if (filters.type === from) { filters.type = to; refresh(); }
  });
}
