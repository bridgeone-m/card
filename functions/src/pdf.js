'use strict';
// 승인된 양식 PDF 위에 입력값만 얹는다. 양식의 기존 페이지 내용은 그대로 두고 새 내용만 덧붙이므로
// 계약 조항·서식이 바뀌지 않는다. 칸에 안 들어가면 잘라 내지 않고 오류로 돌려준다.
const crypto = require('crypto');
const { PDFDocument, PDFName, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { AppError } = require('./errors');

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const INK = rgb(0.137, 0.122, 0.125);

function wrapText(font, text, size, width) {
  const lines = [];
  let line = '';
  const fits = (s) => font.widthOfTextAtSize(s, size) <= width;
  for (const word of text.split(/(?<= )/)) {
    if (fits(line + word)) { line += word; continue; }
    if (line) { lines.push(line.trimEnd()); line = ''; }
    if (fits(word)) { line = word; continue; }
    for (const ch of word) {
      if (fits(line + ch)) line += ch;
      else { lines.push(line); line = ch; }
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

function assertGlyphs(font, text, field) {
  const supported = new Set(font.getCharacterSet());
  const bad = Array.from(new Set(Array.from(text).filter((ch) => !supported.has(ch.codePointAt(0)))));
  if (bad.length) throw new AppError(422, 'UNSUPPORTED_CHARACTER', `${field} 칸에 쓸 수 없는 글자가 있습니다: ${bad.join(' ')}`, { field });
}

// 큰 글자부터 내려가며 칸에 맞는 크기를 찾는다.
function fit(font, text, box, field) {
  const maxLines = box.maxLines || 1;
  const min = box.minSize || box.size;
  for (let size = box.size; size >= min - 1e-6; size -= 0.25) {
    const lines = wrapText(font, text, size, box.w);
    let lineHeight = box.lineHeight || size * 1.25;
    // 문단은 줄이 늘면 줄 간격을 좁혀 다음 조항을 침범하지 않게 한다.
    if (box.minLineHeight && lines.length * lineHeight > box.h) lineHeight = Math.max(box.minLineHeight, box.h / lines.length);
    if (lines.length <= maxLines && lines.length * lineHeight <= box.h + 0.5) return { size, lines, lineHeight };
  }
  throw new AppError(422, 'FIELD_TOO_LONG', `${field} 값이 양식 칸보다 깁니다. 값을 확인해주세요: ${text}`, { field });
}

function drawBox(page, font, box, text, field) {
  const { size, lines, lineHeight } = fit(font, text, box, field);
  const pageH = page.getHeight();
  const blockH = lines.length * lineHeight;
  // 칸 안에서 세로 가운데. 좌표계는 양식 지도 기준(왼쪽 위 원점), 그리기는 pdf-lib(왼쪽 아래 원점).
  let top = box.y + (box.valign === 'top' ? 0 : Math.max(0, (box.h - blockH) / 2));
  for (const line of lines) {
    const width = font.widthOfTextAtSize(line, size);
    const x = box.align === 'center' ? box.x + (box.w - width) / 2 : box.x;
    const baseline = pageH - top - lineHeight + (lineHeight - size) / 2 + size * 0.16;
    page.drawText(line, { x, y: baseline, size, font, color: INK });
    top += lineHeight;
  }
  return { field, size, lines };
}

function spacedName(name) {
  return name.length <= 4 && !/\s/.test(name) ? Array.from(name).join('  ') : name;
}

function fieldValue(def, values) {
  if (def.text) return def.text; // 양식에 고정으로 찍는 표시(예: (인))
  const raw = values[def.value];
  if (raw == null || raw === '') throw new AppError(422, 'FIELD_MISSING', `${def.label || def.value} 값이 없습니다.`);
  const text = String(raw);
  return def.format === 'spaced' ? spacedName(text) : text;
}

// 체결본·서명본이 양식으로 들어오는 것을 막는 최소 검사(서버 실행 때마다).
function assertBlankTemplate(doc) {
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (acro) throw new AppError(409, 'TEMPLATE_NOT_BLANK', '양식에 서명·입력 폼이 남아 있어 사용할 수 없습니다. 서명 전 원본을 등록해주세요.');
}

async function generatePdf({ templateBytes, map, values, fontBytes, seal, title }) {
  const doc = await PDFDocument.load(templateBytes, { updateMetadata: false });
  assertBlankTemplate(doc);
  if (doc.getPageCount() !== map.pageCount) throw new AppError(409, 'TEMPLATE_MISMATCH', '양식 페이지 수가 입력 위치 설정과 다릅니다.');
  doc.registerFontkit(fontkit);
  // subset:true 는 pdf-lib 서브셋 오류로 한글 글자가 화면에서 빠진다(글자 추출로는 안 보임). 전체를 넣는다.
  // 글꼴의 문맥 대체·자간 기능은 끈다(켜면 숫자 사이 하이픈 뒤에 틈이 생겨 123-  45 처럼 찍힌다).
  const features = { calt: false, liga: false, kern: false, case: false, ccmp: false, locl: false, clig: false, rlig: false };
  const font = await doc.embedFont(fontBytes, { subset: false, features });
  const pages = doc.getPages();
  const layout = [];

  for (const def of map.fields) {
    const text = fieldValue(def, values);
    assertGlyphs(font, text, def.label || def.value);
    layout.push(drawBox(pages[def.page - 1], font, def, text, def.label || def.value));
  }
  for (const par of map.paragraphs || []) {
    const text = par.template.replace(/\{(\w+)\}/g, (_, key) => {
      if (values[key] == null || values[key] === '') throw new AppError(422, 'FIELD_MISSING', `${par.label}에 넣을 값(${key})이 없습니다.`);
      return values[key];
    });
    assertGlyphs(font, text, par.label);
    layout.push(drawBox(pages[par.page - 1], font, Object.assign({ valign: 'top' }, par), text, par.label));
  }
  // 도장 이미지: 그림을 얹는 것뿐이다. 모두사인 전자서명 완료와는 별개 상태로 기록한다.
  if (seal) {
    const image = await doc.embedPng(seal.bytes);
    const box = map.sealImage;
    if (!box) throw new AppError(409, 'SEAL_POSITION_MISSING', '도장 이미지 위치가 양식에 지정되지 않았습니다.');
    const page = pages[box.page - 1];
    page.drawImage(image, { x: box.x, y: page.getHeight() - box.y - box.h, width: box.w, height: box.h });
  }

  doc.setTitle(title);
  doc.setSubject('');
  doc.setAuthor('');
  doc.setKeywords([]);
  doc.setCreator('card-contract');
  doc.setProducer('card-contract');
  const bytes = Buffer.from(await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }));
  return { bytes, sha256: sha256(bytes), pageCount: doc.getPageCount(), layout };
}

module.exports = { generatePdf, assertBlankTemplate, sha256, wrapText };
