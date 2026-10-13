// §내보내기 화면 개편 라운드 — 엑셀(xlsx) 생성기와 외부용 공개 제한 검증(index.html의 실제 함수 사용)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),zlib=require('zlib');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){const sig=html.indexOf('function '+name+'(');assert.ok(sig>0,name);const start=html.lastIndexOf('\n',sig)+1,end=html.indexOf('\n  }',sig);return html.slice(start,end+4);}
function constBlock(name){const i=html.indexOf('const '+name+' = ');assert.ok(i>0,name);let depth=0,j=html.indexOf('=',i)+1;for(;j<html.length;j++){const ch=html[j];if('([{'.includes(ch))depth++;else if(')]}'.includes(ch))depth--;else if(ch===';'&&depth===0)break;}return html.slice(i,j+1).replace('const ','var ');}

const X={TextEncoder,Uint8Array,Uint32Array,String,Math};
vm.runInNewContext([constBlock('XLSX_CRC_TABLE'),fn('xlsxEscXml'),fn('xlsxColName'),fn('buildXlsxSheetXml'),fn('xlsxCrc32'),fn('xlsxZipStore'),fn('buildXlsxBytes')].join('\n'),X);

// 무압축 zip 읽기(검증용)
function unzip(buf){
  const b=Buffer.from(buf);const files={};let eocd=b.lastIndexOf(Buffer.from([0x50,0x4B,0x05,0x06]));assert.ok(eocd>0,'EOCD');
  const n=b.readUInt16LE(eocd+10),cdOff=b.readUInt32LE(eocd+16);let p=cdOff;
  for(let i=0;i<n;i++){assert.equal(b.readUInt32LE(p),0x02014b50);const method=b.readUInt16LE(p+10),crc=b.readUInt32LE(p+16),size=b.readUInt32LE(p+20),nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),lo=b.readUInt32LE(p+42);
    const name=b.slice(p+46,p+46+nl).toString('utf8');const lnl=b.readUInt16LE(lo+26),lel=b.readUInt16LE(lo+28);const data=b.slice(lo+30+lnl+lel,lo+30+lnl+lel+size);
    assert.equal(method,0);assert.equal(zlib.crc32?zlib.crc32(data):crc,crc,'CRC '+name);files[name]=data.toString('utf8');p+=46+nl+el+cl;}
  return files;
}
test('xlsx: 필수 파일, 머리글 고정, 자동 필터, 열 너비, 문자열 셀(앞자리 0 보존)',()=>{
  const bytes=X.buildXlsxBytes('MOU 체결 업체 목록',['번호','업체명','연락처','사업자번호','업체코드'],
    [[{n:1},{s:'(주)한솔&<테스트>'},{s:'010-0123-4567'},{s:'012-34-56789'},{s:'B2B007'}],[{n:2},{s:'둘째'},{s:'0212345678'},{s:''},{s:'00123'}]],[6,26,16,15,12]);
  const f=unzip(bytes);
  for(const k of ['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/worksheets/sheet1.xml'])assert.ok(f[k],k);
  const sh=f['xl/worksheets/sheet1.xml'];
  assert.match(sh,/<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sh,/<autoFilter ref="A1:E3"\/>/);
  assert.match(sh,/<col min="2" max="2" width="26" customWidth="1"\/>/);
  assert.match(sh,/<t xml:space="preserve">010-0123-4567<\/t>/);
  assert.match(sh,/<t xml:space="preserve">0212345678<\/t>/);
  assert.match(sh,/<t xml:space="preserve">00123<\/t>/);
  assert.match(sh,/<c r="A2"><v>1<\/v><\/c>/);
  assert.match(sh,/\(주\)한솔&amp;&lt;테스트&gt;/);
  assert.match(f['xl/workbook.xml'],/<sheet name="MOU 체결 업체 목록"/);
  assert.match(f['xl/workbook.xml'],/_xlnm._FilterDatabase/);
});

// 외부용 공개 제한 — 외부 허용 목록 밖의 항목은 체크 상태에 들어가도 출력되지 않음
const typesSrc=constBlock('PDF_EXPORT_TYPES'),labelsSrc=constBlock('PDF_EXPORT_COLUMN_LABELS');
function exportCtx(state){
  const c={pdfExportState:state,PDF_INTERNAL_ALWAYS_COLS:['name'],PDF_EXPORT_REQUIRED_COLUMNS:['no','region','name','repName','address','phone']};
  vm.runInNewContext([typesSrc,labelsSrc,fn('pdfExportTypeColumns'),fn('pdfExportVisibleColumns'),
    'function pdfExportResolveField(co,key,i){ if(key==="no") return String(i+1); return co[key]==null||co[key]===""?"-":String(co[key]); }',fn('pdfExportXlsxTable')].join('\n'),c);
  return c;
}
const companies=[{name:'가업체',region:'서울',repName:'김',address:'서울시',phone:'010-1',email:'a@a.com',bizRegNo:'012-34',fax:'02-1',note:'내부메모'}];
test('외부 발송용: 외부 허용 항목만(내부 항목을 체크 집합에 넣어도 불가), 업체명 필수',()=>{
  const c=exportCtx({type:'external',extCols:new Set(['phone','email','bizRegNo','note'])});
  const type=c.PDF_EXPORT_TYPES.find(t=>t.key==='external');
  const cols=c.pdfExportVisibleColumns(type,companies);
  assert.equal(JSON.stringify(cols),JSON.stringify(['name','phone']));
  const t=c.pdfExportXlsxTable({columns:cols,companies});
  assert.equal(JSON.stringify(t.headers),JSON.stringify(['업체명','연락처']));
  const flat=JSON.stringify(t.rows);for(const secret of ['a@a.com','012-34','02-1','내부메모'])assert.ok(!flat.includes(secret),'외부용에 '+secret+' 없음');
});
test('외부 발송용 허용 목록 자체에 내부 전용 항목이 없음',()=>{
  const c=exportCtx({type:'external'});const ext=c.PDF_EXPORT_TYPES.find(t=>t.key==='external').columns;
  for(const k of ['bizRegNo','email','fax','mouDate','capital','note'])assert.ok(!ext.includes(k),k);
});
test('내부용: 체크한 항목 반영, 번호는 숫자 셀',()=>{
  const c=exportCtx({type:'internal',cols:new Set(['no','email','bizRegNo'])});
  const type=c.PDF_EXPORT_TYPES.find(t=>t.key==='internal');
  const cols=c.pdfExportVisibleColumns(type,companies);
  assert.equal(JSON.stringify(cols),JSON.stringify(['no','name','bizRegNo','email']));
  const t=c.pdfExportXlsxTable({columns:cols,companies});
  assert.equal(JSON.stringify(t.rows[0]),JSON.stringify([{n:1},{s:'가업체'},{s:'012-34'},{s:'a@a.com'}]));
});
test('열 때마다 외부 발송용으로 시작(코드 확인)',()=>{
  const open=fn('openPdfExportModal');assert.match(open,/type:'external'/);assert.doesNotMatch(open,/type:'internal'/);
});
