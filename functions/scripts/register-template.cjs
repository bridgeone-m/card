'use strict';
// 승인된 서명 전 원본 양식 또는 도장 이미지를 비공개 저장공간에 등록한다(운영자 PC에서 실행, 아직 실행 전).
// 서명 위치는 실측 후 --signature-approved 를 줄 때만 승인 처리된다.
//   node register-template.cjs template --type mou --pdf 원본.pdf --map mou.map.json --version 2026-11 \
//        --source "서명 전 원본 출처" --approved-by "승인자" --forbidden "이전업체,이전주소" [--signature-approved]
//   node register-template.cjs seal --png 도장.png --approved-by "승인자"
// 도장 등록만으로는 사용되지 않는다. 서버 설정 CONTRACT_REAL_SEAL_APPROVED=true 까지 별도 승인 후 켠다.
// 인증: GOOGLE_APPLICATION_CREDENTIALS 서비스 계정. 키 파일은 저장소에 두지 않는다.
const fs = require('fs');
const admin = require('firebase-admin');
const { sha256 } = require('../src/pdf');
const { inspectTemplate } = require('../src/templateCheck');
const { REGISTRY_PATH, DOC_TYPES } = require('../src/templates');

function args(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue;
    const key = list[i].slice(2);
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}
const need = (a, key) => { if (!a[key] || a[key] === true) throw new Error(`--${key} 가 필요합니다.`); return a[key]; };

async function main() {
  const [kind, ...rest] = process.argv.slice(2);
  const a = args(rest);
  const approvedBy = need(a, 'approved-by');
  const approvedAt = new Date().toISOString();

  let blobPath, bytes, entryKey, entry, contentType;
  if (kind === 'template') {
    const type = need(a, 'type');
    if (!DOC_TYPES.includes(type)) throw new Error(`--type 은 ${DOC_TYPES.join('|')} 중 하나입니다.`);
    bytes = fs.readFileSync(need(a, 'pdf'));
    const problems = await inspectTemplate(bytes, { forbidden: String(a.forbidden || '').split(',').filter(Boolean) });
    if (problems.length) throw new Error(`등록 거부:\n- ${problems.join('\n- ')}`);
    const version = need(a, 'version');
    blobPath = `contractAssets/templates/${type}/${version}.pdf`;
    contentType = 'application/pdf';
    entryKey = type;
    entry = {
      status: 'approved', version, blobPath, sha256: sha256(bytes), map: JSON.parse(fs.readFileSync(need(a, 'map'), 'utf8')),
      signaturePositionApproved: a['signature-approved'] === true,
      provenance: { source: need(a, 'source'), approvedBy, approvedAt },
    };
  } else if (kind === 'seal') {
    bytes = fs.readFileSync(need(a, 'png'));
    blobPath = `contractAssets/seal/${sha256(bytes).slice(0, 16)}.png`;
    contentType = 'image/png';
    entryKey = 'seal';
    entry = { kind: 'real', status: 'approved', blobPath, sha256: sha256(bytes), approvedBy, approvedAt };
  } else {
    throw new Error('사용법: register-template.cjs template|seal ...');
  }

  admin.initializeApp({ storageBucket: 'pour-dashboard.firebasestorage.app' });
  await admin.storage().bucket().file(blobPath).save(bytes, { resumable: false, contentType });
  // mergeFields: 재등록 때 옛 입력 위치가 남지 않도록 항목 전체를 교체한다(다른 항목은 유지).
  await admin.firestore().doc(REGISTRY_PATH).set({ [entryKey]: entry }, { mergeFields: [entryKey] });
  console.log('등록 완료', entryKey, entry.sha256.slice(0, 12)); // 파일 내용·비밀값은 출력하지 않는다
}

main().catch((err) => { console.error(err.message); process.exit(1); });
