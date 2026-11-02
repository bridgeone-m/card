'use strict';
// 독립 리뷰에서 재현된 이중 발송·복구 불가 경로. 모의 API 앞에서 요청 순서를 조절해 경합을 만든다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, prepareInput, sendInput, webhookHeaders, company, SHARED_UID } = require('./helpers.cjs');

const COMPANIES_DOC = `users/${SHARED_UID}/shin2/shin2-companies-staging`;
const posts = (env, type) => env.mock.posts.filter((p) => p.type === type);
const docsWithKey = (env) => [...env.mock.documents.values()].filter((d) => (d.metadatas || []).some((m) => m.key === 'card_doc_type' && m.value === 'mou'));
const deferred = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
const tick = () => new Promise((r) => setTimeout(r, 15));

async function ready(opts) {
  const env = await makeEnv(opts);
  env.v = await env.service.prepare(prepareInput());
  return env;
}
async function notFound(env) {
  const r = await env.service.send(sendInput(env.v), env.sender);
  env.clock.t += 6 * 60 * 1000;
  await env.service.refresh({ sendId: r.sendId });
  return r;
}

test('R1: 사람 확인 후 재시도가 동시에 2번 와도 POST 는 1번', async () => {
  const env = await ready({ scenarios: { mou: ['timeout_lost'] } });
  const r = await notFound(env);
  assert.equal((await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou.delivery, 'unknown_not_found');
  const lateSearch = deferred();
  const holdPost = deferred();
  let searches = 0;
  env.mock.state.hook = async (method, u) => {
    if (method === 'GET' && u.pathname === '/documents' && ++searches === 2) await lateSearch.p; // B 의 검색이 늦게 끝난다
    if (method === 'POST') await holdPost.p; // A 의 발송이 진행 중
  };
  const input = { sendId: r.sendId, type: 'mou', manualChecked: true };
  const a = env.service.retryDoc(input, env.sender);
  await tick();
  const b = env.service.retryDoc(input, env.sender);
  const settled = Promise.allSettled([a, b]);
  await tick();
  lateSearch.open();
  await tick();
  holdPost.open();
  const results = await settled;
  const before = 1; // 처음 timeout_lost 1건
  assert.equal(posts(env, 'mou').length, before + 1);
  assert.equal(docsWithKey(env).length, 1);
  assert.ok(results.some((x) => x.status === 'fulfilled'));
  assert.ok(results.some((x) => x.status === 'rejected' && x.reason.code === 'BUSY'));
  assert.equal((await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou.delivery, 'created');
});

test('R2: 늦은 상태 조회가 진행 중·완료 문서를 되돌리지 못한다', async () => {
  const env = await ready({ scenarios: { mou: ['timeout_lost'] } });
  const r = await notFound(env);
  const lateSearch = deferred();
  const holdPost = deferred();
  env.mock.state.hook = async (method, u) => {
    if (method === 'GET' && u.pathname === '/documents' && !env.lateUsed) { env.lateUsed = true; await lateSearch.p; }
    if (method === 'POST') await holdPost.p;
  };
  const refresh = env.service.refresh({ sendId: r.sendId }); // 직원의 상태 조회가 검색에서 지연
  await tick();
  const retry = env.service.retryDoc({ sendId: r.sendId, type: 'mou', manualChecked: true }, env.sender);
  await tick();
  lateSearch.open();
  await refresh;
  let mid = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou;
  assert.equal(mid.delivery, 'creating');
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou', manualChecked: true }, env.sender), (e) => e.code === 'BUSY');
  holdPost.open();
  await retry;
  mid = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou;
  assert.equal(mid.delivery, 'created');
  assert.equal(docsWithKey(env).length, 1);
});

test('R3: 옛 발송 재시도는 재생성 뒤 옛 수신자에게 나가지 않는다', async () => {
  const env = await ready({ scenarios: { supply: ['reject'], mou: ['reject'] } });
  const a = await env.service.send(sendInput(env.v), env.sender);
  const v2 = await env.service.prepare(prepareInput({ recipientEmail: 'fixed@test-co.example' }));
  await env.service.send(sendInput(v2), env.sender);
  const count = env.mock.posts.length;
  await assert.rejects(env.service.retryDoc({ sendId: a.sendId, type: 'mou' }, env.sender), (e) => e.code === 'STALE_VERSION');
  assert.equal(env.mock.posts.length, count);
});

test('R3b: 부분 성공이면 재생성이 막혀 옛 수신자 재시도와 교착이 생기지 않는다', async () => {
  const env = await ready({ scenarios: { mou: ['reject'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  await assert.rejects(env.service.prepare(prepareInput({ recipientEmail: 'fixed@test-co.example' })), (e) => e.code === 'ACTIVE_SEND_EXISTS' && e.extra.sendId === r.sendId);
  const again = await env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender);
  assert.equal(again.documents.mou.delivery, 'created');
});

test('R4: 서버 중단 후 상태 조회가 처리 중 문서를 복구하고, 검색 지연 중 사람 확인으로 재발송되지 않는다', async () => {
  const env = await ready({ scenarios: { mou: ['timeout_created'] } });
  env.mock.state.hideFromSearch = true;
  const r = await env.service.send(sendInput(env.v), env.sender);
  const path = `contractSends/${r.sendId}`;
  const stuck = await env.store.get(path);
  stuck.documents.mou.delivery = 'creating';
  stuck.documents.mou.leaseUntil = env.clock.t + 1000;
  await env.store.set(path, stuck);
  env.clock.t += 2000;
  const s = await env.service.refresh({ sendId: r.sendId });
  assert.equal(s.documents.mou.delivery, 'unknown');
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou', manualChecked: true }, env.sender), (e) => e.code === 'RESULT_UNKNOWN');
  assert.equal(posts(env, 'mou').length, 1);
  env.mock.state.hideFromSearch = false;
  const found = await env.service.refresh({ sendId: r.sendId });
  assert.equal(found.documents.mou.delivery, 'created');
  assert.equal(posts(env, 'mou').length, 1);
});

test('R5: 기록만 되고 멈춘 대기 문서는 재시도로 보낼 수 있고, 재생성은 막힌다', async () => {
  const env = await ready({ scenarios: { supply: ['reject'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  const path = `contractSends/${r.sendId}`;
  const stuck = await env.store.get(path);
  stuck.documents.mou = Object.assign({}, stuck.documents.mou, { delivery: 'pending', modusignDocumentId: null, attempts: [] });
  await env.store.set(path, stuck);
  await assert.rejects(env.service.prepare(prepareInput({ contractDate: '2026-11-09' })), (e) => e.code === 'ACTIVE_SEND_EXISTS');
  const out = await env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender);
  assert.equal(out.documents.mou.delivery, 'created');
});

test('R6: 양측 완료된 발송은 재계약을 막지 않는다', async () => {
  const env = await ready();
  const r = await env.service.send(sendInput(env.v), env.sender);
  for (const t of ['supply', 'mou']) {
    const id = r.documents[t].modusignDocumentId;
    env.mock.sign(id, 1);
    env.mock.sign(id, 2);
  }
  await env.service.refresh({ sendId: r.sendId });
  const v2 = await env.service.prepare(prepareInput({ contractDate: '2027-11-02' }));
  const out = await env.service.send(sendInput(v2), env.sender);
  assert.equal(out.documents.mou.delivery, 'created');
});

test('R7: 한 문서만 중단되면 다른 문서가 끝나기 전 재발송 불가, 모두 중단되면 새 버전 가능', async () => {
  const env = await ready();
  const r = await env.service.send(sendInput(env.v), env.sender);
  const abort = (type) => {
    const d = env.mock.documents.get(r.documents[type].modusignDocumentId);
    d.status = 'ABORTED';
    d.abort = { type: 'REJECTION', abortedAt: '2026-11-03T01:00:00.000Z' };
  };
  abort('mou');
  await env.service.refresh({ sendId: r.sendId });
  await assert.rejects(env.service.prepare(prepareInput({ contractDate: '2026-11-09' })), (e) => e.code === 'ACTIVE_SEND_EXISTS');
  abort('supply');
  await env.service.refresh({ sendId: r.sendId });
  const v2 = await env.service.prepare(prepareInput({ contractDate: '2026-11-09' }));
  assert.equal((await env.service.send(sendInput(v2), env.sender)).documents.mou.delivery, 'created');
});

test('R9: 중복본 이벤트가 현재 문서 상태를 오염시키지 않고, 해소 후 확정 문서만 추적한다', async () => {
  const env = await ready({ scenarios: { mou: ['timeout_lost'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  const key = env.mock.posts.find((p) => p.type === 'mou').sendKey;
  const make = (id) => {
    const doc = { id, title: 'MOU', status: 'ON_GOING', metadatas: [{ key: 'card_send_key', value: key }], participants: [{ id: `${id}-a`, signingOrder: 1 }, { id: `${id}-b`, signingOrder: 2 }], signings: [], file: {}, fileBytes: Buffer.alloc(0) };
    env.mock.documents.set(id, doc);
    return doc;
  };
  make('keep-doc');
  const dup = make('dup-doc');
  const s = await env.service.refresh({ sendId: r.sendId });
  assert.equal(s.documents.mou.delivery, 'duplicate_suspect');
  assert.deepEqual(s.documents.mou.duplicateCandidates.sort(), ['dup-doc', 'keep-doc']);
  await assert.rejects(env.service.prepare(prepareInput({ contractDate: '2026-11-09' })), (e) => e.code === 'ACTIVE_SEND_EXISTS');
  await assert.rejects(env.service.resolveDuplicate({ sendId: r.sendId, type: 'mou', keepDocumentId: 'other' }, env.sender), (e) => e.code === 'NOT_DUPLICATE');
  const fixed = await env.service.resolveDuplicate({ sendId: r.sendId, type: 'mou', keepDocumentId: 'keep-doc' }, env.sender);
  assert.equal(fixed.documents.mou.delivery, 'created');
  assert.equal(fixed.documents.mou.modusignDocumentId, 'keep-doc');

  dup.status = 'ABORTED';
  dup.abort = { type: 'REQUEST_CANCELLATION', abortedAt: '2026-11-03T01:00:00.000Z' };
  const out = await env.service.handleWebhook(webhookHeaders('dup-1'), JSON.stringify({ event: { type: 'document_request_canceled' }, document: { id: 'dup-doc' } }));
  assert.equal(out.applied, false);
  const after = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou;
  assert.equal(after.abortedAt, null);
  assert.equal(after.modusignDocumentId, 'keep-doc');
});

test('M5: 검색 응답 형식이 이상하면 없음으로 처리하지 않고, 키가 다른 문서는 연결하지 않는다', async () => {
  const env = await ready({ scenarios: { mou: ['timeout_lost'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  env.clock.t += 6 * 60 * 1000;
  env.mock.state.hook = async (method, u) => { if (method === 'GET' && u.pathname === '/documents') throw new TypeError('list broken'); };
  const s = await env.service.refresh({ sendId: r.sendId });
  assert.equal(s.documents.mou.delivery, 'unknown');
  env.mock.state.hook = null;
  env.mock.documents.set('other', { id: 'other', metadatas: [{ key: 'card_send_key', value: 'different' }], participants: [], signings: [], fileBytes: Buffer.alloc(0) });
  const again = await env.service.refresh({ sendId: r.sendId });
  assert.equal(again.documents.mou.delivery, 'unknown_not_found');
  assert.equal(again.documents.mou.modusignDocumentId, null);
});

test('M6: 미리보기 후 업체가 바뀌거나 삭제되면 발송·재시도 거부', async () => {
  const env = await ready({ scenarios: { mou: ['reject'] } });
  const doc = await env.store.get(COMPANIES_DOC);
  await env.store.set(COMPANIES_DOC, { value: [company({ repName: '새대표' })] });
  await assert.rejects(env.service.send(sendInput(env.v), env.sender), (e) => e.code === 'COMPANY_CHANGED');
  assert.equal(env.mock.posts.length, 0);
  await env.store.set(COMPANIES_DOC, doc);
  const r = await env.service.send(sendInput(env.v), env.sender);
  await env.store.set(COMPANIES_DOC, { value: [company({ deletedAt: '2026-11-03' })] });
  const count = env.mock.posts.length;
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender), (e) => e.code === 'COMPANY_CHANGED');
  assert.equal(env.mock.posts.length, count);
});

test('M7: 실제 도장이 든 PDF는 공용 로그인만으로 만들거나 받을 수 없다', async () => {
  const env = await makeEnv({ config: { realSealApproved: true }, registry: (reg) => { reg.seal.kind = 'real'; reg.seal.status = 'approved'; } });
  const base = { method: 'POST', path: '/prepare', query: {}, rawBody: '', body: prepareInput({ includeSeal: true }), headers: { authorization: 'Bearer shared-token' } };
  const denied = await env.router(base);
  assert.equal(denied.status, 401);
  const ok = await env.router(Object.assign({}, base, { headers: { authorization: 'Bearer shared-token', 'x-contract-sender-token': 'sender-token' } }));
  assert.equal(ok.status, 200);
  const v = JSON.parse(ok.body);
  const get = { method: 'GET', path: '/pdf', body: {}, rawBody: '', query: { companyId: 'co-1', version: v.version, type: 'mou' } };
  assert.equal((await env.router(Object.assign({}, get, { headers: { authorization: 'Bearer shared-token' } }))).status, 401);
  assert.equal((await env.router(Object.assign({}, get, { headers: { authorization: 'Bearer shared-token', 'x-contract-sender-token': 'sender-token' } }))).status, 200);
});

test('낮음: 등록부 양식이 바뀌면 옛 버전 발송 차단, 도장 승인 회수 후 발송 차단', async () => {
  const env = await ready();
  const reg = await env.store.get('contractConfig/templates');
  reg.mou.version = 't2';
  await env.store.set('contractConfig/templates', reg);
  await assert.rejects(env.service.send(sendInput(env.v), env.sender), (e) => e.extra.blockers.some((b) => b.code === 'TEMPLATE_CHANGED'));
  assert.equal(env.mock.posts.length, 0);
});

test('낮음: 응답 형식 이상·408·본문 수신 실패는 모두 결과 불명으로 분류', async () => {
  const { createModusign, ModusignError } = require('../src/modusign');
  const client = createModusign({ baseUrl: 'https://x.test', email: 'a', apiKey: 'b', fetchImpl: async () => new Response('{"documents":{}}', { status: 200 }) });
  await assert.rejects(client.findBySendKey('k'), (e) => e instanceof ModusignError && e.kind === 'unknown');
  const proxy = createModusign({ baseUrl: 'https://x.test', email: 'a', apiKey: 'b', fetchImpl: async () => new Response('', { status: 408 }) });
  await assert.rejects(proxy.createDocument({}), (e) => e.kind === 'unknown');
  const brokenBody = createModusign({ baseUrl: 'https://x.test', email: 'a', apiKey: 'b', fetchImpl: async () => ({ status: 200, text: async () => { throw new Error('reset'); } }) });
  await assert.rejects(brokenBody.createDocument({}), (e) => e.kind === 'unknown');
});
