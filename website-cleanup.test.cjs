const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const apiContext={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(__dirname+'/website-cleanup.js','utf8'),apiContext);
const api=apiContext.module.exports;
const actor={uid:'test-auth',label:'사용자 2'}, now='2026-10-12T03:00:00.000Z';
const base=()=>({companies:[{id:'test-co',name:'테스트 협약사',sales:[1],contacts:['보존']}],customerActivities:[{id:'old',activityText:'보존'}],websiteCleanup:[]});
const end={kind:'terminate',id:'end-1',companyId:'test-co',options:{reason:'테스트 종료',endedAt:'2026-10-12',note:'메모'}};
const del={kind:'delete',id:'delete-1',companyId:'test-co',typedName:'테스트 협약사',options:{reason:'테스트 삭제'}};
const apply=(s,c)=>api.apply(s,c,actor,now).state;
test('종료/삭제 성공시 별도 알림과 기존 상태/활동 기록, 무관한 필드 보존',()=>{
  for(const c of [end,del]){const s=apply(base(),c);assert.equal(s.websiteCleanup.length,1);assert.equal(JSON.stringify(s.companies[0].sales),'[1]');assert.equal(s.customerActivities[0].activityText,'보존');assert.equal(s.websiteCleanup[0].companyName,'테스트 협약사');}
});
test('종료 후 삭제, 재시도, 다른 기기 중복 요청도 미완료 1건',()=>{
  let s=apply(base(),end);s=apply(s,{...end,id:'other-device'});s=apply(s,del);s=apply(s,del);
  assert.equal(s.websiteCleanup.length,1);assert.equal(s.websiteCleanup[0].reason,'협약 종료');assert.equal(s.customerActivities.length,3);
});
test('완전 삭제/이름 변경 이후에도 원래 업체명과 체크/완료 이력 보존',()=>{
  let s=apply(base(),end);s.companies=[];s=apply(s,{kind:'check',id:'end-1',field:'requested',value:true});
  s=JSON.parse(JSON.stringify(s));assert.equal(s.websiteCleanup[0].requested,true);assert.equal(s.websiteCleanup[0].companyName,'테스트 협약사');
  assert.throws(()=>apply(s,{kind:'complete',id:'end-1'}));
  s=apply(s,{kind:'check',id:'end-1',field:'verified',value:true});assert.equal(s.websiteCleanup[0].completedAt,null);
  s=apply(s,{kind:'complete',id:'end-1'});assert.equal(s.websiteCleanup[0].completedBy,'사용자 2');assert.equal(s.websiteCleanup[0].completedByUid,'test-auth');assert.equal(s.websiteCleanup[0].completedAt,now);
  assert.equal(apply(s,{kind:'complete',id:'end-1'}).customerActivities.length,s.customerActivities.length);
});
test('기존 종료/삭제 업체 소급 생성 없음, 복구 후 새 종료는 새 건',()=>{
  let s=base();s.companies[0].agreementStatus='terminated';assert.equal(apply(s,end).websiteCleanup.length,0);
  s=apply(base(),end);for(const field of ['requested','verified'])s=apply(s,{kind:'check',id:'end-1',field,value:true});
  s=apply(s,{kind:'complete',id:'end-1'});s.companies[0].agreementStatus=null;s=apply(s,{...end,id:'end-2'});assert.equal(s.websiteCleanup.length,2);
});
test('업체명 재확인 및 잘못된 체크 거절',()=>{
  assert.throws(()=>apply(base(),{...del,typedName:'틀린 이름'}));assert.throws(()=>apply(apply(base(),end),{kind:'check',id:'end-1',field:'completedAt',value:true}));
});
// Execute the ACTUAL Firebase adapter with a transaction-capable fake; never loads Firebase.
function adapter(){
  let state=base(), fail=false;
  const cache=new Map(), events=[];
  const keys={companies:'companies',customerActivities:'activities'};
  const keyName=k=>k==='companies'?'companies':k==='activities'?'customerActivities':'websiteCleanup';
  const window={WebsiteCleanup:api,dispatchEvent:e=>events.push(e)};
  const context={window,db:{},currentUid:'test-auth',localStorage:{getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)},
    SHARED_ARRAY_KEYS:keys,lifecycleSyncLocks:new Set(),sharedPushTimers:{},sharedLocalRevKey:k=>'rev-'+k,SJ:{isEmpty:()=>true,applyJournal:v=>v,emptyJournal:()=>({set:{},del:{}})},loadSyncJournal:()=>({set:{},del:{}}),flushSharedKey:async()=>null,syncLastLocal:{},deepCopy:v=>JSON.parse(JSON.stringify(v)),
    CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}},console,clearTimeout,
    doc:(...args)=>args.at(-1),onSnapshot:()=>()=>{},serverTimestamp:()=>now,
    runTransaction:async(db,fn)=>{const writes={};const out=await fn({get:async key=>({exists:()=>true,data:()=>({value:structuredClone(state[keyName(key)]),localRev:1})}),set:(key,payload)=>writes[keyName(key)]=payload.value});if(fail)throw Error('TEST_WRITE_FAILED');Object.assign(state,writes);return out;}};
  const html=fs.readFileSync(__dirname+'/index.html','utf8');
  const a=html.indexOf('      const cleanupKey ='),b=html.indexOf('      // §업체코드 중복발급 방지 라운드(신규) — genCompanyCode()',a);
  vm.runInNewContext(html.slice(a,b),context);
  return {save:c=>window.SHIN2_WEBSITE_CLEANUP_SAVE(c),state:()=>state,fail:v=>fail=v,window,events};
}
test('실제 저장 어댑터: 취소는 쓰기 없음, 실패는 업체/알림 모두 미변경, 재시도 성공',async()=>{
  const a=adapter();assert.equal(a.state().websiteCleanup.length,0);a.fail(true);await assert.rejects(a.save(end));assert.deepEqual(a.state(),base());assert.equal(a.window.SHIN2_WEBSITE_CLEANUP_ITEMS.length,0);
  a.fail(false);await a.save(end);assert.equal(a.state().websiteCleanup.length,1);assert.equal(a.window.SHIN2_WEBSITE_CLEANUP_ITEMS.length,1);
});
test('실제 저장 어댑터: 체크/완료 저장 실패는 이전 상태 유지, 재시도 완료',async()=>{
  const a=adapter();await a.save(end);a.fail(true);await assert.rejects(a.save({kind:'check',id:'end-1',field:'requested',value:true}));assert.equal(a.state().websiteCleanup[0].requested,false);
  a.fail(false);for(const field of ['requested','verified'])await a.save({kind:'check',id:'end-1',field,value:true});a.fail(true);await assert.rejects(a.save({kind:'complete',id:'end-1'}));assert.equal(a.window.SHIN2_WEBSITE_CLEANUP_ITEMS[0].completedAt,null);
  a.fail(false);await a.save({kind:'complete',id:'end-1'});assert.ok(a.state().websiteCleanup[0].completedAt);
});
test('모든 inline classic script 문법 검증',()=>{
 const html=fs.readFileSync(__dirname+'/index.html','utf8');let count=0;
 for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(m[1].includes('type="module"')||m[1].includes('src='))continue;new vm.Script(m[2]);count++;}assert.ok(count>5);
});
