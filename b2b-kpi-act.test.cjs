// 행동 기록(b2b-kpi-act.js) — 한 줄 드롭다운 기록: 항목은 모두 팀장님 파일(안내서 운영 12가지·결과 9·막힘 8)에서 온다. 시험 자료는 가짜 이름만.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const load = f => { const c = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), c); return c.module.exports; };
const D = load('b2b-kpi-os-data.js'), A = load('b2b-kpi-act.js');
const NOW = '2026-11-11T16:30:00.000Z'; // 한국 시각 11/12 01:30
const ctx = { by: '사용자 1', now: NOW, data: D };

test('data_has_12_ops_12_build_and_dropdown_sources', () => {
  assert.equal(D.ops.length, 12); assert.equal(D.build.length, 12);
  assert.deepEqual(Array.from(D.ops.map(o => o.id)), ['O11', 'O12', 'O13', 'O14', 'O21', 'O22', 'O23', 'O24', 'O31', 'O32', 'O33', 'O34']);
  assert.equal(D.ops.filter(o => o.kpi === 'MK1').length, 4); assert.equal(D.ops.filter(o => o.kpi === 'MK3').length, 4); assert.equal(D.ops.filter(o => o.kpi === 'MK2').length, 4);
  assert.equal(D.resultButtons.length, 9); assert.equal(D.blockCodes.length, 8);
});
test('newRecord_builds_record_with_korea_day_and_primary_kpi', () => {
  const r = A.newRecord({ opsId: 'O12', result: '연락됨', block: '', nextCheck: '2026-11-18' }, ctx);
  assert.equal(r.kind, 'b2bAction'); assert.equal(r.opsId, 'O12'); assert.equal(r.kpi, 'MK1'); assert.equal(r.by, '사용자 1'); assert.equal(r.at, NOW);
  assert.equal(r.day, '2026-11-12', '한국 달력일'); assert.equal(r.nextCheck, '2026-11-18'); assert.ok(/^ba_/.test(r.id));
  assert.equal(A.newRecord({ opsId: 'O31', result: '불편', block: '지원 지연', nextCheck: '' }, ctx).kpi, 'MK2');
});
test('newRecord_validates_only_dropdown_values', () => {
  const bad = (x, re) => assert.throws(() => A.newRecord(Object.assign({ opsId: 'O12', result: '연락됨', block: '', nextCheck: '' }, x), ctx), re);
  bad({ opsId: '' }, /행동/); bad({ opsId: 'O99' }, /행동/); bad({ result: '' }, /결과/); bad({ result: '아무거나' }, /결과/);
  bad({ block: '임의 이유' }, /막힌 이유/); bad({ nextCheck: '내일' }, /날짜/); bad({ nextCheck: '2026-13-40' }, /날짜/);
});
test('append_blocks_duplicate_click_same_day', () => {
  const r1 = A.newRecord({ opsId: 'O12', result: '연락됨', block: '', nextCheck: '2026-11-18' }, ctx);
  const a = A.append([], r1); assert.equal(a.added, true); assert.equal(a.list.length, 1);
  const r2 = A.newRecord({ opsId: 'O12', result: '연락됨', block: '', nextCheck: '2026-11-18' }, Object.assign({}, ctx, { now: '2026-11-11T16:31:00.000Z' }));
  const b = A.append(a.list, r2); assert.equal(b.added, false); assert.equal(b.dup, true); assert.equal(b.list.length, 1, '중복 클릭은 기록을 늘리지 않음');
  const r3 = A.newRecord({ opsId: 'O12', result: '연락 안 됨', block: '', nextCheck: '2026-11-18' }, ctx);
  assert.equal(A.append(a.list, r3).added, true, '결과가 다르면 새 기록');
  const next = A.newRecord({ opsId: 'O12', result: '연락됨', block: '', nextCheck: '2026-11-18' }, Object.assign({}, ctx, { now: '2026-11-12T16:00:00.000Z' }));
  assert.equal(A.append(a.list, next).added, true, '다음 날은 새 기록');
});
test('append_does_not_mutate_input_and_keeps_old_records', () => {
  const old = [{ id: 'x', kind: 'b2bAction', key: 'k' }]; const copy = JSON.stringify(old);
  A.append(old, A.newRecord({ opsId: 'O11', result: '연락됨', block: '', nextCheck: '' }, ctx));
  assert.equal(JSON.stringify(old), copy);
});
test('flatten_reads_company_b2bActions_only', () => {
  const cos = [{ id: 'c1', name: '가나건설', b2bActions: [A.newRecord({ opsId: 'O12', result: '연락됨', block: '', nextCheck: '' }, ctx)] }, { id: 'c2', name: '다라건설' }, { id: 'c3', name: '마바건설', b2bActions: 'broken' }];
  const f = A.flatten(cos); assert.equal(f.length, 1); assert.equal(f[0].companyId, 'c1'); assert.equal(f[0].companyName, '가나건설');
});
test('summarize_counts_month_records_and_build_progress_per_kpi', () => {
  const mk = (opsId, day, result) => Object.assign(A.newRecord({ opsId, result: result || '연락됨', block: '', nextCheck: '' }, ctx), { day });
  const recs = [mk('O12', '2026-11-12'), mk('O13', '2026-11-05'), mk('O22', '2026-11-03'), mk('O12', '2026-10-30'), mk('O31', '2026-11-01')].map((r, i) => Object.assign({ companyId: 'c' + i, companyName: 'n' + i }, r));
  const s = A.summarize(recs, { B11: 'done', B12: 'doing', B21: 'done', B22: 'done' }, '2026-11', D);
  assert.equal(s.perKpi.MK1.records, 2); assert.equal(s.perKpi.MK3.records, 1); assert.equal(s.perKpi.MK2.records, 1); assert.equal(s.total.records, 4);
  assert.equal(s.perKpi.MK1.buildDone, 1); assert.equal(s.perKpi.MK1.buildDoing, 1); assert.equal(s.perKpi.MK1.buildTotal, 4); assert.equal(s.perKpi.MK3.buildDone, 2);
  assert.equal(s.total.buildDone, 3); assert.equal(s.total.buildTotal, 12);
  assert.equal(s.recent.length, 4); assert.equal(s.recent[0].day, '2026-11-12', '최근 순');
  assert.equal(A.summarize([], {}, '2026-11', D).total.records, 0);
});
test('nextBuildState_cycles_todo_doing_done', () => {
  assert.equal(A.nextBuildState('todo'), 'doing'); assert.equal(A.nextBuildState('doing'), 'done'); assert.equal(A.nextBuildState('done'), 'todo'); assert.equal(A.nextBuildState(undefined), 'doing');
});
test('record_has_no_customer_name_and_only_dropdown_fields', () => {
  const r = A.newRecord({ opsId: 'O12', result: '연락됨', block: '', nextCheck: '' }, ctx);
  assert.deepEqual(Object.keys(r).sort(), ['at', 'block', 'by', 'day', 'id', 'key', 'kind', 'kpi', 'nextCheck', 'opsId', 'result']);
});

// ---- 화면(b2b-kpi-os.js) · 탭 연결 ----
const html = fs.readFileSync(__dirname + '/index.html', 'utf8'), css = fs.readFileSync(__dirname + '/b2b-kpi-tab.css', 'utf8'), tabSrc = fs.readFileSync(__dirname + '/b2b-kpi-tab.js', 'utf8');
const O = (() => { const c = { module: { exports: {} }, window: { B2BKpiOsData: D } }; vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-os.js', 'utf8'), c); return c.module.exports; })();
const C = load('b2b-kpi-calc.js'), F = require('./b2b-kpi.fixture.cjs');
const model = () => C.buildModel(F.base(), '2026-11');
const rec = (opsId, day, result) => Object.assign({ companyId: 'c1', companyName: '가나건설' }, A.newRecord({ opsId, result: result || '연락됨', block: '', nextCheck: '2026-11-18' }, ctx), { day });
const actCtx = (over) => Object.assign({ companies: [{ id: 'c1', name: '가나건설' }, { id: 'c2', name: '다라건설' }], build: { B11: 'done', B12: 'doing' }, form: {}, flash: null, month: '2026-11',
  summary: A.summarize([rec('O12', '2026-11-12'), rec('O31', '2026-11-10', '불편')], { B11: 'done', B12: 'doing' }, '2026-11', D) }, over || {});
const has = (h, a) => a.forEach(t => assert.ok(h.includes(t), '없음: ' + t));
test('tasks_view_shows_build_checklist_form_and_month_records', () => {
  const h = O.tasksView('<div>점수</div>', actCtx());
  has(h, ['구축 — 한 번만 하는 일', '기본 웰컴 묶음 만들기', '구축 1/4', 'data-kpi-act="buildToggle"', 'data-b="B11"', 'data-s="done"', '고객별 행동 기록', 'data-act-field="customer"', 'data-act-field="opsId"', 'data-act-field="result"', 'data-act-field="block"', 'data-act-field="nextCheck"', 'type="date"', 'data-kpi-act="actSave"', '이번 달 기록', '가나건설', '다음 11/18']);
  has(h, ['웰컴과 첫 도움 하나를 전달한다', '지원 전달 후 사용 상태를 가볍게 확인한다', '연락됨', '부서 확인', '자료 교체 부담', '일정·시즌 대기']);
  has(h, ['이번 달 행동 기록 2건', '구축 1/12']);
});
test('form_options_come_only_from_team_files', () => {
  const h = O.tasksView('', actCtx());
  const opts = sel => { const m = new RegExp('data-act-field="' + sel + '"[^>]*>([^]*?)</select>').exec(h); return (m[1].match(/<option/g) || []).length; };
  assert.equal(opts('opsId'), 12 + 1, '행동 12 + 안내'); assert.equal(opts('result'), 9 + 1); assert.equal(opts('block'), 8 + 1);
  assert.ok(!/<textarea|type="text"/.test(h.slice(h.indexOf('고객별 행동 기록'), h.indexOf('이번 달 기록'))), '글로 쓰는 칸 없음');
});
test('form_keeps_selected_values_and_shows_flash', () => {
  const h = O.tasksView('', actCtx({ form: { customer: 'c2', opsId: 'O22', result: '자료 필요', block: '지원 지연', nextCheck: '2026-12-01' }, flash: { kind: 'ok', text: '저장했습니다' } }));
  assert.ok(/<option value="c2" selected/.test(h)); assert.ok(/<option value="O22" selected/.test(h)); assert.ok(/<option value="자료 필요" selected/.test(h)); assert.ok(h.includes('value="2026-12-01"')); has(h, ['저장했습니다']);
});
test('tasks_view_without_act_keeps_old_layout', () => {
  const h = O.tasksView('<div>점수</div>'); has(h, ['업무 템플릿', '알람 기준']); assert.ok(!h.includes('data-kpi-act="actSave"'));
});
test('home_progress_shows_counts_when_records_exist_else_old_text', () => {
  const withAct = O.homeBlocks(model(), actCtx()); has(withAct, ['이번 달 행동 기록', '구축 1/4', '행동 기록하기', 'data-menu="tasks"']);
  const empty = O.homeBlocks(model(), actCtx({ summary: A.summarize([], {}, '2026-11', D), build: {} })); has(empty, ['행동 기록 수집 전']);
  has(O.homeBlocks(model()), ['행동 기록 수집 전']);
});
test('record_list_escapes_names', () => {
  const r = Object.assign(rec('O12', '2026-11-12'), { companyName: '<img src=x onerror=1>' });
  const h = O.tasksView('', actCtx({ summary: A.summarize([r], {}, '2026-11', D) })); assert.ok(!h.includes('<img src=x'));
});
test('tab_wiring_act_handlers_and_scripts', () => {
  ['actSave', 'buildToggle'].forEach(k => assert.ok(tabSrc.includes(k + ':'), '핸들러 ' + k));
  assert.ok(tabSrc.includes('data-act-field') && tabSrc.includes('updateCompany') && tabSrc.includes('b2bActions') && tabSrc.includes('setBuildState'));
  const a = html.indexOf('<script src="b2b-kpi-act.js"></script>'), t = html.indexOf('<script src="b2b-kpi-tab.js"></script>'); assert.ok(a > 0 && a < t, '스크립트 순서');
  new vm.Script(fs.readFileSync(__dirname + '/b2b-kpi-act.js', 'utf8'));
  assert.ok(!/localStorage\.setItem|sessionStorage|indexedDB/.test(tabSrc.slice(tabSrc.indexOf('actSave:'), tabSrc.indexOf('actSave:') + 1800)), '브라우저 저장소에 따로 저장하지 않음');
});
test('tab_renders_act_panel_in_tasks_menu_and_home_progress', () => {
  const T = load('b2b-kpi-tab.js'); const OS = O;
  const h = T.renderHtml(model(), { state: 'ready', month: '2026-11', os: OS, menu: 'tasks', act: actCtx() }); has(h, ['구축 — 한 번만 하는 일', '고객별 행동 기록']);
  const heads = (h.match(/<h3>([①②③④⑤⑥⑦⑧⑨⑩])/g) || []).map(x => x.slice(-1)); assert.equal(new Set(heads).size, heads.length, '번호 중복 ' + heads.join(''));
  const home = T.renderHtml(model(), { state: 'ready', month: '2026-11', os: OS, act: actCtx() }); has(home, ['이번 달 행동 기록']);
});
test('css_act_mobile_friendly', () => { assert.ok(css.includes('.b2bkpi-actform{')); assert.ok(/\.b2bkpi-actform select[^{]*\{[^}]*min-height:44px/.test(css)); });
