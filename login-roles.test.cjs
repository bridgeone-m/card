// §내부직원·관리자 로그인 분리 — 관리자 금고(암호화)와 로그인 역할 판정(index.html의 실제 코드 사용, 테스트용 가짜 비밀번호만 씀)
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8');
const start=html.indexOf('window.SHIN2_ADMIN_VAULT = ');
const end=html.indexOf('})();',start)+5;
assert.ok(start>0&&end>start,'vault block');
function makeWin(){
  const store={};
  const win={localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}},
    dispatchEvent:()=>{},CustomEvent:class{constructor(t){this.type=t}}};
  win.window=win; win.crypto=globalThis.crypto;
  const ctx=vm.createContext({window:win,crypto:globalThis.crypto,TextEncoder,TextDecoder,Uint8Array,btoa,atob,String,Array,localStorage:win.localStorage,CustomEvent:win.CustomEvent});
  vm.runInContext(html.slice(start,end),ctx);
  return {win,store};
}
const SHARED='test-shared-pw', ADMIN='test-admin-password-123';

test('금고: 관리자 비밀번호로만 열리고, 원문은 암호문에 없다',async()=>{
  const {win}=makeWin();
  const v=await win.SHIN2_ADMIN_VAULT_SEAL(SHARED,ADMIN);
  assert.equal(await win.SHIN2_ADMIN_VAULT_OPEN(v,ADMIN),SHARED);
  await assert.rejects(()=>win.SHIN2_ADMIN_VAULT_OPEN(v,'wrong-password'));
  assert.ok(!JSON.stringify(v).includes(SHARED));
});

test('금고 설정 전: 입력한 비밀번호 그대로 로그인, 역할(관리자 모드 기록)은 건드리지 않음',async()=>{
  const {win,store}=makeWin();
  win.SHIN2_ADMIN_VAULT=null;
  store['shin2-crm-admin-mode']='1';
  const r=await win.SHIN2_RESOLVE_LOGIN_ROLE(SHARED);
  assert.equal(r.pw,SHARED);assert.equal(r.role,null);
  win.SHIN2_SET_LOGIN_ROLE(r.role);
  assert.equal(store['shin2-crm-admin-mode'],'1');
});

test('금고 설정 후: 관리자 비밀번호 → 공용 비밀번호로 로그인 + 관리자 / 공용 비밀번호 → 내부직원',async()=>{
  const {win,store}=makeWin();
  win.SHIN2_ADMIN_VAULT=await win.SHIN2_ADMIN_VAULT_SEAL(SHARED,ADMIN);
  const a=await win.SHIN2_RESOLVE_LOGIN_ROLE(ADMIN);
  assert.equal(a.pw,SHARED);assert.equal(a.role,'admin');
  win.SHIN2_SET_LOGIN_ROLE(a.role);assert.equal(store['shin2-crm-admin-mode'],'1');
  const s=await win.SHIN2_RESOLVE_LOGIN_ROLE(SHARED);
  assert.equal(s.pw,SHARED);assert.equal(s.role,'staff');
  win.SHIN2_SET_LOGIN_ROLE(s.role);assert.equal(store['shin2-crm-admin-mode'],undefined);
});
