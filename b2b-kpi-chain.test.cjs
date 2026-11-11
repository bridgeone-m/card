// 이어 쌓기 계산(b2b-kpi-chain.js) — 팀장님 정의(고객여정/기준.md): 같은 시공사·단지·공종 기회, 성숙·관찰 구분, 관찰 중은 분모 밖.
// 시험 자료는 전부 가짜 이름이다.
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-chain.js', 'utf8'), ctx);
const K = ctx.module.exports;
const ev = (co, site, trade, date, kind) => ({ co, site, trade, date, kind });

test('kstDay_converts_utc_to_korea_date', () => {
  assert.equal(K.kstDay('2026-09-01T15:00:00.000Z'), '2026-09-02'); // 한국 자정
  assert.equal(K.kstDay('2026-09-01T14:59:00.000Z'), '2026-09-01');
  assert.equal(K.kstDay('2026-10-02'), '2026-10-02');
  assert.equal(K.kstDay(''), ''); assert.equal(K.kstDay('abc'), '');
});
test('normalizers_only_clean_spaces_and_order', () => {
  assert.equal(K.normSite(' 햇살 아파트(주) '), K.normSite('햇살아파트'));
  assert.notEqual(K.normSite('햇살아파트'), K.normSite('햇살'), '단어를 지우거나 별칭을 합치지 않음');
  assert.equal(K.normTrade('우레탄+에폭시'), K.normTrade('에폭시 / 우레탄'));
  assert.notEqual(K.normTrade('우레탄'), K.normTrade('폴리우레아'), '공법 동의어를 만들지 않음');
});
test('buildEvents_maps_sheet_rows_and_marks_unusable', () => {
  const rows = [
    { sourceSheet: '기술자문문의', companyId: 'c1', siteName: '햇살', requestDate: '2026-03-01T15:00:00.000Z', summary: '브랜드: 공법 · 현장명: 햇살 · 공종: 우레탄 · 상태: 접수' },
    { sourceSheet: '컨설팅요청_통합', companyId: 'c1', siteName: '햇살', requestDate: '2026-03-10T15:00:00.000Z', summary: '순번: 1 · 현장명: 햇살 · 공종별: 우레탄' },
    { sourceSheet: '공법설명회이력', companyId: 'c1', siteName: '햇살', requestDate: '2026-03-12T15:00:00.000Z', summary: '공종: 우레탄 · 현장명: 햇살 · 요청일: 2026-04-02 10:00' },
    { sourceSheet: '샘플카달로그요청', companyId: 'c1', siteName: '', requestDate: '2026-03-12T15:00:00.000Z', summary: '받는분: 가' },
    { sourceSheet: '기술자문문의', companyId: '', siteName: '달빛', requestDate: '2026-03-01T15:00:00.000Z', summary: '공종: 우레탄' },
    { sourceSheet: '기술자문문의', companyId: 'c2', siteName: '달빛', requestDate: '', summary: '공종: 우레탄' },
    { sourceSheet: '기술자문문의', companyId: 'c3', siteName: '', requestDate: '2026-03-01T15:00:00.000Z', summary: '공종: 우레탄' }
  ];
  const r = K.buildEvents(rows);
  assert.equal(r.events.length, 3);
  assert.deepEqual(Array.from(r.events.map(e => e.kind)), ['L2', 'L3', 'L3']);
  assert.equal(r.events[0].date, '2026-03-02'); assert.equal(r.events[2].date, '2026-03-13', 'PT 는 요청일(예정일)이 아니라 등록일(requestDate)');
  assert.equal(r.skipped.sample, 1, '샘플·카탈로그는 L3 가 아님'); assert.equal(r.skipped.noCompany, 1); assert.equal(r.skipped.noDate, 1); assert.equal(r.skipped.noSiteOrTrade, 1);
});
test('kpi2_reached_direct_and_observing', () => {
  const E = [
    ev('a', 's1', 't', '2026-03-01', 'L2'), ev('a', 's1', 't', '2026-03-20', 'L3'),      // 19일 → 도달
    ev('b', 's2', 't', '2026-03-01', 'L2'), ev('b', 's2', 't', '2026-04-15', 'L3'),      // 45일 → 늦음(도달 아님)
    ev('c', 's3', 't', '2026-03-05', 'L3'),                                             // 직접 L3 → 도달
    ev('d', 's4', 't', '2026-03-05', 'L2'),                                             // L3 없음 → 미도달
    ev('e', 's5', 't', '2026-10-10', 'L2'),                                             // 관찰 중
    ev('f', 's6', 't', '2026-03-05', 'L3'), ev('f', 's6', 't', '2026-03-10', 'L2')       // L3 가 먼저 → 직접
  ];
  const r = K.kpi2(E, '2026-10-20');
  assert.equal(r.den, 5); assert.equal(r.num, 3); assert.equal(r.observing, 1); assert.equal(r.direct, 2);
  assert.equal(K.kpi2(E, '2026-10-20').late31to60, 1);
});
test('kpi2_maturity_boundary_matches_baseline_rule', () => {
  // 기준선: 마감 10/20 이면 진입 ≤ 9/19 성숙(진입+30일=10/19, 다음 날 판정)
  const mk = d => [ev('a', 's', 't', d, 'L2')];
  assert.equal(K.kpi2(mk('2026-09-19'), '2026-10-20').den, 1);
  assert.equal(K.kpi2(mk('2026-09-20'), '2026-10-20').den, 0);
  assert.equal(K.kpi2(mk('2026-09-20'), '2026-10-20').observing, 1);
  assert.equal(K.kpi2(mk('2026-09-20'), '2026-10-21').den, 1, '하루 지나면 성숙');
});
test('kpi2_ignores_events_after_asof', () => {
  const E = [ev('a', 's', 't', '2026-09-01', 'L2'), ev('a', 's', 't', '2026-10-25', 'L3')];
  const r = K.kpi2(E, '2026-10-20');
  assert.equal(r.den, 1); assert.equal(r.num, 0, '마감 이후 L3 는 쓰지 않음');
});
test('kpi3_reuse_other_site_within_60_days', () => {
  const E = [
    ev('a', 's1', 't', '2026-05-01', 'L3'), ev('a', 's2', 't', '2026-06-01', 'L2'),   // 31일, 다른 단지 → 재사용
    ev('b', 's1', 't', '2026-05-01', 'L3'), ev('b', 's1', 't2', '2026-05-20', 'L2'),  // 같은 단지 다른 공종 → 아님
    ev('c', 's1', 't', '2026-05-01', 'L3'), ev('c', 's2', 't', '2026-08-01', 'L2'),   // 92일 → 늦음
    ev('d', 's1', 't', '2026-09-20', 'L3'),                                           // 관찰 중
    ev('e', 's1', 't', '2026-05-01', 'L3'), ev('e', 's2', 't', '2026-05-02', 'L3'), ev('e', 's2', 't', '2026-05-03', 'L2')
  ];
  const r = K.kpi3(E, '2026-10-20');
  assert.equal(r.den, 4); assert.equal(r.num, 2); assert.equal(r.observing, 1); assert.equal(r.late61to90 + r.late90plus, 1);
});
test('kpi3_boundary', () => {
  const mk = d => [ev('a', 's1', 't', d, 'L3')];
  assert.equal(K.kpi3(mk('2026-08-20'), '2026-10-20').den, 1); assert.equal(K.kpi3(mk('2026-08-21'), '2026-10-20').den, 0);
});
test('kpi1_window_minus90_to_plus89_and_maturity', () => {
  const co = [
    { id: 'a', mou: '2026-03-01' }, { id: 'b', mou: '2026-03-01' }, { id: 'c', mou: '2026-09-01' }, { id: 'd', mou: '' }, { id: 'e', mou: '2026-03-01' }
  ];
  const E = [
    ev('a', 's', 't', '2026-02-01', 'L2'),   // 협약 전 28일 → 인정
    ev('b', 's', 't', '2026-06-10', 'L2'),   // +101일 → 창 밖
    ev('c', 's', 't', '2026-09-05', 'L2'),   // 관찰 중 → 분모 밖
    ev('e', 's', 't', '2025-11-01', 'L3')    // -121일 → 창 밖
  ];
  const r = K.kpi1(co, E, '2026-10-20');
  assert.equal(r.den, 3); assert.equal(r.num, 1); assert.equal(r.observing, 1); assert.equal(r.unconfirmed, 1);
  assert.equal(K.kpi1([{ id: 'a', mou: '2026-07-22' }], [], '2026-10-20').den, 1, 'D+90 ≤ 마감이면 성숙');
  assert.equal(K.kpi1([{ id: 'a', mou: '2026-07-23' }], [], '2026-10-20').observing, 1);
});
test('chain_adds_new_matured_only_after_cutoff', () => {
  // 기준선 + 10/20 이후 새로 성숙한 건만 더한다(기준선 건은 날짜로 겹치지 않게 나눔)
  const E = [ev('a', 's', 't', '2026-09-10', 'L2'), ev('a', 's', 't', '2026-09-20', 'L3'), ev('b', 's', 't', '2026-09-25', 'L2'), ev('c', 's', 't', '2026-10-30', 'L2')];
  const base = { num: 315, den: 1025 }, cut = '2026-10-20', asOf = '2026-11-10';
  const r = K.chainKpi2(E, base, cut, asOf);
  assert.equal(r.added.den, 1, '9/25 진입만 11/10 에 새로 성숙(9/10 건은 기준선 쪽)'); assert.equal(r.added.num, 0);
  assert.equal(r.total.den, 1026); assert.equal(r.total.num, 315);
  assert.equal(r.observing, 1);
  assert.ok(Math.abs(r.total.rate - 315 / 1026 * 100) < 1e-9);
});
test('kpi2_same_day_l2_and_l3_is_reached_not_direct', () => {
  // 기준선(기회_30일): 같은 날 L2 와 L3 는 '30일 이내 L3'(0일) — 직접 L3 가 아님
  const r = K.kpi2([ev('a', 's', 't', '2026-03-01', 'L2'), ev('a', 's', 't', '2026-03-01', 'L3')], '2026-10-20');
  assert.equal(r.num, 1); assert.equal(r.den, 1); assert.equal(r.direct, 0);
});

// ---- 이어 쌓기 보고(chainReport) · 카드 기록 연결(mapCardEvents) ----
test('mapCardEvents_links_by_company_code_and_counts_unlinked', () => {
  const rows = [
    { sourceSheet: '기술자문문의', companyId: 'id1', siteName: '햇살', requestDate: '2026-10-29T15:00:00.000Z', summary: '공종: 우레탄' },
    { sourceSheet: '기술자문문의', companyId: 'id9', siteName: '달빛', requestDate: '2026-10-29T15:00:00.000Z', summary: '공종: 우레탄' }
  ];
  const r = K.mapCardEvents(rows, [{ id: 'id1', code: 'B2B001' }, { id: 'id9', code: '' }]);
  assert.equal(r.events.length, 1); assert.equal(r.events[0].co, 'B2B001'); assert.equal(r.events[0].date, '2026-10-30'); assert.equal(r.unlinked, 1);
});
test('chainReport_start_equals_base_then_adds_new_matured', () => {
  // 마감 10/20: Z(3/1 진입, L3 없음)만 성숙. A(9/25)·B(10/05)는 관찰 중 → 11/11 에 새로 성숙(진입+31일 ≤ 기준일)
  const ledger = [ev('A', 's1', 't', '2026-09-25', 'L2'), ev('A', 's1', 't', '2026-10-15', 'L3'), ev('B', 's2', 't', '2026-10-05', 'L2'), ev('Z', 's9', 't', '2026-03-01', 'L2')];
  const card = [ev('B', 's2', 't', '2026-10-30', 'L3'), ev('A', 's1', 't', '2026-09-01', 'L2')]; // 마감 이전 카드 기록은 원장이 기준이라 무시
  const base = { num: 0, den: 1 };
  const r = K.chainReport('MK3', { ledgerEvents: ledger, cardEvents: card, cutoff: '2026-10-20', asOf: '2026-11-11', base });
  assert.equal(r.check, true, '마감 시점 재계산 = 기준선'); assert.equal(r.start.den, 1); assert.equal(r.start.num, 0); assert.equal(r.observingAtCutoff, 2);
  assert.equal(r.now.den, 3); assert.equal(r.now.num, 2, 'A 는 20일, B 는 카드의 L3(10/30)로 25일에 도달');
  assert.equal(r.added.den, 2); assert.equal(r.added.num, 2);
});
test('chainReport_detects_mismatch_with_stored_base', () => {
  const r = K.chainReport('MK3', { ledgerEvents: [ev('Z', 's', 't', '2026-03-01', 'L2')], cardEvents: [], cutoff: '2026-10-20', asOf: '2026-11-11', base: { num: 5, den: 9 } });
  assert.equal(r.check, false);
});
test('chainReport_kpi1_uses_cohort_and_card_events', () => {
  const cohort = [{ id: 'C1', mou: '2026-07-25' }, { id: 'C2', mou: '2026-03-01' }];
  const r = K.chainReport('MK1', { ledgerEvents: [ev('C2', 's', 't', '2026-02-01', 'L2')], cardEvents: [ev('C1', 's', 't', '2026-10-21', 'L2')], cutoff: '2026-10-20', asOf: '2026-11-11', base: { num: 1, den: 1 }, cohort });
  assert.equal(r.check, true); assert.equal(r.start.den, 1); assert.equal(r.now.den, 2, 'C1 은 D+90(10/23)이 지나 새로 성숙'); assert.equal(r.now.num, 2); assert.equal(r.added.num, 1);
});
test('ledgerEvents_reads_baseline_ledger_columns_and_rejects_wrong_file', () => {
  const D = (() => { const c = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-detail.js', 'utf8'), c); return c.module.exports; })();
  const csv = '통합ID,단지키,공종키,사건유형,사건일,시간KPI유효,고객명원문\nB2B001,햇살,우레탄,L2,2026-03-01,True,가나건설\nB2B001,햇살,우레탄,L3요청,2026-03-10,True,가나건설\nB2B002,달빛,에폭시,L2,2026-03-01,False,다라건설\nB2B003,,에폭시,L2,2026-03-01,True,마바건설\n';
  const r = K.ledgerEvents(D.parseCsv(csv));
  assert.equal(r.events.length, 2); assert.deepEqual(Array.from(r.events.map(e => e.kind)), ['L2', 'L3']); assert.equal(r.events[0].co, 'B2B001'); assert.equal(r.skipped, 2);
  assert.throws(() => K.ledgerEvents(D.parseCsv('a,b\n1,2\n')), /원장|열/);
  assert.throws(() => K.ledgerEvents([]), /비어/);
});
