// Estado de la app, caché local del historial y sincronización con el backend.
import { api, emit, toast, localDateStr, localISOString, localTimeStr, lsGet, lsSet } from './util.js';

export const S = {
  user: null,                 // { id, username }
  db: [],                     // sesiones (incluye descansos)
  categories: [],             // preorden, con depth y path
  activeCategoryId: null,     // carpeta donde se guardan las sesiones nuevas
  filterCategoryId: '',       // filtro de Estadísticas y Registro ('' = todas)
  prefs: { theme: 'dark', accent: '#3b82f6', scene: 'road' },
  backgrounds: [],            // fondos subidos: [{ id, name, colors, url, thumb_url }]
  cfg: { work: 25, short: 5, long: 15, cycles: 4 },
};

// ── Historial en caché, con clave propia por usuario ──
// Compartir una clave global filtraba sesiones entre cuentas del mismo navegador.
const LEGACY_STORAGE_KEY = 'studylog_v1';
let storageKey = null;

export function initStorage(uid) {
  storageKey = `studylog_v1_u${uid}`;
  const own = localStorage.getItem(storageKey);
  if (own !== null) {
    try { S.db = JSON.parse(own) || []; } catch { S.db = []; }
    return;
  }
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy !== null) {
    localStorage.setItem('studylog_v1_backup', legacy);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  S.db = [];
}
export function saveDb() {
  if (storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(S.db)); } catch { /* cuota llena */ } }
}

// ── Carpetas ──
export const categoryById = id => S.categories.find(c => c.id === +id);
export const liveCategories = () => S.categories.filter(c => !c.archived);

// IDs de una carpeta y todos sus descendientes (con tope por si hubiera datos corruptos).
export function descendantIds(id) {
  const out = new Set([+id]);
  let changed = true, rounds = 0;
  while (changed && rounds++ < 100) {
    changed = false;
    S.categories.forEach(c => {
      if (out.has(+c.parent_id) && !out.has(+c.id)) { out.add(+c.id); changed = true; }
    });
  }
  return out;
}

// Filtrar por una carpeta incluye las sesiones de todas sus subcarpetas.
export function filteredDb() {
  if (!S.filterCategoryId) return S.db;
  const ids = descendantIds(S.filterCategoryId);
  return S.db.filter(r => ids.has(+r.category_id));
}
export const studyRecs = () => filteredDb().filter(r => r.mode !== 'break');

// Minutos de estudio por carpeta, sumando las subcarpetas (para el árbol).
export function minutesByFolder() {
  const own = {};
  S.db.forEach(r => { if (r.mode !== 'break') own[+r.category_id] = (own[+r.category_id] || 0) + r.minutes; });
  const total = {};
  S.categories.forEach(c => {
    let sum = 0;
    descendantIds(c.id).forEach(id => { sum += own[id] || 0; });
    total[c.id] = sum;
  });
  return total;
}

export async function loadCategories() {
  const { ok, data } = await api('/api/categories');
  if (!ok || !Array.isArray(data)) return;
  S.categories = data;
  if (S.filterCategoryId && !categoryById(S.filterCategoryId)) S.filterCategoryId = '';
  const active = categoryById(S.activeCategoryId);
  if (!active || active.archived) {
    const first = liveCategories()[0];
    S.activeCategoryId = first ? first.id : null;
  }
  emit('categories');
}

export function setActiveCategory(id) {
  S.activeCategoryId = +id;
  emit('active');
  api('/api/preferences', { method: 'POST', body: { active_category_id: S.activeCategoryId } })
    .then(r => { if (!r.ok) toast(r.data.error || 'No se pudo guardar la carpeta activa', 'error'); });
}

export function setFilter(id) {
  S.filterCategoryId = id === '' || id == null ? '' : +id;
  emit('filter');
}

// ── Sesiones ──
const sessionKey = r => r.ts || `${r.date}|${r.time}|${r.minutes}|${r.type}|${r.mode}`;
const sessionTime = r => new Date(r.ts || `${r.date}T${r.time || '00:00'}`).getTime() || 0;

export function logSession(minutes, type, mode) {
  const now = new Date();
  const cat = categoryById(S.activeCategoryId);
  const session = {
    id: Date.now(), date: localDateStr(now), hour: now.getHours(),
    time: localTimeStr(now),
    minutes, type, mode, ts: localISOString(now),
    category_id: S.activeCategoryId, category_name: cat ? cat.name : '',
  };
  S.db.push(session);
  saveDb();
  emit('sessions');
  api('/api/sessions', {
    method: 'POST',
    body: { minutes, type, mode, date: session.date, hour: session.hour, time: session.time, ts: session.ts, category_id: S.activeCategoryId },
  }).then(r => {
    if (r.ok && r.data && r.data.id != null) {
      // Se confirma al instante: si otro dispositivo borra el historial antes
      // de la próxima sincronización, syncSessions() ya no la reenvía.
      session.remote_id = r.data.id;
      saveDb();
      emit('sessions');
    } else if (!r.ok && r.status !== 0) {
      toast(r.data.error || 'No se pudo guardar la sesión en el servidor', 'error');
    }
  });
}

// Backend = fuente de verdad; se conservan los registros locales aún no subidos.
export async function syncSessions() {
  const { ok, data: remote } = await api('/api/sessions?include_breaks=1');
  if (!ok || !Array.isArray(remote)) return;
  remote.forEach(r => { r.remote_id = r.id; });
  const seen = new Set(remote.map(sessionKey));
  // Un registro local que no está en el servidor y YA tenía remote_id fue
  // borrado desde otro dispositivo (Borrar historial o eliminar carpeta):
  // se descarta, no se reenvía. Solo se reintentan los que nunca se
  // confirmaron (sin remote_id): esos sí podrían haberse perdido por un
  // fallo de red y hay que insistir.
  const localOnly = S.db.filter(r => !seen.has(sessionKey(r)) && r.remote_id == null);
  localOnly.forEach(r => {
    if (!r.ts) r.ts = `${r.date}T${r.time || '00:00'}:00`;
    api('/api/sessions', {
      method: 'POST',
      body: { minutes: r.minutes, type: r.type, mode: r.mode, date: r.date, hour: r.hour, time: r.time, ts: r.ts, category_id: r.category_id },
    }).then(res => {
      if (res.ok && res.data && res.data.id != null) {
        r.remote_id = res.data.id;
        saveDb();
        emit('sessions');
      }
    });
  });
  S.db = [...remote, ...localOnly].sort((a, b) => sessionTime(a) - sessionTime(b));
  saveDb();
  emit('sessions');
}

// Actualiza una sesión ya registrada en el servidor: moverla de carpeta, renombrarla
// (campo `type`), o ambas cosas en la misma llamada. Solo funciona si el servidor ya
// la confirmó (remote_id); antes de eso no existe ahí para editarla.
async function patchSession(ts, patch) {
  const rec = S.db.find(r => r.ts === ts);
  if (!rec) return null;
  if (rec.remote_id == null) {
    toast('Se podrá editar cuando se sincronice', 'error');
    return null;
  }
  const { ok, data } = await api(`/api/sessions/${rec.remote_id}`, { method: 'PATCH', body: patch });
  if (!ok) { toast(data.error || 'No se pudo actualizar la sesión', 'error'); emit('sessions'); return null; }
  rec.category_id = data.category_id;
  rec.category_name = data.category_name;
  rec.type = data.type;
  saveDb();
  emit('sessions');
  return data;
}

export async function reassignSession(ts, catId) {
  const data = await patchSession(ts, { category_id: +catId });
  if (data) toast(`Sesión movida a ${data.category_name}`);
}

export async function renameSession(ts, type) {
  const data = await patchSession(ts, { type });
  if (data) toast('Sesión renombrada');
}

// Renombra (o fusiona, si `to` ya existe) un tema en TODO el historial de una vez.
export async function renameType(from, to) {
  const merging = S.db.some(r => r.mode !== 'break' && r.type === to);
  const { ok, data } = await api('/api/sessions/rename-type', { method: 'POST', body: { from, to } });
  if (!ok) { toast(data.error || 'No se pudo renombrar el tema', 'error'); return false; }
  // Se aplica también a las sesiones locales aún no sincronizadas: al subirse
  // llegarán ya con el nombre nuevo, sin esperar a la próxima sincronización.
  S.db.forEach(r => { if (r.mode !== 'break' && r.type === from) r.type = to; });
  saveDb();
  emit('sessions');
  // Aparte de refrescar el historial, avisa a quien tenga ese nombre escrito en algún
  // sitio (la portada, un filtro) para que lo actualice sin que el usuario lo note.
  emit('type-renamed', { from, to });
  toast(merging ? `Fusionado con «${to}»` : `Tema renombrado a «${to}»`);
  return true;
}

export async function deleteSession(ts) {
  const rec = S.db.find(r => r.ts === ts);
  if (!rec) return;
  if (rec.remote_id == null) {
    // Nunca llegó a confirmarse en el servidor: basta con quitarla en local.
    S.db = S.db.filter(r => r !== rec);
    saveDb();
    emit('sessions');
    return;
  }
  const { ok, status, data } = await api(`/api/sessions/${rec.remote_id}`, { method: 'DELETE' });
  // Un 404 significa que ya no existe en el servidor (p. ej. borrada desde otro
  // dispositivo): se quita igual en local. Un fallo de red (status 0) no debe
  // quitarla, o syncSessions() ya no la reenviaría.
  if (!ok && status !== 404) {
    toast(data.error || 'No se pudo eliminar la sesión', 'error');
    return;
  }
  S.db = S.db.filter(r => r !== rec);
  saveDb();
  toast('Sesión eliminada');
  emit('sessions');
}

export async function clearHistory() {
  const { ok, data } = await api('/api/sessions/all', { method: 'DELETE' });
  if (!ok) { toast(data.error || 'No se pudieron borrar los registros', 'error'); return false; }
  S.db = [];
  saveDb();
  emit('sessions');
  toast('Historial borrado');
  return true;
}

// ── Preferencias ──
export function savePrefs(partial) {
  return api('/api/preferences', { method: 'POST', body: partial })
    .then(r => { if (!r.ok) toast(r.data.error || 'No se pudo guardar la preferencia', 'error'); return r; });
}

// Tiempos del Pomodoro: se recuerdan en este navegador.
const CFG_KEY = 'focusdata.pomodoro';
export const CFG_LIMITS = {
  work:   { min: 5,  max: 60, step: 5, label: 'Trabajo', unit: ' min' },
  short:  { min: 1,  max: 15, step: 1, label: 'Descanso corto', unit: ' min' },
  long:   { min: 10, max: 30, step: 5, label: 'Descanso largo', unit: ' min' },
  cycles: { min: 2,  max: 6,  step: 1, label: 'Ciclos hasta el descanso largo', unit: '' },
};
export const CFG_DEFAULT = { work: 25, short: 5, long: 15, cycles: 4 };
export function loadCfg() {
  const saved = lsGet(CFG_KEY, null);
  if (saved && typeof saved === 'object') {
    Object.keys(CFG_LIMITS).forEach(k => {
      const v = +saved[k], L = CFG_LIMITS[k];
      if (Number.isFinite(v) && v >= L.min && v <= L.max) S.cfg[k] = v;
    });
  }
}
export function setCfg(key, value) {
  const L = CFG_LIMITS[key];
  const v = Math.min(L.max, Math.max(L.min, Math.round(+value || 0)));
  S.cfg[key] = v;
  lsSet(CFG_KEY, S.cfg);
  emit('cfg', key);
}
