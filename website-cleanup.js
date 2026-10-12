(function(root){
  'use strict';
  const KEY = 'shin2-website-cleanup-v1';
  const TYPES = {
    website: {title:'홈페이지 삭제 처리 필요', checks:[['requested','홈페이지 담당자에게 삭제 요청 전달'],['verified','홈페이지 로고·업체 정보 삭제 확인']]},
    mou: {title:'MOU 체결 진행 필요', checks:[['materials','체결에 필요한 자료 수령'],['documents','협약체결서·물품공급계약서 발송'],['signed','두 문서 서명 및 체결 완료 확인']], guidance:'자료: 사업자등록증·통장사본·명함·회사 로고'},
    mail: {title:'2차 메일 발송 확인', checks:[['secondSent','2차 메일 발송 완료 확인']]}
  };
  // Mark only explicit new actions. Persisted with the existing company save, never reconstructed at boot.
  function eventPatch(co, kind, evidence, mouComplete){
    const id = kind + ':' + co.id + ':' + evidence;
    return {followupEvents:Object.assign({}, co.followupEvents, {[kind]:{id,kind,evidence,at:new Date().toISOString(),mouComplete:!!mouComplete}})};
  }
  function applyEvents(payload, companies, actor, now){
    const value = (payload.value || []).map(n=>Object.assign({},n));
    const processedEvents = Object.assign({},payload.processedEvents);
    let changed=false;
    for(const co of companies){
      const events=Object.values(co.followupEvents || {}).sort((a,b)=>a.at.localeCompare(b.at));
      for(const e of events){
        if(processedEvents[e.id]) continue;
        processedEvents[e.id]=true; changed=true;
        const type=e.kind==='m2' || e.kind==='mou' ? 'mou' : 'mail';
        let n=value.find(n=>n.type===type && n.companyId===co.id && !n.completedAt);
        if(e.kind==='m2' && !e.mouComplete){
          if(!n) value.push({id:e.id,type,companyId:co.id,companyName:co.name,occurredAt:e.at,materials:false,documents:false,signed:false,completedAt:null});
        }else if(e.kind==='mou' && n){
          Object.assign(n,{completedAt:now,completedBy:actor.label,completedByUid:actor.uid,completionSource:'formal-mou',completionEvidence:e.evidence});
        }else if(e.kind==='firstMail'){
          const log=(co.m1MailLog || []).find(l=>l.id===e.evidence && l.mailType==='firstMeeting' && l.status==='sent');
          if(!log) continue;
          if(!n){ n={id:e.id,type:'mail',companyId:co.id,companyName:co.name,occurredAt:log.sentAt,firstSentAt:log.sentAt,firstMailIds:[],secondSent:false,completedAt:null};value.push(n); }
          n.firstMailIds=Array.from(new Set([...(n.firstMailIds || []),log.id]));
        }else if(e.kind==='secondMail' && n){
          const log=(co.m1MailLog || []).find(l=>l.id===e.evidence && l.mailType==='postSecondMeeting' && l.status==='sent');
          if(log && (n.firstMailIds || []).includes(log.followupFirstMailId)) Object.assign(n,{secondSent:true,secondMailEvidence:log.id,secondSentAt:log.sentAt});
        }
      }
    }
    return {value,processedEvents,changed};
  }
  function terminationPatch(opts, now){
    return { agreementStatus:'terminated', agreementEndedAt:('endedAt' in opts) ? (opts.endedAt || null) : now,
      agreementEndReason:opts.reason || '', agreementEndNote:opts.note || '' };
  }
  function deletionPatch(reason, now, by){
    return { deletedAt:now, deletedBy:by, deleteReason:(reason || '').trim() };
  }
  // A pure transaction reducer. Only an explicit confirmed action calls this; no migration scan.
  function apply(state, command, actor, now){
    const next = {companies:state.companies.map(c=>Object.assign({},c)),customerActivities:state.customerActivities.slice(),websiteCleanup:state.websiteCleanup.map(n=>Object.assign({},n))};
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
      let notice = next.websiteCleanup.find(n=> (!n.type || n.type==='website') && n.companyId === co.id && !n.completedAt);
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
      const definition = TYPES[notice.type || 'website'];
      if(command.kind === 'check'){
        if(!definition.checks.some(([key])=>key===command.field) || typeof command.value !== 'boolean') throw new Error('잘못된 체크 항목입니다.');
        notice[command.field] = command.value;
        notice.updatedAt = now;
      } else if(command.kind === 'complete'){
        // A single explicit confirmation records the one-task checklist and completion atomically.
        if(notice.type==='mail' && command.confirmSingle===true) notice.secondSent=true;
        if(!definition.checks.every(([key])=>notice[key])) throw new Error('모든 항목을 체크해야 완료할 수 있습니다.');
        Object.assign(notice, {completedAt:now, completedBy:actor.label, completedByUid:actor.uid});
        if(!notice.type || notice.type==='website') log(notice.id + '-complete', notice.companyId, notice.companyName,
          '[홈페이지 삭제 처리 완료] ' + notice.companyName + ' · ' + actor.label);
      } else throw new Error('지원하지 않는 작업입니다.');
      changed.add('websiteCleanup');
    }
    return { state:next, changed:Array.from(changed) };
  }
  const api = { KEY, TYPES, apply, applyEvents, eventPatch, terminationPatch, deletionPatch };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WebsiteCleanup = api;
})(typeof window === 'undefined' ? globalThis : window);
