// §최근 흐름(2026-11) — 전분기 동일 경과기간 비교 + 최근 30일 활동 확인: 기간 계산·판정·예외·30일·안내문 문구
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const start=html.indexOf('  const TREND_RULES = {'), end=html.indexOf('  // §실적 상승 업체 라운드');
assert.ok(start>0 && end>start, '최근 흐름 블록을 찾지 못함');
const block=html.slice(start,end);

function load(sheetMap, actMap){
  const ctx={Date,Math,String,Number,Object,Set,Map,isNaN,setTimeout,
    B2B_L2_TYPES:new Set(['기술자문문의']), B2B_L3_TYPES:new Set(['공법설명회이력','컨설팅요청_통합','컨설팅요청']),
    D:{buildSheetRequestsIndex:()=>sheetMap||new Map(), buildActivitiesIndex:()=>actMap||new Map()},
    // 실제 mergedGsheetRequestItems 와 같은 모양(ts·sourceTab)만 돌려주는 대역
    mergedGsheetRequestItems:(id,sheet)=>sheet.map(r=>({ts:r.requestDate, sourceTab:r.requestType}))};
  vm.runInNewContext(block+'\nthis.api={TREND_RULES,trendKstDay,trendQuarterWindows,computeRecentTrend,buildRecentTrend,buildTrendReasonText,trendCriteriaText,trendLastRequestText};',ctx);
  return ctx.api;
}
const A=load();
// 한국 날짜 yyyy-mm-dd 의 정오(KST) 시각 — 기준일로 쓴다
const kst=(s)=>new Date(s+'T12:00:00+09:00');
const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const win=s=>{const w=A.trendQuarterWindows(kst(s));return {cur:ymd(w.curStart)+'~'+ymd(w.curEnd),prev:ymd(w.prevStart)+'~'+ymd(w.prevEnd),elapsed:w.elapsed};};
const reqs=(w,list)=>list.map(([daysAgo,group])=>({day:new Date(w.today.getFullYear(),w.today.getMonth(),w.today.getDate()-daysAgo),group}));
// 이번 분기 n건(오늘 몇 건 전), 직전 분기 비교기간 m건을 만든다
function make(today,cur,prev,extra){
  const w=A.trendQuarterWindows(kst(today)); const out=[];
  for(let i=0;i<cur;i++) out.push({day:new Date(w.curStart),group:'L2'});
  for(let i=0;i<prev;i++) out.push({day:new Date(w.prevStart),group:'L3'});
  return {w,out:out.concat(extra||[])};
}

test('예시 그대로: 2026-11-12 → 10.01~11.12 vs 07.01~08.12',()=>{
  assert.deepEqual(win('2026-11-12'),{cur:'2026-10-01~2026-11-12',prev:'2026-07-01~2026-08-12',elapsed:42});
});
test('분기 첫날·연도 변경: 1월이면 전년 4분기와 비교',()=>{
  assert.deepEqual(win('2027-01-01'),{cur:'2027-01-01~2027-01-01',prev:'2026-10-01~2026-10-01',elapsed:0});
  assert.deepEqual(win('2027-01-20'),{cur:'2027-01-01~2027-01-20',prev:'2026-10-01~2026-10-20',elapsed:19});
  assert.deepEqual(win('2026-04-01'),{cur:'2026-04-01~2026-04-01',prev:'2026-01-01~2026-01-01',elapsed:0});
});
test('분기 말: 직전 분기 마지막 날을 넘지 않음',()=>{
  assert.deepEqual(win('2026-09-30'),{cur:'2026-07-01~2026-09-30',prev:'2026-04-01~2026-06-30',elapsed:91});
  assert.deepEqual(win('2026-06-30'),{cur:'2026-04-01~2026-06-30',prev:'2026-01-01~2026-03-31',elapsed:90});
  assert.deepEqual(win('2026-12-31'),{cur:'2026-10-01~2026-12-31',prev:'2026-07-01~2026-09-30',elapsed:91});
  assert.deepEqual(win('2026-03-31'),{cur:'2026-01-01~2026-03-31',prev:'2025-10-01~2025-12-29',elapsed:89});
});
test('시트 날짜(한국 자정 = UTC 15:00 전날)를 한국 날짜로 센다',()=>{
  assert.equal(ymd(A.trendKstDay('2026-09-30T15:00:00.000Z')),'2026-10-01');
  assert.equal(ymd(A.trendKstDay('2026-10-01T14:59:59.000Z')),'2026-10-01');
});
test('분기 시작 후 14일 미만은 집계 중, 14일째부터 판정',()=>{
  const a=make('2026-10-14',6,5); assert.equal(A.computeRecentTrend(a.out,a.w).state,'counting');
  const b=make('2026-10-15',6,5); assert.equal(A.computeRecentTrend(b.out,b.w).state,'up');
});
test('상승 +20% 이상 · 유지 · 하락 -20% 이하(경계 포함)',()=>{
  const t=(c,p)=>{const m=make('2026-11-12',c,p);const r=A.computeRecentTrend(m.out,m.w);return r.state+' '+r.pct;};
  assert.equal(t(6,5),'up 20');
  assert.equal(t(4,5),'down -20');
  assert.equal(t(23,20),'flat 15');
  assert.equal(t(17,20),'flat -15');
  assert.equal(t(15,20),'down -25');
});
test('예외: 직전 5건 미만 관찰 · 직전 0건 신규 활동 · 둘 다 0건 활동 없음',()=>{
  const t=(c,p)=>{const m=make('2026-11-12',c,p);const r=A.computeRecentTrend(m.out,m.w);return [r.state,r.label,r.pct];};
  assert.deepEqual(t(10,4),['watch','관찰',null]);
  assert.deepEqual(t(3,0),['new','신규 활동',null]);
  assert.deepEqual(t(0,0),['none','활동 없음',null]);
});
test('비교기간 밖(직전 분기 08.13 이후) 요청은 세지 않음',()=>{
  const w=A.trendQuarterWindows(kst('2026-11-12'));
  const r=A.computeRecentTrend([{day:new Date(2026,7,12),group:'L2'},{day:new Date(2026,7,13),group:'L2'},{day:new Date(2026,8,30),group:'L3'}],w);
  assert.equal(r.prevCount,1); assert.equal(r.curCount,0);
});
test('최근 30일: D+30까지 포함·D+31 제외(최근 요청 빨간 배지와 같은 경계), 마지막 요청 D+, 경고는 분기 판정과 별도',()=>{
  const w=A.trendQuarterWindows(kst('2026-11-12'));
  const r=A.computeRecentTrend(reqs(w,[[0,'L2'],[30,'샘플'],[31,'L3']]),w);
  assert.equal(r.recent30,2); assert.equal(r.lastAgeDays,0); assert.equal(r.activityWarn,false);
  assert.equal(A.trendLastRequestText(r),'2026.11.12 (오늘)');
  const r2=A.computeRecentTrend(reqs(w,[[35,'L2'],[40,'L2']]),w);
  assert.equal(r2.recent30,0); assert.equal(r2.lastAgeDays,35); assert.equal(r2.activityWarn,true);
  assert.equal(A.trendLastRequestText(r2),'2026.10.08 (D+35)');
  assert.equal(r2.state,'new'); // 10.08·10.03 = 이번 분기 2건, 직전 0건 → 신규 활동(경고와 따로)
});
test('요청 이력이 없으면 D+0이 아니라 요청 이력 없음',()=>{
  const w=A.trendQuarterWindows(kst('2026-11-12'));
  const r=A.computeRecentTrend([],w);
  assert.equal(r.hasHistory,false); assert.equal(r.lastAgeDays,null); assert.equal(A.trendLastRequestText(r),'요청 이력 없음');
  assert.equal(r.activityWarn,true);
});
test('미래 날짜(입력 오류)는 세지 않음',()=>{
  const w=A.trendQuarterWindows(kst('2026-11-12'));
  const r=A.computeRecentTrend([{day:new Date(2026,10,20),group:'L2'}],w);
  assert.equal(r.curCount,0); assert.equal(r.hasHistory,false);
});
test('집계 종류: L2·L3·샘플만, 기타문의답변현황은 제외',()=>{
  const today=new Date(); const iso=new Date(today.getTime()-86400000).toISOString();
  const sheet=new Map([['c1',[
    {requestDate:iso,requestType:'기술자문문의'},{requestDate:iso,requestType:'컨설팅요청_통합'},{requestDate:iso,requestType:'공법설명회이력'},
    {requestDate:iso,requestType:'샘플카달로그요청'},{requestDate:iso,requestType:'기타문의답변현황'}]]]);
  const B=load(sheet,new Map());
  const r=B.buildRecentTrend({id:'c1'});
  assert.equal(r.recent30,4); assert.equal(r.lastAgeDays,1);
  const w=r.win, y=new Date(w.today.getFullYear(),w.today.getMonth(),w.today.getDate()-1);
  if(y>=w.curStart) assert.deepEqual(JSON.parse(JSON.stringify(r.curBy)),{L2:1,L3:2,'샘플':1});
});
test('안내문(ⓘ)에 지정 문구가 그대로 들어 있음',()=>{
  for(const s of ['전분기 동일 경과기간 비교 + 최근 30일 활동 확인',
    '최근 흐름은 이번 분기의 현재까지 요청 건수와 직전 분기의 동일 경과기간 요청 건수를 비교하여 산정합니다.',
    'L2·L3·샘플 요청을 기준으로 집계하며, 최근 30일 활동 건수와 마지막 요청 이후 경과일을 함께 확인합니다.',
    '활동·요청 데이터는 기존 실시간 갱신 데이터와 연동되어 자동 반영됩니다.']) assert.ok(html.includes(s),s);
  const c=A.trendCriteriaText();
  assert.match(c,/상승 \+20% 이상/); assert.match(c,/하락 -20% 이하/); assert.match(c,/14일 미만 '집계 중'/); assert.match(c,/5건 미만 '관찰'/);
});
