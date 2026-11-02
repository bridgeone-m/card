'use strict';
// Storage 규칙안 빠른 점검(모형). 실제 규칙 엔진 검증은 dev/emulator-verify.cjs 로 한다.
// 현재 규칙은 운영 원문과 같은 구조다(2026-11-02 대조, UID 값만 시험값).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeEnv, prepareInput, sendInput } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '../..');
const RULE_FILE = path.join(ROOT, 'docs/contract-esign/storage.rules.proposed');
const SHARED = 'shared-uid';

function loadProposed() {
  const source = fs.readFileSync(RULE_FILE, 'utf8');
  const code = source.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return { source, code };
}
function parseProposed() {
  const { code } = loadProposed();
  const excluded = code.match(/!\(top in \[([^\]]*)\]\)/);
  assert.ok(excluded, '계약 경로 제외 조건이 있어야 한다');
  return excluded[1].split(',').map((s) => s.trim().replace(/'/g, ''));
}
// 현재 규칙: 공용 UID 면 모든 경로 허용.
const current = (p, uid) => uid === SHARED && p.length >= 0;
// 제안안: 공용 UID 이고 첫 경로가 제외 목록에 없을 때만 허용. 첫 경로가 없으면(버킷 최상위) 매치되지 않는다.
function proposed(p, uid, excluded) {
  const top = p.split('/')[0];
  if (!top) return false;
  return uid === SHARED && !excluded.includes(top);
}

test('규칙안 형식: 전체 허용 규칙이 남아 있지 않고 다른 허용 블록이 없다', () => {
  const { code, source } = loadProposed();
  assert.match(code, /rules_version = '2';/);
  assert.equal((code.match(/\bmatch\b/g) || []).length, 2, '버킷 블록과 조건 블록 2개뿐');
  assert.equal((code.match(/\ballow\b/g) || []).length, 1, 'allow 는 1개뿐');
  assert.equal(/allPaths/.test(code), false, '전체 허용 패턴 없음');
  assert.equal(/if true/.test(code), false);
  assert.match(code, /request\.auth != null/);
  assert.match(code, /request\.auth\.uid == '<공용 UID>'/, '실제 UID 를 저장소에 넣지 않는다');
  assert.equal(/[A-Za-z0-9]{24,}/.test(source), false, 'UID 로 보이는 값 없음');
  assert.deepEqual(parseProposed(), ['contracts', 'contractAssets']);
});

test('서버가 실제로 쓰는 Storage 경로는 전부 제외 목록 안에 있다', async () => {
  const excluded = parseProposed();
  const env = await makeEnv();
  const v = await env.service.prepare(prepareInput());
  await env.service.send(sendInput(v), env.sender);
  const generated = [...env.blobs.files.keys()].filter((p) => !p.startsWith('templates/')); // templates/ 는 시험 합성 양식 전용
  assert.ok(generated.length >= 2);
  const script = fs.readFileSync(path.join(__dirname, '../scripts/register-template.cjs'), 'utf8');
  const registered = [...script.matchAll(/blobPath = `([^`]+)`/g)].map((m) => m[1]);
  assert.equal(registered.length, 2);
  const service = fs.readFileSync(path.join(__dirname, '../src/service.js'), 'utf8');
  assert.deepEqual([...service.matchAll(/blobPath = `([^`]+)`/g)].map((m) => m[1].split('/')[0]), ['contracts']);
  for (const p of [...generated, ...registered]) {
    assert.ok(excluded.includes(p.split('/')[0]), p);
    assert.equal(current(p, SHARED), true, `현재 규칙에서는 공용 계정이 ${p} 를 읽고 쓸 수 있다`);
    for (const uid of [SHARED, 'person-1', 'someone', null]) assert.equal(proposed(p, uid, excluded), false, `${p} / ${uid}`);
  }
});

test('카드의 기존 파일 경로는 그대로 허용된다', () => {
  const excluded = parseProposed();
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const templates = [...html.matchAll(/`(users\/\$\{(?:ST\.getUid\(\)|uid)\}\/[^`]+)`/g)].map((m) => m[1]);
  assert.ok(templates.length >= 3, '서류함·발송자료 경로를 찾아야 한다');
  for (const t of templates) assert.ok(/\/(customers|mailCommonAssets)\//.test(t), t);
  // 카드가 파일을 올리는 곳은 서류함 2곳·발송자료 1곳이고, 모두 바로 윗줄에서 users/ 경로를 만든다.
  const uploads = html.split('\n').map((l, i, all) => (l.includes('ST.uploadFile(file, path') ? all[i - 1] : null)).filter(Boolean);
  assert.equal(uploads.length, 3);
  for (const before of uploads) assert.match(before, /const path = `users\//);
  const samples = [
    `users/${SHARED}/customers/co_1/documents/d1/사업자등록증.pdf`,
    `users/${SHARED}/mailCommonAssets/firstMeeting/a1/소개자료.pdf`,
    `users/${SHARED}/customers/co_1/documents/d1/contracts.pdf`,
    `users/${SHARED}/customers/contracts/documents/d1/계약서.pdf`,
    'legacy/기존파일.pdf',
  ];
  for (const p of samples) {
    assert.equal(current(p, SHARED), true, p);
    assert.equal(proposed(p, SHARED, excluded), true, p);
    for (const uid of ['someone', null]) {
      assert.equal(current(p, uid), false);
      assert.equal(proposed(p, uid, excluded), false);
    }
  }
});

test('전후 비교: 달라지는 것은 계약 경로와 버킷 최상위 목록뿐이다', () => {
  const excluded = parseProposed();
  const cases = [
    ['contracts/co_1/v1/mou.pdf', SHARED, true, false],
    ['contracts', SHARED, true, false],
    ['contractAssets/templates/mou/2026-11.pdf', SHARED, true, false],
    ['contractAssets/seal/abc.png', SHARED, true, false],
    ['contractsX/a.pdf', SHARED, true, true],
    ['contract/a.pdf', SHARED, true, true],
    ['Contracts/a.pdf', SHARED, true, true],
    ['', SHARED, true, false], // 버킷 최상위 목록 조회
    ['contracts/co_1/v1/mou.pdf', 'person-1', false, false],
    ['contracts/co_1/v1/mou.pdf', null, false, false],
    ['users/x/a.pdf', 'person-1', false, false],
  ];
  for (const [p, uid, before, after] of cases) {
    assert.equal(current(p, uid), before, `현재 ${p} ${uid}`);
    assert.equal(proposed(p, uid, excluded), after, `제안 ${p} ${uid}`);
  }
});

test('카드는 목록 조회를 쓰지 않아 최상위 목록 차단의 영향이 없다', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const imports = html.slice(html.indexOf('const { getStorage'), html.indexOf('firebase-storage.js'));
  assert.ok(imports.includes('getDownloadURL'));
  assert.equal(/listAll|\blist\b/.test(imports), false);
  assert.equal(/\blistAll\(/.test(html), false);
});

test('서버 저장에 공개 다운로드 토큰을 넣지 않는다', () => {
  for (const file of ['../src/firebaseAdapters.js', '../scripts/register-template.cjs']) {
    assert.equal(/firebaseStorageDownloadTokens|makePublic|predefinedAcl|getSignedUrl/.test(fs.readFileSync(path.join(__dirname, file), 'utf8')), false, file);
  }
});
