'use strict';
// 모두사인 API 클라이언트. 근거: developers.modusign.co.kr (POST /documents, GET /documents, GET /documents/{id}).
// 결과가 불명확한 실패(시간 초과·연결 오류·본문 수신 실패·5xx)는 kind:'unknown' 으로 구분한다. 이 경우 호출자는
// 재발송하지 않고 상태 조회부터 해야 한다. 멱등키가 문서에 없어 metadatas 의 발송 키로 찾는다.
const MAX_PDF_BYTES = 10 * 1024 * 1024;
// 4xx 지만 요청이 처리됐을 수 있는 응답(프록시 시간 초과 등)은 '확실히 안 만들어짐'으로 보지 않는다.
const AMBIGUOUS_4XX = new Set([408, 409, 425]);

class ModusignError extends Error {
  constructor(kind, status, code) {
    super(`modusign ${kind} ${status || ''} ${code || ''}`.trim());
    this.kind = kind; // 'definite'(문서가 만들어지지 않음) | 'unknown'(만들어졌을 수 있음)
    this.status = status || 0;
    this.code = code || '';
  }
}

function createModusign({ baseUrl, email, apiKey, fetchImpl, timeoutMs }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const auth = () => 'Basic ' + Buffer.from(`${email}:${apiKey}`).toString('base64');

  async function call(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
    let res, text;
    try {
      res = await doFetch(baseUrl + path, {
        method,
        headers: Object.assign({ authorization: auth(), accept: 'application/json' }, body ? { 'content-type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      text = await res.text(); // 본문까지 받아야 끝난 것이다. 도중 실패도 결과 불명이다.
    } catch (_) {
      throw new ModusignError('unknown', 0, 'NETWORK');
    } finally { clearTimeout(timer); }
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* 응답 원문은 기록하지 않는다 */ }
    if (res.status >= 200 && res.status < 300) {
      if (!json) throw new ModusignError('unknown', res.status, 'BAD_BODY');
      return json;
    }
    const code = (json && (json.code || json.title || json.name)) || '';
    const ambiguous = res.status >= 500 || AMBIGUOUS_4XX.has(res.status);
    throw new ModusignError(ambiguous ? 'unknown' : 'definite', res.status, String(code).slice(0, 80));
  }

  return {
    createDocument: (body) => call('POST', '/documents', body),
    getDocument: (id) => call('GET', `/documents/${encodeURIComponent(id)}`),
    // 서명 요청 취소(POST /documents/{id}/cancel). 사유는 2~200자 필수. 진행 중(ON_GOING) 문서만 취소된다.
    // 취소 후 참여자는 문서를 볼 수 없게 한다(accessibleByParticipant=false, 공식 기본값).
    cancelDocument: (id, message) => call('POST', `/documents/${encodeURIComponent(id)}/cancel`, { message, accessibleByParticipant: false }),
    async findBySendKey(sendKey) {
      const q = encodeURIComponent(JSON.stringify({ card_send_key: sendKey }));
      const res = await call('GET', `/documents?limit=10&metadatas=${q}`);
      // 형식이 다르면 '없음'이 아니라 '모름'이다. 없음으로 처리하면 재발송 안전장치가 열린다.
      if (!res || !Array.isArray(res.documents)) throw new ModusignError('unknown', 0, 'BAD_LIST');
      return res.documents;
    },
    async download(url) {
      const res = await doFetch(url);
      if (!res.ok) throw new ModusignError('definite', res.status, 'DOWNLOAD');
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

// 좌표는 0~1 비율. 원점은 공식 문서에 명시가 없어(왼쪽 위로 가정) 실측 전에는
// signaturePositionApproved 가 꺼져 있어 발송이 막힌다.
function ratioBox(box, size) {
  return {
    position: { x: box.x / size.width, y: box.y / size.height, page: box.page },
    size: { width: box.w / size.width, height: box.h / size.height },
  };
}

// 양식 쪽마다 크기가 다를 수 있다(새 공급계약서: 1~8쪽 레터, 9~10쪽 A4). 비율은 그 쪽 크기로 계산한다.
const pageSizeOf = (map, page) => (map.pageSizes && map.pageSizes[page - 1]) || map.pageSize;

function signatureField(box, map) {
  const r = ratioBox(box, pageSizeOf(map, box.page));
  return { type: 'SIGNATURE', required: true, signatureTypes: ['SIGN', 'STAMP'], position: r.position, size: r.size };
}

// 상대방(을)이 모두사인에서 직접 고르는 체크 칸. 같은 그룹 안에서 minCheckRequired·maxCheckLimit 로 「둘 중 하나」를 강제한다.
// 공식 문서(서명 요청 POST /documents): CHECKBOX 의 size 는 width 만, 그룹 멤버는 required 가 무시되고 groupLabel 로 묶는다.
function checkboxFields(map) {
  const out = [];
  for (const g of map.checkboxGroups || []) {
    for (const box of g.boxes) {
      const r = ratioBox(box, pageSizeOf(map, box.page));
      out.push({ type: 'CHECKBOX', groupLabel: g.groupLabel, dataLabel: box.dataLabel, valueDescription: box.label, position: r.position, size: { width: r.size.width } });
    }
  }
  return out;
}
const checkboxGroups = (map) => (map.checkboxGroups || []).map((g) => ({ groupLabel: g.groupLabel, minCheckRequired: g.minCheckRequired, maxCheckLimit: g.maxCheckLimit }));

// companySigner 가 없으면(null) 을만 서명자로 넣는다 — 우리 측 도장은 PDF 에 이미 찍혀 있어 을 서명이 끝나면 문서가 완료된다.
function buildCreateBody({ title, pdfBytes, counterparty, companySigner, map, metadata }) {
  if (pdfBytes.length > MAX_PDF_BYTES) throw new ModusignError('definite', 0, 'PDF_TOO_LARGE');
  return {
    title: title.slice(0, 100),
    file: { base64: Buffer.from(pdfBytes).toString('base64'), extension: 'pdf' },
    participants: [
      {
        name: counterparty.name, role: '을', signingOrder: 1, locale: 'ko',
        signingMethod: { type: 'EMAIL', value: counterparty.email },
        fields: [...[].concat(map.signature.counterparty).map((box) => signatureField(box, map)), ...checkboxFields(map)],
        ...(map.checkboxGroups && map.checkboxGroups.length ? { checkboxFieldGroups: checkboxGroups(map) } : {}),
      },
      ...(companySigner ? [{
        name: companySigner.name, role: '갑', signingOrder: 2, locale: 'ko',
        signingMethod: { type: 'EMAIL', value: companySigner.email },
        fields: [signatureField(map.signature.company, map)],
      }] : []),
    ],
    metadatas: Object.entries(metadata).map(([key, value]) => ({ key, value: String(value).slice(0, 80) })),
  };
}

module.exports = { createModusign, buildCreateBody, ModusignError, MAX_PDF_BYTES };
