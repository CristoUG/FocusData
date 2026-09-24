// Registro: historial filtrable, reasignación de carpeta, exportación y borrado.
import { $, ic, esc, toast, on, fmtMin, prettyDate } from './util.js';
import { S, filteredDb, periodStudyRecs, categoryById, reassignSession, clearHistory } from './store.js';
import { openMenu, confirmDialog } from './ui.js';
import { folderItems } from './folders.js';

let visible = false;
const filters = { type: '' };
const MODE_LABEL = { pomodoro: 'Pomodoro', cronometro: 'Cronómetro', manual: 'Manual' };
// El periodo global ('Todo el historial') no acota por fecha: sin tope se podrían
// pintar miles de filas de golpe. Se revela de a tramos con "Mostrar más".
const PAGE_SIZE = 200;
let limit = PAGE_SIZE;

function rows() {
  let recs = periodStudyRecs();
  if (filters.type) recs = recs.filter(r => r.type === filters.type);
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
  const all = rows();
  // El tope de 200 solo aplica con "Todo el historial": los demás periodos ya
  // acotan por fecha y no suelen acumular tantas filas de golpe.
  const capped = S.period === 'all' && all.length > limit;
  const list = capped ? all.slice(0, limit) : all;
  const minutes = list.reduce((a, r) => a + r.minutes, 0);
  $('#log-count').textContent = list.length
    ? `${list.length}${capped ? ` de ${all.length}` : ''} ${list.length === 1 ? 'sesión' : 'sesiones'} · ${fmtMin(minutes)}`
    : '';
  $('#log-type-label').textContent = filters.type || 'Todos los tipos';
  $('#log-more').hidden = !capped;
  const box = $('#log-table');
  if (!list.length) {
    box.innerHTML = `<div class="empty">${ic('calendar')}No hay sesiones con estos filtros. Prueba con otra carpeta o un periodo más largo.</div>`;
    return;
  }
  box.innerHTML = `<table class="tbl"><thead><tr><th>Fecha</th><th>Hora</th><th class="num">Duración</th><th>Tipo</th><th>Modo</th><th>Carpeta</th></tr></thead><tbody>`
    + list.map(r => `<tr>
        <td>${prettyDate(r.date)}</td><td class="tnum">${esc(r.time)}</td><td class="num">${fmtMin(r.minutes)}</td>
        <td>${esc(r.type)}</td><td><span class="pill ${esc(r.mode)}">${esc(MODE_LABEL[r.mode] || r.mode)}</span></td>
        <td>${folderCell(r)}</td></tr>`).join('')
    + '</tbody></table>';
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
      onSelect: v => { filters.type = v; limit = PAGE_SIZE; render(); },
    });
  });
  $('#log-more').addEventListener('click', () => { limit += PAGE_SIZE; render(); });
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
    const btn = e.target.closest('[data-reassign]');
    if (!btn) return;
    const rec = S.db.find(r => r.ts === btn.dataset.reassign);
    if (!rec) return;
    openMenu({
      anchor: btn, value: rec.category_id, search: true, minWidth: 260,
      items: [{ type: 'head', label: 'Mover la sesión a' }, ...folderItems({ archived: 'hide', keepId: rec.category_id })],
      onSelect: v => { if (+v !== +rec.category_id) reassignSession(rec.ts, v); },
    });
  });

  const refresh = () => visible && render();
  on('sessions', refresh);
  // 'filter' cubre tanto el filtro de carpeta como el de periodo (mismo evento):
  // cualquiera de los dos cambia qué filas hay, así que se vuelve a la primera página.
  on('filter', () => { limit = PAGE_SIZE; refresh(); });
  on('categories', refresh);
}
