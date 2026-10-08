// Arranque de FocusData: navegación, barra lateral, menús globales y carga de datos.
import { $, $$, ic, esc, on, emit, api, lsGet, lsSet, localDateStr, daysAgoStr, fmtMin } from './util.js';
import { S, initStorage, loadCategories, syncSessions, loadCfg, setFilter, categoryById, savePrefs } from './store.js';
import { openMenu, openModal, closeModal, initCollapsibles, initTooltips } from './ui.js';
import { initTimer, setGreeting, focusTypeInput } from './timer.js';
import { initFolders, folderItems } from './folders.js';
import { initStats, setStatsVisible } from './stats.js';
import { initLog, setLogVisible } from './log.js';
import { initScenes, applyScene, loadBackgrounds, readAppearance, cacheAppearance, DEFAULT_SCENE } from './scenes.js';
import { initSettings, applyTheme, applyAccent, setTheme } from './settings.js';
import { initMusic } from './music.js';
import { initNotifications } from './notifications.js';

const VIEWS = { timer: 'Timer', stats: 'Estadísticas', log: 'Registro', folders: 'Carpetas', settings: 'Configuración', help: 'Ayuda' };
const SIDE_KEY = 'focusdata.side.collapsed';
const narrow = () => window.matchMedia('(max-width: 900px)').matches;

function setSide(collapsed, persist = true) {
  document.documentElement.classList.toggle('side-collapsed', collapsed);
  if (persist && !narrow()) lsSet(SIDE_KEY, collapsed);
}

function go(view) {
  if (!VIEWS[view]) view = 'timer';
  $$('.view').forEach(s => { s.hidden = s.dataset.view !== view; });
  $$('.nav-item[data-go]').forEach(b => {
    if (b.dataset.go === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#crumb').textContent = view === 'timer' ? '' : VIEWS[view];
  $('#scroll').scrollTop = 0;
  setStatsVisible(view === 'stats');
  setLogVisible(view === 'log');
  if (narrow()) setSide(true, false);
  const hash = view === 'timer' ? '' : `#${view}`;
  if (location.hash !== hash) history.replaceState(null, '', location.pathname + hash);
}

function renderFilterPill() {
  const cat = categoryById(S.filterCategoryId);
  $('#btn-filter-label').textContent = cat ? cat.name : 'Todas las carpetas';
  $('#btn-filter').title = cat ? `Filtro: ${cat.path}` : 'Filtra lo que ves en Estadísticas y Registro';
}

function renderRecents() {
  const box = $('#recents');
  const today = localDateStr(), yesterday = daysAgoStr(1);
  const recs = S.db.filter(r => r.mode !== 'break' && (r.date === today || r.date === yesterday)).slice(-8).reverse();
  if (!recs.length) {
    box.innerHTML = '<div class="side-empty">Tus sesiones de hoy y ayer aparecerán aquí</div>';
    return;
  }
  let html = '', lastDate = null;
  recs.forEach(r => {
    if (r.date !== lastDate) { html += `<div class="rec-g">${r.date === today ? 'Hoy' : 'Ayer'}</div>`; lastDate = r.date; }
    const cat = categoryById(r.category_id);
    html += `<button type="button" class="rec" data-go="log" title="${esc(cat ? cat.path : '')}">
      <span class="dot" style="--c:${esc(cat ? cat.color : 'var(--muted)')}"></span>
      <span class="t">${esc(r.type)}</span><span class="m">${fmtMin(r.minutes)}</span></button>`;
  });
  box.innerHTML = html;
}

function openAccountMenu(anchor) {
  openMenu({
    anchor, value: S.prefs.theme, placement: 'up', minWidth: Math.max(236, anchor.offsetWidth),
    items: [
      { value: 'go:settings', label: 'Configuración', icon: 'settings', action: true },
      { value: 'go:folders', label: 'Carpetas', icon: 'folder', action: true },
      { value: 'go:help', label: 'Ayuda', icon: 'help', action: true },
      { type: 'sep' },
      { type: 'head', label: 'Tema' },
      { value: 'light', label: 'Claro', icon: 'sun' },
      { value: 'dark', label: 'Oscuro', icon: 'moon' },
      { type: 'sep' },
      { value: 'logout', label: 'Cerrar sesión', icon: 'signout', action: true, danger: true },
    ],
    onSelect: v => {
      if (v.startsWith('go:')) go(v.slice(3));
      else if (v === 'logout') window.location.href = '/logout';
      else setTheme(v);
    },
  });
}

// Aviso de novedades: una vez por navegador tras el rediseño.
const NOTICE_VERSION = 'rediseno-copilot-v1';
function showNoticeIfNeeded() {
  if (localStorage.getItem('fd_update_seen') === NOTICE_VERSION) return;
  const card = openModal(`
    <h3>${ic('sparkle')} FocusData estrena diseño</h3>
    <p class="modal-sub">Todo lo que ya usabas sigue ahí, más ordenado y a mano.</p>
    <ul class="news">
      <li>${ic('panel-open')}<span>Barra lateral plegable con tus <b>carpetas</b> y <b>sesiones recientes</b>, y menús desplegables en toda la app.</span></li>
      <li>${ic('image')}<span><b>Fondos</b>: elige <b>Carretera</b> o <b>Cerezos</b>, o sube tus propias imágenes. Se guardan en tu cuenta.</span></li>
      <li>${ic('settings')}<span>Escribe tu actividad en una barra compacta y ajusta los tiempos del Pomodoro desde la <b>rueda</b>.</span></li>
      <li>${ic('stats')}<span><b>Estadísticas</b> renovadas: calendario, distribución por tema y densidad por hora, con el detalle al pasar el mouse.</span></li>
    </ul>
    <div class="modal-actions"><button type="button" class="btn primary" data-ok>Entendido</button></div>`);
  card.querySelector('[data-ok]').addEventListener('click', () => {
    localStorage.setItem('fd_update_seen', NOTICE_VERSION);
    closeModal();
  });
}

function initShell() {
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-go]');
    if (target) go(target.dataset.go);
  });
  $('#btn-new').addEventListener('click', () => { go('timer'); focusTypeInput(); });
  $('#btn-side-close').addEventListener('click', () => setSide(true));
  $('#btn-side-open').addEventListener('click', () => setSide(false));
  $('#side-backdrop').addEventListener('click', () => setSide(true, false));
  $('#btn-me').addEventListener('click', e => openAccountMenu(e.currentTarget));
  $('#btn-filter').addEventListener('click', e => openMenu({
    anchor: e.currentTarget, value: S.filterCategoryId, align: 'end', search: true, minWidth: 260,
    items: [
      { type: 'head', label: 'Mostrar en Estadísticas y Registro' },
      ...folderItems({ archived: 'show', lead: { value: '', label: 'Todas las carpetas', icon: 'stack' } }),
    ],
    onSelect: v => setFilter(v),
  }));
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  window.matchMedia('(max-width: 900px)').addEventListener('change', ev => setSide(ev.matches ? true : !!lsGet(SIDE_KEY, false), false));

  on('go', go);
  on('filter', renderFilterPill);
  on('categories', () => { renderFilterPill(); renderRecents(); });
  on('sessions', renderRecents);
}

async function boot() {
  initCollapsibles();
  initTooltips();
  loadCfg();

  // Apariencia en caché primero: evita el parpadeo mientras responde /api/me.
  const cached = readAppearance();
  applyTheme(cached && cached.theme ? cached.theme : 'dark');
  applyAccent(cached && cached.accent ? cached.accent : '#3b82f6');
  applyScene(cached && cached.scene ? cached.scene : DEFAULT_SCENE, cached);
  setSide(narrow() ? true : !!lsGet(SIDE_KEY, false), false);

  initTimer();
  initFolders();
  initStats();
  initLog();
  initScenes();
  initSettings();
  initMusic();
  initNotifications();
  initShell();
  go(location.hash.slice(1) || 'timer');

  const { ok, data } = await api('/api/me');
  if (!ok || !data.username) return;
  S.user = { id: data.id, username: data.username };
  initStorage(data.id);
  setGreeting(data.username);
  $('#me-name').textContent = data.username;
  $('#me-avatar').textContent = data.username.charAt(0).toUpperCase();
  $('#set-user').textContent = data.username;

  // 'ocean' y 'forest' eran temas antes de existir las escenas: se reinterpretan.
  let theme = data.theme || 'dark';
  let scene = data.scene || DEFAULT_SCENE;
  const legacyTheme = theme === 'ocean' || theme === 'forest';
  if (legacyTheme) { scene = theme; theme = 'dark'; }
  applyTheme(theme);
  applyAccent(data.accent || '#3b82f6');
  S.activeCategoryId = data.active_category_id != null ? +data.active_category_id : null;
  emit('sessions');

  await Promise.all([loadCategories(), loadBackgrounds()]);
  applyScene(scene);
  cacheAppearance();
  if (legacyTheme) savePrefs({ theme, scene: S.prefs.scene });

  syncSessions();
  showNoticeIfNeeded();
}

boot();
