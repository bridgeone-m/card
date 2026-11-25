'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contractTermOf } = require('../src/term');

test('기한: 계약일 1년 뒤 같은 날', () => {
  assert.equal(contractTermOf('2026-11-24').until, '2027-11-24');
  assert.equal(contractTermOf('2026-11-24').from, '2026-11-24');
  assert.match(contractTermOf('2026-11-24').clause, /제20조/);
});
test('기한: 윤일(2028-02-29)은 다음 해 2/28', () => {
  assert.equal(contractTermOf('2028-02-29').until, '2029-02-28');
});
test('기한: 잘못된 날짜는 null', () => {
  for (const x of ['', null, '2026/11/24', '26-11-24']) assert.equal(contractTermOf(x), null);
});
