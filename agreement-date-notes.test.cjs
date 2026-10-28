const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){const i=html.indexOf('  function '+name+'(');assert.ok(i>=0,name);return html.slice(i,html.indexOf('\n  }',i)+4);}
test('협약일만 저장해도 완료: 이전 취소 정정과 다른 미팅 기록 보존',()=>{
 const co={id:'test',partnerDashboard:{newMou:{qReplyLabel:'26.01.01',m1Label:'26.01.03',mouDone:false},stageCorrections:{mouDone:{status:'waiting'},m1Done:{status:'done'}},stageCorrectionLog:[]}};
 let patch;const c={D:{findCompany:()=>co,updateCompany:(id,p)=>patch=p},Date,Math,workqDateInputToLabel:x=>x.replaceAll('-','.'),workqTodayLabel:()=>'',crmCurrentUserLabel:()=> 'test user',getStageCorrectionLog:()=>[],window:{WebsiteCleanup:{eventPatch:()=>({})}},workqLogActivity:()=>{},DEAL_M_STATUS_LABELS:[],DEAL_MOU_STATUS_LABELS:[['done','체결 완료']]};
 vm.runInNewContext(fn('applyDealStageValues'),c);
 c.applyDealStageValues('test',{m1s:'undetermined',m2s:'undetermined',mous:'none',moud:'2026-10-28'});
 assert.equal(patch.partnerDashboard.newMou.mouDone,true);
 assert.equal(patch.partnerDashboard.mouDate,'2026.10.28');
 assert.equal(patch.partnerDashboard.stageCorrections.mouDone.status,'done');
 assert.equal(patch.partnerDashboard.newMou.m1Label,'26.01.03');
 assert.equal(patch.partnerDashboard.stageCorrectionLog[0].before.status,'waiting');
});
test('날짜 정정 저장은 MOU 완료와 날짜를 한 번에 저장, 삭제는 재체결하지 않음',()=>{
 const co={partnerDashboard:{newMou:{mouDone:false},stageCorrections:{}}};let patches=[];
 const c={D:{findCompany:()=>co,updateCompanyReturningAll:(id,p)=>{patches.push(p);return {rec:p,list:[p]};}},Date,Math,crmCurrentUserLabel:()=> 'test',getStageCorrectionLog:()=>[],window:{WebsiteCleanup:{eventPatch:()=>({})}},isConfirmedPartner:()=>true,buildProgressStages:()=>({})};
 vm.runInNewContext(fn('saveStageCorrection'),c);
 c.saveStageCorrection('test','mouDone',{status:'waiting',dateText:'2026.10.28'},{});
 assert.equal(patches.length,1);assert.equal(patches[0].partnerDashboard.newMou.mouDone,true);
 assert.equal(patches[0].partnerDashboard.stageCorrections.mouDone.status,'done');
 c.saveStageCorrection('test','mouDone',{status:'waiting',dateText:''},{});
 assert.equal(patches[1].partnerDashboard.newMou.mouDone,false);
});
function notesContext(){
 const docs=[{id:'q',consultReview:{secondMeetingPreparation:{memo:'기존 준비 내용'},requestedMaterialsAfterMeeting:{memo:'기존 요청',completedAt:'2026-10-01'}}}];let saves=0;
 const c={CONSULT_REVIEW_RATED:[],CONSULT_REVIEW_CHOICE:[],CONSULT_INTEREST_POINTS:[],loadDocuments:()=>docs,saveDocuments:()=>saves++,nowIso:()=> '2026-10-28',normalizeQuestionnaireRating:x=>x};
 vm.runInNewContext(['emptyConsultReview','readConsultReview','sameConsultReview','setDocumentConsultReview'].map(fn).join('\n'),c);return {c,docs,get saves(){return saves;}};
}
test('기타 메모 저장·재조회·수정·삭제, 기존 요청자료 완료 상태 보존',()=>{
 const s=notesContext();assert.equal(s.c.readConsultReview(s.docs[0]).otherNotes.memo,'');
 s.c.setDocumentConsultReview('q',{otherNotes:{memo:'자유 메모\n다음 줄'}});
 const restored=s.c.readConsultReview(JSON.parse(JSON.stringify(s.docs[0])));
 assert.equal(restored.otherNotes.memo,'자유 메모\n다음 줄');assert.equal(restored.secondMeetingPreparation.memo,'기존 준비 내용');
 assert.equal(restored.requestedMaterialsAfterMeeting.completedAt,'2026-10-01');assert.equal(restored.requestedMaterialsAfterMeeting.pending,false);
 assert.equal(s.c.setDocumentConsultReview('q',{otherNotes:{memo:'자유 메모\n다음 줄'}}).changed,false);
 s.c.setDocumentConsultReview('q',{otherNotes:{memo:''}});assert.equal(s.docs[0].consultReview.otherNotes.memo,'');assert.equal(s.saves,2);
});
test('기타 메모 입력·초기 복원·변경 감지·기존 클라우드 저장 연결',()=>{
 assert.ok(fn('consultReviewFormHtml').includes('data-crv-memo="otherNotes"'));
 assert.ok(html.includes("out.otherNotes = { memo:r.otherNotes.memo.trim() };"));
 assert.ok(html.includes('draft.otherNotes.memo,'));
 assert.ok(html.includes('confirmDocsCloudSave(localResult.list)'));
});
