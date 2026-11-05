// B2B KPI 탭 저장(b2b-kpi-store.js) — 업무트래커 저장소에 허용된 위치만 PATCH, 충돌·이미 있음은 쓰지 않는다
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-store.js', 'utf8'), ctx);
const S = ctx.module.exports;
const F = require('./b2b-kpi.fixture.cjs');
const BASE = 'http://mock/shared/b2bOpsTracker';
const ALLOWED = ['members/', 'leadDefs/', 'lagDefs/', 'perfMonthly/', 'perfHistory/', 'kpiTeamChecks/', 'kpiTabConfig'];
const allPatches = [];
function fake(responses){
  const calls = [];
  const fetch = async (url, opt) => {
    opt = opt || {}; calls.push({ url, method: opt.method || 'GET', body: opt.body ? JSON.parse(opt.body) : null });
    if(opt.method === 'PATCH'){ allPatches.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({}) }; }
    const r = responses[url];
    if(r && r.status) return { ok: false, status: r.status, json: async () => null };
    return { ok: true, status: 200, json: async () => (r === undefined ? null : r) };
  };
  return { calls, store: S.createStore({ fetch, base: BASE }) };
}
const patches = calls => calls.filter(c => c.method === 'PATCH');

test('read_ok', async () => {
  const { store } = fake({ [BASE + '.json']: { members: {} } });
  assert.deepEqual(await store.read(), { members: {} });
});
test('read_fail', async () => {
  const { store } = fake({ [BASE + '.json']: { status: 500 } });
  await assert.rejects(store.read(), /HTTP 500/);
});
test('saveDef_new', async () => {
  const { calls, store } = fake({});
  const r = await store.saveDef('leadDefs', { id: 'LI-m3-1', rev: 0 }, null);
  assert.equal(r.ok, true);
  const p = patches(calls); assert.equal(p.length, 1); assert.equal(p[0].url, BASE + '.json');
  assert.deepEqual(Object.keys(p[0].body), ['leadDefs/LI-m3-1']);
});
test('saveDef_exists', async () => {
  const { calls, store } = fake({ [BASE + '/leadDefs/LI-m3-1.json']: { id: 'LI-m3-1', rev: 0 } });
  const r = await store.saveDef('leadDefs', { id: 'LI-m3-1', rev: 0 }, null);
  assert.deepEqual({ ...r }, { ok: false, reason: 'exists' }); assert.equal(patches(calls).length, 0);
});
test('saveDef_conflict', async () => {
  const { calls, store } = fake({ [BASE + '/leadDefs/LI01.json']: { id: 'LI01', rev: 3 } });
  const r = await store.saveDef('leadDefs', { id: 'LI01', rev: 3 }, 2);
  assert.deepEqual({ ...r }, { ok: false, reason: 'conflict' }); assert.equal(patches(calls).length, 0);
});
test('saveDef_edit_ok', async () => {
  const { calls, store } = fake({ [BASE + '/leadDefs/LI01.json']: { id: 'LI01' } });
  const r = await store.saveDef('leadDefs', { id: 'LI01', rev: 1 }, 0);
  assert.equal(r.ok, true); assert.equal(patches(calls).length, 1);
});
test('setTaskProg_shape', async () => {
  const s = F.base(); s.perfMonthly['LI01_2026-11'] = { id: 'LI01_2026-11', num: 3, den: 5, prog: { t1: 50 }, checks: { t2: true, t3: true }, rev: 1 };
  const { calls, store } = fake({ [BASE + '/perfMonthly/LI01_2026-11.json']: F.clone(s.perfMonthly['LI01_2026-11']) });
  const rec = await store.setTaskProg(s, 'LI01', '2026-11', 3, 100, '시험자');
  assert.equal(rec.num, 3); assert.equal(rec.den, 5); assert.equal(rec.prog.t4, 100); assert.equal(rec.prog.t1, 50); assert.equal(rec.checks.t2, true);
  assert.equal(rec.rev, 2); assert.equal(rec.updatedBy, '시험자');
  const keys = Object.keys(patches(calls)[0].body).sort();
  assert.equal(keys.length, 2); assert.equal(keys[0], 'perfHistory/' + keys[0].slice(12)); assert.ok(keys[0].startsWith('perfHistory/H'));
  assert.equal(keys[1], 'perfMonthly/LI01_2026-11');
  const h = patches(calls)[0].body[keys[0]];
  assert.equal(h.kind, 'task'); assert.equal(h.summary, '세부업무 진행률 변경'); assert.deepEqual(h.changes[0], { f: '업무4', from: '0%', to: '100%' });
});
test('setTaskProg_new_record', async () => {
  const { store } = fake({});
  const rec = await store.setTaskProg(F.base(), 'LI02', '2026-11', 0, 50, 'x');
  assert.equal(rec.id, 'LI02_2026-11'); assert.equal(rec.ref, 'LI02'); assert.equal(rec.mode, 'auto'); assert.equal(rec.prog.t1, 50); assert.equal(rec.rev, 1);
});
test('toggleTeamCheck', async () => {
  const s = F.base(); s.kpiTeamChecks = { 'MK1_2026-11': { checks: { c1: true } } };
  const { calls, store } = fake({ [BASE + '/kpiTeamChecks/MK1_2026-11.json']: { checks: { c1: true } } });
  const rec = await store.toggleTeamCheck(s, 'MK1', '2026-11', 0, 'x');
  assert.equal(rec.checks.c1, false);
  const rec2 = await store.toggleTeamCheck(s, 'MK1', '2026-11', 2, 'x');
  assert.equal(rec2.checks.c3, true); assert.equal(rec2.checks.c1, true);
  assert.deepEqual(Object.keys(patches(calls)[0].body), ['kpiTeamChecks/MK1_2026-11']);
});
test('saveConfig', async () => {
  const { calls, store } = fake({});
  await store.saveConfig({ members: ['shs', 'm2'], shares: { shs: 10, m2: 10 } }, 'x');
  const b = patches(calls)[0].body; assert.deepEqual(Object.keys(b), ['kpiTabConfig']); assert.equal(b.kpiTabConfig.by, 'x');
});
test('no_forbidden_paths', () => {
  assert.ok(allPatches.length >= 5);
  allPatches.forEach(b => Object.keys(b).forEach(k => {
    assert.ok(ALLOWED.some(a => k.startsWith(a)), 'forbidden ' + k);
    assert.notEqual(b[k], null, 'null value ' + k);
  }));
});
test('resolveBase', () => {
  const prod = 'https://b2b-task-tracker-39144-default-rtdb.asia-southeast1.firebasedatabase.app/shared/b2bOpsTracker';
  assert.equal(S.resolveBase({ hostname: 'bridgeone-m.github.io', search: '?kpiTracker=http://evil' }), prod);
  assert.equal(S.resolveBase({ hostname: 'localhost', search: '' }), prod);
  assert.equal(S.resolveBase({ hostname: 'localhost', search: '?kpiTracker=' + encodeURIComponent('http://localhost:5197/shared/b2bOpsTracker') }), 'http://localhost:5197/shared/b2bOpsTracker');
});
test('setTaskProg_clears_old_check', async () => {
  const s = F.base(); s.perfMonthly['LI01_2026-11'] = { checks: { t2: true } };
  const { store } = fake({ [BASE + '/perfMonthly/LI01_2026-11.json']: { checks: { t2: true } } });
  const rec = await store.setTaskProg(s, 'LI01', '2026-11', 1, 50, 'x');
  assert.equal(rec.prog.t2, 50); assert.ok(!('t2' in rec.checks));
});

// ---- 최종 검토 수정: 쓰기 직전 최신 레코드 위에서 고친다 ----
test('setTaskProg_uses_fresh_remote', async () => {
  const s = F.base(); s.perfMonthly['LI02_2026-11'] = { id: 'LI02_2026-11', prog: { t1: 50 }, rev: 1 };
  const { calls, store } = fake({ [BASE + '/perfMonthly/LI02_2026-11.json']: { id: 'LI02_2026-11', num: 7, den: 9, prog: { t1: 50 }, rev: 3 } });
  const rec = await store.setTaskProg(s, 'LI02', '2026-11', 1, 50, 'x');
  assert.equal(rec.num, 7); assert.equal(rec.den, 9); assert.equal(rec.rev, 4); assert.equal(rec.prog.t2, 50);
  assert.equal(patches(calls)[0].body['perfMonthly/LI02_2026-11'].num, 7);
});
test('toggleTeamCheck_uses_fresh_remote', async () => {
  const s = F.base();
  const { store } = fake({ [BASE + '/kpiTeamChecks/MK1_2026-11.json']: { checks: { c2: true } } });
  const rec = await store.toggleTeamCheck(s, 'MK1', '2026-11', 0, 'x');
  assert.equal(rec.checks.c1, true); assert.equal(rec.checks.c2, true);
});

// ---- 남은 개선점: 개인 몫·탭 팀원 설정 동시 저장 ----
test('saveConfig_conflict_when_changed', async () => {
  const { calls, store } = fake({ [BASE + '/kpiTabConfig.json']: { members: ['shs'], updatedAt: 'T2' } });
  const r = await store.saveConfig({ members: ['shs', 'm2'] }, 'x', 'T1');
  assert.deepEqual({ ...r }, { ok: false, reason: 'conflict' }); assert.equal(patches(calls).length, 0);
});
test('saveConfig_ok_when_same', async () => {
  const { calls, store } = fake({ [BASE + '/kpiTabConfig.json']: { members: ['shs'], updatedAt: 'T1' } });
  const r = await store.saveConfig({ members: ['shs', 'm2'] }, 'x', 'T1');
  assert.equal(r.ok, true); assert.equal(patches(calls).length, 1);
});
test('addTabMember_uses_fresh_config', async () => {
  const { calls, store } = fake({ [BASE + '/kpiTabConfig.json']: { members: ['shs', 'm2', 'm5'], shares: { shs: 10, m2: 10 }, updatedAt: 'T9' } });
  await store.addTabMember('m6', ['shs', 'm2'], 'x');
  const b = patches(calls)[0].body.kpiTabConfig;
  assert.deepEqual(b.members, ['shs', 'm2', 'm5', 'm6']); assert.deepEqual(b.shares, { shs: 10, m2: 10 });
});
test('addTabMember_defaults_when_empty', async () => {
  const { calls, store } = fake({});
  await store.addTabMember('m3', ['shs', 'm2'], 'x');
  assert.deepEqual(patches(calls)[0].body.kpiTabConfig.members, ['shs', 'm2', 'm3']);
});
test('addTabMember_skip_when_present', async () => {
  const { calls, store } = fake({ [BASE + '/kpiTabConfig.json']: { members: ['shs', 'm2'] } });
  await store.addTabMember('m2', ['shs', 'm2'], 'x');
  assert.equal(patches(calls).length, 0);
});
