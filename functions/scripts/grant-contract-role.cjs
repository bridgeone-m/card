'use strict';
// 개인 담당자 계정에 계약서 권한을 주거나 회수한다(운영자 PC에서 실행, 아직 실행 전).
// 권한은 Firebase custom claim 이라 Admin SDK 로만 바꿀 수 있고, 브라우저에서 바꿀 수 없다.
//   node grant-contract-role.cjs grant  담당자@회사.kr sender   (발송·재시도·문서 열람)
//   node grant-contract-role.cjs grant  담당자@회사.kr viewer   (문서 열람만)
//   node grant-contract-role.cjs revoke 담당자@회사.kr
// 회수하면 토큰도 무효화된다. 공용 계정에는 줄 수 없다. 인증: GOOGLE_APPLICATION_CREDENTIALS.
const admin = require('firebase-admin');

const SHARED_EMAIL = 'hansol2-owner@pour-dashboard.firebaseapp.com';

async function main() {
  const [action, email, role] = process.argv.slice(2);
  if (!['grant', 'revoke'].includes(action) || !email) throw new Error('사용법: grant-contract-role.cjs grant|revoke <email> [sender|viewer]');
  if (email.toLowerCase() === SHARED_EMAIL) throw new Error('공용 계정에는 권한을 줄 수 없습니다.');
  admin.initializeApp();
  const user = await admin.auth().getUserByEmail(email);
  const claims = Object.assign({}, user.customClaims);
  delete claims.contractSender;
  delete claims.contractViewer;
  if (action === 'grant') {
    if (role === 'sender') claims.contractSender = true;
    else if (role === 'viewer') claims.contractViewer = true;
    else throw new Error('역할은 sender 또는 viewer 입니다.');
    if (!user.emailVerified) throw new Error('이메일이 확인된 계정에만 권한을 줄 수 있습니다.');
  }
  await admin.auth().setCustomUserClaims(user.uid, claims);
  await admin.auth().revokeRefreshTokens(user.uid);
  console.log(action === 'grant' ? `권한 부여: ${role}` : '권한 회수', user.uid);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
