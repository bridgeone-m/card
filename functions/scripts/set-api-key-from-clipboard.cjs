'use strict';
// 클립보드의 모두사인 API 키를 확인한 뒤 Secret Manager 에 저장한다(Windows).
// 가려진 입력창에 붙여넣다 값이 달라지는 문제를 피하려는 도구다. 값은 화면·파일·로그에 남지 않는다.
// 저장 전에 모두사인 인증을 조회로 시험하고, 200 일 때만 저장한다. 끝나면 클립보드를 비운다.
//   FIREBASE_BIN=<firebase 실행 파일> node set-api-key-from-clipboard.cjs
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const BIN = process.env.FIREBASE_BIN || 'firebase';
const ps = (command) => spawnSync('powershell', ['-NoProfile', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`], { encoding: 'utf8' });

async function waitEnter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question('모두사인 API 키를 복사한 뒤 Enter 를 누르세요(붙여넣지 마세요): ', () => { rl.close(); resolve(); }));
}

(async () => {
  await waitEnter();
  const key = String(ps('Get-Clipboard -Raw').stdout || '').trim();
  const email = fs.readFileSync(path.join(__dirname, '../.env.pour-dashboard'), 'utf8').match(/^MODUSIGN_API_EMAIL=(.+)$/m)[1].trim();
  if (!key || /\s/.test(key) || /[^\x21-\x7e]/.test(key)) {
    console.log(`클립보드 값이 API 키 형태가 아닙니다(길이 ${key.length}). 키만 다시 복사해 주세요. 저장하지 않았습니다.`);
    process.exit(1);
  }
  const res = await fetch('https://api.modusign.co.kr/webhooks?limit=1', {
    headers: { authorization: 'Basic ' + Buffer.from(`${email}:${key}`).toString('base64'), accept: 'application/json' },
  });
  await res.text();
  console.log(`인증 시험: ${res.status} (키 길이 ${key.length})`);
  if (res.status !== 200) {
    console.log('인증이 되지 않아 저장하지 않았습니다.');
    process.exit(1);
  }
  const saved = spawnSync(`"${BIN}"`, ['functions:secrets:set', 'MODUSIGN_API_KEY', '--data-file', '-', '--force', '--project', 'pour-dashboard'], { input: key, encoding: 'utf8', shell: true });
  ps('Set-Clipboard -Value " "');
  if (saved.status !== 0) {
    console.log(`저장 실패(종료 코드 ${saved.status}). 클립보드는 비웠습니다.`);
    process.exit(1);
  }
  console.log('저장 완료. 클립보드는 비웠습니다. 이 창은 닫아도 됩니다.');
})().catch((err) => { console.log('중단:', err.message); process.exit(1); });
