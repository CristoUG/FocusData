// Notificaciones del sistema al terminar un pomodoro o un descanso.
// Se muestran a través de un service worker mínimo (static/sw.js) cuando se puede: es lo
// que permite el botón «Empezar…» y que funcionen en Android. Si no, con new Notification().
import { $, toast, on, emit, lsGet, lsSet, fmtMin } from './util.js';

const PREFS_KEY = 'focusdata.notify';
const SW_URL = '/static/sw.js';
const SW_SCOPE = '/static/';

const N = {
  work: true,      // avisar al terminar un pomodoro
  breaks: true,    // avisar al terminar un descanso
  asked: false,    // ya se pidió el permiso al iniciar el temporizador (solo se hace una vez)
};
let swRegistration = null;
let flashTimer = null;

const supported = () => 'Notification' in window;
const permission = () => (supported() ? Notification.permission : 'unsupported');
// Solo hace falta avisar si no se está mirando la app: si se mira, basta con la alarma.
const away = () => document.visibilityState !== 'visible' || !document.hasFocus();

function loadPrefs() {
  const p = lsGet(PREFS_KEY, null);
  if (!p || typeof p !== 'object') return;
  ['work', 'breaks', 'asked'].forEach(k => { if (typeof p[k] === 'boolean') N[k] = p[k]; });
}
const remember = () => lsSet(PREFS_KEY, { ...N });

// ── Service worker ──
async function registerWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    swRegistration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    return swRegistration;
  } catch {
    return null;
  }
}
// El alcance del worker es /static/, así que nunca controla la página y
// navigator.serviceWorker.ready no llegaría a resolverse: se espera a que esté activo.
async function activeRegistration() {
  const reg = swRegistration || await registerWorker();
  if (!reg) return null;
  if (reg.active) return reg;
  const worker = reg.installing || reg.waiting;
  if (!worker) return null;
  const activated = new Promise(resolve => {
    worker.addEventListener('statechange', () => { if (worker.state === 'activated') resolve(reg); });
  });
  return Promise.race([activated, new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
}

async function show(title, body, { tag = 'focusdata-timer', actions = [], data = {} } = {}) {
  if (permission() !== 'granted') return false;
  const options = { body, tag, renotify: true, icon: '/static/favicon.png', badge: '/static/favicon.png', data };
  const reg = await activeRegistration();
  if (reg) {
    try {
      await reg.showNotification(title, { ...options, actions });
      return true;
    } catch { /* se intenta con el constructor */ }
  }
  try {
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); n.close(); };
    return true;
  } catch {
    return false;
  }
}

// ── Avisos del temporizador ──
function onPhaseEnd(e) {
  const workDone = e.finished === 'work';
  flashTitle(workDone ? 'Pomodoro terminado' : 'Descanso terminado');
  if (!(workDone ? N.work : N.breaks) || !away()) return;
  const activity = e.type && e.type !== 'General' ? e.type : 'concentración';
  if (workDone) {
    show('Pomodoro terminado',
      `${fmtMin(e.minutes)} de ${activity}. Toca un descanso ${e.next === 'long' ? 'largo' : 'corto'} de ${fmtMin(e.nextMinutes)}.`,
      { actions: [{ action: 'start', title: 'Empezar descanso' }], data: { phase: e.next } });
  } else {
    show('Descanso terminado',
      `Es hora de volver: ${fmtMin(e.nextMinutes)} de ${activity}.`,
      { actions: [{ action: 'start', title: 'Empezar pomodoro' }], data: { phase: e.next } });
  }
}

// Con la pestaña oculta el título parpadea: se ve en la barra de pestañas aunque no haya permiso.
function flashTitle(text) {
  if (!document.hidden) return;
  stopFlash();
  let lit = false;
  flashTimer = setInterval(() => {
    lit = !lit;
    document.title = lit ? `● ${text}` : 'FocusData';
  }, 1000);
}
function stopFlash() {
  if (!flashTimer) return;
  clearInterval(flashTimer);
  flashTimer = null;
  document.title = 'FocusData';
}

async function askPermission() {
  if (permission() !== 'default') return;
  N.asked = true;
  remember();
  const result = await Notification.requestPermission();
  renderSettings();
  if (result === 'granted') {
    registerWorker();
    toast('Notificaciones activadas');
  } else if (result === 'denied') {
    toast('Notificaciones bloqueadas. En Configuración te explicamos cómo activarlas.', 'error');
  }
}

async function testNotification() {
  const ok = await show('Así se verán los avisos', 'Te avisaremos al terminar cada pomodoro y cada descanso.', { tag: 'focusdata-test' });
  if (ok) toast('Notificación enviada. Si no aparece, revisa el modo No molestar de tu sistema.');
  else toast('No se pudo mostrar la notificación. Revisa el permiso del navegador.', 'error');
}

// ── Configuración ──
function summary() {
  const p = permission();
  if (p === 'unsupported') return 'No disponibles en este navegador';
  if (p === 'denied') return 'Bloqueadas en el navegador';
  if (p === 'default') return 'Falta dar permiso al navegador';
  if (N.work && N.breaks) return 'Al terminar pomodoros y descansos';
  if (N.work) return 'Solo al terminar pomodoros';
  if (N.breaks) return 'Solo al terminar descansos';
  return 'Desactivadas';
}
function renderSummary() {
  const el = $('[data-notify-summary]');
  if (el) el.textContent = summary();
}

function renderSettings() {
  renderSummary();
  const box = $('#set-notify-body');
  if (!box) return;
  const p = permission();
  const status = {
    granted: 'Permitidas. Te avisamos cuando la app no está en primer plano; si la estás mirando, basta con la alarma.',
    default: 'Todavía no las has permitido en este navegador.',
    denied: 'Bloqueadas. Actívalas desde el icono que hay junto a la dirección de la página y recarga.',
    unsupported: 'Este navegador no admite notificaciones.',
  }[p];
  const toggle = (key, label, hint) => `
    <label class="exp-row">
      <span class="lbl">${label}<small>${hint}</small></span>
      <input type="checkbox" class="switch" data-notify-pref="${key}"${N[key] ? ' checked' : ''}${p === 'unsupported' ? ' disabled' : ''}>
    </label>`;
  box.innerHTML = `
    <div class="exp-row">
      <span class="lbl">Permiso del navegador<small data-notify-status>${status}</small></span>
      ${p === 'default' ? '<button type="button" class="btn sm primary" data-notify-allow>Permitir</button>' : ''}
      ${p === 'granted' ? '<button type="button" class="btn sm" data-notify-test>Probar</button>' : ''}
    </div>
    ${toggle('work', 'Al terminar un pomodoro', 'En Chrome y Edge, con un botón para empezar el descanso sin volver a la app')}
    ${toggle('breaks', 'Al terminar un descanso', 'Para que no se te pase la hora de volver a concentrarte')}`;
}

export function initNotifications() {
  loadPrefs();
  document.addEventListener('click', e => {
    if (e.target.closest('[data-notify-allow]')) askPermission();
    else if (e.target.closest('[data-notify-test]')) testNotification();
  });
  document.addEventListener('change', e => {
    const key = e.target.dataset && e.target.dataset.notifyPref;
    if (!key) return;
    N[key] = e.target.checked;
    remember();
    renderSummary();
  });

  on('phase-end', onPhaseEnd);
  on('timer', s => {
    if (!s.running) return;
    stopFlash();
    // La primera vez que se inicia el temporizador se pide permiso: el clic cuenta como gesto.
    if (!N.asked && (N.work || N.breaks)) askPermission();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    stopFlash();
    renderSettings();   // por si se cambió el permiso desde los ajustes del navegador
  });
  if (navigator.permissions) {
    navigator.permissions.query({ name: 'notifications' }).then(st => { st.onchange = renderSettings; }).catch(() => {});
  }

  // Botón «Empezar…» de la notificación: el worker avisa a la página.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      const msg = e.data;
      if (msg && msg.type === 'focusdata:start') emit('timer-command', { command: 'start', phase: msg.phase });
    });
    navigator.serviceWorker.startMessages();
    if (permission() === 'granted') registerWorker();
  }
  renderSettings();
}
