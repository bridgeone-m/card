'use strict';
// 로컬 검증 서버. 고객관리카드 index.html 을 그대로 띄우되 Firebase SDK 와 모두사인을 모의로 바꾼다.
// 실제 Firebase·모두사인으로 나가는 요청이 없고, 저장은 메모리에만 한다(가짜 업체만 사용).
//   node functions/dev/mock-server.cjs [build-templates.py 결과 폴더]   (폴더가 없으면 합성 양식)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createService } = require('../src/service');
const { createRouter } = require('../src/router');
const { createAuth } = require('../src/auth');
const { createModusign } = require('../src/modusign');
const { createMemoryStore, createMemoryBlobs } = require('../src/memoryAdapters');
const { sha256 } = require('../src/pdf');
const { REGISTRY_PATH } = require('../src/templates');
const { createMockModusign } = require('./mock-modusign.cjs');
const helpers = require('../test/helpers.cjs');

const PORT = Number(process.env.PORT || 5191);
const ROOT = path.join(__dirname, '../..');
const SHARED_UID = 'mock-shared-uid';
const WEBHOOK_TOKEN = 'mock-webhook-token';
const SHARED_EMAIL = 'hansol2-owner@pour-dashboard.firebaseapp.com';
const ACCOUNTS = {
  [SHARED_EMAIL]: { uid: SHARED_UID, password: 'test-shared-pw', claims: {} },
  'sender@test.example': { uid: 'mock-sender', password: 'sender-pw', claims: { contractSender: true, email_verified: true } },
  'viewer@test.example': { uid: 'mock-viewer', password: 'viewer-pw', claims: { contractViewer: true, email_verified: true } },
  'staff@test.example': { uid: 'mock-staff', password: 'staff-pw', claims: { email_verified: true } },
};

const biz = helpers.bizNo;
const companies = [
  { id: 'test-ok', code: 'B2B901', name: '시험건설(주)', repName: '김시험', bizRegNo: biz('123456789'), address: '서울특별시 시험구 시험로 12, 3층', email: 'ceo@test-co.example', contactName: '이담당', mobile: '010-0000-0001', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'test-long', code: 'B2B902', name: '대한민국종합건설산업(주)시험', repName: '남궁시험', bizRegNo: biz('234567891'), address: '경기도 시험시 시험구 시험대로 1234번길 56-78, 시험타워 제3동 12층 1205호(시험동, 시험아파트단지내상가)', email: 'long@test-co.example', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'test-missing', code: 'B2B903', name: '누락시험건설', repName: '', bizRegNo: '', address: '서울특별시 시험구', email: '', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'test-ambiguous', code: 'B2B904', name: '이메일모호건설', repName: '박시험', bizRegNo: biz('345678912'), address: '부산광역시 시험구 시험로 9', email: 'a@test-co.example, b@test-co.example', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
];

async function loadAssets(blobs) {
  const dir = process.env.CONTRACT_DEV_ASSETS || process.argv[2];
  const registry = {};
  for (const type of ['supply', 'mou']) {
    const file = dir && path.join(dir, `${type}.template.pdf`);
    const hasFile = file && fs.existsSync(file);
    const bytes = hasFile ? fs.readFileSync(file) : await helpers.buildTemplate(type);
    const map = hasFile ? JSON.parse(fs.readFileSync(path.join(dir, `${type}.map.json`), 'utf8')) : helpers.testMap(type);
    const blobPath = `templates/${type}.pdf`;
    await blobs.put(blobPath, bytes);
    // 원본에서 빌드한 양식이면 그 상태를 보여 준다. 모의 서버는 실제 모두사인으로 보내지 않는다.
    registry[type] = { status: hasFile ? 'approved' : 'test', version: hasFile ? 'local-original' : 'test-1', blobPath, sha256: sha256(bytes), map, signaturePositionApproved: true };
  }
  const sealFile = dir && path.join(dir, 'test-seal.png');
  const seal = sealFile && fs.existsSync(sealFile) ? fs.readFileSync(sealFile) : helpers.testSealPng();
  await blobs.put('templates/seal.png', seal);
  registry.seal = { kind: 'test', status: 'test', blobPath: 'templates/seal.png', sha256: sha256(seal) };
  return registry;
}

function rewriteIndex(html) {
  return html
    .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/10\.14\.1\/firebase-[a-z]+\.js/g, '/__mock/firebase.mjs')
    .replace(/<script src="kakaoMapConfig\.js"[^>]*><\/script>/, '');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };

async function main() {
  const blobs = createMemoryBlobs();
  const registry = await loadAssets(blobs);
  const store = createMemoryStore({
    [`users/${SHARED_UID}/shin2/shin2-companies-staging`]: { value: companies, localRev: 1 },
    [`users/${SHARED_UID}/shin2/shin2-website-cleanup-v1`]: {
      value: [{ id: 'existing-mou', type: 'mou', companyId: 'test-long', companyName: '기존알림시험', occurredAt: '2026-10-30T00:00:00Z', materials: false, documents: false, signed: false, completedAt: null }],
      localRev: 1,
    },
    [REGISTRY_PATH]: registry,
  });
  const mock = createMockModusign();
  const config = {
    sharedUid: SHARED_UID, sendEnabled: true, allowTestAssets: true, realSealApproved: false, modusignConfigured: true, modusignIsReal: false,
    companySigner: { name: '넷폼담당', email: 'signer@test.example' }, webhookToken: WEBHOOK_TOKEN,
    testSendEnabled: process.env.MOCK_TEST_SEND !== 'false', testRecipients: ['ourside@test.example'],
  };
  const modusign = createModusign({ baseUrl: mock.baseUrl, email: 'api@test.example', apiKey: 'mock-key', fetchImpl: mock.fetchImpl });
  const service = createService({ store, blobs, modusign, config, now: Date.now, fontBytes: helpers.fontBytes });
  const tokens = new Map();
  const auth = createAuth({
    verifyIdToken: async (token) => {
      if (!tokens.has(token)) throw new Error('bad token');
      return tokens.get(token);
    },
    sharedUid: SHARED_UID, now: Date.now,
  });
  const router = createRouter({ service, auth, allowedOrigins: [`http://localhost:${PORT}`] });
  let deliveries = 0;
  const clientDenied = [];
  const clientAllowed = (p) => {
    const ok = typeof p === 'string' && p.startsWith(`users/${SHARED_UID}/`);
    if (!ok) clientDenied.push(p);
    return ok;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const sendJson = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    const body = () => (raw ? JSON.parse(raw) : {});
    try {
      if (url.pathname.startsWith('/api/')) {
        const out = await router({ method: req.method, path: url.pathname.slice(4), query: Object.fromEntries(url.searchParams), headers: req.headers, body: raw && req.headers['content-type'] === 'application/json' ? JSON.parse(raw) : {}, rawBody: raw });
        res.writeHead(out.status, out.headers);
        res.end(out.body);
        return;
      }
      switch (url.pathname) {
        case '/firebaseConfig.js':
          res.writeHead(200, { 'content-type': MIME['.js'] });
          res.end('window.FIREBASE_CONFIG={apiKey:"mock",authDomain:"mock",projectId:"demo-card",storageBucket:"mock",messagingSenderId:"0",appId:"mock"};');
          return;
        case '/contractEsignConfig.js':
          res.writeHead(200, { 'content-type': MIME['.js'] });
          res.end("window.SHIN2_CONTRACT_CONFIG={apiBase:'/api'};");
          return;
        case '/__mock/firebase.mjs':
          res.writeHead(200, { 'content-type': MIME['.mjs'] });
          res.end(fs.readFileSync(path.join(__dirname, 'mock-firebase.mjs')));
          return;
        case '/__mock/auth/login': {
          const { email, password } = body();
          const account = ACCOUNTS[email];
          if (!account || account.password !== password) return sendJson(400, { code: 'auth/invalid-credential' });
          const token = `mock-${account.uid}-${Date.now()}`;
          tokens.set(token, Object.assign({ uid: account.uid, email, auth_time: Math.floor(Date.now() / 1000) }, account.claims));
          return sendJson(200, { uid: account.uid, email, token });
        }
        // 카드 → Firestore 경로. 운영 규칙과 같이 users/{로그인 uid} 아래만 허용하고 나머지는 거부·기록한다.
        case '/__mock/fs/get': {
          if (!clientAllowed(body().path)) return sendJson(403, { code: 'permission-denied' });
          return sendJson(200, { data: await store.get(body().path) });
        }
        case '/__mock/fs/list': {
          if (!clientAllowed(body().path)) return sendJson(403, { code: 'permission-denied' });
          const prefix = body().path + '/';
          const docs = [];
          for (const [p, d] of store.docs) if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) docs.push({ path: p, data: d });
          return sendJson(200, { docs });
        }
        case '/__mock/fs/commit': {
          const { writes } = body();
          if (!writes.every((w) => clientAllowed(w.path))) return sendJson(403, { code: 'permission-denied' });
          await store.transaction(async (tx) => { for (const w of writes) if (!w.remove) tx.set(w.path, w.data, { merge: w.merge }); });
          for (const w of writes) if (w.remove) store.docs.delete(w.path);
          return sendJson(200, { ok: true });
        }
        // ---- 시험 조작 ----
        case '/__mock/scenario': {
          const b = body();
          for (const t of ['supply', 'mou']) if (b[t]) mock.plan[t].push(...b[t]);
          if ('hideFromSearch' in b) mock.state.hideFromSearch = !!b.hideFromSearch;
          return sendJson(200, { plan: mock.plan, state: mock.state });
        }
        case '/__mock/sign': {
          // 모두사인 서명 + 웹훅 전달을 흉내 낸다. repeat 면 같은 내용을 새 전달 ID 로 또 보낸다.
          const b = body();
          const send = await store.get(`contractSends/${b.sendId}`);
          const docId = send.documents[b.type].modusignDocumentId;
          const event = mock.sign(docId, b.order, b.at);
          const results = [];
          for (let i = 0; i < (b.repeat || 1); i++) {
            const delivery = `delivery-${++deliveries}`;
            const out = await router({ method: 'POST', path: '/modusign-webhook', query: {}, body: {}, headers: { 'x-card-webhook-token': WEBHOOK_TOKEN, 'modusign-delivery-id': delivery }, rawBody: JSON.stringify(event) });
            results.push(JSON.parse(out.body));
          }
          return sendJson(200, { event, results });
        }
        case '/__mock/state': {
          const sends = [];
          for (const [p, d] of store.docs) if (p.startsWith('contractSends/')) sends.push(d);
          return sendJson(200, { clientDenied, storedCollections: Array.from(new Set([...store.docs.keys()].map((p) => p.split('/')[0]))), posts: mock.posts.map(({ type, scenario, sha256: s }) => ({ type, scenario, sha256: s })), documents: mock.documents.size, sends, alerts: (await store.get(`users/${SHARED_UID}/shin2/shin2-website-cleanup-v1`)).value, companies: (await store.get(`users/${SHARED_UID}/shin2/shin2-companies-staging`)).value });
        }
        default:
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(rel === 'index.html' ? rewriteIndex(fs.readFileSync(file, 'utf8')) : fs.readFileSync(file));
    } catch (err) {
      console.error('mock server error', err);
      if (!res.headersSent) sendJson(500, { code: 'mock', message: String(err && err.message) });
    }
  });
  server.listen(PORT, () => console.log(`mock card server http://localhost:${PORT} (templates: ${process.env.CONTRACT_DEV_ASSETS || process.argv[2] ? 'dev assets' : 'synthetic'})`));
}

main();
