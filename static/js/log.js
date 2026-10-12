// Registro: historial filtrable, reasignación de carpeta, exportación y borrado.
import { $, ic, esc, toast, on, fmtMin, daysAgoStr, prettyDate } from './util.js';
import { S, filteredDb, categoryById, reassignSession, updateSession, deleteSession, clearHistory } from './store.js';
import { openMenu, confirmDialog, askText } from './ui.js';
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

function rows() {
  let recs = filteredDb().filter(r => r.mode !== 'break');
  if (filters.type) recs = recs.filter(r => r.type === filters.type);
  if (filters.days > 0) {
    const from = daysAgoStr(filters.days - 1);
    recs = recs.filter(r => r.date >= from);
  }
  return recs.slice().reverse();
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
  box.innerHTML = `<table class="tbl"><thead><tr><th>Fecha</th><th>Hora</th><th class="num">Duración</th><th>Tipo</th><th>Modo</th><th>Carpeta</th><th><span class="sr-only">Acciones</span></th></tr></thead><tbody>`
    + list.map(r => `<tr>
        <td>${prettyDate(r.date)}</td><td class="tnum">${esc(r.time)}</td><td class="num">${fmtMin(r.minutes)}</td>
        <td>${esc(r.type)}</td><td><span class="pill ${esc(r.mode)}">${esc(MODE_LABEL[r.mode] || r.mode)}</span></td>
        <td>${folderCell(r)}</td><td><button type="button" class="icon-btn" data-session-actions="${esc(r.ts)}" aria-label="Opciones de la sesión ${esc(r.type)}" aria-haspopup="menu" aria-expanded="false" title="${r.remote_id == null ? 'Disponible cuando se sincronice la sesión' : 'Opciones de la sesión'}"${r.remote_id == null ? ' disabled' : ''}>${ic('more')}</button></td></tr>`).join('')
    + '</tbody></table>';
}

function moveSession(rec, anchor) {
  openMenu({
    anchor, value: rec.category_id, search: true, minWidth: 260,
    items: [{ type: 'head', label: 'Mover la sesión a' }, ...folderItems({ archived: 'hide', keepId: rec.category_id })],
    onSelect: v => { if (+v !== +rec.category_id) reassignSession(rec.ts, v); },
  });
}

function sessionMenu(rec, anchor) {
  openMenu({
    anchor, align: 'end', label: 'Opciones de la sesión',
    items: [
      { value: 'rename', label: 'Renombrar sesión', icon: 'rename', action: true },
      { value: 'move', label: 'Cambiar de carpeta', icon: 'folder', action: true },
      { type: 'sep' },
      { value: 'delete', label: 'Eliminar sesión', icon: 'delete', danger: true, action: true },
    ],
    onSelect: async action => {
      if (action === 'move') { moveSession(rec, anchor); return; }
      if (action === 'rename') {
        const name = await askText({ title: 'Renombrar sesión', label: 'Nombre de la sesión', value: rec.type,
          maxLength: 40, message: 'Solo se cambia el nombre de esta sesión.' });
        if (name && name !== rec.type) await updateSession(rec.ts, { type: name });
      } else if (action === 'delete') {
        const ok = await confirmDialog({ title: 'Eliminar sesión', icon: 'delete', danger: true,
          confirmLabel: 'Eliminar sesión',
          message: `Se eliminará <b>${esc(rec.type)}</b> (${fmtMin(rec.minutes)}, ${prettyDate(rec.date)}) del historial y las estadísticas. No se puede deshacer.` });
        if (ok) await deleteSession(rec.ts);
      }
    },
  });
}

export function setLogVisible(v) {
  visible = v;
  if (v) render();
}

export function initLog() {
  $('#log-type').addEventListener('click', e => {
    const types = [...new Set(filteredDb().filter(r => r.mode !== 'break').map(r => r.type))].sort((a, b) => a.localeCompare(b));
    openMenu({
      anchor: e.currentTarget, value: filters.type, search: true,
      items: [{ value: '', label: 'Todos los tipos' }, { type: 'sep' }, ...types.map(t => ({ value: t, label: t }))],
      onSelect: v => { filters.type = v; render(); },
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
    const btn = e.target.closest('[data-reassign], [data-session-actions]');
    if (!btn) return;
    const rec = S.db.find(r => r.ts === (btn.dataset.reassign || btn.dataset.sessionActions));
    if (!rec || rec.remote_id == null) return;
    if (btn.hasAttribute('data-session-actions')) sessionMenu(rec, btn);
    else moveSession(rec, btn);
  });

  const refresh = () => visible && render();
  on('sessions', refresh);
  on('filter', refresh);
  on('categories', refresh);
}
