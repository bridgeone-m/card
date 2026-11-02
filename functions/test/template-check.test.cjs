'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { inspectTemplate } = require('../src/templateCheck');
const { buildTemplate, fontBytes } = require('./helpers.cjs');

async function pdfWithText(text, edit) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: false });
  doc.addPage([595, 842]).drawText(text, { x: 40, y: 700, size: 10, font });
  if (edit) edit(doc);
  return Buffer.from(await doc.save());
}

test('깨끗한 양식은 통과', async () => {
  assert.deepEqual(await inspectTemplate(await buildTemplate('mou')), []);
});

test('체결본 흔적·이전 업체·시험 양식은 등록 거부', async () => {
  const withId = await pdfWithText('Modusign Document ID : abc - 1 / 3');
  assert.ok((await inspectTemplate(withId)).some((p) => p.includes('모두사인 문서 ID')));
  const old = await pdfWithText('상호 이전 업체 건설');
  assert.ok((await inspectTemplate(old, { forbidden: ['이전업체건설'] })).some((p) => p.includes('이전 업체')));
  const form = await pdfWithText('양식', (d) => d.catalog.set(PDFName.of('AcroForm'), d.context.obj({ SigFlags: 3, Fields: [] })));
  assert.ok((await inspectTemplate(form)).some((p) => p.includes('AcroForm')));
  const fixture = await pdfWithText('양식', (d) => d.setSubject('TEST-ONLY-NOT-A-CONTRACT'));
  assert.ok((await inspectTemplate(fixture)).some((p) => p.includes('시험용')));
  assert.deepEqual(await inspectTemplate(fixture, { allowTestMark: true }), []);
});

test('공개 저장소에 양식·도장·비밀 파일을 넣지 않는다', () => {
  const root = path.join(__dirname, '../..');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const rule of ['functions/.env*', '*.template.pdf', '*.map.json', 'contract-assets/']) assert.ok(ignore.includes(rule), rule);
  const config = fs.readFileSync(path.join(root, 'contractEsignConfig.js'), 'utf8');
  // 서버 주소는 비어 있거나(미연결) 운영 계약서 함수 주소만 허용한다. 다른 곳으로 보내지 않는다.
  const apiBase = (config.match(/apiBase:\s*'([^']*)'/) || [])[1];
  assert.ok(apiBase === '' || apiBase === 'https://asia-northeast3-pour-dashboard.cloudfunctions.net/contractApi', `apiBase: ${apiBase}`);
  for (const file of ['contract-esign.js', 'contractEsignConfig.js']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(/modusign\.co\.kr|MODUSIGN_API_KEY|Basic\s/.test(src), false, file);
  }
});
