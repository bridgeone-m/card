// §관리 필요 — 시트 요청 반영(2026-11): 활동 기록만 보던 판정에 L2·L3·샘플 시트 요청일도 넣는다
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function cut(startMark,endMark){
  const s=html.indexOf(startMark), e=html.indexOf(endMark,s);
  assert.ok(s>0&&e>s,'코드 블록을 찾지 못함: '+startMark);
  return html.slice(s,e);
}
const classify=cut('  function classifyManagementNeed(','  /* §관리 필요 — 시트 요청 반영');
const sheetActs=cut('  function mgmtNeedSheetRequestActs(','  const MGMT_NEED_REASON_LABEL');
const groupFn=cut('  function trendGroupOf(','  const TREND_DAY_MS');

const DAY=86400000, NOW=Date.now();
const ago=d=>new Date(NOW-d*DAY).toISOString();
function run({acts=[],sheet=[],mouDaysAgo=400,hasPour=true}){
  const ctx={Date,Math,String,Number,Set,Map,isNaN,
    B2B_L2_TYPES:new Set(['기술자문문의']),B2B_L3_TYPES:new Set(['공법설명회이력','컨설팅요청_통합','컨설팅요청']),TREND_SAMPLE_TYPE:'샘플카달로그요청',
    D:{buildSheetRequestsIndex:()=>new Map([['c1',sheet]])}};
  vm.runInNewContext(groupFn+sheetActs+classify+'\nthis.f=classifyManagementNeed;',ctx);
  const progress={hasAny:true,stages:[{key:'mou',state:'done',ts:NOW-mouDaysAgo*DAY}]};
  return ctx.f({id:'c1'},acts,progress,hasPour);
}
const legacy=(d,key)=>({createdAt:ago(d),source:'google-sheets-request',_dedupKey:key,category:'기술자문문의'});

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
