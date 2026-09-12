// Componentes de interfaz: menú desplegable, modales, plegables y tooltip.
import { $, $$, ic, esc, norm } from './util.js';

// ══ Menú / panel desplegable ══════════════════════════════════════
// Un único panel fijo al cuerpo del documento, reutilizado por todos los
// disparadores: así ningún contenedor con scroll lo recorta.
//
// openMenu({
//   anchor,                     botón que lo abre (recibe aria-expanded)
//   items,                      [{ value, label, depth, color, icon, hint, thumb, danger, disabled,
//                                  search, action }] | { type: 'head', label } | { type: 'sep' }
//   value,                      valor seleccionado (marca con ✓ los items sin action)
//   onSelect(value, item),
//   search,                     true = buscador si hay más de 7 opciones
//   content(panel),             en vez de items: contenido libre (panel de ajustes)
//   align: 'start' | 'end',   placement: 'auto' | 'up' | 'down',   minWidth, className
// })
let panel = null, ctx = null, view = [];

function buildPanel() {
  panel = document.createElement('div');
  panel.className = 'menu';
  panel.hidden = true;
  document.body.appendChild(panel);
  panel.addEventListener('click', e => {
    const b = e.target.closest('.mi');
    if (b && !b.disabled && panel.contains(b)) choose(+b.dataset.i);
  });
  panel.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', e => {
    if (!ctx || panel.contains(e.target) || ctx.anchor.contains(e.target)) return;
    closeMenu(false);
  }, true);
  window.addEventListener('resize', () => ctx && closeMenu(false));
  document.addEventListener('scroll', e => { if (ctx && !panel.contains(e.target)) position(); }, true);
}

function itemHTML(it, i, flat) {
  if (it.type === 'head') return `<div class="mi-head">${esc(it.label)}</div>`;
  if (it.type === 'sep') return '<div class="mi-sep" role="separator"></div>';
  const radio = ctx.value !== undefined && !it.action;
  const checked = radio && String(it.value) === String(ctx.value);
  const depth = flat ? 0 : (it.depth || 0);
  const label = flat && it.search ? it.search : it.label;
  return `<button type="button" class="mi${it.danger ? ' danger' : ''}" data-i="${i}" tabindex="-1"
      role="${radio ? 'menuitemradio' : 'menuitem'}"${radio ? ` aria-checked="${checked}"` : ''}
      ${it.disabled ? 'disabled' : ''} style="--d:${depth}" title="${esc(it.search || it.label)}">
      ${radio ? ic('check', 's16 check') : ''}
      ${it.icon ? ic(it.icon, 's16 muted-ic') : ''}
      ${it.color ? `<span class="dot" style="--c:${esc(it.color)}"></span>` : ''}
      ${it.thumb ? `<span class="mi-thumb" style="background-image:url('${esc(it.thumb)}')"></span>` : ''}
      <span class="lbl">${esc(label)}</span>
      ${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}
    </button>`;
}

function renderItems() {
  const input = panel.querySelector('.menu-search input');
  const q = input ? norm(input.value.trim()) : '';
  const all = ctx.items || [];
  view = q ? all.filter(it => !it.type && norm(it.search || it.label).includes(q)) : all.slice();
  const list = panel.querySelector('.menu-list');
  list.innerHTML = view.length
    ? view.map((it, i) => itemHTML(it, i, !!q)).join('')
    : '<div class="mi-empty">Sin resultados</div>';
}

export function openMenu(opts) {
  if (!panel) buildPanel();
  if (ctx && ctx.anchor === opts.anchor) { closeMenu(); return; }   // segundo clic = cerrar
  if (ctx) closeMenu(false);
  ctx = opts;
  panel.className = 'menu' + (opts.className ? ' ' + opts.className : '');
  panel.style.minWidth = (opts.minWidth || 220) + 'px';
  panel.innerHTML = '';
  if (opts.content) {
    panel.setAttribute('role', 'dialog');
    if (opts.label) panel.setAttribute('aria-label', opts.label);
    opts.content(panel);
  } else {
    panel.setAttribute('role', 'menu');
    const options = (opts.items || []).filter(it => !it.type);
    const withSearch = opts.search && options.length > 7;
    panel.innerHTML = (withSearch
      ? `<div class="menu-search">${ic('search', 's16')}<input type="text" placeholder="Buscar…" aria-label="Buscar" autocomplete="off" spellcheck="false"></div>`
      : '') + '<div class="menu-list"></div>';
    renderItems();
    const input = panel.querySelector('.menu-search input');
    if (input) input.addEventListener('input', () => { renderItems(); position(); });
  }
  panel.hidden = false;
  opts.anchor.setAttribute('aria-expanded', 'true');
  position();
  const first = panel.querySelector('.menu-search input')
    || panel.querySelector('.mi[aria-checked="true"]:not(:disabled)')
    || panel.querySelector('.mi:not(:disabled), button:not(:disabled), input');
  if (first) first.focus({ preventScroll: true });
}

function position() {
  if (!ctx) return;
  const r = ctx.anchor.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const list = panel.querySelector('.menu-list');
  if (list) list.style.maxHeight = '';
  const width = Math.min(panel.offsetWidth, vw - 16);
  let left = ctx.align === 'end' ? r.right - width : r.left;
  left = Math.max(8, Math.min(left, vw - width - 8));
  const below = vh - r.bottom - 12, above = r.top - 12;
  const wantUp = ctx.placement === 'up' || (ctx.placement !== 'down' && below < Math.min(panel.offsetHeight, 320) && above > below);
  if (list) {
    const frame = panel.offsetHeight - list.offsetHeight;
    list.style.maxHeight = Math.max(140, Math.min(380, (wantUp ? above : below) - frame)) + 'px';
  }
  const h = panel.offsetHeight;
  const top = wantUp ? Math.max(8, r.top - h - 8) : Math.min(r.bottom + 8, vh - h - 8);
  panel.classList.toggle('up', wantUp);
  panel.style.left = Math.round(left) + 'px';
  panel.style.top = Math.round(Math.max(8, top)) + 'px';
}

function choose(i) {
  const it = view[i];
  if (!it || it.disabled) return;
  const cb = ctx.onSelect;
  closeMenu();
  if (cb) cb(it.value, it);
}

function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
  if (e.key === 'Tab' && !ctx.content) { closeMenu(); return; }
  const onSearch = e.target.matches('.menu-search input');
  if (e.key === 'Enter' && onSearch) {
    e.preventDefault();
    const idx = view.findIndex(it => !it.type && !it.disabled);
    if (idx >= 0) choose(idx);
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = $$('.mi:not(:disabled)', panel);
  if (!items.length) return;
  if (!onSearch && !e.target.classList.contains('mi')) return;   // no robar las flechas a un slider
  e.preventDefault();
  let idx = items.indexOf(document.activeElement);
  if (e.key === 'Home') idx = 0;
  else if (e.key === 'End') idx = items.length - 1;
  else idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[idx].focus();
}

export function closeMenu(restoreFocus = true) {
  if (!ctx) return;
  const { anchor, onClose } = ctx;
  const hadFocus = panel.contains(document.activeElement);
  ctx = null;
  panel.hidden = true;
  anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus && hadFocus && document.contains(anchor)) anchor.focus({ preventScroll: true });
  if (onClose) onClose();
}
export const isMenuOpen = () => !!ctx;
export const repositionMenu = () => position();

// ══ Modales ═══════════════════════════════════════════════════════
let modal = null;

export function openModal(html, { onClose } = {}) {
  closeModal();
  closeMenu(false);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  const opener = document.activeElement;
  modal = { overlay, onClose, opener };
  document.addEventListener('keydown', escHandler, true);
  const card = overlay.querySelector('.modal');
  const first = card.querySelector('input:not([type=radio]), .btn.primary, button, [tabindex]');
  if (first) first.focus();
  return card;
}
function escHandler(e) {
  if (e.key === 'Escape' && !isMenuOpen()) { e.preventDefault(); closeModal(); }
}
export function closeModal() {
  if (!modal) return;
  const { overlay, onClose, opener } = modal;
  modal = null;
  closeMenu(false);
  overlay.remove();
  document.removeEventListener('keydown', escHandler, true);
  if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  if (onClose) onClose();
}

// Sustituye a prompt(): devuelve el texto o null si se cancela.
export function askText({ title, icon = 'edit', message = '', label, value = '', placeholder = '', confirmLabel = 'Guardar', maxLength = 30 }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    const card = openModal(`
      <h3>${ic(icon)} ${esc(title)}</h3>
      ${message ? `<p class="modal-sub">${message}</p>` : ''}
      <form class="modal-field" novalidate>
        <label class="modal-label" for="ask-input">${esc(label)}</label>
        <input id="ask-input" class="field" type="text" maxlength="${maxLength}" autocomplete="off" spellcheck="false"
          value="${esc(value)}" placeholder="${esc(placeholder)}">
      </form>
      <div class="modal-actions">
        <button type="button" class="btn" data-cancel>Cancelar</button>
        <button type="button" class="btn primary" data-ok>${esc(confirmLabel)}</button>
      </div>`, { onClose: () => finish(null) });
    const input = card.querySelector('#ask-input');
    input.select();
    const submit = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      finish(v);
      closeModal();
    };
    card.querySelector('form').addEventListener('submit', e => { e.preventDefault(); submit(); });
    card.querySelector('[data-ok]').addEventListener('click', submit);
    card.querySelector('[data-cancel]').addEventListener('click', () => closeModal());
  });
}

// Sustituye a confirm(): devuelve true/false.
export function confirmDialog({ title, message, confirmLabel = 'Aceptar', danger = false, icon = 'warning' }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    const card = openModal(`
      <h3>${ic(icon)} ${esc(title)}</h3>
      <p class="modal-sub">${message}</p>
      <div class="modal-actions">
        <button type="button" class="btn" data-cancel>Cancelar</button>
        <button type="button" class="btn ${danger ? 'danger-solid' : 'primary'}" data-ok>${esc(confirmLabel)}</button>
      </div>`, { onClose: () => finish(false) });
    card.querySelector('[data-ok]').addEventListener('click', () => { finish(true); closeModal(); });
    card.querySelector('[data-cancel]').addEventListener('click', () => closeModal());
    card.querySelector('[data-ok]').focus();
  });
}

// ══ Plegables ([data-toggle="id"] abre/cierra #id con .open) ═══════
export function setCollapse(id, open) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('open', open);
  if (el.firstElementChild) el.firstElementChild.inert = !open;
  $$(`[data-toggle="${id}"]`).forEach(b => b.setAttribute('aria-expanded', String(open)));
}
export function initCollapsibles() {
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    const el = document.getElementById(t.dataset.toggle);
    if (el) setCollapse(t.dataset.toggle, !el.classList.contains('open'));
  });
}

// ══ Tooltip de gráficos ([data-tip="valor|etiqueta"]) ═══════════════
let tipEl = null, tipOn = null;
function showTip(m, x, y) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.hidden = true;
    tipEl.innerHTML = '<b></b><span></span>';
    document.body.appendChild(tipEl);
  }
  const [v, l] = m.dataset.tip.split('|');
  tipEl.querySelector('b').textContent = v;
  tipEl.querySelector('span').textContent = l || '';
  tipEl.hidden = false;
  if (tipOn && tipOn !== m) tipOn.classList.remove('tip-on');
  tipOn = m;
  m.classList.add('tip-on');
  placeTip(x, y);
}
function placeTip(x, y) {
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8));
  let top = y - h - 12;
  if (top < 8) top = y + 18;
  tipEl.style.left = left + 'px';
  tipEl.style.top = top + 'px';
}
function hideTip() {
  if (!tipOn) return;
  tipEl.hidden = true;
  tipOn.classList.remove('tip-on');
  tipOn = null;
}
export function initTooltips() {
  document.addEventListener('pointerover', e => {
    const m = e.target.closest && e.target.closest('[data-tip]');
    if (m) showTip(m, e.clientX, e.clientY); else hideTip();
  });
  document.addEventListener('pointermove', e => {
    if (tipOn && e.target.closest && e.target.closest('[data-tip]')) placeTip(e.clientX, e.clientY);
  });
  document.addEventListener('focusin', e => {
    const m = e.target.closest && e.target.closest('[data-tip]');
    if (m) { const r = m.getBoundingClientRect(); showTip(m, r.left + r.width / 2, r.top); } else hideTip();
  });
  document.addEventListener('scroll', hideTip, true);
}
