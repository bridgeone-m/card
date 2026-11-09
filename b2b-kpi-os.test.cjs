// 팀 OS 화면(b2b-kpi-os.js) — 팀장님 지시문의 6메뉴·홈 6영역을 실제 값과 함께 그린다. 가짜 0%/100%·확정 이탈 표시 금지.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-os-data.js', 'utf8'), ctx);
const data = ctx.module.exports;
const ctx2 = { module: { exports: {} }, window: { B2BKpiOsData: data } };
vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-os.js', 'utf8'), ctx2);
const O = ctx2.module.exports;
const C = (() => { const c = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-calc.js', 'utf8'), c); return c.module.exports; })();
const F = require('./b2b-kpi.fixture.cjs');
const official = () => { const s = F.base(); s.kpiOfficial = { cutoff: '2026-10-20', note: '확인분', items: { MK1: { num: 8, den: 25, value: 32, unit: '곳', breakdown: [{ key: 'observing', label: '관찰 중 · 분모에 넣지 않음', n: 8, unit: '곳' }] }, MK3: { num: 315, den: 1025, value: 30.73, unit: '기회' }, MK2: { num: 44, den: 79, value: 55.7, unit: '곳' } } }; return s; };
const model = (meeting) => { const m = C.buildModel(official(), '2026-11'); m.meeting = meeting || null; return m; };
const meetingWith = (rows) => ({ rows, summary: { all: { m1: { due: 1, judged: 1, ontime: 0, late: 0, missed: 1, rate: 0 }, m2: {} }, new: { m1: {}, m2: {} } }, rule: { start: '8/21', grace: 3, reg: 14, now: '2026-11-10' } });
const has = (h, arr) => arr.forEach(t => assert.ok(h.includes(t), '없음: ' + t));

test('data_has_29_templates_and_6_menus', () => {
  assert.equal(data.templates.length, 29); assert.equal(data.menus.length, 6);
  assert.deepEqual(Array.from(data.menus.map(m => m.label)), ['홈', '신규 협약', '기존 고객', '상담·전화', '고객 의견·민원', '팀원 업무·알람']);
  assert.ok(!data.menus.some(m => /문의·지원/.test(m.label)), '문의·지원 메뉴는 없어야 함');
  assert.equal(data.templates.filter(t => t.hypothesis).length, 5);
});
test('menu_bar_has_six_buttons_and_marks_active', () => {
  const h = O.menuBar('new');
  assert.equal((h.match(/data-kpi-act="menu"/g) || []).length, 6);
  has(h, ['홈', '신규 협약', '기존 고객', '상담·전화', '고객 의견·민원', '팀원 업무·알람']);
  assert.ok(/aria-selected="true"[^>]*>신규 협약|신규 협약<\/button>/.test(h));
  assert.equal((h.match(/aria-selected="true"/g) || []).length, 1);
});
test('home_blocks_have_five_areas_and_no_fake_numbers', () => {
  const h = O.homeBlocks(model());
  has(h, ['KPI별 행동 진척', '행동 기록 수집 전', '오늘 꼭 할 행동', '빨간 알람·병목', '신규·기존 고객 흐름', '주간 AI 운영 요약', '미연동']);
  assert.ok(!/행동 이행률\s*0%|이행률 100%/.test(h), '가짜 0%/100% 금지');
  has(h, ['최근 90일 L2·L3 미관측', '166곳', '이탈 확정이 아닙니다']);
  has(h, ['우리 지원 지연', '고객 일정 대기']);
});
test('home_today_actions_list_real_missed_meetings', () => {
  const rows = [{ id: 'a', name: '테스트건설', stage: 'm1', stageName: '1차 미팅', cls: 'missed', inScope: true, due: '2026-10-01', owner: '', group: 'new' }, { id: 'b', name: '정상건설', stage: 'm1', stageName: '1차 미팅', cls: 'ontime', inScope: true, due: '2026-10-02', owner: '신한솔', group: 'all' }];
  const h = O.homeBlocks(model(meetingWith(rows)));
  has(h, ['테스트건설', '1차 미팅', '기한 2026-10-01', '담당 기록 없음']);
  assert.ok(!h.includes('정상건설'), '정상 처리 업체는 행동 목록에 없음');
  has(h, ['미팅 미처리 누락 1곳', 'data-kpi-act="meetingList"']);
});
test('home_today_actions_empty_state_points_to_templates', () => {
  const h = O.homeBlocks(model(meetingWith([])));
  has(h, ['등록된 오늘 업무가 없습니다', '업무 템플릿 보기', 'data-menu="tasks"']);
});
test('home_alerts_include_kpi3_floor_and_stale_cutoff', () => {
  const h = O.homeBlocks(model());
  has(h, ['하한 85% 미달', '10/20 마감', '다음 행동']); assert.ok(!/하한까지 -/.test(h), '음수 부족폭 금지');
});
test('new_view_stages_and_templates', () => {
  const h = O.newView(model());
  has(h, ['협약 전 준비', '체결·서명본', '웰컴 전달', '첫 요청', '90일 결과·후속', 'M01', 'M06', '8/25 곳', '관찰 중 · 분모에 넣지 않음 8곳']);
  has(h, ['웰컴은 요청이 없어도', '자동 해지가 아닙니다']);
  assert.ok(!/HB01|HA01/.test(h), '신규 화면에 기존 고객 템플릿 없음');
});
test('existing_view_baseline_and_abc', () => {
  const h = O.existingView(model());
  has(h, ['실제 MOU 272곳', '연결 270곳', '유효 L2 973', '유효 L3 373', '166곳', '이탈 확정이 아닙니다', 'A 확장', 'B 한 장 교체', 'C 재시작', 'R09', 'HA01', '미분류']);
  has(h, ['315/1,025', '44/79']);
});
test('consult_view_scripts_buttons_forbidden', () => {
  const h = O.consultView();
  has(h, ['웰컴 — 첫 도움 하나', '연락됨', '연락 안 됨', '부서 확인', '고객이 말한 핵심', '다음 행동', '다음 확인일', '금지 약속', '자동 해지', 'C01']);
  assert.equal((h.match(/class="b2bkpi-script"/g) || []).length, 6);
});
test('feedback_view_flow_and_v_templates', () => {
  const h = O.feedbackView();
  has(h, ['접수', '책임 부서', '회신', '고객 해결 확인', '재열기', '부서 완료와 고객 해결은 다릅니다', 'V01', 'V04']);
});
test('tasks_view_templates_grouped_by_primary_kpi', () => {
  const h = O.tasksView('<div id="score-slot">점수</div>');
  has(h, ['업무 템플릿', '업무 실체·과거 이력이 아닙니다', 'KPI1 신규 협약 활용', 'KPI2 문의별 L3 도달', 'KPI3 다른 단지 재사용', '추가 가설', 'score-slot', '알람 기준']);
  assert.equal((h.match(/class="b2bkpi-tpl"/g) || []).length, 29);
});
test('view_dispatch_covers_all_menus', () => {
  ['home', 'new', 'existing', 'consult', 'feedback', 'tasks'].forEach(id => assert.equal(typeof O.view(id, model(), '').length, 'number'));
  assert.equal(O.view('nope', model(), ''), O.view('home', model(), ''));
});
