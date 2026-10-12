(function(root){
  'use strict';
  const KEY = 'shin2-website-cleanup-v1';
  function terminationPatch(opts, now){
    return { agreementStatus:'terminated', agreementEndedAt:('endedAt' in opts) ? (opts.endedAt || null) : now,
      agreementEndReason:opts.reason || '', agreementEndNote:opts.note || '' };
  }
  function deletionPatch(reason, now, by){
    return { deletedAt:now, deletedBy:by, deleteReason:(reason || '').trim() };
  }
  // A pure transaction reducer. Only an explicit confirmed action calls this; no migration scan.
  function apply(state, command, actor, now){
    const next = JSON.parse(JSON.stringify(state));
    const changed = new Set();
    const log = (id, companyId, companyName, text)=>{
      if(next.customerActivities.some(a=> a.id === id)) return;
      next.customerActivities.push({ id, companyId, companyName, originalText:text, activityText:text,
        category:text.includes('협약') ? '협약' : '기타', source:'website-cleanup', createdAt:now, updatedAt:now,
        processedBy:actor.label, processedByUid:actor.uid });
      changed.add('customerActivities');
    };
    if(command.kind === 'terminate' || command.kind === 'delete'){
      const co = next.companies.find(c=> c.id === command.companyId);
      if(!co) throw new Error('업체를 찾을 수 없습니다. 새로고침 후 확인해주세요.');
      if(command.kind === 'delete' && command.typedName.trim() !== (co.name || '').trim())
        throw new Error('업체명이 변경되었습니다. 현재 업체명을 다시 확인해주세요.');
      const already = command.kind === 'terminate' ? co.agreementStatus === 'terminated' : !!co.deletedAt;
      // Also makes a retry after a committed-but-lost response idempotent. Old records get no backfill.
      if(already) return { state:next, changed:[] };
      if(command.kind === 'terminate' && co.deletedAt) throw new Error('삭제된 업체입니다. 새로고침 후 확인해주세요.');
      const opts = command.options || {};
      Object.assign(co, command.kind === 'terminate' ? terminationPatch(opts, now) : deletionPatch(opts.reason, now, actor.label), {updatedAt:now});
      changed.add('companies');
      const reason = command.kind === 'terminate' ? '협약 종료' : '업체 삭제';
      let notice = next.websiteCleanup.find(n=> n.companyId === co.id && !n.completedAt);
      if(!notice){
        notice = { id:command.id, companyId:co.id, companyName:co.name || '', reason, occurredAt:now,
          requested:false, verified:false, completedAt:null, completedBy:null, completedByUid:null };
        next.websiteCleanup.push(notice);
        changed.add('websiteCleanup');
      }
      log(command.id + '-event', co.id, co.name, '[' + reason + '] ' + (opts.reason || '사유 미기재') +
        (command.kind === 'terminate' && opts.note ? ' · ' + opts.note : ''));
    } else {
      const notice = next.websiteCleanup.find(n=> n.id === command.id);
      if(!notice) throw new Error('알림을 찾을 수 없습니다. 새로고침 후 확인해주세요.');
      if(notice.completedAt) return { state:next, changed:[] };
      if(command.kind === 'check'){
        if(!['requested','verified'].includes(command.field) || typeof command.value !== 'boolean') throw new Error('잘못된 체크 항목입니다.');
        notice[command.field] = command.value;
        notice.updatedAt = now;
      } else if(command.kind === 'complete'){
        if(!notice.requested || !notice.verified) throw new Error('두 항목을 모두 체크해야 완료할 수 있습니다.');
        Object.assign(notice, {completedAt:now, completedBy:actor.label, completedByUid:actor.uid});
        log(notice.id + '-complete', notice.companyId, notice.companyName,
          '[홈페이지 삭제 처리 완료] ' + notice.companyName + ' · ' + actor.label);
      } else throw new Error('지원하지 않는 작업입니다.');
      changed.add('websiteCleanup');
    }
    return { state:next, changed:Array.from(changed) };
  }
  const api = { KEY, apply, terminationPatch, deletionPatch };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WebsiteCleanup = api;
})(typeof window === 'undefined' ? globalThis : window);
