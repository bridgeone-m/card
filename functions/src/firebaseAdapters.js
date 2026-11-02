'use strict';
// 운영용 Firestore·Storage 연결. 클라이언트가 직접 읽지 않는 서버 전용 경로만 새로 쓴다.
function createFirestoreStore(db) {
  return {
    async get(path) {
      const snap = await db.doc(path).get();
      return snap.exists ? snap.data() : null;
    },
    transaction(fn) {
      return db.runTransaction((t) => fn({
        get: async (path) => {
          const snap = await t.get(db.doc(path));
          return snap.exists ? snap.data() : null;
        },
        set: (path, data, opts) => t.set(db.doc(path), data, opts || {}),
      }));
    },
    async query(collection, field, value) {
      const snap = await db.collection(collection).where(field, '==', value).get();
      return snap.docs.map((d) => d.data());
    },
  };
}

function createStorageBlobs(bucket) {
  return {
    async put(path, bytes) {
      await bucket.file(path).save(Buffer.from(bytes), { resumable: false, contentType: 'application/pdf', metadata: { cacheControl: 'no-store' } });
    },
    async get(path) {
      const [bytes] = await bucket.file(path).download();
      return bytes;
    },
  };
}

module.exports = { createFirestoreStore, createStorageBlobs };
