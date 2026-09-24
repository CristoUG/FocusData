// Motor de audio compartido por la alarma de fin de fase (timer.js) y la música de
// concentración (music.js): un único AudioContext para toda la app.
//
// En Safari/iOS crear un AudioContext en un momento que NO es un gesto del usuario
// (por ejemplo, el setTimeout que dispara la alarma al terminar un pomodoro) lo deja
// en estado 'suspended' y no suena nada. Si además cada módulo crea el suyo, WebKit
// puede bloquear el segundo. La solución: un solo contexto, creado y desbloqueado en
// el primer toque/clic/tecla, que ambos módulos reutilizan.
let ctx = null;
let unlocked = false;

function createContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  return AC ? new AC() : null;
}

// Devuelve el contexto compartido, creándolo si hace falta, e intenta reanudarlo si
// no está en marcha. No hay garantía de que quede 'running' fuera de un gesto del
// usuario (ver unlockAudio) ni fuera de una pestaña visible.
export function getAudioContext() {
  if (!ctx) ctx = createContext();
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => { /* sigue suspendido: seguirá intentándose */ });
  return ctx;
}

// En iOS, el Web Audio respeta el interruptor de silencio físico salvo que se declare
// la sesión de audio como "playback" (como una app de música). Disponible desde
// Safari 16.4 vía navigator.audioSession; en el resto de navegadores no existe.
function setPlaybackSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch { /* no soportado */ }
}

// Reproducir un buffer de una muestra en silencio, dentro del gesto del usuario, es
// lo que WebKit necesita para dejar de bloquear el audio el resto de la sesión.
function primeSilence(c) {
  try {
    const buffer = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(c.destination);
    src.start(0);
  } catch { /* no soportado */ }
}

// Se llama una vez al arrancar la app. El primer toque/clic/tecla del usuario
// desbloquea el audio para el resto de la sesión: sin esto, la alarma que suena sola
// al terminar una fase (sin gesto) no se oye en Safari.
export function unlockAudio() {
  if (unlocked) return;
  const opts = { capture: true, passive: true };
  const types = ['pointerdown', 'touchend', 'keydown'];
  const attempt = () => {
    const c = getAudioContext();
    if (!c) return;
    setPlaybackSession();
    primeSilence(c);
    const finish = () => {
      unlocked = true;
      types.forEach(t => document.removeEventListener(t, attempt, opts));
    };
    if (c.state === 'running') finish();
    else c.resume().then(finish).catch(() => { /* se reintenta con el próximo gesto */ });
  };
  types.forEach(t => document.addEventListener(t, attempt, opts));

  // Al volver a primer plano, Safari puede dejar el contexto en 'suspended' o
  // 'interrupted' (llamada, Siri, bloqueo de pantalla) y no lo reanuda solo.
  const resumeIfNeeded = () => { if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeIfNeeded(); });
  window.addEventListener('pageshow', resumeIfNeeded);
}
