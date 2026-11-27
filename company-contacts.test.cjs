const test = require('node:test');
const assert = require('node:assert');
const C = require('./company-contacts.js');

// 폼을 열고(before) → 사용자가 고치고(edit) → 바뀐 필드만 저장하는 흐름
function save(co, edit) {
  const before = C.toFields(C.toModel(co), co);
  const model = C.toModel(co);
  if (edit) edit(model);
  return C.changedFields(before, C.toFields(model, co));
}
const legacy = { repName: '김대표', contactName: '박담당', position: '이사', mobile: '010-1', extraContacts: [{ name: 'A', position: '전무', keep: 1 }] };

test('아무것도 안 고치면 저장할 담당자 필드가 없다', () => {
  for (const co of [legacy, { repName: '이대표', position: '대표' }, { contactName: '최', position: '부장' }, { repName: '같', contactName: '같', position: '대표' }, {}])
    assert.deepStrictEqual(save(co), {});
});

test('담당자 추가·수정·삭제는 extraContacts 만 바꾸고 알 수 없는 속성을 남긴다', () => {
  const added = save(legacy, m => m.extras.push({ name: 'B', position: '경리' }));
  assert.deepStrictEqual(Object.keys(added), ['extraContacts']);
  const edited = save(legacy, m => { m.extras[0].mobile = '010-2'; });
  assert.deepStrictEqual(Object.keys(edited), ['extraContacts']);
  assert.strictEqual(edited.extraContacts[0].keep, 1);
  assert.deepStrictEqual(save(legacy, m => { m.extras = []; }), { extraContacts: [] });
});

test('대표 직급은 담당자 직급(position)을 덮지 않는다', () => {
  assert.deepStrictEqual(save(legacy, m => { m.main.rank = '대표'; }), { repPosition: '대표' });
});

test('기존 담당자를 지우면 그 담당자 직급이 대표 직급으로 넘어가지 않는다', () => {
  const out = save(legacy, m => { m.primary = null; m.primaryRemoved = true; });
  assert.strictEqual(out.contactName, '');
  assert.strictEqual(out.position, '');
  assert.ok(!('repName' in out));
});

test('대표 없이 이사만 등록해도 대표자·대표 직급은 비어 있다', () => {
  const out = C.toFields({ main: { rank: '' }, primary: null, extras: [{ name: '한', position: '이사' }] }, {});
  assert.strictEqual(out.repName, '');
  assert.strictEqual(out.position, '');
});

test('이름 없는 기존 담당자 칸은 저장을 막는다', () => {
  assert.ok(C.validate({ primary: { name: '', position: '이사' } }));
  assert.strictEqual(C.validate({ primary: { name: '', position: '' } }), '');
});

test('이전 상호 필드는 읽지도 쓰지도 않는다', () => {
  assert.ok(!('formerNames' in C.toFields(C.toModel({ formerNames: ['옛'] }), { formerNames: ['옛'] })));
});
