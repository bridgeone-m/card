// §내보내기 협약일 — PDF·엑셀도 고객카드와 같은 순서로 협약일을 읽는다(index.html 실제 함수, 가짜 데이터)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const slice=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>0&&j>i,a);return html.slice(i,j);};
const code=slice('  function resolveMouDateText(','  // 한국 시간(Asia/Seoul)');
function run(co){
  const ctx={D:{isAgreementInvalidated:c=>!!c.invalid},
    findStageCorrection:c=>c.corr||null,Date,
    parsePartnerDateLabel:s=>{const m=/^(\d\d)\.(\d\d)\.(\d\d)$/.exec(s||'');return m?{ts:new Date(2000+ +m[1],m[2]-1,+m[3]).getTime()}:null;},resolveNewMouForCompany:c=>c.nm||null,resolvePartnerAgreementDate:c=>c.old||null};
  vm.runInNewContext(code+';this.f=resolveMouDateText;',ctx);return ctx.f(co);
}
test('카드에서 정정한 협약일이 가장 먼저',()=>{
  assert.equal(run({corr:{status:'done',dateText:'2026.03.02'},nm:{mouDone:true,mouLabel:'25.01.01'},old:'2019-07-24'}),'2026.03.02');
});
test('카드에서 완료 취소했으면 옛 명단 날짜를 쓰지 않음',()=>{
  assert.equal(run({corr:{status:'waiting'},old:'2019-07-24'}),null);
});
test('정정 없으면 MOU 체결 기록, 그것도 없으면 옛 명단 체결일',()=>{
  assert.equal(run({nm:{mouDone:true,mouLabel:'26.05.20'},old:'2019-07-24'}),'26.05.20');
  assert.equal(run({old:'2019-07-24'}),'2019-07-24');
  assert.equal(run({}),null);
});
test('1·2차 미팅 없이 MOU 날짜만 적힌 업체(체결 표시 없음)도 지난 날짜면 표기, 미래 날짜는 안 함',()=>{
  assert.equal(run({nm:{mouDone:false,mouLabel:'25.11.07'}}),'25.11.07');
  assert.equal(run({nm:{mouDone:false,mouLabel:'99.12.31'}}),null);
});
test('협약 무효 업체는 표시 안 함',()=>{ assert.equal(run({invalid:true,old:'2019-07-24'}),null); });
test('PDF·MOU 엑셀 내보내기 둘 다 이 함수를 쓴다',()=>{
  assert.match(html,/case 'mouDate': return resolveMouDateText\(co\) \|\| '-';/);
  assert.match(html,/      mouDate: resolveMouDateText\(co\) \|\| '-',/);
});
