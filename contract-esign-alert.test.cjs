// §계약서 2종 준비 — 노란 알림은 기존 알림 저장·확인 처리를 그대로 쓴다(website-cleanup.js 실제 코드, 가짜 업체만 사용)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const ctx={module:{exports:{}}};vm.runInNewContext(fs.readFileSync(__dirname+'/website-cleanup.js','utf8'),ctx);const A=ctx.module.exports;
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const actor={uid:'test',label:'테스트 담당자'},now='2026-11-02T06:00:00Z';
const item={id:'mou-signed:doc-1',type:'mouSigned',companyId:'co-1',companyName:'시험건설',occurredAt:now,counterpartySignedAt:now,sendId:'s1',docType:'mou',modusignDocumentId:'doc-1',completedAt:null};
const company={id:'co-1',name:'시험건설',agreementStatus:'active',partnerDashboard:{newMou:{mouDone:false}}};

test('확인 처리는 알림만 완료하고 업체·MOU 상태·활동 기록을 바꾸지 않는다',()=>{
  const state={companies:[company],customerActivities:[],websiteCleanup:[item]};
  const r=A.apply(state,{kind:'complete',id:item.id},actor,now);
  assert.equal(r.state.websiteCleanup[0].completedAt,now);
  assert.equal(r.state.websiteCleanup[0].completedBy,actor.label);
  assert.deepEqual(Array.from(r.changed),['websiteCleanup']);
  assert.equal(JSON.stringify(r.state.companies[0]),JSON.stringify(company));
  assert.equal(r.state.customerActivities.length,0);
});
test('확인을 반복해도 처음 시각이 유지된다(재전송·중복 클릭)',()=>{
  const done=Object.assign({},item,{completedAt:now});
  const r=A.apply({companies:[],customerActivities:[],websiteCleanup:[done]},{kind:'complete',id:item.id},actor,'2026-12-01T00:00:00Z');
  assert.equal(r.state.websiteCleanup[0].completedAt,now);assert.equal(r.changed.length,0);
});
test('회사 이벤트 처리기가 서명 알림을 건드리지 않는다',()=>{
  const r=A.applyEvents({value:[item],processedEvents:{[item.id]:true}},[company],actor,now);
  assert.equal(r.changed,false);assert.equal(r.value[0].completedAt,null);
});
test('알림 제목과 버튼 연결',()=>{
  assert.equal(A.TYPES.mouSigned.title,'MOU 상대방 서명 완료');
  assert.equal(A.TYPES.mouSigned.checks.length,0);
  const ui=fs.readFileSync(__dirname+'/website-cleanup-ui.js','utf8');
  assert.ok(ui.includes('문서 보기')&&ui.includes('상대방 서명 완료일'));
  new vm.Script(ui);new vm.Script(fs.readFileSync(__dirname+'/contract-esign.js','utf8'));
});
test('index.html: 준비 버튼과 스크립트 연결, 개인 인증은 메모리에만',()=>{
  assert.ok(html.includes('id="cesignOpenBtn"'));
  assert.ok(html.includes('src="contract-esign.js"')&&html.includes('src="contractEsignConfig.js"')&&html.includes('href="contract-esign.css"'));
  assert.ok(html.includes('setPersistence(contractSenderAuth, inMemoryPersistence)'));
});
