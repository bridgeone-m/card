'use strict';
// 운영자 스크립트를 Firebase CLI 로그인 자격으로 실행한다. 서비스 계정 키를 새로 만들지 않기 위한 도구다.
// 임시 자격 파일은 실행 중에만 있고 끝나면 지운다. 값은 출력하지 않는다.
//   FIREBASE_TOOLS_DIR=<firebase-tools 가 설치된 폴더> CRED_TMP_DIR=<임시 폴더> node with-cli-credentials.cjs <스크립트> [인자...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const toolsDir = process.env.FIREBASE_TOOLS_DIR;
if (!toolsDir) throw new Error('FIREBASE_TOOLS_DIR 이 필요합니다.');
const tools = (p) => require(path.join(toolsDir, 'node_modules/firebase-tools/lib', p));
const account = tools('auth').getGlobalDefaultAccount();
if (!account || !account.tokens || !account.tokens.refresh_token) throw new Error('Firebase CLI 로그인이 필요합니다.');
const api = tools('api');

const tmp = path.join(process.env.CRED_TMP_DIR || os.tmpdir(), `cli-cred-${crypto.randomBytes(8).toString('hex')}.json`);
let code = 1;
try {
  fs.writeFileSync(tmp, JSON.stringify({
    type: 'authorized_user', client_id: api.clientId(), client_secret: api.clientSecret(),
    refresh_token: account.tokens.refresh_token, quota_project_id: 'pour-dashboard',
  }), { mode: 0o600 });
  const [script, ...args] = process.argv.slice(2);
  const res = spawnSync(process.execPath, [script, ...args], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { GOOGLE_APPLICATION_CREDENTIALS: tmp, GOOGLE_CLOUD_PROJECT: 'pour-dashboard', GCLOUD_PROJECT: 'pour-dashboard' }),
  });
  code = res.status === null ? 1 : res.status;
} finally {
  fs.rmSync(tmp, { force: true });
}
process.exit(code);
