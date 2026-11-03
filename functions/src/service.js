'use strict';
// 계약서 준비·발송·서명 상태 처리. 저장소·파일·모두사인은 주입받아 모의 환경과 운영이 같은 코드를 쓴다.
//
// 이중 발송 방지 원칙(공식 문서에 멱등키가 없다):
//  - 문서 상태 전이는 전부 트랜잭션 안에서 "현재 상태"를 확인한 뒤에만 한다. 트랜잭션 밖에서 읽은 값으로 덮어쓰지 않는다.
//  - POST 는 pending → creating 선점에 성공한 호출만 한다. 선점마다 attemptId 를 발급한다.
//  - 결과가 불명확하면 재발송하지 않고 발송 키로 조회한다. 끝내 없을 때만 사람 확인 후 재시도한다.
const crypto = require('crypto');
const { AppError } = require('./errors');
const { COMPANIES_DOC_KEY, evaluateCompany, blockingIssues, validEmail, clean } = require('./company');
const { generatePdf, sha256 } = require('./pdf');
const { buildCreateBody, ModusignError } = require('./modusign');
const { addMouSignedAlert, mouSignedAlertId } = require('./alerts');
const { createTemplates, DOC_TYPES, DOC_LABELS } = require('./templates');

const LEASE_MS = 2 * 60 * 1000;
const UNKNOWN_RECHECK_MS = 5 * 60 * 1000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UNRESOLVED = ['unknown', 'unknown_not_found'];

// 경로에 들어가는 값은 클라이언트가 보낸 것일 수 있다. 다른 문서·컬렉션을 가리키지 못하게 막는다.
function safeSegment(value, label) {
  const s = typeof value === 'string' ? value : '';
  if (!s || s.length > 200 || s.includes('/') || /[\u0000-\u001f]/.test(s) || s === '.' || s === '..' || /^__.*__$/.test(s)) {
    throw new AppError(400, 'BAD_ID', `${label} 값이 올바르지 않습니다.`);
  }
  return s;
}
function docType(type) {
  if (!DOC_TYPES.includes(type)) throw new AppError(400, 'BAD_DOC_TYPE', '문서 종류가 올바르지 않습니다.');
  return type;
}
function versionNumber(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new AppError(400, 'BAD_VERSION', 'PDF 버전이 올바르지 않습니다.');
  return n;
}

// 계약 데이터는 전부 최상위 contract* 컬렉션에 둔다. Firestore 규칙(users/{uid} 외 전부 거부)으로 클라이언트가 직접 읽거나 쓸 수 없다.
const prepPath = (companyId) => `contractPreparations/${safeSegment(companyId, '업체 ID')}`;
const versionPath = (companyId, n) => `contractVersions/${safeSegment(companyId, '업체 ID')}_v${n}`;
const sendPath = (sendId) => `contractSends/${safeSegment(sendId, '발송 ID')}`;
const indexPath = (modusignId) => `contractDocIndex/${safeSegment(modusignId, '문서 ID')}`;
const deliveryPath = (id) => `contractWebhookDeliveries/${id}`;

// 우리 측 시험 발송. 카드 업체 데이터를 읽거나 쓰지 않고, 이 고정 ID 아래에만 기록한다.
// 실제 발송 스위치와 별개인 시험 스위치 + 우리 측 수신자 허용 목록을 모두 통과해야 보낼 수 있다.
const TEST_COMPANY_ID = 'test-send';
const TEST_COMPANY_CODE = 'B2B000';
const TEST_TITLE_PREFIX = '[시험] ';


function parseContractDate(text) {
  const m = DATE_RE.exec(String(text || ''));
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new AppError(400, 'BAD_CONTRACT_DATE', '계약일을 YYYY-MM-DD 형식의 올바른 날짜로 입력해주세요.');
  return { year: m[1], month: m[2], day: m[3], monthPlain: String(+m[2]), dayPlain: String(+m[3]) };
}

const isOpenDoc = (d) => {
  if (['pending', 'creating', 'unknown', 'unknown_not_found', 'duplicate_suspect'].includes(d.delivery)) return true;
  return d.delivery === 'created' && !d.allSignedAt && !d.abortedAt;
};
// 상대방에게 나갔거나 나갔을 수 있는 문서. 하나라도 있으면 그 업체의 새 준비·발송을 막는다.
// 양측 완료 문서와 중단된 문서는 끝난 것으로 본다(재계약·재발송 경로).
const isLiveDoc = (d) => ['pending', 'creating', 'unknown', 'unknown_not_found', 'duplicate_suspect'].includes(d.delivery) || (d.delivery === 'created' && !d.abortedAt && !d.allSignedAt);

function assertNoLiveSend(active, sendId) {
  if (active && Object.values(active.documents).some(isLiveDoc)) {
    throw new AppError(409, 'ACTIVE_SEND_EXISTS', '이 업체에 진행 중인 발송이 있습니다. 발송 결과를 먼저 확인해주세요.', { sendId });
  }
}

function createService({ store, blobs, modusign, config, now, fontBytes, serverTime, logger }) {
  const templates = createTemplates({ store, blobs, config });
  const log = logger || console;
  const nowIso = () => new Date(now()).toISOString();
  const stamp = () => (serverTime ? serverTime() : nowIso());

  async function loadCompanies() {
    const data = await store.get(`users/${config.sharedUid}/shin2/${COMPANIES_DOC_KEY}`);
    return (data && Array.isArray(data.value)) ? data.value : [];
  }

  async function checkCompany({ companyId, companyCode }) {
    const evaluation = evaluateCompany(await loadCompanies(), companyId, companyCode);
    const seal = await templates.sealAvailable();
    const today = new Date(now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    return Object.assign(evaluation, { defaultContractDate: today, sealImage: seal, sendBlockers: await sendBlockers() });
  }

  // 실제 발송을 막는 조건. 하나라도 있으면 미리보기까지만 가능하다. version 이 있으면 그 버전이 쓴 양식·도장까지 비교한다.
  async function sendBlockers(version) {
    const out = [];
    if (version && version.test) {
      if (config.testSendEnabled !== true) out.push({ code: 'TEST_SEND_DISABLED', message: '시험 발송이 꺼져 있습니다.' });
      if (!testRecipientAllowed(version.recipientEmail)) out.push({ code: 'TEST_RECIPIENT_NOT_ALLOWED', message: '시험 수신자가 허용 목록에 없습니다.' });
    } else if (config.sendEnabled !== true) {
      out.push({ code: 'SEND_DISABLED', message: '발송 기능이 꺼져 있습니다(운영 승인 전).' });
    }
    if (!config.modusignConfigured) out.push({ code: 'MODUSIGN_NOT_CONFIGURED', message: '모두사인 API 설정이 없습니다.' });
    const signer = config.companySigner || {};
    if (!signer.name || !validEmail(signer.email)) out.push({ code: 'SIGNER_NOT_CONFIGURED', message: '우리 측 서명 담당자가 지정되지 않았습니다.' });
    const reg = await templates.registry();
    for (const type of DOC_TYPES) {
      const entry = reg[type];
      if (!entry) { out.push({ code: 'TEMPLATE_NOT_APPROVED', message: `${DOC_LABELS[type]} 승인 양식이 없습니다.` }); continue; }
      if (entry.status === 'test' && config.modusignIsReal) out.push({ code: 'TEST_ASSET_ON_REAL_API', message: `${DOC_LABELS[type]}가 시험용 양식이라 실제 발송할 수 없습니다.` });
      if (entry.signaturePositionApproved !== true) out.push({ code: 'SIGNATURE_POSITION_NOT_APPROVED', message: `${DOC_LABELS[type]} 서명 위치가 아직 승인되지 않았습니다.` });
      if (version && version.docs[type].templateVersion !== entry.version) out.push({ code: 'TEMPLATE_CHANGED', message: `${DOC_LABELS[type]} 양식이 바뀌었습니다. PDF를 다시 생성해주세요.` });
    }
    const seal = version && version.sealImage;
    if (seal && seal.inserted) {
      if (seal.kind === 'test' && config.modusignIsReal) out.push({ code: 'TEST_ASSET_ON_REAL_API', message: '시험용 도장 이미지가 들어간 PDF는 실제 발송할 수 없습니다.' });
      if (seal.kind !== 'test' && config.realSealApproved !== true) out.push({ code: 'SEAL_NOT_ALLOWED', message: '실제 도장 이미지 사용 승인이 없어 발송할 수 없습니다.' });
    }
    return out;
  }

  // 미리보기 후 업체가 삭제·종료되거나 계약 당사자 정보가 바뀌면 그 PDF는 보내지 않는다.
  async function assertCompanyUnchanged(ver) {
    if (ver.test) return; // 시험 업체는 카드에 없다. 수신자 허용 여부는 sendBlockers 가 다시 본다.
    const evaluation = evaluateCompany(await loadCompanies(), ver.companyId, ver.company.code);
    const blocking = blockingIssues(evaluation, ver.recipientEmail);
    if (blocking.length) throw new AppError(409, 'COMPANY_CHANGED', '업체 정보에 문제가 생겨 발송할 수 없습니다. 정보를 확인한 뒤 다시 생성해주세요.', { issues: blocking });
    const changed = ['name', 'bizNo', 'address', 'representative'].filter((f) => evaluation.company[f] !== ver.company[f]);
    if (changed.length) throw new AppError(409, 'COMPANY_CHANGED', '미리보기 후 업체 정보가 바뀌었습니다. PDF를 다시 생성해주세요.');
  }

  function testRecipientAllowed(email) {
    const list = (config.testRecipients || []).map((e) => clean(e).toLowerCase());
    return validEmail(email) && list.includes(clean(email).toLowerCase());
  }

  async function prepare({ companyId, companyCode, contractDate, recipientEmail, includeSeal, actorLabel }) {
    if (companyId === TEST_COMPANY_ID) throw new AppError(400, 'BAD_ID', '업체 ID 값이 올바르지 않습니다.');
    const date = parseContractDate(contractDate);
    const email = clean(recipientEmail);
    if (!validEmail(email)) throw new AppError(400, 'BAD_EMAIL', '수신자 이메일을 올바르게 입력해주세요.');
    const evaluation = evaluateCompany(await loadCompanies(), companyId, companyCode);
    return createVersion(evaluation, { date, email, contractDate, includeSeal, actorLabel, test: false });
  }

  // 시험 업체 값은 요청으로 받되 카드 업체와 같은 검사(사업자번호 검증·대표자·주소)를 거친다. 도장은 넣지 않는다.
  async function prepareTest({ contractDate, recipientEmail, company, actorLabel }) {
    const date = parseContractDate(contractDate);
    const email = clean(recipientEmail);
    if (!testRecipientAllowed(email)) throw new AppError(403, 'TEST_RECIPIENT_NOT_ALLOWED', '시험 수신자는 서버에 등록된 우리 측 이메일만 쓸 수 있습니다.');
    const c = company || {};
    const synthetic = { id: TEST_COMPANY_ID, code: TEST_COMPANY_CODE, name: c.name, bizRegNo: c.bizNo, repName: c.representative, address: c.address, email };
    const evaluation = evaluateCompany([synthetic], TEST_COMPANY_ID, TEST_COMPANY_CODE);
    return createVersion(evaluation, { date, email, contractDate, includeSeal: false, actorLabel, test: true });
  }

  async function createVersion(evaluation, { date, email, contractDate, includeSeal, actorLabel, test }) {
    const blocking = blockingIssues(evaluation, email);
    if (blocking.length) throw new AppError(422, 'COMPANY_INFO_INCOMPLETE', '업체 정보를 먼저 보완해주세요.', { issues: blocking });
    const co = evaluation.company;

    const tpl = await templates.loadAll();
    const seal = includeSeal === true ? await templates.loadSeal() : null;
    const values = Object.assign({ name: co.name, bizNo: co.bizNo, address: co.address, representative: co.representative }, date);

    const n = await store.transaction(async (tx) => {
      const prep = (await tx.get(prepPath(co.id))) || {};
      if (prep.activeSendId) assertNoLiveSend(await tx.get(sendPath(prep.activeSendId)), prep.activeSendId);
      const next = (prep.lastVersion || 0) + 1;
      tx.set(prepPath(co.id), { lastVersion: next }, { merge: true });
      return next;
    });

    const docs = {};
    for (const type of DOC_TYPES) {
      const title = `${test ? TEST_TITLE_PREFIX : ''}POUR공법 ${DOC_LABELS[type]} - ${co.name}`;
      const pdf = await generatePdf({ templateBytes: tpl[type].bytes, map: tpl[type].map, values, fontBytes, seal, title });
      const blobPath = `contracts/${co.id}/v${n}/${type}.pdf`;
      await blobs.put(blobPath, pdf.bytes);
      docs[type] = {
        type, title, blobPath, sha256: pdf.sha256, pageCount: pdf.pageCount, size: pdf.bytes.length,
        templateVersion: tpl[type].version, templateStatus: tpl[type].status, map: tpl[type].map,
      };
    }
    const version = {
      companyId: co.id, version: n, createdAt: nowIso(), createdBy: clean(actorLabel).slice(0, 40),
      company: co, contractDate, recipientEmail: email, docs,
      sealImage: seal ? { inserted: true, kind: seal.kind, sha256: seal.sha256 } : { inserted: false },
      test,
    };
    await store.transaction(async (tx) => {
      const prep = (await tx.get(prepPath(co.id))) || {};
      tx.set(versionPath(co.id, n), version);
      if ((prep.currentVersion || 0) < n) tx.set(prepPath(co.id), { currentVersion: n }, { merge: true });
    });
    return versionView(version);
  }

  function versionView(v) {
    const docs = {};
    for (const type of DOC_TYPES) {
      const d = v.docs[type];
      const pos = d.map.signature || {};
      docs[type] = {
        type, label: DOC_LABELS[type], title: d.title, sha256: d.sha256, pageCount: d.pageCount, size: d.size,
        templateVersion: d.templateVersion, templateStatus: d.templateStatus,
        signaturePositions: { counterparty: pos.counterparty || null, company: pos.company || null, pageSize: d.map.pageSize || null },
      };
    }
    return { companyId: v.companyId, version: v.version, createdAt: v.createdAt, createdBy: v.createdBy, company: v.company, contractDate: v.contractDate, recipientEmail: v.recipientEmail, sealImage: v.sealImage, test: v.test === true, docs };
  }

  async function getPdf({ companyId, version, type }) {
    const v = await store.get(versionPath(companyId, versionNumber(version)));
    const d = v && v.docs[docType(type)];
    if (!d) throw new AppError(404, 'PDF_NOT_FOUND', 'PDF를 찾을 수 없습니다. 다시 생성해주세요.');
    const bytes = await blobs.get(d.blobPath);
    const actual = sha256(bytes);
    if (actual !== d.sha256) throw new AppError(409, 'PDF_INTEGRITY', '저장된 PDF가 생성 기록과 다릅니다. 다시 생성해주세요.');
    return { bytes, sha256: actual, title: d.title };
  }

  // 실제 도장이 들어간 PDF는 공용 로그인만으로 만들거나 받을 수 없다.
  async function sealNeedsPersonal() {
    const seal = await templates.sealAvailable();
    return seal.kind !== 'test';
  }
  async function pdfNeedsPersonal({ companyId, version }) {
    const v = await store.get(versionPath(companyId, versionNumber(version)));
    return !!(v && v.sealImage && v.sealImage.inserted && v.sealImage.kind !== 'test');
  }

  // ---- 발송 ----------------------------------------------------------------
  const newDoc = (type, sendId, ver) => ({
    type, delivery: 'pending', sendKey: sha256(`${sendId}:${type}`).slice(0, 40), sha256: ver.docs[type].sha256,
    attempts: [], attemptId: null, modusignDocumentId: null, failure: null, leaseUntil: null, recheckAfter: null,
    modusignStatus: null, counterpartySignedAt: null, companySignedAt: null, allSignedAt: null, abortedAt: null, abortType: null,
  });

  // test 는 시험 경로(/test/send)만 true 로 부른다. 일반 발송 경로로 시험 버전을, 시험 경로로 실제 업체를 보낼 수 없다.
  async function send({ companyId, version, hashes, recipientEmail, representative, confirmed }, sender, { test = false } = {}) {
    if (confirmed !== true) throw new AppError(400, 'NOT_CONFIRMED', '발송 확인이 필요합니다.');
    if ((companyId === TEST_COMPANY_ID) !== test) throw new AppError(400, 'BAD_ID', '업체 ID 값이 올바르지 않습니다.');
    const prep = await store.get(prepPath(companyId));
    if (!prep || prep.currentVersion !== Number(version)) throw new AppError(409, 'STALE_VERSION', '확인한 PDF가 최신 버전이 아닙니다. 최신 PDF를 다시 확인해주세요.');
    const ver = await store.get(versionPath(companyId, Number(version)));
    if (!ver) throw new AppError(404, 'PDF_NOT_FOUND', 'PDF를 찾을 수 없습니다.');
    if ((ver.test === true) !== test) throw new AppError(400, 'BAD_ID', '업체 ID 값이 올바르지 않습니다.');
    for (const type of DOC_TYPES) {
      if (!hashes || hashes[type] !== ver.docs[type].sha256) throw new AppError(409, 'HASH_MISMATCH', '확인한 PDF와 발송 대상 PDF가 다릅니다. 미리보기를 다시 확인해주세요.');
    }
    if (clean(recipientEmail) !== ver.recipientEmail || clean(representative) !== ver.company.representative) {
      throw new AppError(409, 'CONFIRM_MISMATCH', '확인한 대표자·수신자 정보가 PDF 생성 때와 다릅니다.');
    }
    const blockers = await sendBlockers(ver);
    if (blockers.length) throw new AppError(409, 'SEND_BLOCKED', blockers.map((b) => b.message).join(' '), { blockers });
    await assertCompanyUnchanged(ver);

    const sendId = sha256([companyId, ver.version, hashes.supply, hashes.mou].join('|')).slice(0, 40);
    await store.transaction(async (tx) => {
      const existing = await tx.get(sendPath(sendId));
      if (existing) return;
      const p = (await tx.get(prepPath(companyId))) || {};
      if (p.currentVersion !== ver.version) throw new AppError(409, 'STALE_VERSION', '확인한 PDF가 최신 버전이 아닙니다. 최신 PDF를 다시 확인해주세요.');
      if (p.activeSendId) assertNoLiveSend(await tx.get(sendPath(p.activeSendId)), p.activeSendId);
      const documents = {};
      for (const type of DOC_TYPES) documents[type] = newDoc(type, sendId, ver);
      tx.set(sendPath(sendId), {
        sendId, companyId, companyCode: ver.company.code, companyName: ver.company.name, contractDate: ver.contractDate,
        version: ver.version, recipientEmail: ver.recipientEmail, representative: ver.company.representative,
        sealImage: ver.sealImage, processedBy: { email: sender.email, name: sender.name },
        createdAt: nowIso(), open: true, documents, test: ver.test === true,
      });
      tx.set(prepPath(companyId), { activeSendId: sendId }, { merge: true });
    });
    // 한 문서의 예기치 못한 오류가 다른 문서를 막지 않는다. 그 문서는 상태 조회로 복구한다.
    for (const type of DOC_TYPES) {
      try { await processDoc(sendId, type, ver, sender); }
      catch (err) { log.error('processDoc failed', type, err && err.name); }
    }
    return sendView(await store.get(sendPath(sendId)));
  }

  // fn 은 트랜잭션 안에서 현재 값을 받아 바꾼 문서를 돌려주거나, 전이 조건이 맞지 않으면 null 을 돌려준다.
  async function updateDoc(sendId, type, fn, opts) {
    return store.transaction(async (tx) => {
      const s = await tx.get(sendPath(sendId));
      if (!s) throw new AppError(404, 'SEND_NOT_FOUND', '발송 기록을 찾을 수 없습니다.');
      const prep = opts && opts.withPrep ? ((await tx.get(prepPath(s.companyId))) || {}) : null;
      const d = fn(Object.assign({}, s.documents[type]), s, prep);
      if (!d) return { send: s, changed: false };
      const documents = Object.assign({}, s.documents, { [type]: d });
      const open = Object.values(documents).some(isOpenDoc);
      tx.set(sendPath(sendId), { documents, open, updatedAt: nowIso() }, { merge: true });
      return { send: Object.assign({}, s, { documents, open }), changed: true };
    });
  }

  function lastAttempt(d, result) {
    const attempts = (d.attempts || []).slice();
    if (attempts.length) attempts[attempts.length - 1] = Object.assign({}, attempts[attempts.length - 1], { result, endedAt: nowIso() });
    d.attempts = attempts;
    return d;
  }

  // 대기 상태인 문서 하나만 발송한다. 선점에 성공한 호출만 POST 한다.
  async function processDoc(sendId, type, ver, sender) {
    const attemptId = crypto.randomUUID();
    const claim = await updateDoc(sendId, type, (d) => {
      if (d.delivery !== 'pending') return null;
      d.delivery = 'creating';
      d.attemptId = attemptId;
      d.leaseUntil = now() + LEASE_MS;
      d.failure = null;
      d.attempts = (d.attempts || []).concat([{ at: nowIso(), by: sender.email || sender.uid, result: 'started' }]);
      return d;
    });
    if (!claim.changed) return;
    const doc = claim.send.documents[type];
    const verDoc = ver.docs[type];

    let bytes;
    try { bytes = await blobs.get(verDoc.blobPath); }
    catch (_) { return finishFailed(sendId, type, attemptId, 'PDF_READ', '저장된 PDF를 읽지 못해 보내지 않았습니다.'); }
    if (sha256(bytes) !== doc.sha256) return finishFailed(sendId, type, attemptId, 'PDF_INTEGRITY', '저장된 PDF가 확인한 버전과 달라 보내지 않았습니다.');

    let body;
    try {
      body = buildCreateBody({
        title: verDoc.title, pdfBytes: bytes,
        counterparty: { name: ver.company.representative, email: ver.recipientEmail },
        companySigner: config.companySigner, map: verDoc.map,
        metadata: {
          card_send_key: doc.sendKey, card_send_id: sendId, card_company_id: ver.companyId,
          card_doc_type: type, card_pdf_version: ver.version, card_pdf_sha256: doc.sha256,
          ...(ver.test ? { card_test: 'true' } : {}),
        },
      });
    } catch (err) {
      return finishFailed(sendId, type, attemptId, `REQUEST_${(err && err.code) || 'INVALID'}`, '발송 요청을 만들지 못해 보내지 않았습니다.');
    }

    let result;
    try {
      result = await modusign.createDocument(body);
      if (!result || !result.id) throw new ModusignError('unknown', 0, 'NO_DOCUMENT_ID');
    } catch (err) {
      if (err instanceof ModusignError && err.kind === 'definite') {
        return finishFailed(sendId, type, attemptId, `MODUSIGN_${err.status || err.code}`, '모두사인이 요청을 거절했습니다.');
      }
      // 여기까지 왔으면 요청이 나갔을 수 있다. 어떤 오류든 불명으로 다룬다.
      await updateDoc(sendId, type, (d) => {
        if (d.delivery !== 'creating' || d.attemptId !== attemptId) return null;
        d.delivery = 'unknown';
        d.leaseUntil = null;
        d.recheckAfter = now() + UNKNOWN_RECHECK_MS;
        d.failure = { code: `MODUSIGN_${(err && err.code) || (err && err.status) || 'UNKNOWN'}`, message: '발송 결과가 불명확합니다. 상태 조회 후 판단합니다.' };
        return lastAttempt(d, 'unknown');
      });
      await resolveUnknown(sendId, type);
      return undefined;
    }
    return attachCreated(sendId, type, result, attemptId);
  }

  async function finishFailed(sendId, type, attemptId, code, message) {
    await updateDoc(sendId, type, (d) => {
      if (d.delivery !== 'creating' || d.attemptId !== attemptId) return null;
      d.delivery = 'failed';
      d.leaseUntil = null;
      d.failure = { code, message };
      return lastAttempt(d, 'failed');
    });
  }

  function linkDocument(d, remote, recovered) {
    d.delivery = 'created';
    d.modusignDocumentId = remote.id;
    d.createdInModusignAt = remote.createdAt || nowIso();
    d.recovered = recovered === true;
    d.leaseUntil = null;
    d.recheckAfter = null;
    d.failure = null;
    lastAttempt(d, recovered ? 'recovered' : 'created');
    return Object.assign(d, remoteFields(d, remote));
  }

  function markDuplicate(d, ids) {
    d.delivery = 'duplicate_suspect';
    d.duplicateCandidates = Array.from(new Set([...(d.duplicateCandidates || []), ...ids]));
    d.leaseUntil = null;
    d.failure = { code: 'DUPLICATE_SUSPECT', message: '같은 문서가 모두사인에 여러 건 있습니다. 모두사인에서 남길 문서를 확인하고 나머지를 취소한 뒤 확정해주세요.' };
    return d;
  }

  // POST 성공 응답 연결. 그 사이 상태가 바뀌었으면(다른 호출이 이미 문서를 연결했거나 새 시도가 시작됨) 덮어쓰지 않고 중복으로 표시한다.
  async function attachCreated(sendId, type, remote, attemptId) {
    await store.transaction(async (tx) => {
      const s = await tx.get(sendPath(sendId));
      let d = Object.assign({}, s.documents[type]);
      const sameAttempt = d.attemptId === attemptId;
      if (d.modusignDocumentId === remote.id) return;
      if (!d.modusignDocumentId && sameAttempt && ['creating', ...UNRESOLVED].includes(d.delivery)) d = linkDocument(d, remote, false);
      else d = markDuplicate(d, [d.modusignDocumentId, remote.id].filter(Boolean));
      const documents = Object.assign({}, s.documents, { [type]: d });
      tx.set(indexPath(remote.id), { sendId, type });
      tx.set(sendPath(sendId), { documents, open: Object.values(documents).some(isOpenDoc), updatedAt: nowIso() }, { merge: true });
    });
  }

  // 결과 불명: 발송 키로 찾아 본다. 절대 여기서 다시 보내지 않는다. 결과 반영은 지금도 불명 상태일 때만 한다.
  async function resolveUnknown(sendId, type) {
    const s = await store.get(sendPath(sendId));
    const d = s.documents[type];
    if (!UNRESOLVED.includes(d.delivery)) return 'not_unknown';
    let found;
    try {
      found = (await modusign.findBySendKey(d.sendKey)).filter((f) => (f.metadatas || []).some((m) => m.key === 'card_send_key' && m.value === d.sendKey));
    } catch (err) {
      if (err instanceof ModusignError) return 'still_unknown';
      throw err;
    }
    if (found.length === 0 && now() < Number(d.recheckAfter || 0)) return 'still_unknown';

    return store.transaction(async (tx) => {
      const cur = await tx.get(sendPath(sendId));
      let x = Object.assign({}, cur.documents[type]);
      if (!UNRESOLVED.includes(x.delivery)) return 'not_unknown';
      let outcome;
      if (found.length === 1) {
        x = linkDocument(x, found[0], true);
        tx.set(indexPath(found[0].id), { sendId, type });
        outcome = 'recovered';
      } else if (found.length > 1) {
        x = markDuplicate(x, found.map((f) => f.id));
        found.forEach((f) => tx.set(indexPath(f.id), { sendId, type }));
        outcome = 'duplicate';
      } else {
        x.delivery = 'unknown_not_found';
        x.failure = { code: 'NOT_FOUND_AFTER_WAIT', message: '조회해도 문서가 없습니다. 모두사인 화면에서 확인한 뒤에만 재시도할 수 있습니다.' };
        outcome = 'not_found';
      }
      const documents = Object.assign({}, cur.documents, { [type]: x });
      tx.set(sendPath(sendId), { documents, open: Object.values(documents).some(isOpenDoc), updatedAt: nowIso() }, { merge: true });
      return outcome;
    });
  }

  // 처리 중에 서버가 멈춘 문서: 보냈는지 알 수 없으므로 불명으로 넘기고, 검색 반영 시간을 둔다.
  async function expireLease(sendId, type) {
    await updateDoc(sendId, type, (x) => {
      if (x.delivery !== 'creating' || now() < Number(x.leaseUntil || 0)) return null;
      x.delivery = 'unknown';
      x.recheckAfter = Math.max(Number(x.leaseUntil || 0), now()) + UNKNOWN_RECHECK_MS;
      x.leaseUntil = null;
      x.failure = { code: 'INTERRUPTED', message: '발송 처리가 중단됐습니다. 상태 조회 후 판단합니다.' };
      return lastAttempt(x, 'unknown');
    });
  }

  // 사용자의 명시적 재시도. 성공한 문서는 절대 다시 보내지 않는다.
  async function retryDoc({ sendId, type, manualChecked }, sender) {
    if (!DOC_TYPES.includes(type)) throw new AppError(400, 'BAD_DOC_TYPE', '문서 종류가 올바르지 않습니다.');
    const s = await store.get(sendPath(sendId));
    if (!s) throw new AppError(404, 'SEND_NOT_FOUND', '발송 기록을 찾을 수 없습니다.');
    const ver = await store.get(versionPath(s.companyId, s.version));
    let d = s.documents[type];
    if (d.delivery === 'created') return sendView(s);
    if (d.delivery === 'duplicate_suspect') throw new AppError(409, 'DUPLICATE_SUSPECT', d.failure.message);

    const blockers = await sendBlockers(ver);
    if (blockers.length) throw new AppError(409, 'SEND_BLOCKED', blockers.map((b) => b.message).join(' '), { blockers });
    await assertCompanyUnchanged(ver);

    if (d.delivery === 'creating') {
      if (now() < Number(d.leaseUntil || 0)) throw new AppError(409, 'BUSY', '이 문서를 발송 처리 중입니다. 잠시 후 확인해주세요.');
      await expireLease(sendId, type);
      d = (await store.get(sendPath(sendId))).documents[type];
    }
    const wasUnresolved = UNRESOLVED.includes(d.delivery);
    if (wasUnresolved) {
      const outcome = await resolveUnknown(sendId, type);
      if (outcome === 'recovered') return sendView(await store.get(sendPath(sendId)));
      if (outcome === 'duplicate') throw new AppError(409, 'DUPLICATE_SUSPECT', '같은 문서가 모두사인에 여러 건 있습니다. 모두사인에서 직접 확인해주세요.');
      if (outcome === 'still_unknown') throw new AppError(409, 'RESULT_UNKNOWN', '발송 결과를 아직 확인할 수 없습니다. 잠시 후 상태를 다시 조회해주세요.');
      if (outcome === 'not_unknown') throw new AppError(409, 'BUSY', '이 문서 상태가 방금 바뀌었습니다. 결과를 다시 확인해주세요.');
      if (manualChecked !== true) throw new AppError(409, 'MANUAL_CHECK_REQUIRED', '모두사인 화면에 이 문서가 없는지 확인한 뒤 확인 표시와 함께 재시도해주세요.');
    } else if (!['failed', 'pending'].includes(d.delivery)) {
      throw new AppError(409, 'NOT_RETRYABLE', '이 문서는 재시도할 수 없는 상태입니다.');
    }

    // 재생성으로 다른 버전이 최신이 됐거나 이 발송이 활성 발송이 아니면 옛 PDF·옛 수신자로 보내지 않는다.
    const moved = await updateDoc(sendId, type, (x, cur, prep) => {
      if (prep.activeSendId !== sendId || prep.currentVersion !== cur.version) {
        throw new AppError(409, 'STALE_VERSION', '이 발송은 최신 PDF가 아닙니다. 최신 버전으로 다시 준비해주세요.');
      }
      if (x.delivery === 'pending') return x; // 기록만 되고 선점 전에 멈춘 문서
      if (x.delivery !== 'failed' && !(x.delivery === 'unknown_not_found' && manualChecked === true)) return null;
      x.delivery = 'pending';
      if (manualChecked === true) x.manualCheckedBy = sender.email || sender.uid;
      return x;
    }, { withPrep: true });
    if (!moved.changed) throw new AppError(409, 'BUSY', '이 문서를 다른 요청이 처리 중입니다. 결과를 다시 확인해주세요.');
    await processDoc(sendId, type, ver, sender);
    return sendView(await store.get(sendPath(sendId)));
  }

  // 중복 의심 해소: 담당자가 모두사인에서 나머지를 취소한 뒤, 남길 문서를 확정한다.
  async function resolveDuplicate({ sendId, type, keepDocumentId }, sender) {
    if (!DOC_TYPES.includes(type)) throw new AppError(400, 'BAD_DOC_TYPE', '문서 종류가 올바르지 않습니다.');
    const s = await store.get(sendPath(sendId));
    const d = s && s.documents[type];
    if (!d || d.delivery !== 'duplicate_suspect' || !(d.duplicateCandidates || []).includes(keepDocumentId)) {
      throw new AppError(409, 'NOT_DUPLICATE', '확정할 수 있는 중복 문서가 아닙니다.');
    }
    const remote = await modusign.getDocument(keepDocumentId);
    await updateDoc(sendId, type, (x) => {
      if (x.delivery !== 'duplicate_suspect') return null;
      const out = linkDocument(x, remote, x.recovered === true);
      out.duplicateResolvedBy = sender.email || sender.uid;
      out.duplicateResolvedAt = nowIso();
      return out;
    });
    await applyRemote(sendId, type, remote);
    return sendView(await store.get(sendPath(sendId)));
  }

  // ---- 서명 상태 ------------------------------------------------------------
  function remoteFields(d, remote) {
    const participants = remote.participants || [];
    const counterparty = participants.find((p) => Number(p.signingOrder) === 1);
    const company = participants.find((p) => Number(p.signingOrder) === 2);
    const signedAt = (p) => {
      const hit = p && (remote.signings || []).find((x) => x.participantId === p.id);
      return (hit && hit.signedAt) || null;
    };
    const out = {
      modusignStatus: remote.status || d.modusignStatus,
      counterpartySignedAt: signedAt(counterparty) || d.counterpartySignedAt || null,
      companySignedAt: signedAt(company) || d.companySignedAt || null,
    };
    if (remote.status === 'COMPLETED') out.allSignedAt = d.allSignedAt || out.companySignedAt || remote.updatedAt || nowIso();
    if (remote.abort) { out.abortedAt = remote.abort.abortedAt || nowIso(); out.abortType = remote.abort.type || null; }
    return out;
  }

  // 모두사인에서 다시 읽은 상태만 반영한다. MOU 상대방 서명이 실제 확인되면 노란 알림을 한 번 만든다.
  // 현재 연결된 문서가 아니면(중복본 등) 상태를 오염시키지 않고 처리 표시만 남긴다.
  async function applyRemote(sendId, type, remote, deliveryId) {
    return store.transaction(async (tx) => {
      const s = await tx.get(sendPath(sendId));
      if (!s) throw new AppError(404, 'SEND_NOT_FOUND', '발송 기록을 찾을 수 없습니다.');
      const d = Object.assign({}, s.documents[type]);
      if (d.modusignDocumentId !== remote.id) {
        if (deliveryId) tx.set(deliveryPath(deliveryId), { at: nowIso(), documentId: remote.id, sendId, type, ignored: 'not-current-document' });
        return { alertCreated: false, ignored: true };
      }
      Object.assign(d, remoteFields(d, remote));
      let alertCreated = false;
      // 시험 발송은 카드 알림(카드 데이터)에 쓰지 않는다.
      if (type === 'mou' && d.counterpartySignedAt && !s.test) {
        alertCreated = await addMouSignedAlert(tx, {
          sharedUid: config.sharedUid, nowMs: now(), serverTime: stamp(),
          item: {
            id: mouSignedAlertId(remote.id), type: 'mouSigned', companyId: s.companyId, companyName: s.companyName,
            occurredAt: d.counterpartySignedAt, counterpartySignedAt: d.counterpartySignedAt,
            sendId, docType: 'mou', completedAt: null,
          },
        });
      }
      const documents = Object.assign({}, s.documents, { [type]: d });
      tx.set(sendPath(sendId), { documents, open: Object.values(documents).some(isOpenDoc), updatedAt: nowIso() }, { merge: true });
      if (deliveryId) tx.set(deliveryPath(deliveryId), { at: nowIso(), documentId: remote.id, sendId, type });
      return { alertCreated };
    });
  }

  // 시험 경로에서 받은 발송 ID 가 시험 발송인지 확인한다. 시험 경로로 실제 업체 발송을 다루지 못하게 한다.
  async function assertTestSend(sendId) {
    const s = await store.get(sendPath(sendId));
    if (!s || s.test !== true) throw new AppError(404, 'SEND_NOT_FOUND', '시험 발송 기록을 찾을 수 없습니다.');
  }

  // 서명 요청 취소. 모두사인에 취소를 요청한 뒤, 다시 조회한 상태만 반영한다(applyRemote).
  // 이미 끝난 문서는 모두사인을 부르지 않는다. 취소 응답이 불명확해도 조회 결과로 판단한다.
  async function cancelDoc({ sendId, type, reason }, sender) {
    docType(type);
    const message = clean(reason);
    if (message.length < 2 || message.length > 200) throw new AppError(400, 'BAD_REASON', '취소 사유를 2~200자로 입력해주세요.');
    const s = await store.get(sendPath(sendId));
    if (!s) throw new AppError(404, 'SEND_NOT_FOUND', '발송 기록을 찾을 수 없습니다.');
    const d = s.documents[type];
    if (d.delivery !== 'created' || !d.modusignDocumentId) throw new AppError(409, 'NOT_CANCELLABLE', '모두사인에 만들어진 문서만 취소할 수 있습니다.');
    if (d.abortedAt) return sendView(s);
    if (d.allSignedAt) throw new AppError(409, 'ALREADY_COMPLETED', '양측 서명이 끝난 문서는 취소할 수 없습니다.');

    let failure = null;
    try { await modusign.cancelDocument(d.modusignDocumentId, message); }
    catch (err) { if (!(err instanceof ModusignError)) throw err; failure = err; }
    const remote = await modusign.getDocument(d.modusignDocumentId);
    await applyRemote(sendId, type, remote);
    const canceled = remote.status === 'ABORTED';
    await updateDoc(sendId, type, (x) => {
      x.cancellations = (x.cancellations || []).concat([{ at: nowIso(), by: sender.email || sender.uid, reason: message, result: canceled ? 'canceled' : 'not_canceled' }]);
      return x;
    });
    if (!canceled) {
      if (remote.status === 'COMPLETED') throw new AppError(409, 'ALREADY_COMPLETED', '양측 서명이 끝난 문서는 취소할 수 없습니다.');
      throw new AppError(409, 'CANCEL_FAILED', '모두사인에서 취소되지 않았습니다. 문서 상태를 확인해주세요.', { modusignStatus: remote.status || null, status: failure ? failure.status : null });
    }
    return sendView(await store.get(sendPath(sendId)));
  }

  async function refresh({ sendId }) {
    if (!(await store.get(sendPath(sendId)))) throw new AppError(404, 'SEND_NOT_FOUND', '발송 기록을 찾을 수 없습니다.');
    for (const type of DOC_TYPES) {
      await expireLease(sendId, type);
      const d = (await store.get(sendPath(sendId))).documents[type];
      if (d.delivery === 'created') {
        try { await applyRemote(sendId, type, await modusign.getDocument(d.modusignDocumentId)); }
        catch (err) { if (!(err instanceof ModusignError)) throw err; }
      } else if (UNRESOLVED.includes(d.delivery)) {
        await resolveUnknown(sendId, type);
      }
    }
    return sendView(await store.get(sendPath(sendId)));
  }

  // 웹훅 본문에는 서명이 없다(공식 문서). 비밀 헤더를 확인하고, 내용은 믿지 않고 모두사인에 다시 조회한다.
  async function handleWebhook(headers, rawBody) {
    if (!config.webhookToken || !safeEqual(headers['x-card-webhook-token'], config.webhookToken)) {
      throw new AppError(401, 'WEBHOOK_UNAUTHORIZED', 'unauthorized');
    }
    const deliveryId = String(headers['modusign-delivery-id'] || '');
    if (!deliveryId) throw new AppError(400, 'WEBHOOK_BAD_REQUEST', 'delivery id required');
    let payload;
    try { payload = JSON.parse(String(rawBody || '')); } catch (_) { throw new AppError(400, 'WEBHOOK_BAD_REQUEST', 'bad json'); }
    const documentId = payload && payload.document && payload.document.id;
    if (!documentId) throw new AppError(400, 'WEBHOOK_BAD_REQUEST', 'document id required');
    if (await store.get(deliveryPath(safeId(deliveryId)))) return { duplicate: true };
    const index = await store.get(indexPath(documentId));
    if (!index) return { ignored: true };
    const remote = await modusign.getDocument(documentId); // 실패하면 500 → 모두사인이 재전송
    const result = await applyRemote(index.sendId, index.type, remote, safeId(deliveryId));
    return { applied: !result.ignored, alertCreated: result.alertCreated };
  }

  // 웹훅 누락 대비 정기 보정(공식 문서 권장). 한 건의 오류가 나머지를 막지 않는다.
  async function reconcile() {
    const open = await store.query('contractSends', 'open', true);
    let checked = 0;
    for (const s of open) {
      try { await refresh({ sendId: s.sendId }); checked++; }
      catch (err) { log.error('reconcile failed', err && err.name); }
    }
    return { checked };
  }

  async function listSends({ companyId }) {
    const rows = await store.query('contractSends', 'companyId', safeSegment(companyId, '업체 ID'));
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(sendView);
  }

  // 발송 이력 탭: 전체 업체의 최근 발송. 시험 발송은 기본으로 뺀다.
  async function listAllSends({ limit, includeTests } = {}) {
    const n = Math.min(Math.max(Number(limit) || 200, 1), 300);
    const rows = await store.recent('contractSends', 'createdAt', n);
    return rows.filter((s) => includeTests === true || includeTests === '1' || s.test !== true).map(sendView);
  }

  function sendView(s) {
    const documents = {};
    for (const type of DOC_TYPES) {
      const d = s.documents[type];
      documents[type] = {
        type, label: DOC_LABELS[type], delivery: d.delivery, sha256: d.sha256, modusignDocumentId: d.modusignDocumentId,
        failure: d.failure, attempts: d.attempts, recovered: d.recovered === true, modusignStatus: d.modusignStatus,
        counterpartySignedAt: d.counterpartySignedAt, companySignedAt: d.companySignedAt, allSignedAt: d.allSignedAt,
        abortedAt: d.abortedAt, abortType: d.abortType, duplicateCandidates: d.duplicateCandidates || [],
        cancellations: d.cancellations || [],
      };
    }
    return {
      sendId: s.sendId, companyId: s.companyId, companyCode: s.companyCode, companyName: s.companyName, contractDate: s.contractDate,
      version: s.version, recipientEmail: s.recipientEmail, representative: s.representative, sealImage: s.sealImage,
      processedBy: s.processedBy, createdAt: s.createdAt, open: s.open, test: s.test === true, documents,
    };
  }

  // 완료 문서 파일은 링크를 넘기지 않고 권한 확인 뒤 서버가 받아 전달한다(모두사인 링크 유효 10분).
  async function signedDocument({ sendId, type }, viewer) {
    const s = await store.get(sendPath(sendId));
    const d = s && s.documents[docType(type)];
    if (!d || !d.modusignDocumentId) throw new AppError(404, 'DOCUMENT_NOT_FOUND', '모두사인 문서를 찾을 수 없습니다.');
    const remote = await modusign.getDocument(d.modusignDocumentId);
    const url = remote.file && remote.file.downloadUrl;
    if (!url) throw new AppError(404, 'DOCUMENT_NOT_READY', '문서 파일을 아직 받을 수 없습니다.');
    const bytes = await modusign.download(url);
    await store.transaction(async (tx) => {
      tx.set(`contractAccessLogs/${crypto.randomUUID()}`, { sendId, type, at: nowIso(), viewer: viewer.email || viewer.uid });
    });
    return { bytes, title: remote.title || DOC_LABELS[type] };
  }

  return { checkCompany, prepare, prepareTest, assertTestSend, cancelDoc, listAllSends, getPdf, send, retryDoc, resolveDuplicate, refresh, handleWebhook, reconcile, listSends, signedDocument, sendBlockers, sealNeedsPersonal, pdfNeedsPersonal };
}

const safeId = (id) => sha256(String(id)).slice(0, 40);

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { createService, TEST_COMPANY_ID };
