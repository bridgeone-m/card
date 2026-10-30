// §기본정보 연락처 라운드 — 기업 요약에 연락처·사업자등록번호 표시(공식 필드 우선, 없으면 '미등록', 원본 불변)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){const sig=html.indexOf('function '+name+'(');assert.ok(sig>0,name);const start=html.lastIndexOf('\n',sig)+1,end=html.indexOf('\n  }',sig);return html.slice(start,end+4);}

function render(co){
  const listeners=[];
  const wrap={innerHTML:'',querySelectorAll:()=>[{getAttribute:()=>'',addEventListener:(t,f)=>listeners.push(f)}]};
  const ctx={String,Array,
    document:{getElementById:id=>id==='cdashCompanySummaryCard'?wrap:null},
    esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
    cinfoIcon:n=>`<i data-ico="${n}"></i>`,
    buildTopCategoriesText:()=>'재도장, 우레탄',
    parseMapRegion:a=>a?'서울':null,
    getCompanyGrade:()=>null,copyText:()=>{}};
  vm.runInNewContext(fn('renderCompanySummaryCard'),ctx);
  ctx.renderCompanySummaryCard(co);
  const rows=[...wrap.innerHTML.matchAll(/<div class="cosum-label">([^<]+)<\/div><div class="cosum-value[^"]*"><span class="cosum-value-text">([^<]*)<\/span>(<button[^>]*data-cosum-copy="([^"]*)")?/g)]
    .map(m=>({label:m[1],value:m[2],copy:m[4]||null}));
  return rows;
}

test('9개 항목이 정해진 순서로, 휴대폰·회사 연락처는 따로 표시',()=>{
  const co={repName:'홍길동',contactName:'김철수',mobile:'010-0000-0000',phone:'02-000-0000',email:'example@example.com',bizRegNo:'000-00-00000',address:'서울특별시 ○○구'};
  const rows=render(co);
  assert.deepEqual(rows.map(r=>r.label),['대표','담당자','휴대폰','회사 연락처','이메일','사업자등록번호','지역','주요 공종','주소']);
  const v=Object.fromEntries(rows.map(r=>[r.label,r.value]));
  assert.equal(v['휴대폰'],'010-0000-0000');assert.equal(v['회사 연락처'],'02-000-0000');
  assert.equal(v['사업자등록번호'],'000-00-00000');assert.equal(v['담당자'],'김철수');
});
test('복사 버튼은 휴대폰·회사 연락처·사업자등록번호에만, 값이 있을 때만',()=>{
  const rows=render({mobile:'010-1111-2222',phone:'',bizRegNo:'123-45-67890'});
  assert.deepEqual(rows.filter(r=>r.copy).map(r=>[r.label,r.copy]),[['휴대폰','010-1111-2222'],['사업자등록번호','123-45-67890']]);
});
test('값이 없으면 미등록, mobile이 비어도 phone을 휴대폰에 끌어오지 않음',()=>{
  const v=Object.fromEntries(render({phone:'031-123-4567'}).map(r=>[r.label,r.value]));
  assert.equal(v['휴대폰'],'미등록');assert.equal(v['회사 연락처'],'031-123-4567');
  ['대표','담당자','이메일','사업자등록번호','지역','주소'].forEach(k=>assert.equal(v[k],'미등록',k));
});
test('공식 필드 우선, 비었을 때만 partnerDashboard 보조값(PDF 내보내기와 같은 순서)',()=>{
  const pd={ceo:'보조대표',bizno:'999-99-99999',email:'pd@x.kr',phone:'02-999-9999'};
  const a=Object.fromEntries(render({repName:'공식대표',bizRegNo:'111-11-11111',email:'co@x.kr',phone:'02-111-1111',partnerDashboard:pd}).map(r=>[r.label,r.value]));
  assert.equal(a['대표'],'공식대표');assert.equal(a['사업자등록번호'],'111-11-11111');assert.equal(a['이메일'],'co@x.kr');assert.equal(a['회사 연락처'],'02-111-1111');
  const b=Object.fromEntries(render({partnerDashboard:pd}).map(r=>[r.label,r.value]));
  assert.equal(b['대표'],'보조대표');assert.equal(b['사업자등록번호'],'999-99-99999');assert.equal(b['회사 연락처'],'02-999-9999');assert.equal(b['휴대폰'],'미등록');
});
test('표시만 — 업체 객체를 바꾸지 않음',()=>{
  const co={repName:'홍',mobile:'010-1',partnerDashboard:{bizno:'1'}};const before=JSON.stringify(co);
  render(co);assert.equal(JSON.stringify(co),before);
});
