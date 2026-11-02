'use strict';
// 저장 경로·접근 경계 점검. 운영에 배포된 Firestore 규칙(아래 그대로)을 기준으로 삼는다.
//   match /users/{userId}/{document=**} { allow read, write: if auth != null && auth.uid == userId }
//   match /{document=**}               { allow read, write: if false }
// clientAllowed 는 이 두 규칙을 옮긴 판정이며, 실제 규칙 엔진 실행이 아니다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeEnv, prepareInput, sendInput, webhookHeaders, SHARED_UID } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '../..');
const clientAllowed = (docPath, uid) => {
  const parts = docPath.split('/');
  return parts[0] === 'users' && parts.length >= 2 && !!uid && parts[1] === uid;
};
const ALERT_DOC = `users/${SHARED_UID}/shin2/shin2-website-cleanup-v1`;
const COMPANIES_DOC = `users/${SHARED_UID}/shin2/shin2-companies-staging`;

const req = (method, route, opts = {}) => ({
  method, path: route, query: opts.query || {}, body: opts.body || {}, rawBody: opts.rawBody || '',
  headers: Object.assign({ authorization: 'Bearer shared-token' }, opts.personal ? { 'x-contract-sender-token': opts.personal } : {}, opts.headers),
});

function recording(writes) {
  return (store) => Object.assign({}, store, {
    docs: store.docs,
    get: store.get,
    set: async (p, d, o) => { writes.push(p); return store.set(p, d, o); },
    query: store.query,
    transaction: (fn) => store.transaction((tx) => fn({ get: tx.get, set: (p, d, o) => { writes.push(p); tx.set(p, d, o); } })),
  });
}

async function fullFlow(env) {
  const out = { responses: [] };
  const call = async (r) => {
    const res = await env.router(r);
    out.responses.push({ route: r.path, status: res.status, body: Buffer.isBuffer(res.body) ? '<pdf>' : String(res.body), headers: res.headers });
    return res;
  };
  await call(req('POST', '/company-check', { body: { companyId: 'co-1', companyCode: 'B2B901' } }));
  const v = JSON.parse((await call(req('POST', '/prepare', { body: prepareInput() }))).body);
  for (const type of ['supply', 'mou']) await call(req('GET', '/pdf', { query: { companyId: 'co-1', version: String(v.version), type } }));
  const s = JSON.parse((await call(req('POST', '/send', { body: sendInput(v), personal: 'sender-token' }))).body);
  const hook = JSON.stringify(env.mock.sign(s.documents.mou.modusignDocumentId, 1, '2026-11-03T01:00:00.000Z'));
  await call(req('POST', '/modusign-webhook', { rawBody: hook, headers: webhookHeaders('d1') }));
  await call(req('GET', '/sends', { query: { companyId: 'co-1' } }));
  await call(req('POST', '/refresh', { body: { sendId: s.sendId } }));
  await call(req('GET', '/signed-document', { query: { sendId: s.sendId, type: 'mou' }, personal: 'viewer-token' }));
  return Object.assign(out, { version: v, send: s });
}

test('서버는 최상위 contract* 와 기존 알림 문서에만 쓰고, 고객 문서에는 쓰지 않는다', async () => {
  const writes = [];
  const env = await makeEnv({ wrapStore: recording(writes) });
  const before = JSON.stringify(await env.store.get(COMPANIES_DOC));
  await fullFlow(env);
  assert.ok(writes.length > 0);
  for (const p of writes) assert.ok(/^contract[A-Z]\w+\/[^/]+$/.test(p) || p === ALERT_DOC, `허용되지 않은 쓰기 경로: ${p}`);
  assert.ok(writes.includes(ALERT_DOC));
  assert.equal(JSON.stringify(await env.store.get(COMPANIES_DOC)), before);
  const collections = new Set(writes.filter((p) => p !== ALERT_DOC).map((p) => p.split('/')[0]));
  for (const c of collections) assert.ok(c.startsWith('contract'), c);
});

test('배포된 규칙 기준: 계약 데이터는 공용·개인 계정 모두 직접 접근 불가', async () => {
  const env = await makeEnv();
  await fullFlow(env);
  const contractDocs = [...env.store.docs.keys()].filter((p) => p.startsWith('contract'));
  const names = new Set(contractDocs.map((p) => p.split('/')[0]));
  for (const name of ['contractConfig', 'contractPreparations', 'contractVersions', 'contractSends', 'contractDocIndex', 'contractWebhookDeliveries', 'contractAccessLogs']) {
    assert.ok(names.has(name), `${name} 없음`);
  }
  for (const p of contractDocs) {
    for (const uid of [SHARED_UID, 'person-1', 'person-2', null]) assert.equal(clientAllowed(p, uid), false, `${p} / ${uid}`);
  }
  assert.equal(clientAllowed(ALERT_DOC, SHARED_UID), true);
  assert.equal(clientAllowed(ALERT_DOC, 'person-1'), false);
  assert.equal(clientAllowed(COMPANIES_DOC, 'person-1'), false);
  for (const p of env.blobs.files.keys()) assert.ok(/^(contracts|templates)\//.test(p), p);
});

test('이번 작업은 Firestore 규칙·Storage 규칙을 배포 대상에 넣지 않는다', () => {
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
  assert.deepEqual(Object.keys(firebaseJson), ['functions']);
  assert.equal(fs.existsSync(path.join(ROOT, 'firestore.rules')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'firestore.indexes.json')), false);
});

test('화면 코드는 Firestore·Storage 를 직접 쓰지 않고 서버 API 만 호출한다', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'contract-esign.js'), 'utf8');
  for (const word of ['firestore', 'setDoc', 'onSnapshot', 'runTransaction', 'contractSends', 'contractVersions', 'contractConfig', 'storageRef', 'SHIN2_STORAGE']) {
    assert.equal(ui.includes(word), false, word);
  }
  assert.equal(/getDoc/.test(ui), false, 'getDoc');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const name of ['contractSends', 'contractVersions', 'contractPreparations', 'contractConfig', 'contractDocIndex', 'contractWebhookDeliveries', 'contractAccessLogs']) {
    assert.equal(html.includes(name), false, name);
  }
});

test('서버 코드에 공개 링크·공개 권한을 만드는 호출이 없다', () => {
  const files = ['src/firebaseAdapters.js', 'src/service.js', 'src/modusign.js', 'index.js', 'scripts/register-template.cjs'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.equal(/makePublic|getSignedUrl|publicUrl|predefinedAcl|getDownloadURL/.test(src), false, file);
  }
});

test('API 응답에 내부 경로·좌표 원본·식별키·비밀값이 없다', async () => {
  const env = await makeEnv();
  const { responses } = await fullFlow(env);
  assert.ok(responses.every((r) => r.status === 200), JSON.stringify(responses.map((r) => [r.route, r.status])));
  const dump = JSON.stringify(responses);
  for (const word of ['blobPath', 'sendKey', 'attemptId', 'leaseUntil', 'recheckAfter', 'downloadUrl', '"uid"', '"map"', 'contracts/', 'templates/', 'mock.modusign.test', 'SECRET-API-KEY', 'hook-secret']) {
    assert.equal(dump.includes(word), false, word);
  }
});

test('company-check 는 요청한 업체의 계약 필드만 돌려준다', async () => {
  const env = await makeEnv({
    companies: [
      { id: 'co-1', code: 'B2B901', name: '시험건설(주)', repName: '김시험', bizRegNo: '123-45-67891', address: '서울특별시 시험구 시험로 12, 3층', email: 'ceo@test-co.example', mobile: '010-0000-0000', sales: [1, 2, 3], memo: '내부 메모' },
      { id: 'co-2', code: 'B2B902', name: '다른업체', repName: '이다른', bizRegNo: '234-56-78912', address: '부산광역시 다른구 다른로 1', email: 'other@test-co.example' },
    ],
  });
  const res = await env.router(req('POST', '/company-check', { body: { companyId: 'co-1', companyCode: 'B2B901' } }));
  const body = JSON.parse(res.body);
  assert.deepEqual(Object.keys(body.company).sort(), ['address', 'bizNo', 'code', 'email', 'id', 'name', 'representative']);
  for (const word of ['010-0000-0000', '내부 메모', '다른업체', 'other@test-co.example']) assert.equal(res.body.includes(word), false, word);
});

test('알림 항목에는 표시에 필요한 값만 있고 문서 링크가 없다', async () => {
  const env = await makeEnv();
  const { send } = await fullFlow(env);
  const item = (await env.store.get(ALERT_DOC)).value.find((n) => n.type === 'mouSigned');
  assert.deepEqual(Object.keys(item).sort(), ['companyId', 'companyName', 'completedAt', 'counterpartySignedAt', 'docType', 'id', 'occurredAt', 'sendId', 'type']);
  assert.equal(item.sendId, send.sendId);
  assert.equal(JSON.stringify(item).includes('http'), false);
});

test('경로 조작·이상한 값은 400 으로 막히고 다른 문서를 읽지 못한다', async () => {
  const env = await makeEnv();
  const { send, version } = await fullFlow(env);
  const badIds = ['a/b', '../users', '..', '.', '__x__', '', 'x'.repeat(201), ['co-1'], { a: 1 }, 7, null];
  for (const id of badIds) {
    assert.equal((await env.router(req('GET', '/sends', { query: { companyId: id } }))).status, 400, `sends ${JSON.stringify(id)}`);
    assert.equal((await env.router(req('GET', '/pdf', { query: { companyId: id, version: '1', type: 'mou' } }))).status, 400, `pdf ${JSON.stringify(id)}`);
    assert.equal((await env.router(req('POST', '/refresh', { body: { sendId: id } }))).status, 400, `refresh ${JSON.stringify(id)}`);
    assert.equal((await env.router(req('GET', '/signed-document', { query: { sendId: id, type: 'mou' }, personal: 'viewer-token' }))).status, 400, `signed ${JSON.stringify(id)}`);
  }
  for (const type of ['__proto__', 'constructor', 'toString', 'other', '', ['mou']]) {
    assert.equal((await env.router(req('GET', '/pdf', { query: { companyId: 'co-1', version: String(version.version), type } }))).status, 400, `pdf type ${type}`);
    assert.equal((await env.router(req('GET', '/signed-document', { query: { sendId: send.sendId, type }, personal: 'viewer-token' }))).status, 400, `signed type ${type}`);
  }
  for (const v of ['abc', '0', '-1', '1.5', '']) {
    assert.equal((await env.router(req('GET', '/pdf', { query: { companyId: 'co-1', version: v, type: 'mou' } }))).status, 400, `version ${v}`);
  }
  const hook = JSON.stringify({ event: { type: 'document_signed' }, document: { id: '../contractConfig/templates' } });
  assert.equal((await env.router(req('POST', '/modusign-webhook', { rawBody: hook, headers: webhookHeaders('bad-1') }))).status, 400);
});

test('권한 경계: 개인 계정 단독·공용 단독으로는 발송·열람 불가', async () => {
  const env = await makeEnv();
  const v = await env.service.prepare(prepareInput());
  const body = sendInput(v);
  const personalOnly = { method: 'POST', path: '/send', query: {}, body, rawBody: '', headers: { authorization: 'Bearer sender-token', 'x-contract-sender-token': 'sender-token' } };
  assert.equal((await env.router(personalOnly)).status, 403);
  assert.equal((await env.router(req('POST', '/send', { body }))).status, 401);
  assert.equal((await env.router(req('POST', '/retry', { body: { sendId: 'x', type: 'mou' } }))).status, 401);
  assert.equal((await env.router(req('POST', '/resolve-duplicate', { body: { sendId: 'x', type: 'mou', keepDocumentId: 'y' } }))).status, 401);
  assert.equal((await env.router(req('POST', '/company-check', { headers: { authorization: 'Bearer sender-token' }, body: { companyId: 'co-1' } }))).status, 403);
  assert.equal(env.mock.posts.length, 0);
});

test('전체 흐름: 확인한 PDF 그대로 발송, 서명 전 이벤트로는 알림 없음, 실제 서명 후 노란 알림, 고객 문서 불변', async () => {
  const env = await makeEnv();
  const before = JSON.stringify(await env.store.get(COMPANIES_DOC));
  const v = JSON.parse((await env.router(req('POST', '/prepare', { body: prepareInput() }))).body);
  const seen = {};
  for (const type of ['supply', 'mou']) {
    const pdf = await env.router(req('GET', '/pdf', { query: { companyId: 'co-1', version: String(v.version), type } }));
    seen[type] = pdf.headers['x-pdf-sha256'];
  }
  assert.equal(env.mock.posts.length, 0);
  const s = JSON.parse((await env.router(req('POST', '/send', { body: sendInput(v, { hashes: seen }), personal: 'sender-token' }))).body);
  for (const type of ['supply', 'mou']) assert.equal(env.mock.posts.find((p) => p.type === type).sha256, seen[type]);

  const id = s.documents.mou.modusignDocumentId;
  const early = JSON.stringify({ event: { type: 'document_signed' }, document: { id } });
  await env.router(req('POST', '/modusign-webhook', { rawBody: early, headers: webhookHeaders('early') }));
  assert.equal(((await env.store.get(ALERT_DOC)).value || []).length, 0);

  const hook = JSON.stringify(env.mock.sign(id, 1, '2026-11-03T01:00:00.000Z'));
  await env.router(req('POST', '/modusign-webhook', { rawBody: hook, headers: webhookHeaders('real') }));
  const alerts = (await env.store.get(ALERT_DOC)).value;
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'mouSigned');

  const after = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou;
  assert.equal(after.counterpartySignedAt, '2026-11-03T01:00:00.000Z');
  assert.equal(after.allSignedAt, null);
  assert.equal(JSON.stringify(await env.store.get(COMPANIES_DOC)), before);
});
