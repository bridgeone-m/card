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
  assert.ok(html.includes('body:not(.crm-admin-mode) #crmTabB2bKpi, body:not(.crm-admin-mode) #gnavDrawerTabB2bKpi, body:not(.crm-admin-mode) #b2bKpiView, body:not(.crm-admin-mode) #b2bKpiModal{ display:none !important; }'));
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
  ['8.3점', '반영 10%', '대기 80%', '미배정 10%', '공식 실적', '업무 관리점수', '1/9개 측정', '(임시 비중)', '지표 미등록',
    '다른 팀원에게 넘기지 않습니다', '100점 환산 안 함', 'KPI1', '신규 협약 활용', '목표 70%', 'KPI2', '문의별 L3 도달', '목표 50%', 'KPI3', '다른 단지 재사용', '목표 95% 도전 · 85% 하한', '첫 요청이 없기 전에 시작 장벽을 없앤다', '문의 다음 단계가 고객에게 보이게 한다', '첫 도움의 막힘을 해결하고 다음 요청을 잇는다', '뒤처진 부분', '팀 진척', '팀원 진척', '개인 트래커 추가',
    '업무 관리점수와 공식 실적은 섞이지 않습니다', 'K1 관리 1']
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

// ---- 로그인 화면에는 '개인 업무트래커' 바로가기를 두지 않는다(2026-11-11 요청) — 로그인한 뒤 B2B KPI 탭 머리줄의 링크만 남김 ----
test('gate_has_no_tracker_shortcut_but_tab_header_keeps_link', () => {
  const h = fs.readFileSync(__dirname + '/index.html', 'utf8'), c = fs.readFileSync(__dirname + '/b2b-kpi-tab.css', 'utf8');
  assert.ok(!h.includes('gateTrackerLink') && !h.includes('gate-tracker-link'), '로그인 화면 바로가기 없음');
  assert.ok(!c.includes('gate-tracker-link'), '바로가기 스타일도 없음');
  const out = T.renderHtml(null, { state: 'loading', month: '2026-11' });
  assert.ok(out.includes('개인 업무트래커 열기 ↗'), '탭 머리줄 링크는 그대로');
});

// ---- 화면 확인 중 발견: 3명일 때 비중 반올림 합이 101 ----
test('weight_line_three_members_sums_100', () => {
  const s = F.base(); s.kpiTabConfig = { members: ['shs', 'm2', 'm1'] }; s.leadDefs['LI-m1-1'] = { id: 'LI-m1-1', member: 'm1', name: 'y' };
  const h = R(s);
  assert.ok(h.includes('반영 6.7%'), '반영'); assert.ok(h.includes('대기 86.7%'), '대기'); assert.ok(h.includes('미배정 6.7%'), '미배정');
});
test('mobile_touch_targets_44', () => {
  const c = fs.readFileSync(__dirname + '/b2b-kpi-tab.css', 'utf8').replace(/\s+/g, ' ');
  assert.ok(/@media \(max-width:640px\)\{[^@]*\.b2bkpi-link\{[^}]*min-height:44px/.test(c), 'link');
  assert.ok(/@media \(max-width:640px\)\{[^@]*\.b2bkpi-task \.b2bkpi-st\{[^}]*width:44px; height:44px/.test(c), 'task button');
});

// ---- 최종 검토 수정 ----
test('planSave_uses_opened_rev_not_current', () => {
  const s = F.base(); s.leadDefs.LI01.rev = 7; // 팝업을 연 뒤 다시 읽기로 rev 가 7 로 올라감
  const r = P(s, { member: { id: 'shs' }, leads: [{ id: 'LI01', openedRev: 4, name: '고침', tasks: [] }], lags: [] });
  assert.equal(r.leads[0].openedRev, 4);
});
test('runSavePlan_retry_skips_saved', async () => {
  const saved = [], plan = { member: { def: { id: 'm3' }, openedRev: null }, leads: [{ def: { id: 'LI-m3-1' }, openedRev: null }, { def: { id: 'LI-m3-2' }, openedRev: null }], lags: [] };
  let fail = true;
  const store = { saveDef: async (col, def) => { if(def.id === 'LI-m3-2' && fail){ fail = false; return { ok: false, reason: 'conflict' }; } saved.push(def.id); return { ok: true }; } };
  await assert.rejects(T.runSavePlan(plan, store), /conflict/);
  await T.runSavePlan(plan, store);
  assert.deepEqual(saved, ['m3', 'LI-m3-1', 'LI-m3-2']);
});
test('close_clears_modal_and_staff_hidden', () => {
  const i = tabSrc.indexOf('function close(');
  assert.ok(tabSrc.slice(i, i + 200).includes('closeModal()'));
  assert.ok(html.includes('body:not(.crm-admin-mode) #b2bKpiModal'));
});
test('render_needs_rebalance_note', () => {
  const s = F.base(); s.kpiTabConfig = { members: ['shs', 'm2', 'm1'], shares: { shs: 10, m2: 10 } };
  assert.ok(R(s).includes('개인 몫을 다시 나눠 주세요'));
  assert.ok(!R(F.base()).includes('개인 몫을 다시 나눠 주세요'));
});

// ---- 남은 개선점 ----
test('circled_numbers_no_dot', () => {
  const s = F.base(); s.leadDefs.LI01.no = '①';
  const h = R(s);
  assert.ok(h.includes('① 시험 선행 1')); assert.ok(!h.includes('①.'));
  assert.ok(h.includes('2. 시험 선행 2'), '숫자 번호는 점 유지');
});
test('render_stale_banner', () => {
  const h = T.renderHtml(C.buildModel(F.base(), '2026-11'), { state: 'ready', month: '2026-11', stale: true, loadedAt: '16:38' });
  assert.ok(h.includes('연결이 끊겼습니다')); assert.ok(h.includes('마지막 읽기 16:38')); assert.ok(h.includes('data-kpi-act="reload"'));
  assert.ok(!R(F.base()).includes('연결이 끊겼습니다'));
});
test('editor_lags_sorted', () => {
  const i = tabSrc.indexOf('function openEditor(');
  assert.ok(tabSrc.slice(i, i + 900).includes('d.member === memberId; }).sort('));
});

// ---- 운영 버그: MOU 진행상황 검색줄(z-index 1000)이 B2B KPI 화면 위로 비침 ----
test('underlying_views_hidden_while_open', () => {
  const c = fs.readFileSync(__dirname + '/b2b-kpi-tab.css', 'utf8').replace(/\s+/g, ' ');
  const m = c.match(/([^{}]*)\{ ?visibility:hidden !important; ?\}/);
  assert.ok(m, 'visibility 규칙 없음');
  ['#listView', '#cardView', '#workQueueView', '#mailSettingsView'].forEach(id => assert.ok(m[1].includes('body.b2bkpi-on ' + id), id));
});
test('render_cumulative', () => {
  const s = F.base(); s.perfMonthly['LI01_2026-09'] = { num: 4, den: 6 };
  const h = R(s);
  assert.ok(h.includes('카드 구축 이후 누적 16/20'), h.match(/카드 구축 이후[^<]*/));
});
test('render_official_kpi', () => {
  const s = F.base(); s.kpiOfficial = { cutoff: '2026-10-20', note: '확인분', items: { MK1: { num: 8, den: 25, value: 32, unit: '곳' }, MK3: { num: 315, den: 1025, value: 30.73, unit: '기회' }, MK2: { num: 44, den: 79, value: 55.7, unit: '곳' } } };
  const h = R(s);
  ['32.0%', '8/25 곳 · 10/20 마감 확인분', '30.7%', '315/1,025 기회 · 10/20 마감 확인분', '55.7%', '44/79 곳 · 10/20 마감 확인분', '10/20 마감 확인분이며 11월 최신 실적이 아닙니다', '다른 정의의 자동값 참고 17.6%'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
});

// ---- 1·2차 미팅 누락 방지 실측 표시 ----
const meetingFixture = () => ({
  rule: { grace: 3, reg: 14, start: '2026-08-21', bulkEnd: '2026-08-26', now: '2026-11-05' },
  summary: { all: { m1: { due: 11, ontime: 8, late: 0, missed: 2, unknown: 1, judged: 10, rate: 80, upcoming: 1, unplaced: 184 }, m2: { due: 6, ontime: 4, late: 0, missed: 1, unknown: 1, judged: 5, rate: 80, upcoming: 4, unplaced: 184 } },
    new: { m1: { due: 5, ontime: 4, late: 0, missed: 1, unknown: 0, judged: 5, rate: 80, upcoming: 1, unplaced: 1 }, m2: { due: 0, ontime: 0, late: 0, missed: 0, unknown: 0, judged: 0, rate: null, upcoming: 0, unplaced: 0 } } },
  rows: [{ id: 'a', name: '<시험>건설', code: 'B2B1', group: 'bulk', regDate: '2026-08-25', stage: 'm1', stageName: '1차', cls: 'missed', due: '2026-09-02', doneAt: '', why: '질문서 회신 2026-08-19 + 14일 지남, 완료 기록 없음', owner: '', inScope: true }],
  excluded: []
});
test('render_meeting_numeric', () => {
  const s = F.base(); const m = C.buildModel(s, '2026-11'); m.meeting = meetingFixture();
  const h = T.renderHtml(m, { state: 'ready', month: '2026-11' });
  ['1차 미팅 관리', '관리 완료 8/10곳 · 80%', '누락 2', '판정 불가 1', '기한 전 1', '2차 미팅 관리', '관리 완료 4/5곳 · 80%', '8/25 이후 신규 등록', '대상 없음', 'data-kpi-act="meetingList"'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
});
test('meeting_list_html', () => {
  const h = T.meetingListHtml(meetingFixture(), 'm1', 'all');
  ['&lt;시험&gt;건설', '1차', '미처리 누락', '2026-09-02', '질문서 회신 2026-08-19', '담당 기록 없음'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
  assert.ok(!h.includes('<시험>'));
});
test('index_exports_meeting_logic', () => {
  assert.ok(html.includes('window.SHIN2_MEETING_LOGIC = Object.freeze({'));
  const a = html.indexOf('<script src="b2b-kpi-meeting.js"></script>'), b = html.indexOf('<script src="b2b-kpi-tab.js"></script>');
  assert.ok(a > 0 && a < b);
  new vm.Script(fs.readFileSync(__dirname + '/b2b-kpi-meeting.js', 'utf8'));
});

// ---- 팀장님 최종 설계 — 화면에 정의·관찰기간·재사용 하한/도전 표시 ----
test('render_kpi_definitions_and_floor', () => {
  const s = F.base(); s.kpiOfficial = { cutoff: '2026-10-20', note: '확인분', items: { MK1: { num: 8, den: 25, value: 32, unit: '곳' }, MK3: { num: 315, den: 1025, value: 30.73, unit: '기회' }, MK2: { num: 44, den: 79, value: 55.7, unit: '곳' } } };
  const h = R(s);
  ['무엇을 세나요', '협약 전 90일 ~ 후 89일', '협약 후 90일 관찰', '첫 L2 이후 30일', '첫 유효 L3 요청일 이후 60일', '같은 단지 추가 요청',
    '도전 95% 대비 58.6%', '하한 85% 대비 65.5%', '하한 85%까지 29.3%p 부족', '하한 미달', '목표 95% 도전 · 85% 하한'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
  assert.equal((h.match(/class="b2bkpi-def"/g) || []).length, 3);
});
// ---- 공식 실적 산출 대기 · 확인분은 참고 영역 · 측정/대기 구분 ----
const officialShape = () => { const s = F.base(); s.kpiOfficial = { cutoff: '2026-10-20', note: '확인분', items: { MK1: { num: 8, den: 25, value: 32, unit: '곳' }, MK3: { num: 315, den: 1025, value: 30.73, unit: '기회' }, MK2: { num: 44, den: 79, value: 55.7, unit: '곳' } } }; return s; };
test('render_official_actual_wait_and_reference_area', () => {
  const h = R(officialShape());
  ['공식 실적 산출 대기', '참고 · 확인분 3개 평균', '공식 점수가 아닙니다', '종합점수 적용 기준: 미확정', '팀장님 확인 대기',
    '도전 95% 기준 55.3%', '하한 85% 기준 57.6%', '10/20 마감 확인분', '11월 최신 실적이 아닙니다', '공식 실적 60%는 산출 대기'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
  assert.ok(!h.includes('실제 KPI 실적 (60%)'), '옛 표기 남음');
  assert.ok(!h.includes('하한 85% 기준이면'), '옛 점수 안내 남음');
});
test('render_official_wait_not_zero_points_not_rescaled', () => {
  const m = C.buildModel(officialShape(), '2026-11'); const h = T.renderHtml(m, { state: 'ready', month: '2026-11' });
  const personal = m.composite.parts.filter(p => p.key.indexOf('p:') === 0).reduce((s, p) => s + (p.points || 0), 0);
  assert.ok(Math.abs(m.composite.points - personal) < 1e-9, '종합에 실적이 섞임');
  assert.ok(h.includes('100점 환산 안 함'));
  assert.ok(/대기 [0-9.]+%/.test(h));
});
test('render_person_measured_and_waiting_groups', () => {
  const h = R(F.base());
  ['측정된 항목 (1개)', '대기 항목 (8개)', '점수에 반영', '점수에 넣지 않음'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
});
test('render_team_measured_and_waiting_counts', () => {
  const s = F.base(); s.kpiTeamChecks = { 'MK1_2026-11': { checks: { c1: true, c2: true } } };
  const h = R(s);
  ['체크 2개 · 대기 3개', '체크 0개 · 대기 5개', '측정 2개 · 대기 13개'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
});

test('render_breakdown_observing_and_detail', () => {
  const s = officialShape();
  s.kpiOfficial.items.MK1.breakdown = [{ key: 'observing', label: '관찰 중 · 분모에 넣지 않음', n: 8, unit: '곳', note: '이미 요청 3곳' }, { label: '활성 8곳 중 협약 전 활동', n: 1, unit: '곳' }];
  s.kpiOfficial.items.MK3.breakdown = [{ key: 'observing', label: '관찰 중 · 분모에 넣지 않음', n: 166, unit: '기회', note: '이미 L3 35기회' }, { label: '도달 중 직접 L3', n: 227, unit: '기회' }];
  const h = R(s);
  ['관찰 중 · 분모에 넣지 않음 8곳', '이미 요청 3곳', '166기회', '이미 L3 35기회', '집계 내역', '활성 8곳 중 협약 전 활동 1곳', '도달 중 직접 L3 227기회'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
  assert.equal((h.match(/class="b2bkpi-obs"/g) || []).length, 2); // 관찰 중은 접지 않고 바로 보인다
  assert.ok(!R(officialShape()).includes('b2bkpi-obs'), '내역이 없으면 줄도 없다');
});

// ---- 3대 KPI 카드를 맨 위에 — 순서: ① 3대 KPI → ② 종합 KPI → ③ 뒤처진 부분 → ④ 팀 진척 → ⑤ 팀원 진척 → ⑥ 점수 반영 흐름 ----
test('render_kpi_cards_first_then_composite', () => {
  const h = R(officialShape());
  const order = ['① 3대 KPI', '② 종합 KPI', '③ 뒤처진 부분', '④ 팀 진척', '⑤ 팀원 진척', '⑥ 점수 반영 흐름'].map(t => { const i = h.indexOf(t); assert.ok(i >= 0, '없음: ' + t); return i; });
  order.reduce((prev, cur, k) => { assert.ok(cur > prev, '순서 어긋남 ' + k); return cur; }, -1);
  const iCards = h.indexOf('b2bkpi-kpis'), iComp = h.indexOf('종합점수 (반영된 부분)'), iRef = h.indexOf('참고 · 확인분 3개 평균'), iCut = h.indexOf('11월 최신 실적이 아닙니다');
  assert.ok(iCards >= 0 && iCards < iComp, 'KPI 카드가 종합보다 위');
  assert.ok(iCut > iCards && iCut < iComp, '마감 확인분 안내는 카드 바로 아래, 종합 위');
  assert.ok(iRef > iCut && iRef < iComp, '참고 영역도 종합 위');
  assert.ok(h.indexOf('KPI1') < iComp, 'KPI1 이 가장 먼저');
  assert.ok(!h.includes('① 종합 KPI'), '옛 번호 남음');
  assert.ok(!h.includes('마감 확인분은 아래 KPI 카드'), '위치 안내 문구 갱신');
});

// ---- 팀 OS 6메뉴(팀장님 지시문) — 홈은 KPI 카드가 가장 먼저, 점수는 팀원 업무·알람으로 ----
const OS = (() => { const d = load('b2b-kpi-os-data.js'); const c = { module: { exports: {} }, window: { B2BKpiOsData: d } }; vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-os.js', 'utf8'), c); return c.module.exports; })();
const RO = (s, menu) => T.renderHtml(C.buildModel(s, '2026-11'), { state: 'ready', month: '2026-11', os: OS, menu });
test('os_home_kpi_cards_first_then_five_areas', () => {
  const h = RO(officialShape(), undefined);
  const order = ['① 3대 KPI', '② KPI별 행동 진척', '③ 오늘 꼭 할 행동', '④ 빨간 알람·병목', '⑤ 신규·기존 고객 흐름', '⑥ 주간 AI 운영 요약'].map(t => { const i = h.indexOf(t); assert.ok(i >= 0, '없음: ' + t); return i; });
  order.reduce((p, c) => { assert.ok(c > p, '순서'); return c; }, -1);
  assert.ok(h.indexOf('KPI1') < h.indexOf('KPI별 행동 진척'), 'KPI 카드가 가장 먼저');
  ['신규 협약', '기존 고객', '상담·전화', '고객 의견·민원', '팀원 업무·알람'].forEach(t => assert.ok(h.includes(t), '메뉴 없음: ' + t));
  assert.ok(h.includes('10/20 마감 확인분')); assert.ok(h.includes('참고 · 확인분 3개 평균'));
  assert.ok(!h.includes('종합점수 (반영된 부분)'), '점수 영역은 팀원 업무·알람 메뉴로');
});
test('os_tasks_menu_has_templates_and_score_sections_numbered_once', () => {
  const h = RO(officialShape(), 'tasks');
  ['업무 템플릿', '알람 기준', '종합 KPI', '뒤처진 부분', '팀 진척', '팀원 진척', '점수 반영 흐름', '공식 실적 산출 대기'].forEach(t => assert.ok(h.includes(t), '없음: ' + t));
  const heads = (h.match(/<h3>([①②③④⑤⑥⑦])/g) || []).map(x => x.slice(-1));
  assert.equal(new Set(heads).size, heads.length, '번호 중복 ' + heads.join(''));
  assert.ok(!h.includes('① 3대 KPI'), '3대 KPI 카드는 홈에만');
});
test('os_other_menus_render_with_menu_bar', () => {
  [['new', '신규 협약 관리'], ['existing', '기존 고객 활용 현황'], ['consult', '상황별 짧은 대본'], ['feedback', '고객 의견·민원 처리 흐름']].forEach(([m, t]) => {
    const h = RO(officialShape(), m); assert.ok(h.includes(t), m + ' 본문'); assert.equal((h.match(/data-kpi-act="menu"/g) || []).length, 6);
    assert.ok(h.includes('aria-selected="true"'), m + ' 선택 표시');
  });
});
test('os_menu_click_handler_and_wiring', () => {
  assert.ok(tabSrc.includes("act === 'menu'"), '메뉴 클릭 처리');
  assert.ok(html.includes('<script src="b2b-kpi-os-data.js"></script>') && html.includes('<script src="b2b-kpi-os.js"></script>'));
  const d = html.indexOf('<script src="b2b-kpi-os-data.js"></script>'), o = html.indexOf('<script src="b2b-kpi-os.js"></script>'), t = html.indexOf('<script src="b2b-kpi-tab.js"></script>');
  assert.ok(d > 0 && d < o && o < t, '스크립트 순서');
  ['b2b-kpi-os-data.js', 'b2b-kpi-os.js'].forEach(f => new vm.Script(fs.readFileSync(__dirname + '/' + f, 'utf8')));
});
test('os_css_menu_mobile_friendly', () => {
  assert.ok(css.includes('.b2bkpi-menu{') && css.includes('.b2bkpi-menubtn{'));
  assert.ok(/\.b2bkpi-menubtn\{[^}]*min-height:44px/.test(css), '터치 44px');
});
