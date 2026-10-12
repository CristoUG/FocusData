const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function store(response) {
  const calls = [], events = [], cache = new Map();
  const ctx = vm.createContext({
    api: async (...args) => { calls.push(args); return response; },
    emit: event => events.push(event), toast() {},
    localStorage: { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) },
  });
  const src = fs.readFileSync(path.join(__dirname, '../static/js/store.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(src, ctx);
  const run = code => vm.runInContext(code, ctx);
  run(`initStorage(1); S.db = [
    {remote_id: 1, ts: 'a', type: 'Original', minutes: 25, category_id: 1},
    {remote_id: 2, ts: 'b', type: 'Original', minutes: 15, category_id: 1}
  ]`);
  return { run, calls, events, cache };
}

test('editar actualiza una sola sesión y persiste la caché', async () => {
  const t = store({ ok: true, data: { type: 'Nuevo', category_id: 2, category_name: 'Destino' } });
  assert.equal(await t.run("updateSession('a', {type: 'Nuevo', category_id: 2})"), true);
  assert.equal(t.run('S.db[0].type'), 'Nuevo');
  assert.equal(t.run('S.db[0].minutes'), 25);
  assert.equal(t.run('S.db[1].type'), 'Original');
  assert.equal(JSON.parse(t.cache.get('studylog_v1_u1'))[0].category_id, 2);
  assert.deepEqual(t.events, ['sessions']);
});

test('fallos de conexión conservan los datos locales', async () => {
  const t = store({ ok: false, status: 0, data: { error: 'Sin conexión' } });
  assert.equal(await t.run("updateSession('a', {type: 'Nuevo'})"), false);
  assert.equal(await t.run("deleteSession('a')"), false);
  assert.equal(t.run('S.db.length'), 2);
  assert.equal(t.run('S.db[0].type'), 'Original');
  assert.equal(t.events.length, 0);
});

for (const status of [200, 404]) {
  test(`eliminar con respuesta ${status} quita solo la sesión correspondiente`, async () => {
    const t = store({ ok: status === 200, status, data: {} });
    assert.equal(await t.run("deleteSession('a')"), true);
    assert.equal(t.run('S.db.length'), 1);
    assert.equal(t.run('S.db[0].ts'), 'b');
    assert.equal(JSON.parse(t.cache.get('studylog_v1_u1')).length, 1);
    assert.deepEqual(t.events, ['sessions']);
  });
}

test('sesión pendiente de sincronizar no envía cambios ni borrados', async () => {
  const t = store({ ok: true, data: {} });
  t.run('delete S.db[0].remote_id');
  assert.equal(await t.run("updateSession('a', {type: 'Nuevo'})"), false);
  assert.equal(await t.run("deleteSession('a')"), false);
  assert.equal(t.calls.length, 0);
});
