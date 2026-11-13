// §협약 보류(2026-11) — 보류 판정·문구·기존 '허들·보류' 연결
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const s=html.indexOf('  /* §협약 보류(2026-11) — 1·2차 미팅 뒤'), e=html.indexOf('  // §협력업체 리스트 등재 기준 재정정 라운드', s);
assert.ok(s>0&&e>s,'보류 블록을 찾지 못함');
const f0=html.indexOf('  function fmtDate(iso){'), f1=html.indexOf('  function fmtTime(iso){', f0);
function load(nm){
  const ctx={Date,String,resolveNewMouForCompany:()=>nm||null};
  vm.runInNewContext(html.slice(f0,f1)+html.slice(s,e)+'\nthis.api={getDealHold,dealHoldSummaryText,isHurdleCompany,dealHoldAfterLabel,getDealDeclined,dealDeclinedSummaryText};',ctx);
  return ctx.api;
}
const A=load();
test('보류 중(active)일 때만 보류로 봄',()=>{
  assert.equal(A.getDealHold({}),null);
  assert.equal(A.getDealHold({dealHold:{active:false,reason:'x'}}),null);
  assert.equal(A.getDealHold({dealHold:{active:true,afterStage:'m2',reason:'예산'}}).reason,'예산');
});
test('문구: 몇 차 미팅 후 · 날짜 · 사유',()=>{
  const at=new Date(2026,10,13,10).toISOString();
  assert.equal(A.dealHoldSummaryText({afterStage:'m2',at,reason:'예산 확정 대기'}),'2차미팅 후 보류 · 2026.11.13 · 예산 확정 대기');
  assert.equal(A.dealHoldSummaryText({afterStage:'m1',at,reason:''}),'1차미팅 후 보류 · 2026.11.13');
});
test('기존 허들(동기화 값) 또는 카드 보류 중 하나라도 있으면 허들·보류',()=>{
  assert.equal(A.isHurdleCompany({}),false);
  assert.equal(A.isHurdleCompany({dealHold:{active:true}}),true);
  assert.equal(A.isHurdleCompany({dealHold:{active:false}}),false);
  assert.equal(load({hurdle:true}).isHurdleCompany({}),true);
});
test('업무관리: 보류 업체는 지연 업무 대신 보류 중으로',()=>{
  assert.match(html,/if\(dealHold\) return \{\s*co, type: 'none'[\s\S]{0,200}actionLabel: '보류 중'/);
});
test('협약 진행 탭: 카드 보류 업체는 남기고 동기화 허들만 뺌',()=>{
  assert.match(html,/key === 'agreementInProgress'\)\{[\s\S]{0,400}!isSyncHurdleCompany\(co\)/);
  const B=load({hurdle:true});
  assert.equal(B.isHurdleCompany({}),true);
});

test('미진행: 문구와 판정, 미진행이면 허들·보류에서 빠짐',()=>{
  const at=new Date(2026,10,13,10).toISOString();
  assert.equal(A.getDealDeclined({dealDeclined:{active:false}}),null);
  assert.equal(A.dealDeclinedSummaryText({afterStage:'m1',at,reason:'단가 부담'}),'1차미팅 후 미진행(체결 안 함) · 2026.11.13 · 단가 부담');
  assert.equal(A.isHurdleCompany({dealHold:{active:true},dealDeclined:{active:true}}),false);
});
test('목록 단계 배지·필터·의지박약 연결',()=>{
  for(const s of [
    "if(key !== 'mou' && key !== 'terminated'){",
    "const st = dealStatusBadgeDef(co);",
    "if(key === 'dealDeclined') return !!getDealDeclined(co)",
    "if(getDealHold(r.co) || getDealDeclined(r.co)) return;",
    "!isSyncHurdleCompany(co) && !D.isAgreementTerminated(co) && !getDealDeclined(co)",
    "none:       { label:'시작 전',",   // 진행 이력 없음 배지는 '미진행'과 다른 단어
  ]) assert.ok(html.includes(s), s);
});
