'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, prepareInput, sendInput, webhookHeaders } = require('./helpers.cjs');

const req = (method, path, opts = {}) => ({
  method, path, query: opts.query || {}, body: opts.body || {}, rawBody: opts.rawBody || '',
  headers: Object.assign({}, opts.shared === false ? {} : { authorization: `Bearer ${opts.token || 'shared-token'}` }, opts.sender ? { 'x-contract-sender-token': opts.sender } : {}, opts.headers),
});
const parse = (res) => JSON.parse(res.body);

test('공용 로그인 없이는 아무 것도 못 한다', async () => {
  const env = await makeEnv();
  for (const [m, p] of [['POST', '/company-check'], ['POST', '/prepare'], ['GET', '/pdf'], ['GET', '/sends'], ['POST', '/refresh']]) {
    assert.equal((await env.router(req(m, p, { shared: false }))).status, 401, p);
    assert.equal((await env.router(req(m, p, { token: 'bogus' }))).status, 401, p);
    assert.equal((await env.router(req(m, p, { token: 'other-token' }))).status, 403, p);
  }
});

test('공용 로그인은 미리보기까지만: 발송·재시도는 개인 발송 권한 필요', async () => {
  const env = await makeEnv();
  const prep = await env.router(req('POST', '/prepare', { body: prepareInput() }));
  assert.equal(prep.status, 200);
  const v = parse(prep);
  const pdf = await env.router(req('GET', '/pdf', { query: { companyId: 'co-1', version: v.version, type: 'mou' } }));
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['x-pdf-sha256'], v.docs.mou.sha256);

  const body = sendInput(v);
  const cases = [
    [{}, 401, 'AUTH_REQUIRED'],
    [{ sender: 'shared-token' }, 403, 'SHARED_ACCOUNT_NOT_ALLOWED'],
    [{ sender: 'plain-token' }, 403, 'SENDER_NOT_ALLOWED'],
    [{ sender: 'viewer-token' }, 403, 'SENDER_NOT_ALLOWED'],
    [{ sender: 'unverified-token' }, 403, 'EMAIL_NOT_VERIFIED'],
    [{ sender: 'bogus' }, 401, 'AUTH_INVALID'],
    [{ sender: 'sender-token', token: 'other-token' }, 403, 'NOT_CARD_USER'],
    [{ sender: 'sender-token', shared: false }, 401, 'AUTH_REQUIRED'],
  ];
  for (const [opts, status, code] of cases) {
    const res = await env.router(req('POST', '/send', Object.assign({ body }, opts)));
    assert.equal(res.status, status, code);
    assert.equal(parse(res).error.code, code);
  }
  assert.equal(env.mock.posts.length, 0);

  env.tokens['sender-token'].auth_time -= 31 * 24 * 60 * 60;
  assert.equal(parse(await env.router(req('POST', '/send', { body, sender: 'sender-token' }))).error.code, 'SENDER_REAUTH_REQUIRED');
  env.tokens['sender-token'].auth_time += 31 * 24 * 60 * 60;
  assert.equal(env.mock.posts.length, 0);

  const ok = await env.router(req('POST', '/send', { body, sender: 'sender-token' }));
  assert.equal(ok.status, 200);
  assert.equal(parse(ok).processedBy.email, 'sender@netform.example');
  assert.equal(env.mock.posts.length, 2);
});

test('서명 문서는 개인 권한 확인 뒤에만, 링크가 아니라 파일로 전달', async () => {
  const env = await makeEnv();
  const v = await env.service.prepare(prepareInput());
  const r = await env.service.send(sendInput(v), env.sender);
  const q = { query: { sendId: r.sendId, type: 'mou' } };
  assert.equal((await env.router(req('GET', '/signed-document', q))).status, 401);
  assert.equal((await env.router(req('GET', '/signed-document', Object.assign({ sender: 'plain-token' }, q)))).status, 403);
  const res = await env.router(req('GET', '/signed-document', Object.assign({ sender: 'viewer-token' }, q)));
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(res.body));
  const logs = [...env.store.docs.entries()].filter(([k]) => k.startsWith('contractAccessLogs/'));
  assert.equal(logs[0][1].viewer, 'viewer@netform.example');
});

test('웹훅 경로: 비밀 헤더만으로 인증, 잘못되면 401(모두사인이 재시도 안 함)', async () => {
  const env = await makeEnv();
  const v = await env.service.prepare(prepareInput());
  const r = await env.service.send(sendInput(v), env.sender);
  const rawBody = JSON.stringify(env.mock.sign(r.documents.mou.modusignDocumentId, 1));
  assert.equal((await env.router(req('POST', '/modusign-webhook', { shared: false, rawBody }))).status, 401);
  const ok = await env.router(req('POST', '/modusign-webhook', { shared: false, rawBody, headers: webhookHeaders('h1') }));
  assert.equal(ok.status, 200);
  assert.equal(parse(ok).alertCreated, true);
});

test('허용 출처에만 CORS, 응답·기록에 비밀값 없음', async () => {
  const env = await makeEnv({ scenarios: { mou: ['reject'] } });
  const good = await env.router(req('OPTIONS', '/send', { headers: { origin: 'https://bridgeone-m.github.io' } }));
  assert.equal(good.headers['access-control-allow-origin'], 'https://bridgeone-m.github.io');
  const bad = await env.router(req('OPTIONS', '/send', { headers: { origin: 'https://evil.example' } }));
  assert.equal(bad.headers['access-control-allow-origin'], undefined);

  const v = parse(await env.router(req('POST', '/prepare', { body: prepareInput() })));
  const res = await env.router(req('POST', '/send', { body: sendInput(v), sender: 'sender-token' }));
  env.mock.state.down = true;
  await env.router(req('GET', '/signed-document', { query: { sendId: parse(res).sendId, type: 'supply' }, sender: 'viewer-token' }));
  const dump = JSON.stringify([res.body, env.logs, [...env.store.docs.values()]]);
  for (const secret of ['SECRET-API-KEY', 'hook-secret', Buffer.from('api@netform.example:SECRET-API-KEY').toString('base64')]) {
    assert.equal(dump.includes(secret), false, secret);
  }
});

test('서버 오류는 내부 내용을 응답에 싣지 않는다', async () => {
  const env = await makeEnv();
  env.service.prepare = null;
  const res = await env.router(req('POST', '/prepare', { body: prepareInput() }));
  assert.equal(res.status, 500);
  assert.equal(parse(res).error.code, 'INTERNAL');
});
