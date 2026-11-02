'use strict';
// 웹훅 비밀 헤더 값을 무작위로 만들어 Secret Manager 에 바로 넣는다. 값은 화면·파일·로그에 남지 않는다.
// 이미 있으면 덮어쓰지 않는다(등록된 웹훅과 값이 어긋나므로).
//   FIREBASE_BIN=<firebase 실행 파일> node functions/scripts/setup-webhook-token.cjs
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const BIN = process.env.FIREBASE_BIN || 'firebase';
const PROJECT = 'pour-dashboard';
const NAME = 'MODUSIGN_WEBHOOK_TOKEN';
const run = (args, input) => spawnSync(BIN, [...args, '--project', PROJECT], { input, encoding: 'utf8', shell: process.platform === 'win32' });

const existing = run(['functions:secrets:get', NAME]);
if (existing.status === 0 && /Version|ENABLED/.test(existing.stdout)) {
  console.log(`${NAME}: 이미 있어 그대로 둔다.`);
  process.exit(0);
}
const made = run(['functions:secrets:set', NAME, '--data-file', '-', '--force'], crypto.randomBytes(32).toString('hex'));
if (made.status !== 0) {
  console.error(`${NAME}: 등록 실패 (종료 코드 ${made.status})`);
  console.error(String(made.stderr || made.stdout).split('\n').slice(-6).join('\n'));
  process.exit(1);
}
console.log(`${NAME}: 등록 완료(값은 표시하지 않음).`);
