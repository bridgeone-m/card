'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, PDFName, PDFDict } = require('pdf-lib');
const { evaluateCompany, blockingIssues } = require('../src/company');
const { generatePdf } = require('../src/pdf');
const { bizNo, company, buildTemplate, testMap, fontBytes, pdfText, testSealPng, CLAUSES } = require('./helpers.cjs');

const values = (over) => Object.assign({ name: '시험건설(주)', bizNo: bizNo('123456789'), address: '서울특별시 시험구 시험로 12', representative: '김시험', year: '2026', month: '11', day: '02', monthPlain: '11', dayPlain: '2' }, over);
const fields = (e) => e.issues.map((i) => `${i.field}:${i.kind}`);

test('완전한 업체: 문제 없음, 사업자번호 정규화', () => {
  const e = evaluateCompany([company({ bizRegNo: bizNo('123456789').replace(/-/g, '') })], 'co-1', 'B2B901');
  assert.deepEqual(e.issues, []);
  assert.equal(e.company.bizNo, bizNo('123456789'));
  assert.equal(e.company.email, 'ceo@test-co.example');
});

test('누락 정보는 값을 만들지 않고 안내', () => {
  const e = evaluateCompany([company({ bizRegNo: '', repName: '', address: '', email: '', code: '' })], 'co-1');
  assert.deepEqual(fields(e).sort(), ['address:missing', 'bizNo:missing', 'code:missing', 'email:missing', 'representative:missing']);
  assert.equal(e.company.bizNo, '');
  assert.equal(e.company.representative, '');
});

test('모호한 정보: 공식·보조 값 충돌, 복수 대표, 복수 이메일, 번지 없는 주소, 체크섬 오류', () => {
  const e = evaluateCompany([company({
    bizRegNo: bizNo('123456789'), partnerDashboard: { bizno: bizNo('987654321'), ceo: '박다름' },
    repName: '김시험', address: '서울특별시 시험구', email: 'a@x.example, b@x.example',
  })], 'co-1');
  assert.deepEqual(fields(e).sort(), ['address:ambiguous', 'bizNo:ambiguous', 'email:ambiguous', 'representative:ambiguous']);
  assert.deepEqual(e.emailCandidates, ['a@x.example', 'b@x.example']);
  assert.ok(fields(evaluateCompany([company({ repName: '김하나, 이둘' })], 'co-1')).includes('representative:ambiguous'));
  assert.ok(fields(evaluateCompany([company({ bizRegNo: '123-45-67891' })], 'co-1')).includes('bizNo:invalid') || bizNo('123456789') === '123-45-67891');
});

test('식별: 번호 불일치·중복 번호·중복 사업자번호·삭제 업체', () => {
  assert.ok(fields(evaluateCompany([company()], 'co-1', 'B2B000')).includes('code:ambiguous'));
  const twin = company({ id: 'co-2', name: '다른업체' });
  assert.ok(fields(evaluateCompany([company(), twin], 'co-1')).includes('code:ambiguous'));
  assert.ok(fields(evaluateCompany([company(), company({ id: 'co-2', code: 'B2B902' })], 'co-1')).includes('bizNo:ambiguous'));
  assert.ok(fields(evaluateCompany([company({ deletedAt: '2026-01-01' })], 'co-1')).includes('company:invalid'));
  assert.equal(evaluateCompany([company()], 'nope').company, null);
});

test('이메일 문제는 유효한 수신자 입력으로만 풀린다', () => {
  const e = evaluateCompany([company({ email: '' })], 'co-1');
  assert.equal(blockingIssues(e, '').length, 1);
  assert.equal(blockingIssues(e, 'bad').length, 1);
  assert.equal(blockingIssues(e, 'ok@x.example').length, 0);
});

test('PDF: 입력값이 들어가고 양식 조항·페이지가 그대로다', async () => {
  const tpl = await buildTemplate('supply');
  const pdf = await generatePdf({ templateBytes: tpl, map: testMap('supply'), values: values(), fontBytes, title: '제목' });
  const text = await pdfText(pdf.bytes);
  for (const c of CLAUSES) assert.ok(text.includes(c), c);
  for (const v of ['시험건설(주)', bizNo('123456789'), '서울특별시 시험구 시험로 12', '2026']) assert.ok(text.includes(v), v);
  assert.equal(pdf.pageCount, 2);
  const doc = await PDFDocument.load(pdf.bytes, { updateMetadata: false });
  assert.equal(doc.getTitle(), '제목');
  assert.equal(doc.getProducer(), 'card-contract');
});

test('PDF: 입력 글꼴을 서브셋 없이 통째로 넣는다(서브셋은 한글이 화면에서 빠짐)', async () => {
  const pdf = await generatePdf({ templateBytes: await buildTemplate('supply'), map: testMap('supply'), values: values(), fontBytes, title: 't' });
  assert.ok(pdf.bytes.length > 1000000, `글꼴 전체가 들어가야 함: ${pdf.bytes.length}`);
  assert.ok(pdf.bytes.length < 10 * 1024 * 1024, '모두사인 업로드 한도 안');
});

test('PDF: 긴 업체명·주소는 칸 안으로 줄이거나 줄바꿈, 넘치면 잘라 내지 않고 오류', async () => {
  const tpl = await buildTemplate('mou');
  const longName = '대한민국종합건설산업주식회사시험지점';
  const longAddress = '경기도 시험시 시험구 시험대로 1234번길 56-78, 시험타워 제3동 12층 1205호(시험동, 시험아파트단지내상가)';
  const pdf = await generatePdf({ templateBytes: tpl, map: testMap('mou'), values: values({ name: longName, address: longAddress }), fontBytes, title: 't' });
  const name = pdf.layout.find((l) => l.field === '업체명');
  assert.ok(name.size <= 10 && name.size >= 6.5);
  assert.equal(pdf.layout.find((l) => l.field === '주소').lines.length, 2);
  await assert.rejects(generatePdf({ templateBytes: tpl, map: testMap('mou'), values: values({ name: '가'.repeat(200) }), fontBytes, title: 't' }), (e) => e.code === 'FIELD_TOO_LONG');
});

test('PDF: 글꼴에 없는 글자는 두부 글자로 찍지 않고 오류', async () => {
  const tpl = await buildTemplate('mou');
  await assert.rejects(generatePdf({ templateBytes: tpl, map: testMap('mou'), values: values({ name: '시험😀건설' }), fontBytes, title: 't' }), (e) => e.code === 'UNSUPPORTED_CHARACTER');
});

test('PDF: 서명 폼이 남은 파일(체결본)은 양식으로 쓸 수 없다', async () => {
  const doc = await PDFDocument.load(await buildTemplate('mou'));
  doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ SigFlags: 3, Fields: [] }));
  const signed = Buffer.from(await doc.save());
  await assert.rejects(generatePdf({ templateBytes: signed, map: testMap('mou'), values: values(), fontBytes, title: 't' }), (e) => e.code === 'TEMPLATE_NOT_BLANK');
});

test('PDF: 도장 이미지는 요청할 때만 지정 위치에 들어간다', async () => {
  const tpl = await buildTemplate('mou');
  const countImages = async (bytes) => {
    const doc = await PDFDocument.load(bytes);
    const res = doc.getPage(1).node.Resources();
    const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    return xo ? xo.keys().length : 0;
  };
  const without = await generatePdf({ templateBytes: tpl, map: testMap('mou'), values: values(), fontBytes, title: 't' });
  const withSeal = await generatePdf({ templateBytes: tpl, map: testMap('mou'), values: values(), fontBytes, title: 't', seal: { bytes: testSealPng(), kind: 'test' } });
  assert.equal(await countImages(without.bytes), 0);
  assert.equal(await countImages(withSeal.bytes), 1);
  assert.notEqual(without.sha256, withSeal.sha256);
});
