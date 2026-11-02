'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { makeEnv, prepareInput, sendInput, company, SHARED_UID, webhookHeaders } = require('./helpers.cjs');

const ALERT_DOC = `users/${SHARED_UID}/shin2/shin2-website-cleanup-v1`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const COMPANIES_DOC = `users/${SHARED_UID}/shin2/shin2-companies-staging`;

async function ready(opts) {
  const env = await makeEnv(opts);
  const v = await env.service.prepare(prepareInput());
  return Object.assign(env, { v });
}
const postsFor = (env, type) => env.mock.posts.filter((p) => p.type === type);

test('준비·미리보기·다운로드만으로는 모두사인 호출이 없다', async () => {
  const env = await ready();
  await env.service.getPdf({ companyId: 'co-1', version: env.v.version, type: 'mou' });
  await env.service.getPdf({ companyId: 'co-1', version: env.v.version, type: 'supply' });
  await env.service.prepare(prepareInput({ contractDate: '2026-11-03' }));
  assert.equal(env.mock.posts.length, 0);
});

test('업체 레코드·고객 데이터는 어떤 단계에서도 바뀌지 않는다', async () => {
  const env = await ready();
  const before = JSON.stringify(await env.store.get(COMPANIES_DOC));
  await env.service.send(sendInput(env.v), env.sender);
  const doc = [...env.mock.documents.values()].find((d) => d.title.includes('MOU'));
  await env.service.handleWebhook(webhookHeaders('d1'), JSON.stringify(env.mock.sign(doc.id, 1)));
  assert.equal(JSON.stringify(await env.store.get(COMPANIES_DOC)), before);
});

test('성공: 문서별 발송, 확인한 PDF와 보낸 PDF 지문 일치, 이력 보존', async () => {
  const env = await ready();
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(env.mock.posts.length, 2);
  for (const type of ['supply', 'mou']) {
    const post = postsFor(env, type)[0];
    assert.equal(post.sha256, env.v.docs[type].sha256);
    assert.equal(sha((await env.service.getPdf({ companyId: 'co-1', version: env.v.version, type })).bytes), post.sha256);
    assert.equal(post.participants[0].signingMethod.value, 'ceo@test-co.example');
    assert.equal(post.participants[0].signingOrder, 1);
    assert.equal(post.participants[1].signingOrder, 2);
    assert.equal(r.documents[type].delivery, 'created');
    assert.ok(r.documents[type].modusignDocumentId);
    assert.equal(r.documents[type].attempts[0].by, 'sender@netform.example');
    assert.equal(r.documents[type].attempts[0].result, 'created');
  }
  assert.equal(r.version, env.v.version);
  assert.equal(r.contractDate, '2026-11-02');
  assert.equal(r.processedBy.email, 'sender@netform.example');
  assert.equal(r.companyCode, 'B2B901');
});

test('중복 클릭·동시 요청에도 문서당 한 번만 발송', async () => {
  const env = await ready();
  await Promise.all([1, 2, 3, 4].map(() => env.service.send(sendInput(env.v), env.sender)));
  await env.service.send(sendInput(env.v), env.sender);
  assert.equal(postsFor(env, 'supply').length, 1);
  assert.equal(postsFor(env, 'mou').length, 1);
});

test('재생성 후 이전 버전 발송 거부, 지문·수신자·대표자 불일치 거부', async () => {
  const env = await ready();
  await assert.rejects(env.service.send(sendInput(env.v, { hashes: { supply: 'x', mou: env.v.docs.mou.sha256 } }), env.sender), (e) => e.code === 'HASH_MISMATCH');
  await assert.rejects(env.service.send(sendInput(env.v, { recipientEmail: 'other@x.example' }), env.sender), (e) => e.code === 'CONFIRM_MISMATCH');
  await assert.rejects(env.service.send(sendInput(env.v, { representative: '다른사람' }), env.sender), (e) => e.code === 'CONFIRM_MISMATCH');
  await assert.rejects(env.service.send(sendInput(env.v, { confirmed: false }), env.sender), (e) => e.code === 'NOT_CONFIRMED');
  const v2 = await env.service.prepare(prepareInput({ contractDate: '2026-11-05' }));
  assert.equal(v2.version, env.v.version + 1);
  assert.notEqual(v2.docs.mou.sha256, env.v.docs.mou.sha256);
  await assert.rejects(env.service.send(sendInput(env.v), env.sender), (e) => e.code === 'STALE_VERSION');
  assert.equal(env.mock.posts.length, 0);
});

test('저장된 PDF가 확인 뒤 바뀌면 보내지 않는다', async () => {
  const env = await ready();
  const path = `contracts/co-1/v${env.v.version}/mou.pdf`;
  await env.blobs.put(path, Buffer.from('tampered'));
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(r.documents.mou.delivery, 'failed');
  assert.equal(r.documents.mou.failure.code, 'PDF_INTEGRITY');
  assert.equal(postsFor(env, 'mou').length, 0);
  assert.equal(r.documents.supply.delivery, 'created');
});

test('부분 성공: 실패한 문서만 재시도, 성공한 문서는 다시 안 보냄', async () => {
  const env = await ready({ scenarios: { mou: ['reject'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(r.documents.supply.delivery, 'created');
  assert.equal(r.documents.mou.delivery, 'failed');
  assert.equal(r.documents.mou.failure.code, 'MODUSIGN_400');

  const noop = await env.service.retryDoc({ sendId: r.sendId, type: 'supply' }, env.sender);
  assert.equal(noop.documents.supply.modusignDocumentId, r.documents.supply.modusignDocumentId);
  assert.equal(postsFor(env, 'supply').length, 1);

  const again = await env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender);
  assert.equal(again.documents.mou.delivery, 'created');
  assert.equal(postsFor(env, 'mou').length, 2);
  assert.equal(postsFor(env, 'supply').length, 1);
  assert.equal(again.documents.mou.attempts.length, 2);
  assert.equal(new Set(postsFor(env, 'mou').map((p) => p.sendKey)).size, 1);
});

test('429는 만들어지지 않은 실패로 처리해 재시도 가능', async () => {
  const env = await ready({ scenarios: { supply: ['rate'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(r.documents.supply.delivery, 'failed');
  const again = await env.service.retryDoc({ sendId: r.sendId, type: 'supply' }, env.sender);
  assert.equal(again.documents.supply.delivery, 'created');
});

test('결과 불명 + 실제 생성됨: 조회로 찾아 연결, 재발송 없음', async () => {
  for (const scenario of ['timeout_created', 'error_created']) {
    const env = await ready({ scenarios: { mou: [scenario] } });
    const r = await env.service.send(sendInput(env.v), env.sender);
    assert.equal(r.documents.mou.delivery, 'created');
    assert.equal(r.documents.mou.recovered, true);
    assert.equal(postsFor(env, 'mou').length, 1);
    assert.equal(env.mock.documents.size, 2);
  }
});

test('결과 불명 + 검색 지연: 자동 재발송 없이 대기, 시간 뒤 찾으면 연결', async () => {
  const env = await ready({ scenarios: { mou: ['timeout_created'] } });
  env.mock.state.hideFromSearch = true;
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(r.documents.mou.delivery, 'unknown');
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender), (e) => e.code === 'RESULT_UNKNOWN');
  assert.equal(postsFor(env, 'mou').length, 1);
  env.mock.state.hideFromSearch = false;
  const after = await env.service.refresh({ sendId: r.sendId });
  assert.equal(after.documents.mou.delivery, 'created');
  assert.equal(postsFor(env, 'mou').length, 1);
});

test('결과 불명 + 끝내 없음: 사람 확인이 있어야만 재시도', async () => {
  const env = await ready({ scenarios: { mou: ['timeout_lost'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(r.documents.mou.delivery, 'unknown');
  env.clock.t += 6 * 60 * 1000;
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender), (e) => e.code === 'MANUAL_CHECK_REQUIRED');
  assert.equal(postsFor(env, 'mou').length, 1);
  const done = await env.service.retryDoc({ sendId: r.sendId, type: 'mou', manualChecked: true }, env.sender);
  assert.equal(done.documents.mou.delivery, 'created');
  assert.equal(postsFor(env, 'mou').length, 2);
});

test('같은 키 문서가 여러 건이면 멈추고 사람에게 넘긴다', async () => {
  const env = await ready({ scenarios: { mou: ['timeout_lost'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  const key = env.mock.posts.find((p) => p.type === 'mou').sendKey;
  for (let i = 0; i < 2; i++) {
    await env.mock.fetchImpl(`${env.mock.baseUrl}/documents`, { method: 'POST', headers: { authorization: 'Basic x' }, body: JSON.stringify({ title: 't', file: { base64: 'AA==', extension: 'pdf' }, participants: [], metadatas: [{ key: 'card_send_key', value: key }, { key: 'card_doc_type', value: 'none' }] }) }).catch(() => {});
    env.mock.documents.set(`dup-${i}`, { id: `dup-${i}`, metadatas: [{ key: 'card_send_key', value: key }], participants: [], signings: [], fileBytes: Buffer.alloc(0) });
  }
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender), (e) => e.code === 'DUPLICATE_SUSPECT');
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou', manualChecked: true }, env.sender), (e) => e.code === 'DUPLICATE_SUSPECT');
});

test('처리 중 서버가 멈춘 문서: 임대 시간 전 거부, 지난 뒤에도 조회부터', async () => {
  const env = await ready({ scenarios: { mou: ['reject'] } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  const path = `contractSends/${r.sendId}`;
  const stuck = await env.store.get(path);
  stuck.documents.mou.delivery = 'creating';
  stuck.documents.mou.leaseUntil = env.clock.t + 60 * 1000;
  await env.store.set(path, stuck);
  const posted = postsFor(env, 'mou').length;
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender), (e) => e.code === 'BUSY');
  env.clock.t += 2 * 60 * 1000;
  // 임대가 지나도 곧바로 '없음'으로 보지 않는다(검색 반영 시간을 둔다).
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou', manualChecked: true }, env.sender), (e) => e.code === 'RESULT_UNKNOWN');
  env.clock.t += 6 * 60 * 1000;
  await assert.rejects(env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender), (e) => e.code === 'MANUAL_CHECK_REQUIRED');
  assert.equal(postsFor(env, 'mou').length, posted);
});

test('PDF를 읽지 못하면 보내지 않고 실패로 기록해 재시도할 수 있다', async () => {
  const env = await ready();
  const read = env.blobs.get;
  let broken = true;
  env.blobs.get = async (p) => { if (broken && p.endsWith('mou.pdf')) throw new Error('storage down'); return read(p); };
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(r.documents.mou.delivery, 'failed');
  assert.equal(r.documents.mou.failure.code, 'PDF_READ');
  assert.equal(postsFor(env, 'mou').length, 0);
  broken = false;
  assert.equal((await env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender)).documents.mou.delivery, 'created');
});

test('같은 업체에 진행 중 발송이 있으면 재생성부터 거부, 전부 실패면 허용', async () => {
  const env = await ready();
  await env.service.send(sendInput(env.v), env.sender);
  await assert.rejects(env.service.prepare(prepareInput({ contractDate: '2026-11-07' })), (e) => e.code === 'ACTIVE_SEND_EXISTS');
  assert.equal(env.mock.posts.length, 2);

  const env2 = await ready({ scenarios: { supply: ['reject'], mou: ['reject'] } });
  await env2.service.send(sendInput(env2.v), env2.sender);
  const v3 = await env2.service.prepare(prepareInput({ contractDate: '2026-11-07' }));
  const ok = await env2.service.send(sendInput(v3), env2.sender);
  assert.equal(ok.documents.mou.delivery, 'created');
});

test('발송 차단 조건: 기능 꺼짐, 담당자 없음, 서명 위치 미승인, 시험 양식+실제 API', async () => {
  for (const [opts, code] of [
    [{ config: { sendEnabled: false } }, 'SEND_DISABLED'],
    [{ config: { companySigner: {} } }, 'SIGNER_NOT_CONFIGURED'],
    [{ config: { modusignConfigured: false } }, 'MODUSIGN_NOT_CONFIGURED'],
    [{ registry: (r) => { r.mou.signaturePositionApproved = false; } }, 'SIGNATURE_POSITION_NOT_APPROVED'],
    [{ config: { modusignIsReal: true } }, 'TEST_ASSET_ON_REAL_API'],
  ]) {
    const env = await ready(opts);
    await assert.rejects(env.service.send(sendInput(env.v), env.sender), (e) => e.code === 'SEND_BLOCKED' && e.extra.blockers.some((b) => b.code === code), code);
    assert.equal(env.mock.posts.length, 0, code);
  }
});

test('MOU 원본 미등록이면 생성 자체가 막히고, 시험 양식은 시험 환경에서만 쓴다', async () => {
  const env = await makeEnv({ registry: (r) => { delete r.mou; } });
  await assert.rejects(env.service.prepare(prepareInput()), (e) => e.code === 'TEMPLATE_NOT_APPROVED' && e.extra.missing.includes('mou'));
  const prod = await makeEnv({ config: { allowTestAssets: false } });
  await assert.rejects(prod.service.prepare(prepareInput()), (e) => e.code === 'TEMPLATE_NOT_APPROVED');
  const approved = await makeEnv({ templateStatus: 'approved', config: { allowTestAssets: false } });
  assert.equal((await approved.service.prepare(prepareInput())).docs.mou.templateStatus, 'approved');
});

test('누락 정보가 있으면 PDF를 만들지 않는다', async () => {
  const env = await makeEnv({ companies: [company({ bizRegNo: '' })] });
  await assert.rejects(env.service.prepare(prepareInput()), (e) => e.code === 'COMPANY_INFO_INCOMPLETE' && e.extra.issues[0].field === 'bizNo');
  assert.equal(env.blobs.files.size, 3);
});

test('계약일·이메일 검증, 수정값은 발송 기록에만 남고 업체 원본 불변', async () => {
  const env = await makeEnv();
  await assert.rejects(env.service.prepare(prepareInput({ contractDate: '2026-02-31' })), (e) => e.code === 'BAD_CONTRACT_DATE');
  await assert.rejects(env.service.prepare(prepareInput({ recipientEmail: 'nope' })), (e) => e.code === 'BAD_EMAIL');
  const v = await env.service.prepare(prepareInput({ recipientEmail: 'new@x.example', contractDate: '2027-01-05' }));
  assert.equal(v.recipientEmail, 'new@x.example');
  assert.equal((await env.store.get(COMPANIES_DOC)).value[0].email, 'ceo@test-co.example');
});

test('도장 이미지: 삽입 여부와 전자서명 완료는 별개 상태, 실제 도장은 승인 전 사용 불가', async () => {
  const env = await makeEnv();
  const v = await env.service.prepare(prepareInput({ includeSeal: true }));
  assert.deepEqual({ inserted: v.sealImage.inserted, kind: v.sealImage.kind }, { inserted: true, kind: 'test' });
  const r = await env.service.send(sendInput(v), env.sender);
  assert.equal(r.sealImage.inserted, true);
  assert.equal(r.documents.mou.companySignedAt, null);
  assert.equal(r.documents.mou.allSignedAt, null);

  const real = await makeEnv({ registry: (reg) => { reg.seal.kind = 'real'; reg.seal.status = 'approved'; } });
  await assert.rejects(real.service.prepare(prepareInput({ includeSeal: true })), (e) => e.code === 'SEAL_NOT_ALLOWED');
  assert.equal((await real.service.prepare(prepareInput())).sealImage.inserted, false);

  const none = await makeEnv({ seal: false });
  await assert.rejects(none.service.prepare(prepareInput({ includeSeal: true })), (e) => e.code === 'SEAL_NOT_REGISTERED');

  const liveTest = await makeEnv({ config: { allowTestAssets: false }, templateStatus: 'approved' });
  await assert.rejects(liveTest.service.prepare(prepareInput({ includeSeal: true })), (e) => e.code === 'SEAL_NOT_ALLOWED');
});

// ---- 서명 이벤트 ------------------------------------------------------------
async function sent(opts) {
  const env = await ready(opts);
  const r = await env.service.send(sendInput(env.v), env.sender);
  return Object.assign(env, { r, mouId: r.documents.mou.modusignDocumentId, supplyId: r.documents.supply.modusignDocumentId });
}
const alerts = async (env) => ((await env.store.get(ALERT_DOC)) || {}).value || [];

test('MOU 상대방 서명: 노란 알림 1건, 양측 완료와 구분, 기존 알림 보존', async () => {
  const keep = { id: 'x', type: 'mou', companyId: 'other', companyName: '다른업체', completedAt: null };
  const env = await sent({ existingAlerts: [keep] });
  const hook = env.mock.sign(env.mouId, 1, '2026-11-03T02:00:00.000Z');
  assert.equal(hook.event.type, 'document_signed');
  const out = await env.service.handleWebhook(webhookHeaders('d1'), JSON.stringify(hook));
  assert.equal(out.alertCreated, true);
  const list = await alerts(env);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], keep);
  assert.equal(list[1].type, 'mouSigned');
  assert.equal(list[1].companyName, '시험건설(주)');
  assert.equal(list[1].counterpartySignedAt, '2026-11-03T02:00:00.000Z');
  assert.equal(JSON.stringify(list[1]).includes('http'), false);

  let s = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou;
  assert.equal(s.counterpartySignedAt, '2026-11-03T02:00:00.000Z');
  assert.equal(s.allSignedAt, null);
  assert.equal(s.companySignedAt, null);

  const last = env.mock.sign(env.mouId, 2, '2026-11-04T02:00:00.000Z');
  assert.equal(last.event.type, 'document_all_signed');
  await env.service.handleWebhook(webhookHeaders('d2'), JSON.stringify(last));
  s = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou;
  assert.equal(s.allSignedAt, '2026-11-04T02:00:00.000Z');
  assert.equal(s.modusignStatus, 'COMPLETED');
  assert.equal((await alerts(env)).length, 2);
});

test('중복·재전송 이벤트에도 알림은 1건, 사용자가 확인한 알림은 되살아나지 않음', async () => {
  const env = await sent();
  const hook = JSON.stringify(env.mock.sign(env.mouId, 1));
  await env.service.handleWebhook(webhookHeaders('d1'), hook);
  assert.deepEqual(await env.service.handleWebhook(webhookHeaders('d1'), hook), { duplicate: true });
  await env.service.handleWebhook(webhookHeaders('d3'), hook);
  assert.equal((await alerts(env)).length, 1);
  const doc = await env.store.get(ALERT_DOC);
  doc.value[0].completedAt = '2026-11-03T03:00:00.000Z';
  await env.store.set(ALERT_DOC, doc);
  await env.service.handleWebhook(webhookHeaders('d4'), hook);
  await env.service.refresh({ sendId: env.r.sendId });
  const after = await alerts(env);
  assert.equal(after.length, 1);
  assert.equal(after[0].completedAt, '2026-11-03T03:00:00.000Z');
});

test('위조·허위 이벤트: 토큰 없음 거부, 실제로 서명 안 됐으면 알림 없음', async () => {
  const env = await sent();
  const body = JSON.stringify({ event: { type: 'document_signed' }, document: { id: env.mouId } });
  await assert.rejects(env.service.handleWebhook({ 'modusign-delivery-id': 'f1' }, body), (e) => e.status === 401);
  await assert.rejects(env.service.handleWebhook({ 'x-card-webhook-token': 'wrong', 'modusign-delivery-id': 'f2' }, body), (e) => e.status === 401);
  await env.service.handleWebhook(webhookHeaders('f3'), body);
  assert.equal((await alerts(env)).length, 0);
  assert.deepEqual(await env.service.handleWebhook(webhookHeaders('f4'), JSON.stringify({ event: { type: 'document_signed' }, document: { id: 'unknown-doc' } })), { ignored: true });
  await assert.rejects(env.service.handleWebhook(webhookHeaders('f5'), 'not json'), (e) => e.status === 400);
});

test('공급계약서 서명은 노란 알림을 만들지 않는다', async () => {
  const env = await sent();
  await env.service.handleWebhook(webhookHeaders('s1'), JSON.stringify(env.mock.sign(env.supplyId, 1)));
  assert.equal((await alerts(env)).length, 0);
  assert.ok((await env.service.listSends({ companyId: 'co-1' }))[0].documents.supply.counterpartySignedAt);
});

test('모두사인 조회 실패 시 500으로 재전송 유도, 처리 표시 안 남김', async () => {
  const env = await sent();
  const hook = JSON.stringify(env.mock.sign(env.mouId, 1));
  env.mock.state.down = true;
  await assert.rejects(env.service.handleWebhook(webhookHeaders('r1'), hook));
  env.mock.state.down = false;
  const out = await env.service.handleWebhook(webhookHeaders('r1'), hook);
  assert.equal(out.alertCreated, true);
});

test('웹훅이 유실돼도 정기 보정이 알림을 만들고, 끝난 발송은 대상에서 빠진다', async () => {
  const env = await sent();
  env.mock.sign(env.mouId, 1);
  assert.equal((await env.service.reconcile()).checked, 1);
  assert.equal((await alerts(env)).length, 1);
  for (const id of [env.mouId, env.supplyId]) {
    const d = env.mock.documents.get(id);
    if (!d.signings.length) env.mock.sign(id, 1);
    env.mock.sign(id, 2);
  }
  await env.service.reconcile();
  assert.equal((await env.service.reconcile()).checked, 0);
});

test('거절·취소 상태 기록', async () => {
  const env = await sent();
  const d = env.mock.documents.get(env.mouId);
  d.status = 'ABORTED';
  d.abort = { type: 'REJECTION', abortedAt: '2026-11-03T01:00:00.000Z' };
  const s = await env.service.refresh({ sendId: env.r.sendId });
  assert.equal(s.documents.mou.abortType, 'REJECTION');
  assert.equal(s.documents.mou.modusignStatus, 'ABORTED');
  assert.equal((await alerts(env)).length, 0);
});
