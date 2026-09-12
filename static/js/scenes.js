// Escenas de fondo: catálogo fijo + fondos que sube cada usuario (guardados en su cuenta).
import { $, $$, ic, esc, toast, on, emit, api, lsGet, lsSet } from './util.js';
import { S, savePrefs } from './store.js';
import { openMenu } from './ui.js';

// Los ids tienen que coincidir con VALID_SCENES en app.py.
// photo: busca /static/scenes/<id>.jpg; si no existe, la escena se queda con su ambiente de color.
// thumb: hay miniatura /static/scenes/<id>-thumb.jpg para menús y galería.
export const DEFAULT_SCENE = 'road';
export const SCENES = [
  { id: 'road',    label: 'Carretera',  photo: true, thumb: true, c: ['#E8875F', '#B77AA8', '#F2B36F'] },
  { id: 'blossom', label: 'Cerezos',    photo: true, thumb: true, c: ['#E59BC4', '#78B4E4', '#B69AD8'] },
  { id: 'dusk',    label: 'Atardecer',  photo: true, c: ['#FB923C', '#DB2777', '#FBBF24'] },
  { id: 'ocean',   label: 'Océano',     photo: true, c: ['#38BDF8', '#6366F1', '#2DD4BF'] },
  { id: 'forest',  label: 'Bosque',     photo: true, c: ['#4ADE80', '#A3E635', '#2DD4BF'] },
  { id: 'nebula',  label: 'Nebulosa',   c: ['#E879F9', '#A855F7', '#6366F1'] },
  { id: 'none',    label: 'Sin escena', c: ['#A8A29E', '#78716C', '#D6D3D1'] },
];

const MAX_UPLOADS = 6;
const INPUT_MAX_BYTES = 25 * 1024 * 1024;
const SERVER_MAX_BYTES = 4 * 1024 * 1024;
const APPEARANCE_KEY = 'focusdata.appearance';

let photoToken = 0;
let uploading = false;

export function resolveScene(id) {
  if (typeof id === 'string' && id.startsWith('bg:')) {
    const bg = S.backgrounds.find(b => `bg:${b.id}` === id);
    return bg ? { id, label: bg.name, c: bg.colors || [], url: bg.url, thumbUrl: bg.thumb_url, custom: true } : null;
  }
  return SCENES.find(s => s.id === id) || null;
}

// Copia local de la apariencia: se aplica antes de que responda /api/me para que
// no haya un parpadeo de fondo plano al abrir la app (el login también la usa).
export function cacheAppearance() {
  const sc = resolveScene(S.prefs.scene);
  lsSet(APPEARANCE_KEY, {
    theme: S.prefs.theme, accent: S.prefs.accent, scene: S.prefs.scene,
    sceneUrl: sc && sc.url ? sc.url : null, sceneColors: sc ? sc.c : null, sceneLabel: sc ? sc.label : null,
  });
}
export const readAppearance = () => lsGet(APPEARANCE_KEY, null);

export function applyScene(id, cached = null) {
  let sc = resolveScene(id);
  // Un fondo propio aún no cargado (arranque): se usa lo que quedó en caché.
  if (!sc && cached && cached.scene === id && cached.sceneUrl) {
    sc = { id, label: cached.sceneLabel || 'Mi fondo', c: cached.sceneColors || [], url: cached.sceneUrl, custom: true };
  }
  if (!sc) sc = resolveScene(DEFAULT_SCENE);
  S.prefs.scene = sc.id;

  const root = document.documentElement;
  const base = SCENES[0].c;
  ['--s1', '--s2', '--s3'].forEach((v, i) => root.style.setProperty(v, (sc.c && sc.c[i]) || base[i]));
  root.classList.toggle('no-scene', sc.id === 'none');

  const url = sc.url || (sc.photo ? `/static/scenes/${sc.id}.jpg` : null);
  const token = ++photoToken;
  if (!url) {
    root.classList.remove('has-photo');
    root.style.removeProperty('--photo');
  } else {
    const img = new Image();
    img.onload = () => {
      if (token !== photoToken) return;
      root.style.setProperty('--photo', `url("${url}")`);
      root.classList.add('has-photo');
    };
    img.onerror = () => { if (token === photoToken) { root.classList.remove('has-photo'); root.style.removeProperty('--photo'); } };
    img.src = url;
  }

  const label = $('#btn-scene-label');
  if (label) label.textContent = sc.label;
  $$('[data-scene]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scene === sc.id)));
}

export function selectScene(id) {
  applyScene(id);
  cacheAppearance();
  savePrefs({ scene: S.prefs.scene });
}

export async function loadBackgrounds() {
  const { ok, data } = await api('/api/backgrounds');
  if (!ok || !Array.isArray(data)) return;
  S.backgrounds = data;
  emit('backgrounds');
}

// ── Subida: se reduce en el navegador a 2560 px antes de enviarla ──
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}
function toJpeg(img, maxSide, quality) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#202020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}
// Tres colores de la foto (izquierda, centro, derecha), avivados para el anillo.
function photoColors(img) {
  const canvas = document.createElement('canvas');
  canvas.width = 24; canvas.height = 12;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 24, 12);
  const d = ctx.getImageData(0, 0, 24, 12).data;
  const zone = (x0, x1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < 12; y++) for (let x = x0; x < x1; x++) { const i = (y * 24 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return vivid(r / n / 255, g / n / 255, b / n / 255);
  };
  return [zone(0, 8), zone(8, 16), zone(16, 24)];
}
function vivid(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  }
  const sat = s < 0.08 ? 0.1 : Math.max(s, 0.55);
  return `hsl(${Math.round(h) % 360} ${Math.round(sat * 100)}% ${Math.round(Math.min(Math.max(l, 0.52), 0.66) * 100)}%)`;
}

async function uploadBackground(file) {
  if (!file || uploading) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('Ese archivo no es una imagen JPG, PNG o WebP', 'error'); return; }
  if (file.size > INPUT_MAX_BYTES) { toast('La imagen pesa más de 25 MB. Prueba con una más liviana.', 'error'); return; }
  if (S.backgrounds.length >= MAX_UPLOADS) { toast(`Ya tienes ${MAX_UPLOADS} fondos. Elimina uno para subir otro.`, 'error'); return; }
  uploading = true;
  renderGallery();
  try {
    const img = await loadImage(file);
    let blob = await toJpeg(img, 2560, 0.84);
    if (blob && blob.size > SERVER_MAX_BYTES) blob = await toJpeg(img, 2560, 0.7);
    if (blob && blob.size > SERVER_MAX_BYTES) blob = await toJpeg(img, 1920, 0.7);
    if (!blob) throw new Error('encode');
    const thumb = await toJpeg(img, 480, 0.72);
    const name = (file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Mi fondo').slice(0, 40);
    const form = new FormData();
    form.append('file', blob, 'fondo.jpg');
    if (thumb) form.append('thumb', thumb, 'miniatura.jpg');
    form.append('name', name);
    form.append('colors', JSON.stringify(photoColors(img)));
    const { ok, data } = await api('/api/backgrounds', { method: 'POST', form });
    if (!ok) { toast(data.error || 'No se pudo subir el fondo', 'error'); return; }
    S.backgrounds.push(data.background);
    emit('backgrounds');
    selectScene(`bg:${data.background.id}`);
    toast(`Fondo «${data.background.name}» aplicado`);
  } catch {
    toast('No se pudo leer la imagen. Prueba con otro archivo.', 'error');
  } finally {
    uploading = false;
    renderGallery();
  }
}

// Eliminar pide confirmación con un segundo clic sobre el mismo botón.
async function deleteBackground(btn) {
  const id = +btn.dataset.bgDel;
  const label = btn.querySelector('span');
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    label.textContent = '¿Eliminar?';
    btn.setAttribute('aria-label', 'Confirmar: eliminar este fondo');
    clearTimeout(btn._timer);
    btn._timer = setTimeout(() => {
      btn.classList.remove('confirm');
      label.textContent = '';
      btn.setAttribute('aria-label', btn.dataset.label);
    }, 3000);
    return;
  }
  const { ok, data } = await api(`/api/backgrounds/${id}`, { method: 'DELETE' });
  if (!ok) { toast(data.error || 'No se pudo eliminar el fondo', 'error'); return; }
  const bg = S.backgrounds.find(b => b.id === id);
  S.backgrounds = S.backgrounds.filter(b => b.id !== id);
  if (S.prefs.scene === `bg:${id}`) applyScene(data.scene || DEFAULT_SCENE);
  cacheAppearance();
  emit('backgrounds');
  toast(`Fondo «${bg ? bg.name : ''}» eliminado`);
}

function renderGallery() {
  const box = $('#bg-gallery');
  if (!box) return;
  const tile = (id, name, bg, delId) => `
    <div class="bg-tile" style="--sw-bg:${bg}">
      <button type="button" class="bg-pick" data-scene="${esc(id)}" aria-pressed="${S.prefs.scene === id}" aria-label="Usar ${esc(name)}">
        <span class="bg-check">${ic('check', 's12')}</span><span class="bg-name">${esc(name)}</span>
      </button>
      ${delId ? `<button type="button" class="bg-del" data-bg-del="${delId}" data-label="Eliminar ${esc(name)}" aria-label="Eliminar ${esc(name)}">${ic('dismiss', 's12')}<span></span></button>` : ''}
    </div>`;
  box.innerHTML = `
    <div class="bg-grid">
      <button type="button" class="bg-tile bg-add" data-bg-upload ${uploading ? 'disabled' : ''}>
        ${ic('image-add')}<b>${uploading ? 'Subiendo…' : 'Subir imagen'}</b><span>o arrástrala aquí</span>
      </button>
      ${S.backgrounds.map(b => tile(`bg:${b.id}`, b.name, `url('${esc(b.thumb_url)}')`, b.id)).join('')}
      ${SCENES.map(s => tile(s.id, s.label, s.thumb ? `url('/static/scenes/${s.id}-thumb.jpg')` : `linear-gradient(135deg, ${s.c.join(', ')})`)).join('')}
    </div>
    <p class="bg-hint">JPG, PNG o WebP. Se reduce a 2560 px antes de subirla y se guarda en tu cuenta, así la ves en todos tus dispositivos (hasta ${MAX_UPLOADS} fondos). El anillo del temporizador toma los colores de la foto.</p>`;
}

function openSceneMenu(anchor) {
  const items = [
    { type: 'head', label: 'Escenas' },
    ...SCENES.map(s => ({ value: s.id, label: s.label, ...(s.thumb ? { thumb: `/static/scenes/${s.id}-thumb.jpg` } : { color: `linear-gradient(135deg, ${s.c.join(', ')})` }) })),
  ];
  if (S.backgrounds.length) {
    items.push({ type: 'sep' }, { type: 'head', label: 'Tus fondos' },
      ...S.backgrounds.map(b => ({ value: `bg:${b.id}`, label: b.name, thumb: b.thumb_url })));
  }
  items.push({ type: 'sep' },
    { value: '__upload', label: 'Subir fondo…', icon: 'image-add', action: true },
    { value: '__manage', label: 'Gestionar fondos', icon: 'settings', action: true });
  openMenu({
    anchor, value: S.prefs.scene, align: 'end', minWidth: 250, items,
    onSelect: v => {
      if (v === '__upload') $('#bg-file').click();
      else if (v === '__manage') emit('go', 'settings');
      else selectScene(v);
    },
  });
}

export function initScenes() {
  $('#btn-scene').addEventListener('click', e => openSceneMenu(e.currentTarget));
  $('#bg-file').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    uploadBackground(file);
  });
  document.addEventListener('click', e => {
    const del = e.target.closest('[data-bg-del]');
    if (del) { deleteBackground(del); return; }
    if (e.target.closest('[data-bg-upload]')) { $('#bg-file').click(); return; }
    const pick = e.target.closest('[data-scene]');
    if (pick) selectScene(pick.dataset.scene);
  });

  // Arrastrar una imagen sobre la zona principal o sobre la baldosa de subida.
  const zoneOf = e => e.target.closest && e.target.closest('[data-bg-upload], [data-bg-drop]');
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  ['dragenter', 'dragover'].forEach(type => document.addEventListener(type, e => {
    const zone = zoneOf(e);
    if (!zone || !hasFiles(e)) return;
    e.preventDefault();
    zone.classList.add('drag');
  }));
  document.addEventListener('dragleave', e => {
    const zone = zoneOf(e);
    if (zone && !zone.contains(e.relatedTarget)) zone.classList.remove('drag');
  });
  document.addEventListener('drop', e => {
    const zone = zoneOf(e);
    if (!zone) return;
    e.preventDefault();
    $$('.drag').forEach(n => n.classList.remove('drag'));
    uploadBackground(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  on('backgrounds', renderGallery);
  renderGallery();
}
