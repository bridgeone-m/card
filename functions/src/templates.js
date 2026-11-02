'use strict';
// 양식·도장 등록부(contractConfig/templates). 코드와 공개 저장소에는 양식·도장 파일을 두지 않는다.
//  status: 'approved' = 사용자가 승인한 서명 전 원본 / 'test' = 시험용(시험 환경에서만 사용 가능)
// 체결본을 고친 파일은 'test' 로만 쓸 수 있고, 실제 모두사인 API 와 함께 쓰면 발송이 막힌다.
const { AppError } = require('./errors');
const { sha256 } = require('./pdf');

const REGISTRY_PATH = 'contractConfig/templates';
const DOC_TYPES = ['supply', 'mou'];
const DOC_LABELS = { supply: '기본물품공급계약서', mou: 'MOU 체결서' };

function createTemplates({ store, blobs, config }) {
  const registry = async () => (await store.get(REGISTRY_PATH)) || {};

  function usable(entry) {
    if (!entry) return false;
    if (entry.status === 'approved') return true;
    return entry.status === 'test' && config.allowTestAssets === true;
  }

  async function loadAll() {
    const reg = await registry();
    const missing = DOC_TYPES.filter((t) => !usable(reg[t]));
    if (missing.length) {
      throw new AppError(409, 'TEMPLATE_NOT_APPROVED',
        `승인된 서명 전 원본 양식이 아직 등록되지 않았습니다: ${missing.map((t) => DOC_LABELS[t]).join(', ')}`, { missing });
    }
    const out = {};
    for (const type of DOC_TYPES) {
      const entry = reg[type];
      const bytes = await blobs.get(entry.blobPath);
      if (sha256(bytes) !== entry.sha256) throw new AppError(409, 'TEMPLATE_CHANGED', `${DOC_LABELS[type]} 양식 파일이 등록 내용과 다릅니다.`);
      out[type] = { bytes, map: entry.map, version: entry.version, status: entry.status, signaturePositionApproved: entry.signaturePositionApproved === true };
    }
    return out;
  }

  // 실제 도장 파일은 별도 승인 전까지 쓰지 않는다(realSealApproved 가 꺼져 있으면 거부).
  async function loadSeal() {
    const entry = (await registry()).seal;
    if (!entry) throw new AppError(409, 'SEAL_NOT_REGISTERED', '승인된 도장 이미지가 등록되지 않았습니다.');
    if (entry.kind === 'test' && config.allowTestAssets !== true) throw new AppError(409, 'SEAL_NOT_ALLOWED', '시험용 도장 이미지는 시험 환경에서만 쓸 수 있습니다.');
    if (entry.kind !== 'test' && !(entry.status === 'approved' && config.realSealApproved === true)) {
      throw new AppError(409, 'SEAL_NOT_ALLOWED', '실제 도장 이미지 사용은 별도 승인 전에는 할 수 없습니다.');
    }
    const bytes = await blobs.get(entry.blobPath);
    if (sha256(bytes) !== entry.sha256) throw new AppError(409, 'SEAL_CHANGED', '도장 이미지가 등록 내용과 다릅니다.');
    return { bytes, kind: entry.kind, sha256: entry.sha256 };
  }

  async function sealAvailable() {
    const entry = (await registry()).seal;
    if (!entry) return { available: false };
    if (entry.kind === 'test') return { available: config.allowTestAssets === true, kind: 'test' };
    return { available: entry.status === 'approved' && config.realSealApproved === true, kind: entry.kind };
  }

  return { registry, loadAll, loadSeal, sealAvailable };
}

module.exports = { createTemplates, REGISTRY_PATH, DOC_TYPES, DOC_LABELS };
