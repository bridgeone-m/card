'use strict';
// 2026-11-16 사용자 결정: 우리 도장은 PDF 에 미리 찍으므로 모두사인 서명은 을(상대 업체)만 한다.
// CONTRACT_COMPANY_SIGNS=false(기본) → 갑 서명자·서명 칸 없이 보내고, 을 서명 한 번으로 문서가 완료된다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, prepareInput, sendInput, webhookHeaders } = require('./helpers.cjs');

async function ready(opts) {
  const env = await makeEnv(Object.assign({}, opts, { config: Object.assign({ companySigns: false }, opts && opts.config) }));
  const v = await env.service.prepare(prepareInput());
  return Object.assign(env, { v });
}

test('을만 서명: 모두사인 요청에 갑 서명자·서명 칸이 없다', async () => {
  const env = await ready();
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(env.mock.posts.length, 2);
  for (const post of env.mock.posts) {
    assert.equal(post.participants.length, 1);
    assert.equal(post.participants[0].role, '을');
    assert.equal(post.participants[0].signingMethod.value, 'ceo@test-co.example');
  }
  for (const type of ['supply', 'mou']) {
    assert.equal(r.documents[type].delivery, 'created');
    assert.equal(r.documents[type].companySigns, false);
  }
});

test('을만 서명: 우리 측 서명 담당자가 없어도 발송이 막히지 않는다', async () => {
  const env = await ready({ config: { companySigner: {} } });
  const r = await env.service.send(sendInput(env.v), env.sender);
  assert.equal(r.documents.mou.delivery, 'created');
});

test('을만 서명: 을 서명 한 번으로 양측 완료(allSignedAt)가 채워진다', async () => {
  const env = await ready();
  await env.service.send(sendInput(env.v), env.sender);
  const doc = [...env.mock.documents.values()].find((d) => d.title.includes('MOU'));
  const hook = env.mock.sign(doc.id, 1, '2026-11-16T02:00:00.000Z');
  assert.equal(hook.event.type, 'document_all_signed');
  await env.service.handleWebhook(webhookHeaders('d-single'), JSON.stringify(hook));
  assert.equal(env.mock.documents.get(doc.id).status, 'COMPLETED');
  const after = (await env.service.listSends({ companyId: 'co-1' }))[0].documents.mou;
  assert.equal(after.counterpartySignedAt, '2026-11-16T02:00:00.000Z');
  assert.equal(after.companySignedAt, null);
  assert.equal(after.allSignedAt, '2026-11-16T02:00:00.000Z');
});

test('미리보기 서명 위치: 을만 서명이면 우리 측 칸을 보여 주지 않는다', async () => {
  const env = await ready();
  for (const type of ['supply', 'mou']) {
    assert.ok(env.v.docs[type].signaturePositions.counterparty);
    assert.equal(env.v.docs[type].signaturePositions.company, null);
  }
});

test('스위치를 켜면(갑도 서명) 예전처럼 서명자 2명', async () => {
  const env = await ready({ config: { companySigns: true } });
  await env.service.send(sendInput(env.v), env.sender);
  for (const post of env.mock.posts) assert.equal(post.participants.length, 2);
});
