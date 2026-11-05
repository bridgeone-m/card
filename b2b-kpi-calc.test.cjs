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
  assert.equal(r1(k1.ach), 25.2);
  assert.equal(r1(a.rows.find(r => r.id === 'MK2').ach), 65.8); // KPI3 다른 단지 재사용, 목표 95
  assert.equal(r1(a.rows.find(r => r.id === 'MK3').ach), 3.7); // KPI2 문의별 L3 도달, 목표 50
  assert.ok(Math.abs(a.value - 31.58) < 0.05);
  assert.deepEqual(Array.from(a.rows.map(r => r.label + ' ' + r.name)), ['KPI1 신규 협약 활용', 'KPI2 문의별 L3 도달', 'KPI3 다른 단지 재사용']);
  assert.equal(k1.target, 70); assert.equal(a.rows[2].target, 95); assert.equal(a.rows[2].floor, 85); assert.equal(a.rows[1].target, 50);
});
test('kpiActual_missing_kpi_excluded', () => {
  const s = F.base(); delete s.perfAuto['MK3_2026-11'];
  const a = C.kpiActual(s, M);
  assert.equal(a.measured, 2);
  assert.equal(a.rows.find(r => r.id === 'MK3').state, 'none');
  assert.ok(Math.abs(a.value - 45.5) < 0.05);
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

// ---- Task 2: 팀 공동·개인 몫·종합점수(환산 없음)·뒤처진 부분 ----
function model(s){ return C.buildModel(s, M); }
test('composite_spec_example', () => {
  const m = model(F.base());
  assert.ok(Math.abs(m.composite.points - 27.28) < 0.05, 'points ' + m.composite.points);
  assert.equal(m.composite.reflected, 70); assert.equal(m.composite.waiting, 20); assert.equal(m.composite.unassigned, 10);
  const shs = m.shares.rows.find(r => r.memberId === 'shs');
  assert.equal(shs.share, 10); assert.equal(shs.temporary, true);
  assert.equal(m.team.state, 'wait');
});
test('composite_spec_example2', () => {
  const s = F.base();
  s.kpiTeamChecks = { 'MK1_2026-11': { checks: { c1: true, c2: true, c3: true, c4: true, c5: true } }, 'MK2_2026-11': { checks: { c1: true, c2: true, c3: true, c4: true } } };
  const persons = { shs: { state: 'ok', value: 70 }, m2: { state: 'nodefs', value: null } };
  const team = C.teamCommon(s, M);
  assert.equal(team.checked, 9); assert.equal(team.total, 15); assert.equal(team.value, 60);
  const c = C.composite(C.kpiActual(s, M), team, persons, C.shareRows(s));
  assert.ok(Math.abs(c.points - 37.95) < 0.05, 'points ' + c.points);
  assert.equal(c.reflected, 90); assert.equal(c.unassigned, 10); assert.equal(c.waiting, 0);
});
test('composite_empty_month', () => {
  const s = F.base(); s.perfAuto = {}; s.perfMonthly = {};
  const c = model(s).composite;
  assert.equal(c.points, 0); assert.equal(c.reflected, 0); assert.equal(c.waiting, 90); assert.equal(c.unassigned, 10);
  c.parts.forEach(p => { assert.ok(p.state === 'wait' || p.state === 'unassigned', p.key); assert.equal(p.points, null); });
});
test('shares_no_redistribution', () => {
  const sh = C.shareRows(F.base());
  assert.equal(sh.rows.find(r => r.memberId === 'shs').share, 10);
  assert.equal(sh.unassigned, 10); assert.equal(sh.assigned, 10);
  assert.equal(sh.rows.find(r => r.memberId === 'm2').hasDefs, false);
});
test('shares_three_members_still_20', () => {
  const s = F.base(); s.kpiTabConfig = { members: ['shs', 'm2', 'm1'] };
  s.leadDefs['LI-m2-1'] = { id: 'LI-m2-1', member: 'm2', name: 'x' }; s.leadDefs['LI-m1-1'] = { id: 'LI-m1-1', member: 'm1', name: 'y' };
  const sh = C.shareRows(s);
  assert.ok(Math.abs(sh.rows.reduce((t, r) => t + r.share, 0) - 20) < 1e-9);
  assert.ok(Math.abs(sh.rows[0].share - 6.667) < 0.01);
});
test('shares_saved_not_temporary', () => {
  const s = F.base(); s.kpiTabConfig = { members: ['shs', 'm2'], shares: { shs: 12, m2: 8 } };
  const sh = C.shareRows(s);
  assert.equal(sh.rows[0].share, 12); assert.equal(sh.rows[0].temporary, false); assert.equal(sh.unassigned, 8);
});
test('validateShares', () => {
  assert.deepEqual(Array.from(C.validateShares({ shs: 15, m2: 10 }, ['shs', 'm2'])), ['합계 25 — 20이 되어야 합니다']);
  assert.equal(C.validateShares({ shs: 10, m2: 10 }, ['shs', 'm2']).length, 0);
  assert.equal(C.validateShares({ shs: -1, m2: 21 }, ['shs', 'm2']).length, 2);
});
test('actual_not_changed_by_work', () => {
  const s = F.base(), before = C.kpiActual(s, M).value;
  s.kpiTeamChecks = { 'MK1_2026-11': { checks: { c1: true } } };
  s.perfMonthly['LI02_2026-11'] = { num: 1, den: 1, prog: { t1: 100 } };
  const m = model(s);
  assert.equal(m.actual.value, before);
  assert.equal(m.composite.parts.find(p => p.key === 'actual').points, before * 0.6);
});
test('buildModel_compare_note', () => {
  const s = F.base(); s.perfMonthly['LI02_2026-11'] = { num: 1, den: 2 };
  const m = model(s);
  assert.equal(m.prevMonth, '2026-10');
  assert.equal(m.compareNotes.shs, true);
  assert.equal(C.buildModel(F.base(), M).compareNotes.shs, false);
});
test('prevMonth_january', () => { assert.equal(C.prevMonth('2027-01'), '2026-12'); });
test('laggards_order', () => {
  const l = model(F.base()).laggards;
  assert.ok(l.length <= 5);
  assert.equal(l[0].kind, 'kpi'); assert.ok(l[0].label.includes('KPI2 문의별 L3 도달'));
  assert.ok(l.some(x => x.kind === 'unmeasured' && x.detail.includes('8')));
});

// ---- Task 3: 개인 트래커·지표 정의 ----
const NOW = '2026-11-05T00:00:00.000Z';
test('ids_do_not_collide', () => {
  const s = F.base();
  assert.equal(C.newMemberId(s), 'm3');
  assert.equal(C.nextDefId(s, 'lead', 'm3'), 'LI-m3-1');
  s.leadDefs['LI-m3-1'] = { id: 'LI-m3-1', member: 'm3' };
  assert.equal(C.nextDefId(s, 'lead', 'm3'), 'LI-m3-2');
  assert.equal(C.nextDefId(s, 'lag', 'm3'), 'LG-m3-1');
});
test('buildMember_shape', () => {
  const m = C.buildMember({ name: ' 새사람 ', role: '매니저' }, F.base(), NOW);
  assert.equal(m.id, 'm3'); assert.equal(m.name, '새사람'); assert.equal(m.teamId, 'team_b2b');
  assert.equal(m.by, 'card-kpi-tab'); assert.equal(m.updatedAt, NOW); assert.match(m.color, /^#[0-9A-F]{6}$/i);
});
test('buildLeadDef_shape', () => {
  const s = F.base();
  const d = C.buildLeadDef('shs', { name: '새 지표', cycle: '매주', purpose: '', tasks: ['a', 'b'], numLabel: '완료', denLabel: '대상', target: 80, cardKpis: ['MK1'], cardWeight: null }, s, NOW);
  assert.equal(d.id, 'LI-shs-1'); assert.equal(d.member, 'shs'); assert.equal(d.owner, '시험A');
  assert.equal(d.formula, '완료 ÷ 대상 × 100'); assert.equal(d.target, 80); assert.deepEqual(Array.from(d.cardKpis), ['MK1']);
  assert.equal(d.src, '수동 관리'); assert.equal(d.by, 'card-kpi-tab'); assert.equal(d.rev, 0);
  assert.ok(!('cardWeight' in d) || d.cardWeight === undefined);
});
test('buildLeadDef_edit_preserves_unknown', () => {
  const s = F.base(), prev = Object.assign({}, s.leadDefs.LI01, { foo: 1, rev: 2 });
  const d = C.buildLeadDef('shs', { name: '고친 이름', tasks: ['x'], target: null }, s, NOW, prev);
  assert.equal(d.id, 'LI01'); assert.equal(d.no, prev.no); assert.equal(d.foo, 1); assert.equal(d.rev, 3); assert.equal(d.name, '고친 이름');
  assert.ok(!('target' in d) || d.target === undefined);
});
test('buildLagDef_shape', () => {
  const d = C.buildLagDef('shs', { name: '후행', numLabel: 'a', denLabel: 'b', target: 30 }, F.base(), NOW);
  assert.equal(d.id, 'LG-shs-1'); assert.equal(d.member, 'shs'); assert.equal(d.target, 30); assert.equal(d.rev, 0);
});
test('validateDefInput', () => {
  assert.deepEqual(Array.from(C.validateDefInput({ name: '', target: null })), ['지표 이름을 입력해 주세요']);
  assert.deepEqual(Array.from(C.validateDefInput({ name: 'a', target: 120 })), ['목표값은 0~100 사이']);
  assert.equal(C.validateDefInput({ name: 'a', target: null }).length, 0);
});
test('nextTaskProg', () => {
  assert.equal(C.nextTaskProg(0), 50); assert.equal(C.nextTaskProg(50), 100); assert.equal(C.nextTaskProg(100), 0);
});
test('buildModel_lags_reference_only', () => {
  const s = F.base(); s.perfMonthly['LG1_2026-11'] = { num: 1, den: 4 };
  const m = C.buildModel(s, M);
  assert.equal(m.lags.shs.length, 1); assert.equal(m.lags.shs[0].rate, 25); assert.equal(m.lags.m2.length, 0);
  assert.ok(Math.abs(m.composite.points - 27.28) < 0.05); // 후행은 점수에 넣지 않는다
});

// ---- 최종 검토 수정 ----
test('shares_saved_plus_new_member_still_20', () => {
  const s = F.base(); s.kpiTabConfig = { members: ['shs', 'm2', 'm1'], shares: { shs: 10, m2: 10 } };
  s.leadDefs['LI-m1-1'] = { id: 'LI-m1-1', member: 'm1', name: 'y' };
  const sh = C.shareRows(s);
  assert.ok(Math.abs(sh.rows.reduce((t, r) => t + r.share, 0) - 20) < 1e-9);
  const m1 = sh.rows.find(r => r.memberId === 'm1'); assert.equal(m1.share, 0); assert.equal(m1.temporary, true);
  assert.equal(sh.needsRebalance, true);
  const c = C.buildModel(s, M).composite; assert.ok(Math.abs(c.reflected + c.waiting + c.unassigned - 100) < 1e-6);
});
test('shares_partial_saved_remainder_split', () => {
  const s = F.base(); s.kpiTabConfig = { members: ['shs', 'm2', 'm1'], shares: { shs: 12 } };
  const sh = C.shareRows(s);
  assert.equal(sh.rows.find(r => r.memberId === 'm2').share, 4); assert.equal(sh.rows.find(r => r.memberId === 'm1').share, 4);
});
test('teamCommon_equal_weight_per_kpi', () => {
  const s = F.base(); s.mainKpis.MK3.manage = ['a', 'b'];
  s.kpiTeamChecks = { 'MK1_2026-11': { checks: { c1: true, c2: true, c3: true, c4: true, c5: true } }, 'MK3_2026-11': { checks: {} } };
  const t = C.teamCommon(s, M);
  assert.ok(Math.abs(t.value - (100 + 0 + 0) / 3) < 1e-9, String(t.value));
});

// ---- 남은 개선점 ----
test('formula_kept_when_labels_unchanged', () => {
  const s = F.base(), prev = Object.assign({}, s.leadDefs.LI01, { numLabel: '완료', denLabel: '대상', formula: '직접 쓴 계산식', rev: 1 });
  assert.equal(C.buildLeadDef('shs', { name: 'x', numLabel: '완료', denLabel: '대상' }, s, NOW, prev).formula, '직접 쓴 계산식');
  assert.equal(C.buildLeadDef('shs', { name: 'x', numLabel: '처리', denLabel: '대상' }, s, NOW, prev).formula, '처리 ÷ 대상 × 100');
  assert.equal(C.buildLeadDef('shs', { name: 'x', numLabel: 'a', denLabel: 'b' }, s, NOW).formula, 'a ÷ b × 100');
});
test('validate_card_weight', () => {
  assert.deepEqual(Array.from(C.validateDefInput({ name: 'a', cardWeight: NaN })), ['지표 비중은 0~100 사이 숫자']);
  assert.deepEqual(Array.from(C.validateDefInput({ name: 'a', cardWeight: 150 })), ['지표 비중은 0~100 사이 숫자']);
  assert.equal(C.validateDefInput({ name: 'a', cardWeight: null }).length, 0);
  assert.deepEqual(Array.from(C.validateDefInput({ name: 'a', target: NaN })), ['목표값은 0~100 사이']);
});

// ---- 카드 구축(2026-08) 이후 누적 실적 ----
test('cumulative_since_card_start', () => {
  const s = F.base();
  s.perfMonthly['LI01_2026-08'] = { num: 1, den: 1 }; s.perfMonthly['LI01_2026-09'] = { num: 4, den: 6 };
  s.perfMonthly['LI01_2026-07'] = { num: 9, den: 9 }; // 구축 전 — 빼야 함
  delete s.perfAuto['LI01_2026-10']; s.perfMonthly['LI01_2026-10'] = { mode: 'direct', direct: 50 }; // 분자·분모 없는 직접 입력 — 빼야 함
  const c = C.cumulative(s, 'LI01', '2026-11');
  // 8월 1/1 + 9월 4/6 + 11월 자동 5/6 (10월은 직접 입력이라 제외, 7월은 구축 전이라 제외)
  assert.equal(c.num, 10); assert.equal(c.den, 13); assert.equal(c.months, 3); assert.equal(c.from, '2026-08');
  assert.equal(C.CARD_START_MONTH, '2026-08');
  assert.equal(C.cumulative(F.base(), 'LI02', '2026-11').den, 0);
});
test('cumulative_in_person_rows', () => {
  const s = F.base(); s.perfMonthly['LI01_2026-09'] = { num: 4, den: 6 };
  const row = C.buildModel(s, M).persons.shs.rows.find(r => r.id === 'LI01');
  assert.equal(row.cum.num, 16); assert.equal(row.cum.den, 20); // 9월 4/6 + 10월 자동 7/8 + 11월 자동 5/6
});
