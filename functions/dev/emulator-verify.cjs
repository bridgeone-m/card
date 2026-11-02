'use strict';
// 실제 Firebase 에뮬레이터(규칙 엔진 포함)로 Storage·Firestore 규칙과 서버 전체 흐름을 검증한다.
// 가상 프로젝트(demo-*)에서만 실행되며 운영 Firebase·모두사인에 연결하지 않는다.
//
//   EMU_DEPS=<rules-unit-testing·firebase 가 설치된 폴더> EMU_ASSETS=<build-templates.py 결과 폴더> \
//     firebase emulators:exec --only auth,firestore,storage --project demo-card "node functions/dev/emulator-verify.cjs"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEPS = process.env.EMU_DEPS;
if (!DEPS) throw new Error('EMU_DEPS 가 필요합니다.');
module.paths.unshift(path.join(DEPS, 'node_modules'));

const PROJECT = 'demo-card';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('에뮬레이터 환경에서만 실행합니다.');
}
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT) throw new Error(`가상 프로젝트가 아닙니다: ${process.env.GCLOUD_PROJECT}`);

const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { ref, uploadString, getBytes, getDownloadURL, getMetadata, updateMetadata, deleteObject, listAll } = require('firebase/storage');
const { doc, getDoc, setDoc, deleteDoc, collection, getDocs } = require('firebase/firestore');

const BUCKET = `${PROJECT}.appspot.com`;
const SHARED = 'shared-uid-for-test';
const [host, portText] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const [sHost, sPortText] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');
const results = { storage: [], list: [], rest: [], rest2: [], firestore: [], flow: [] };
let failures = 0;

function record(group, name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  results[group].push({ name, actual, expected, ok });
  if (!ok) console.log(`  불일치 [${group}] ${name}: 실제 ${JSON.stringify(actual)} / 예상 ${JSON.stringify(expected)}`);
}

// ---- 규칙 3종 ------------------------------------------------------------------
// 지금 운영 규칙. 2026-11-02 원문과 대조했다: UID 값(시험값)과 조건의 줄바꿈만 다르다.
const RECONSTRUCTED_CURRENT = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == '${SHARED}';
    }
  }
}`;
// "allow false 만 추가"하면 왜 안 되는지 보여 주는 비교용.
const ONLY_FALSE_ADDED = RECONSTRUCTED_CURRENT.replace('match /{allPaths=**} {', `match /contracts/{r=**} { allow read, write: if false; }
    match /contractAssets/{r=**} { allow read, write: if false; }
    match /{allPaths=**} {`);
const PROPOSED = fs.readFileSync(path.join(__dirname, '../../docs/contract-esign/storage.rules.proposed'), 'utf8')
  .split(/\r?\n/).filter((l) => !l.trim().startsWith('//')).join('\n').replace(/<공용 UID>/g, SHARED);
if (!PROPOSED.includes(`request.auth.uid == '${SHARED}'`) || PROPOSED.includes('<공용 UID>')) throw new Error('규칙안에 시험 UID 가 들어가지 않았습니다.');
// 사용자가 알려 준 운영 Firestore 규칙 원문.
const FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

const USER_FILES = [`users/${SHARED}/customers/co_1/documents/d1/a.pdf`, `users/${SHARED}/mailCommonAssets/firstMeeting/a1/b.pdf`];
const CONTRACT_FILES = ['contracts/co_1/v1/mou.pdf', 'contractAssets/templates/mou/2026-11.pdf', 'contractAssets/seal/abc.png'];
const OTHER_FILES = ['legacy/x.pdf', 'contractsX/x.pdf', 'root.pdf'];
const IDENTITIES = [['공용', SHARED], ['개인담당자', 'person-1'], ['다른계정', 'other-uid'], ['비로그인', null]];

const contextFor = (env, uid) => (uid ? env.authenticatedContext(uid, uid === 'person-1' ? { contractSender: true, email_verified: true } : {}) : env.unauthenticatedContext());
const bucketOf = (ctx) => ctx.storage(`gs://${BUCKET}`);

async function attempt(fn) {
  try { await fn(); return 'ok'; }
  catch (err) {
    if (err && (err.code === 'storage/unauthorized' || err.code === 'permission-denied' || err.code === 'firestore/permission-denied')) return 'denied';
    return `error:${(err && err.code) || (err && err.message)}`;
  }
}

async function wipeBucket() {
  const res = await fetch(`http://${sHost}:${sPortText}/internal/reset`, { method: 'POST' }).catch(() => null);
  return res && res.ok;
}

async function storageOps(env, ctx, file) {
  const seed = () => env.withSecurityRulesDisabled((c) => uploadString(ref(bucketOf(c), file), 'seed'));
  await seed();
  const r = ref(bucketOf(ctx), file);
  const out = {};
  out.get = await attempt(() => getBytes(r));
  out.url = await attempt(() => getDownloadURL(r));
  out.meta = await attempt(() => getMetadata(r));
  out.updateMeta = await attempt(() => updateMetadata(r, { customMetadata: { a: 'b' } }));
  out.upload = await attempt(() => uploadString(r, 'client'));
  await seed();
  out.delete = await attempt(() => deleteObject(r));
  return out;
}
const ALL_OK = { get: 'ok', url: 'ok', meta: 'ok', updateMeta: 'ok', upload: 'ok', delete: 'ok' };
const ALL_DENIED = { get: 'denied', url: 'denied', meta: 'denied', updateMeta: 'denied', upload: 'denied', delete: 'denied' };

function mockToken(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: uid, user_id: uid, uid, aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'custom', identities: {} } })}.`;
}
async function restList(uid, query) {
  const res = await fetch(`http://${sHost}:${sPortText}/v0/b/${BUCKET}/o?${query}`, { headers: uid ? { authorization: `Firebase ${mockToken(uid)}` } : {} });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) { /* 본문 없음 */ }
  return { status: res.status, items: (body.items || []).map((i) => i.name), prefixes: body.prefixes || [] };
}

async function storageSuite(label, rules, expectFile) {
  console.log(`\n[Storage] ${label}`);
  const env = await initializeTestEnvironment({
    projectId: PROJECT,
    storage: { rules, host: sHost, port: Number(sPortText) },
  });
  await wipeBucket();
  for (const [who, uid] of IDENTITIES) {
    const ctx = contextFor(env, uid);
    for (const file of [...USER_FILES, ...CONTRACT_FILES, ...OTHER_FILES]) {
      record('storage', `${label} | ${who} | ${file}`, await storageOps(env, ctx, file), expectFile(uid, file) ? ALL_OK : ALL_DENIED);
    }
  }
  await wipeBucket();
  for (const file of [...USER_FILES, ...CONTRACT_FILES, ...OTHER_FILES]) {
    await env.withSecurityRulesDisabled((c) => uploadString(ref(bucketOf(c), file), 'seed'));
  }
  const listCases = ['', 'contracts', 'contracts/co_1', 'contractAssets', 'contractAssets/templates', `users/${SHARED}/customers/co_1`, 'legacy'];
  for (const [who, uid] of IDENTITIES) {
    const ctx = contextFor(env, uid);
    for (const prefix of listCases) {
      const outcome = await attempt(() => listAll(ref(bucketOf(ctx), prefix)));
      record('list', `${label} | ${who} | list('${prefix}')`, outcome, expectFile(uid, prefix || '__root__', true) ? 'ok' : 'denied');
    }
  }
  // SDK 를 거치지 않는 직접 요청: 구분자 없는 넓은 조회로 계약 파일 이름이 보이는지.
  for (const query of ['prefix=contr', 'prefix=c', 'prefix=', 'delimiter=/', 'prefix=contracts/', 'prefix=contracts/&delimiter=/', 'prefix=contracts', 'prefix=contractAssets/', 'prefix=legacy/', `prefix=users/${SHARED}/&delimiter=/`, 'prefix=contractsX/']) {
    const out = await restList(SHARED, query);
    const leaked = out.items.filter((n) => /^contract(s|Assets)\//.test(n));
    results.rest.push({ rule: label, query, status: out.status, itemCount: out.items.length, contractNames: leaked, prefixes: out.prefixes });
    if (label === '규칙안') record('rest2', `규칙안 직접조회 ${query} 계약 이름 노출 없음`, leaked, []);
  }
  await env.cleanup();
}

async function firestoreSuite() {
  console.log('\n[Firestore] 사용자가 알려 준 운영 규칙 원문');
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: FIRESTORE_RULES, host, port: Number(portText) } });
  await env.clearFirestore();
  const contractDocs = ['contractConfig/templates', 'contractPreparations/co_1', 'contractVersions/co_1_v1', 'contractSends/s1', 'contractDocIndex/d1', 'contractWebhookDeliveries/w1', 'contractAccessLogs/a1'];
  const sharedDocs = [`users/${SHARED}/shin2/shin2-companies-staging`, `users/${SHARED}/shin2/shin2-website-cleanup-v1`];
  await env.withSecurityRulesDisabled(async (c) => {
    for (const p of [...contractDocs, ...sharedDocs]) await setDoc(doc(c.firestore(), p), { seed: true });
  });
  const ops = async (ctx, p) => {
    const d = doc(ctx.firestore(), p);
    return {
      get: await attempt(() => getDoc(d)),
      set: await attempt(() => setDoc(d, { client: true }, { merge: true })),
      delete: await attempt(() => deleteDoc(d)),
      list: await attempt(() => getDocs(collection(ctx.firestore(), p.split('/').slice(0, -1).join('/')))),
    };
  };
  const OK = { get: 'ok', set: 'ok', delete: 'ok', list: 'ok' };
  const NO = { get: 'denied', set: 'denied', delete: 'denied', list: 'denied' };
  for (const [who, uid] of IDENTITIES) {
    const ctx = contextFor(env, uid);
    for (const p of contractDocs) record('firestore', `${who} | ${p}`, await ops(ctx, p), NO);
    for (const p of sharedDocs) {
      await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), p), { seed: true }));
      record('firestore', `${who} | ${p}`, await ops(ctx, p), uid === SHARED ? OK : NO);
    }
  }
  await env.cleanup();
}

// ---- 서버 전체 흐름: 실제 Firestore 트랜잭션·Storage·토큰 검증 ------------------------
async function flowSuite() {
  console.log('\n[전체 흐름] 실제 어댑터 + 에뮬레이터 + 모의 모두사인');
  const admin = require('firebase-admin');
  const { createService } = require('../src/service');
  const { createRouter } = require('../src/router');
  const { createAuth } = require('../src/auth');
  const { createModusign } = require('../src/modusign');
  const { createFirestoreStore, createStorageBlobs } = require('../src/firebaseAdapters');
  const { sha256 } = require('../src/pdf');
  const { createMockModusign } = require('./mock-modusign.cjs');
  const helpers = require('../test/helpers.cjs');

  const app = admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET }, 'emu-flow');
  const db = app.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  const bucket = app.storage().bucket();
  const authAdmin = app.auth();

  const env = await initializeTestEnvironment({
    projectId: PROJECT,
    storage: { rules: PROPOSED, host: sHost, port: Number(sPortText) },
    firestore: { rules: FIRESTORE_RULES, host, port: Number(portText) },
  });
  await wipeBucket();
  await env.clearFirestore();

  const users = { shared: SHARED, sender: 'person-sender', viewer: 'person-viewer', plain: 'person-plain' };
  for (const [name, uid] of Object.entries(users)) {
    await authAdmin.createUser({ uid, email: `${name}@test.example`, password: 'test-password-1', emailVerified: true }).catch((e) => {
      if (e.code !== 'auth/uid-already-exists') throw e;
    });
  }
  await authAdmin.setCustomUserClaims(users.sender, { contractSender: true });
  await authAdmin.setCustomUserClaims(users.viewer, { contractViewer: true });
  const signIn = async (name) => {
    const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${name}@test.example`, password: 'test-password-1', returnSecureToken: true }),
    });
    const json = await res.json();
    if (!json.idToken) throw new Error(`로그인 실패 ${name}`);
    return json.idToken;
  };
  const tokens = {};
  for (const name of Object.keys(users)) tokens[name] = await signIn(name);

  // 양식: 원본 빌드 결과가 있으면 그것을, 없으면 합성 양식을 쓴다.
  const assets = process.env.EMU_ASSETS;
  const registry = {};
  for (const type of ['supply', 'mou']) {
    const file = assets && path.join(assets, `${type}.template.pdf`);
    const hasFile = file && fs.existsSync(file);
    const bytes = hasFile ? fs.readFileSync(file) : await helpers.buildTemplate(type);
    const map = hasFile ? JSON.parse(fs.readFileSync(path.join(assets, `${type}.map.json`), 'utf8')) : helpers.testMap(type);
    const blobPath = `contractAssets/templates/${type}/emu-1.pdf`;
    await bucket.file(blobPath).save(bytes, { resumable: false, contentType: 'application/pdf' });
    registry[type] = { status: 'approved', version: 'emu-1', blobPath, sha256: sha256(bytes), map, signaturePositionApproved: true, provenance: { source: 'emulator', approvedBy: 'emulator', approvedAt: '2026-11-02' } };
  }
  await db.doc('contractConfig/templates').set(registry);
  const companiesPath = `users/${SHARED}/shin2/shin2-companies-staging`;
  const alertPath = `users/${SHARED}/shin2/shin2-website-cleanup-v1`;
  await db.doc(companiesPath).set({ value: [helpers.company()], localRev: 1 });
  const keep = { id: 'keep', type: 'mou', companyId: 'other', companyName: '기존알림', completedAt: null };
  await db.doc(alertPath).set({ value: [keep], localRev: 5 });

  const mock = createMockModusign();
  const logs = [];
  const service = createService({
    store: createFirestoreStore(db), blobs: createStorageBlobs(bucket),
    modusign: createModusign({ baseUrl: mock.baseUrl, email: 'api@test.example', apiKey: 'emu-key', fetchImpl: mock.fetchImpl }),
    config: {
      sharedUid: SHARED, sendEnabled: true, allowTestAssets: false, realSealApproved: false, modusignConfigured: true, modusignIsReal: false,
      companySigner: { name: '넷폼담당', email: 'signer@test.example' }, webhookToken: 'emu-webhook-token',
    },
    now: Date.now, fontBytes: helpers.fontBytes, serverTime: () => admin.firestore.FieldValue.serverTimestamp(),
    logger: { error: (...a) => logs.push(a.join(' ')) },
  });
  const auth = createAuth({ verifyIdToken: (t) => authAdmin.verifyIdToken(t, true), sharedUid: SHARED, now: Date.now });
  const router = createRouter({ service, auth, allowedOrigins: [], logger: { error: (...a) => logs.push(a.join(' ')) } });
  const call = (method, route, opts = {}) => router({
    method, path: route, query: opts.query || {}, body: opts.body || {}, rawBody: opts.rawBody || '',
    headers: Object.assign({}, opts.noShared ? {} : { authorization: `Bearer ${opts.token || tokens.shared}` }, opts.personal ? { 'x-contract-sender-token': opts.personal } : {}, opts.headers),
  });
  const beforeCompanies = JSON.stringify((await db.doc(companiesPath).get()).data());

  const check = await call('POST', '/company-check', { body: { companyId: 'co-1', companyCode: 'B2B901' } });
  record('flow', '실제 토큰으로 업체 확인', check.status, 200);
  record('flow', '토큰 없이 거부', (await call('POST', '/company-check', { noShared: true, body: { companyId: 'co-1' } })).status, 401);
  record('flow', '다른 계정 토큰 거부', (await call('POST', '/company-check', { token: tokens.plain, body: { companyId: 'co-1' } })).status, 403);

  const prep = await call('POST', '/prepare', { body: helpers.prepareInput() });
  record('flow', 'PDF 2종 생성·Storage 저장', prep.status, 200);
  const v = JSON.parse(prep.body);
  const seen = {};
  for (const type of ['supply', 'mou']) {
    const pdf = await call('GET', '/pdf', { query: { companyId: 'co-1', version: String(v.version), type } });
    seen[type] = crypto.createHash('sha256').update(pdf.body).digest('hex');
    record('flow', `미리보기 ${type} 지문이 기록과 일치`, seen[type], v.docs[type].sha256);
  }
  record('flow', '미리보기까지 발송 0건', mock.posts.length, 0);
  const body = helpers.sendInput(v, { hashes: seen });
  record('flow', '공용 로그인만으로 발송 거부', (await call('POST', '/send', { body })).status, 401);
  record('flow', '발송 권한 없는 개인 계정 거부', (await call('POST', '/send', { body, personal: tokens.plain })).status, 403);
  record('flow', '열람 권한만 있는 계정 발송 거부', (await call('POST', '/send', { body, personal: tokens.viewer })).status, 403);
  record('flow', '거부 후에도 발송 0건', mock.posts.length, 0);

  // 실제 트랜잭션으로 동시 요청 4건.
  const sends = await Promise.all([1, 2, 3, 4].map(() => call('POST', '/send', { body, personal: tokens.sender })));
  record('flow', '동시 발송 4건 모두 응답', sends.map((r) => r.status), [200, 200, 200, 200]);
  record('flow', '실제 트랜잭션에서 문서별 1회만 발송', mock.posts.map((p) => p.type).sort(), ['mou', 'supply']);
  for (const type of ['supply', 'mou']) record('flow', `발송 ${type} 지문이 확인한 PDF 와 일치`, mock.posts.find((p) => p.type === type).sha256, seen[type]);
  const sent = JSON.parse(sends[0].body);
  const final = JSON.parse((await call('POST', '/refresh', { body: { sendId: sent.sendId } })).body);
  record('flow', '두 문서 발송 완료 기록', [final.documents.supply.delivery, final.documents.mou.delivery], ['created', 'created']);
  record('flow', '처리자 기록(토큰 이메일)', final.processedBy.email, 'sender@test.example');

  // 저장 위치·클라이언트 차단(실제 규칙 엔진).
  const [objects] = await bucket.getFiles();
  const names = objects.map((o) => o.name);
  results.flowObjects = names;
  record('flow', 'Storage 객체는 전부 계약 경로', names.every((n) => /^contract(s|Assets)\//.test(n)), true);
  record('flow', '서버(Admin SDK)는 규칙안 적용 후에도 저장 가능', names.includes(`contracts/co-1/v${v.version}/mou.pdf`), true);
  const [meta] = await bucket.file(`contracts/co-1/v${v.version}/mou.pdf`).getMetadata();
  record('flow', '서버 저장 PDF 에 공개 다운로드 토큰 없음', !!(meta.metadata && meta.metadata.firebaseStorageDownloadTokens), false);
  const sharedCtx = env.authenticatedContext(SHARED);
  const senderCtx = env.authenticatedContext(users.sender, { contractSender: true, email_verified: true });
  for (const [who, ctx] of [['공용', sharedCtx], ['발송 담당자', senderCtx]]) {
    const r = ref(bucketOf(ctx), `contracts/co-1/v${v.version}/mou.pdf`);
    record('flow', `${who} 클라이언트가 실제 계약 PDF 읽기 차단`, await attempt(() => getBytes(r)), 'denied');
    record('flow', `${who} 클라이언트가 실제 계약 PDF 링크 받기 차단`, await attempt(() => getDownloadURL(r)), 'denied');
    record('flow', `${who} 클라이언트가 실제 계약 PDF 덮어쓰기 차단`, await attempt(() => uploadString(r, 'tampered')), 'denied');
    record('flow', `${who} 클라이언트가 양식 읽기 차단`, await attempt(() => getBytes(ref(bucketOf(ctx), 'contractAssets/templates/mou/emu-1.pdf'))), 'denied');
    record('flow', `${who} 클라이언트가 발송 기록 읽기 차단`, await attempt(() => getDoc(doc(ctx.firestore(), `contractSends/${sent.sendId}`))), 'denied');
    record('flow', `${who} 클라이언트가 등록부 변조 차단`, await attempt(() => setDoc(doc(ctx.firestore(), 'contractConfig/templates'), { hacked: true }, { merge: true })), 'denied');
  }

  // 서명 검증·알림.
  const docId = final.documents.mou.modusignDocumentId;
  const hook = (id, b) => call('POST', '/modusign-webhook', { noShared: true, rawBody: b, headers: { 'x-card-webhook-token': 'emu-webhook-token', 'modusign-delivery-id': id } });
  const fake = JSON.stringify({ event: { type: 'document_signed' }, document: { id: docId } });
  await hook('early', fake);
  const alerts = async () => (await db.doc(alertPath).get()).data().value;
  record('flow', '서명 전 이벤트로 알림 없음', (await alerts()).filter((n) => n.type === 'mouSigned').length, 0);
  record('flow', '비밀 헤더 없는 웹훅 거부', (await call('POST', '/modusign-webhook', { noShared: true, rawBody: fake, headers: { 'modusign-delivery-id': 'x' } })).status, 401);
  const signed = JSON.stringify(mock.sign(docId, 1, '2026-11-03T01:00:00.000Z'));
  await Promise.all([hook('d1', signed), hook('d2', signed), hook('d3', signed)]);
  const list = await alerts();
  record('flow', '동시 웹훅 3건에도 노란 알림 1건', list.filter((n) => n.type === 'mouSigned').length, 1);
  record('flow', '기존 알림 보존', list.some((n) => n.id === 'keep'), true);
  record('flow', '공용 계정이 알림 문서를 규칙대로 읽음', await attempt(() => getDoc(doc(sharedCtx.firestore(), alertPath))), 'ok');
  const status = (await service.listSends({ companyId: 'co-1' }))[0].documents.mou;
  record('flow', '상대방 완료·양측 미완료 구분', [status.counterpartySignedAt, status.allSignedAt], ['2026-11-03T01:00:00.000Z', null]);

  // 문서 보기·권한 회수.
  const q = { query: { sendId: sent.sendId, type: 'mou' } };
  record('flow', '문서 보기: 공용만으로 거부', (await call('GET', '/signed-document', q)).status, 401);
  record('flow', '문서 보기: 권한 없는 개인 거부', (await call('GET', '/signed-document', Object.assign({ personal: tokens.plain }, q))).status, 403);
  record('flow', '문서 보기: 열람 권한 허용', (await call('GET', '/signed-document', Object.assign({ personal: tokens.viewer }, q))).status, 200);
  await new Promise((r) => setTimeout(r, 1100));
  await authAdmin.revokeRefreshTokens(users.viewer);
  await new Promise((r) => setTimeout(r, 1100));
  record('flow', '토큰 폐기 후 즉시 거부(checkRevoked)', (await call('GET', '/signed-document', Object.assign({ personal: tokens.viewer }, q))).status, 401);
  await authAdmin.setCustomUserClaims(users.sender, {});
  const noClaim = await signIn('sender');
  record('flow', '권한 회수 후 새 로그인도 발송 거부', (await call('POST', '/retry', { body: { sendId: sent.sendId, type: 'mou' }, personal: noClaim })).status, 403);

  record('flow', '고객 문서 불변', JSON.stringify((await db.doc(companiesPath).get()).data()), beforeCompanies);
  record('flow', '서버 내부 오류 기록 없음', logs, []);
  await env.cleanup();
}

(async () => {
  const fileRule = (uid, file) => {
    if (uid !== SHARED) return false;
    return true;
  };
  const proposedRule = (uid, file, isList) => {
    if (uid !== SHARED) return false;
    if (isList && file === '__root__') return false;
    return !/^(contracts|contractAssets)(\/|$)/.test(file);
  };
  await storageSuite('현재(재구성)', RECONSTRUCTED_CURRENT, fileRule);
  await storageSuite('allow false만 추가', ONLY_FALSE_ADDED, fileRule);
  await storageSuite('규칙안', PROPOSED, proposedRule);
  await firestoreSuite();
  await flowSuite();
  const out = process.env.EMU_RESULT;
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
  const counts = Object.fromEntries(Object.entries(results).filter(([k]) => k !== 'flowObjects').map(([k, v]) => [k, k === 'rest' ? v.length : `${v.filter((x) => x.ok).length}/${v.length}`]));
  console.log('\n결과', JSON.stringify(counts), '불일치', failures);
  process.exit(failures ? 1 : 0);
})().catch((err) => { console.error('중단', err); process.exit(2); });
