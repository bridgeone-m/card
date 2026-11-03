'use strict';
// 서명 요청 취소와 전체 발송 이력.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, prepareInput, sendInput, webhookHeaders, company, bizNo } = require('./helpers.cjs');

const req = (method, path, opts = {}) => ({
  method, path, query: opts.query || {}, body: opts.body || {}, rawBody: '',
  headers: Object.assign({ authorization: 'Bearer shared-token' }, opts.sender ? { 'x-contract-sender-token': opts.sender } : {}),
});
const parse = (res) => JSON.parse(res.body);
const REASON = '계약서 내용 수정으로 서명 요청을 취소합니다.';

async function sent(opts) {
  const env = await makeEnv(opts);
  const v = await env.service.prepare(prepareInput());
  const s = await env.service.send(sendInput(v), env.sender);
  return Object.assign(env, { v, s });
}

test('취소는 개인 발송 권한이 있어야 한다', async () => {
  const env = await sent();
  for (const [sender, code] of [[undefined, 'AUTH_REQUIRED'], ['viewer-token', 'SENDER_NOT_ALLOWED'], ['plain-token', 'SENDER_NOT_ALLOWED']]) {
    const res = await env.router(req('POST', '/cancel', { sender, body: { sendId: env.s.sendId, type: 'mou', reason: REASON } }));
    assert.equal(parse(res).error.code, code);
  }
  assert.equal(env.mock.cancels.length, 0);
});

test('문서별 취소: 모두사인 취소 후 다시 조회한 상태를 반영, 이력 기록, 다른 문서는 그대로', async () => {
  const env = await sent();
  const res = await env.router(req('POST', '/cancel', { sender: 'sender-token', body: { sendId: env.s.sendId, type: 'mou', reason: REASON } }));
  assert.equal(res.status, 200, res.body);
  const s = parse(res);
  assert.equal(s.documents.mou.modusignStatus, 'ABORTED');
  assert.equal(s.documents.mou.abortType, 'REQUEST_CANCELLATION');
  assert.ok(s.documents.mou.abortedAt);
  assert.equal(s.documents.mou.cancellations[0].by, 'sender@netform.example');
  assert.equal(s.documents.mou.cancellations[0].reason, REASON);
  assert.equal(s.documents.supply.modusignStatus, 'ON_GOING');
  assert.equal(env.mock.cancels.length, 1);
  assert.equal(env.mock.cancels[0].accessibleByParticipant, false);
  // 다시 눌러도 모두사인을 또 부르지 않는다.
  await env.router(req('POST', '/cancel', { sender: 'sender-token', body: { sendId: env.s.sendId, type: 'mou', reason: REASON } }));
  assert.equal(env.mock.cancels.length, 1);
});

test('두 문서를 모두 취소하면 같은 업체로 새 준비·발송이 가능하다', async () => {
  const env = await sent();
  for (const type of ['supply', 'mou']) await env.service.cancelDoc({ sendId: env.s.sendId, type, reason: REASON }, env.sender);
  const v2 = await env.service.prepare(prepareInput({ contractDate: '2026-11-05' }));
  const s2 = await env.service.send(sendInput(v2), env.sender);
  assert.equal(s2.documents.supply.delivery, 'created');
  assert.notEqual(s2.sendId, env.s.sendId);
});

test('양측 서명 완료 문서·만들어지지 않은 문서는 취소할 수 없다', async () => {
  const env = await sent({ scenarios: { supply: ['reject'] } });
  await assert.rejects(env.service.cancelDoc({ sendId: env.s.sendId, type: 'supply', reason: REASON }, env.sender), (e) => e.code === 'NOT_CANCELLABLE');
  const id = env.s.documents.mou.modusignDocumentId;
  env.mock.sign(id, 1); const done = env.mock.sign(id, 2);
  await env.service.handleWebhook(webhookHeaders('c1'), JSON.stringify(done));
  await assert.rejects(env.service.cancelDoc({ sendId: env.s.sendId, type: 'mou', reason: REASON }, env.sender), (e) => e.code === 'ALREADY_COMPLETED');
  assert.equal(env.mock.cancels.length, 0);
});

test('취소 사유는 2~200자', async () => {
  const env = await sent();
  for (const reason of ['', '가', 'x'.repeat(201)]) {
    await assert.rejects(env.service.cancelDoc({ sendId: env.s.sendId, type: 'mou', reason }, env.sender), (e) => e.code === 'BAD_REASON');
  }
});

test('모두사인이 취소를 거절하면(완료 직후 등) 조회 결과로 판단해 알린다', async () => {
  const env = await sent();
  const doc = env.mock.documents.get(env.s.documents.mou.modusignDocumentId);
  doc.status = 'COMPLETED';
  await assert.rejects(env.service.cancelDoc({ sendId: env.s.sendId, type: 'mou', reason: REASON }, env.sender), (e) => e.code === 'ALREADY_COMPLETED');
  const view = (await env.service.listSends({ companyId: 'co-1' }))[0];
  assert.ok(view.documents.mou.allSignedAt);
  assert.equal(view.documents.mou.cancellations[0].result, 'not_canceled');
});

test('발송 이력: 전체 업체 최근 순, 시험 발송은 기본 제외, 공용 로그인으로 조회', async () => {
  const env = await makeEnv({
    companies: [company(), company({ id: 'co-2', code: 'B2B902', name: '둘째건설(주)', bizRegNo: bizNo('234567891'), email: 'two@test-co.example' })],
    config: { testSendEnabled: true, testRecipients: ['ourside@netform.example'] },
  });
  const v1 = await env.service.prepare(prepareInput());
  await env.service.send(sendInput(v1), env.sender);
  env.clock.t += 60 * 1000;
  const v2 = await env.service.prepare(prepareInput({ companyId: 'co-2', companyCode: 'B2B902', recipientEmail: 'two@test-co.example' }));
  await env.service.send(sendInput(v2), env.sender);
  const t = await env.service.prepareTest({ contractDate: '2026-11-02', recipientEmail: 'ourside@netform.example', company: { name: '시험업체(주)', bizNo: '123-45-67891', representative: '김시험', address: '서울특별시 시험구 시험로 12, 3층' } });
  const tb = sendInput(t); delete tb.companyId;
  await env.service.send(Object.assign(tb, { companyId: 'test-send' }), env.sender, { test: true });

  assert.equal((await env.router(req('GET', '/sends/all', { sender: undefined }))).status, 200);
  const noAuth = await env.router({ method: 'GET', path: '/sends/all', query: {}, body: {}, rawBody: '', headers: {} });
  assert.equal(noAuth.status, 401);
  const rows = parse(await env.router(req('GET', '/sends/all'))).sends;
  assert.deepEqual(rows.map((r) => r.companyName), ['둘째건설(주)', '시험건설(주)']);
  const withTests = parse(await env.router(req('GET', '/sends/all', { query: { includeTests: '1' } }))).sends;
  assert.equal(withTests.length, 3);
});
