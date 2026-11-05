// B2B KPI 탭 계산(b2b-kpi-calc.js) — 실제 KPI 실적과 업무 관리점수를 분리하고, 미측정·미배정을 0점으로 치지 않는다
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-calc.js', 'utf8'), ctx);
const C = ctx.module.exports;
const F = require('./b2b-kpi.fixture.cjs');
const r1 = v => Math.round(v * 10) / 10;
const M = '2026-11';

test('kpiActual_uses_auto_first', () => {
  const a = C.kpiActual(F.base(), M);
  const k1 = a.rows.find(r => r.id === 'MK1');
  assert.equal(r1(k1.rate), 17.6);
  assert.equal(r1(k1.ach), 29.4);
  assert.equal(r1(a.rows.find(r => r.id === 'MK2').ach), 73.5);
  assert.equal(r1(a.rows.find(r => r.id === 'MK3').ach), 5.4);
  assert.ok(Math.abs(a.value - 36.1) < 0.05);
  assert.equal(k1.target, 60); assert.equal(k1.base, 50); assert.equal(k1.challenge, 70);
});
test('kpiActual_missing_kpi_excluded', () => {
  const s = F.base(); delete s.perfAuto['MK3_2026-11'];
  const a = C.kpiActual(s, M);
  assert.equal(a.measured, 2);
  assert.equal(a.rows.find(r => r.id === 'MK3').state, 'none');
  assert.ok(Math.abs(a.value - (29.41 + 73.53) / 2) < 0.05);
});
test('kpiActual_none_is_null', () => {
  const s = F.base(); s.perfAuto = {}; s.perfMonthly = {};
  const a = C.kpiActual(s, M);
  assert.equal(a.value, null); assert.equal(a.measured, 0);
});
test('personScore_measured_only', () => {
  const p = C.personScore(F.base(), 'shs', M);
  assert.equal(p.state, 'ok');
  assert.equal(r1(p.value), 83.3);
  assert.equal(p.measured, 1); assert.equal(p.total, 9);
  assert.equal(p.rows.filter(r => r.state === 'none').length, 8);
  assert.deepEqual(Array.from(p.measuredIds), ['LI01']);
  assert.equal(p.rows.find(r => r.id === 'LI01').auto, true);
});
test('personScore_target_scales_and_caps', () => {
  const s = F.base();
  s.perfMonthly['LI02_2026-11'] = { num: 9, den: 10 }; s.leadDefs.LI02.target = 80;
  s.perfMonthly['LI03_2026-11'] = { num: 1, den: 2 };
  const p = C.personScore(s, 'shs', M);
  assert.equal(p.rows.find(r => r.id === 'LI02').score, 100);
  assert.equal(p.rows.find(r => r.id === 'LI03').score, 50);
});
test('personScore_cardWeight', () => {
  const s = F.base(); s.perfAuto = {};
  s.perfMonthly['LI02_2026-11'] = { num: 1, den: 1 }; s.perfMonthly['LI03_2026-11'] = { num: 1, den: 2 };
  assert.equal(C.personScore(s, 'shs', M).value, 75);
  s.leadDefs.LI02.cardWeight = 75; s.leadDefs.LI03.cardWeight = 25;
  assert.equal(C.personScore(s, 'shs', M).value, 87.5);
});
test('personScore_zero_measured_is_wait', () => {
  const s = F.base(); s.perfAuto = {};
  const p = C.personScore(s, 'shs', M);
  assert.equal(p.state, 'wait'); assert.equal(p.value, null); assert.equal(p.measured, 0);
});
test('personScore_no_defs', () => {
  const p = C.personScore(F.base(), 'm2', M);
  assert.equal(p.state, 'nodefs'); assert.equal(p.value, null); assert.equal(p.total, 0);
});
test('personScore_empty_den_excluded', () => {
  const s = F.base(); s.perfMonthly['LI02_2026-11'] = { num: 0, den: 0 };
  const p = C.personScore(s, 'shs', M);
  assert.equal(p.measured, 1);
  assert.equal(p.rows.find(r => r.id === 'LI02').state, 'empty');
  assert.equal(r1(p.value), 83.3);
});
test('tasks_progress_counts', () => {
  const s = F.base(); s.perfMonthly['LI01_2026-11'] = { prog: { t1: 100, t2: 50 }, checks: { t3: true } };
  const t = C.personScore(s, 'shs', M).rows.find(r => r.id === 'LI01').tasks;
  assert.deepEqual({ ...t }, { done: 2, doing: 1, todo: 1, total: 4 });
});
test('measuredChanged', () => {
  assert.equal(C.measuredChanged(['A'], ['A', 'B']), true);
  assert.equal(C.measuredChanged(['B', 'A'], ['A', 'B']), false);
});
