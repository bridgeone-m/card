'use strict';
// 모두사인 웹훅을 등록한다. API 키·비밀 헤더는 Secret Manager 에서 읽어 메모리에서만 쓰며 출력하지 않는다.
// 같은 URL 의 웹훅이 이미 있으면 새로 만들지 않는다. 등록 후 배포된 함수가 비밀 헤더를 받아들이는지 자체 점검한다.
//   FIREBASE_BIN=<firebase 실행 파일> node functions/scripts/register-webhook.cjs [--check-only]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = process.env.FIREBASE_BIN || 'firebase';
const PROJECT = 'pour-dashboard';
const API = 'https://api.modusign.co.kr';
const FUNCTION_URL = 'https://asia-northeast3-pour-dashboard.cloudfunctions.net/contractApi/modusign-webhook';
const HEADER = 'x-card-webhook-token';
const EVENTS = ['document_started', 'document_signed', 'document_all_signed', 'document_rejected', 'document_request_canceled', 'document_signing_canceled'];

function secret(name) {
  const res = spawnSync(`"${BIN}"`, ['functions:secrets:access', name, '--project', PROJECT], { encoding: 'utf8', shell: true });
  // Windows 에서 CLI 가 값을 출력한 뒤 종료 단계에서 libuv 오류로 끝나는 경우가 있다. 값이 출력됐으면 그대로 쓴다.
  const exitCrash = /UV_HANDLE_CLOSING/.test(res.stderr || '') && (res.stdout || '').trim();
  if (res.status !== 0 && !exitCrash) throw new Error(`${name} 을 읽지 못했습니다(종료 코드 ${res.status}).`);
  return res.stdout.replace(/\r?\n$/, '');
}
function apiEmail() {
  const text = fs.readFileSync(path.join(__dirname, '../.env.pour-dashboard'), 'utf8');
  const hit = text.match(/^MODUSIGN_API_EMAIL=(.+)$/m);
  if (!hit) throw new Error('MODUSIGN_API_EMAIL 이 없습니다.');
  return hit[1].trim();
}
// 오류 응답은 상태·코드만 남긴다. 본문 전체를 출력하지 않는다.
async function call(auth, method, route, body) {
  const res = await fetch(API + route, {
    method,
    headers: Object.assign({ authorization: auth, accept: 'application/json' }, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* 본문 형식 불명 */ }
  return { status: res.status, json };
}
const summary = (r) => ({ status: r.status, code: r.json && r.json.code, title: r.json && r.json.title, reason: r.json && r.json.data && r.json.data.reason, features: r.json && r.json.data && r.json.data.features });

(async () => {
  const checkOnly = process.argv.includes('--check-only');
  const auth = 'Basic ' + Buffer.from(`${apiEmail()}:${secret('MODUSIGN_API_KEY')}`).toString('base64');
  const token = secret('MODUSIGN_WEBHOOK_TOKEN');

  const list = await call(auth, 'GET', '/webhooks');
  console.log('API 키 확인(웹훅 목록 조회):', JSON.stringify(summary(list)));
  if (list.status !== 200) { process.exitCode = 1; return; }
  const rows = (list.json && (list.json.webhooks || list.json.items || (Array.isArray(list.json) ? list.json : []))) || [];
  console.log('기존 웹훅 수:', rows.length);
  // 다른 연동의 웹훅은 이름과 도메인만 보여 주고 건드리지 않는다.
  rows.forEach((w) => { let host = ''; try { host = new URL(w.url).host; } catch (_) { host = '(주소 형식 불명)'; } console.log('  -', w.name, host); });
  let hook = rows.find((w) => w.url === FUNCTION_URL);

  if (!hook && !checkOnly) {
    const made = await call(auth, 'POST', '/webhooks', { name: 'card-contract', url: FUNCTION_URL, events: EVENTS, headers: [{ key: HEADER, value: token }] });
    console.log('웹훅 등록:', JSON.stringify(summary(made)));
    if (made.status !== 201 && made.status !== 200) { process.exitCode = 1; return; }
    hook = made.json;
  }
  if (hook) console.log('웹훅:', JSON.stringify({ id: hook.id, url: hook.url, events: hook.events, enabled: hook.enabled, headerKeys: (hook.headers || []).map((h) => h.key) }));

  // 없는 문서 ID 로 자체 점검: 비밀 헤더가 맞으면 200(무시), 아무 데이터도 쓰지 않는다.
  const probe = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [HEADER]: token, 'modusign-delivery-id': `self-check-${Date.now()}` },
    body: JSON.stringify({ event: { type: 'document_signed' }, document: { id: 'self-check-no-such-document' } }),
  });
  console.log('함수 비밀 헤더 점검:', probe.status, await probe.text());
})().catch((err) => { console.error('중단:', err.message); process.exit(1); });
