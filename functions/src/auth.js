'use strict';
// 권한은 2단계다.
//  1) 공용 로그인(카드 접속): 업체 확인·PDF 생성·미리보기만 가능하다.
//  2) 개인 발송 담당자: 공용 계정과 별개인 개인 Firebase 계정 + 서버에서만 부여하는 custom claim.
// 관리자 모드는 브라우저 설정이므로 권한 근거로 쓰지 않는다.
const { AppError } = require('./errors');

// 개인 로그인은 기기에 유지한다. 오래된 로그인만 다시 받는다(권한 회수 시 토큰 무효화로 즉시 차단).
const SENDER_REAUTH_SECONDS = 30 * 24 * 60 * 60;

function createAuth({ verifyIdToken, sharedUid, now }) {
  async function verify(token, label) {
    if (!token) throw new AppError(401, 'AUTH_REQUIRED', `${label} 로그인이 필요합니다.`);
    try { return await verifyIdToken(token); }
    catch (_) { throw new AppError(401, 'AUTH_INVALID', `${label} 로그인이 만료됐습니다. 다시 로그인해주세요.`); }
  }
  async function requireShared(headers) {
    const raw = String(headers.authorization || '');
    const claims = await verify(raw.startsWith('Bearer ') ? raw.slice(7) : '', '고객관리카드');
    if (!sharedUid || claims.uid !== sharedUid) throw new AppError(403, 'NOT_CARD_USER', '고객관리카드 계정이 아닙니다.');
    return claims;
  }
  function assertPersonal(claims) {
    if (claims.uid === sharedUid) throw new AppError(403, 'SHARED_ACCOUNT_NOT_ALLOWED', '공용 계정으로는 이 작업을 할 수 없습니다.');
    if (claims.email_verified !== true) throw new AppError(403, 'EMAIL_NOT_VERIFIED', '확인된 이메일의 개인 계정만 사용할 수 있습니다.');
  }
  // 발송·재시도: 공용 로그인 + 개인 발송 권한 + 최근 30일 내 비밀번호 입력.
  async function requireSender(headers) {
    await requireShared(headers);
    return requirePersonalSender(headers);
  }
  // 우리 측 시험 발송(카드 밖 서버 직접 요청): 카드 데이터를 쓰지 않으므로 공용 로그인 없이 개인 발송 권한만 본다.
  async function requirePersonalSender(headers) {
    const claims = await verify(headers['x-contract-sender-token'], '발송 담당자');
    assertPersonal(claims);
    if (claims.contractSender !== true) throw new AppError(403, 'SENDER_NOT_ALLOWED', '이 계정에는 계약서 발송 권한이 없습니다.');
    if (now() / 1000 - Number(claims.auth_time || 0) > SENDER_REAUTH_SECONDS) throw new AppError(401, 'SENDER_REAUTH_REQUIRED', '발송 담당자 비밀번호를 다시 입력해주세요.');
    return { uid: claims.uid, email: claims.email || '', name: claims.name || '' };
  }
  // 서명 문서 열람: 공용 로그인 + 개인 열람 또는 발송 권한.
  async function requireViewer(headers) {
    await requireShared(headers);
    const claims = await verify(headers['x-contract-sender-token'], '문서 열람 담당자');
    assertPersonal(claims);
    if (claims.contractSender !== true && claims.contractViewer !== true) throw new AppError(403, 'VIEWER_NOT_ALLOWED', '이 계정에는 서명 문서 열람 권한이 없습니다.');
    return { uid: claims.uid, email: claims.email || '', name: claims.name || '' };
  }
  return { requireShared, requireSender, requirePersonalSender, requireViewer };
}

module.exports = { createAuth, SENDER_REAUTH_SECONDS };
