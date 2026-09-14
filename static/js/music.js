// Música de concentración: sonidos que se generan en el navegador con Web Audio
// (sin archivos ni licencias) y pistas propias opcionales en /static/music.
import { $, $$, ic, esc, toast, on, lsGet, lsSet, ICONS } from './util.js';
import { openMenu } from './ui.js';

const PREFS_KEY = 'focusdata.music';
const TRACKS_URL = '/static/music/tracks.json';
const HEX_RE = /^#[0-9a-f]{6}$/i;

// Catálogo de sonidos generados. c: degradado de la miniatura; level: ajuste para igualar volúmenes.
const SOUNDS = [
  { id: 'lofi',    label: 'Lo-fi',        hint: 'beats relajados',   c: ['#FDBA74', '#9333EA'], level: 0.85, build: buildLofi },
  { id: 'ambient', label: 'Ambiente',     hint: 'música generativa', c: ['#C084FC', '#EC4899'], build: buildAmbient },
  { id: 'rain',    label: 'Lluvia',       hint: 'constante y suave', c: ['#60A5FA', '#6366F1'], build: buildRain },
  { id: 'forest',  label: 'Bosque',       hint: 'pájaros y viento',  c: ['#4ADE80', '#15803D'], level: 1.7, build: buildForest },
  { id: 'waves',   label: 'Olas',         hint: 'vaivén lento',      c: ['#22D3EE', '#2563EB'], level: 1.2, build: buildWaves },
  { id: 'fire',    label: 'Chimenea',     hint: 'crepitar cálido',   c: ['#FBBF24', '#EA580C'], level: 1.1, build: buildFire },
  { id: 'brown',   label: 'Ruido marrón', hint: 'tapa el ruido',     c: ['#A8A29E', '#57534E'], build: buildBrown },
];

const M = {
  sound: null,        // 'rain', 'track:<id>'… o null = sin música
  volume: 60,         // 0–100
  sync: true,         // suena mientras corre el trabajo del temporizador
  playing: false,
  tracks: [],         // pistas de tracks.json: [{ id, label, hint, file, colors }]
};

let ctx = null, master = null, duck = null;
let voice = null;             // sonido en curso: { id, out, nodes, timers, media }
let suspendTimer = null;
let timerWants = false;       // el temporizador está en una fase que pide música

function loadPrefs() {
  const p = lsGet(PREFS_KEY, null);
  if (!p || typeof p !== 'object') return;
  if (typeof p.sound === 'string') M.sound = p.sound;
  if (typeof p.volume === 'number' && Number.isFinite(p.volume)) M.volume = Math.min(100, Math.max(0, Math.round(p.volume)));
  if (typeof p.sync === 'boolean') M.sync = p.sync;
}
const remember = () => lsSet(PREFS_KEY, { sound: M.sound, volume: M.volume, sync: M.sync });

function resolve(id) {
  if (!id) return null;
  if (id.startsWith('track:')) {
    const t = M.tracks.find(x => `track:${x.id}` === id);
    return t ? { id, label: t.label, hint: t.hint, c: t.colors, track: t } : null;
  }
  return SOUNDS.find(s => s.id === id) || null;
}

// ══ Motor de audio ═══════════════════════════════════════════════
// El AudioContext se crea en el primer clic: los navegadores bloquean el audio sin gesto.
function engine() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = gainNode(0);
    duck = gainNode(1);
    // Tope suave: varias capas sumadas nunca llegan a saturar.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    master.connect(duck).connect(limiter).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// El slider es lineal; el oído no: se eleva al cuadrado.
const level = v => (v / 100) ** 2;
const rand = (a, b) => a + Math.random() * (b - a);
const poisson = mean => -Math.log(1 - Math.random()) * mean;
const midi = n => 440 * 2 ** ((n - 69) / 12);

function rampTo(param, value, secs) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(value, t + secs);
}
function gainNode(value) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}
function filterNode(type, frequency, Q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
}
function panNode(pan) {
  if (!ctx.createStereoPanner) return gainNode(1);
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

// Búferes de ruido de 8 s en estéreo, generados una sola vez.
const buffers = {};
function noiseBuffer(kind) {
  if (buffers[kind]) return buffers[kind];
  const len = Math.floor(ctx.sampleRate * 8);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') {
        d[i] = w;
      } else if (kind === 'pink') {
        // Filtro de Paul Kellet: -3 dB por octava.
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;    b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;    b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;   // marrón: integración con fuga
        d[i] = last * 3.5;
      }
    }
    if (kind === 'brown') {
      // El ruido marrón deriva: se endereza para que el bucle empalme sin chasquido.
      const drift = d[len - 1] - d[0];
      for (let i = 0; i < len; i++) d[i] -= drift * i / (len - 1);
    }
  }
  return (buffers[kind] = buf);
}
function reverbBuffer() {
  if (buffers.reverb) return buffers.reverb;
  const len = Math.floor(ctx.sampleRate * 3.5);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return (buffers.reverb = buf);
}

function noiseLoop(v, kind, dest, rate = 1) {
  return loopSource(v, noiseBuffer(kind), dest, rate);
}
function loopSource(v, buf, dest, rate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = rate;
  src.connect(dest);
  src.start(0, Math.random() * buf.duration);   // capas del mismo búfer, desfasadas
  v.nodes.push(src);
  return src;
}
// Variación lenta y sin periodo (un LFO acaba sonando repetitivo): ruido marrón a cámara
// lenta. Con rate 0.0003 cambia en escalas de unos 3 s; la salida ronda ±1.
function wander(v, rate) {
  const out = gainNode(4);
  loopSource(v, noiseBuffer('brown'), out, rate);
  return out;
}
// Oscilador lento que mueve uno o varios parámetros (volumen, filtro, paneo).
function lfo(v, freq, depth, param) {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  osc.start();
  v.nodes.push(osc);
  modulate(osc, depth, param);
  return osc;
}
function modulate(osc, depth, param) {
  osc.connect(gainNode(depth)).connect(param);
}
// Golpe corto de ruido filtrado: gotas, chispas.
function burst(v, t, { type = 'bandpass', freq, q = 1, peak, decay, pan = 0, dest = v.out }) {
  const buf = noiseBuffer('white');
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const env = gainNode(0);
  src.connect(filterNode(type, freq, q)).connect(env).connect(panNode(pan)).connect(dest);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.002);
  env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.start(t, Math.random() * (buf.duration - 1), decay + 0.02);
}
// Eventos sueltos (gotas, chispas, notas). Se planifican con 1,5 s de adelanto para
// aguantar que el navegador espacie los temporizadores en pestañas de fondo.
// spawn(t) programa un evento en t y devuelve los segundos hasta el siguiente.
function every(v, spawn) {
  let next = ctx.currentTime + 0.05;
  const tick = () => {
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
    const horizon = ctx.currentTime + 1.5;
    while (next < horizon) next += Math.max(0.005, spawn(next));
  };
  tick();
  v.timers.push(setInterval(tick, 300));
}

// ══ Sonidos ══════════════════════════════════════════════════════
function buildBrown(v) {
  // Dos bucles a distinta velocidad: juntos no repiten ningún patrón audible. El filtro
  // quita el retumbe subgrave (cansa con audífonos) y lo más agudo.
  const hp = filterNode('highpass', 30, 0.5), lp = filterNode('lowpass', 1100, 0.5), g = gainNode(0.62);
  noiseLoop(v, 'brown', hp);
  noiseLoop(v, 'brown', hp, 0.917);
  hp.connect(lp).connect(g).connect(v.out);
  modulate(wander(v, 0.0002), 0.05, g.gain);   // variación mínima y sin periodo
}

// Textura de gotas pregenerada: cientos de impactos por segundo repartidos en estéreo.
// Un búfer así cuesta muchísimo menos que crear nodos por gota, y el bucle empalma
// porque las gotas que caen al final continúan al principio.
function dropsBuffer() {
  if (buffers.drops) return buffers.drops;
  const sr = ctx.sampleRate, len = Math.floor(sr * 8);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let n = 0; n < 8 * 350; n++) {
    const start = Math.floor(Math.random() * len);
    const amp = 0.05 + 0.7 * Math.random() ** 5;    // muchas suaves, pocas fuertes
    const pan = Math.random(), gl = Math.sqrt(1 - pan), gr = Math.sqrt(pan);
    if (Math.random() < 0.15) {
      // Gota sobre agua: seno amortiguado que sube de tono (la burbuja que se forma).
      const f0 = rand(1500, 4500), sigma = rand(8, 25), decay = rand(0.004, 0.014);
      const dur = Math.floor(decay * 5 * sr);
      let phase = 0;
      for (let i = 0; i < dur; i++) {
        const t = i / sr;
        phase += 2 * Math.PI * f0 * (1 + sigma * t) / sr;
        const s = amp * 0.6 * Math.sin(phase) * Math.exp(-t / decay);
        const k = (start + i) % len;
        L[k] += s * gl;
        R[k] += s * gr;
      }
    } else {
      // Impacto: chasquido de ruido; cuanto más filtrado, más grande y lejano suena.
      const decay = rand(0.0015, 0.005), dur = Math.floor(decay * 6 * sr), a = rand(0.08, 0.45);
      let y = 0;
      for (let i = 0; i < dur; i++) {
        y += a * (Math.random() * 2 - 1 - y);
        const s = amp * y * Math.exp(-i / sr / decay);
        const k = (start + i) % len;
        L[k] += s * gl;
        R[k] += s * gr;
      }
    }
  }
  // Nivel fijo, salga como salga el azar.
  let sum = 0;
  for (let i = 0; i < len; i++) sum += L[i] * L[i] + R[i] * R[i];
  // …y las gotas más fuertes se redondean para que no restallen.
  const k = 0.12 / Math.sqrt(sum / (2 * len));
  for (let i = 0; i < len; i++) {
    L[i] = 0.5 * Math.tanh(L[i] * k / 0.5);
    R[i] = 0.5 * Math.tanh(R[i] * k / 0.5);
  }
  return (buffers.drops = buf);
}

function buildRain(v) {
  const gust = wander(v, 0.0003);
  // Repiqueteo: la textura de gotas en dos capas a distinta velocidad, así el bucle no se nota.
  const patterHp = filterNode('highpass', 300), patter = gainNode(0.9);
  patterHp.connect(filterNode('lowpass', 6000)).connect(patter).connect(v.out);
  loopSource(v, dropsBuffer(), patterHp);
  loopSource(v, dropsBuffer(), patterHp, 0.89);
  modulate(gust, 0.18, patter.gain);
  // Cortina de fondo: el rumor de la lluvia lejana, que sube y baja con las ráfagas.
  const washBp = filterNode('bandpass', 1500, 0.35), wash = gainNode(0.8);
  noiseLoop(v, 'pink', washBp);
  washBp.connect(wash).connect(v.out);
  modulate(gust, 0.2, wash.gain);
  modulate(gust, 300, washBp.frequency);
  // Retumbo grave, casi subliminal.
  const lowLp = filterNode('lowpass', 250), low = gainNode(0.4);
  noiseLoop(v, 'brown', lowLp, 0.93);
  lowLp.connect(low).connect(v.out);
  // Goterones cercanos de vez en cuando (un alero, una hoja).
  every(v, t => {
    burst(v, t, { freq: rand(900, 1800), q: 2, peak: rand(0.2, 0.45), decay: rand(0.04, 0.08), pan: rand(-0.7, 0.7) });
    return poisson(1.2);
  });
}

// Forma de una ola (0 → 1 → 0): sube acelerando, rompe y se retira despacio.
// La espuma arranca al romper y la resaca (siseo fino) llega mientras el agua se retira.
let waveShapes = null;
function waveShape() {
  if (waveShapes) return waveShapes;
  const n = 256, r = 0.38;
  const body = new Float32Array(n), foam = new Float32Array(n), fizz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1), fade = Math.min(1, (1 - x) / 0.12);
    const u = Math.max(0, (x - r) / (1 - r));
    body[i] = (x < r ? (x / r) ** 2 : Math.exp(-3 * u)) * fade;
    const uf = Math.max(0, (x - r + 0.03) / (1 - r + 0.03));
    foam[i] = x < r - 0.03 ? 0 : (1 - Math.exp(-uf / 0.05)) * Math.exp(-2.2 * uf) * fade;
    const uz = Math.max(0, (x - r - 0.12) / (1 - r - 0.12));
    fizz[i] = x < r + 0.12 ? 0 : Math.sin(Math.PI * uz) * Math.exp(-2 * uz) * fade;
  }
  return (waveShapes = { body, foam, fizz });
}

function buildWaves(v) {
  // Mar de fondo constante y lejano.
  const bedLp = filterNode('lowpass', 300), bed = gainNode(0.4);
  noiseLoop(v, 'brown', bedLp);
  bedLp.connect(bed).connect(v.out);
  modulate(wander(v, 0.0003), 0.08, bed.gain);

  const shot = (kind, t, dur, dest) => {
    const buf = noiseBuffer(kind), src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(dest);
    src.start(t, Math.random() * buf.duration);
    src.stop(t + dur + 0.05);
  };
  // Cada ola se programa aparte, con su duración, su fuerza y su lado; se solapan un poco.
  every(v, t => {
    const dur = rand(7, 12), strength = rand(0.55, 1), shape = waveShape();
    const pan = panNode(rand(-0.45, 0.45));
    pan.connect(v.out);
    // Cuerpo: ruido marrón con un filtro que se abre al romper.
    const lp = filterNode('lowpass', 200, 0.6), body = gainNode(0);
    lp.connect(body).connect(pan);
    shot('brown', t, dur, lp);
    lp.frequency.setValueCurveAtTime(shape.body.map(e => 200 + 1400 * strength * e ** 0.7), t, dur);
    body.gain.setValueCurveAtTime(shape.body.map(e => e * 1.3 * strength), t, dur);
    // Espuma al romper.
    const hp = filterNode('highpass', rand(1200, 2000)), foam = gainNode(0);
    hp.connect(foam).connect(pan);
    shot('pink', t, dur, hp);
    foam.gain.setValueCurveAtTime(shape.foam.map(e => e * strength), t, dur);
    // Resaca: el agua que se retira sobre la arena.
    const bp = filterNode('bandpass', rand(4000, 6000), 0.8), fizz = gainNode(0);
    bp.connect(fizz).connect(pan);
    shot('white', t, dur, bp);
    fizz.gain.setValueCurveAtTime(shape.fizz.map(e => e * 0.2 * strength), t, dur);
    return dur * rand(0.6, 0.85);
  });
}

function buildForest(v) {
  const verb = ctx.createConvolver();
  verb.buffer = reverbBuffer();
  verb.connect(filterNode('lowpass', 4000)).connect(gainNode(0.3)).connect(v.out);

  // Viento entre las hojas: las ráfagas mueven el volumen y el filtro a la vez.
  const gust = wander(v, 0.00025);
  const leavesBp = filterNode('bandpass', 700, 0.5), leaves = gainNode(0.9);
  noiseLoop(v, 'pink', leavesBp);
  leavesBp.connect(leaves).connect(v.out);
  modulate(gust, 0.3, leaves.gain);
  modulate(gust, 200, leavesBp.frequency);
  // Hojas cercanas: un susurro agudo que tiembla más rápido.
  const rustleHp = filterNode('highpass', 2800), rustle = gainNode(0.12);
  noiseLoop(v, 'pink', rustleHp, 0.97);
  rustleHp.connect(rustle).connect(v.out);
  modulate(gust, 0.05, rustle.gain);
  modulate(wander(v, 0.0015), 0.03, rustle.gain);

  // Pájaros: cada uno con su canto, su tono, su lado y su distancia.
  const birdBus = gainNode(1);
  birdBus.connect(v.out);
  birdBus.connect(verb);
  const perch = (pan, distance) => {
    const out = gainNode(1 - distance * 0.65);
    out.connect(filterNode('lowpass', 11000 - distance * 6000)).connect(panNode(pan)).connect(birdBus);
    return out;
  };
  const tone = (t, dest, f0, f1, dur, amp) => {
    const osc = ctx.createOscillator(), env = gainNode(0);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    osc.connect(env).connect(dest);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(amp, t + dur * 0.2);
    env.gain.linearRampToValueAtTime(amp * 0.7, t + dur * 0.7);
    env.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  const SONGS = {
    // Serie de silbidos cortos que bajan (o suben) de tono.
    tweet(t, b) {
      const n = 2 + Math.floor(Math.random() * 4), up = Math.random() < 0.3, gap = rand(0.1, 0.15);
      for (let k = 0; k < n; k++) {
        tone(t + k * gap, b.out, b.pitch * (up ? 0.8 : 1.15), b.pitch * (up ? 1.1 : 0.8), rand(0.05, 0.08), 0.18);
      }
    },
    // Dos o tres notas largas y limpias.
    whistle(t, b) {
      const notes = Math.random() < 0.6 ? [1, 0.84] : [1, 0.84, 0.84];
      notes.forEach((m, k) => tone(t + k * 0.36, b.out, b.pitch * m * 1.02, b.pitch * m * 0.98, 0.26, 0.15));
    },
    // Trino: un tono que vibra muy rápido.
    trill(t, b) {
      const dur = rand(0.6, 1.1), osc = ctx.createOscillator(), fm = ctx.createOscillator(), env = gainNode(0);
      osc.frequency.setValueAtTime(b.pitch * 1.05, t);
      osc.frequency.linearRampToValueAtTime(b.pitch * 0.92, t + dur);
      fm.frequency.value = rand(22, 32);
      fm.connect(gainNode(b.pitch * 0.1)).connect(osc.frequency);
      osc.connect(env).connect(b.out);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.12, t + 0.08);
      env.gain.setValueAtTime(0.12, t + dur - 0.15);
      env.gain.linearRampToValueAtTime(0, t + dur);
      [osc, fm].forEach(o => { o.start(t); o.stop(t + dur + 0.05); });
    },
  };
  [
    { song: 'tweet',   pitch: rand(3400, 4200), out: perch(-0.6, 0.3) },
    { song: 'whistle', pitch: rand(1900, 2500), out: perch(0.5, 0.6) },
    { song: 'trill',   pitch: rand(3000, 3800), out: perch(0.15, 0.85) },
    { song: 'tweet',   pitch: rand(4800, 5600), out: perch(0.8, 0.5) },
  ].forEach(bird => {
    // Cantan en rondas: unas cuantas llamadas seguidas y luego un silencio largo.
    let left = 0, rest = [0.5, 6];
    every(v, t => {
      if (left <= 0) {
        left = 2 + Math.floor(Math.random() * 5);
        const pause = rand(rest[0], rest[1]);
        rest = [6, 22];
        return pause;
      }
      left--;
      SONGS[bird.song](t, bird);
      return rand(1.5, 4);
    });
  });

  // Un pájaro carpintero, muy de vez en cuando y a lo lejos.
  const trunk = perch(-0.3, 0.8);
  let firstKnock = true;
  every(v, t => {
    if (firstKnock) { firstKnock = false; return rand(15, 40); }
    const knocks = 12 + Math.floor(Math.random() * 10), gap = rand(0.045, 0.06);
    for (let k = 0; k < knocks; k++) {
      burst(v, t + k * gap * (1 + k * 0.012), { freq: rand(1000, 1300), q: 4, peak: 2.4 * (1 - 0.6 * k / knocks), decay: 0.02, dest: trunk });
    }
    return rand(40, 90);
  });
}

function buildFire(v) {
  // Rugido grave que titila.
  const lp = filterNode('lowpass', 320), roar = gainNode(0.7);
  noiseLoop(v, 'brown', lp);
  lp.connect(roar).connect(v.out);
  lfo(v, 0.13, 0.2, roar.gain);
  lfo(v, 0.71, 0.08, roar.gain);
  // Siseo de la leña.
  const bp = filterNode('bandpass', 2600, 0.6), hiss = gainNode(0.08);
  noiseLoop(v, 'pink', bp);
  bp.connect(hiss).connect(v.out);
  // Chasquidos, a veces en racimo, y algún estallido más grave.
  every(v, t => {
    const pop = Math.random() < 0.06;
    burst(v, t, pop
      ? { freq: rand(700, 1400), q: 1.5, peak: rand(0.5, 0.9), decay: rand(0.05, 0.09), pan: rand(-0.5, 0.5) }
      : { type: 'highpass', freq: rand(1800, 5000), q: 0.8, peak: rand(0.1, 0.5), decay: rand(0.004, 0.018), pan: rand(-0.6, 0.6) });
    return Math.random() < 0.25 ? rand(0.015, 0.06) : poisson(0.35);
  });
}

// Música generativa en Re mayor: acordes largos y campanitas de la pentatónica,
// que encajan sobre cualquiera de los acordes.
const CHORDS = [
  [50, 57, 61, 64, 66],   // Dmaj9
  [47, 54, 57, 62, 64],   // Bm11
  [43, 50, 54, 59, 61],   // Gmaj7(#11)
  [45, 52, 59, 62, 66],   // A6sus
];
const BELLS = [69, 71, 74, 76, 78, 81, 83, 86];

function buildAmbient(v) {
  const verb = ctx.createConvolver();
  verb.buffer = reverbBuffer();
  verb.connect(gainNode(0.55)).connect(v.out);

  // Colchón de acordes, filtrado y cálido.
  const pads = gainNode(1), padLp = filterNode('lowpass', 1400);
  pads.connect(padLp);
  padLp.connect(v.out);
  padLp.connect(verb);
  lfo(v, 0.04, 400, padLp.frequency);

  // Campanitas con eco que se apaga solo.
  const bellBus = gainNode(1), echo = ctx.createDelay(2), echoLp = filterNode('lowpass', 2200), echoOut = gainNode(0.5);
  echo.delayTime.value = 0.42;
  bellBus.connect(v.out);
  bellBus.connect(verb);
  bellBus.connect(echo);
  echo.connect(echoLp).connect(gainNode(0.35)).connect(echo);
  echoLp.connect(echoOut);
  echoOut.connect(v.out);
  echoOut.connect(verb);

  // Los nodos de cada nota llevan su propio stop(): no se guardan en v.nodes.
  let chord = 0;
  every(v, t => {
    const dur = 10, attack = 3, release = 4;
    CHORDS[chord++ % CHORDS.length].forEach((note, i) => {
      const env = gainNode(0), peak = i === 0 ? 0.11 : 0.07;
      env.connect(pads);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + attack);
      env.gain.setValueAtTime(peak, t + dur);
      env.gain.linearRampToValueAtTime(0, t + dur + release);
      [['triangle', -5], ['sine', 5]].forEach(([type, cents]) => {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = midi(note);
        osc.detune.value = cents;
        osc.connect(env);
        osc.start(t);
        osc.stop(t + dur + release + 0.1);
      });
    });
    return dur;
  });

  const bell = (t, freq) => {
    const env = gainNode(0), peak = rand(0.045, 0.085);
    env.connect(bellBus);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    [[1, 1], [2, 0.2]].forEach(([mult, amp]) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * mult;
      osc.connect(gainNode(amp)).connect(env);
      osc.start(t);
      osc.stop(t + 3.3);
    });
  };
  let step = 3;
  every(v, t => {
    step = Math.max(0, Math.min(BELLS.length - 1, step + Math.round(rand(-2.4, 2.4))));
    bell(t, midi(BELLS[step]));
    if (Math.random() < 0.3) bell(t + 0.35, midi(BELLS[Math.max(0, step - 1)]));
    return Math.random() < 0.3 ? rand(4, 7) : rand(1.4, 3.2);
  });
}

// Lo-fi hip hop: piano eléctrico con acordes de jazz, bajo, batería con swing y
// crepitar de vinilo, pasado por una "cinta" que filtra, satura y desafina un poco.
// Progresiones en Do mayor; cada 8 compases se elige otra para que no se repita.
const LOFI_PROGRESSIONS = [
  [{ bass: 41, notes: [57, 60, 64, 67] },    // Fmaj9
   { bass: 40, notes: [55, 59, 62, 64] },    // Em7
   { bass: 38, notes: [53, 57, 60, 64] },    // Dm9
   { bass: 36, notes: [52, 55, 59, 62] }],   // Cmaj9
  [{ bass: 38, notes: [53, 57, 60, 64] },    // Dm9
   { bass: 43, notes: [53, 59, 64, 69] },    // G13
   { bass: 36, notes: [52, 55, 59, 62] },    // Cmaj9
   { bass: 45, notes: [55, 59, 60, 64] }],   // Am9
  [{ bass: 45, notes: [55, 59, 60, 64] },    // Am9
   { bass: 41, notes: [57, 60, 64, 67] },    // Fmaj9
   { bass: 36, notes: [52, 55, 59, 62] },    // Cmaj9
   { bass: 43, notes: [53, 59, 64, 69] }],   // G13
];

let tapeCurve = null;
function tapeSaturation() {
  if (!tapeCurve) {
    const n = 2048, k = 1.8;
    tapeCurve = new Float32Array(n);
    for (let i = 0; i < n; i++) tapeCurve[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / Math.tanh(k);
  }
  return tapeCurve;
}

function buildLofi(v) {
  const beat = 60 / 74, step = beat / 4, swing = step * 0.33;

  // Saturación suave común a todo.
  const warm = ctx.createWaveShaper();
  warm.curve = tapeSaturation();
  warm.oversample = '2x';
  warm.connect(v.out);

  // Piano y bajo: filtro que respira y afinación que ondula (retardo modulado, como una cinta gastada).
  const keys = gainNode(1), wow = ctx.createDelay(0.05), tape = filterNode('lowpass', 3400, 0.5);
  wow.delayTime.value = 0.006;
  keys.connect(wow).connect(tape).connect(warm);
  lfo(v, 0.05, 500, tape.frequency);
  lfo(v, 0.55, 0.0012, wow.delayTime);
  lfo(v, 0.13, 0.0008, wow.delayTime);
  const drums = gainNode(0.8);
  drums.connect(filterNode('lowpass', 7500)).connect(warm);

  // Vinilo: siseo muy bajo y chasquidos sueltos.
  const hissHp = filterNode('highpass', 1200);
  noiseLoop(v, 'pink', hissHp);
  hissHp.connect(filterNode('lowpass', 6000)).connect(gainNode(0.025)).connect(v.out);
  every(v, t => {
    burst(v, t, { type: 'highpass', freq: rand(1500, 4000), q: 0.7, peak: rand(0.03, 0.14), decay: rand(0.003, 0.008), pan: rand(-0.4, 0.4) });
    return poisson(0.18);
  });

  // Piano eléctrico: FM 1:1 con un índice que cae rápido (el tañido del ataque).
  const epiano = (t, note, dur, vel) => {
    const f = midi(note), hold = Math.max(dur, 0.65);
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), index = gainNode(0), env = gainNode(0);
    car.frequency.value = f;
    mod.frequency.value = f;
    mod.connect(index).connect(car.frequency);
    car.connect(env).connect(keys);
    index.gain.setValueAtTime(f * 1.4 * vel, t);
    index.gain.exponentialRampToValueAtTime(f * 0.1, t + 0.4);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.1 * vel, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.04 * vel, t + 0.6);
    env.gain.setTargetAtTime(0, t + hold, 0.15);
    [car, mod].forEach(o => { o.start(t); o.stop(t + hold + 1); });
  };
  const bass = (t, note, dur) => {
    const hold = Math.max(dur, 0.35), osc = ctx.createOscillator(), env = gainNode(0);
    osc.type = 'triangle';
    osc.frequency.value = midi(note);
    osc.connect(filterNode('lowpass', 400, 0.9)).connect(env).connect(keys);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.3, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.16, t + 0.3);
    env.gain.setTargetAtTime(0, t + hold, 0.06);
    osc.start(t);
    osc.stop(t + hold + 0.5);
  };
  const kick = (t, vel) => {
    const osc = ctx.createOscillator(), env = gainNode(0);
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    osc.connect(env).connect(drums);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.start(t);
    osc.stop(t + 0.45);
  };
  const snare = (t, vel) => {
    burst(v, t, { freq: 1800, q: 0.7, peak: 0.6 * vel, decay: 0.19, dest: drums });
    const osc = ctx.createOscillator(), env = gainNode(0);
    osc.type = 'triangle';
    osc.frequency.value = 185;
    osc.connect(env).connect(drums);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.3 * vel, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.12);
  };
  const hat = (t, vel, open) =>
    burst(v, t, { type: 'highpass', freq: 6500, q: 0.5, peak: 0.25 * vel, decay: open ? 0.2 : rand(0.025, 0.045), pan: 0.2, dest: drums });

  // Secuenciador por semicorcheas.
  let pos = 0, prog = 0, melody = new Map(), extraKick = false;
  every(v, t => {
    const bar = Math.floor(pos / 16), i = pos % 16;
    const at = t + (i % 4 === 2 ? swing : 0);   // corcheas a contratiempo, con swing
    if (i === 0 && bar && bar % 8 === 0) {
      prog = (prog + 1 + Math.floor(Math.random() * (LOFI_PROGRESSIONS.length - 1))) % LOFI_PROGRESSIONS.length;
    }
    const chord = LOFI_PROGRESSIONS[prog][bar % 4];
    if (i === 0) {
      chord.notes.forEach((n, k) => epiano(t + k * rand(0.01, 0.022), n, beat * rand(2.5, 3.5), rand(0.7, 0.9)));
      bass(t, chord.bass, beat * 1.5);
      extraKick = Math.random() < 0.4;
      // Una frase corta en algo más de la mitad de los compases, con notas del acorde.
      melody = new Map();
      if (bar > 1 && Math.random() < 0.55) {
        const pool = chord.notes.map(n => n + 12);
        [2, 4, 6, 8, 10, 12, 14].filter(() => Math.random() < 0.35).slice(0, 4)
          .forEach(p => melody.set(p, pool[Math.floor(Math.random() * pool.length)]));
      }
    }
    if (i === 6 && Math.random() < 0.3) chord.notes.slice(1).forEach((n, k) => epiano(at + k * 0.012, n, beat * 1.2, 0.5));
    if (i === 10 && Math.random() < 0.6) bass(at, chord.bass + (Math.random() < 0.5 ? 12 : 7), beat * 0.9);
    if (melody.has(i)) epiano(at, melody.get(i), beat * 1.3, rand(0.55, 0.75));

    // La batería entra en el segundo compás y descansa uno de cada 16.
    if (bar > 0 && bar % 16 !== 15) {
      if (i === 0 || i === 10 || (extraKick && i === 7)) kick(at, i === 0 ? 0.95 : 0.8);
      if (i === 4 || i === 12) snare(t + rand(0.005, 0.02), rand(0.85, 1));   // un pelo atrasada: suena más relajada
      if (i % 2 === 0) hat(at, i % 4 === 0 ? 0.9 : rand(0.45, 0.7), i === 14 && Math.random() < 0.15);
    }
    pos++;
    return step;
  });
}

function buildTrack(v, track) {
  const el = new Audio();
  el.loop = true;
  el.preload = 'auto';
  el.src = `/static/music/${encodeURIComponent(track.file)}`;
  ctx.createMediaElementSource(el).connect(v.out);
  el.addEventListener('error', () => {
    if (voice !== v) return;
    toast(`No se pudo cargar la pista «${track.label}»`, 'error');
    M.sound = null;
    remember();
    stop();
  });
  el.play().catch(() => {});
  v.media = el;
}

function startVoice(sound) {
  const v = { id: sound.id, out: gainNode(0), nodes: [], timers: [], media: null };
  v.out.connect(master);
  if (sound.track) buildTrack(v, sound.track); else sound.build(v);
  rampTo(v.out.gain, sound.level || 1, 1.5);
  return v;
}
function stopVoice(v) {
  rampTo(v.out.gain, 0, 0.8);
  v.timers.forEach(clearInterval);
  setTimeout(() => {
    v.nodes.forEach(n => { try { n.stop(); } catch { /* ya estaba parado */ } });
    if (v.media) { v.media.pause(); v.media.removeAttribute('src'); v.media.load(); }
    v.out.disconnect();
  }, 900);
}

// ══ Reproducción ═════════════════════════════════════════════════
function play() {
  const sound = resolve(M.sound);
  if (!sound) return;
  if (!engine()) { toast('Tu navegador no permite reproducir audio', 'error'); return; }
  clearTimeout(suspendTimer);
  if (!voice || voice.id !== sound.id) {
    if (voice) stopVoice(voice);
    voice = startVoice(sound);
  } else if (voice.media) {
    voice.media.play().catch(() => {});
  }
  duck.gain.cancelScheduledValues(ctx.currentTime);
  duck.gain.setValueAtTime(1, ctx.currentTime);
  rampTo(master.gain, level(M.volume), 0.6);
  M.playing = true;
  syncControls();
}

// En pausa el contexto se suspende: no gasta CPU ni batería.
function pause() {
  if (!M.playing) return;
  M.playing = false;
  rampTo(master.gain, 0, 0.5);
  clearTimeout(suspendTimer);
  suspendTimer = setTimeout(() => {
    if (M.playing) return;
    if (voice && voice.media) voice.media.pause();
    ctx.suspend().catch(() => {});
  }, 600);
  syncControls();
}

function stop() {
  if (voice) stopVoice(voice);
  voice = null;
  pause();
  syncControls();
}

function toggle() {
  if (M.playing) { pause(); return; }
  if (!resolve(M.sound)) { M.sound = SOUNDS[0].id; remember(); }
  play();
}

// Clic en una miniatura: la que ya suena se pausa; otra distinta cambia con fundido.
function pick(id) {
  if (!id) {
    M.sound = null;
    remember();
    stop();
    return;
  }
  if (id === M.sound && voice && voice.id === id) { toggle(); return; }
  M.sound = id;
  remember();
  play();
}

function setVolume(value) {
  M.volume = Math.min(100, Math.max(0, Math.round(+value || 0)));
  if (ctx && M.playing) rampTo(master.gain, level(M.volume), 0.08);
  remember();
  syncControls();
}

function setSync(enabled) {
  M.sync = enabled;
  remember();
  if (enabled && timerWants && !M.playing && resolve(M.sound)) play();
  syncControls();
}

// ══ Interfaz ═════════════════════════════════════════════════════
const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';

function tileHTML(id, label, hint, c, inner = EQ) {
  return `<button type="button" class="mu-tile" data-music="${esc(id)}" aria-pressed="false">
      <span class="mu-sw" style="--c1:${c[0]};--c2:${c[1]}">${inner}</span>
      <span class="mu-t"><b>${esc(label)}</b><small>${esc(hint)}</small></span>
    </button>`;
}

// Mismos controles en el panel de la barra superior y en Configuración (data-* compartidos).
function controlsHTML(prefix) {
  const tracks = M.tracks.length
    ? `<div class="mu-lab">Pistas</div><div class="mu-grid">${M.tracks.map(t => tileHTML(`track:${t.id}`, t.label, t.hint, t.colors)).join('')}</div>`
    : '';
  return `
    ${tracks ? '<div class="mu-lab">Sonidos</div>' : ''}
    <div class="mu-grid">
      ${tileHTML('', 'Sin música', 'silencio', ['#A8A29E', '#57534E'], ic('dismiss', 's16'))}
      ${SOUNDS.map(s => tileHTML(s.id, s.label, s.hint, s.c)).join('')}
    </div>
    ${tracks}
    <div class="mu-bar">
      <button type="button" class="mu-play" data-music-toggle aria-label="Reproducir música" title="Reproducir música">${ic('play', 's16')}</button>
      <label class="sr-only" for="${prefix}-music-volume">Volumen</label>
      <input type="range" id="${prefix}-music-volume" min="0" max="100" step="1" value="${M.volume}" data-music-volume>
      <output data-music-volume-out>${M.volume}%</output>
    </div>
    <label class="mu-sync">
      <input type="checkbox" data-music-sync${M.sync ? ' checked' : ''}>
      <span>Sincronizar con el temporizador<small>Suena mientras trabajas y se pausa en las pausas y los descansos</small></span>
    </label>`;
}

function syncControls() {
  const sound = resolve(M.sound);
  const current = sound ? sound.id : '';
  $$('[data-music]').forEach(b => {
    const selected = b.dataset.music === current;
    b.setAttribute('aria-pressed', String(selected));
    b.classList.toggle('playing', selected && M.playing);
  });
  const action = M.playing ? 'Pausar música' : 'Reproducir música';
  $$('[data-music-toggle]').forEach(b => {
    b.setAttribute('aria-label', action);
    b.title = action;
    b.querySelector('use').setAttribute('href', `${ICONS}#i-${M.playing ? 'pause' : 'play'}`);
  });
  $$('[data-music-volume]').forEach(i => { if (+i.value !== M.volume) i.value = M.volume; });
  $$('[data-music-volume-out]').forEach(o => { o.textContent = `${M.volume}%`; });
  $$('[data-music-sync]').forEach(i => { i.checked = M.sync; });
  const status = sound ? `${M.playing ? 'Sonando' : 'En pausa'}: ${sound.label}` : 'Lo-fi, lluvia, olas y más';
  $$('[data-music-status]').forEach(el => { el.textContent = status; });
  const btn = $('#btn-music');
  if (btn) {
    const title = sound && M.playing ? `Música: ${sound.label}` : 'Música de concentración';
    btn.classList.toggle('on', M.playing);
    btn.title = title;
    btn.setAttribute('aria-label', title);
  }
}

function renderSettings() {
  const box = $('#set-music-body');
  if (box) box.innerHTML = controlsHTML('settings');
  syncControls();
}

function openPanel(anchor) {
  openMenu({
    anchor, className: 'pop mu-pop', label: 'Música de concentración', align: 'end',
    content: panel => {
      panel.innerHTML = `<div class="pp-head"><b>Música de concentración</b><span data-music-status></span></div>${controlsHTML('pop')}`;
      syncControls();
    },
  });
}

// Pistas propias: se declaran en /static/music/tracks.json (ver el README de esa carpeta).
async function loadTracks() {
  try {
    const res = await fetch(TRACKS_URL, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data)) return;
    M.tracks = data
      .filter(t => t && typeof t.id === 'string' && /^[a-z0-9-]{1,30}$/.test(t.id)
        && typeof t.file === 'string' && /^[\w.-]+\.(mp3|ogg|oga|m4a|opus|webm)$/i.test(t.file))
      .map(t => ({
        id: t.id,
        file: t.file,
        label: (typeof t.label === 'string' && t.label.trim() ? t.label.trim() : t.id).slice(0, 30),
        hint: (typeof t.hint === 'string' && t.hint.trim() ? t.hint.trim() : 'pista').slice(0, 30),
        colors: Array.isArray(t.colors) && t.colors.length === 2 && t.colors.every(c => HEX_RE.test(c)) ? t.colors : ['#94A3B8', '#475569'],
      }));
  } catch {
    return;
  }
  renderSettings();
}

export function initMusic() {
  loadPrefs();
  $('#btn-music').addEventListener('click', e => openPanel(e.currentTarget));
  document.addEventListener('click', e => {
    const tile = e.target.closest('[data-music]');
    if (tile) { pick(tile.dataset.music || null); return; }
    if (e.target.closest('[data-music-toggle]')) toggle();
  });
  document.addEventListener('input', e => {
    if (e.target.matches('[data-music-volume]')) setVolume(e.target.value);
  });
  document.addEventListener('change', e => {
    if (e.target.matches('[data-music-sync]')) setSync(e.target.checked);
  });

  // Solo se actúa en los cambios: reiniciar un reloj parado no pausa la música.
  on('timer', s => {
    const wants = s.running && (s.mode === 'cronometro' || s.phase === 'work');
    const changed = wants !== timerWants;
    timerWants = wants;
    if (!changed || !M.sync || !resolve(M.sound)) return;
    if (wants && !M.playing) play();
    else if (!wants && M.playing) pause();
  });
  // La alarma de fin de fase se oye por encima de la música.
  on('alarm', () => {
    if (!ctx || !M.playing) return;
    const t = ctx.currentTime, p = duck.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(0.2, t + 0.15);
    p.setValueAtTime(0.2, t + 2.2);
    p.linearRampToValueAtTime(1, t + 3.5);
  });

  renderSettings();
  loadTracks();
}
