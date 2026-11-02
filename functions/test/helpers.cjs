'use strict';
// 시험 공통 도구. 실제 업체·계약서 없이 가짜 양식과 가짜 업체만 쓴다.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { createService } = require('../src/service');
const { createRouter } = require('../src/router');
const { createAuth } = require('../src/auth');
const { createModusign } = require('../src/modusign');
const { createMemoryStore, createMemoryBlobs } = require('../src/memoryAdapters');
const { sha256 } = require('../src/pdf');
const { REGISTRY_PATH } = require('../src/templates');
const { createMockModusign } = require('../dev/mock-modusign.cjs');

const fontBytes = fs.readFileSync(path.join(__dirname, '../assets/fonts/Pretendard-Regular.ttf'));
const SHARED_UID = 'shared-owner';
const CLAUSES = ['제1조 계약의 목적 시험 조항입니다.', '제2조 계약의 성격 시험 조항입니다.', '본 계약의 성립을 증명하기 위하여 2부를 작성한다.'];

function bizNo(prefix) {
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(prefix[i]) * weights[i];
  sum += Math.floor((Number(prefix[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return `${prefix.slice(0, 3)}-${prefix.slice(3, 5)}-${prefix.slice(5)}${check}`;
}

function company(over) {
  return Object.assign({ id: 'co-1', code: 'B2B901', name: '시험건설(주)', bizRegNo: bizNo('123456789'), repName: '김시험', address: '서울특별시 시험구 시험로 12, 3층', email: 'ceo@test-co.example' }, over);
}

function testMap(type) {
  const fields = [
    { value: 'name', label: '업체명', page: 1, x: 200, y: 100, w: 200, h: 14, size: 10, minSize: 6.5, align: 'center' },
    { value: 'year', label: '연', page: 2, x: 100, y: 60, w: 40, h: 14, size: 10, align: 'center' },
    { value: 'month', label: '월', page: 2, x: 160, y: 60, w: 30, h: 14, size: 10, align: 'center' },
    { value: 'day', label: '일', page: 2, x: 210, y: 60, w: 30, h: 14, size: 10, align: 'center' },
    { value: 'name', label: '상호', page: 2, x: 120, y: 200, w: 300, h: 26, size: 10, minSize: 7, maxLines: 2 },
    { value: 'address', label: '주소', page: 2, x: 120, y: 230, w: 300, h: 26, size: 10, minSize: 7, maxLines: 2 },
    { value: 'representative', label: '대표자', page: 2, x: 120, y: 260, w: 120, h: 14, size: 10, format: 'spaced' },
  ];
  if (type === 'supply') fields.push({ value: 'bizNo', label: '사업자등록번호', page: 2, x: 120, y: 180, w: 200, h: 14, size: 10 });
  return {
    pageCount: 2, pageSize: { width: 595, height: 842 }, fields,
    signature: { counterparty: { page: 2, x: 300, y: 255, w: 60, h: 30 }, company: { page: 2, x: 300, y: 300, w: 60, h: 30 } },
    sealImage: { page: 2, x: 300, y: 300, w: 40, h: 40 },
  };
}

async function buildTemplate(type) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const p1 = doc.addPage([595, 842]);
  p1.drawText(type === 'supply' ? '물품공급계약서 시험 양식' : 'MOU 체결서 시험 양식', { x: 60, y: 780, size: 14, font });
  CLAUSES.forEach((c, i) => p1.drawText(c, { x: 60, y: 700 - i * 20, size: 10, font }));
  const p2 = doc.addPage([595, 842]);
  p2.drawText('서명란 시험 양식', { x: 60, y: 700, size: 10, font });
  return Buffer.from(await doc.save());
}

// 빨간 사각형 PNG(시험용 도장 대용).
function testSealPng(size = 32) {
  const crc32 = (buf) => { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (~crc) >>> 0; };
  const chunk = (name, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(name), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([200, 30, 30]))]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

async function makeEnv(opts = {}) {
  const clock = { t: Date.parse('2026-11-02T01:00:00Z') };
  const now = () => clock.t;
  const mock = createMockModusign({ scenarios: opts.scenarios, now });
  const blobs = createMemoryBlobs();
  const registry = {};
  for (const type of ['supply', 'mou']) {
    const bytes = await buildTemplate(type);
    await blobs.put(`templates/${type}.pdf`, bytes);
    registry[type] = { status: opts.templateStatus || 'test', version: 't1', blobPath: `templates/${type}.pdf`, sha256: sha256(bytes), map: testMap(type), signaturePositionApproved: true };
  }
  if (opts.seal !== false) {
    const seal = testSealPng();
    await blobs.put('templates/seal.png', seal);
    registry.seal = { kind: 'test', status: 'test', blobPath: 'templates/seal.png', sha256: sha256(seal) };
  }
  if (opts.registry) opts.registry(registry);
  const memory = createMemoryStore({
    [`users/${SHARED_UID}/shin2/shin2-companies-staging`]: { value: opts.companies || [company()] },
    [`users/${SHARED_UID}/shin2/shin2-website-cleanup-v1`]: { value: opts.existingAlerts || [], localRev: 5 },
    [REGISTRY_PATH]: registry,
  });
  const store = opts.wrapStore ? opts.wrapStore(memory) : memory;
  const config = Object.assign({
    sharedUid: SHARED_UID, sendEnabled: true, allowTestAssets: true, realSealApproved: false,
    modusignConfigured: true, modusignIsReal: false, companySigner: { name: '넷폼담당', email: 'signer@netform.example' }, webhookToken: 'hook-secret',
  }, opts.config);
  const modusign = createModusign({ baseUrl: mock.baseUrl, email: 'api@netform.example', apiKey: 'SECRET-API-KEY', fetchImpl: mock.fetchImpl });
  const service = createService({ store, blobs, modusign, config, now, fontBytes });
  const verifyIdToken = async (token) => {
    const claims = tokens[token];
    if (!claims) throw new Error('bad token');
    return claims;
  };
  const tokens = {
    'shared-token': { uid: SHARED_UID },
    'sender-token': { uid: 'person-1', email: 'sender@netform.example', email_verified: true, contractSender: true, auth_time: clock.t / 1000 },
    'viewer-token': { uid: 'person-2', email: 'viewer@netform.example', email_verified: true, contractViewer: true, auth_time: clock.t / 1000 },
    'plain-token': { uid: 'person-3', email: 'plain@netform.example', email_verified: true, auth_time: clock.t / 1000 },
    'unverified-token': { uid: 'person-4', email: 'x@netform.example', email_verified: false, contractSender: true, auth_time: clock.t / 1000 },
    'other-token': { uid: 'someone-else' },
  };
  const auth = createAuth({ verifyIdToken, sharedUid: SHARED_UID, now });
  const logs = [];
  const logger = { error: (...a) => logs.push(a.join(' ')), log: (...a) => logs.push(a.join(' ')) };
  const router = createRouter({ service, auth, allowedOrigins: ['https://bridgeone-m.github.io'], logger });
  const sender = { uid: 'person-1', email: 'sender@netform.example', name: '' };
  return { clock, mock, blobs, store, config, service, router, tokens, logs, sender };
}

const prepareInput = (over) => Object.assign({ companyId: 'co-1', companyCode: 'B2B901', contractDate: '2026-11-02', recipientEmail: 'ceo@test-co.example', actorLabel: '사용자 1' }, over);
const sendInput = (v, over) => Object.assign({
  companyId: v.companyId, version: v.version, hashes: { supply: v.docs.supply.sha256, mou: v.docs.mou.sha256 },
  recipientEmail: v.recipientEmail, representative: v.company.representative, confirmed: true,
}, over);

async function pdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str).join(' '));
  }
  return pages.join('\n');
}

const webhookHeaders = (deliveryId) => ({ 'x-card-webhook-token': 'hook-secret', 'modusign-delivery-id': deliveryId, 'modusign-webhook-id': 'w1' });

module.exports = { SHARED_UID, CLAUSES, bizNo, company, makeEnv, prepareInput, sendInput, pdfText, webhookHeaders, testSealPng, buildTemplate, testMap, fontBytes };
