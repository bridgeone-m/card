(function(){
  'use strict';
  const esc = value=> String(value == null ? '' : value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  window.crmAlertDock = function(){
    let el = document.getElementById('crmAlertDock');
    if(!el){ el = document.createElement('div'); el.id='crmAlertDock'; el.className='crm-alert-dock'; document.body.appendChild(el); }
    return el;
  };
  let expanded = false, history = false, busy = false;
  const errors = new Map();
  const retries = new Map();
  async function save(command){
    if(busy) return;
    busy = true; errors.delete(command.id); render();
    try{
      if(!window.SHIN2_WEBSITE_CLEANUP_SAVE) throw new Error('로그인 및 연결 상태를 확인해주세요.');
      await window.SHIN2_WEBSITE_CLEANUP_SAVE(command);
      retries.delete(command.id);
    }catch(err){
      errors.set(command.id, '저장하지 못했습니다. 연결 상태를 확인하고 재시도해주세요.');
      retries.set(command.id, command);
    }finally{ busy = false; render(); }
  }
  function render(){
    const all = window.SHIN2_WEBSITE_CLEANUP_ITEMS || [];
    const pending = all.filter(n=> !n.completedAt);
    const items = history ? all.filter(n=> n.completedAt) : pending;
    let el = document.getElementById('websiteCleanupAlert');
    if(!window.SHIN2_CRM_GATE_PASSED){ if(el) el.remove(); return; }
    if(!pending.length && !history){ if(el) el.remove(); return; }
    if(!el){
      el = document.createElement('div'); el.id='websiteCleanupAlert'; el.className='consult-req-alert';
      window.crmAlertDock().prepend(el);
    }
    el.innerHTML = `<button type="button" class="consult-req-alert-main" id="websiteCleanupMain" aria-expanded="${expanded}" aria-controls="websiteCleanupList">
      <span class="consult-req-alert-dot" aria-hidden="true"></span><span class="consult-req-alert-texts">
      <span class="consult-req-alert-title">${history ? '홈페이지 정리 완료 이력' : '홈페이지 삭제 처리 필요'}</span>
      <span class="consult-req-alert-sub">${history ? '완료' : '미완료'} ${items.length}건 · ${history ? '처리 기록' : '두 항목 확인 후 완료 처리'}</span></span></button>
      <div class="consult-req-alert-list" id="websiteCleanupList" ${expanded ? '' : 'hidden'}>
      ${items.map(n=> `<div class="consult-req-alert-row" data-cleanup-id="${esc(n.id)}">
        <div class="consult-req-alert-row-main">
          <span class="consult-req-alert-row-name">${esc(n.companyName)}</span>
          <span class="consult-req-alert-row-memo">사유: ${esc(n.reason)}</span>
          <span class="consult-req-alert-row-memo">${esc(new Date(n.occurredAt).toLocaleString('ko-KR'))}</span>
          ${history ? `<span class="consult-req-alert-row-memo">완료: ${esc(new Date(n.completedAt).toLocaleString('ko-KR'))} · ${esc(n.completedBy)}</span>` : `
          <label class="consult-req-alert-row-memo"><input type="checkbox" data-cleanup-check="requested" ${n.requested?'checked':''} ${busy?'disabled':''}>홈페이지 담당자에게 삭제 요청 전달</label>
          <label class="consult-req-alert-row-memo"><input type="checkbox" data-cleanup-check="verified" ${n.verified?'checked':''} ${busy?'disabled':''}>홈페이지 로고·업체 정보 삭제 확인</label>`}
          ${errors.has(n.id) ? `<span class="consult-req-alert-row-memo" role="alert">${esc(errors.get(n.id))}</span><button type="button" class="consult-req-alert-done" data-cleanup-retry ${busy?'disabled':''}>재시도</button>` : ''}
        </div>
        ${history ? '' : `<button type="button" class="consult-req-alert-done" data-cleanup-complete ${busy || !n.requested || !n.verified ? 'disabled':''}>완료</button>`}
      </div>`).join('')}
      ${!items.length ? '<div class="consult-req-alert-more">완료 이력이 없습니다.</div>' : ''}
      ${history ? '<div class="consult-req-alert-more"><button type="button" class="consult-req-alert-done" id="websiteCleanupBack">미완료 알림으로</button></div>' : ''}
      </div>`;
    document.getElementById('websiteCleanupMain').onclick = ()=>{ expanded=!expanded; render(); };
    const back=document.getElementById('websiteCleanupBack');
    if(back) back.onclick=()=>{history=false;render();};
    el.querySelectorAll('[data-cleanup-id]').forEach(row=>{
      const id=row.dataset.cleanupId;
      row.querySelectorAll('[data-cleanup-check]').forEach(input=> input.onchange=()=> save({kind:'check',id,field:input.dataset.cleanupCheck,value:input.checked}));
      const complete=row.querySelector('[data-cleanup-complete]');
      if(complete) complete.onclick=()=>save({kind:'complete',id});
      const retry=row.querySelector('[data-cleanup-retry]');
      if(retry) retry.onclick=()=>save(retries.get(id));
    });
  }
  window.addEventListener('website-cleanup-update', render);
  window.addEventListener('shin2-crm-gate-passed', render);
  window.addEventListener('shin2-crm-firebase-ready', render);
  document.getElementById('crmWebsiteCleanupHistoryBtn').addEventListener('click', ()=>{
    document.getElementById('crmUpdateMenu').classList.remove('is-open');
    history=true;expanded=true;render();
  });
  render();
})();
