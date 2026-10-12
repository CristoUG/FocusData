const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function timer(mode = 'pomodoro') {
  let now = 1000000;
  const elements = new Map(), records = [], events = [];
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      style: {}, classList: { remove() {}, toggle() {} },
      setAttribute() {}, addEventListener(name, fn) { this[name] = fn; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    $, $$: () => [], ICONS: '',
    S: { cfg: { work: 25, short: 5, long: 15, cycles: 4 } },
    CFG_LIMITS: {}, on() {}, toast() {},
    logSession: (...args) => records.push(args),
    emit: (...args) => events.push(args),
    document: { addEventListener() {} }, window: {},
    Date: { now: () => now },
    setInterval: () => 1, setTimeout: () => 2,
    clearInterval() {}, clearTimeout() {},
    fmtMin: n => `${n} min`, confirmDialog: async () => true,
  });
  const source = fs.readFileSync(path.join(__dirname, '../static/js/timer.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run(`T.mode = '${mode}'; initTimer()`);
  return { run, $, records, events, advance: seconds => { now += seconds * 1000; } };
}

for (const mode of ['pomodoro', 'cronometro']) {
  test(`${mode}: descanso conserva el trabajo y excluye el tiempo de descanso`, () => {
    const t = timer(mode);
    assert.equal(t.$('#btn-break').hidden, true);
    t.$('#btn-toggle').click(); t.advance(120); t.$('#btn-toggle').click();
    assert.equal(t.$('#btn-break').hidden, false);
    t.$('#btn-break').click();
    assert.equal(t.$('#btn-save').hidden, true);
    assert.equal(t.$('#btn-skip-break').hidden, false);
    t.advance(90); t.$('#btn-toggle').click();
    t.advance(600); t.$('#btn-skip-break').click();
    assert.deepEqual(t.records, [[1, 'Descanso', 'break']]);
    assert.equal(t.run('T.paused'), true);
    assert.equal(t.run('T.cycleCount'), 0);
    assert.equal(t.run('T.session'), 1);
    t.$('#btn-toggle').click(); t.advance(60); t.run('tick()');
    assert.equal(t.run(mode === 'pomodoro' ? 'T.remaining' : 'T.elapsed'), mode === 'pomodoro' ? 1320 : 180);
    if (mode === 'pomodoro') {
      t.advance(1320); t.run('tick()');
      assert.deepEqual(t.records[1], [25, 'General', 'pomodoro']);
    } else {
      t.$('#btn-save').click();
      assert.deepEqual(t.records[1], [3, 'General', 'cronometro']);
    }
  });

  test(`${mode}: terminar descanso avisa una vez y permite otro descanso`, () => {
    const t = timer(mode);
    t.run('start()'); t.advance(60); t.run('pause(); startBreak()');
    t.advance(300); t.run('tick(); tick()');
    assert.deepEqual(t.records, [[5, 'Descanso', 'break']]);
    assert.equal(t.run('T.phase'), 'work');
    assert.equal(t.run('T.paused'), true);
    assert.equal(t.events.filter(e => e[0] === 'phase-end').length, 1);
    t.run('startBreak(); skipBreak()');
    assert.equal(t.records.length, 1);
    assert.equal(t.run(mode === 'pomodoro' ? 'T.remaining' : 'T.elapsed'), mode === 'pomodoro' ? 1440 : 60);
  });
}

for (const cycles of [1, 4]) {
  test(`saltar descanso normal con ${cycles} ciclos no registra minutos no descansados`, () => {
    const t = timer();
    t.run(`S.cfg.cycles = ${cycles}; start()`); t.advance(1500); t.run('tick()');
    assert.equal(t.run('T.phase'), cycles === 1 ? 'long' : 'short');
    t.run('skipBreak(); skipBreak()');
    assert.deepEqual(t.records, [[25, 'General', 'pomodoro']]);
    assert.equal(t.run('T.session'), 2);
    assert.equal(t.run('T.cycleCount'), 1);
    assert.equal(t.run('T.remaining'), 1500);
  });
}

test('reiniciar o cambiar de modo descarta el descanso suspendido', async () => {
  const t = timer();
  t.run('start()'); t.advance(60); t.run('pause(); startBreak(); resetTimer()');
  assert.equal(t.run('T.suspendedWork'), null);
  assert.equal(t.$('#btn-skip-break').hidden, true);
  t.run('start()'); t.advance(60); t.run('pause(); startBreak()');
  await t.run("setMode('cronometro')");
  assert.equal(t.run('T.suspendedWork'), null);
  assert.equal(t.run('T.elapsed'), 0);
});

test('pausar al vencer el trabajo y saltar al vencer el descanso no duplica registros', () => {
  const t = timer();
  t.run('start()'); t.advance(1500); t.run('pause()');
  assert.equal(t.run('T.phase'), 'short');
  t.run('start()'); t.advance(300); t.run('skipBreak()');
  assert.deepEqual(t.records, [[25, 'General', 'pomodoro'], [5, 'Descanso', 'break']]);
  assert.equal(t.run('T.session'), 2);
});
