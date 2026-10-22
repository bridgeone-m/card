// §신규 뱃지 — MOU 체결일 기준 1년 미만만 MOU 뱃지 앞에 "신규"(index.html 실제 함수, 날짜는 가짜)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const slice=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>0&&j>i,a);return html.slice(i,j);};
const code=slice('  function mouBadgeHtml(','  // 협약 종료 배지');
function run(state, mou, today){
  const ctx={Date,esc:s=>String(s),MOU_BADGE_DEFS:{mou:{label:'MOU',cls:'is-mou',title:'t'},m1:{label:'1차',cls:'is-m1',title:'t'}},
    deriveMouBadgeState:()=>state,resolveEffectiveMouDate:()=>mou&&{ts:new Date(...mou).getTime()},
    getSeoulTodayDateOnly:()=>new Date(...today).getTime()};
  vm.runInNewContext(code+';this.f=mouBadgeHtml;',ctx);
  return ctx.f({},null,null);
}
const NEW='>신규</span><span class="co-stage-badge is-mou"';
test('체결 1년 미만이면 MOU 뱃지 바로 앞에 신규',()=>{
  assert.ok(run('mou',[2026,0,5],[2026,9,22]).includes(NEW));
  assert.ok(run('mou',[2025,9,23],[2026,9,22]).includes(NEW)); // 1년 되기 하루 전
  assert.ok(run('mou',[2026,9,22],[2026,9,22]).includes(NEW)); // 체결 당일
});
test('체결일로부터 1년이 되는 날부터 사라짐',()=>{
  assert.ok(!run('mou',[2025,9,22],[2026,9,22]).includes('신규'));
  assert.ok(!run('mou',[2024,2,1],[2026,9,22]).includes('신규'));
});
test('체결일 없음·미래 날짜·MOU 아닌 업체는 안 붙임',()=>{
  assert.ok(!run('mou',null,[2026,9,22]).includes('신규'));
  assert.ok(!run('mou',[2026,11,1],[2026,9,22]).includes('신규'));
  assert.ok(!run('m1',[2026,5,1],[2026,9,22]).includes('신규'));
});
