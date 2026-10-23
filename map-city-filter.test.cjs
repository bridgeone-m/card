// §시·군 나누기 — 지도 시공 아파트/근처 시공의 시·군 여러 곳 선택(index.html 실제 함수, 가짜 데이터)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const i=html.indexOf('  function aptCityKey('),j=html.indexOf('  // 두 좌표 사이의 실제 거리',i);
assert.ok(i>0&&j>i);
const ctx={aptCategoryMatches:()=>true};vm.runInNewContext(html.slice(i,j)+';this.key=aptCityKey;this.opts=buildAptCityOptions;this.match=aptEntryMatchesFilter;',ctx);
const E=(region,city)=>({region,city,years:[2025],categories:[],households:null});
const st=o=>Object.assign({year:'all',category:'all',region:'all',households:'all',cities:[]},o);
test('수원/수원시/수원시 영통구는 같은 "경기 수원"',()=>{
  for(const c of ['수원','수원시','수원시 영통구']) assert.equal(ctx.key(E('경기',c)),'경기 수원');
  assert.equal(ctx.key(E('서울','중구')),'서울 중구');
  assert.equal(ctx.key(E('경기','')),'');
});
test('수원·화성·안산만 고르면 그 세 곳만',()=>{
  const all=[E('경기','수원시'),E('경기','화성'),E('경기','안산시'),E('경기','고양'),E('서울','강남')];
  const s=st({region:'경기',cities:['경기 수원','경기 화성','경기 안산']});
  assert.deepEqual(all.filter(e=>ctx.match(e,s)).map(e=>e.city),['수원시','화성','안산시']);
  assert.equal(all.filter(e=>ctx.match(e,st({}))).length,5);
});
test('시·군 목록은 고른 시/도 안에서만, 건수 포함',()=>{
  const all=[E('경기','수원시'),E('경기','수원'),E('경기','화성'),E('서울','강남')];
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.opts(all,'경기'))),[['경기 수원',2],['경기 화성',1]]);
  assert.equal(ctx.opts(all,'all').length,3);
});
