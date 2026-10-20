// §저장 안전장치 — 2026-10-20 14:12 사고(오래된 화면 데이터가 로그인 직후 클라우드 업체 목록을 덮어씀) 재현·방지 검사.
// index.html의 실제 동기화 코드(Firebase 모듈 일부)를 가짜 Firestore(트랜잭션 지원)로 실행한다. 실제 데이터 없음.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const J=v=>JSON.parse(JSON.stringify(v));
function journalApi(){
  const b=html.indexOf('window.SHIN2_SYNC_JOURNAL = {'),a=html.lastIndexOf('  (function(){',b),e=html.indexOf('})();',b)+5;
  const w={};vm.runInNewContext(html.slice(a,e),{window:w});return w.SHIN2_SYNC_JOURNAL;
}
const SJ=journalApi();

/* 실제 공유 목록 동기화 코드 + 가짜 Firestore */
function harness({local, cloud, failFirst=0}){
  const store=new Map(Object.entries({'shin2-companies-staging':JSON.stringify(local)}));
  const cloudDocs={'shin2-companies-staging':{value:J(cloud),localRev:100}};
  let txCount=0; const snapCbs={}; const events=[];
  const window={SHIN2_SYNC_JOURNAL:SJ,dispatchEvent:e=>events.push(e.type),localStorage:null};
  const ctx={window,console,setTimeout,clearTimeout,
    localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    CustomEvent:class{constructor(t,i){this.type=t;this.detail=i&&i.detail;}},
    SHARED_ARRAY_KEYS:{companies:'shin2-companies-staging'},DOC_SYNC_STORAGE_KEY:'docs',
    ALLOW_EMPTY_SYNC_NAMES:new Set(),sharedSyncStarted:{},sharedPushTimers:{},lifecycleSyncLocks:new Set(),
    currentUid:'u',db:{},doc:(...a)=>a.at(-1),serverTimestamp:()=>'ts',publishCleanup(){},
    onSnapshot:(ref,cb)=>{snapCbs[ref]=cb;return ()=>{};},
    runTransaction:async(db,fn)=>{txCount++;if(failFirst>0){failFirst--;throw new Error('OFFLINE');}const writes={};const out=await fn({get:async k=>({exists:()=>!!cloudDocs[k],data:()=>J(cloudDocs[k])}),set:(k,v)=>writes[k]=J(v)});Object.assign(cloudDocs,writes);return out;}};
  const a=html.indexOf('      // §저장 안전장치(신규, 2026-10-20) — 위 SHIN2_SYNC_JOURNAL 설명 참고.'),b=html.indexOf('      // §로컬-클라우드 비교 화면 라운드(신규)',a);
  assert.ok(a>0&&b>a,'sync block');
  vm.runInNewContext(html.slice(a,b)+';globalThis.__t={pushAsync:pushSharedKeyToCloudAsync,push:pushSharedKeyToCloud,start:startSharedKeySync,journal:loadSyncJournal};',ctx);
  return {t:ctx.__t,cloud:()=>cloudDocs['shin2-companies-staging'],local:()=>JSON.parse(store.get('shin2-companies-staging')),txCount:()=>txCount,
    snapshot:(fromCache=false)=>snapCbs['shin2-companies-staging']({exists:()=>true,data:()=>J(cloudDocs['shin2-companies-staging']),metadata:{fromCache}}),
    setCloud:v=>{cloudDocs['shin2-companies-staging']={value:J(v),localRev:cloudDocs['shin2-companies-staging'].localRev+1};},events};
}
// 10/20 사고와 같은 모양: 클라우드엔 최신(두경건업 신규·선두건설 주소·넷폼 협약종료), 이 기기엔 며칠 전 값
const cloudNow=[
  {id:'sundo',name:'(주)선두건설',address:'경기도 의정부시 …',repName:'신병주',geocodeStatus:'ok',latitude:37.7},
  {id:'netform',name:'넷폼',agreementStatus:'terminated',agreementEndedAt:'2026-10-19'},
  {id:'aqua',name:'(주)아쿠아블록',m1MailLog:[1,2,3]},
  {id:'dukyung',name:'두경건업(주)',code:'B2B375'},
];
const staleLocal=[
  {id:'sundo',name:'(주)선두건설',address:'',repName:'',geocodeStatus:'ok'},
  {id:'netform',name:'넷폼'},
  {id:'aqua',name:'(주)아쿠아블록',m1MailLog:[1]},
];

test('사고 재현 방지: 최신 값을 받기 전에는 저장하지 않고, 받은 뒤엔 이 기기가 바꾼 필드만 얹는다',async()=>{
  const h=harness({local:staleLocal,cloud:cloudNow});
  h.t.start('companies','shin2-companies-staging');
  // 로그인 직후 지도 자동 조회처럼 오래된 목록에서 한 필드를 바꿔 저장 시도
  const next=J(staleLocal);next[0].geocodeStatus='missing';
  const p=h.t.pushAsync('companies','shin2-companies-staging',next);
  await new Promise(r=>setTimeout(r,30));
  assert.equal(h.txCount(),0,'최신 값 수신 전엔 클라우드에 아무것도 쓰지 않음');
  assert.deepEqual(J(h.cloud().value),cloudNow,'클라우드 그대로');
  h.snapshot(true);   // 캐시에서 온 값은 "최신"으로 치지 않는다
  await new Promise(r=>setTimeout(r,10));
  assert.equal(h.txCount(),0);
  h.snapshot(false);  // 서버 최신 값 도착
  await p;
  const c=h.cloud().value;
  assert.equal(c.length,4,'두경건업 보존');
  assert.ok(c.some(x=>x.id==='dukyung'&&x.code==='B2B375'));
  const sundo=c.find(x=>x.id==='sundo');
  assert.equal(sundo.address,'경기도 의정부시 …','선두건설 주소·대표자 보존');assert.equal(sundo.repName,'신병주');
  assert.equal(sundo.geocodeStatus,'missing','이 기기가 바꾼 필드만 반영');
  assert.equal(c.find(x=>x.id==='netform').agreementStatus,'terminated','협약 종료 기록 보존');
  assert.deepEqual(J(c.find(x=>x.id==='aqua').m1MailLog),[1,2,3],'메일 이력 보존');
  assert.deepEqual(J(h.local()),J(c),'이 기기 화면도 최신+내 변경으로 맞춰짐');
  assert.ok(SJ.isEmpty(h.t.journal('shin2-companies-staging')),'저장 후 변경 기록 비움');
});

test('두 PC가 같은 업체의 다른 필드를 거의 동시에 바꿔도 둘 다 남는다(트랜잭션 + 변경분 저장)',async()=>{
  const base=[{id:'a',name:'가',phone:'1',memo:''},{id:'b',name:'나'}];
  const h=harness({local:base,cloud:base});
  h.t.start('companies','shin2-companies-staging');h.snapshot(false);
  h.setCloud([{id:'a',name:'가',phone:'1',memo:'다른 PC 메모'},{id:'b',name:'나'},{id:'c',name:'다른 PC 신규'}]);  // 다른 PC 저장
  const mine=J(base);mine[0].phone='2';
  await h.t.pushAsync('companies','shin2-companies-staging',mine);
  const c=h.cloud().value;
  assert.equal(c.find(x=>x.id==='a').phone,'2');assert.equal(c.find(x=>x.id==='a').memo,'다른 PC 메모');
  assert.ok(c.some(x=>x.id==='c'),'다른 PC가 만든 업체 보존');
});

test('저장 실패(네트워크) 시 클라우드는 그대로, 변경 기록이 남아 다음 저장 때 함께 반영된다',async()=>{
  const base=[{id:'a',name:'가',phone:'1',fax:''}];
  const h=harness({local:base,cloud:base,failFirst:1});
  h.t.start('companies','shin2-companies-staging');h.snapshot(false);
  const m1=J(base);m1[0].phone='9';
  await assert.rejects(h.t.pushAsync('companies','shin2-companies-staging',m1));
  assert.equal(h.cloud().value[0].phone,'1','실패하면 클라우드 그대로');
  assert.ok(!SJ.isEmpty(h.t.journal('shin2-companies-staging')),'변경 기록 유지');
  const m2=J(m1);m2[0].fax='02';
  await h.t.pushAsync('companies','shin2-companies-staging',m2);
  assert.equal(h.cloud().value[0].phone,'9');assert.equal(h.cloud().value[0].fax,'02');
});

/* 순수 함수 */
test('변경 기록: 새 항목·삭제·필드 삭제, 저장 도중 새 변경은 남긴다',()=>{
  const prev=[{id:'a',x:1,y:2},{id:'b'},'s1'];
  const next=[{id:'a',x:1},{id:'n',z:1},'s1','s2'];
  const j=SJ.diffInto(SJ.emptyJournal(),prev,next);
  const cloud=[{id:'a',x:5,y:2,w:7},{id:'b'},{id:'other'},'s1'];
  const out=J(SJ.applyJournal(cloud,j));   // vm 컨텍스트 객체 → 이 컨텍스트 객체로
  assert.deepEqual(out.find(o=>o.id==='a'),{id:'a',x:5,w:7},'a: y만 지워지고 다른 필드는 클라우드 값');
  assert.ok(!out.some(o=>o&&o.id==='b'),'b 삭제');assert.ok(out.some(o=>o&&o.id==='n'));assert.ok(out.includes('s2'));assert.ok(out.some(o=>o&&o.id==='other'));
  const snap=J(j);const cur=SJ.diffInto(J(j),next,[{id:'a',x:3},{id:'n',z:1},'s1','s2']);
  SJ.removeApplied(cur,snap);
  assert.ok(cur.set['id:a'],'저장 도중 바뀐 a는 남는다');assert.ok(!cur.set['id:n'],'그대로인 n은 지운다');
});
