// Configuración: tema, color de acento, tiempos del Pomodoro y datos.
import { $, $$, ic, esc, toast, ICONS } from './util.js';
import { S, savePrefs, clearHistory } from './store.js';
import { openMenu, confirmDialog } from './ui.js';
import { pomoRowsHTML, syncCfgControls } from './timer.js';
import { cacheAppearance } from './scenes.js';

const ACCENTS = [
  ['#3b82f6', 'Azul'], ['#6366f1', 'Índigo'], ['#0ea5e9', 'Celeste'], ['#10b981', 'Verde'],
  ['#f59e0b', 'Ámbar'], ['#ec4899', 'Rosa'], ['#ef4444', 'Rojo'],
];

// #abc → #aabbcc (el <input type="color"> solo acepta la forma larga)
const longHex = c => (/^#[0-9a-f]{3}$/i.test(c) ? '#' + c.slice(1).split('').map(x => x + x).join('') : c);

export function applyTheme(theme) {
  theme = theme === 'light' ? 'light' : 'dark';
  S.prefs.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  const light = theme === 'light';
  const icon = $('#btn-theme-icon');
  if (icon) icon.setAttribute('href', `${ICONS}#i-${light ? 'moon' : 'sun'}`);
  const btn = $('#btn-theme');
  if (btn) { const t = light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'; btn.setAttribute('aria-label', t); btn.title = t; }
  const label = $('#set-theme-label');
  if (label) label.textContent = light ? 'Claro' : 'Oscuro';
}
export function setTheme(theme) {
  applyTheme(theme);
  cacheAppearance();
  savePrefs({ theme: S.prefs.theme });
}

export function applyAccent(color) {
  S.prefs.accent = color;
  document.documentElement.style.setProperty('--accent', color);
  $$('[data-accent]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accent.toLowerCase() === color.toLowerCase())));
  const input = $('#accent-custom');
  if (input) input.value = longHex(color);
}
let accentTimer = null;
function setAccent(color, delay = 0) {
  applyAccent(color);
  cacheAppearance();
  clearTimeout(accentTimer);
  accentTimer = setTimeout(() => savePrefs({ accent: color }), delay);
}

export function initSettings() {
  $('#btn-theme').addEventListener('click', () => setTheme(S.prefs.theme === 'light' ? 'dark' : 'light'));
  $('#set-theme').addEventListener('click', e => openMenu({
    anchor: e.currentTarget, value: S.prefs.theme, align: 'end',
    items: [{ value: 'light', label: 'Claro', icon: 'sun' }, { value: 'dark', label: 'Oscuro', icon: 'moon' }],
    onSelect: v => setTheme(v),
  }));

  $('#accent-swatches').innerHTML = ACCENTS.map(([c, name]) =>
    `<button type="button" class="sw" style="--c:${c}" data-accent="${c}" aria-pressed="false" aria-label="${esc(name)}" title="${esc(name)}"></button>`).join('')
    + `<label class="sw-custom">${ic('color', 's16')} Personalizado <input type="color" id="accent-custom" value="#3b82f6" class="color-in" aria-label="Color de acento personalizado"></label>`;
  $('#accent-swatches').addEventListener('click', e => {
    const sw = e.target.closest('[data-accent]');
    if (sw) setAccent(sw.dataset.accent);
  });
  $('#accent-custom').addEventListener('input', e => setAccent(e.target.value, 600));
  applyAccent(S.prefs.accent);

  $('#set-pomo').innerHTML = pomoRowsHTML('settings')
    + '<div class="pp-foot"><span></span><button type="button" class="btn sm" data-cfg-reset>Restablecer tiempos</button></div>';
  syncCfgControls();

  $('#set-export-csv').addEventListener('click', () => { window.location.href = '/api/export/csv'; toast('Descargando CSV'); });
  $('#set-export-json').addEventListener('click', () => { window.location.href = '/api/export/json'; toast('Descargando JSON'); });
  $('#set-clear').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Borrar todo el historial',
      message: 'Se eliminan <b>todas tus sesiones</b>, también en el servidor. No se puede deshacer.',
      confirmLabel: 'Borrar historial', danger: true, icon: 'delete',
    });
    if (ok) clearHistory();
  });
}
