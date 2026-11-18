'use strict';
// 2026-11-18 새 기본물품공급계약서(여신 보완본) + 별지 「물품대금 결제조건 확인서」.
// 확인서의 A(보증보험)·B(선납) 표시는 카드 협약진행 탭 거래방식(payTerms)으로 미리 체크하고,
// 을은 계약서 (인)과 확인서 서명 칸 두 곳에 서명한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, company, prepareInput, sendInput } = require('./helpers.cjs');
const { evaluateCompany } = require('../src/company');
const { buildCreateBody } = require('../src/modusign');

// 시험 양식 지도에 확인서 칸(체크 A·B, 거래방식 글자)과 을 서명 칸 2개를 더한다.
function withPayTermsMap(reg) {
  const map = reg.supply.map;
  map.fields.push(
    { type: 'check', value: 'payTerms', equals: 'guarantee', label: '확인서 A 보증보험', page: 2, x: 60, y: 400, w: 12, h: 12 },
    { type: 'check', value: 'payTerms', equals: 'prepay', label: '확인서 B 선납', page: 2, x: 60, y: 430, w: 12, h: 12 },
  );
  map.signature.counterparty = [map.signature.counterparty, { page: 2, x: 400, y: 600, w: 60, h: 30 }];
}

test('거래방식: 새 양식이면 저장된 거래방식이 없을 때 막고, 안내 문구를 준다', () => {
  const e = evaluateCompany([company()], 'co-1', 'B2B901', { requirePayTerms: true });
  const issue = e.issues.find((i) => i.field === 'payTerms');
  assert.ok(issue, '거래방식 문제 없음');
  assert.match(issue.message, /협약진행/);
  const ok = evaluateCompany([company({ payTerms: { type: 'guarantee' } })], 'co-1', 'B2B901', { requirePayTerms: true });
  assert.equal(ok.issues.length, 0);
  assert.equal(ok.company.payTerms, 'guarantee');
  assert.equal(ok.company.payTermsLabel, '보증보험');
  // 옛 양식(거래방식 칸 없음)은 거래방식이 없어도 그대로 준비된다.
  assert.equal(evaluateCompany([company()], 'co-1', 'B2B901').issues.length, 0);
});

test('거래방식: 새 양식 등록 뒤 거래방식이 없으면 PDF 생성이 막힌다', async () => {
  const env = await makeEnv({ registry: withPayTermsMap });
  await assert.rejects(env.service.prepare(prepareInput()), (e) => e.code === 'COMPANY_INFO_INCOMPLETE' && e.extra.issues.some((i) => i.field === 'payTerms'));
  const chk = await env.service.checkCompany({ companyId: 'co-1', companyCode: 'B2B901' });
  assert.ok(chk.issues.some((i) => i.field === 'payTerms'));
});

test('거래방식: 보증보험이면 A 칸에만, 선납이면 B 칸에만 체크가 그려진다', async () => {
  for (const [type, label] of [['guarantee', '확인서 A 보증보험'], ['prepay', '확인서 B 선납']]) {
    const env = await makeEnv({ registry: withPayTermsMap, companies: [company({ payTerms: { type } })] });
    const v = await env.service.prepare(prepareInput());
    assert.equal(v.company.payTerms, type);
    const stored = await env.store.get(`contractVersions/co-1_v${v.version}`);
    assert.equal(stored.company.payTermsLabel, type === 'guarantee' ? '보증보험' : '선납');
    // 지도는 버전에 함께 저장된다(어느 칸에 그렸는지 다시 확인할 수 있게).
    const checks = stored.docs.supply.map.fields.filter((f) => f.type === 'check');
    assert.equal(checks.length, 2);
    assert.ok(checks.some((f) => f.label === label));
  }
});

test('거래방식: 미리보기 뒤 카드에서 거래방식을 바꾸면 그 PDF는 발송하지 않는다', async () => {
  const env = await makeEnv({ registry: withPayTermsMap, companies: [company({ payTerms: { type: 'prepay' } })] });
  const v = await env.service.prepare(prepareInput());
  const key = 'users/shared-owner/shin2/shin2-companies-staging';
  await env.store.set(key, { value: [company({ payTerms: { type: 'guarantee' } })] });
  await assert.rejects(env.service.send(sendInput(v), env.sender), (e) => e.code === 'COMPANY_CHANGED');
});

test('을 서명 칸이 둘이면 모두사인 요청에도 을 서명 칸이 둘 들어간다', async () => {
  const env = await makeEnv({ registry: withPayTermsMap, companies: [company({ payTerms: { type: 'guarantee' } })], config: { companySigns: false } });
  const v = await env.service.prepare(prepareInput());
  await env.service.send(sendInput(v), env.sender);
  const supply = env.mock.posts.find((p) => p.title.includes('기본물품공급계약서'));
  const mou = env.mock.posts.find((p) => p.title.includes('MOU'));
  assert.equal(supply.participants[0].fields.length, 2);
  assert.equal(mou.participants[0].fields.length, 1);
  // 카드 미리보기에 그릴 을 서명 위치도 두 개다.
  assert.equal(v.docs.supply.signaturePositions.counterparty.length, 2);
});

test('generatePdf: 체크 칸은 값이 같을 때만 그리고, 값이 없으면 막는다', async () => {
  const fs = require('fs');
  const path = require('path');
  const { PDFDocument } = require('pdf-lib');
  const { generatePdf } = require('../src/pdf');
  const fontBytes = fs.readFileSync(path.join(__dirname, '../assets/fonts/Pretendard-Regular.ttf'));
  const doc = await PDFDocument.create(); doc.addPage([595, 842]);
  const templateBytes = Buffer.from(await doc.save());
  const map = { pageCount: 1, pageSize: { width: 595, height: 842 }, fields: [
    { type: 'check', value: 'payTerms', equals: 'guarantee', label: 'A', page: 1, x: 50, y: 50, w: 12, h: 12 },
    { type: 'check', value: 'payTerms', equals: 'prepay', label: 'B', page: 1, x: 50, y: 80, w: 12, h: 12 },
  ] };
  const g = await generatePdf({ templateBytes, map, values: { payTerms: 'prepay' }, fontBytes, title: 't' });
  assert.deepEqual(g.layout.map((l) => l.field), ['B']);
  await assert.rejects(generatePdf({ templateBytes, map, values: { payTerms: '' }, fontBytes, title: 't' }), (e) => e.code === 'FIELD_MISSING');
});

test('buildCreateBody: 서명 칸 하나(옛 양식)도 그대로 동작한다', () => {
  const map = { pageSize: { width: 595, height: 842 }, signature: { counterparty: { page: 1, x: 10, y: 10, w: 40, h: 20 } } };
  const body = buildCreateBody({ title: 't', pdfBytes: Buffer.from('x'), counterparty: { name: '김시험', email: 'a@b.cd' }, companySigner: null, map, metadata: {} });
  assert.equal(body.participants[0].fields.length, 1);
});
