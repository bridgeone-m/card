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
