// §관리 필요 — 시트 요청 반영(2026-11): 활동 기록만 보던 판정에 L2·L3·샘플 시트 요청일도 넣는다
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function cut(startMark,endMark){
  const s=html.indexOf(startMark), e=html.indexOf(endMark,s);
  assert.ok(s>0&&e>s,'코드 블록을 찾지 못함: '+startMark);
  return html.slice(s,e);
}
const classify=cut('  function classifyManagementNeed(','  /* §관리 필요 — 시트 요청 반영');
const sheetActs=cut('  /* 활동이 실제로 있었던 날','  const MGMT_NEED_REASON_LABEL');
const parseFn=cut('  function parsePartnerDateLabel(','  // (§요청자료 정리 라운드');
const groupFn=cut('  function trendGroupOf(','  const TREND_DAY_MS');

const DAY=86400000, NOW=Date.now();
const ago=d=>new Date(NOW-d*DAY).toISOString();
function run({acts=[],sheet=[],mouDaysAgo=400,hasPour=true}){
  const ctx={Date,Math,String,Number,Set,Map,isNaN,
    B2B_L2_TYPES:new Set(['기술자문문의']),B2B_L3_TYPES:new Set(['공법설명회이력','컨설팅요청_통합','컨설팅요청']),TREND_SAMPLE_TYPE:'샘플카달로그요청',
    D:{buildSheetRequestsIndex:()=>new Map([['c1',sheet]])}};
  vm.runInNewContext(parseFn+groupFn+sheetActs+classify+'\nthis.f=classifyManagementNeed;',ctx);
  const progress={hasAny:true,stages:[{key:'mou',state:'done',ts:NOW-mouDaysAgo*DAY}]};
  return ctx.f({id:'c1'},acts,progress,hasPour);
}
// 옮겨 담은 시트 요청: createdAt = 옮겨 담은 날, occurredAt = 실제 요청일(기본은 같은 날로 둠)
const legacy=(d,key,occ)=>({createdAt:ago(d),occurredAt:ago(occ==null?d:occ),source:'google-sheets-request',_dedupKey:key,category:'기술자문문의'});
const yymmdd=d=>{const t=new Date(NOW-d*DAY);return String(t.getFullYear()).slice(2)+'.'+String(t.getMonth()+1).padStart(2,'0')+'.'+String(t.getDate()).padStart(2,'0');};
const pd=(createdDaysAgo,realDaysAgo,kind)=>({createdAt:ago(createdDaysAgo),source:'partner-dashboard',sourceRecordId:'pd_업체_'+kind+'_'+yymmdd(realDaysAgo),category:'미팅'});

test('진성이앤지 사례: 활동 63일 전이어도 시트 기술자문문의 9일 전이면 관리 필요 아님',()=>{
  const before=run({acts:[legacy(63,'a'),legacy(63,'b')]});
  assert.equal(before.type,'reuse'); assert.equal(before.days,63);
  const after=run({acts:[legacy(63,'a'),legacy(63,'b')],sheet:[{requestDate:ago(9),requestType:'기술자문문의',dedupKey:'n1'}]});
  assert.equal(after.type,'none');
});
test('시트 요청도 60일 넘었으면 그대로 재사용 필요, 날짜는 가장 최근 요청 기준',()=>{
  const r=run({acts:[legacy(90,'a')],sheet:[{requestDate:ago(70),requestType:'컨설팅요청_통합',dedupKey:'n1'}]});
  assert.equal(r.type,'reuse'); assert.equal(r.days,70); assert.equal(r.activity.category,'컨설팅요청_통합');
});
test('L2·L3·샘플만 반영 — 기타문의답변현황은 활동으로 보지 않음',()=>{
  const r=run({acts:[legacy(63,'a')],sheet:[{requestDate:ago(3),requestType:'기타문의답변현황',dedupKey:'n1'}]});
  assert.equal(r.type,'reuse');
  const s=run({acts:[legacy(63,'a')],sheet:[{requestDate:ago(3),requestType:'샘플카달로그요청',dedupKey:'n2'}]});
  assert.equal(s.type,'none');
});
test('이미 활동으로 옮겨 담은 요청(같은 dedupKey)은 다시 세지 않음',()=>{
  // POUR 실적 없음 + MOU 뒤 활동 1건 → L2 정체. 같은 요청이 시트에도 있지만 이중으로 세면 '2건'이 되어 판정이 바뀐다.
  const r=run({hasPour:false,mouDaysAgo:200,acts:[legacy(40,'k1')],sheet:[{requestDate:ago(150),requestType:'기술자문문의',dedupKey:'k1'}]});
  assert.equal(r.type,'l2Stall'); assert.equal(r.days,40);
});
test('미래 날짜·날짜 없는 시트 요청은 넣지 않음',()=>{
  const r=run({acts:[legacy(63,'a')],sheet:[{requestDate:new Date(NOW+5*DAY).toISOString(),requestType:'기술자문문의',dedupKey:'f'},{requestDate:'',requestType:'기술자문문의',dedupKey:'e'}]});
  assert.equal(r.type,'reuse'); assert.equal(r.days,63);
});
test('MOU 뒤 첫 활동이 없어도 시트 요청이 있으면 첫 활동 없음으로 보지 않음',()=>{
  const r=run({hasPour:false,mouDaysAgo:50,acts:[],sheet:[{requestDate:ago(5),requestType:'기술자문문의',dedupKey:'n1'}]});
  assert.equal(r.type,'none');
  const r0=run({hasPour:false,mouDaysAgo:50,acts:[],sheet:[]});
  assert.equal(r0.type,'firstActivity');
});

test('옮겨 담은 시트 요청은 옮겨 담은 날이 아니라 실제 요청일로 경과일을 셈',()=>{
  const r=run({acts:[legacy(63,'a',170),legacy(63,'b',120)]});
  assert.equal(r.type,'reuse'); assert.equal(r.days,120);
});
test('협력사 현황표 기록은 기록 ID 끝 날짜(실제 날짜)로 셈',()=>{
  const r=run({acts:[pd(79,200,'m2done')]});
  assert.equal(r.type,'reuse'); assert.equal(r.days,200);
});
test('협약 전 미팅·질문서(실제 날짜가 협약일 이전)는 협약 후 활동으로 세지 않음',()=>{
  // 협약 100일 전, 기록은 79일 전에 옮겨 담음 → 예전에는 협약 후 활동 1건(L2 정체)으로 잘못 셌다
  const r=run({hasPour:false,mouDaysAgo:100,acts:[pd(79,150,'m1done')]});
  assert.equal(r.type,'firstActivity'); assert.equal(r.days,100);
});
test('협약 당일 기록(MOU 체결 완료)은 협약 후 활동이 아님',()=>{
  const r=run({hasPour:false,mouDaysAgo:100,acts:[pd(79,100,'mou')]});
  assert.equal(r.type,'firstActivity');
});
test('원래 날짜가 없거나 잘못되면 기존처럼 기록 날짜(createdAt) 사용',()=>{
  const bad={createdAt:ago(70),source:'partner-dashboard',sourceRecordId:'pd_업체_memo',category:'기타'};
  const noOcc={createdAt:ago(65),source:'google-sheets-request',_dedupKey:'z',category:'기술자문문의'};
  const manual={createdAt:ago(61),category:'통화'};
  assert.equal(run({acts:[bad]}).days,70);
  assert.equal(run({acts:[noOcc]}).days,65);
  assert.equal(run({acts:[manual,bad]}).days,61);
});
