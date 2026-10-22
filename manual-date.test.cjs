// §달력 수기 입력 — 글자로 적은 날짜를 YYYY-MM-DD로 바꾸는 규칙(index.html 실제 코드)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const i=html.indexOf('  function parseManualDate('),j=html.indexOf('  window.SHIN2_PARSE_MANUAL_DATE',i);
assert.ok(i>0&&j>i);
const ctx={Date,String};vm.runInNewContext(html.slice(i,j)+';this.p=parseManualDate;',ctx);
test('여러 표기를 YYYY-MM-DD로',()=>{
  for(const s of ['2026-03-02','2026.3.2','2026/03/02','26.03.02','26.3.2','20260302','260302','2026년 3월 2일',' 2026. 3. 2. '])
    assert.equal(ctx.p(s),'2026-03-02',s);
});
test('빈칸은 지우기(빈 값)',()=>{ assert.equal(ctx.p(''),''); assert.equal(ctx.p('  '),''); });
test('없는 날짜·이상한 글자는 반영하지 않음(null)',()=>{
  for(const s of ['2026-02-30','2026-13-01','abc','2026-3','12345','2026.03.02.05']) assert.equal(ctx.p(s),null,s);
});
test('모든 날짜칸에 자동 적용(새로 그려지는 칸 포함)',()=>{
  assert.match(html,/new MutationObserver\(list=> list\.forEach\(m=> m\.addedNodes\.forEach\(scan\)\)\)/);
  assert.match(html,/el\.dispatchEvent\(new Event\('change', \{ bubbles:true \}\)\)/);
});
