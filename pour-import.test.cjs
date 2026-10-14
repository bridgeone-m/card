// §실적 Excel 업로드 — 머리글 인식, 연도/월 추출, 중복·업체 확인 분류, 추가만 하는 병합(index.html의 실제 함수 사용)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){const sig=html.indexOf('function '+name+'(');assert.ok(sig>0,name);const start=html.lastIndexOf('\n',sig)+1,end=html.indexOf('\n  }',sig);return html.slice(start,end+4);}
function constBlock(name){const i=html.indexOf('const '+name+' = ');assert.ok(i>0,name);let depth=0,j=html.indexOf('=',i)+1;for(;j<html.length;j++){const ch=html[j];if('([{'.includes(ch))depth++;else if(')]}'.includes(ch))depth--;else if(ch===';'&&depth===0)break;}return html.slice(i,j+1).replace('const ','var ');}

const J=x=>JSON.parse(JSON.stringify(x));
const norm=s=>String(s||'').replace(/\(주\)|㈜|주식회사|\s+/g,'').toLowerCase();
const ctx={Date,Math,String,Set,Map,Array,Object,parseInt,isFinite,normCompanyNameForPour:norm};
ctx.D={normCompanyName:norm};
vm.runInNewContext([constBlock('POUR_IMPORT_HEADERS'),fn('pourImportHeaderKey'),fn('pourImportMapHeader'),fn('pourImportYearFrom'),fn('pourImportMonthFrom'),
  fn('parsePourImportSheets'),fn('previewPourImport'),fn('pourImportContentKey'),fn('mergePourImportRecords')].join('\n'),ctx);
ctx.D.pourImportContentKey=ctx.pourImportContentKey;

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
