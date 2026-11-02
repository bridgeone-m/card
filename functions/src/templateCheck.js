'use strict';
// 양식 등록 전 검사. 체결본·수정본이 원본으로 등록되는 것을 막는다(등록 스크립트와 시험에서 사용).
const { PDFDocument, PDFName } = require('pdf-lib');

const SIGNED_MARKS = ['Modusign', 'ByteRange', '/Sig'];

async function extractText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out += content.items.map((it) => it.str).join(' ') + '\n';
  }
  return out;
}

// 문제 목록을 돌려준다. 비어 있어야 등록할 수 있다.
async function inspectTemplate(bytes, { forbidden = [], allowTestMark = false } = {}) {
  const problems = [];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.catalog.lookup(PDFName.of('AcroForm'))) problems.push('서명·입력 폼(AcroForm)이 남아 있습니다.');
  const raw = Buffer.from(bytes).toString('latin1');
  for (const mark of SIGNED_MARKS) if (raw.includes(mark)) problems.push(`파일에 서명 흔적이 있습니다: ${mark}`);
  const text = await extractText(bytes);
  if (/Modusign Document ID/i.test(text)) problems.push('모두사인 문서 ID가 남아 있습니다.');
  const compact = text.replace(/\s+/g, '');
  for (const word of forbidden) if (compact.includes(word.replace(/\s+/g, ''))) problems.push(`이전 업체 정보가 남아 있습니다: ${word}`);
  if (!allowTestMark && (doc.getSubject() === 'TEST-ONLY-NOT-A-CONTRACT' || text.includes('시험용 양식'))) problems.push('시험용 양식은 원본으로 등록할 수 없습니다.');
  return problems;
}

module.exports = { inspectTemplate };
