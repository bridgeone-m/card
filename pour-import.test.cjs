// §실적 Excel 업로드 — 머리글 인식, 연도/월 추출, 중복·업체 확인 분류, 추가만 하는 병합(index.html의 실제 함수 사용)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){const sig=html.indexOf('function '+name+'(');assert.ok(sig>0,name);const start=html.lastIndexOf('\n',sig)+1,end=html.indexOf('\n  }',sig);return html.slice(start,end+4);}
function constBlock(name){const i=html.indexOf('const '+name+' = ');assert.ok(i>0,name);let depth=0,j=html.indexOf('=',i)+1;for(;j<html.length;j++){const ch=html[j];if('([{'.includes(ch))depth++;else if(')]}'.includes(ch))depth--;else if(ch===';'&&depth===0)break;}return html.slice(i,j+1).replace('const ','var ');}

const J=x=>JSON.parse(JSON.stringify(x));
const norm=s=>String(s||'').replace(/\(주\)|㈜|주식회사|\s+/g,'').toLowerCase();
const ctx={Date,Math,String,Set,Map,Array,Object,parseInt,isFinite,normCompanyNameForPour:norm};
ctx.D={normCompanyName:norm,normCompanyNameForPour:norm};
vm.runInNewContext([constBlock('POUR_IMPORT_HEADERS'),fn('pourImportHeaderKey'),fn('pourImportMapHeader'),fn('pourImportYearFrom'),fn('pourImportMonthFrom'),
  fn('parsePourImportSheets'),fn('previewPourImport'),fn('pourImportContentKey'),fn('mergePourImportRecords'),fn('pourImportSiteKey')].join('\n'),ctx);
ctx.D.pourImportContentKey=ctx.pourImportContentKey;ctx.D.pourImportSiteKey=ctx.pourImportSiteKey;

const sheet={name:'2026년',rows:[
  ['2026년 POUR 시공실적 리스트'],
  ['No','업체명','공종','지역','시/군','현장명','세대수','특허번호','업체코드'],
  [1,'㈜한솔건설','슬라브\n재도장','경기','평택','비전아파트','1,200','제10-1호','B2B001'],
  [2,'두레이엔씨','우레탄','경기','부천','옥길 센트리뷰','717','',''],
  [3,'','','','','','','',''],
  [4,'동명건설','방수','서울','강남','A단지',300,'',''],
  [5,'없는업체','방수','부산','해운대','B단지',100,'',''],
  [6,'㈜한솔건설','슬라브\n재도장','경기','평택','비전 아파트','1200','',''],
]};

test('머리글 줄을 찾아 열을 맞추고, 시트 이름에서 연도를 읽는다(업체코드 열은 업체명으로 오인하지 않음)',()=>{
  const r=ctx.parsePourImportSheets([sheet,{name:'메모',rows:[['아무거나']]}],'9월실적.xlsx',2026);
  assert.equal(r.rows.length,5);
  const a=r.rows[0];
  assert.equal(a.company,'㈜한솔건설');assert.equal(a.client,'비전아파트');assert.equal(a.year,2026);
  assert.equal(a.households,1200);assert.equal(a.city,'평택');assert.equal(a.patentNo,'제10-1호');assert.equal(a.sourceRow,3);
  assert.ok(r.sheets.find(x=>x.sheetName==='메모').skipped);
});

test('연도·일자 열: 엑셀 날짜, 2자리 연도, 월 추출, 연도 없으면 지정 연도(*)',()=>{
  const r=ctx.parsePourImportSheets([{name:'Sheet1',rows:[['시공사','현장명','계약일'],['가건설','X',new Date(2025,8,3)],['나건설','Y','26.10.1'],['다건설','Z','']]}],'f.xlsx',2027);
  assert.deepEqual(J(r.rows.map(x=>[x.year,x.month,x.yearGuessed])),[[2025,9,false],[2026,10,false],[2027,null,true]]);
  assert.equal(ctx.pourImportYearFrom(46000),2025);
});

test('분류: 기존 실적과 같은 건은 중복, 파일 안 반복은 파일 내 중복, 동명 업체 여럿은 업체 확인 필요',()=>{
  const r=ctx.parsePourImportSheets([sheet],'f.xlsx',2026);
  const existing=new Set([ctx.pourImportContentKey({company:'두레이엔씨㈜',year:2026,client:'옥길센트리뷰',category:'우레탄'})]);
  const companies=[{id:'1',name:'한솔건설'},{id:'2',name:'동명건설'},{id:'3',name:'(주)동명건설'},{id:'4',name:'두레이엔씨'}];
  const p=ctx.previewPourImport(r.rows,existing,companies);
  assert.deepEqual(J(p.items.map(x=>x.status)),['신규','중복','업체 확인 필요','CRM 미등록 업체','파일 내 중복']);
  assert.equal(p.saveCount,2);
});

test('병합은 추가만: 기존·클라우드 실적을 하나도 빼지 않고, 같은 실적은 한 번만',()=>{
  const old=[{company:'가',year:2025,client:'A',category:'방수',importBatchId:'b1'}];
  const remote=[{company:'나',year:2025,client:'B',category:''},{company:'가',year:2025,client:' A',category:'방수'}];
  const add=[{company:'다',year:2026,client:'C',category:''},{company:'나',year:2025,client:'B',category:''}];
  const m=ctx.mergePourImportRecords(old,remote,add);
  assert.equal(m.length,3);assert.equal(m[0],old[0]);
  assert.equal(ctx.mergePourImportRecords(m,null,add).length,3);
});

// §실제 POUR 실적 List 형식 — 업체명 머리글이 없고 표 오른쪽 이름 없는 열에 시공사, 데이터 칸에 "업체선정"·"현장 설명회" 같은 글자
const pourList={name:'2023년',rows:[
  [],['2023년도 POUR공법 실적 List'],[],
  ['순번','공종','지역','도시','특허번호','발주처(아파트 명)','공   사   명','공사범위','전화번호','세대수','공사 품질'],
  [1,'재도장','충남','서산','제10-1호','서산 한라비발디아파트 ','아파트 균열보수 및 재도장공사 업체선정 입찰공고','가. 현장 설명회 참가 업체에 한하여 교부','041',845,'','㈜석민이앤씨'],
  [2,'재도장','부산','진구','제10-2호','백양산삼정그린코아아파트','외벽 재도장공사 업체 선정 입찰공고','','051',215,'','가나랜드㈜'],
]};
const noCompany={name:'2022년',rows:pourList.rows.map(r=>r.slice(0,11))};
test('POUR 실적 List: 현장명=발주처(아파트명), 업체명=이름 없는 오른쪽 열 — 공사명/공사범위를 업체·현장으로 쓰지 않음',()=>{
  const r=ctx.parsePourImportSheets([pourList,noCompany],'f.xlsx',2026);
  assert.deepEqual(J(r.rows.map(x=>[x.company,x.client,x.year,x.households])),[['㈜석민이앤씨','서산 한라비발디아파트',2023,845],['가나랜드㈜','백양산삼정그린코아아파트',2023,215]]);
  const skip=r.sheets.find(x=>x.sheetName==='2022년');assert.ok(skip.skipped);assert.match(skip.skipReason,/시공사/);
});
test('중복: 업체명 표기만 다른(앤씨/엔씨) 같은 연도·현장·공종 실적도 중복으로 막는다',()=>{
  ctx.D.pourImportSiteKey=ctx.pourImportSiteKey;
  const existing=new Set([ctx.pourImportSiteKey({company:'두레이엔씨㈜',year:2026,client:'옥길 센트리뷰아파트',category:'우레탄\n재도장'})]);
  const p=ctx.previewPourImport([{company:'두레이앤씨㈜',year:2026,client:'옥길 센트리뷰아파트 ',category:'우레탄\r\n재도장'}],existing,[]);
  assert.equal(p.items[0].status,'중복');assert.equal(p.saveCount,0);
});
test('되돌리기: 그 업로드 실적만 빠지고, 다른 컴퓨터에 남은 같은 업로드가 다시 합쳐져도 살아나지 않음',()=>{
  const a={company:'가',year:2026,client:'A',category:'',importBatchId:'b1'},b={company:'나',year:2026,client:'B',category:'',importBatchId:'b2'};
  const undone=ctx.mergePourImportRecords([a,b],null,[{removedBatchId:'b1'}]);
  assert.deepEqual(J(undone.filter(r=>!r.removedBatchId).map(r=>r.company)),['나']);
  const again=ctx.mergePourImportRecords([a,b],undone,[]);
  assert.deepEqual(J(again.filter(r=>!r.removedBatchId).map(r=>r.company)),['나']);
});

test('업체명 앤/엔 표기 차이는 같은 업체로 본다(실적 매칭 전용) — CRM "두레이엔씨"에 "두레이앤씨㈜" 실적이 연결',()=>{
  const c2={};vm.runInNewContext(fn('normCompanyName')+'\n'+html.split('\n').find(l=>l.includes('function normCompanyNameForPour(s)')),c2);
  assert.equal(c2.normCompanyNameForPour('두레이앤씨㈜'),c2.normCompanyNameForPour('두레이엔씨'));
  assert.equal(c2.normCompanyNameForPour('㈜풍전이앤씨'),c2.normCompanyNameForPour('풍전이엔씨'));
  assert.notEqual(c2.normCompanyName('두레이앤씨'),c2.normCompanyName('두레이엔씨')); // 일반 정규화는 그대로
  const save=ctx.D.normCompanyNameForPour;ctx.D.normCompanyNameForPour=c2.normCompanyNameForPour;
  const p=ctx.previewPourImport([{company:'두레이앤씨㈜',year:2026,client:'새현장',category:'재도장'}],new Set(),[{id:'1',name:'두레이엔씨'}]);
  ctx.D.normCompanyNameForPour=save;
  assert.equal(p.items[0].status,'신규');assert.equal(p.items[0].companyName,'두레이엔씨');
});
