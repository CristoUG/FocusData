// Utilidades compartidas: DOM, formato, fechas, API, avisos y un bus de eventos.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const ICONS = '/static/img/icons.svg';
export const ic = (name, cls = '') =>
  `<svg class="ic ${cls}" aria-hidden="true"><use href="${ICONS}#i-${name}"/></svg>`;

// Escapa texto de usuario antes de interpolarlo en plantillas innerHTML.
export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Comparación tolerante a mayúsculas y acentos ("logistica" encuentra "Logística").
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

// 45 → "45 min" · 125 → "2 h 05 min" · 120 → "2 h"
export function fmtMin(m) {
  m = Math.round(m || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')} min` : `${h} h`;
}
// Versión corta para espacios estrechos: "96 h" · "45 min"
export const fmtHours = m => (m >= 60 ? `${Math.round(m / 60)} h` : `${Math.round(m || 0)} min`);

// Fecha local YYYY-MM-DD (toISOString() usa UTC y desfasa el día)
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function localISOString(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function daysAgoStr(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return localDateStr(d);
}
export const dayDiff = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

export const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function prettyDate(ds) {
  if (ds === localDateStr()) return 'Hoy';
  if (ds === daysAgoStr(1)) return 'Ayer';
  const d = new Date(ds + 'T00:00:00');
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}

// Llamada a la API. Devuelve siempre {ok, status, data}; nunca lanza.
// Un 401 significa sesión caducada: se vuelve al login.
export async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, headers: {} };
  if (form) opts.body = form;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(path, opts);
    if (res.status === 401) { window.location.href = '/login'; return { ok: false, status: 401, data: {} }; }
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: 'Error de conexión' } };
  }
}

let toastTimer = null;
export function toast(msg, kind = 'ok') {
  const el = $('#toast');
  if (!el) return;
  el.querySelector('span').textContent = msg;
  el.classList.toggle('error', kind === 'error');
  el.querySelector('use').setAttribute('href', `${ICONS}#i-${kind === 'error' ? 'error' : 'check-circle'}`);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// Bus de eventos mínimo: los módulos se suscriben a cambios de estado.
const listeners = {};
export const on = (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); };
export const emit = (evt, payload) => { (listeners[evt] || []).forEach(fn => fn(payload)); };

export const lsGet = (key, fallback = null) => {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
};
export const lsSet = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento: no es crítico */ }
};
