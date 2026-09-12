// Estadísticas: indicadores, calendario, distribución por tema y gráficos de columnas.
import { $, $$, ic, esc, on, fmtMin, fmtHours, localDateStr, daysAgoStr, DAY_SHORT, MONTH_SHORT } from './util.js';
import { S, studyRecs, categoryById } from './store.js';
import { minutesByDate, computeStreaks, computeIRS, computeRDA, sumMinutes, sumBetween, hoursSeries } from './metrics.js';

let visible = false;
const series = { week: [], weekDates: [], hour: [] };

const kpi = (icon, label, val, sub) =>
  `<div class="kpi"><div class="kpi-label">${ic(icon)}${label}</div><div class="kpi-val">${val}</div><div class="kpi-sub">${sub}</div></div>`;

// ── Columnas SVG: extremo redondeado arriba, base recta; se resalta lo importante ──
const px = n => n.toFixed(1);
function colPath(x, y, w, base, rad = 4) {
  const r = Math.min(rad, w / 2, base - y);
  return `M${px(x)} ${base}V${px(y + r)}Q${px(x)} ${px(y)} ${px(x + r)} ${px(y)}H${px(x + w - r)}Q${px(x + w)} ${px(y)} ${px(x + w)} ${px(y + r)}V${base}Z`;
}
function columnsSVG(o) {
  const { vals, w, h, ticks } = o, L = 40, R = 6, T = 24, B = 26;
  const pw = w - L - R, ph = h - T - B, top = ticks[ticks.length - 1];
  const step = pw / vals.length, bw = Math.min(o.maxBar || 24, Math.max(6, step * (o.barRatio || 0.55))), base = T + ph;
  const y = v => T + ph - (Math.min(v, top) / top) * ph;
  let s = `<svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.aria)}">`, labels = '';
  ticks.forEach(g => {
    s += `<line class="grid-l" x1="${L}" x2="${w - R}" y1="${px(y(g))}" y2="${px(y(g))}"/><text x="${L - 8}" y="${px(y(g) + 4)}" text-anchor="end">${o.tickFmt ? o.tickFmt(g) : g}</text>`;
  });
  vals.forEach((v, i) => {
    const x = L + step * i + (step - bw) / 2, cx = x + bw / 2, hi = o.hi(i, v);
    s += `<g class="col"${o.focus ? ' tabindex="0"' : ''} data-tip="${esc(o.tip(i, v))}"><rect class="hit" x="${px(L + step * i)}" y="${T}" width="${px(step)}" height="${ph + B}"/>`
      + (v > 0 ? `<path class="bar${hi ? ' hi' : ''}" d="${colPath(x, y(v), bw, base, o.radius)}"/>` : '') + '</g>';
    const lab = o.label(i, v);
    if (lab) labels += `<text class="val" x="${px(cx)}" y="${px(y(v) - 7)}" text-anchor="middle">${lab}</text>`;
    const xl = o.xLabel(i);
    if (xl) labels += `<text${hi ? ' class="val"' : ''} x="${px(cx)}" y="${h - 8}" text-anchor="middle">${xl}</text>`;
  });
  return s + labels + '</svg>';
}

// Escala limpia: el paso se elige para dejar entre 2 y 4 tramos; en horas si el paso es de 1 h o más.
const SCALE_STEPS = [15, 30, 60, 120, 180, 300, 600, 1200, 1800, 3000, 6000, 12000];
function niceScale(max) {
  const step = SCALE_STEPS.find(s => max / s <= 4) || SCALE_STEPS[SCALE_STEPS.length - 1];
  const top = Math.max(step * 2, Math.ceil(max / step) * step);
  const ticks = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { ticks, tickFmt: v => (step >= 60 ? `${+(v / 60).toFixed(1)} h` : String(v)) };
}
const clock = h => `${String(h % 24).padStart(2, '0')}:00`;

function weekSVG(w) {
  const vals = series.week, max = Math.max(0, ...vals);
  const { ticks, tickFmt } = niceScale(max);
  return columnsSVG({
    vals, w, h: 200, ticks, tickFmt, focus: true, maxBar: 64, barRatio: 0.5, radius: 6,
    aria: 'Minutos estudiados por día en los últimos 7 días',
    hi: i => i === 6,
    xLabel: i => (i === 6 ? 'hoy' : DAY_SHORT[new Date(series.weekDates[i] + 'T00:00:00').getDay()]),
    tip: (i, v) => {
      const d = new Date(series.weekDates[i] + 'T00:00:00');
      return `${fmtMin(v)}|${i === 6 ? 'Hoy' : `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`}`;
    },
    label: (i, v) => (v > 0 && (i === 6 || v === max) ? fmtMin(v) : ''),
  });
}

function hourSVG(w) {
  const vals = series.hour, max = Math.max(0, ...vals);
  const { ticks, tickFmt } = niceScale(max);
  return columnsSVG({
    vals, w, h: 200, ticks, tickFmt, focus: false,
    aria: 'Tiempo estudiado en cada hora del día',
    hi: (i, v) => v > 0 && v === max,
    xLabel: i => (i % 3 === 0 ? clock(i) : ''),
    tip: (i, v) => `${fmtMin(v)}|de ${clock(i)} a ${clock(i + 1)}`,
    label: (i, v) => (v > 0 && v === max ? fmtMin(v) : ''),
  });
}

// Los gráficos se dibujan al ancho real de su tarjeta: el texto nunca se escala.
function draw(el) {
  const w = Math.floor(el.clientWidth);
  if (!w) return;
  const empty = !series.week.some(v => v > 0) && el.dataset.chart === 'week'
    || !series.hour.some(v => v > 0) && el.dataset.chart === 'hour';
  if (empty) { el.innerHTML = `<div class="empty">${ic('stats')}Aún no hay sesiones en este periodo</div>`; return; }
  el.innerHTML = el.dataset.chart === 'week' ? weekSVG(w) : hourSVG(w);
}
const ro = 'ResizeObserver' in window ? new ResizeObserver(entries => entries.forEach(e => draw(e.target))) : null;

// ── Colores por tipo: siguen al tipo (por su total histórico), nunca al puesto filtrado ──
function typeColors() {
  const totals = {};
  S.db.forEach(r => { if (r.mode !== 'break' && r.type) totals[r.type] = (totals[r.type] || 0) + r.minutes; });
  const order = Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0]);
  const map = {};
  order.forEach((t, i) => { map[t] = i < 8 ? `var(--cat-${i + 1})` : 'var(--cat-other)'; });
  return map;
}

function donutHTML(recs) {
  const totals = {};
  recs.forEach(r => { totals[r.type] = (totals[r.type] || 0) + r.minutes; });
  let entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = sumMinutes(recs);
  if (!total) return `<div class="empty">${ic('stats')}Aún no hay sesiones registradas</div>`;
  const colors = typeColors();
  // Una dona se lee bien con pocas porciones: el resto se agrupa en "Otros".
  if (entries.length > 6) {
    const rest = entries.slice(5).reduce((a, e) => a + e[1], 0);
    entries = [...entries.slice(0, 5).map(([t, m]) => [t, m, colors[t]]), ['Otros', rest, 'var(--cat-other)']];
  } else {
    entries = entries.map(([t, m]) => [t, m, colors[t]]);
  }
  const r = 66, gap = entries.length > 1 ? 2 / (2 * Math.PI * r) * 100 : 0;
  let acc = 0, segs = '', legend = '';
  entries.forEach(([name, m, color]) => {
    const pct = m / total * 100, len = Math.max(pct - gap, 0.05), p = Math.round(pct);
    segs += `<circle class="seg" cx="80" cy="80" r="${r}" pathLength="100" style="stroke:${color}" stroke-dasharray="${len.toFixed(2)} ${(100 - len).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" tabindex="0" data-tip="${esc(`${fmtMin(m)} · ${p}%|${name}`)}"/>`;
    legend += `<div class="lg-row"><span class="lg-sw" style="--c:${color}"></span><span class="lg-name" title="${esc(name)}">${esc(name)}</span><span class="lg-v">${fmtHours(m)}</span><span class="lg-p">${p}%</span></div>`;
    acc += pct;
  });
  return `<div class="donut"><div class="donut-fig"><svg viewBox="0 0 160 160" role="img" aria-label="Distribución del tiempo por tema">${segs}</svg><div class="donut-c"><b>${fmtHours(total)}</b><span>en total</span></div></div><div class="lg">${legend}</div></div>`;
}

function heatHTML(recs) {
  const byDate = minutesByDate(recs);
  const WEEKS = 26;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = new Date(today); start.setDate(today.getDate() - mondayOffset - (WEEKS - 1) * 7);
  const level = m => (m <= 0 ? 0 : m < 25 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4);
  let out = '', prevMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const wd = new Date(start); wd.setDate(start.getDate() + w * 7);
    const month = wd.getMonth();
    let lab = month !== prevMonth ? MONTH_SHORT[month] : '';
    if (w === 0 && wd.getDate() > 24) lab = '';
    prevMonth = month;
    out += `<span class="m">${lab}</span>`;
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start); cur.setDate(start.getDate() + w * 7 + d);
      if (cur > today) { out += '<span class="c fut"></span>'; continue; }
      const m = byDate[localDateStr(cur)] || 0, l = level(m);
      out += `<span class="c${l ? ' l' + l : ''}" data-tip="${m ? fmtMin(m) : 'Sin estudio'}|${DAY_SHORT[cur.getDay()]} ${cur.getDate()} ${MONTH_SHORT[cur.getMonth()]}"></span>`;
    }
  }
  return out;
}

function render() {
  const recs = studyRecs();
  const today = localDateStr();
  const week = sumBetween(recs, daysAgoStr(6));
  const prevWeek = sumBetween(recs, daysAgoStr(13), daysAgoStr(7));
  const total = sumMinutes(recs);
  const todayRecs = recs.filter(r => r.date === today);
  const streak = computeStreaks(recs);
  const irs = computeIRS(recs);
  const rda = computeRDA();
  const pomo = sumMinutes(recs.filter(r => r.mode === 'pomodoro'));

  let delta = 'sin datos de la semana anterior';
  if (prevWeek > 0) {
    const d = Math.round((week - prevWeek) / prevWeek * 100);
    delta = d === 0 ? 'igual que la semana anterior'
      : `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.abs(d)}%</span> vs. semana anterior`;
  }
  const rdaHint = rda.brk === 0 ? 'sin descansos registrados' : rda.ratio < 15 ? 'bajo · meta ~20%' : rda.ratio <= 30 ? 'en el rango ideal' : 'alto · meta ~20%';

  $('#kpis').innerHTML = [
    kpi('trend', 'Esta semana', fmtMin(week), delta),
    kpi('clock', 'Hoy', fmtMin(sumMinutes(todayRecs)), `${todayRecs.length} ${todayRecs.length === 1 ? 'sesión' : 'sesiones'}`),
    kpi('fire', 'Racha', `${streak.current} ${streak.current === 1 ? 'día' : 'días'}`, `máx. ${streak.max} ${streak.max === 1 ? 'día' : 'días'}`),
    kpi('target', 'Regularidad', `${irs.pct}%`, `${irs.active} de 7 días con 20+ min`),
    kpi('history', 'Total estudiado', fmtHours(total), 'en todo tu historial'),
    kpi('table', 'Sesiones', String(recs.length), 'de estudio registradas'),
    kpi('coffee', 'Descanso activo', `${rda.ratio}%`, rdaHint),
    kpi('timer', 'Enfoque Pomodoro', `${total ? Math.round(pomo / total * 100) : 0}%`, 'del tiempo estudiado'),
  ].join('');

  $('#heat').innerHTML = heatHTML(recs);
  $('#donut').innerHTML = donutHTML(recs);

  series.weekDates = [6, 5, 4, 3, 2, 1, 0].map(daysAgoStr);
  const byDate = minutesByDate(recs);
  series.week = series.weekDates.map(d => byDate[d] || 0);
  series.hour = hoursSeries(recs);
  $$('[data-chart]').forEach(draw);

  const hmax = Math.max(0, ...series.hour);
  const peaks = series.hour.map((v, i) => (v > 0 && v === hmax ? `${clock(i)}–${clock(i + 1)}` : null)).filter(Boolean);
  $('#hour-peak').textContent = peaks.length
    ? `tu franja más productiva: ${peaks.slice(0, 2).join(' y ')}`
    : 'tiempo por hora del día';
}

function renderSub() {
  const cat = categoryById(S.filterCategoryId);
  $('#stats-sub').textContent = cat ? `Filtrado por ${cat.path}` : 'Todas las carpetas';
}

export function setStatsVisible(v) {
  visible = v;
  if (v) render();
}

export function initStats() {
  if (ro) $$('[data-chart]').forEach(el => ro.observe(el));
  on('sessions', () => visible && render());
  on('filter', () => { renderSub(); if (visible) render(); });
  on('categories', renderSub);
}
