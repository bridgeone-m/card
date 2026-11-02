'use strict';
// 카드의 기존 업무 알림 문서(website-cleanup.js KEY)에 항목을 추가한다. 같은 알림 목록·확인 처리·
// 재접속 복원을 그대로 쓴다. 트랜잭션 안에서만 호출하며 다른 알림 항목은 건드리지 않는다.
const ALERT_DOC_KEY = 'shin2-website-cleanup-v1';

function mouSignedAlertId(modusignDocumentId) { return `mou-signed:${modusignDocumentId}`; }

// 같은 문서의 완료 이벤트가 반복돼도 항목은 하나다(id 고정 + processedEvents).
async function addMouSignedAlert(tx, { sharedUid, item, nowMs, serverTime }) {
  const path = `users/${sharedUid}/shin2/${ALERT_DOC_KEY}`;
  const data = (await tx.get(path)) || {};
  const value = Array.isArray(data.value) ? data.value : [];
  const processed = Object.assign({}, data.processedEvents);
  if (processed[item.id] || value.some((n) => n && n.id === item.id)) return false;
  processed[item.id] = true;
  tx.set(path, {
    value: value.concat([item]),
    processedEvents: processed,
    updatedAt: serverTime,
    localRev: Math.max(nowMs, (data.localRev || 0) + 1),
  }, { merge: true });
  return true;
}

module.exports = { ALERT_DOC_KEY, mouSignedAlertId, addMouSignedAlert };
