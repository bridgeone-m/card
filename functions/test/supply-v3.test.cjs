'use strict';
// 2026-11-18 새 기본물품공급계약서(여신 보완본 + 결제조건 확인서 통합, 10쪽):
// - 9쪽 결제조건 A·B 네모 칸은 시공사가 모두사인에서 둘 중 하나를 직접 체크(체크 그룹 최소 1·최대 1)
// - 양식 쪽마다 크기가 다름(1~8쪽 레터, 9~10쪽 A4) → 모두사인 위치 비율은 그 쪽 크기로 계산
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, company, prepareInput, sendInput } = require('./helpers.cjs');
const { buildCreateBody } = require('../src/modusign');

const GROUP = { groupLabel: '결제조건', minCheckRequired: 1, maxCheckLimit: 1, boxes: [
  { dataLabel: 'A_보증보험', label: 'A. 보증보험', page: 2, x: 55.6, y: 220.9, w: 16.4, h: 16.4 },
  { dataLabel: 'B_선납', label: 'B. 선납', page: 2, x: 55.6, y: 419.5, w: 16.4, h: 16.4 },
] };

function v3Map(reg) {
  const map = reg.supply.map;
  map.checkboxGroups = [GROUP];
  map.pageSizes = [{ width: 612, height: 792 }, { width: 595.28, height: 841.89 }];
}

test('체크 그룹: 을 참여자에 「결제조건」 그룹(최소 1·최대 1)과 CHECKBOX 두 칸이 들어간다', () => {
  const map = { pageSize: { width: 612, height: 792 }, pageSizes: [{ width: 612, height: 792 }, { width: 595.28, height: 841.89 }],
    signature: { counterparty: { page: 2, x: 504.4, y: 436.5, w: 44, h: 40 } }, checkboxGroups: [GROUP] };
  const body = buildCreateBody({ title: 't', pdfBytes: Buffer.from('x'), counterparty: { name: '김시험', email: 'a@b.cd' }, companySigner: null, map, metadata: {} });
  const p = body.participants[0];
  assert.deepEqual(p.checkboxFieldGroups, [{ groupLabel: '결제조건', minCheckRequired: 1, maxCheckLimit: 1 }]);
  const boxes = p.fields.filter((f) => f.type === 'CHECKBOX');
  assert.deepEqual(boxes.map((b) => b.dataLabel), ['A_보증보험', 'B_선납']);
  for (const b of boxes) {
    assert.equal(b.groupLabel, '결제조건');
    assert.equal(b.size.height, undefined, '체크 칸 크기는 width 만(공식 스키마)');
    assert.equal(b.required, undefined, '그룹 멤버의 required 는 무시되므로 넣지 않음');
  }
  // 2쪽(A4) 기준 비율 — 1쪽(레터) 크기로 나누면 틀린 위치가 된다.
  assert.ok(Math.abs(boxes[0].position.x - 55.6 / 595.28) < 1e-9);
  assert.ok(Math.abs(boxes[0].position.y - 220.9 / 841.89) < 1e-9);
  const sig = p.fields.find((f) => f.type === 'SIGNATURE');
  assert.ok(Math.abs(sig.position.x - 504.4 / 595.28) < 1e-9);
});

test('체크 그룹이 없는 옛 양식은 checkboxFieldGroups 를 보내지 않는다', () => {
  const map = { pageSize: { width: 595, height: 842 }, signature: { counterparty: { page: 1, x: 10, y: 10, w: 40, h: 20 } } };
  const body = buildCreateBody({ title: 't', pdfBytes: Buffer.from('x'), counterparty: { name: '김시험', email: 'a@b.cd' }, companySigner: null, map, metadata: {} });
  assert.equal('checkboxFieldGroups' in body.participants[0], false);
});

test('새 양식 발송: 거래방식 저장 없이도 준비·발송되고(시공사가 직접 체크), 미리보기에 체크 칸 위치가 온다', async () => {
  const env = await makeEnv({ registry: v3Map, companies: [company()], config: { companySigns: false } });
  const v = await env.service.prepare(prepareInput());
  assert.equal(v.docs.supply.signaturePositions.checkboxes.length, 2);
  assert.equal(v.docs.mou.signaturePositions.checkboxes.length, 0);
  await env.service.send(sendInput(v), env.sender);
  const supply = env.mock.posts.find((p) => p.title.includes('기본물품공급계약서'));
  assert.equal(supply.participants[0].checkboxFieldGroups.length, 1);
  assert.equal(supply.participants[0].fields.filter((f) => f.type === 'CHECKBOX').length, 2);
});

// §결제조건 자동 반영: 시공사가 모두사인에서 고른 칸 → 카드 거래방식(payTerms)
const { webhookHeaders } = require('./helpers.cjs');
async function signedSupply(over = {}) {
  const env = await makeEnv({ registry: v3Map, companies: [company(over.company)], config: { companySigns: false } });
  const v = await env.service.prepare(prepareInput());
  await env.service.send(sendInput(v), env.sender);
  const doc = [...env.mock.documents.values()].find((d) => d.title.includes('기본물품공급계약서'));
  for (const [label, val] of Object.entries(over.checks || {})) env.mock.setFieldValue(doc.id, label, val);
  const hook = env.mock.sign(doc.id, 1, '2026-11-18T08:00:00.000Z');
  await env.service.handleWebhook(webhookHeaders('d-' + Math.random()), JSON.stringify(hook));
  const card = (await env.store.get('users/shared-owner/shin2/shin2-companies-staging')).value[0];
  const sent = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.supply;
  return { env, card, sent };
}

test('자동 반영: 시공사가 B(선납)를 고르고 서명하면 카드 거래방식이 선납으로 저장된다', async () => {
  const { card } = await signedSupply({ checks: { B_선납: true } });
  assert.equal(card.payTerms.type, 'prepay');
  assert.equal(card.payTerms.by, '모두사인 회신(자동)');
  assert.deepEqual(card.payTermsLog.map((l) => [l.from, l.to]), [['', 'prepay']]);
});

test('자동 반영: 카드에 선납이 있어도 시공사가 A(보증보험)를 고르면 보증보험으로 바뀌고 이력이 남는다', async () => {
  const { card } = await signedSupply({ company: { payTerms: { type: 'prepay' }, payTermsLog: [{ from: '', to: 'prepay' }] }, checks: { A_보증보험: true } });
  assert.equal(card.payTerms.type, 'guarantee');
  assert.deepEqual(card.payTermsLog.map((l) => l.to), ['prepay', 'guarantee']);
});

test('자동 반영: 같은 값이면 카드를 다시 쓰지 않는다', async () => {
  const { card } = await signedSupply({ company: { payTerms: { type: 'guarantee', by: '사용자 1' } }, checks: { A_보증보험: true } });
  assert.equal(card.payTerms.by, '사용자 1');
  assert.equal(card.payTermsLog, undefined);
});

test('자동 반영: 체크가 둘이거나 없으면 카드를 바꾸지 않는다', async () => {
  const both = await signedSupply({ checks: { A_보증보험: true, B_선납: true } });
  assert.equal(both.card.payTerms, undefined);
  assert.equal(both.sent.allSignedAt, '2026-11-18T08:00:00.000Z', '서명 상태 반영은 그대로');
  const none = await signedSupply({});
  assert.equal(none.card.payTerms, undefined);
});

test('자동 반영: 체크 값 조회가 실패해도 서명 완료 반영은 막히지 않는다', async () => {
  const env = await makeEnv({ registry: v3Map, companies: [company()], config: { companySigns: false } });
  const v = await env.service.prepare(prepareInput());
  await env.service.send(sendInput(v), env.sender);
  const doc = [...env.mock.documents.values()].find((d) => d.title.includes('기본물품공급계약서'));
  env.mock.setFieldValue(doc.id, 'B_선납', true);
  const hook = env.mock.sign(doc.id, 1, '2026-11-18T08:00:00.000Z');
  env.mock.state.hook = async (method, u) => { if (/participant-fields/.test(u.pathname)) throw new TypeError('down'); };
  await env.service.handleWebhook(webhookHeaders('d-fail'), JSON.stringify(hook));
  const sent = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.supply;
  assert.equal(sent.allSignedAt, '2026-11-18T08:00:00.000Z');
  env.mock.state.hook = null;
  await env.service.refresh({ sendId: (await env.service.listSends({ companyId: 'co-1' }))[0].sendId });
  const card = (await env.store.get('users/shared-owner/shin2/shin2-companies-staging')).value[0];
  assert.equal(card.payTerms.type, 'prepay', '다음 조회 때 다시 읽어 반영');
});

// §계약 기한(2026-11-25): 공급계약서 뒷장 계약일 + 제20조(체결일로부터 1년) → 카드 payTerms.until·발송 기록 contractTerm
test('기한: 선납 회신 시 카드 거래방식 옆에 계약일(2026-11-02)과 기한(2027-11-02)이 함께 저장된다', async () => {
  const { card, sent } = await signedSupply({ checks: { B_선납: true } });
  assert.equal(card.payTerms.type, 'prepay');
  assert.equal(card.payTerms.contractDate, '2026-11-02');
  assert.equal(card.payTerms.until, '2027-11-02');
  assert.equal(sent.contractTerm.until, '2027-11-02');
  assert.match(sent.contractTerm.clause, /제20조/);
});

test('기한: 거래방식이 이미 같아도 기한이 없으면 기한만 채우고 거래방식·이력은 그대로', async () => {
  const { card } = await signedSupply({ company: { payTerms: { type: 'guarantee', by: '사용자 1' } }, checks: { A_보증보험: true } });
  assert.equal(card.payTerms.by, '사용자 1');
  assert.equal(card.payTerms.until, '2027-11-02');
  assert.equal(card.payTermsLog, undefined);
});

test('기한: 체크가 불명확하면 카드에는 쓰지 않고 발송 기록에만 남는다', async () => {
  const { card, sent } = await signedSupply({});
  assert.equal(card.payTerms, undefined);
  assert.equal(sent.contractTerm.until, '2027-11-02');
});

