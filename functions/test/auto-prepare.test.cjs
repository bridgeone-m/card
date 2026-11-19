'use strict';
// 2차 미팅 완료 때 카드가 부르는 자동 준비(auto) — 준비만 하고 발송하지 않으며, 사람이 만든 PDF·발송 기록은 건드리지 않는다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, prepareInput, sendInput, company } = require('./helpers.cjs');

const check = (env) => env.service.checkCompany({ companyId: 'co-1', companyCode: 'B2B901' });
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code; } };

test('준비 전에는 prepared 가 없다', async () => {
  const env = await makeEnv();
  assert.equal((await check(env)).prepared, null);
});

test('자동 준비: PDF 2종이 생기고 company-check 가 그 버전을 돌려준다(모두사인 호출 없음)', async () => {
  const env = await makeEnv();
  const v = await env.service.prepare(prepareInput({ auto: true, actorLabel: '자동 준비' }));
  assert.equal(v.version, 1);
  const c = await check(env);
  assert.equal(c.prepared.version, 1);
  assert.equal(c.prepared.auto, true);
  assert.equal(c.prepared.recipientEmail, 'ceo@test-co.example');
  assert.ok(c.prepared.docs.supply.sha256 && c.prepared.docs.mou.sha256);
  assert.ok(Array.isArray(c.prepared.sendBlockers));
  assert.equal(env.mock.posts.length, 0);
});

test('이미 준비된 PDF가 있으면 자동 준비는 거절, 사람의 다시 생성은 그대로 된다', async () => {
  const env = await makeEnv();
  await env.service.prepare(prepareInput());
  assert.equal(await code(env.service.prepare(prepareInput({ auto: true }))), 'ALREADY_PREPARED');
  const v2 = await env.service.prepare(prepareInput({ contractDate: '2026-11-03' }));
  assert.equal(v2.version, 2);
  const c = await check(env);
  assert.equal(c.prepared.version, 2);
  assert.equal(c.prepared.auto, false);
});

test('발송한 뒤에는 prepared 가 비고, 자동 준비도 하지 않는다', async () => {
  const env = await makeEnv();
  const v = await env.service.prepare(prepareInput({ auto: true }));
  await env.service.send(sendInput(v), env.sender);
  assert.equal((await check(env)).prepared, null);
  assert.equal(await code(env.service.prepare(prepareInput({ auto: true }))), 'ALREADY_SENT');
});

test('업체 정보가 모자라면 자동 준비도 같은 이유로 막힌다', async () => {
  const env = await makeEnv({ companies: [company({ bizRegNo: '' })] });
  assert.equal(await code(env.service.prepare(prepareInput({ auto: true }))), 'COMPANY_INFO_INCOMPLETE');
  assert.equal((await check(env)).prepared, null);
});

test('공용 로그인으로 /prepare auto 호출 가능(도장 없이), company-check 응답에 prepared 포함', async () => {
  const env = await makeEnv();
  const headers = { authorization: 'Bearer shared-token', origin: 'https://bridgeone-m.github.io' };
  const r = await env.router({ method: 'POST', path: '/prepare', query: {}, headers, body: prepareInput({ auto: true }) });
  assert.equal(r.status, 200);
  const c = await env.router({ method: 'POST', path: '/company-check', query: {}, headers, body: { companyId: 'co-1', companyCode: 'B2B901' } });
  assert.equal(c.status, 200);
  const body = typeof c.body === 'string' ? JSON.parse(c.body) : c.body;
  assert.equal(body.prepared.auto, true);
});
