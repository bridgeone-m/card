'use strict';
// 시험·로컬 모의 서버 전용 저장소. Firestore 트랜잭션처럼 한 번에 하나씩 실행하고, 실패하면 쓰기를 버린다.
function createMemoryStore(initial) {
  const docs = new Map(Object.entries(initial || {}));
  let chain = Promise.resolve();
  const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const apply = (path, data, opts) => {
    const clone = copy(data);
    docs.set(path, opts && opts.merge ? Object.assign({}, docs.get(path), clone) : clone);
  };
  return {
    docs,
    async get(path) { return copy(docs.get(path)); },
    async set(path, data, opts) { apply(path, data, opts); },
    transaction(fn) {
      const run = chain.then(async () => {
        const writes = [];
        const result = await fn({
          get: async (path) => copy(docs.get(path)),
          set: (path, data, opts) => writes.push([path, data, opts]),
        });
        writes.forEach(([p, d, o]) => apply(p, d, o));
        return result;
      });
      chain = run.catch(() => {});
      return run;
    },
    async query(collection, field, value) {
      const out = [];
      for (const [path, data] of docs) {
        if (path.startsWith(collection + '/') && data && data[field] === value) out.push(copy(data));
      }
      return out;
    },
    async recent(collection, field, limit) {
      const out = [];
      for (const [path, data] of docs) if (path.startsWith(collection + '/') && data) out.push(copy(data));
      return out.sort((a, b) => String(b[field] || '').localeCompare(String(a[field] || ''))).slice(0, limit);
    },
  };
}

function createMemoryBlobs(initial) {
  const files = new Map(Object.entries(initial || {}));
  return {
    files,
    async put(path, bytes) { files.set(path, Buffer.from(bytes)); },
    async get(path) {
      if (!files.has(path)) throw new Error('blob not found');
      return Buffer.from(files.get(path));
    },
  };
}

module.exports = { createMemoryStore, createMemoryBlobs };
