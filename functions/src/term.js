'use strict';
// 기본물품공급계약서 제20조(계약기간): 유효기간은 체결일로부터 1년(만료 30일 전까지 종료 의사가 없으면 1년씩 자동 연장).
// 뒷장 계약일(YYYY-MM-DD)의 1년 뒤 같은 날을 기한으로 본다(2/29 → 다음 해 2/28).
function contractTermOf(contractDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(contractDate || ''));
  if (!m) return null;
  const y = +m[1] + 1;
  const last = new Date(Date.UTC(y, +m[2], 0)).getUTCDate();
  return { from: contractDate, until: `${y}-${m[2]}-${String(Math.min(+m[3], last)).padStart(2, '0')}`, clause: '제20조 체결일로부터 1년(자동 연장)' };
}
module.exports = { contractTermOf };
