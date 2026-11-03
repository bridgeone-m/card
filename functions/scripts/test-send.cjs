'use strict';
// 우리 측 시험 발송 도구(카드 화면을 거치지 않는 서버 직접 요청). 카드 업체 데이터는 읽거나 쓰지 않는다.
// 개인 발송 담당자 계정으로 로그인한다. 비밀번호는 화면에 보이지 않게 입력받고 저장하지 않는다.
//
//   node functions/scripts/test-send.cjs prepare --input <시험값.json>      PDF 2종 생성·내려받기(발송 없음)
//   node functions/scripts/test-send.cjs send --version <N>                내려받은 PDF와 서버 지문을 대조한 뒤, 확인 문구를 입력해야 발송
//   node functions/scripts/test-send.cjs status                            시험 발송 기록 조회
//   node functions/scripts/test-send.cjs refresh --send-id <ID>            모두사인 상태 다시 조회
//
// 시험값 JSON(저장소 밖이나 Git 제외 폴더에 둔다):
//   { "contractDate": "2026-11-03", "recipientEmail": "<서버 허용 목록의 우리 측 이메일>",
//     "company": { "name": "...", "bizNo": "...", "representative": "...", "address": "..." } }
// 수신자는 서버의 CONTRACT_TEST_RECIPIENTS 에 있는 이메일만 받는다. 시험 발송은 CONTRACT_TEST_SEND_ENABLED 가 켜져 있어야 한다.
// 모의 서버 확인용: --api http://localhost:5191/api --mock [--mock-login 이메일:비밀번호 --mock-confirm]
//   (--mock-login·--mock-confirm 은 --mock 일 때만 받는다. 운영 서버에서는 항상 직접 입력한다.)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const PROD_API = 'https://asia-northeast3-pour-dashboard.cloudfunctions.net/contractApi';
const CONFIRM_TEXT = '시험 발송';
const ROOT = path.join(__dirname, '../..');

function args() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const key = rest[i].slice(2);
    opts[key] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
  }
  return { command, opts };
}

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (!rl.closed && s.includes(question)) process.stdout.write(question); };
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

// 카드가 쓰는 공개 웹 설정(firebaseConfig.js)의 apiKey 로 Firebase 로그인 REST 를 부른다. 이 값은 비밀이 아니다.
function webApiKey() {
  const text = fs.readFileSync(path.join(ROOT, 'firebaseConfig.js'), 'utf8');
  const hit = text.match(/apiKey\s*:\s*['"]([^'"]+)['"]/);
  if (!hit) throw new Error('firebaseConfig.js 에서 웹 apiKey 를 찾지 못했습니다.');
  return hit[1];
}

async function login(opts) {
  if (opts.mock && typeof opts['mock-login'] === 'string') {
    const [email, password] = opts['mock-login'].split(':');
    return mockLogin(opts, email, password);
  }
  const email = await ask('발송 담당자 이메일: ');
  const password = await ask('비밀번호(화면에 표시되지 않음): ', true);
  // 가려진 입력은 한글 입력 상태·붙여넣기 문제를 눈으로 알 수 없다. 값은 출력하지 않고 형태만 알려 준다.
  console.log(`입력 확인: 이메일 ${email}, 비밀번호 ${password.length}자${/[^ -~]/.test(password) ? ' (한글 등 영문 외 문자 포함 — 한/영 전환 확인)' : ''}`);
  if (/[^ -~]/.test(password)) throw new Error('비밀번호에 영문 외 문자가 들어갔습니다. 한/영 키를 영문으로 바꾼 뒤 다시 실행해주세요.');
  if (opts.mock) return mockLogin(opts, email, password);
  return firebaseLogin(email, password);
}

async function mockLogin(opts, email, password) {
  const res = await fetch(new URL('/__mock/auth/login', opts.api), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error('모의 로그인 실패');
  return (await res.json()).token;
}

async function firebaseLogin(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webApiKey())}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`로그인 실패: ${(body.error && body.error.message) || res.status}`);
  return body.idToken;
}

function client(api, token) {
  const headers = { 'x-contract-sender-token': token };
  async function call(method, route, { query, body } = {}) {
    const url = new URL(api.replace(/\/$/, '') + route);
    Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = await fetch(url, { method, headers: Object.assign({}, headers, body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    if ((res.headers.get('content-type') || '').startsWith('application/pdf')) {
      return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), sha256: res.headers.get('x-pdf-sha256') };
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = json.error || {};
      const blockers = e.extra && e.extra.blockers ? `\n  막힌 이유: ${e.extra.blockers.map((b) => b.code).join(', ')}` : '';
      const issues = e.extra && e.extra.issues ? `\n  확인할 값: ${e.extra.issues.map((i) => i.message).join(' / ')}` : '';
      throw new Error(`${res.status} ${e.code || ''} ${e.message || ''}${blockers}${issues}`);
    }
    return json;
  }
  return call;
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const outDir = (opts, version) => path.resolve(opts.out || path.join(ROOT, 'contract-assets/test-send'), `v${version}`);

function printSend(s) {
  console.log(`발송 ${s.sendId}  계약일 ${s.contractDate}  수신 ${s.recipientEmail}  처리 ${s.processedBy && s.processedBy.email}`);
  for (const d of Object.values(s.documents)) {
    console.log(`  - ${d.label}: ${d.delivery}${d.modusignStatus ? ` / ${d.modusignStatus}` : ''}${d.counterpartySignedAt ? ` / 상대방 서명 ${d.counterpartySignedAt}` : ''}${d.failure ? ` / ${d.failure.code} ${d.failure.message}` : ''}`);
  }
}

(async () => {
  const { command, opts } = args();
  if (command === 'help' || !['prepare', 'send', 'status', 'refresh'].includes(command)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  opts.api = opts.api || PROD_API;
  console.log(`서버: ${opts.api}`);
  // 발송은 내용 확인 → 확인 문구 → 로그인(비밀번호가 마지막 입력) 순서다. 비밀번호를 확인 칸에 넣는 실수를 막는다.
  let confirmedSend = null;
  if (command === 'send') {
    const v = JSON.parse(fs.readFileSync(path.join(outDir(opts, opts.version), 'version.json'), 'utf8'));
    console.log(`
보낼 문서: ${v.docs.supply.title}, ${v.docs.mou.title}`);
    console.log(`상대방(을) 서명자: ${v.company.representative} <${v.recipientEmail}>  계약일 ${v.contractDate}`);
    console.log('모두사인 문서 2건이 만들어지고 수신자에게 서명 요청 메일이 갑니다.');
    const typed = opts.mock && opts['mock-confirm'] ? CONFIRM_TEXT : await ask(`계속하려면 "${CONFIRM_TEXT}" 를 입력하세요(한글): `);
    if (typed !== CONFIRM_TEXT) { console.log('취소했습니다. 발송하지 않았습니다.'); return; }
    console.log('확인했습니다. 이제 발송 담당자 로그인을 합니다(비밀번호 입력 뒤 바로 발송).');
    confirmedSend = v;
  }
  const call = client(opts.api, await login(opts));

  if (command === 'prepare') {
    if (!opts.input) throw new Error('--input <시험값.json> 이 필요합니다.');
    const input = JSON.parse(fs.readFileSync(path.resolve(opts.input), 'utf8'));
    const v = await call('POST', '/test/prepare', { body: { contractDate: input.contractDate, recipientEmail: input.recipientEmail, company: input.company } });
    const dir = outDir(opts, v.version);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`시험 PDF 버전 ${v.version} 생성(발송 안 함). 수신 ${v.recipientEmail}`);
    for (const type of ['supply', 'mou']) {
      const file = await call('GET', '/test/pdf', { query: { version: v.version, type } });
      if (sha(file.bytes) !== v.docs[type].sha256 || file.sha256 !== v.docs[type].sha256) throw new Error(`${type} PDF 지문이 생성 기록과 다릅니다.`);
      fs.writeFileSync(path.join(dir, `${type}.pdf`), file.bytes);
      console.log(`  - ${v.docs[type].title}  ${path.join(dir, `${type}.pdf`)}  sha256 ${v.docs[type].sha256.slice(0, 12)}`);
    }
    fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(v, null, 1));
    console.log(`PDF를 열어 확인한 뒤 발송하려면: node functions/scripts/test-send.cjs send --version ${v.version}`);
    return;
  }

  if (command === 'send') {
    const dir = outDir(opts, opts.version);
    const v = confirmedSend;
    const hashes = {};
    for (const type of ['supply', 'mou']) {
      const local = sha(fs.readFileSync(path.join(dir, `${type}.pdf`)));
      const remote = await call('GET', '/test/pdf', { query: { version: v.version, type } });
      if (local !== v.docs[type].sha256 || remote.sha256 !== local) throw new Error(`${type}: 확인한 PDF와 서버 PDF가 다릅니다. prepare 부터 다시 하세요.`);
      hashes[type] = local;
    }
    const s = await call('POST', '/test/send', { body: { version: v.version, hashes, recipientEmail: v.recipientEmail, representative: v.company.representative, confirmed: true } });
    printSend(s);
    return;
  }

  if (command === 'status') {
    const { sends } = await call('GET', '/test/sends');
    if (!sends.length) console.log('시험 발송 기록이 없습니다.');
    sends.forEach(printSend);
    return;
  }

  if (command === 'refresh') {
    if (!opts['send-id']) throw new Error('--send-id 가 필요합니다.');
    printSend(await call('POST', '/test/refresh', { body: { sendId: opts['send-id'] } }));
  }
})().catch((err) => { console.error('중단:', err.message); process.exitCode = 1; });
