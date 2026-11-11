// KPI 상세(b2b-kpi-detail.js · b2b-kpi-os.js 의 kpiDetail) — 팀장님이 준 근거 CSV 를 사용자가 직접 고른 파일로 읽어 대상 목록을 만든다.
// 고객 CSV 는 공개 저장소에 넣지 않는다: 시험 자료는 가짜 이름만, 파일은 브라우저 메모리에서만 읽고 어디에도 저장·전송하지 않는다.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const load = (f, extra) => { const c = Object.assign({ module: { exports: {} } }, extra || {}); vm.runInNewContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), c); return c.module.exports; };
const Dt = load('b2b-kpi-detail.js');
const data = load('b2b-kpi-os-data.js');
const O = load('b2b-kpi-os.js', { window: { B2BKpiOsData: data } });
const C = load('b2b-kpi-calc.js');
const F = require('./b2b-kpi.fixture.cjs');
const official = () => { const s = F.base(); s.kpiOfficial = { cutoff: '2026-10-20', note: '확인분', items: { MK1: { num: 1, den: 2, value: 50, unit: '곳', breakdown: [{ key: 'observing', label: '관찰 중 · 분모에 넣지 않음', n: 1, unit: '곳' }] }, MK3: { num: 1, den: 2, value: 50, unit: '기회' }, MK2: { num: 1, den: 2, value: 50, unit: '곳' } } }; return s; };
const model = () => C.buildModel(official(), '2026-11');
const has = (h, a) => a.forEach(t => assert.ok(h.includes(t), '없음: ' + t));

// 가짜 자료(실제 업체 아님)
const CSV1 = '﻿HTML업체명,HTML협약일,통합ID,실제MOU연결,마스터협약일,협약일동일확인,mature_90d,first_activity_in_window,활동소요일,activated_90d,상태,scope,event_ids\r\n' +
  '가나건설,2026-01-10,B1,True,2026-01-10,True,True,2026-02-01,22,True,성숙·기간내 활동 확인,범위,e1\r\n' +
  '다라건설,2026-01-20,B2,True,2026-01-20,True,True,,,False,성숙·기간내 활동 미관측,범위,\r\n' +
  '마바건설,2026-09-20,B3,True,2026-09-20,True,False,2026-10-01,11,True,관찰 미완료,범위,e3\r\n' +
  '"사,아건설",,B4,True,,False,False,,,,명단 연결·협약일 불확정 제외,범위,\r\n';
const CSV2 = 'opportunity_key,통합ID,고객명,단지원문,단지키,공종키,entry_date,first_L2,first_L3,direct_L3,days_to_L3,reached_30d,mature_30d,route,event_ids,source_row_ids\n' +
  'k1,B1,가나건설,햇살아파트,s1,우레탄,2026-03-01,2026-03-01,2026-03-10,False,9,True,True,30일 이내 L3,,\n' +
  'k2,B1,가나건설,달빛아파트,s2,에폭시,2026-03-05,2026-03-05,,False,,False,True,확인자료에 L3 미관측(실패 확정 아님),,\n' +
  'k3,B2,다라건설,별빛아파트,s3,우레탄,2026-10-10,2026-10-10,2026-10-12,True,2,True,False,직접L3,,\n';
const CSV3 = '통합ID,고객명,first_valid_L3_date,첫L3기준,first_L3_sites,first_L3_event_id,reuse_date,reuse_site,reuse_type,reuse_event_id,days_to_reuse,reused_60d,mature_60d,route,source_row_ids\n' +
  'B1,가나건설,2026-03-01,데이터상 첫 유효L3,햇살아파트,x,2026-04-01,새단지,L2,y,31,True,True,60일 이내 재사용,\n' +
  'B2,다라건설,2026-03-01,데이터상 첫 유효L3,달빛아파트,x,,,,,,False,True,확인자료에 타단지 새요청 미관측,\n' +
  'B3,마바건설,2026-10-01,데이터상 첫 유효L3,별빛아파트,x,,,,,,False,False,확인자료에 타단지 새요청 미관측,\n';

test('parseCsv_handles_bom_quotes_crlf', () => {
  const r = Dt.parseCsv(CSV1);
  assert.equal(r.length, 4); assert.equal(r[0]['HTML업체명'], '가나건설'); assert.equal(r[3]['HTML업체명'], '사,아건설');
  assert.equal(Dt.parseCsv('a,b\n1,2\n\n').length, 1);
});
test('analyze_kpi1_counts_match_rules', () => {
  const a = Dt.analyze('MK1', Dt.parseCsv(CSV1));
  assert.equal(a.den, 2); assert.equal(a.num, 1); assert.equal(a.observing, 1); assert.equal(a.excluded, 1); assert.equal(a.total, 4);
  const by = n => a.items.find(i => i.name === n);
  assert.equal(by('가나건설').phase, '기간 종료'); assert.equal(by('가나건설').result, '활동 확인');
  assert.ok(/미관측/.test(by('다라건설').result) && /실패 확정 아님/.test(by('다라건설').result));
  assert.equal(by('마바건설').phase, '관찰 중'); assert.ok(/분모에 넣지 않음/.test(by('마바건설').result), '조기 요청은 분모 밖');
  assert.equal(by('사,아건설').phase, '제외'); assert.ok(/협약일/.test(by('사,아건설').result));
  assert.equal(by('가나건설').start, '2026-01-10'); assert.equal(by('가나건설').end, '2026-04-10'); // 협약+90일
});
test('analyze_kpi2_and_kpi3', () => {
  const a2 = Dt.analyze('MK3', Dt.parseCsv(CSV2));
  assert.equal(a2.den, 2); assert.equal(a2.num, 1); assert.equal(a2.observing, 1); assert.equal(a2.items[0].scope, '햇살아파트 · 우레탄');
  assert.equal(a2.items[0].end, '2026-03-31'); // entry+30
  const a3 = Dt.analyze('MK2', Dt.parseCsv(CSV3));
  assert.equal(a3.den, 2); assert.equal(a3.num, 1); assert.equal(a3.observing, 1);
  assert.ok(a3.items[0].scope.includes('햇살아파트') && a3.items[0].scope.includes('새단지'));
  assert.equal(a3.items[0].end, '2026-04-30'); // 첫 L3+60
});
test('analyze_rejects_wrong_file', () => {
  assert.throws(() => Dt.analyze('MK1', Dt.parseCsv(CSV2)), /열|파일/);
  assert.throws(() => Dt.analyze('MK3', Dt.parseCsv(CSV3)), /열|파일/);
  assert.throws(() => Dt.analyze('MK2', []), /비어/);
});
test('missing_date_is_unconfirmed_not_failure', () => {
  const a = Dt.analyze('MK1', Dt.parseCsv(CSV1)), x = a.items.find(i => i.name === '사,아건설');
  assert.equal(x.start, ''); assert.equal(x.end, '');
  assert.ok(/날짜 미확인|협약일 불확정/.test(x.result));
});

test('kpiDetail_without_file_shows_sections_and_import_button', () => {
  const h = O.kpiDetail(model(), 'MK1', null);
  has(h, ['신규 협약 활용', '관측률', '10/20 마감 확인분', '목표 대비 달성률', '무엇을 세나요', '집계 내역', '관찰 중 · 분모에 넣지 않음 1곳', '행동 기록 수집 전', '대상 목록', 'data-kpi-act="csvPick"', 'data-kpi="MK1"', 'data-kpi-act="kpiBack"', '신규_HTML36_90일.csv']);
  has(h, ['공개 저장소에 올리지 않', '이 화면에서만', '저장·전송하지 않']);
  assert.ok(!h.includes('data-kpi-act="csvClear"'));
});
test('kpiDetail_kpi3_shows_challenge_and_floor_together', () => {
  const h = O.kpiDetail(model(), 'MK2', null);
  has(h, ['도전 95%', '하한 85%', '종합점수 적용 기준: 미확정', '재사용_60일.csv']);
});
test('kpiDetail_with_file_lists_targets_and_check_line', () => {
  const a = Dt.analyze('MK1', Dt.parseCsv(CSV1));
  const h = O.kpiDetail(model(), 'MK1', { file: '신규_HTML36_90일.csv', analysis: a, filter: 'all', page: 0 });
  has(h, ['가나건설', '다라건설', '마바건설', '사,아건설', '관찰 중', '기간 종료', '제외', '파일에서 센 값 1/2', '저장된 확인분 1/2', '일치', 'data-kpi-act="csvClear"', 'data-kpi-act="csvFilter"', '우리 행동 · 기록 수집 전', '담당·다음 행동·다음 확인일 · 미등록']);
});
test('kpiDetail_mismatch_is_flagged_not_hidden', () => {
  const a = Dt.analyze('MK1', Dt.parseCsv(CSV1)); a.num = 5;
  const h = O.kpiDetail(model(), 'MK1', { file: 'f.csv', analysis: a, filter: 'all', page: 0 });
  has(h, ['파일에서 센 값 5/2', '저장된 확인분 1/2', '다릅니다']);
});
test('kpiDetail_filter_and_paging', () => {
  const rows = ['opportunity_key,통합ID,고객명,단지원문,단지키,공종키,entry_date,first_L2,first_L3,direct_L3,days_to_L3,reached_30d,mature_30d,route,event_ids,source_row_ids'];
  for (let i = 0; i < 120; i++) rows.push(`k${i},B${i},가짜${i}건설,단지${i},s,우레탄,2026-03-01,2026-03-01,,False,,False,True,확인자료에 L3 미관측(실패 확정 아님),,`);
  const a = Dt.analyze('MK3', Dt.parseCsv(rows.join('\n')));
  const h0 = O.kpiDetail(model(), 'MK3', { file: 'f', analysis: a, filter: 'all', page: 0 });
  assert.equal((h0.match(/class="b2bkpi-trow is-/g) || []).length, 50); has(h0, ['120건 중 1–50', 'data-kpi-act="csvPage"']);
  const h2 = O.kpiDetail(model(), 'MK3', { file: 'f', analysis: a, filter: 'all', page: 2 });
  assert.equal((h2.match(/class="b2bkpi-trow is-/g) || []).length, 20);
  const hf = O.kpiDetail(model(), 'MK3', { file: 'f', analysis: a, filter: 'observing', page: 0 });
  assert.equal((hf.match(/class="b2bkpi-trow is-/g) || []).length, 0); has(hf, ['해당 항목이 없습니다']);
});
test('kpiDetail_escapes_html_in_file_values', () => {
  const a = Dt.analyze('MK1', Dt.parseCsv(CSV1.replace('가나건설', '<img src=x onerror=1>')));
  const h = O.kpiDetail(model(), 'MK1', { file: 'f<b>.csv', analysis: a, filter: 'all', page: 0 });
  assert.ok(!h.includes('<img src=x') && !h.includes('f<b>'), '이스케이프');
});

// ---- 탭 연결 ----
const tabSrc = fs.readFileSync(__dirname + '/b2b-kpi-tab.js', 'utf8'), html = fs.readFileSync(__dirname + '/index.html', 'utf8'), css = fs.readFileSync(__dirname + '/b2b-kpi-tab.css', 'utf8');
const T = load('b2b-kpi-tab.js');
test('tab_renders_detail_when_ui_detail_set_and_kpi_cards_link_to_it', () => {
  const m = model();
  const home = T.renderHtml(m, { state: 'ready', month: '2026-11', os: O });
  has(home, ['data-kpi-act="kpiDetail"', 'data-kpi="MK1"', 'data-kpi="MK3"', 'data-kpi="MK2"', '상세 보기']);
  const det = T.renderHtml(m, { state: 'ready', month: '2026-11', os: O, detail: 'MK3' });
  has(det, ['문의별 L3 도달', 'data-kpi-act="kpiBack"', '대상 목록']); assert.ok(!det.includes('KPI별 행동 진척'), '상세에서는 홈 영역을 숨김');
  const legacy = T.renderHtml(m, { state: 'ready', month: '2026-11' });
  assert.ok(!legacy.includes('상세 보기'), 'OS 없으면 예전 화면 그대로');
});
test('tab_wiring_csv_stays_in_memory_only', () => {
  ['csvPick', 'csvClear', 'csvFilter', 'csvPage', 'kpiDetail', 'kpiBack'].forEach(k => assert.ok(tabSrc.includes("'" + k + "'") || tabSrc.includes(k + ':'), '핸들러 ' + k));
  assert.ok(tabSrc.includes('FileReader'), '사용자가 고른 파일을 브라우저에서 읽음');
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(.*csv|XMLHttpRequest/.test(tabSrc.slice(tabSrc.indexOf('function readCsvFile'), tabSrc.indexOf('function readCsvFile') + 1500)), '파일 내용을 저장·전송하지 않음');
  const d = html.indexOf('<script src="b2b-kpi-detail.js"></script>'), o = html.indexOf('<script src="b2b-kpi-os.js"></script>'), t = html.indexOf('<script src="b2b-kpi-tab.js"></script>');
  assert.ok(d > 0 && d < t, 'detail 스크립트 순서'); assert.ok(o > 0);
  new vm.Script(fs.readFileSync(__dirname + '/b2b-kpi-detail.js', 'utf8'));
});
test('css_detail_mobile_friendly', () => {
  assert.ok(css.includes('.b2bkpi-trow{')); assert.ok(css.includes('.b2bkpi-filterbtn{'));
  assert.ok(/\.b2bkpi-filterbtn\{[^}]*min-height:44px/.test(css));
});

// ---- 이어 쌓기 화면(KPI 상세) ----
const Ch = load('b2b-kpi-chain.js');
const rep = (over) => Object.assign({ id: 'MK3', cutoff: '2026-10-20', asOf: '2026-11-11', check: true, start: { num: 315, den: 1025, rate: 30.73 }, now: { num: 330, den: 1100, rate: 30 }, added: { num: 15, den: 75 }, observing: 120, observingAtCutoff: 166, ledgerEvents: 1343, cardEvents: 210 }, over || {});
test('analyze_kpi1_attaches_cohort_for_chain', () => {
  const a = Dt.analyze('MK1', Dt.parseCsv(CSV1));
  assert.ok(Array.isArray(a.cohort)); assert.equal(a.cohort.length, 3, '협약일 불확정 제외 업체는 코호트에서 뺌');
  assert.deepEqual(Object.keys(a.cohort[0]).sort(), ['id', 'mou']);
});
test('chain_section_without_ledger_asks_for_file', () => {
  const h = O.kpiDetail(model(), 'MK3', null, { need: 'ledger' });
  has(h, ['이어 쌓기', '기준 원장', '한정정규원장.csv', 'data-kpi-act="ledgerPick"', 'data-kpi="MK3"', '이 화면에서만', '저장·전송하지 않']);
});
test('chain_section_shows_start_added_total_and_check', () => {
  const h = O.kpiDetail(model(), 'MK3', null, { report: rep() });
  has(h, ['시작점', '315/1,025', '30.7%', '이후 새로 성숙', '+15/+75', '누적', '330/1,100', '30.0%', '관찰 중 120', '일치', '10/20', '11/11', '카드 기록 210건', 'data-kpi-act="ledgerClear"']);
  has(h, ['행동(선행)이 올라도', '후행']);
});
test('chain_section_flags_mismatch_and_hides_total', () => {
  const h = O.kpiDetail(model(), 'MK3', null, { report: rep({ check: false, start: { num: 300, den: 1000, rate: 30 } }) });
  has(h, ['기준선과 다릅니다', '누적 값을 쓰지 않습니다']); assert.ok(!h.includes('330/1,100'), '불일치면 누적을 보여주지 않음');
});
test('chain_section_error_and_kpi1_needs_cohort', () => {
  has(O.kpiDetail(model(), 'MK3', null, { error: '원장이 맞지 않습니다' }), ['원장이 맞지 않습니다', 'ledgerPick']);
  has(O.kpiDetail(model(), 'MK1', null, { need: 'cohort' }), ['신규_HTML36_90일.csv', 'csvPick']);
});
test('tab_wiring_ledger_in_memory_and_chain_script', () => {
  ['ledgerPick', 'ledgerClear'].forEach(k => assert.ok(tabSrc.includes(k + ':'), '핸들러 ' + k));
  assert.ok(tabSrc.includes('chainReport') && tabSrc.includes('mapCardEvents'));
  const i = tabSrc.indexOf('function readLedgerFile');
  assert.ok(i > 0 && !/localStorage|sessionStorage|indexedDB|XMLHttpRequest/.test(tabSrc.slice(i, i + 1400)), '원장 내용을 저장·전송하지 않음');
  const c = html.indexOf('<script src="b2b-kpi-chain.js"></script>'), t = html.indexOf('<script src="b2b-kpi-tab.js"></script>'); assert.ok(c > 0 && c < t);
});
