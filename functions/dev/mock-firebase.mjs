// 로컬 검증 전용: 카드가 쓰는 Firebase SDK 함수를 모의 서버 저장소로 연결한다.
// 실제 Firebase 로 나가는 요청이 없도록 mock-server 가 SDK 주소를 이 파일로 바꿔 내려 준다.
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => {
  const json = await r.json();
  if (!r.ok) throw Object.assign(new Error(json.code || 'mock error'), { code: json.code });
  return json;
});

// ---- app / auth --------------------------------------------------------------
export const initializeApp = (cfg, name) => ({ cfg, name: name || 'default' });
export const browserLocalPersistence = 'local';
export const inMemoryPersistence = 'memory';
export const setPersistence = async () => {};
export const fetchSignInMethodsForEmail = async () => ['password'];
export const sendPasswordResetEmail = async () => {};
const auths = new Map();
export function getAuth(app) {
  if (!auths.has(app.name)) auths.set(app.name, { currentUser: null, listeners: [] });
  return auths.get(app.name);
}
const setUser = (auth, user) => { auth.currentUser = user; auth.listeners.forEach((fn) => fn(user)); };
export function onAuthStateChanged(auth, fn) {
  auth.listeners.push(fn);
  setTimeout(() => fn(auth.currentUser), 0);
  return () => { auth.listeners = auth.listeners.filter((x) => x !== fn); };
}
export async function signInWithEmailAndPassword(auth, email, password) {
  const res = await post('/__mock/auth/login', { email, password });
  const user = { uid: res.uid, email: res.email, getIdToken: async () => res.token };
  setUser(auth, user);
  return { user };
}
export async function signOut(auth) { setUser(auth, null); }

// ---- storage -----------------------------------------------------------------
export const getStorage = () => ({});
export const ref = (_s, path) => ({ path });
export const uploadBytesResumable = () => { throw new Error('mock storage upload not supported'); };
export const getDownloadURL = async () => '';
export const deleteObject = async () => {};

// ---- firestore ---------------------------------------------------------------
export const getFirestore = () => ({});
export const serverTimestamp = () => new Date().toISOString();
export const doc = (_db, ...parts) => ({ path: parts.join('/') });
export const collection = (_db, ...parts) => ({ path: parts.join('/'), isCollection: true });
const snapshotOf = (ref, data) => ({
  id: ref.path.split('/').pop(), ref, exists: () => data != null, data: () => data,
  metadata: { hasPendingWrites: false, fromCache: false },
});
const read = async (ref) => snapshotOf(ref, (await post('/__mock/fs/get', { path: ref.path })).data);
const list = async (ref) => (await post('/__mock/fs/list', { path: ref.path })).docs;
export const getDoc = read;
export const getDocFromServer = read;
export async function getDocs(ref) {
  const docs = (await list(ref)).map((d) => snapshotOf({ path: d.path }, d.data));
  return { docs, docChanges: () => docs.map((d) => ({ type: 'added', doc: d })), forEach: (fn) => docs.forEach(fn), empty: !docs.length, size: docs.length, metadata: { hasPendingWrites: false, fromCache: false } };
}
export const setDoc = (ref, data, opts) => post('/__mock/fs/commit', { writes: [{ path: ref.path, data, merge: !!(opts && opts.merge) }] });
export function writeBatch() {
  const writes = [];
  return {
    set: (ref, data, opts) => writes.push({ path: ref.path, data, merge: !!(opts && opts.merge) }),
    delete: (ref) => writes.push({ path: ref.path, remove: true }),
    commit: () => post('/__mock/fs/commit', { writes }),
  };
}
export async function runTransaction(_db, fn) {
  const writes = [];
  const result = await fn({
    get: read,
    set: (ref, data, opts) => writes.push({ path: ref.path, data, merge: !!(opts && opts.merge) }),
    update: (ref, data) => writes.push({ path: ref.path, data, merge: true }),
    delete: (ref) => writes.push({ path: ref.path, remove: true }),
  });
  await post('/__mock/fs/commit', { writes });
  return result;
}
export function onSnapshot(ref, a, b, c) {
  const next = typeof a === 'function' ? a : b;
  const onError = typeof a === 'function' ? b : c;
  let last = null, stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      if (ref.isCollection) {
        const snap = await getDocs(ref);
        const sig = JSON.stringify(snap.docs.map((d) => [d.id, d.data()]));
        if (sig !== last) { last = sig; next(snap); }
      } else {
        const snap = await read(ref);
        const sig = JSON.stringify(snap.data() || null);
        if (sig !== last) { last = sig; next(snap); }
      }
    } catch (err) { if (onError) onError(err); }
    if (!stopped) setTimeout(tick, 800);
  };
  tick();
  return () => { stopped = true; };
}
