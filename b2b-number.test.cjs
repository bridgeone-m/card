// §B2B 전용번호 — 일괄 적용 계획(buildB2BAssignPlan)과 협력사 엑셀 번호 비교(resolvePartnerExcelCode)를 index.html의 실제 코드로 검사(가짜 업체만 사용)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function slice(startMark,endMark){const a=html.indexOf(startMark),b=html.indexOf(endMark,a);assert.ok(a>0&&b>a,startMark);return html.slice(a,b);}
const ctx=vm.createContext({});
vm.runInContext(slice('  function buildB2BAssignPlan(','  // §B2B 전용번호 일괄 적용(관리자 전용')+slice('  function resolvePartnerExcelCode(','  // previewPartnerExcelImport:')+';this.plan=buildB2BAssignPlan;this.resolve=resolvePartnerExcelCode;',ctx);
const J=v=>JSON.parse(JSON.stringify(v));
const base=()=>[
  {id:'a',name:'가업체',code:'B2B353',masterCode:''},
  {id:'b',name:'나업체',code:'',masterCode:'25054',sales:[1,2]},
  {id:'c',name:'다업체',code:'26003',masterCode:''},
  {id:'d',name:'[삭제]라업체',code:'B2B372',deletedAt:'2026-10-01'},
];

test('정상 계획: code만 바뀌고, 옛 코드는 legacyCode로, masterCode·다른 필드·삭제 업체는 그대로',()=>{
  const before=base();
  const r=ctx.plan(before,[{id:'a',code:'B2B353'},{id:'b',code:'B2B201'},{id:'c',code:'B2B392'}]);
  assert.equal(r.ok,true,r.errors.join());
  assert.equal(r.changes.length,2);
  const after=J(r.after);
  assert.equal(after[1].code,'B2B201');assert.equal(after[1].masterCode,'25054');assert.deepEqual(after[1].sales,[1,2]);
  assert.equal(after[2].code,'B2B392');assert.equal(after[2].legacyCode,'26003');
  assert.deepEqual(after[3],J(before[3]));
  assert.equal(before[1].code,'',  '원본 배열은 바꾸지 않는다');
  assert.equal(r.maxSeq,392);
});

test('삭제 업체 번호 재사용·중복 배정·빠진 업체·기존 번호 변경은 모두 거부',()=>{
  assert.match(ctx.plan(base(),[{id:'a',code:'B2B353'},{id:'b',code:'B2B372'},{id:'c',code:'B2B392'}]).errors.join(),/B2B372는 이미 \[삭제\]/);
  assert.match(ctx.plan(base(),[{id:'a',code:'B2B353'},{id:'b',code:'B2B400'},{id:'c',code:'B2B400'}]).errors.join(),/두 업체에 배정/);
  assert.match(ctx.plan(base(),[{id:'a',code:'B2B353'},{id:'b',code:'B2B400'}]).errors.join(),/빠진 업체: 다업체/);
  assert.match(ctx.plan(base(),[{id:'a',code:'B2B354'},{id:'b',code:'B2B400'},{id:'c',code:'B2B401'}]).errors.join(),/이미 B2B353/);
  assert.match(ctx.plan(base(),[{id:'a',code:'B2B353'},{id:'b',code:'B2B400'},{id:'c',code:'B2B401'},{id:'d',code:'B2B402'}]).errors.join(),/삭제된 업체/);
  const bad=ctx.plan(base(),[{id:'a',code:'B2B353'},{id:'b',code:'25054'},{id:'c',code:'B2B401'}]);
  assert.equal(bad.ok,false);assert.equal(bad.changes.length,0,'오류가 있으면 아무것도 바꾸지 않는다');
});

test('같은 계획을 두 번 적용해도 결과가 같다(멱등)',()=>{
  const as=[{id:'a',code:'B2B353'},{id:'b',code:'B2B201'},{id:'c',code:'B2B392'}];
  const once=ctx.plan(base(),as).after;const twice=ctx.plan(once,as);
  assert.equal(twice.ok,true);assert.equal(twice.changes.length,0);
  assert.equal(J(twice.after)[2].legacyCode,'26003');
});

test('협력사 엑셀: 옛 코드는 비교에서 빠져 충돌이 나지 않고, 옛 코드를 code로 복사하지 않는다',()=>{
  const idx=new Map();
  assert.equal(ctx.resolve({id:'x',code:'B2B201',masterCode:'25054'},'',idx).status,'keep');
  assert.equal(ctx.resolve({id:'x',code:'',masterCode:'25054'},'',idx).status,'issueNew');
  assert.equal(ctx.resolve({id:'x',code:'',masterCode:''},'25054',idx).status,'issueNew');
  assert.equal(ctx.resolve({id:'x',code:'',masterCode:''},'B2B201',idx).status,'copyExcel');
  assert.equal(ctx.resolve({id:'x',code:'B2B201',masterCode:''},'B2B202',idx).status,'conflict');
});
