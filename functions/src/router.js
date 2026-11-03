'use strict';
// HTTP 요청 → 서비스 호출. Cloud Functions 와 로컬 모의 서버가 같은 라우터를 쓴다.
const { AppError } = require('./errors');
const { ModusignError } = require('./modusign');
const { TEST_COMPANY_ID } = require('./service');

const json = (status, body) => ({ status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
const pdf = (file, filename) => ({
  status: 200,
  headers: {
    'content-type': 'application/pdf', 'cache-control': 'no-store',
    'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename + '.pdf')}`,
    'x-pdf-sha256': file.sha256 || '',
  },
  body: file.bytes,
});

function createRouter({ service, auth, allowedOrigins, logger }) {
  const log = logger || console;

  function cors(origin) {
    if (!origin || !allowedOrigins.includes(origin)) return {};
    return {
      'access-control-allow-origin': origin, vary: 'Origin',
      'access-control-allow-headers': 'authorization, content-type, x-contract-sender-token',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-expose-headers': 'x-pdf-sha256',
    };
  }

  async function dispatch({ method, path, query, headers, body, rawBody }) {
    const route = `${method} ${path}`;
    switch (route) {
      case 'POST /modusign-webhook':
        return json(200, await service.handleWebhook(headers, rawBody));
      case 'POST /company-check':
        await auth.requireShared(headers);
        return json(200, await service.checkCompany(body));
      case 'POST /prepare':
        await auth.requireShared(headers);
        if (body.includeSeal === true && await service.sealNeedsPersonal()) await auth.requireSender(headers);
        return json(200, await service.prepare(body));
      case 'GET /pdf': {
        await auth.requireShared(headers);
        if (await service.pdfNeedsPersonal(query)) await auth.requireSender(headers);
        const file = await service.getPdf(query);
        return pdf(file, file.title);
      }
      case 'GET /sends':
        await auth.requireShared(headers);
        return json(200, { sends: await service.listSends(query) });
      case 'GET /sends/all':
        await auth.requireShared(headers);
        return json(200, { sends: await service.listAllSends({ limit: query.limit, includeTests: query.includeTests }) });
      case 'POST /refresh':
        await auth.requireShared(headers);
        return json(200, await service.refresh(body));
      case 'POST /send':
        return json(200, await service.send(body, await auth.requireSender(headers)));
      case 'POST /retry':
        return json(200, await service.retryDoc(body, await auth.requireSender(headers)));
      case 'POST /cancel':
        return json(200, await service.cancelDoc(body, await auth.requireSender(headers)));
      case 'POST /resolve-duplicate':
        return json(200, await service.resolveDuplicate(body, await auth.requireSender(headers)));
      // ---- 우리 측 시험 발송(서버 직접 요청). 업체 ID 는 서버가 고정하고, 발송 ID 는 시험 발송인지 확인한다.
      case 'POST /test/prepare':
        return json(200, await service.prepareTest(Object.assign({}, body, { actorLabel: (await auth.requirePersonalSender(headers)).email })));
      case 'GET /test/pdf': {
        await auth.requirePersonalSender(headers);
        const file = await service.getPdf(Object.assign({}, query, { companyId: TEST_COMPANY_ID }));
        return pdf(file, file.title);
      }
      case 'POST /test/send':
        return json(200, await service.send(Object.assign({}, body, { companyId: TEST_COMPANY_ID }), await auth.requirePersonalSender(headers), { test: true }));
      case 'GET /test/sends':
        await auth.requirePersonalSender(headers);
        return json(200, { sends: await service.listSends({ companyId: TEST_COMPANY_ID }) });
      case 'POST /test/refresh':
        await auth.requirePersonalSender(headers);
        await service.assertTestSend(body.sendId);
        return json(200, await service.refresh(body));
      case 'POST /test/cancel': {
        const sender = await auth.requirePersonalSender(headers);
        await service.assertTestSend(body.sendId);
        return json(200, await service.cancelDoc(body, sender));
      }
      case 'POST /test/retry': {
        const sender = await auth.requirePersonalSender(headers);
        await service.assertTestSend(body.sendId);
        return json(200, await service.retryDoc(body, sender));
      }
      case 'GET /signed-document': {
        const viewer = await auth.requireViewer(headers);
        const file = await service.signedDocument(query, viewer);
        return pdf(file, file.title);
      }
      default:
        throw new AppError(404, 'NOT_FOUND', '없는 경로입니다.');
    }
  }

  return async function handle(req) {
    const extra = cors(req.headers.origin);
    if (req.method === 'OPTIONS') return { status: 204, headers: extra, body: '' };
    let out;
    try {
      out = await dispatch(req);
    } catch (err) {
      if (err instanceof AppError) {
        out = json(err.status, { error: { code: err.code, message: err.message, extra: err.extra } });
      } else if (err instanceof ModusignError) {
        log.error('modusign call failed', err.kind, err.status, err.code);
        out = json(502, { error: { code: 'MODUSIGN_UNAVAILABLE', message: '모두사인 연결에 실패했습니다. 잠시 후 다시 시도해주세요.' } });
      } else {
        log.error('contract api error', err && err.name, err && err.message);
        out = json(500, { error: { code: 'INTERNAL', message: '처리 중 오류가 발생했습니다.' } });
      }
    }
    return Object.assign({}, out, { headers: Object.assign({}, extra, out.headers) });
  };
}

module.exports = { createRouter };
