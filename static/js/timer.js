// Temporizador: Pomodoro (cuenta atrás) y Cronómetro (cuenta hacia adelante).
import { $, $$, ic, esc, toast, on, emit, fmtMin, localDateStr, daysAgoStr, ICONS } from './util.js';
import { S, logSession, categoryById, studyRecs, CFG_LIMITS, CFG_DEFAULT, setCfg, setActiveCategory } from './store.js';
import { openMenu, closeMenu, openModal, closeModal, confirmDialog } from './ui.js';
import { computeStreaks } from './metrics.js';
import { folderItems } from './folders.js';
import { getAudioContext } from './audio.js';

const CRONO_CYCLE = 60 * 60;   // el anillo da una vuelta completa por hora

const T = {
  mode: 'pomodoro',            // 'pomodoro' | 'cronometro'
  running: false, paused: false,
  phase: 'work',               // 'work' | 'short' | 'long'
  session: 1, cycleCount: 0,
  remaining: 25 * 60,
  phaseTotal: 25 * 60,         // duración con la que arrancó la fase actual (segundos)
  endTime: null,               // marca de tiempo en la que la fase llega a 0
  elapsed: 0, startedAt: null, // solo cronómetro
  type: 'General',
  iv: null,
  due: null,                   // setTimeout del final de la fase (ver start)
  // Descanso intermedio del cronómetro: { startedAt, plannedSec | null }. Mientras dura,
  // el cronómetro queda congelado en pausa y vuelve donde iba al terminar.
  midBreak: null,
};

const MID_BREAK_OPTIONS = [5, 10, 15];   // minutos; además, «Sin límite»
const midBreakElapsed = () => Math.max(0, Math.round((Date.now() - T.midBreak.startedAt) / 1000));

const pad = n => String(n).padStart(2, '0');
const phaseMinutes = () => (T.phase === 'work' ? S.cfg.work : T.phase === 'short' ? S.cfg.short : S.cfg.long);
const phaseDuration = () => phaseMinutes() * 60;
const phaseLabel = () => (T.phase === 'work' ? 'Tiempo de trabajo' : T.phase === 'short' ? 'Descanso corto' : 'Descanso largo');

const clockText = t => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

export function renderClock() {
  let text, pct;
  if (T.midBreak) {
    // Con duración fija cuenta atrás; con «Sin límite», hacia adelante (una vuelta = 1 hora).
    const t = midBreakElapsed(), planned = T.midBreak.plannedSec;
    text = planned ? clockText(Math.max(0, planned - t)) : clockText(t);
    pct = planned ? Math.min(1, t / planned) * 100 : (t % CRONO_CYCLE) / CRONO_CYCLE * 100;
    $('#t-phase').textContent = 'Descanso intermedio';
    $('#t-meta').textContent = `Cronómetro en espera en ${clockText(T.elapsed)}`;
    $('#ring').classList.add('is-break');
  } else if (T.mode === 'cronometro') {
    const t = T.elapsed;
    text = clockText(t);
    pct = (t % CRONO_CYCLE) / CRONO_CYCLE * 100;
    $('#t-phase').textContent = 'Cronómetro';
    $('#t-meta').textContent = T.running ? 'Contando…' : T.paused ? 'En pausa' : 'Una vuelta del anillo = 1 hora';
    $('#ring').classList.remove('is-break');
  } else {
    const rem = Math.max(0, T.remaining);
    text = `${pad(Math.floor(rem / 60))}:${pad(rem % 60)}`;
    // El total es el de la fase EN CURSO: si cambian los tiempos a mitad de fase,
    // el anillo sigue midiendo lo que se arrancó.
    const total = T.phaseTotal || phaseDuration();
    const frac = Math.min(1, Math.max(0, rem / total));
    pct = (1 - frac) * 100;
    $('#t-phase').textContent = phaseLabel();
    const cycle = Math.min(S.cfg.cycles, (T.cycleCount % S.cfg.cycles) + 1);
    $('#t-meta').textContent = `Sesión ${T.session} · Ciclo ${cycle} de ${S.cfg.cycles}`;
    $('#ring').classList.toggle('is-break', T.phase !== 'work');
  }
  $('#t-time').textContent = text;
  const fg = $('#ring-fg');
  fg.style.strokeDashoffset = String(100 - pct);
  // Con el extremo redondeado, un anillo al 0% dejaría un punto suelto arriba.
  fg.style.opacity = pct > 0.05 ? '1' : '0';
  document.title = T.running || T.midBreak ? `${text} — FocusData` : 'FocusData';
}

function updateToggle() {
  const label = T.midBreak ? 'Volver al trabajo' : T.running ? 'Pausar' : T.paused ? 'Reanudar' : 'Iniciar';
  const btn = $('#btn-toggle');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  $('#btn-toggle-icon').setAttribute('href', `${ICONS}#i-${T.running ? 'pause' : 'play'}`);
  $('#btn-save').hidden = T.mode !== 'cronometro';
  $('#btn-midbreak').hidden = T.mode !== 'cronometro' || !!T.midBreak || !(T.running || T.paused);
  $('#btn-mode-label').textContent = T.mode === 'cronometro' ? 'Cronómetro' : 'Pomodoro';
  // Todo cambio de estado pasa por aquí: la música se sincroniza con este evento.
  // El descanso intermedio cuenta como reloj en marcha, pero en fase de descanso.
  emit('timer', { running: T.running || !!T.midBreak, mode: T.mode, phase: T.midBreak ? 'mid-break' : T.phase });
}

function tick() {
  if (T.midBreak) {
    renderClock();
    const planned = T.midBreak.plannedSec;
    if (planned && midBreakElapsed() >= planned) endMidBreak({ byTime: true });
    return;
  }
  if (!T.running) return;
  if (T.mode === 'cronometro') {
    T.elapsed = Math.max(0, Math.round((Date.now() - T.startedAt) / 1000));
    renderClock();
    return;
  }
  // Se calcula desde el reloj real: inmune al estrangulamiento de pestañas en segundo plano.
  T.remaining = Math.max(0, Math.round((T.endTime - Date.now()) / 1000));
  renderClock();
  if (T.remaining <= 0) phaseComplete();
}

function start() {
  if (T.running || T.midBreak) return;
  // Pulsar «Iniciar» es un gesto del usuario: aprovecharlo para dejar el contexto de
  // audio listo, así la alarma del final de la fase suena aunque llegue sola.
  getAudioContext();
  if (T.mode === 'cronometro') {
    T.startedAt = Date.now() - T.elapsed * 1000;
  } else {
    if (!T.paused) T.phaseTotal = T.remaining;
    T.endTime = Date.now() + T.remaining * 1000;
  }
  T.paused = false;
  T.running = true;
  clearInterval(T.iv);
  T.iv = setInterval(tick, 250);
  // Chrome puede espaciar hasta un minuto los setInterval de una pestaña oculta; un setTimeout
  // creado aquí (desde el clic) no sufre ese recorte, así que la fase termina y avisa a su hora.
  clearTimeout(T.due);
  if (T.mode === 'pomodoro') T.due = setTimeout(tick, T.remaining * 1000 + 50);
  updateToggle();
  renderClock();
}

function pause() {
  clearInterval(T.iv);
  clearTimeout(T.due);
  if (T.mode === 'cronometro') T.elapsed = Math.max(0, Math.round((Date.now() - T.startedAt) / 1000));
  else T.remaining = Math.max(0, Math.round((T.endTime - Date.now()) / 1000));
  T.running = false;
  T.paused = true;
  updateToggle();
  renderClock();
}

export function resetTimer() {
  // Lo ya descansado se registra aunque se reinicie o se cambie de modo a mitad del descanso.
  if (T.midBreak) endMidBreak({ resume: false });
  clearInterval(T.iv);
  clearTimeout(T.due);
  Object.assign(T, {
    running: false, paused: false, phase: 'work', session: 1, cycleCount: 0,
    remaining: S.cfg.work * 60, phaseTotal: S.cfg.work * 60, endTime: null, elapsed: 0, startedAt: null,
    midBreak: null,
  });
  updateToggle();
  renderClock();
}

// ── Descanso intermedio (solo cronómetro): el usuario elige cuándo y cuánto ──
function startMidBreak(plannedSec) {
  if (T.mode !== 'cronometro' || T.midBreak || !(T.running || T.paused)) return;
  if (T.running) pause();   // congela el cronómetro donde va
  T.midBreak = { startedAt: Date.now(), plannedSec };
  clearInterval(T.iv);
  T.iv = setInterval(tick, 250);
  // Igual que en start(): un setTimeout creado desde el clic avisa a su hora aunque la pestaña esté oculta.
  clearTimeout(T.due);
  if (plannedSec) T.due = setTimeout(tick, plannedSec * 1000 + 50);
  updateToggle();
  renderClock();
}

// byTime: terminó solo (suena la alarma y el cronómetro espera a que vuelvas).
// resume: lo terminó el usuario con «Volver al trabajo» y el cronómetro sigue al instante.
function endMidBreak({ byTime = false, resume = true } = {}) {
  if (!T.midBreak) return;
  clearInterval(T.iv);
  clearTimeout(T.due);
  const { plannedSec } = T.midBreak;
  const secs = byTime ? plannedSec : midBreakElapsed();
  T.midBreak = null;
  // Se registra como descanso: cuenta para el ratio de descanso activo.
  const minutes = Math.min(600, Math.round(secs / 60));
  if (minutes >= 1) logSession(minutes, 'Descanso', 'break');
  if (byTime) {
    playAlarm();
    toast('Descanso terminado. Reanuda el cronómetro cuando vuelvas.');
    emit('phase-end', { finished: 'mid-break', minutes, type: T.type });
  } else if (resume) {
    toast(minutes >= 1 ? `Descanso de ${fmtMin(minutes)} registrado. ¡A concentrarse!` : 'Descanso de menos de 1 minuto: no se registra');
    start();
    return;
  }
  updateToggle();
  renderClock();
}

function openMidBreakMenu(anchor) {
  openMenu({
    anchor, minWidth: 220,
    items: [
      { type: 'head', label: 'Descanso intermedio' },
      ...MID_BREAK_OPTIONS.map(m => ({ value: String(m), label: `${m} min` })),
      { value: 'free', label: 'Sin límite', hint: 'tú decides cuándo volver' },
    ],
    onSelect: v => startMidBreak(v === 'free' ? null : +v * 60),
  });
}

function phaseComplete() {
  clearInterval(T.iv);
  clearTimeout(T.due);
  playAlarm();
  // Se registra lo que la fase REALMENTE duró, no lo que digan ahora los ajustes.
  const minutes = Math.max(1, Math.round((T.phaseTotal || phaseDuration()) / 60));
  const finished = T.phase;
  if (T.phase === 'work') {
    logSession(minutes, T.type, 'pomodoro');
    T.cycleCount++;
    T.phase = T.cycleCount % S.cfg.cycles === 0 ? 'long' : 'short';
    toast(T.phase === 'long' ? 'Sesión guardada. Toca un descanso largo.' : 'Sesión guardada. Toca un descanso corto.');
  } else {
    // El descanso también se registra: lo necesita el ratio de descanso activo.
    logSession(minutes, 'Descanso', 'break');
    T.session++;
    T.phase = 'work';
    toast('Descanso terminado. ¡A concentrarse!');
  }
  T.phaseTotal = phaseDuration();
  T.remaining = T.phaseTotal;
  T.running = false;
  T.paused = false;
  updateToggle();
  renderClock();
  // Las notificaciones del sistema viven en notifications.js.
  emit('phase-end', { finished, minutes, type: T.type, next: T.phase, nextMinutes: phaseMinutes() });
}

function saveCrono() {
  if (T.midBreak) endMidBreak({ resume: false });
  if (T.running) pause();
  const mins = Math.round(T.elapsed / 60);
  if (mins < 1) { toast('Muy corto para registrar: el mínimo es 1 minuto', 'error'); return; }
  const saved = Math.min(mins, 600);
  if (saved < mins) toast('Sesión muy larga: se registran 600 min (10 h)');
  logSession(saved, T.type, 'cronometro');
  toast(`Sesión de ${fmtMin(saved)} registrada`);
  resetTimer();
}

async function setMode(mode) {
  if (mode === T.mode) return;
  if (T.running || T.paused) {
    const ok = await confirmDialog({
      title: 'Cambiar de modo',
      message: 'El temporizador actual se reiniciará y el tiempo en curso no se guardará.',
      confirmLabel: 'Cambiar de modo',
    });
    if (!ok) return;
  }
  T.mode = mode;
  resetTimer();
}

// Si se toca la duración de la fase que está en pantalla y el reloj está ocioso,
// el reloj la adopta. Sin esto quedaban minutos de trabajo sobre un total de descanso.
function syncIdleRemaining(key) {
  if (T.mode !== 'pomodoro' || T.running || T.paused) return;
  if (key && key !== T.phase) return;
  T.phaseTotal = phaseDuration();
  T.remaining = T.phaseTotal;
  renderClock();
}

// ── Alarma (Web Audio, sin archivos) ──
// Usa el AudioContext compartido de audio.js: crear uno nuevo aquí (como antes) lo
// deja 'suspended' en Safari, porque este código lo dispara un setTimeout y no un
// gesto del usuario.
function playAlarm() {
  emit('alarm');
  const ring = (volume, length) => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain(), t0 = ctx.currentTime + i * 0.25;
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(volume, t0 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + length);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + length);
      });
    } catch { /* audio no disponible */ }
  };
  ring(0.3, 0.6);
  setTimeout(() => ring(0.25, 0.8), 1000);
}

// ── Tiempos del Pomodoro (rueda y Configuración comparten estos controles) ──
export function pomoRowsHTML(prefix) {
  return Object.entries(CFG_LIMITS).map(([k, L]) => `
    <div class="pp-row">
      <label for="${prefix}-${k}">${L.label}</label>
      <span class="pp-step">
        <button type="button" data-cfg-step="${k}" data-d="-1" aria-label="Restar: ${L.label}">${ic('subtract', 's16')}</button>
        <output data-cfg-out="${k}">${S.cfg[k]}${L.unit}</output>
        <button type="button" data-cfg-step="${k}" data-d="1" aria-label="Sumar: ${L.label}">${ic('add', 's16')}</button>
      </span>
      <input type="range" id="${prefix}-${k}" min="${L.min}" max="${L.max}" step="${L.step}" value="${S.cfg[k]}" data-cfg="${k}">
    </div>`).join('');
}
export function syncCfgControls() {
  Object.entries(CFG_LIMITS).forEach(([k, L]) => {
    $$(`[data-cfg="${k}"]`).forEach(i => { if (+i.value !== S.cfg[k]) i.value = S.cfg[k]; });
    $$(`[data-cfg-out="${k}"]`).forEach(o => { o.textContent = S.cfg[k] + L.unit; });
    $$(`[data-cfg-step="${k}"]`).forEach(b => { b.disabled = +b.dataset.d < 0 ? S.cfg[k] <= L.min : S.cfg[k] >= L.max; });
  });
  const summary = `${S.cfg.work} min de trabajo · ${S.cfg.short} y ${S.cfg.long} de descanso · ${S.cfg.cycles} ciclos`;
  $$('[data-cfg-summary]').forEach(s => { s.textContent = summary; });
}

function openGear(anchor) {
  openMenu({
    anchor, className: 'pop', label: 'Tiempos del Pomodoro', align: 'end',
    content: panel => {
      panel.innerHTML = `
        <div class="pp-head"><b>Pomodoro</b><span data-cfg-summary></span></div>
        ${pomoRowsHTML('gear')}
        <p class="pp-note"${T.mode === 'cronometro' ? '' : ' hidden'}>En modo Cronómetro estos tiempos no se usan.</p>
        <div class="pp-foot">
          <button type="button" class="btn sm" data-cfg-reset>Restablecer</button>
          <button type="button" class="btn sm primary" data-menu-close>Listo</button>
        </div>`;
      syncCfgControls();
    },
  });
}

function openModeMenu(anchor) {
  openMenu({
    anchor, value: T.mode, minWidth: 240,
    items: [
      { value: 'pomodoro', label: 'Pomodoro', hint: 'cuenta atrás' },
      { value: 'cronometro', label: 'Cronómetro', hint: 'sin límite' },
      { type: 'sep' },
      { value: 'manual', label: 'Registrar sesión manual…', icon: 'edit', action: true },
    ],
    onSelect: v => (v === 'manual' ? openManual() : setMode(v)),
  });
}

function openActiveMenu(anchor) {
  openMenu({
    anchor, value: S.activeCategoryId, search: true, minWidth: 260,
    items: [{ type: 'head', label: 'Guardar sesiones nuevas en' }, ...folderItems({ archived: 'hide' })],
    onSelect: v => setActiveCategory(v),
  });
}

export function openManual() {
  const cat = categoryById(S.activeCategoryId);
  const card = openModal(`
    <h3>${ic('edit')} Registrar sesión manual</h3>
    <p class="modal-sub">Se guarda como <b>${esc(T.type)}</b> en <b>${esc(cat ? cat.path : 'tu carpeta activa')}</b>.</p>
    <form class="modal-field" novalidate>
      <label class="modal-label" for="manual-min">Minutos</label>
      <input id="manual-min" class="field" type="number" min="1" max="600" inputmode="numeric" placeholder="Por ejemplo, 45">
    </form>
    <div class="modal-actions">
      <button type="button" class="btn" data-cancel>Cancelar</button>
      <button type="button" class="btn primary" data-ok>Registrar</button>
    </div>`);
  const input = card.querySelector('#manual-min');
  const submit = () => {
    const min = Math.round(+input.value);
    if (!min || min < 1 || min > 600) {
      input.focus();
      toast('Escribe un número de minutos entre 1 y 600', 'error');
      return;
    }
    logSession(min, T.type, 'manual');
    closeModal();
    toast(`Sesión manual de ${fmtMin(min)} registrada`);
  };
  card.querySelector('form').addEventListener('submit', e => { e.preventDefault(); submit(); });
  card.querySelector('[data-ok]').addEventListener('click', submit);
  card.querySelector('[data-cancel]').addEventListener('click', () => closeModal());
}

// ── Lo que rodea al reloj ──
function onTypeInput() {
  const val = $('#type-input').value.trim();
  T.type = val || 'General';
  $$('#chips [data-type]').forEach(c => c.classList.toggle('selected', !!val && c.dataset.type === val));
}

function renderActive() {
  const cat = categoryById(S.activeCategoryId);
  $('#btn-active-label').textContent = cat ? cat.name : '—';
  $('#btn-active').title = cat ? `Carpeta activa: ${cat.path}` : 'Carpeta activa';
  $('#t-active-path').textContent = cat ? cat.path : 'Sin carpeta';
  $('#t-active-dot').style.setProperty('--c', cat ? cat.color : 'transparent');
}

// Hasta 3 recomendaciones: los tipos más usados en la carpeta del filtro
// (con sus subcarpetas), o en todo el historial si no hay filtro.
function renderRecos() {
  const counts = {};
  studyRecs().forEach(r => { if (r.type) counts[r.type] = (counts[r.type] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const box = $('#chips');
  box.hidden = !top.length;
  const cat = categoryById(S.filterCategoryId);
  $('#chips-lab-text').textContent = cat ? `Recomendados en ${cat.name}` : 'Recomendados';
  box.title = cat ? `Lo que más estudias en ${cat.path}` : 'Lo que más estudias';
  const current = $('#type-input').value.trim();
  $('#chips-list').innerHTML = top.map(([t]) =>
    `<button type="button" class="chip${t === current ? ' selected' : ''}" data-type="${esc(t)}">${esc(t)}</button>`).join('');
}

function renderHomeStats() {
  const recs = studyRecs();
  const { current } = computeStreaks(recs);
  const today = localDateStr(), weekFrom = daysAgoStr(6);
  const todayMin = recs.filter(r => r.date === today).reduce((a, r) => a + r.minutes, 0);
  const weekMin = recs.filter(r => r.date >= weekFrom).reduce((a, r) => a + r.minutes, 0);
  $('#hs-streak').textContent = `${current} ${current === 1 ? 'día' : 'días'}`;
  $('#hs-today').textContent = fmtMin(todayMin);
  $('#hs-week').textContent = fmtMin(weekMin);
  $('#me-sub').textContent = current ? `Racha de ${current} ${current === 1 ? 'día' : 'días'}` : 'Empieza tu racha hoy';
}

export function setGreeting(name) {
  const h = new Date().getHours();
  const saludo = h < 6 ? 'Buenas noches' : h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  $('#greeting').textContent = `${saludo}, ${name}`;
}

export function focusTypeInput() {
  const input = $('#type-input');
  input.focus();
  input.select();
}

export function initTimer() {
  T.remaining = T.phaseTotal = S.cfg.work * 60;

  $('#btn-toggle').addEventListener('click', () => {
    if (T.midBreak) endMidBreak();
    else if (T.running) pause();
    else start();
  });
  $('#btn-reset').addEventListener('click', resetTimer);
  $('#btn-save').addEventListener('click', saveCrono);
  $('#btn-midbreak').addEventListener('click', e => openMidBreakMenu(e.currentTarget));
  $('#btn-mode').addEventListener('click', e => openModeMenu(e.currentTarget));
  $('#btn-active').addEventListener('click', e => openActiveMenu(e.currentTarget));
  $('#btn-gear').addEventListener('click', e => openGear(e.currentTarget));
  $('#type-input').addEventListener('input', onTypeInput);
  $('#type-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); if (!T.running) start(); }
  });
  $('#chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-type]');
    if (!chip) return;
    $('#type-input').value = chip.dataset.type;
    onTypeInput();
  });

  // Controles de tiempos: viven en la rueda y en Configuración, con los mismos data-*.
  document.addEventListener('input', e => {
    const key = e.target.dataset && e.target.dataset.cfg;
    if (key) setCfg(key, e.target.value);
  });
  document.addEventListener('click', e => {
    const step = e.target.closest('[data-cfg-step]');
    if (step) {
      const key = step.dataset.cfgStep;
      setCfg(key, S.cfg[key] + (+step.dataset.d) * CFG_LIMITS[key].step);
      return;
    }
    if (e.target.closest('[data-cfg-reset]')) { Object.keys(CFG_DEFAULT).forEach(k => setCfg(k, CFG_DEFAULT[k])); return; }
    if (e.target.closest('[data-menu-close]')) closeMenu();
  });

  on('cfg', key => { syncCfgControls(); syncIdleRemaining(key); });
  // Botón «Empezar…» de una notificación: solo si el reloj sigue esperando esa misma fase.
  on('timer-command', ({ command, phase }) => {
    if (command === 'start' && T.mode === 'pomodoro' && !T.running && !T.paused && T.phase === phase) start();
  });
  on('active', renderActive);
  on('categories', renderActive);
  on('sessions', () => { renderRecos(); renderHomeStats(); });
  on('filter', () => { renderRecos(); renderHomeStats(); });
  on('categories', renderRecos);   // las subcarpetas del filtro dependen del árbol
  // Si el tema escrito en la barra de actividad se acaba de renombrar en otro sitio
  // (Registro o Estadísticas), lo sigue: si no, la próxima sesión se guardaría con el
  // nombre viejo sin que se note.
  on('type-renamed', ({ from, to }) => {
    if (T.type === from) { T.type = to; $('#type-input').value = to; }
  });
  // Al volver a la pestaña, el reloj se pone al día al instante.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && (T.running || T.midBreak)) tick(); });

  updateToggle();
  renderClock();
  syncCfgControls();
}
