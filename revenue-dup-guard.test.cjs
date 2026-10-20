// §B2B 매출 중복 방지 — 2025 확정 중복 4행 차단, 별칭 연결 전 검사 화면 동작(index.html 실제 코드, 가짜 데이터)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const slice=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>0&&j>i,a);return html.slice(i,j);};
const snap25=JSON.parse(html.slice(html.indexOf('window.SHIN2_REVENUE_2025_SNAPSHOT = ')+'window.SHIN2_REVENUE_2025_SNAPSHOT = '.length,html.indexOf('];',html.indexOf('window.SHIN2_REVENUE_2025_SNAPSHOT = '))+1));
const ctx=vm.createContext({});vm.runInContext(slice('  const REVENUE_DUPLICATE_BLOCKLIST','  function buildRevenue2025Index(')+';this.blockOf=revenueBlockOf;this.list=REVENUE_DUPLICATE_BLOCKLIST;',ctx);

test('2025 스냅샷에서 정확히 확정 중복 4행만 차단되고 합계 189,813,650원',()=>{
  const blocked=snap25.filter(r=>ctx.blockOf(2025,r));
  assert.deepEqual(blocked.map(r=>r.sourceRow).sort((a,b)=>a-b),[271,272,279,280]);
  assert.equal(blocked.reduce((s,r)=>s+r.revenue2025,0),189813650);
  // 같은 금액이 들어 있는 협력업체 행(SH㈜·다수건설·삼정아이엔지건설)은 차단하지 않는다
  ['SH㈜','㈜다수건설','삼정아이엔지건설㈜'].forEach(n=>assert.equal(ctx.blockOf(2025,snap25.find(r=>r.name===n)),null,n));
});
test('행 번호·이름·금액이 하나라도 다르면 차단하지 않는다(원본이 바뀌면 다시 검토)',()=>{
  assert.equal(ctx.blockOf(2025,{name:'에스에이치',sourceRow:279,revenue2025:111256101}),null);
  assert.equal(ctx.blockOf(2025,{name:'에스에이치',sourceRow:278,revenue2025:111256100}),null);
  assert.equal(ctx.blockOf(2024,{name:'에스에이치',sourceRow:279,revenue2025:111256100}),null);
  assert.ok(ctx.blockOf(2025,{name:' 에스에이치 ',sourceRow:279,revenue2025:111256100}));
});
test('2025 집계 함수가 차단 행을 건너뛴다(코드 확인)',()=>{
  const body=slice('  function buildRevenue2025Index(){','  function getCompany2025Revenue(');
  assert.match(body,/if\(revenueBlockOf\(2025, r\)\) return;/);
});

function guard(chk,kpi){
  const calls=[];const g={D:{checkAliasRevenueOverlap:()=>chk,findCompany:()=>({name:'테스트건설'})},window:{SHIN2_B2B_KPI_PREVIEW:()=>kpi},
    alert:m=>calls.push(['alert',m]),confirm:m=>{calls.push(['confirm',m]);return true;}};
  vm.runInNewContext(slice('  function confirmAliasLink(','  function renderB2bLeading(')+';this.f=confirmAliasLink;',g);
  return {r:g.f('c1','별칭'),calls};
}
const base={added:{y2024:0,y2025:0,y2026:0,pour:0},conflicts:[],warnings:[],level:'ok'};
test('다른 운영 업체가 쓰는 이름이면 막는다(저장 안 함)',()=>{
  const {r,calls}=guard(Object.assign({},base,{conflicts:['다른 운영 업체 "A"가 이미 사용'],level:'block'}),null);
  assert.equal(r,false);assert.equal(calls[0][0],'alert');assert.match(calls[0][1],/연결할 수 없습니다/);
});
test('합산될 매출·KPI 변화를 보여 주고 사람이 확인해야 진행',()=>{
  const kpi={companies:[{id:'c1',before:{status:'관찰',revPct:-97},after:{status:'정상',revPct:400}}],cardsChanged:[]};
  const {r,calls}=guard(Object.assign({},base,{added:{y2024:0,y2025:0,y2026:228139900,pour:0},warnings:['확정 중복으로 차단된 2025 매출 ...'],level:'warn'}),kpi);
  assert.equal(r,true);assert.equal(calls[0][0],'confirm');
  assert.match(calls[0][1],/2026 228,139,900원/);assert.match(calls[0][1],/관찰 → 정상/);assert.match(calls[0][1],/확정 중복/);
});
test('합산될 것이 없고 경고도 없으면 묻지 않고 진행',()=>{
  const {r,calls}=guard(base,null);assert.equal(r,true);assert.equal(calls.length,0);
});
