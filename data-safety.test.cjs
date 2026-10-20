// §데이터 저장 안정성 라운드 — index.html의 실제 함수를 그대로 꺼내 가짜 저장소/서버로 검증한다.
// 운영 데이터·브라우저 저장소·Firebase에는 전혀 접근하지 않는다.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){
  const sig=html.indexOf('function '+name+'(');
  assert.ok(sig>0,'function not found: '+name);
  const start=html.lastIndexOf('\n',sig)+1, end=html.indexOf('\n  }',sig);
  return html.slice(start,end+4);
}
function fakeStorage(){
  const m=new Map();let failSet=false;
  return {m,setFail:v=>failSet=v,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{if(failSet&&!String(k).startsWith('shin2-sync-rev-'))throw Object.assign(new Error('QuotaExceededError'),{name:'QuotaExceededError'});m.set(k,String(v));},removeItem:k=>m.delete(k)};
}

/* ---------- 1~3: 로컬 저장 실패 → "저장됨" 금지, 기존 값 유지, 재시도 성공 ---------- */
function storageCtx(){
  const ls=fakeStorage(),pushed=[];
  const ctx={localStorage:ls,console:{error(){},warn(){},info(){}},window:{},CO_KEY:'co',ACT_KEY:'act',MEMO_KEY:'memo',MAIL_ASSETS_KEY:'mail',SALES_LEDGER_KEY:'sales',
    storageProblem(){},cloudSavesInFlight:0,CLOUD_CONFIRM_LOADERS:{companies:()=>JSON.parse(ls.getItem('co')||'[]')}};
  ctx.window.SHIN2_CRM_SHARED_SYNC={push(){},pushAsync:async(name,data)=>{pushed.push({name,data});}};
  vm.runInNewContext([fn('diskArrLen'),fn('markLocalWriteResult'),fn('writeArr'),fn('confirmCloudSave'),fn('confirmCloudSaveInner')].join('\n'),ctx);
  return {ctx,ls,pushed};
}
test('1. 이 기기 저장 실패 → 클라우드 확인이 성공("저장됨")으로 끝나지 않음',async()=>{
  const {ctx,ls,pushed}=storageCtx();
  assert.equal(ctx.writeArr('co',[{id:'a',name:'기존'}]),true);
  ls.setFail(true);
  assert.equal(ctx.writeArr('co',[{id:'a',name:'기존'},{id:'b',name:'새 업체'}]),false);
  const r=await ctx.confirmCloudSave('companies');
  assert.equal(r.ok,false);assert.equal(r.err.code,'LOCAL_WRITE_FAILED');
  assert.equal(pushed.length,0,'옛 데이터를 클라우드로 밀지 않음');
});
test('2. 저장 실패 → 기존 값 그대로 유지',()=>{
  const {ctx,ls}=storageCtx();
  ctx.writeArr('co',[{id:'a',name:'기존'}]);ls.setFail(true);
  ctx.writeArr('co',[{id:'a',name:'바뀐 값'}]);
  assert.deepEqual(JSON.parse(ls.getItem('co')),[{id:'a',name:'기존'}]);
});
test('3. 저장 실패 → 재시도 성공 시 정상 저장·확인',async()=>{
  const {ctx,ls,pushed}=storageCtx();
  ctx.writeArr('co',[{id:'a'}]);ls.setFail(true);ctx.writeArr('co',[{id:'a'},{id:'b'}]);
  assert.equal((await ctx.confirmCloudSave('companies')).ok,false);
  ls.setFail(false);assert.equal(ctx.writeArr('co',[{id:'a'},{id:'b'}]),true);
  const r=await ctx.confirmCloudSave('companies');
  assert.equal(r.ok,true);assert.equal(pushed.length,1);assert.equal(pushed[0].data.length,2);
  assert.equal(ctx.cloudSavesInFlight,0,'진행 중 건수 정리');
});

/* ---------- 복원(8, 9, 4-더블클릭) ---------- */
function restoreCtx(cloudOk){
  const co={id:'c1',name:'복원상사',memo:'보존',deletedAt:'2026-10-01T00:00:00Z',deletedBy:'u',deleteReason:'테스트',deleteType:'normal'};
  let acts=[{id:'old',companyId:'c1',originalText:'예전 활동'}],n=0,calls=0;
  const D={findCompany:id=>id==='c1'?co:null,
    snapshotDeleteFields:null,
    activitiesForCompany:id=>acts.filter(a=>a.companyId===id),
    restoreDeletedCompany:id=>{Object.assign(co,{deletedAt:null,deletedBy:null,deleteReason:null,deleteType:null,permanentDeletePending:null});acts.push({id:'r'+(++n),companyId:id,originalText:'[업체 복구]'});return co;},
    updateCompany:(id,p)=>Object.assign(co,p),deleteActivity:id=>{acts=acts.filter(a=>a.id!==id);}};
  const ctx={D,window:{crmAdminOk:()=>true},restoreInFlight:new Set(),confirmCloudSave:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return typeof cloudOk==='function'?cloudOk():{ok:cloudOk,err:cloudOk?null:new Error('unavailable')};},Error,Object,Set};
  const fields=html.match(/const RESTORE_SNAPSHOT_FIELDS = \[[^\]]*\];/)[0].replace('const ','var ');
  vm.runInNewContext(fields+'\n'+fn('snapshotDeleteFields')+'\n'+fn('restoreCompanyConfirmed'),ctx);
  D.snapshotDeleteFields=ctx.snapshotDeleteFields;
  return {ctx,co,acts:()=>acts,calls:()=>calls};
}
test('8. 복원 성공 → 정상 복원(다른 필드 보존)',async()=>{
  const {ctx,co,acts}=restoreCtx(true);
  const r=await ctx.restoreCompanyConfirmed('c1');
  assert.equal(r.ok,true);assert.equal(co.deletedAt,null);assert.equal(co.memo,'보존');
  assert.equal(acts().length,2);
});
test('9. 복원 서버 실패 → 쓰레기통 상태·활동 원상 복구',async()=>{
  const {ctx,co,acts}=restoreCtx(false);
  const r=await ctx.restoreCompanyConfirmed('c1');
  assert.equal(r.ok,false);assert.equal(r.rolledBack,true);
  assert.equal(co.deletedAt,'2026-10-01T00:00:00Z');assert.equal(co.deleteReason,'테스트');assert.equal(co.deletedBy,'u');
  assert.equal(co.memo,'보존');assert.deepEqual(acts().map(a=>a.id),['old']);
});
test('4. 복원 더블클릭 → 1번만 처리(활동 1건)',async()=>{
  const {ctx,acts,calls}=restoreCtx(true);
  const [a,b]=await Promise.all([ctx.restoreCompanyConfirmed('c1'),ctx.restoreCompanyConfirmed('c1')]);
  assert.equal([a.ok,b.ok].filter(Boolean).length,1);
  assert.equal(acts().filter(x=>x.originalText==='[업체 복구]').length,1);
  assert.equal(calls(),2,'companies+activities 확인 1회씩');
});

/* ---------- 6, 7: 신규 등록 취소 ---------- */
function discardCtx(opts){
  const companies=[{id:'keep',name:'기존 업체'},{id:'new1',name:'등록중'}];
  let acts=[{id:'a1',companyId:'new1'},{id:'a2',companyId:'keep'}],toasts=0;
  const D={findCompany:id=>companies.find(c=>c.id===id)||null,activitiesForCompany:id=>acts.filter(a=>a.companyId===id),deleteActivity:id=>{acts=acts.filter(a=>a.id!==id);},
    removeCompanyHard:id=>{const i=companies.findIndex(c=>c.id===id);if(i<0)return false;companies.splice(i,1);return true;}};
  const ctx={D,window:{SHIN2_CRM_SHARED_SYNC:opts.sync},renderList(){},showMiniSaveToast:()=>toasts++,setTimeout,Promise,Error,Set,
    DEFINITELY_NOT_SENT:new Set(['SYNC_UNAVAILABLE','LOCAL_WRITE_FAILED','permission-denied','unauthenticated'])};
  vm.runInNewContext(fn('errNotSent')+'\n'+fn('discardUnsavedNewCompany'),ctx);
  return {ctx,companies,acts:()=>acts,toasts:()=>toasts};
}
test('6. 신규 등록 중 취소(서버 미전송) → 임시 업체·활동 제거, 기존 업체 보존',async()=>{
  const {ctx,companies,acts}=discardCtx({sync:{}});
  const r=await ctx.discardUnsavedNewCompany({id:'new1',err:new Error('SYNC_UNAVAILABLE')});
  assert.equal(r.removed,true);assert.deepEqual(companies.map(c=>c.id),['keep']);assert.deepEqual(acts().map(a=>a.id),['a2']);
});
test('6-b. 애매한 실패 + 서버에 없음 확인 → 제거',async()=>{
  const {ctx,companies}=discardCtx({sync:{getOnce:async()=>[{id:'keep'}]}});
  const r=await ctx.discardUnsavedNewCompany({id:'new1',err:Object.assign(new Error('x'),{code:'unavailable'})});
  assert.equal(r.removed,true);assert.equal(companies.length,1);
});
test('7. 이미 서버에 저장된 업체 → 취소로 삭제되지 않음',async()=>{
  const {ctx,companies}=discardCtx({sync:{getOnce:async()=>[{id:'keep'},{id:'new1'}]}});
  const r=await ctx.discardUnsavedNewCompany({id:'new1',err:Object.assign(new Error('timeout'),{code:'deadline-exceeded'})});
  assert.equal(r.removed,false);assert.equal(r.onServer,true);assert.equal(companies.length,2);
});
test('7-b. 서버 확인 불가 → 지우지 않고 남김',async()=>{
  const {ctx,companies,toasts}=discardCtx({sync:{getOnce:async()=>{throw new Error('offline');}}});
  const r=await ctx.discardUnsavedNewCompany({id:'new1',err:Object.assign(new Error('x'),{code:'unavailable'})});
  assert.equal(r.removed,false);assert.equal(companies.length,2);assert.equal(toasts(),1);
});
test('7-c. 등록 성공 처리 코드가 취소 대상 표시를 비움(코드 확인)',()=>{
  const i=html.indexOf('      pendingNewCompanyId = null;\n      addFormUnsaved = null;')>=0||html.indexOf('      pendingNewCompanyId = null;\r\n      addFormUnsaved = null;')>=0;
  assert.ok(i,'서버 저장 성공 직후 addFormUnsaved = null');
});

/* ---------- 10, 11, 12: 협력사 엑셀 일괄 반영 ---------- */
function excelCtx(){
  const companies=[];for(let i=1;i<=10;i++)companies.push({id:'c'+i,name:'협력'+i,code:'B2B00'+(i-1),partnerStatus:null,partnerDashboard:{newMou:{}}});
  let acts=[],failId='c7',logs=0;
  const D={loadCompanies:()=>companies,findCompany:id=>companies.find(c=>c.id===id)||null,updateCompany:(id,p)=>Object.assign(companies.find(c=>c.id===id),p),
    activitiesForCompany:id=>acts.filter(a=>a.companyId===id),addActivity:(id,t)=>acts.push({id:'a'+acts.length,companyId:id,originalText:t}),bumpCompanyCodeB2BCounter(){}};
  const ctx={D,companies,Date,String,
    isConfirmedPartner:co=>!!(co.partnerDashboard.stageCorrections&&co.partnerDashboard.stageCorrections.mouDone),buildProgressStages:()=>({}),
    genCompanyCode:()=>'B2B999',findCompanyByCodeExcept:()=>null,
    parsePartnerDateLabel:t=>{const m=/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})/.exec(String(t||''));return m?{ts:new Date(+m[1],m[2]-1,+m[3]).getTime()}:null;},
    saveStageCorrection:(id,key,patch)=>{if(id===failId)throw new Error('저장 실패');const co=companies.find(c=>c.id===id);co.partnerDashboard.stageCorrections=Object.assign({},co.partnerDashboard.stageCorrections,{[key]:patch});logs++;}};
  vm.runInNewContext([fn('getStageCorrections'),fn('samePartnerDateText'),fn('buildPartnerExcelActivityLog'),fn('applyPartnerExcelImport')].join('\n'),ctx);
  const preview={total:10,notInCrm:[],needsReview:[],matched:companies.map((c,i)=>({companyId:c.id,companyName:c.name,codeDecision:{status:'keep'},finalCode:c.code,excelMouDate:'2026.0'+((i%9)+1)+'.15',finalMouDate:'2026.0'+((i%9)+1)+'.15'}))};
  return {ctx,preview,acts:()=>acts,setFail:v=>failId=v,logs:()=>logs};
}
test('10. 엑셀 10건 중 1건 실패 → 9 성공 / 1 실패를 정확히 표시',()=>{
  const {ctx,preview}=excelCtx();
  const r=ctx.applyPartnerExcelImport(preview);
  assert.equal(r.matchedCount,10);assert.equal(r.mouChangedCount,9);assert.equal(r.errorCount,1);assert.deepEqual(Array.from(r.errorNames),['협력7']);
});
test('11. 실패 건만 재시도 → 성공했던 9건 중복 없음',()=>{
  const {ctx,preview,acts,setFail}=excelCtx();
  ctx.applyPartnerExcelImport(preview);const actsAfterFirst=acts().length;
  setFail(null);
  const r=ctx.applyPartnerExcelImport(preview);
  assert.equal(r.unchangedCount,9);assert.equal(r.mouChangedCount,1);assert.equal(r.errorCount,0);
  assert.equal(acts().length,actsAfterFirst+1);
  for(let i=1;i<=10;i++)assert.equal(acts().filter(a=>a.companyId==='c'+i).length,1,'업체별 활동 1건');
});
test('12. 동일 엑셀 재업로드 → 활동·MOU 정정 추가 없음',()=>{
  const {ctx,preview,acts,setFail,logs}=excelCtx();setFail(null);
  ctx.applyPartnerExcelImport(preview);const a1=acts().length,l1=logs();
  const r=ctx.applyPartnerExcelImport(preview);
  assert.equal(r.unchangedCount,10);assert.equal(acts().length,a1);assert.equal(logs(),l1);
});
test('5. 엑셀 날짜 표기만 다른 재업로드(2026-1-15 vs 2026.01.15)도 변경 없음',()=>{
  const {ctx,preview,acts,setFail}=excelCtx();setFail(null);
  ctx.applyPartnerExcelImport(preview);const a1=acts().length;
  const p2=JSON.parse(JSON.stringify(preview));p2.matched.forEach(m=>{m.finalMouDate=m.finalMouDate.replace(/\./g,'-').replace('-0','-');});
  assert.equal(ctx.applyPartnerExcelImport(p2).unchangedCount,10);assert.equal(acts().length,a1);
});

/* ---------- 13: 저장 중 화면 갱신 → 입력값 유실 없음, 창 닫기 전 즉시 저장 ---------- */
test('13. 입력 중 클라우드 갱신이 와도 카드를 다시 그리지 않음(입력칸 유지), 입력을 벗어나면 갱신',async()=>{
  let renders=0,listRenders=0,blurFn=null;
  const card={contains:el=>el===ta};const ta={tagName:'TEXTAREA',addEventListener:(t,f)=>{if(t==='blur')blurFn=f;}};
  const ctx={cardState:{},addingNewCompany:false,cardView:Object.assign(card,{style:{display:'block'}}),currentCompanyId:'c1',cardRefreshDeferred:false,
    document:{activeElement:ta},D:{findCompany:()=>({id:'c1'})},renderChart:()=>renders++,openList(){},renderList:()=>listRenders++,setTimeout};
  vm.runInNewContext(fn('refreshVisibleScreenFromLocalCompanies'),ctx);
  ctx.refreshVisibleScreenFromLocalCompanies();ctx.refreshVisibleScreenFromLocalCompanies();
  assert.equal(renders,0);assert.ok(blurFn);
  ctx.document.activeElement=null;blurFn();await new Promise(r=>setTimeout(r,5));
  assert.equal(renders,1);
});
test('13-b. 탭 숨김/닫힘 시 대기 중 자동저장을 즉시 실행, 진행 중 저장이 있으면 닫기 확인',()=>{
  const start=html.indexOf('  const pendingLocalSaves = new Map();'),end=html.indexOf('  async function confirmCloudSave(',start);
  const listeners={},docListeners={};let flushed=0;
  const ctx={window:{addEventListener:(t,f)=>listeners[t]=f},document:{visibilityState:'visible',addEventListener:(t,f)=>docListeners[t]=f},console,Map,Array};
  vm.runInNewContext(html.slice(start,end),ctx);
  const P=ctx.window.SHIN2_PENDING_SAVES;
  P.set('q:1',()=>flushed++);assert.equal(P.hasPending(),true);
  ctx.document.visibilityState='hidden';docListeners.visibilitychange();
  assert.equal(flushed,1);assert.equal(P.hasPending(),false);
  P.set('q:1',()=>flushed++);listeners.pagehide();assert.equal(flushed,2);
  const ev={preventDefault(){this.prevented=true;}};listeners.beforeunload(ev);assert.equal(!!ev.prevented,false,'대기 없으면 확인창 없음');
  ctx.window.SHIN2_CRM_SHARED_SYNC={pendingCount:()=>1};const ev2={preventDefault(){this.prevented=true;}};listeners.beforeunload(ev2);assert.equal(ev2.prevented,true);
});

/* ---------- 5: 엑셀 업체 등록 + MOU 단건 — 부분 성공 표시, 재시도는 저장 확인만, 중복 클릭 1회 ---------- */
test('5-b. 엑셀 등록+MOU: 업체만 저장되고 MOU 저장 실패 → "부분 완료" 표시, 재시도는 확인만(중복 생성 없음)',async()=>{
  const companies=[],acts=[],corr=[],prompts=[];let cloudCalls=0,failCompaniesOnce=2;
  const D={loadCompanies:()=>companies,addCompany:f=>{const c=Object.assign({id:'n'+companies.length},f);companies.push(c);return c;},removeCompanyHard(){throw new Error('호출되면 안 됨');},
    updateCompany:(id,p)=>Object.assign(companies.find(c=>c.id===id),p),addActivity:(id,t)=>acts.push({id,t})};
  const answers=[true,true,false];// 1) 등록 확인 2) 부분완료 → 재시도 3) 다시 실패 → 나중에
  const ctx={D,Set,Date,Error,window:{crmAdminOk:()=>true},
    confirm:msg=>{prompts.push(msg);return answers.shift();},alert:msg=>prompts.push('ALERT '+msg),
    findActiveCompanyByExactName:(n,list)=>list.find(c=>c.name===n)||null,
    confirmCloudSave:async name=>{cloudCalls++;await new Promise(r=>setTimeout(r,2));if(name==='companies'){ if(cloudCalls===1) return {ok:true}; return {ok:false,err:new Error('unavailable')}; } return {ok:true};},
    genCompanyCode:()=>'B2B100',reserveB2BCode:async()=>'B2B100',findCompanyByCodeExcept:()=>null,fmtDate:()=>'2026.10.13',
    saveStageCorrection:(id,k,p)=>corr.push({id,k}),renderUnregisteredBadge(){},renderList(){},cloudSaveErrorMessage:e=>String(e&&e.message)};
  const start=html.indexOf('  const excelRegisterInFlight = new Set();');const end=html.indexOf('\n  }',html.indexOf('async function registerAndConfirmMouFromExcelNameInner('));
  vm.runInNewContext(html.slice(start,end+4).replace('const excelRegisterInFlight','var excelRegisterInFlight'),ctx);
  await Promise.all([ctx.handleRegisterAndConfirmMouFromExcelName('엑셀상사'),ctx.handleRegisterAndConfirmMouFromExcelName('엑셀상사')]);
  assert.equal(companies.length,1,'업체 1건만');assert.equal(acts.length,1,'활동 1건만');assert.equal(corr.length,1,'MOU 정정 1건만');
  assert.ok(prompts.some(p=>/부분 완료/.test(p)),'부분 완료 안내');
  assert.equal(prompts.filter(p=>/부분 완료/.test(p)).length,2,'재시도 후에도 실패면 다시 안내');
});

/* ---------- 관리자 전용: 관리자 모드가 아니면 복구·엑셀 등록이 실행되지 않음 ---------- */
test('관리자 모드가 아니면 업체 복구는 막히고 데이터는 그대로',async()=>{
  const {ctx,co,acts}=restoreCtx(true);ctx.window.crmAdminOk=()=>false;
  const r=await ctx.restoreCompanyConfirmed('c1');
  assert.equal(r.ok,false);assert.equal(co.deletedAt,'2026-10-01T00:00:00Z');assert.equal(acts().length,1);
});
test('관리자 전용 가드가 등록·수정·삭제 진입점에 모두 들어 있음(코드 확인)',()=>{
  for(const name of ['openAddCompanyForm','renderBasicInfoForm','openDeleteCompanyModal','openAgreementInvalidateModal','openPermDeleteModal','restoreCompanyConfirmed','handleConfirmMouFromNonPartnerTab','handleRegisterAndConfirmMouFromExcelName','convertCaseByCaseToCompany','registerCaseByCaseFromReview','openSalesImportModal','openMergeDupModal'])
    assert.ok(fn(name).includes('window.crmAdminOk('),name);
});
