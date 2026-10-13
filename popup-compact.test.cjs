// §상세 팝업 compact 라운드 — 활동 문구 표시 정리 / 최근 5개월 그래프 데이터 검증(원본 데이터 불변)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
function fn(name){const sig=html.indexOf('function '+name+'(');assert.ok(sig>0,name);const start=html.lastIndexOf('\n',sig)+1,end=html.indexOf('\n  }',sig);return html.slice(start,end+4);}
function constLine(name){const m=html.match(new RegExp('const '+name+' = [^\\n]+'));assert.ok(m,name);return m[0].replace('const ','var ');}

const ctx={String};vm.runInNewContext([constLine('ACTIVITY_TAG_RE'),constLine('ACTIVITY_DROP_FIELD_RE'),fn('cleanActivityDisplayText')].join('\n'),ctx);
const clean=ctx.cleanActivityDisplayText;
test('구글시트 탭 표기·순번·브랜드 제거, 공종·현장명·지역·주소 유지',()=>{
  const src='[컨설팅요청_통합] 순번: 3 · 브랜드: 공법 · 공종: 방수 · 현장명: OO아파트 · 지역: 서울';
  assert.equal(clean(src),'공종: 방수 · 현장명: OO아파트 · 지역: 서울');
  assert.equal(clean('[기술자문문의] 순번: 12 · 브랜드: NETFORM · 공종: 외벽 · 주소: 경기도 성남시'),'공종: 외벽 · 주소: 경기도 성남시');
});
test('일반 메모는 그대로(줄바꿈·슬래시·가운뎃점 유지)',()=>{
  assert.equal(clean('일반 메모 첫 줄\n둘째 줄 / 슬래시 유지'),'일반 메모 첫 줄\n둘째 줄 / 슬래시 유지');
  assert.equal(clean('가격 · 품질 문의'),'가격 · 품질 문의');
  assert.equal(clean('브랜드 신뢰가 중요하다고 함'),'브랜드 신뢰가 중요하다고 함','"브랜드:" 항목이 아닌 문장은 유지');
});
test('원본 문자열은 바뀌지 않음(표시용 반환만)',()=>{
  const src='[기술자문문의] 순번: 1 · 공종: 방수';const copy=src;clean(src);assert.equal(src,copy);
});

test('그래프 최근 5개월: 기준 월에서 거꾸로, 해가 바뀌면 전년도 월, 하드코딩 없음',()=>{
  const RealDate=Date;
  const run=(nowIso,data)=>{
    class FakeDate extends RealDate{constructor(...a){super(...(a.length?a:[nowIso]));}static now(){return new RealDate(nowIso).getTime();}}
    const D={getCompany2025Revenue:()=>data[2025]||null,getCompany2026Revenue:()=>data[2026]||null};
    const c={D,Date:FakeDate,parseInt,String,REVENUE_YEAR_FN_NAMES:{2024:'getCompany2024Revenue',2025:'getCompany2025Revenue',2026:'getCompany2026Revenue'}};
    vm.runInNewContext(fn('buildRecentMonthsRevenue'),c);return c.buildRecentMonthsRevenue({},5);
  };
  const rows=(y,list)=>({rows:list.map(([m,a])=>({date:`${y}-${String(m).padStart(2,'0')}-10`,amount:a}))});
  const oct=run('2026-10-13T09:00:00',{2026:rows(2026,[[1,1],[6,6],[10,10]])});
  assert.equal(JSON.stringify(oct.map(p=>p.month)),JSON.stringify([6,7,8,9,10]));assert.equal(JSON.stringify(oct.map(p=>p.total)),JSON.stringify([6,0,0,0,10]));
  const feb=run('2026-02-05T09:00:00',{2025:rows(2025,[[10,100],[12,120]]),2026:rows(2026,[[2,20]])});
  assert.equal(JSON.stringify(feb.map(p=>p.year+'-'+p.month)),JSON.stringify(['2025-10','2025-11','2025-12','2026-1','2026-2']));
  assert.equal(JSON.stringify(feb.map(p=>p.total)),JSON.stringify([100,0,120,0,20]));
});
