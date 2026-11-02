// §저장·로딩 성능 라운드 — index.html의 실제 동기화 코드를 가짜 Firestore로 실행해 확인한다(실제 데이터·Firebase 없음).
//  · 내가 방금 저장한 값이 구독으로 되돌아와도(같은 localRev) 화면 전체 갱신 이벤트를 다시 쏘지 않는다
//  · 결과가 불명확한 저장(서버엔 반영, 응답만 실패)은 서버를 읽어 확인하고 다시 쓰지 않는다
//  · 실패 뒤 재시도는 먼저 서버를 확인한 다음 한 번만 쓴다
//  · 저장 확인(pushAsync(null))은 이미 기록된 변경을 다시 비교하지 않는다
//  · findCompany/activitiesForCompany는 캐시를 쓰되 복사본을 돌려준다(받은 쪽이 고쳐도 원본 그대로)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const J=v=>JSON.parse(JSON.stringify(v));
const SJ=(()=>{const b=html.indexOf('window.SHIN2_SYNC_JOURNAL = {'),a=html.lastIndexOf('  (function(){',b),e=html.indexOf('})();',b)+5;const w={};vm.runInNewContext(html.slice(a,e),{window:w});return w.SHIN2_SYNC_JOURNAL;})();
const SK='shin2-companies-staging';
function harness({local, cloud, txMode=()=> 'ok'}){
  const store=new Map(Object.entries({[SK]:JSON.stringify(local)}));
  const cloudDocs={[SK]:{value:J(cloud),localRev:100}};
  let txCount=0,reads=0; const snapCbs={}; const events=[];
  const window={SHIN2_SYNC_JOURNAL:SJ,dispatchEvent:e=>events.push(e.detail&&e.detail.key)};
  const ctx={window,console,setTimeout,clearTimeout,
    localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    CustomEvent:class{constructor(t,i){this.type=t;this.detail=i&&i.detail;}},
    SHARED_ARRAY_KEYS:{companies:SK},DOC_SYNC_STORAGE_KEY:'docs',
    ALLOW_EMPTY_SYNC_NAMES:new Set(),sharedSyncStarted:{},sharedPushTimers:{},lifecycleSyncLocks:new Set(),
    currentUid:'u',db:{},doc:(...a)=>a.at(-1),serverTimestamp:()=>'ts',publishCleanup(){},
    onSnapshot:(ref,cb)=>{snapCbs[ref]=cb;return ()=>{};},
    getDocFromServer:async k=>{reads++;return {exists:()=>!!cloudDocs[k],data:()=>J(cloudDocs[k])};},
    runTransaction:async(db,fn)=>{txCount++;const mode=txMode(txCount);if(mode==='fail')throw Object.assign(new Error('OFFLINE'),{code:'unavailable'});
      const writes={};const out=await fn({get:async k=>({exists:()=>!!cloudDocs[k],data:()=>J(cloudDocs[k])}),set:(k,v)=>writes[k]=J(v)});
      Object.assign(cloudDocs,writes);if(mode==='lost')throw Object.assign(new Error('응답 유실'),{code:'unavailable'});return out;}};
  const a=html.indexOf('      // §저장 안전장치(신규, 2026-10-20) — 위 SHIN2_SYNC_JOURNAL 설명 참고.'),b=html.indexOf('      window.SHIN2_CRM_SHARED_SYNC = {',a);
  assert.ok(a>0&&b>a,'sync block');
  vm.runInNewContext(html.slice(a,b)+';globalThis.__t={pushAsync:pushSharedKeyToCloudAsync,push:pushSharedKeyToCloud,start:startSharedKeySync,journal:loadSyncJournal,recorded:sharedKeyRecorded};',ctx);
  const snapshot=()=>snapCbs[SK]({exists:()=>true,data:()=>J(cloudDocs[SK]),metadata:{fromCache:false}});
  return {t:ctx.__t,ctx,window,cloud:()=>cloudDocs[SK],local:()=>JSON.parse(store.get(SK)),store,txCount:()=>txCount,reads:()=>reads,snapshot,events};
}
// writeArr처럼: 로컬에 쓰고 쓴 횟수를 올린 뒤 push(기록)
function localWrite(h,list){ h.store.set(SK,JSON.stringify(list)); const g=h.window.__SHIN2_KEY_GEN=h.window.__SHIN2_KEY_GEN||{}; g[SK]=(g[SK]||0)+1; h.t.push('companies',SK,list); }

test('내 저장이 구독으로 되돌아오면(같은 localRev) 화면 갱신 이벤트를 다시 쏘지 않고, 다른 PC 저장은 그대로 반영',async()=>{
  const base=[{id:'a',name:'가',phone:'1'}];
  const h=harness({local:base,cloud:base});h.t.start('companies',SK);h.snapshot();
  const n0=h.events.length;
  const next=J(base);next[0].phone='2';localWrite(h,next);
  await h.t.pushAsync('companies',SK,null);
  assert.equal(h.cloud().value[0].phone,'2');
  const n1=h.events.length;
  h.snapshot();   // 방금 저장한 바로 그 버전이 되돌아옴
  assert.equal(h.events.length,n1,'메아리로는 이벤트 없음');
  h.cloud().value[0].name='다른PC';h.cloud().localRev+=1;h.snapshot();   // 다른 PC 저장
  assert.equal(h.events.length,n1+1,'다른 PC 저장은 이벤트');assert.equal(h.local()[0].name,'다른PC');
  assert.ok(n1>=n0);
});

test('응답 유실(서버엔 반영됨): 서버를 읽어 확인하고 성공 처리, 다시 쓰지 않음',async()=>{
  const base=[{id:'a',name:'가',phone:'1'}];
  const h=harness({local:base,cloud:base,txMode:n=> n===1?'lost':'ok'});h.t.start('companies',SK);h.snapshot();
  const next=J(base);next[0].phone='7';localWrite(h,next);
  const r=await h.t.pushAsync('companies',SK,null);
  assert.equal(r.saved,true);assert.equal(h.txCount(),1,'트랜잭션 1번');assert.equal(h.reads(),1,'서버 확인 1번');
  assert.equal(h.cloud().value[0].phone,'7');assert.ok(SJ.isEmpty(h.t.journal(SK)),'변경 기록 비움');
  assert.equal(h.store.get('shin2-sync-unclear-'+SK)||null,null,'불명확 표시 없음');
});

test('실패(반영 안 됨) 뒤 재시도: 먼저 서버를 확인하고 한 번만 쓴다 — 표시는 새로고침 뒤에도 남는다',async()=>{
  const base=[{id:'a',name:'가',phone:'1'}];
  const h=harness({local:base,cloud:base,txMode:n=> n===1?'fail':'ok'});h.t.start('companies',SK);h.snapshot();
  const next=J(base);next[0].phone='8';localWrite(h,next);
  await assert.rejects(h.t.pushAsync('companies',SK,null));
  assert.equal(h.cloud().value[0].phone,'1');assert.equal(h.store.get('shin2-sync-unclear-'+SK),'1','이 기기에 "먼저 확인" 표시');
  const reads0=h.reads();
  await h.t.pushAsync('companies',SK,null);
  assert.equal(h.reads(),reads0+1,'다시 쓰기 전에 서버 확인');assert.equal(h.txCount(),2);assert.equal(h.cloud().value[0].phone,'8');
  assert.equal(h.store.get('shin2-sync-unclear-'+SK)||null,null,'성공 후 표시 지움');
});

test('저장 확인(null)은 이미 기록된 변경을 다시 비교하지 않고, 배열을 넘기면 항상 기록한다',async()=>{
  const base=[{id:'a',name:'가',phone:'1',fax:''}];
  const h=harness({local:base,cloud:base});h.t.start('companies',SK);h.snapshot();
  const m1=J(base);m1[0].phone='5';localWrite(h,m1);
  assert.equal(h.t.recorded(SK),true);
  await h.t.pushAsync('companies',SK,null);
  const m2=J(m1);m2[0].fax='02';   // writeArr 없이 배열만 직접 넘기는 호출도 반영돼야 한다
  await h.t.pushAsync('companies',SK,m2);
  assert.equal(h.cloud().value[0].fax,'02');assert.equal(h.cloud().value[0].phone,'5');
});

test('findCompany·activitiesForCompany: 같은 저장값이면 다시 풀지 않고, 돌려준 값을 고쳐도 원본은 그대로',()=>{
  function fn(name){const sig=html.indexOf('function '+name+'(');const start=html.lastIndexOf('\n',sig)+1,end=html.indexOf('\n  }',sig);return html.slice(start,end+4);}
  const line=name=>{const m=html.match(new RegExp('  function '+name+'\\([^\\n]+'));return m[0];};
  const store=new Map([['co',JSON.stringify([{id:'a',name:'가',pd:{x:1}}])],['act',JSON.stringify([{id:'1',companyId:'a',createdAt:'2026-01-01'},{id:'2',companyId:'b',createdAt:'2026-01-02'}])]]);
  let parses=0;const JSONp={parse:(s)=>{parses++;return JSON.parse(s);},stringify:JSON.stringify};
  const ctx={localStorage:{getItem:k=>store.get(k)??null},CO_KEY:'co',ACT_KEY:'act',JSON:JSONp,Array,Date};
  vm.runInNewContext([html.match(/  const sharedReadCache = \{\};/)[0],fn('readArrShared'),line('cloneRecord'),line('findCompany'),fn('activitiesForCompany')].join('\n'),ctx);
  const a=ctx.findCompany('a');a.name='바뀜';a.pd.x=9;
  const p1=parses;const b=ctx.findCompany('a');
  assert.equal(b.name,'가');assert.equal(b.pd.x,1,'캐시 원본은 그대로');
  assert.ok(parses-p1<=2,'같은 저장값이면 목록 전체를 다시 풀지 않음(복사본 1건만)');
  store.set('co',JSON.stringify([{id:'a',name:'새값'}]));
  assert.equal(ctx.findCompany('a').name,'새값','저장값이 바뀌면 새로 읽음');
  const acts=ctx.activitiesForCompany('a');acts[0].text='x';
  assert.equal(ctx.activitiesForCompany('a')[0].text,undefined);
});
