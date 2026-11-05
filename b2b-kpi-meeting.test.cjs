// 1·2차 미팅 누락 방지 실측(b2b-kpi-meeting.js) — 카드 원본 판정 함수를 그대로 잘라 써서 실제 규칙으로 시험한다(가짜 업체만 사용)
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const FNS = ['getMouManualConfirm', 'isMouManuallyConfirmedRaw', 'isMouManuallyConfirmed', 'isAgreementInvalidated', 'isAgreementTerminated', 'parsePartnerDateLabel', 'normCompanyNameForPartnerMatch', 'getPartnerNameIndex', 'findPartnerRecordForCompany', 'resolveNewMouForCompany', 'resolvePartnerAgreementDate', 'getStageCorrections', 'findStageCorrection', 'stageCorrectionToStateFields', 'buildProgressStages', 'getMouStage', 'isConfirmedPartner', 'classifyWorkQueueMeeting', 'meetingMissTextKind', 'meetingCoordSince', 'classifyMeetingMiss'];
function cut(h, name){ const i = h.indexOf('function ' + name + '('); let d = 0, k = h.indexOf('{', h.indexOf(')', i)), str = null, esc = false; for(; k < h.length; k++){ const c = h[k]; if(str){ if(esc) esc = false; else if(c === '\\') esc = true; else if(c === str) str = null; continue; } if(c === '"' || c === "'" || c === '`'){ str = c; continue; } if(c === '/' && h[k + 1] === '/'){ k = h.indexOf('\n', k); continue; } if(c === '{') d++; else if(c === '}'){ d--; if(d === 0) break; } } return h.slice(i, k + 1); }
const consts = ['MEETING_MISS_GRACE_DAYS', 'MEETING_REG_LIMIT_DAYS', 'MEETING_COORD_LIMIT_DAYS'].map(n => 'var ' + n + ' = ' + new RegExp('const ' + n + '\\s*=\\s*(\\d+);').exec(html)[1] + ';').join('\n');
const ctx = { result: null };
vm.runInNewContext('var window={SHIN2_PARTNER_SNAPSHOT:[]};var _partnerNameIndexCache=null;function questionnaireMailSentLabel(){return null;}\n' + consts + '\n' + FNS.map(n => cut(html, n)).join('\n') +
  '\nvar D={isAgreementInvalidated:isAgreementInvalidated,isMouManuallyConfirmed:isMouManuallyConfirmed,isAgreementTerminated:isAgreementTerminated};\nresult={buildProgressStages:buildProgressStages,classifyMeetingMiss:classifyMeetingMiss,resolveNewMouForCompany:resolveNewMouForCompany,getStageCorrections:getStageCorrections,parsePartnerDateLabel:parsePartnerDateLabel,isAgreementTerminated:isAgreementTerminated,GRACE:MEETING_MISS_GRACE_DAYS,REG:MEETING_REG_LIMIT_DAYS};', ctx);
const LOGIC = ctx.result;
const mc = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(__dirname + '/b2b-kpi-meeting.js', 'utf8'), mc); const M = mc.module.exports;
const NOW = new Date(2026, 10, 5, 12).getTime(), d = (y, m, dd) => new Date(y, m - 1, dd).getTime();
const corr = (status, dateText, extra) => Object.assign({ status, dateText, correctedAt: '2026-11-01T00:00:00Z', correctedBy: '사용자 1' }, extra || {});
const co = (name, created, nm, sc, extra) => Object.assign({ id: name, name, createdAt: created, partnerDashboard: { newMou: nm || {}, stageCorrections: sc || {} } }, extra || {});
const CASES = [
  co('기한내완료', '2026-08-25T00:00:00Z', { qSentLabel: '26.09.01', qReplyLabel: '26.09.02' }, { m1Scheduled: corr('scheduled', '2026.09.10'), m1Done: corr('done', '2026.09.10') }),
  co('기한초과처리', '2026-09-20T00:00:00Z', { qSentLabel: '26.09.01', qReplyLabel: '26.09.02' }, { m1Scheduled: corr('scheduled', '2026.09.10'), m1Done: corr('done', '2026.09.20') }),
  co('미처리누락', '2026-08-25T00:00:00Z', { qSentLabel: '26.09.01', qReplyLabel: '26.09.02' }, {}),
  co('기한전', '2026-10-30T00:00:00Z', { qSentLabel: '26.11.01', qReplyLabel: '26.11.02' }, {}),
  co('도입전기한', '2026-08-25T00:00:00Z', { qSentLabel: '26.03.01', qReplyLabel: '26.03.02' }, {}),
  co('완료간주', '2026-08-25T00:00:00Z', { qSentLabel: '26.08.20', qReplyLabel: '26.08.21', m1ScheduledLabel: '26.08.26', mouDone: true, mouLabel: '26.09.01' }, {}),
  co('삭제업체', '2026-08-25T00:00:00Z', { qSentLabel: '26.09.01', qReplyLabel: '26.09.02' }, {}, { deletedAt: '2026-10-01T00:00:00Z' })
];
const run = () => M.evaluateMeetings(CASES, LOGIC, NOW, { start: d(2026, 8, 21), bulkEnd: d(2026, 8, 26) });

test('five_classes_from_real_card_rules', () => {
  const r = run(), by = n => r.rows.filter(x => x.name === n && x.stage === 'm1')[0];
  assert.equal(by('기한내완료').cls, 'ontime'); assert.equal(by('기한내완료').due, '2026-09-13'); assert.equal(by('기한내완료').doneAt, '2026-09-10');
  assert.equal(by('기한초과처리').cls, 'late'); assert.equal(by('기한초과처리').doneAt, '2026-09-20');
  assert.equal(by('미처리누락').cls, 'missed'); assert.equal(by('미처리누락').due, '2026-09-16');
  assert.equal(by('기한전').cls, 'upcoming');
  assert.equal(by('완료간주').cls, 'unknown'); assert.ok(by('완료간주').why.includes('실제 완료일 기록 없음'));
  assert.equal(r.rows.filter(x => x.name === '삭제업체').length, 0);
});
test('summary_counts_and_rate', () => {
  const s = run().summary.all.m1;
  // 기한 도래(8/21~오늘): 기한내완료·기한초과처리·미처리누락·완료간주(판정 불가). 기한전·도입전기한은 제외
  assert.equal(s.due, 4); assert.equal(s.ontime, 1); assert.equal(s.late, 1); assert.equal(s.missed, 1); assert.equal(s.unknown, 1);
  assert.equal(s.judged, 3); assert.equal(Math.round(s.rate * 10) / 10, 33.3); assert.equal(s.upcoming, 1);
});
test('late_processing_not_counted_as_success', () => {
  const s = run().summary.all.m1;
  assert.equal(s.ontime, 1); // 뒤늦게 처리한 업체는 성공으로 바꾸지 않는다
});
test('new_registration_group_separate', () => {
  const r = run();
  assert.equal(r.rows.find(x => x.name === '기한초과처리').group, 'new');
  assert.equal(r.rows.find(x => x.name === '기한내완료').group, 'bulk');
  assert.equal(r.summary.new.m1.due, 1); assert.equal(r.summary.new.m1.late, 1);
});
test('no_target_and_unmeasured_labels', () => {
  const empty = M.evaluateMeetings([], LOGIC, NOW, { start: d(2026, 8, 21), bulkEnd: d(2026, 8, 26) }).summary.all.m1;
  assert.equal(M.label(empty), '대상 없음');
  const onlyUnknown = M.evaluateMeetings([CASES[5]], LOGIC, NOW, { start: d(2026, 8, 21), bulkEnd: d(2026, 8, 26) }).summary.all.m1;
  assert.equal(M.label(onlyUnknown), '미측정');
  assert.equal(M.label(run().summary.all.m1), '관리 완료 1/3곳 · 33.3%');
});
test('deadline_day_itself_is_not_missed_like_card_rule', () => {
  // 카드 규칙: 예정일 다음 날 = 1일, 3일을 '넘어야' 누락. 예정일 11/2 → 기한 11/5, 11/5 낮에는 아직 기한 전
  const c = co('기한당일', '2026-08-25T00:00:00Z', { qSentLabel: '26.10.01', qReplyLabel: '26.10.02' }, { m1Scheduled: corr('scheduled', '2026.11.02') });
  const run1 = now => M.evaluateMeetings([c], LOGIC, now, { start: d(2026, 8, 21), bulkEnd: d(2026, 8, 26) });
  const a = run1(NOW), r = a.rows.find(x => x.stage === 'm1');
  assert.equal(r.due, '2026-11-05'); assert.equal(r.cls, 'upcoming'); assert.equal(a.summary.all.m1.missed, 0); assert.equal(a.summary.all.m1.due, 0);
  const b = run1(new Date(2026, 10, 6, 0, 0, 1).getTime());
  assert.equal(b.rows.find(x => x.stage === 'm1').cls, 'missed'); assert.equal(b.summary.all.m1.missed, 1);
  // 카드 원본 판정과 같다
  assert.equal(LOGIC.classifyMeetingMiss(c, LOGIC.buildProgressStages(c), NOW).find(x => x.key === 'm1').status, 'scheduled');
});
test('pooled_indicator_rate', () => {
  const p = M.pooled(run().summary.all);
  // 1차 1/3 + 2차 0/2(1차 완료 뒤 14일 안에 2차 미등록 2건이 누락) = 1/5
  assert.equal(p.num, 1); assert.equal(p.den, 5);
});
