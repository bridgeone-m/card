// 신한솔 개인 KPI 자동 실측(b2b-kpi-personal.js) — LI02 미회신 재안내 · LI03 신규 3일 첫 조치 · LI04 핵심정보 완비(가짜 업체만)
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const mc = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-personal.js', 'utf8'), mc); const P = mc.module.exports;
const NOW = new Date(2026, 10, 16, 12).getTime(), DAY = 86400000;
const iso = (y, m, d, h) => new Date(y, m - 1, d, h || 10).toISOString();
const mail = (type, at, status) => ({ mailType: type, status: status || 'sent', sentAt: at });
const acts = {};
const actsOf = id => acts[id] || [];
const ctx = { now: NOW, replyTs: co => co._reply ? new Date(co._reply).getTime() : null, mouDone: co => !!co._mou };

test('LI03: 8/26 이후 등록 업체만, 3일 안 첫 조치(메일·단계 등록·직접 활동), 등록 월로 집계', () => {
  acts.a3 = [{ activityText: '전화 상담', createdAt: iso(2026, 10, 3) }];
  acts.a4 = [{ activityText: '시트 요청', createdAt: iso(2026, 10, 2), source: 'google-sheets-request' }];   // 가져온 기록은 조치 아님
  const cos = [
    { id: 'a1', name: '메일업체', createdAt: iso(2026, 9, 10), m1MailLog: [mail('questionnaire', iso(2026, 9, 10, 15))] },
    { id: 'a2', name: '단계등록', createdAt: iso(2026, 9, 12), partnerDashboard: { stageCorrections: { qSend: { correctedAt: iso(2026, 9, 14) } } } },
    { id: 'a3', name: '활동', createdAt: iso(2026, 10, 1) },
    { id: 'a4', name: '가져온기록만', createdAt: iso(2026, 10, 1) },
    { id: 'a5', name: '늦은조치', createdAt: iso(2026, 10, 1), m1MailLog: [mail('firstMeeting', iso(2026, 10, 9))] },
    { id: 'a6', name: '일괄등록', createdAt: iso(2026, 8, 25), m1MailLog: [mail('firstMeeting', iso(2026, 8, 25))] },
    { id: 'a7', name: '한솔테스트', createdAt: iso(2026, 10, 1) },
    { id: 'a8', name: '기한전', createdAt: iso(2026, 11, 15) },
    { id: 'a9', name: '실패메일만', createdAt: iso(2026, 11, 1), m1MailLog: [mail('questionnaire', iso(2026, 11, 1, 15), 'failed')] },
    { id: 'a10', name: '삭제', createdAt: iso(2026, 10, 1), deletedAt: iso(2026, 10, 5) },
  ];
  const r = P.firstAction(cos, actsOf, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(r.months)), { '2026-09': { num: 2, den: 2 }, '2026-10': { num: 1, den: 3 }, '2026-11': { num: 0, den: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(r.total)), { num: 3, den: 6 });
});

test('LI02: 7일 안 미회신만 대상, 14일 안 재발송 메일·연락 활동이면 재안내, 7일 기한 지난 달로 집계', () => {
  acts.b3 = [{ activityText: '전화로 회신 요청', createdAt: iso(2026, 10, 12) }];
  acts.b4 = [{ activityText: '질문서 발송 완료 (받는사람: x)', createdAt: iso(2026, 10, 1) }];
  const q = at => [mail('questionnaire', at)];
  const cos = [
    { id: 'b1', name: '7일안회신', m1MailLog: q(iso(2026, 10, 1)), _reply: iso(2026, 10, 5) },
    { id: 'b2', name: '재발송', m1MailLog: q(iso(2026, 10, 1)).concat(q(iso(2026, 10, 10))) },
    { id: 'b3', name: '전화기록', m1MailLog: q(iso(2026, 10, 1)) },
    { id: 'b4', name: '아무것도안함', m1MailLog: q(iso(2026, 10, 1)) },
    { id: 'b5', name: '늦은회신', m1MailLog: q(iso(2026, 10, 27)), _reply: iso(2026, 11, 10) },
    { id: 'b6', name: '7일전', m1MailLog: q(iso(2026, 11, 12)) },
    { id: 'b7', name: '재안내기한전', m1MailLog: q(iso(2026, 11, 5)) },
    { id: 'b8', name: '테스트건설', m1MailLog: q(iso(2026, 10, 1)) },
  ];
  const r = P.reContact(cos, actsOf, ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(r.months)), { '2026-10': { num: 2, den: 3 }, '2026-11': { num: 0, den: 1 } });
  assert.deepEqual(JSON.parse(JSON.stringify(r.rows.map(x => x.name + ':' + (x.ok ? 'O' : 'X')).sort())), ['늦은회신:X', '아무것도안함:X', '재발송:O', '전화기록:O']);
});

test('LI04: MOU 체결사(종료·삭제 제외) 중 핵심 5항목 완비, 휴대폰 없으면 회사 전화도 인정', () => {
  const full = { repName: '대표', mobile: '010', email: 'a@b', address: '서울', bizRegNo: '123' };
  const cos = [
    Object.assign({ id: 'c1', name: '완비', _mou: true }, full),
    Object.assign({ id: 'c2', name: '회사전화', _mou: true }, full, { mobile: '', phone: '02' }),
    Object.assign({ id: 'c3', name: '이메일없음', _mou: true }, full, { email: '-' }),
    Object.assign({ id: 'c4', name: 'MOU아님', _mou: false }, full),
    Object.assign({ id: 'c5', name: '종료', _mou: true, agreementStatus: 'terminated' }, full),
  ];
  const r = P.infoComplete(cos, ctx);
  assert.equal(r.num, 2); assert.equal(r.den, 3); assert.deepEqual(JSON.parse(JSON.stringify(r.missing)), ['이메일없음']);
});

test('B2B KPI 탭이 이번 달 화면에서 LI02·LI03·LI04 를 카드 실측으로 연결하고, 카드가 파일을 불러옴', () => {
  const tab = fs.readFileSync(__dirname + '/b2b-kpi-tab.js', 'utf8'), html = fs.readFileSync(__dirname + '/index.html', 'utf8');
  assert.ok(/PERSONAL_DEFS = \{ LI02: \['reContact'/.test(tab));
  assert.ok(tab.includes("shape.__cardNumeric[id] = pn[id]"));
  assert.ok(html.includes('<script src="b2b-kpi-personal.js"></script>'));
  assert.equal(P.BULK_END, 1787670000000);
  assert.ok(html.includes('const MEETING_CARD_BULK_END = 1787670000000;'));   // 카드 판정과 같은 경계
});
