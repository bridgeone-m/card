'use strict';
// firebaseAdapters.js 를 Firestore 규칙에 가까운 엄격한 가짜 DB 로 돌린다. 실제 Firestore 는 아니다(에뮬레이터는 Java 가 없어 미실행).
// 잡는 것: 트랜잭션에서 쓰기 후 읽기, undefined 값, 문서 경로 형식 오류, 깊은 병합 차이, 경합으로 인한 콜백 재실행.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFirestoreStore } = require('../src/firebaseAdapters');
const { makeEnv, prepareInput, sendInput, webhookHeaders, SHARED_UID } = require('./helpers.cjs');

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);
function assertStorable(value, where) {
  if (value === undefined) throw new Error(`undefined 값: ${where}`);
  if (Array.isArray(value)) {
    value.forEach((v, i) => {
      if (Array.isArray(v)) throw new Error(`중첩 배열: ${where}[${i}]`);
      assertStorable(v, `${where}[${i}]`);
    });
  } else if (isPlain(value)) {
    for (const [k, v] of Object.entries(value)) assertStorable(v, `${where}.${k}`);
  }
}
const deepMerge = (a, b) => {
  const out = Object.assign({}, a);
  for (const [k, v] of Object.entries(b)) out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v;
  return out;
};
const copy = (v) => JSON.parse(JSON.stringify(v));

function strictDb(memory, stats) {
  const checkPath = (p) => {
    const parts = p.split('/');
    if (parts.length % 2 !== 0 || parts.some((s) => !s || s === '.' || s === '..' || /^__.*__$/.test(s))) throw new Error(`문서 경로 오류: ${p}`);
  };
  const apply = (p, data, opts) => {
    assertStorable(data, p);
    const prev = memory.docs.get(p);
    memory.docs.set(p, copy(opts && opts.merge && prev ? deepMerge(prev, data) : data));
  };
  return {
    doc(p) {
      checkPath(p);
      return {
        path: p,
        async get() {
          const v = memory.docs.get(p);
          return { exists: v !== undefined, data: () => copy(v) };
        },
      };
    },
    collection(name) {
      return {
        where(field, op, value) {
          assert.equal(op, '==');
          return {
            async get() {
              const docs = [...memory.docs.entries()]
                .filter(([p, d]) => p.startsWith(`${name}/`) && p.split('/').length === 2 && d[field] === value)
                .map(([, d]) => ({ data: () => copy(d) }));
              return { docs };
            },
          };
        },
      };
    },
    // 동시 실행을 직렬화하고, 첫 시도를 경합으로 버려 콜백을 한 번 더 돌린다(Firestore 재시도 재현).
    runTransaction(fn) {
      const run = (stats.chain || Promise.resolve()).then(async () => {
        const attempt = async () => {
          const writes = [];
          const result = await fn({
            async get(ref) {
              if (writes.length) throw new Error(`트랜잭션 쓰기 후 읽기: ${ref.path}`);
              stats.reads++;
              const v = memory.docs.get(ref.path);
              return { exists: v !== undefined, data: () => copy(v) };
            },
            set(ref, data, opts) { assertStorable(data, ref.path); writes.push([ref.path, data, opts]); },
          });
          return { result, writes };
        };
        await attempt().catch(() => {}); // 첫 시도 폐기
        const { result, writes } = await attempt();
        writes.forEach(([p, d, o]) => apply(p, d, o));
        stats.commits++;
        return result;
      });
      stats.chain = run.catch(() => {});
      return run;
    },
  };
}

function adapted(stats) {
  return (memory) => Object.assign(createFirestoreStore(strictDb(memory, stats)), {
    docs: memory.docs,
    set: async (p, d) => { memory.docs.set(p, copy(d)); },
  });
}

test('실제 어댑터로 전체 흐름: 쓰기 후 읽기·undefined·경로 오류 없이 동작', async () => {
  const stats = { reads: 0, commits: 0 };
  const env = await makeEnv({ wrapStore: adapted(stats), scenarios: { mou: ['reject'] } });
  const v = await env.service.prepare(prepareInput());
  const r = await env.service.send(sendInput(v), env.sender);
  assert.equal(r.documents.supply.delivery, 'created');
  assert.equal(r.documents.mou.delivery, 'failed');
  const again = await env.service.retryDoc({ sendId: r.sendId, type: 'mou' }, env.sender);
  assert.equal(again.documents.mou.delivery, 'created');
  const hook = JSON.stringify(env.mock.sign(again.documents.mou.modusignDocumentId, 1, '2026-11-03T01:00:00.000Z'));
  assert.equal((await env.service.handleWebhook(webhookHeaders('d1'), hook)).alertCreated, true);
  assert.equal((await env.service.handleWebhook(webhookHeaders('d2'), hook)).alertCreated, false);
  await env.service.refresh({ sendId: r.sendId });
  assert.equal((await env.service.reconcile()).checked, 1);
  await env.service.signedDocument({ sendId: r.sendId, type: 'mou' }, { email: 'viewer@netform.example' });
  assert.ok(stats.commits > 5);
  const alerts = (await env.store.get(`users/${SHARED_UID}/shin2/shin2-website-cleanup-v1`)).value;
  assert.equal(alerts.filter((n) => n.type === 'mouSigned').length, 1);
  assert.equal(env.mock.posts.filter((p) => p.type === 'mou').length, 2);
});

test('경합 재실행과 깊은 병합에서도 상태가 어긋나지 않는다', async () => {
  const stats = { reads: 0, commits: 0 };
  const env = await makeEnv({ wrapStore: adapted(stats), scenarios: { mou: ['timeout_lost'] } });
  const v = await env.service.prepare(prepareInput());
  const r = await env.service.send(sendInput(v), env.sender);
  const stored = await env.store.get(`contractSends/${r.sendId}`);
  assert.equal(stored.documents.mou.delivery, 'unknown');
  assert.equal(stored.documents.mou.attempts.length, 1);
  assert.equal(stored.documents.supply.attempts.length, 1);
  env.clock.t += 6 * 60 * 1000;
  const s = await env.service.refresh({ sendId: r.sendId });
  assert.equal(s.documents.mou.delivery, 'unknown_not_found');
  const done = await env.service.retryDoc({ sendId: r.sendId, type: 'mou', manualChecked: true }, env.sender);
  assert.equal(done.documents.mou.delivery, 'created');
  assert.equal(done.documents.mou.failure, null);
  assert.equal(env.mock.posts.filter((p) => p.type === 'mou').length, 2);
  // 처음 만든 버전 번호가 재실행으로 건너뛰지 않는다.
  const prep = await env.store.get('contractPreparations/co-1');
  assert.equal(prep.lastVersion, 1);
  assert.equal(prep.currentVersion, 1);
});
