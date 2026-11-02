'use strict';
// 모두사인 작업공간의 웹훅 설정을 읽기 전용으로 보여 준다(조회만, 생성·수정·삭제 없음).
// 다른 연동의 주소 경로와 헤더 값은 비밀일 수 있어 도메인·경로 길이·헤더 이름만 출력한다.
//   FIREBASE_BIN=<firebase 실행 파일> node functions/scripts/inspect-webhooks.cjs
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = process.env.FIREBASE_BIN || 'firebase';
const API = 'https://api.modusign.co.kr';

function apiKey() {
  const res = spawnSync(`"${BIN}"`, ['functions:secrets:access', 'MODUSIGN_API_KEY', '--project', 'pour-dashboard'], { encoding: 'utf8', shell: true });
  const exitCrash = /UV_HANDLE_CLOSING/.test(res.stderr || '') && (res.stdout || '').trim();
  if (res.status !== 0 && !exitCrash) throw new Error(`API 키를 읽지 못했습니다(종료 코드 ${res.status}).`);
  return res.stdout.replace(/\r?\n$/, '');
}

function redact(hook) {
  const out = {};
  for (const [key, value] of Object.entries(hook)) {
    if (key === 'url') {
      let u = null;
      try { u = new URL(value); } catch (_) { /* 형식 불명 */ }
      out.url = u ? { host: u.host, pathLength: u.pathname.length, hasQuery: Boolean(u.search) } : '(형식 불명)';
    } else if (key === 'headers') {
      out.headerKeys = (value || []).map((h) => h.key);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = `(객체: ${Object.keys(value).join(', ')})`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

(async () => {
  const email = fs.readFileSync(path.join(__dirname, '../.env.pour-dashboard'), 'utf8').match(/^MODUSIGN_API_EMAIL=(.+)$/m)[1].trim();
  const auth = 'Basic ' + Buffer.from(`${email}:${apiKey()}`).toString('base64');
  const get = async (route) => {
    const res = await fetch(API + route, { headers: { authorization: auth, accept: 'application/json' } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* 본문 형식 불명 */ }
    return { status: res.status, json };
  };
  const list = await get('/webhooks');
  console.log('목록 조회:', list.status, '최상위 키:', list.json ? Object.keys(list.json).join(', ') : '-');
  const rows = (list.json && (list.json.webhooks || list.json.items || (Array.isArray(list.json) ? list.json : []))) || [];
  for (const row of rows) {
    const detail = await get(`/webhooks/${encodeURIComponent(row.id)}`);
    console.log(JSON.stringify({ detailStatus: detail.status, ...redact(detail.status === 200 && detail.json ? detail.json : row) }, null, 1));
  }
})().catch((err) => { console.error('중단:', err.message); process.exit(1); });
