'use strict';
// 모의 모두사인 API (fetch 형태). 실제 서버에 연결하지 않는다. 공식 문서에 적힌 동작만 흉내 낸다.
//  - 웹훅 규칙: 마지막 서명자 서명 시 document_signed 없이 document_all_signed 만 온다.
//  - scenarios: { supply:['ok'|'reject'|'rate'|'timeout_created'|'timeout_lost'|'error_created'], mou:[...] } 문서별로 하나씩 소비.
const crypto = require('crypto');

const BASE_URL = 'https://mock.modusign.test';

function createMockModusign({ scenarios, now } = {}) {
  const documents = new Map();
  const posts = [];
  const plan = { supply: [...((scenarios && scenarios.supply) || [])], mou: [...((scenarios && scenarios.mou) || [])] };
  const state = { hideFromSearch: false, down: false };
  const nowIso = () => new Date(now ? now() : Date.now()).toISOString();
  const reply = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function validate(body) {
    if (!body.title || body.title.length > 100) return 'title';
    if (!body.file || !body.file.base64 || body.file.extension !== 'pdf') return 'file';
    if (!Array.isArray(body.participants) || body.participants.length < 1) return 'participants';
    for (const p of body.participants) {
      if (!p.name || p.name.length < 2 || p.name.length > 30) return 'participant.name';
      if (!p.signingMethod || p.signingMethod.type !== 'EMAIL' || !/@/.test(p.signingMethod.value)) return 'participant.signingMethod';
      for (const f of p.fields || []) {
        const v = [f.position.x, f.position.y, f.size.width, f.size.height];
        if (f.type !== 'SIGNATURE' || v.some((n) => !(n >= 0 && n <= 1)) || !(f.position.page >= 1)) return 'participant.fields';
      }
    }
    if ((body.metadatas || []).some((m) => m.key.length > 40 || String(m.value).length > 80)) return 'metadatas';
    return null;
  }

  function create(body) {
    const id = crypto.randomUUID();
    const doc = {
      id, title: body.title, status: 'ON_GOING', createdAt: nowIso(), updatedAt: nowIso(),
      participants: body.participants.map((p) => ({ id: crypto.randomUUID(), name: p.name, signingOrder: p.signingOrder, role: p.role, signingMethod: p.signingMethod, fields: p.fields })),
      signings: [], metadatas: body.metadatas, file: { downloadUrl: `${BASE_URL}/file/${id}` },
      fileBytes: Buffer.from(body.file.base64, 'base64'),
    };
    documents.set(id, doc);
    return doc;
  }
  const publicDoc = (d) => { const { fileBytes, ...rest } = d; return rest; };

  async function fetchImpl(url, init = {}) {
    if (state.down) throw new TypeError('network down');
    const u = new URL(url);
    // 시험에서 요청 처리 순서를 조절한다(경합 재현용).
    if (state.hook) await state.hook(init.method || 'GET', u);
    const headers = init.headers || {};
    if (u.pathname.startsWith('/file/')) {
      const doc = documents.get(u.pathname.slice(6));
      return doc ? new Response(doc.fileBytes, { status: 200 }) : reply(404, {});
    }
    if (!String(headers.authorization || '').startsWith('Basic ')) return reply(401, { code: 'UNAUTHORIZED' });
    if (init.method === 'POST' && u.pathname === '/documents') {
      const body = JSON.parse(init.body);
      const type = (body.metadatas.find((m) => m.key === 'card_doc_type') || {}).value;
      const scenario = (plan[type] || []).shift() || 'ok';
      posts.push({ type, scenario, sendKey: (body.metadatas.find((m) => m.key === 'card_send_key') || {}).value, sha256: crypto.createHash('sha256').update(Buffer.from(body.file.base64, 'base64')).digest('hex'), participants: body.participants, title: body.title, metadatas: body.metadatas });
      const bad = validate(body);
      if (bad) return reply(400, { code: 'INVALID_' + bad });
      if (scenario === 'reject') return reply(400, { code: 'REJECTED' });
      if (scenario === 'rate') return reply(429, { code: 'RATE_LIMIT' });
      if (scenario === 'timeout_lost') throw new TypeError('network timeout');
      if (scenario === 'timeout_created') { create(body); throw new TypeError('network timeout'); }
      if (scenario === 'error_created') { create(body); return reply(502, {}); }
      return reply(200, publicDoc(create(body)));
    }
    if (init.method === 'GET' && u.pathname === '/documents') {
      const filter = JSON.parse(u.searchParams.get('metadatas') || '{}');
      const rows = state.hideFromSearch ? [] : Array.from(documents.values()).filter((d) => Object.entries(filter).every(([k, v]) => (d.metadatas || []).some((m) => m.key === k && m.value === v)));
      return reply(200, { count: rows.length, documents: rows.map(publicDoc) });
    }
    if (init.method === 'GET' && u.pathname.startsWith('/documents/')) {
      const doc = documents.get(decodeURIComponent(u.pathname.slice(11)));
      return doc ? reply(200, publicDoc(doc)) : reply(404, { code: 'NOT_FOUND' });
    }
    return reply(404, {});
  }

  // 시험에서 참여자 서명을 흉내 낸다. 돌아오는 값은 모두사인이 보낼 웹훅 내용이다.
  function sign(documentId, signingOrder, at) {
    const doc = documents.get(documentId);
    const participant = doc.participants.find((p) => p.signingOrder === signingOrder);
    const signedAt = at || nowIso();
    doc.signings.push({ participantId: participant.id, signedAt });
    doc.updatedAt = signedAt;
    const last = doc.signings.length === doc.participants.length;
    if (last) doc.status = 'COMPLETED';
    return { event: { type: last ? 'document_all_signed' : 'document_signed' }, document: { id: documentId, requester: { email: 'requester@example.test' } } };
  }

  return { baseUrl: BASE_URL, fetchImpl, documents, posts, plan, state, sign };
}

module.exports = { createMockModusign, BASE_URL };
