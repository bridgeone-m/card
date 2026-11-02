'use strict';
// 우리 측 시험 발송(서버 직접 요청) 경로: 카드 데이터 무변경, 별도 스위치·수신자 허용 목록·개인 발송 권한.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, prepareInput, sendInput, SHARED_UID, webhookHeaders } = require('./helpers.cjs');

const COMPANIES_DOC = `users/${SHARED_UID}/shin2/shin2-companies-staging`;
const ALERT_DOC = `users/${SHARED_UID}/shin2/shin2-website-cleanup-v1`;
const OURS = 'ourside@netform.example';
const testCompany = { name: '시험업체(주)', bizNo: '123-45-67891', representative: '김시험', address: '서울특별시 시험구 시험로 12, 3층' };
const testConfig = (over) => ({ config: Object.assign({ sendEnabled: false, testSendEnabled: true, testRecipients: [OURS] }, over) });

const req = (method, path, opts = {}) => ({
  method, path, query: opts.query || {}, body: opts.body || {}, rawBody: '',
  headers: Object.assign({}, opts.shared ? { authorization: 'Bearer shared-token' } : {}, opts.sender ? { 'x-contract-sender-token': opts.sender } : {}),
});
const parse = (res) => JSON.parse(res.body);
const prepBody = (over) => Object.assign({ contractDate: '2026-11-02', recipientEmail: OURS, company: testCompany }, over);
const sendBody = (v, over) => {
  const b = sendInput(v, over);
  delete b.companyId;
  return b;
};

test('시험 경로는 개인 발송 권한만 통과한다(공용 로그인만으로는 불가)', async () => {
  const env = await makeEnv(testConfig());
  for (const [m, p] of [['POST', '/test/prepare'], ['GET', '/test/pdf'], ['POST', '/test/send'], ['GET', '/test/sends'], ['POST', '/test/refresh'], ['POST', '/test/retry']]) {
    assert.equal((await env.router(req(m, p, { shared: true }))).status, 401, p);
    for (const [sender, code] of [['shared-token', 'SHARED_ACCOUNT_NOT_ALLOWED'], ['plain-token', 'SENDER_NOT_ALLOWED'], ['viewer-token', 'SENDER_NOT_ALLOWED'], ['unverified-token', 'EMAIL_NOT_VERIFIED']]) {
      const res = await env.router(req(m, p, { sender, body: prepBody() }));
      assert.equal(parse(res).error.code, code, `${p} ${sender}`);
    }
  }
  env.clock.t += 16 * 60 * 1000;
  assert.equal(parse(await env.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody() }))).error.code, 'SENDER_REAUTH_REQUIRED');
});

test('수신자는 서버 허용 목록의 우리 측 이메일만', async () => {
  const env = await makeEnv(testConfig());
  for (const email of ['ceo@test-co.example', 'OURSIDE@netform.example.evil', '', 'x']) {
    const res = await env.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody({ recipientEmail: email }) }));
    assert.equal(parse(res).error.code, 'TEST_RECIPIENT_NOT_ALLOWED', email);
  }
  const empty = await makeEnv(testConfig({ testRecipients: [] }));
  assert.equal(parse(await empty.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody() }))).error.code, 'TEST_RECIPIENT_NOT_ALLOWED');
  const upper = await env.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody({ recipientEmail: 'OurSide@NetForm.example' }) }));
  assert.equal(upper.status, 200);
});

test('시험 업체 값도 카드 업체와 같은 검사를 거친다', async () => {
  const env = await makeEnv(testConfig());
  const bad = await env.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody({ company: Object.assign({}, testCompany, { bizNo: '123-45-67890', representative: '' }) }) }));
  assert.equal(bad.status, 422);
  const fields = parse(bad).error.extra.issues.map((i) => i.field).sort();
  assert.deepEqual(fields, ['bizNo', 'representative']);
});

test('시험 발송: 카드 업체·알림 무변경, 제목·메타데이터 시험 표시, 일반 경로와 섞이지 않음', async () => {
  const env = await makeEnv(testConfig());
  const companiesBefore = JSON.stringify(await env.store.get(COMPANIES_DOC));
  const alertsBefore = JSON.stringify(await env.store.get(ALERT_DOC));

  const prep = await env.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody({ companyId: 'co-1' }) }));
  assert.equal(prep.status, 200);
  const v = parse(prep);
  assert.equal(v.companyId, 'test-send');
  assert.equal(v.test, true);
  assert.equal(v.createdBy, 'sender@netform.example');
  assert.ok(v.docs.mou.title.startsWith('[시험] '));

  const pdf = await env.router(req('GET', '/test/pdf', { sender: 'sender-token', query: { version: v.version, type: 'mou', companyId: 'co-1' } }));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['x-pdf-sha256'], v.docs.mou.sha256);

  // 일반 발송 경로로는 시험 버전을, 일반 준비 경로로는 시험 ID 를 쓸 수 없다.
  await assert.rejects(env.service.send(sendInput(v), env.sender), (e) => e.code === 'BAD_ID');
  await assert.rejects(env.service.prepare(prepareInput({ companyId: 'test-send' })), (e) => e.code === 'BAD_ID');

  const sent = await env.router(req('POST', '/test/send', { sender: 'sender-token', body: sendBody(v) }));
  assert.equal(sent.status, 200, sent.body);
  const s = parse(sent);
  assert.equal(s.test, true);
  assert.equal(env.mock.posts.length, 2);
  for (const post of env.mock.posts) {
    assert.ok(post.title.startsWith('[시험] '));
    assert.equal(post.participants[0].signingMethod.value, OURS);
    assert.ok(post.metadatas.some((m) => m.key === 'card_test' && m.value === 'true'));
  }

  // 서명 웹훅이 와도 카드 알림에 쓰지 않는다.
  const doc = [...env.mock.documents.values()].find((d) => d.title.includes('MOU'));
  const hook = await env.service.handleWebhook(webhookHeaders('t1'), JSON.stringify(env.mock.sign(doc.id, 1)));
  assert.equal(hook.applied, true);
  assert.equal(hook.alertCreated, false);
  assert.equal(JSON.stringify(await env.store.get(COMPANIES_DOC)), companiesBefore);
  assert.equal(JSON.stringify(await env.store.get(ALERT_DOC)), alertsBefore);

  const list = parse(await env.router(req('GET', '/test/sends', { sender: 'sender-token' })));
  assert.equal(list.sends.length, 1);
  assert.equal(list.sends[0].documents.mou.counterpartySignedAt !== null, true);
});

test('시험 스위치가 꺼져 있으면 미리보기까지만, 실제 발송 스위치로는 열리지 않는다', async () => {
  const env = await makeEnv(testConfig({ testSendEnabled: false, sendEnabled: true }));
  const v = parse(await env.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody() })));
  const res = await env.router(req('POST', '/test/send', { sender: 'sender-token', body: sendBody(v) }));
  assert.equal(res.status, 409);
  assert.ok(parse(res).error.extra.blockers.some((b) => b.code === 'TEST_SEND_DISABLED'));
  assert.equal(env.mock.posts.length, 0);
});

test('서명 위치 미승인이면 시험 발송도 막힌다', async () => {
  const env = await makeEnv(Object.assign(testConfig(), { registry: (r) => { r.mou.signaturePositionApproved = false; } }));
  const v = parse(await env.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody() })));
  const res = await env.router(req('POST', '/test/send', { sender: 'sender-token', body: sendBody(v) }));
  assert.ok(parse(res).error.extra.blockers.some((b) => b.code === 'SIGNATURE_POSITION_NOT_APPROVED'));
  assert.equal(env.mock.posts.length, 0);
});

test('발송 뒤 허용 목록에서 빠진 수신자에게는 재시도하지 않는다', async () => {
  const env = await makeEnv(Object.assign(testConfig(), { scenarios: { mou: ['reject'] } }));
  const v = parse(await env.router(req('POST', '/test/prepare', { sender: 'sender-token', body: prepBody() })));
  const s = parse(await env.router(req('POST', '/test/send', { sender: 'sender-token', body: sendBody(v) })));
  assert.equal(s.documents.mou.delivery, 'failed');
  env.config.testRecipients = [];
  const res = await env.router(req('POST', '/test/retry', { sender: 'sender-token', body: { sendId: s.sendId, type: 'mou' } }));
  assert.ok(parse(res).error.extra.blockers.some((b) => b.code === 'TEST_RECIPIENT_NOT_ALLOWED'));
});

test('시험 경로로 실제 업체 발송 기록을 다룰 수 없다', async () => {
  const env = await makeEnv(Object.assign(testConfig({ sendEnabled: true }), { scenarios: { mou: ['reject'] } }));
  const v = await env.service.prepare(prepareInput());
  const real = await env.service.send(sendInput(v), env.sender);
  for (const p of ['/test/refresh', '/test/retry']) {
    const res = await env.router(req('POST', p, { sender: 'sender-token', body: { sendId: real.sendId, type: 'mou' } }));
    assert.equal(parse(res).error.code, 'SEND_NOT_FOUND', p);
  }
  const list = parse(await env.router(req('GET', '/test/sends', { sender: 'sender-token' })));
  assert.equal(list.sends.length, 0);
});
