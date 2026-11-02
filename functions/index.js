'use strict';
// Cloud Functions 진입점. 이 파일은 배포 전까지 실행되지 않는다(Blaze 전환·배포는 별도 승인).
const fs = require('fs');
const path = require('path');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { createService } = require('./src/service');
const { createRouter } = require('./src/router');
const { createAuth } = require('./src/auth');
const { createModusign } = require('./src/modusign');
const { createFirestoreStore, createStorageBlobs } = require('./src/firebaseAdapters');

const MODUSIGN_API_KEY = defineSecret('MODUSIGN_API_KEY');
const MODUSIGN_WEBHOOK_TOKEN = defineSecret('MODUSIGN_WEBHOOK_TOKEN');
const MODUSIGN_API_EMAIL = defineString('MODUSIGN_API_EMAIL', { default: '' });
const CONTRACT_SHARED_UID = defineString('CONTRACT_SHARED_UID', { default: '' });
const CONTRACT_SEND_ENABLED = defineString('CONTRACT_SEND_ENABLED', { default: 'false' });
const CONTRACT_REAL_SEAL_APPROVED = defineString('CONTRACT_REAL_SEAL_APPROVED', { default: 'false' });
const COMPANY_SIGNER_NAME = defineString('COMPANY_SIGNER_NAME', { default: '' });
const COMPANY_SIGNER_EMAIL = defineString('COMPANY_SIGNER_EMAIL', { default: '' });
// 우리 측 시험 발송. 실제 발송 스위치와 별개이며, 수신자는 쉼표로 구분한 우리 측 이메일만 허용한다.
const CONTRACT_TEST_SEND_ENABLED = defineString('CONTRACT_TEST_SEND_ENABLED', { default: 'false' });
const CONTRACT_TEST_RECIPIENTS = defineString('CONTRACT_TEST_RECIPIENTS', { default: '' });
const CONTRACT_ALLOWED_ORIGINS = defineString('CONTRACT_ALLOWED_ORIGINS', { default: 'https://bridgeone-m.github.io' });

const OPTIONS = { region: 'asia-northeast3', secrets: [MODUSIGN_API_KEY, MODUSIGN_WEBHOOK_TOKEN], maxInstances: 2, memory: '512MiB', timeoutSeconds: 120 };
const fontBytes = fs.readFileSync(path.join(__dirname, 'assets/fonts/Pretendard-Regular.ttf'));

let built = null;
function build() {
  if (built) return built;
  admin.initializeApp({ storageBucket: 'pour-dashboard.firebasestorage.app' });
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });
  const apiKey = MODUSIGN_API_KEY.value();
  const email = MODUSIGN_API_EMAIL.value();
  const config = {
    sharedUid: CONTRACT_SHARED_UID.value(),
    sendEnabled: CONTRACT_SEND_ENABLED.value() === 'true',
    testSendEnabled: CONTRACT_TEST_SEND_ENABLED.value() === 'true',
    testRecipients: CONTRACT_TEST_RECIPIENTS.value().split(',').map((s) => s.trim()).filter(Boolean),
    realSealApproved: CONTRACT_REAL_SEAL_APPROVED.value() === 'true',
    allowTestAssets: false, // 운영 서버에서는 시험용 양식·도장을 절대 쓰지 않는다.
    modusignConfigured: !!(apiKey && email),
    modusignIsReal: true,
    companySigner: { name: COMPANY_SIGNER_NAME.value(), email: COMPANY_SIGNER_EMAIL.value() },
    webhookToken: MODUSIGN_WEBHOOK_TOKEN.value(),
  };
  const service = createService({
    store: createFirestoreStore(db),
    blobs: createStorageBlobs(admin.storage().bucket()),
    modusign: createModusign({ baseUrl: 'https://api.modusign.co.kr', email, apiKey }),
    config, now: Date.now, fontBytes,
    serverTime: () => admin.firestore.FieldValue.serverTimestamp(),
  });
  const auth = createAuth({ verifyIdToken: (t) => admin.auth().verifyIdToken(t, true), sharedUid: config.sharedUid, now: Date.now });
  const router = createRouter({ service, auth, allowedOrigins: CONTRACT_ALLOWED_ORIGINS.value().split(',').map((s) => s.trim()) });
  built = { service, router };
  return built;
}

exports.contractApi = onRequest(Object.assign({ invoker: 'public' }, OPTIONS), async (req, res) => {
  const out = await build().router({
    method: req.method, path: req.path, query: req.query, headers: req.headers, body: req.body || {},
    rawBody: req.rawBody ? req.rawBody.toString('utf8') : '',
  });
  res.status(out.status);
  Object.entries(out.headers || {}).forEach(([k, v]) => res.set(k, v));
  res.send(out.body);
});

// 웹훅 누락 대비 보정(공식 문서 권장: 하루 1회 이상).
exports.contractReconcile = onSchedule(Object.assign({ schedule: 'every 6 hours', timeZone: 'Asia/Seoul' }, OPTIONS), async () => {
  await build().service.reconcile();
});
