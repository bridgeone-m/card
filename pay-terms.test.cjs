// §거래 방식(2026-11-17, 11-18 선급→선납) — 협약진행 탭 선납·보증보험 체크(둘 중 하나, 다시 누르면 해제)
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const s = html.indexOf("  const PAY_TERMS = { prepay:'선납', guarantee:'보증보험' };"), e = html.indexOf('  function agrPayTermsHtml(co){', s);
assert.ok(s > 0 && e > s, '거래 방식 블록을 찾지 못함');
const ctx = {}; vm.runInNewContext(html.slice(s, e) + '\nthis.api = { getPayTerms, payTermsLabel };', ctx);
const A = ctx.api;

test('선납·보증보험만 인정, 해제(빈 값)는 없음으로', () => {
  assert.equal(A.payTermsLabel({ payTerms: { type: 'prepay' } }), '선납');
  assert.equal(A.payTermsLabel({ payTerms: { type: 'guarantee' } }), '보증보험');
  assert.equal(A.getPayTerms({ payTerms: { type: '' } }), null);
  assert.equal(A.getPayTerms({ payTerms: { type: 'x' } }), null);
  assert.equal(A.getPayTerms({}), null);
});
test('협약진행 탭에 체크란 표시, 고르기만 하고 [저장]을 눌러야 저장, 같은 걸 다시 누르면 고른 것 해제, 이력 남김', () => {
  for (const t of [
    "${agrPayTermsHtml(co)}\n      ${agrDealHoldHtml(co)}".replace(/\n/g, html.includes('\r\n') ? '\r\n' : '\n'),
    'bindAgrPayTerms(body, co);',
    "picked = picked === k ? '' : k;",
    "data-agr-pay-save disabled>저장</button>",
    "if(picked === saved()) return;",
    "payTerms: { type: type || '', at, by }, payTermsLog: log",
    'aria-pressed=',
  ]) assert.ok(html.includes(t), t);
});
