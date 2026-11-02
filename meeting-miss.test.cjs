const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){const start=html.indexOf('  function '+name+'(');assert.ok(start>0,name);const end=html.indexOf('\n  }',start);return html.slice(start,end+4);}
const cst=name=>html.match(new RegExp('  const '+name+' = [^;]+;'))[0];
const NOW=new Date(2026,10,20,12).getTime();
class FixedDate extends Date{constructor(...a){if(a.length)super(...a);else super(NOW);}static now(){return NOW;}}
const FNS=['esc','getMouManualConfirm','isMouManuallyConfirmedRaw','isMouManuallyConfirmed','isAgreementInvalidated','isAgreementTerminated','parsePartnerDateLabel','normCompanyNameForPartnerMatch','getPartnerNameIndex','findPartnerRecordForCompany','resolveNewMouForCompany','resolvePartnerAgreementDate','getStageCorrections','findStageCorrection','stageCorrectionToStateFields','buildProgressStages','getMouStage','isConfirmedPartner','classifyWorkQueueMeeting','meetingMissTextKind','meetingCoordSince','classifyMeetingMiss','collectMeetingMiss','fmtAlarmMd','meetingMissIndex','meetingMissBadgeHtml'];
const co=(id,nm,x)=>Object.assign({id:'c'+id,name:'시험'+id,partnerDashboard:{newMou:nm}},x||{});
const LIST=[co(1,{qReplyLabel:'26.10.01'}),co(2,{qReplyLabel:'26.11.10'}),co(3,{qReplyLabel:'26.10.01',m1ScheduledLabel:'26.11.10'}),co(4,{qReplyLabel:'26.10.01',m1ScheduledLabel:'26.11.19'}),
  co(6,{qReplyLabel:'26.10.01',m1Label:'일정 조율중(11.01)'}),co(7,{qReplyLabel:'26.10.01',m1Label:'일정 조율중(10.01)'}),co(8,{qReplyLabel:'26.10.01',m1Label:'양산지사'}),
  co(9,{qReplyLabel:'26.10.01',m1Label:'26.10.05',m1Done:true,mouDone:true,mouLabel:'26.10.20'}),co(10,{qReplyLabel:'26.10.01',m1Label:'26.10.05',m1Done:true}),
  co(11,{qReplyLabel:'26.10.01'},{agreementStatus:'terminated'}),co(12,{qReplyLabel:'26.10.01'},{deletedAt:'x'}),co(13,{qReplyLabel:'26.10.01',m1Label:'??'})];
function ctx(){const c={Date:FixedDate,window:{SHIN2_PARTNER_SNAPSHOT:[]},LIST};vm.runInNewContext(['let _partnerNameIndexCache=null;function questionnaireMailSentLabel(){return null;}',
  cst('MEETING_MISS_GRACE_DAYS'),cst('MEETING_REG_LIMIT_DAYS'),cst('MEETING_COORD_LIMIT_DAYS'),cst('MEETING_LABEL'),cst('MEETING_CHECK_LABEL'),cst('isMeetingMissRow'),...FNS.map(fn),
  'const D={isAgreementInvalidated,isMouManuallyConfirmed,isAgreementTerminated,loadActiveCompanies:()=>LIST.filter(c=>!c.deletedAt)};',
  'this.api={classify:c=>classifyMeetingMiss(c,buildProgressStages(c),Date.now()),index:meetingMissIndex,badge:meetingMissBadgeHtml};'].join('\n'),c);return c.api;}
const st=(api,c)=>api.classify(c).map(r=>r.key+':'+r.status).join(',');
test('미팅 누락 판정: 누락·등록 지연·대기·예정·완료·예외·확인 필요',()=>{const a=ctx(),by=id=>st(a,LIST.find(c=>c.id===id));
  assert.equal(by('c1'),'m1:late');assert.equal(by('c2'),'m1:waiting');assert.equal(by('c3'),'m1:missed');assert.equal(by('c4'),'m1:scheduled');
  assert.equal(by('c6'),'m1:coord');assert.equal(by('c7'),'m1:late');assert.equal(by('c8'),'m1:branch');assert.equal(by('c9'),'m1:done,m2:exempt');
  assert.equal(by('c10'),'m1:done,m2:late');assert.equal(by('c11'),'');assert.equal(by('c13'),'m1:format');});
test('업무 표 필터용 색인: 누락·등록 지연과 일정 확인만, 삭제 업체 제외',()=>{const idx=ctx().index(),miss=[],check=[];
  idx.forEach((rows,id)=>rows.forEach(r=>(r.status==='missed'||r.status==='late'?miss:check).push(id+':'+r.key+':'+r.status)));
  assert.equal(JSON.stringify(miss.sort()),JSON.stringify(['c10:m2:late','c1:m1:late','c3:m1:missed','c7:m1:late']));
  assert.equal(JSON.stringify(check.sort()),JSON.stringify(['c13:m1:format','c6:m1:coord','c8:m1:branch']));assert.ok(!idx.has('c12')&&!idx.has('c2')&&!idx.has('c4'));});
test('업체명 아래 안내 문구',()=>{const a=ctx(),idx=a.index();
  assert.match(a.badge(idx.get('c3')),/1차 미팅 누락 · 예정 11\.10 · 10일 지남/);assert.match(a.badge(idx.get('c3')),/is-miss/);
  assert.match(a.badge(idx.get('c7')),/1차 미팅 등록 지연 · 일정 조율중\(10\.01\) · 50일째/);
  assert.match(a.badge(idx.get('c8')),/1차 미팅 지사 진행</);assert.doesNotMatch(a.badge(idx.get('c8')),/is-miss/);assert.equal(a.badge(undefined),'');});
test('판정은 데이터를 바꾸지 않음',()=>{const before=JSON.stringify(LIST);ctx().index();assert.equal(JSON.stringify(LIST),before);});
test('앱 스크립트 문법',()=>{const i=html.indexOf('window.SHIN2_CRM_APP_INIT = function(){');const s=html.lastIndexOf('<script>',i)+8,e=html.indexOf('</script>',i);new vm.Script(html.slice(s,e));});
