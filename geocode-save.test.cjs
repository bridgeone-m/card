// §주소 검색 저장 줄이기 — 실패 주소 재검색 주기, 결과가 같으면 저장 안 함, 주소 필드만 저장(index.html 실제 함수)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const a=html.indexOf('  function syncGeocodeForEntries('),b=html.indexOf('  function initMapCanvas(',a);
const DAY=86400000, iso=ms=>new Date(Date.now()-ms).toISOString();
function run(companies, answer){
  const db=new Map(companies.map(c=>[c.id,JSON.parse(JSON.stringify(c))])), updates=[], searched=[];
  const ctx={window:{SHIN2_CRM_SHARED_SYNC:{isFresh:()=>true}},setTimeout:f=>f(),Date,Promise,parseFloat,
    D:{findCompany:id=>db.get(id),updateCompany:(id,p)=>{updates.push([id,p]);Object.assign(db.get(id),p);}}};
  vm.runInNewContext(html.slice(a,b)+';this.f=syncGeocodeForEntries;',ctx);
  const kakao={maps:{services:{Status:{OK:'OK'},Geocoder:function(){this.addressSearch=(addr,cb)=>{searched.push(addr);const r=answer(addr);cb(r?[{y:String(r[0]),x:String(r[1])}]:[],r?'OK':'ZERO_RESULT');};}}}};
  return ctx.f(companies.map(co=>({co})),kakao).then(changed=>({changed,updates,searched,db}));
}
test('실패한 주소는 30일 안에는 다시 검색하지 않고 저장도 안 함(로그인 때마다 저장되던 문제)',async()=>{
  const r=await run([{id:'a',address:'서울 어딘가 1',geocodeStatus:'failed',geocodedAt:iso(1*DAY)}],()=>null);
  assert.deepEqual(r.searched,[]);assert.equal(r.updates.length,0);assert.equal(r.changed,false);
});
test('기간이 지나 다시 검색했는데 또 실패면 저장하지 않음(시각도 그대로)',async()=>{
  const at=iso(40*DAY);
  const r=await run([{id:'a',address:'서울 어딘가 1',geocodeStatus:'failed',geocodedAt:at}],()=>null);
  assert.deepEqual(r.searched,['서울 어딘가 1']);assert.equal(r.updates.length,0);assert.equal(r.db.get('a').geocodedAt,at);
});
test('주소를 고치면 기간과 관계없이 바로 다시 검색하고, 찾으면 주소 검색 필드만 저장',async()=>{
  const r=await run([{id:'a',address:'새 주소 2',geocodeFailedAddress:'옛 주소',geocodeStatus:'failed',geocodedAt:iso(1*DAY),phone:'02-1'}],()=>[37.5,127.1]);
  assert.deepEqual(r.searched,['새 주소 2']);assert.equal(r.updates.length,1);
  const p=r.updates[0][1];assert.deepEqual(Object.keys(p).sort(),['geocodeFailedAddress','geocodeStatus','geocodedAddress','geocodedAt','latitude','longitude']);
  assert.equal(p.geocodeStatus,'ok');assert.equal(p.latitude,37.5);assert.equal(p.geocodeFailedAddress,null);
});
test('처음 실패하면 어떤 주소가 실패했는지 함께 한 번만 저장',async()=>{
  const r=await run([{id:'a',address:'없는 주소'}],()=>null);
  assert.equal(r.updates.length,1);assert.equal(r.updates[0][1].geocodeFailedAddress,'없는 주소');assert.equal(r.updates[0][1].geocodeStatus,'failed');
  const r2=await run([r.db.get('a')],()=>null);assert.deepEqual(r2.searched,[]);assert.equal(r2.updates.length,0);
});
test('이미 같은 주소·같은 좌표로 찾아 둔 업체는 검색도 저장도 안 함',async()=>{
  const r=await run([{id:'a',address:'서울 1',geocodedAddress:'서울 1',geocodeStatus:'ok',latitude:37.5,longitude:127.1}],()=>[37.5,127.1]);
  assert.deepEqual(r.searched,[]);assert.equal(r.updates.length,0);
});
test('검색 도중 다른 사람이 주소를 바꿨으면 저장하지 않음',async()=>{
  const companies=[{id:'a',address:'옛 주소'}];
  const db=new Map(companies.map(c=>[c.id,Object.assign({},c)])),updates=[];
  const ctx={window:{SHIN2_CRM_SHARED_SYNC:{isFresh:()=>true}},setTimeout:f=>f(),Date,Promise,parseFloat,
    D:{findCompany:id=>db.get(id),updateCompany:(id,p)=>updates.push([id,p])}};
  vm.runInNewContext(html.slice(a,b)+';this.f=syncGeocodeForEntries;',ctx);
  const kakao={maps:{services:{Status:{OK:'OK'},Geocoder:function(){this.addressSearch=(addr,cb)=>{db.get('a').address='다른 직원이 고친 주소';cb([{y:'1',x:'2'}],'OK');};}}}};
  await ctx.f(companies.map(co=>({co})),kakao);assert.equal(updates.length,0);
});
