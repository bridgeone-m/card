// B2B KPI 탭 화면(b2b-kpi-tab.js)·index.html 연결 — 관리자 전용, 실제 KPI 실적과 업무 관리점수 분리 표시
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const css = fs.readFileSync(__dirname + '/b2b-kpi-tab.css', 'utf8');
const tabSrc = fs.readFileSync(__dirname + '/b2b-kpi-tab.js', 'utf8');
const load = f => { const c = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), c); return c.module.exports; };
const C = load('b2b-kpi-calc.js'), T = load('b2b-kpi-tab.js');
const F = require('./b2b-kpi.fixture.cjs');

test('index_wiring', () => {
  assert.ok(html.includes('<link rel="stylesheet" href="b2b-kpi-tab.css">'));
  const ce = html.indexOf('<script src="contract-esign.js"></script>');
  const a = html.indexOf('<script src="b2b-kpi-calc.js"></script>'), b = html.indexOf('<script src="b2b-kpi-store.js"></script>'), c = html.indexOf('<script src="b2b-kpi-tab.js"></script>');
  assert.ok(ce > 0 && ce < a && a < b && b < c, 'script order');
  assert.ok(html.includes('body:not(.crm-admin-mode) #crmTabB2bKpi, body:not(.crm-admin-mode) #gnavDrawerTabB2bKpi, body:not(.crm-admin-mode) #b2bKpiView{ display:none !important; }'));
  assert.ok(html.includes('if(window.B2BKpiTab) window.B2BKpiTab.close();'));
});
test('syntax', () => { ['b2b-kpi-calc.js', 'b2b-kpi-store.js', 'b2b-kpi-tab.js'].forEach(f => new vm.Script(fs.readFileSync(__dirname + '/' + f, 'utf8'))); });
test('admin_gate', () => {
  const i = tabSrc.indexOf('function open(');
  assert.ok(i > 0); assert.ok(tabSrc.slice(i, i + 300).includes("crmAdminOk('B2B KPI')"));
});
test('renderHtml_error', () => {
  const h = T.renderHtml(null, { state: 'error', error: 'x', month: '2026-11' });
  assert.ok(h.includes('업무트래커에 연결하지 못했습니다')); assert.ok(h.includes('다시 시도'));
});
test('renderHtml_loading', () => {
  assert.ok(T.renderHtml(null, { state: 'loading', month: '2026-11' }).includes('불러오는 중'));
});
test('css_fixed_view', () => { assert.ok(/\.b2bkpi-view\{[^}]*position:fixed/.test(css.replace(/\s+/g, ''))); });

// ---- Task 6: 화면 내용 ----
const UI = { state: 'ready', month: '2026-11' };
const R = s => T.renderHtml(C.buildModel(s, '2026-11'), UI);
test('render_spec_example', () => {
  const h = R(F.base());
  ['30.0점', '반영 70%', '대기 20%', '미배정 10%', '실제 KPI 실적', '업무 관리점수', '1/9개 측정', '(임시 비중)', '지표 미등록',
    '다른 팀원에게 넘기지 않습니다', '100점 환산 안 함', '목표 60', '목표 85', '목표 35', '뒤처진 부분', '팀 진척', '팀원 진척', '개인 트래커 추가',
    '업무 관리점수는 실제 KPI 실적에 더해지지 않습니다', 'K1 관리 1']
    .forEach(t => assert.ok(h.includes(t), '없음: ' + t));
});
test('render_compare_note', () => {
  const s = F.base(); s.perfMonthly['LI02_2026-11'] = { num: 1, den: 2 };
  const h = R(s);
  assert.ok(h.includes('단순 비교할 수 없습니다'));
  assert.ok(!h.includes('▲') && !h.includes('▼'));
  assert.ok(!R(F.base()).includes('단순 비교할 수 없습니다'));
});
test('render_empty_month', () => {
  const s = F.base(); s.perfAuto = {}; s.perfMonthly = {};
  const h = R(s);
  ['반영 0%', '실적 대기', '산출 대기', '— 점'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
  assert.ok(!h.includes('0.0점'));
});
test('render_escapes', () => {
  const s = F.base(); s.members.shs.name = '<b>x</b>';
  const h = R(s);
  assert.ok(!h.includes('<b>x</b>')); assert.ok(h.includes('&lt;b&gt;x&lt;/b&gt;'));
});

// ---- Task 7: 개인 트래커 추가·수정 저장 계획(순수 함수) ----
const NOW = '2026-11-05T00:00:00.000Z';
const P = (s, inp) => T.planSave(s, inp, NOW, C);
test('formToInputs_tasks_lines', () => {
  const x = T.formToInputs({ memberId: '', newName: ' 새사람 ', newRole: '', leads: [{ name: 'a', tasksText: 'a\n\n b \n', target: '80', weight: '', kpis: ['MK1'] }, { name: '', tasksText: '', target: '', weight: '' }], lags: [] });
  assert.equal(x.member.name, '새사람'); assert.ok(!x.member.id);
  assert.equal(x.leads.length, 1, '완전히 빈 줄은 건너뜀');
  assert.deepEqual(Array.from(x.leads[0].tasks), ['a', 'b']); assert.equal(x.leads[0].target, 80); assert.equal(x.leads[0].cardWeight, null);
  assert.deepEqual(Array.from(x.leads[0].cardKpis), ['MK1']);
});
test('planSave_new_member_two_leads', () => {
  const r = P(F.base(), { member: { name: '새사람', role: '' }, leads: [{ name: 'a', tasks: [] }, { name: 'b', tasks: [] }], lags: [{ name: 'g' }] });
  assert.equal(r.errors.length, 0);
  assert.equal(r.member.def.id, 'm3'); assert.equal(r.member.openedRev, null);
  assert.deepEqual(Array.from(r.leads.map(x => x.def.id)), ['LI-m3-1', 'LI-m3-2']);
  r.leads.forEach(x => { assert.equal(x.openedRev, null); assert.equal(x.def.owner, '새사람'); assert.equal(x.def.member, 'm3'); });
  assert.equal(r.lags[0].def.id, 'LG-m3-1');
});
test('planSave_double_submit_same_ids', () => {
  const s = F.base(), inp = { member: { id: 'shs' }, leads: [{ name: 'a', tasks: [] }], lags: [] };
  assert.equal(P(s, inp).leads[0].def.id, P(s, inp).leads[0].def.id);
  assert.equal(P(s, inp).member, null);
});
test('planSave_edit_keeps_id', () => {
  const s = F.base(); s.leadDefs.LI01.rev = 4;
  const r = P(s, { member: { id: 'shs' }, leads: [{ id: 'LI01', name: '고침', tasks: ['x'], target: 90 }], lags: [] });
  assert.equal(r.leads[0].def.id, 'LI01'); assert.equal(r.leads[0].openedRev, 4); assert.equal(r.leads[0].def.rev, 5);
});
test('planSave_errors', () => {
  const r = P(F.base(), { member: { id: 'shs' }, leads: [{ name: '', target: 50 }], lags: [] });
  assert.ok(r.errors.some(e => e.includes('지표 이름을 입력해 주세요')));
  assert.ok(P(F.base(), { member: { name: '' }, leads: [], lags: [] }).errors.some(e => e.includes('이름')));
});
test('planSave_existing_member_without_defs', () => {
  const r = P(F.base(), { member: { id: 'm1' }, leads: [{ name: 'c', tasks: [] }], lags: [] });
  assert.equal(r.member, null); assert.equal(r.leads[0].def.id, 'LI-m1-1'); assert.equal(r.leads[0].def.owner, '시험C');
});

// ---- Task 7b: 로그인 화면 '개인 업무트래커 →' 보조 링크 ----
test('gate_tracker_link', () => {
  const h = fs.readFileSync(__dirname + '/index.html', 'utf8'), c = fs.readFileSync(__dirname + '/b2b-kpi-tab.css', 'utf8');
  const cnt = (s, t) => s.split(t).length - 1;
  assert.equal(cnt(h, 'id="gateTrackerLink"'), 1); assert.equal(cnt(h, 'id="gateTrackerLinkM"'), 1);
  const a = h.match(/<a [^>]*id="gateTrackerLink"[^>]*>[^<]*<\/a>/)[0], m = h.match(/<a [^>]*id="gateTrackerLinkM"[^>]*>[^<]*<\/a>/)[0];
  [a, m].forEach(x => { assert.ok(x.includes('href="https://hansol941201.github.io/B2B/"')); assert.ok(x.includes('rel="noopener"')); assert.ok(x.includes('target="_blank"')); assert.ok(x.includes('개인 업무트래커 →')); });
  assert.ok(h.indexOf('id="gateTrackerLink"') < h.indexOf('class="gate-hero-foot"'));
  assert.ok(h.indexOf('id="gateTrackerLink"') > h.indexOf('class="gate-hero"'));
  assert.ok(h.indexOf('id="gateTrackerLinkM"') > h.indexOf('class="gate-card"'));
  assert.ok(/#gateScreen \.gate-tracker-link-m\{[^}]*display:none/.test(c));
  assert.ok(/@media \(max-width:860px\)\{[^}]*#gateScreen \.gate-tracker-link-m\{[^}]*display:flex/.test(c));
});
