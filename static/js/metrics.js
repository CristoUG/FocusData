// Métricas de hábito calculadas en el cliente a partir del historial sincronizado.
import { filteredDb, studyRecs } from './store.js';
import { localDateStr, daysAgoStr, dayDiff } from './util.js';

export const STREAK_MIN_MIN = 1;   // un día cuenta para la racha con >= 1 min
export const IRS_MIN_MIN = 20;     // un día es "regular" con >= 20 min

export function minutesByDate(recs = studyRecs()) {
  const map = {};
  recs.forEach(r => { map[r.date] = (map[r.date] || 0) + r.minutes; });
  return map;
}

// Racha actual (desde hoy o ayer hacia atrás) y racha máxima histórica.
export function computeStreaks(recs = studyRecs()) {
  const byDate = minutesByDate(recs);
  const days = Object.keys(byDate).filter(d => byDate[d] >= STREAK_MIN_MIN).sort();
  if (!days.length) return { current: 0, max: 0 };
  const set = new Set(days);
  let max = 0, run = 0, prev = null;
  days.forEach(d => {
    run = prev && dayDiff(prev, d) === 1 ? run + 1 : 1;
    max = Math.max(max, run);
    prev = d;
  });
  let current = 0;
  let cursor = localDateStr();
  if (!set.has(cursor)) {
    cursor = daysAgoStr(1);
    if (!set.has(cursor)) return { current: 0, max };
  }
  while (set.has(cursor)) {
    current++;
    const d = new Date(cursor + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    cursor = localDateStr(d);
  }
  return { current, max };
}

// Índice de regularidad semanal: días de los últimos 7 con >= IRS_MIN_MIN.
export function computeIRS(recs = studyRecs()) {
  const byDate = minutesByDate(recs);
  let active = 0;
  for (let i = 0; i < 7; i++) if ((byDate[daysAgoStr(i)] || 0) >= IRS_MIN_MIN) active++;
  return { pct: Math.round(active / 7 * 100), active };
}

// Ratio de descanso activo: minutos de descanso / minutos de estudio.
export function computeRDA() {
  let study = 0, brk = 0;
  filteredDb().forEach(r => { if (r.mode === 'break') brk += r.minutes; else study += r.minutes; });
  return { ratio: study > 0 ? Math.round(brk / study * 100) : 0, study, brk };
}

export const sumMinutes = recs => recs.reduce((a, r) => a + r.minutes, 0);
export const sumBetween = (recs, from, to = '9999-12-31') =>
  sumMinutes(recs.filter(r => r.date >= from && r.date <= to));

// Minutos por hora del día. La sesión se registra al TERMINAR, así que sus
// minutos se reparten hacia atrás desde la hora de registro.
export function hoursSeries(recs = studyRecs()) {
  const hours = Array(24).fill(0);
  recs.forEach(r => {
    const m = /^(\d{1,2}):(\d{2})/.exec(r.time || '');
    const end = m ? (+m[1]) * 60 + (+m[2]) : ((r.hour | 0) * 60 + 30);
    let left = Math.max(0, r.minutes | 0);
    let cur = ((end - left) % 1440 + 1440) % 1440;
    while (left > 0) {
      const take = Math.min(left, 60 - (cur % 60));
      hours[Math.floor(cur / 60) % 24] += take;
      left -= take;
      cur = (cur + take) % 1440;
    }
  });
  return hours;
}
