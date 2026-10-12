(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const definitions=window.WebsiteCleanup.TYPES;
  const labels={jandi:'잔디 토픽에 질문서 올리기',pdf:'질문서 고객관리 PDF 저장',requested:'담당자에게 삭제 요청',verified:'홈페이지 삭제 확인',materials:'체결 서류 받기',documents:'계약서 2건 보내기',signed:'서명·체결 확인'};
  const cards=new Map(), busy=new Set(), errors=new Map(), retries=new Map(), pendingCommands=new Map();
  let history=null, scheduled=false;
  const visibilityKey='shin2-task-alerts-hidden';
  // 알림 카드 X — 지운 카드는 그 시점 내용(업체 목록)으로 기억해 두고, 새 업체가 생기는 등 내용이 바뀌면 다시 보인다.
  const dismissKey='shin2-task-alerts-dismissed';
  let dismissed={};
  try{dismissed=JSON.parse(localStorage.getItem(dismissKey)||'{}')||{};}catch(_){}
  const cardSignature=c=>Array.from(c.querySelectorAll('.consult-req-alert-row:not(.is-history)')).map(r=>{const n=r.querySelector('.consult-req-alert-row-name');return (r.getAttribute('data-cleanup-id')||r.getAttribute('data-meeting-alert')||'')+':'+(r.getAttribute('data-co')||'')+':'+(n?n.textContent.trim():'');}).sort().join('|');
  // 2차 메일 알림은 1차 미팅 완료 뒤에만 보인다(판정은 index.html의 SHIN2_FOLLOWUP_ALERT_VISIBLE).
  const visibleNow=n=>!window.SHIN2_FOLLOWUP_ALERT_VISIBLE || window.SHIN2_FOLLOWUP_ALERT_VISIBLE(n);
  let alertsHidden=false;
  try{alertsHidden=localStorage.getItem(visibilityKey)==='1';}catch(_){}
  window.crmAlertDock=function(){
    let el=document.getElementById('crmAlertDock');
    if(!el){
      el=document.createElement('div');el.id='crmAlertDock';el.className='crm-alert-dock';document.body.appendChild(el);
      const toggle=document.createElement('button');toggle.type='button';toggle.className='alert-dock-toggle';el.appendChild(toggle);
      const refresh=()=>{
        const allCards=Array.from(el.children).filter(c=>c.classList.contains('consult-req-alert'));
        let hiddenRows=0;
        allCards.forEach(c=>{
          if(!c.querySelector(':scope > .alert-dismiss')){
            const x=document.createElement('button');x.type='button';x.className='alert-dismiss';x.textContent='×';
            x.setAttribute('aria-label','이 알림 지우기');x.title='이 알림 지우기';
            x.onclick=e=>{e.stopPropagation();dismissed[c.id]=cardSignature(c);try{localStorage.setItem(dismissKey,JSON.stringify(dismissed));}catch(_){}refresh();};
            c.appendChild(x);
          }
          const off=!!c.id && dismissed[c.id]!=null && dismissed[c.id]===cardSignature(c);
          if(c.classList.contains('is-dismissed')!==off)c.classList.toggle('is-dismissed',off);
          if(off)hiddenRows+=c.querySelectorAll('.consult-req-alert-row:not(.is-history)').length;
        });
        const cards=allCards.filter(c=>!c.classList.contains('is-dismissed'));
        const pending=(window.SHIN2_WEBSITE_CLEANUP_ITEMS || []).filter(n=>!n.completedAt && visibleNow(n)).length;
        const requestTitle=el.querySelector('#consultReqAlert .consult-req-alert-title');
        const requestCount=requestTitle ? Number((requestTitle.textContent.match(/(\d+)건/) || [0,0])[1]) : 0;
        const count=Math.max(0,pending+requestCount+(Number(window.SHIN2_MEETING_ALERT_COUNT)||0)-hiddenRows);
        const label=alertsHidden?'알림 '+count:'숨기기 · '+count+'건';
        if(toggle.textContent!==label)toggle.textContent=label;
        if(toggle.hidden!==(!cards.length))toggle.hidden=!cards.length;
        toggle.setAttribute('aria-label',alertsHidden?'미완료 업무 알림 '+count+'건 펼치기':'업무 알림 팝업 숨기기');
        toggle.setAttribute('aria-expanded',String(!alertsHidden));
        el.classList.toggle('is-collapsed',alertsHidden);
        const height=Array.from(el.children).reduce((h,c)=>h+c.getBoundingClientRect().height,0);
        el.classList.toggle('is-overflowing',!alertsHidden && height+Math.max(0,cards.length)*10>el.clientHeight+1);
      };
      toggle.onclick=()=>{alertsHidden=!alertsHidden;try{localStorage.setItem(visibilityKey,alertsHidden?'1':'0');}catch(_){}refresh();};
      new MutationObserver(refresh).observe(el,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden','data-co','data-meeting-alert']});
      window.addEventListener('resize',refresh);
      window.addEventListener('website-cleanup-update',refresh);
      refresh();
    }
    return el;
  };
  function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;render();});}
  async function save(command){
    if(busy.has(command.id))return;
    busy.add(command.id);pendingCommands.set(command.id,command);errors.delete(command.id);render();
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    try{
      if(!window.SHIN2_WEBSITE_CLEANUP_SAVE)throw Error('연결을 확인해주세요.');
      await window.SHIN2_WEBSITE_CLEANUP_SAVE(command);retries.delete(command.id);
    }catch(err){errors.set(command.id,'저장 실패 · 재시도해주세요.');retries.set(command.id,command);}
    finally{busy.delete(command.id);pendingCommands.delete(command.id);schedule();}
  }
  function rowHTML(n,isHistory){
    const def=definitions[n.type || 'website'];
    return '<div class="consult-req-alert-row-main">'+
      '<span class="consult-req-alert-row-name" data-company></span>'+
      (isHistory?'<span class="alert-history" data-history></span>':n.type==='mail'?'<div class="alert-task">2차 미팅 제안 메일 보내기</div>':
        def.checks.map(([key])=>'<label class="alert-check"><input type="checkbox" data-check="'+key+'"><span>'+esc(labels[key])+'</span></label>').join(''))+
      '<details class="alert-details"><summary>상세보기</summary><div data-details></div></details></div>'+
      (isHistory?'':'<div class="alert-actions"><button class="consult-req-alert-done" data-complete></button></div><span class="alert-status" role="status" aria-live="polite"></span>');
  }
  function updateRow(row,n,isHistory){
    const def=definitions[n.type || 'website'],pending=busy.has(n.id),command=pendingCommands.get(n.id);
    const checked=key=>command && command.kind==='check' && command.field===key ? command.value : !!n[key];
    const setText=(selector,text)=>{const el=row.el.querySelector(selector);if(el && el.textContent!==text)el.textContent=text;};
    setText('[data-company]',n.companyName);
    const details=(n.type==='mail'?'1차 메일 발송: ':n.type==='mou'?'2차 미팅 완료: ':'발생: ')+new Date(n.firstSentAt || n.occurredAt).toLocaleString('ko-KR');
    setText('[data-details]',[n.reason?'사유: '+n.reason:'',details,def.guidance || '',n.type==='mou'?'계약서 2건: 협약체결서·물품공급계약서':'',n.secondMailEvidence?'2차 미팅 제안 메일 발송 성공 이력 확인됨':''].filter(Boolean).join('\n'));
    setText('[data-history]','완료: '+new Date(n.completedAt).toLocaleString('ko-KR')+' · '+n.completedBy+(n.completionSource==='formal-mou'?' · 정식 MOU 체결 연동':''));
    row.el.setAttribute('aria-busy',String(pending));
    row.el.classList.toggle('is-history',isHistory);
    row.el.querySelectorAll('[data-check]').forEach(input=>{
      input.checked=checked(input.dataset.check);input.disabled=pending;
      input.onchange=()=>save({kind:'check',id:n.id,field:input.dataset.check,value:input.checked});
    });
    const complete=row.el.querySelector('[data-complete]');
    if(complete){
      complete.disabled=pending || (!errors.has(n.id) && n.type!=='mail' && !def.checks.every(([key])=>checked(key)));
      const label=pending && command.kind==='complete'?'처리 중…':errors.has(n.id)?'재시도':n.type==='mail'?'발송 완료':'완료';
      if(complete.textContent!==label)complete.textContent=label;
      complete.onclick=()=>save(errors.has(n.id)?retries.get(n.id):{kind:'complete',id:n.id,...(n.type==='mail'?{confirmSingle:true}:{})});
    }
    setText('.alert-status',errors.get(n.id) || (pending?'저장 중…':''));
  }
  function makeCard(type){
    const el=document.createElement('div');el.className='consult-req-alert';el.id=type==='website'?'websiteCleanupAlert':type+'FollowupAlert';
    el.innerHTML='<button type="button" class="consult-req-alert-main" aria-expanded="true"><span class="alert-brand" aria-hidden="true"><img src="assets/netform-symbol-original.png" alt="" /></span><span class="consult-req-alert-texts"><span class="consult-req-alert-title"></span></span></button><div class="consult-req-alert-list"></div>';
    const card={el,button:el.firstElementChild,list:el.lastElementChild,rows:new Map(),expanded:true};
    card.button.id=type==='website'?'websiteCleanupMain':type+'FollowupMain';
    card.list.id=type+'FollowupList';card.button.setAttribute('aria-controls',card.list.id);
    card.button.onclick=()=>{card.expanded=!card.expanded;card.list.hidden=!card.expanded;card.button.setAttribute('aria-expanded',String(card.expanded));};
    const dock=window.crmAlertDock();dock.insertBefore(el,document.getElementById('consultReqAlert'));
    cards.set(type,card);return card;
  }
  // 질문서 회신 체크리스트 팝업 — 같은 알림 기록(reply)을 같은 save()로 체크하므로, 팝업에서 체크하면
  // 오른쪽 아래 알림에도 그대로 반영되고, 팝업을 닫아도 남은 항목은 알림으로 계속 남는다.
  let popup=null;
  function closePopup(){if(popup){clearTimeout(popup.timer);popup.el.remove();popup=null;}}
  window.SHIN2_OPEN_REPLY_CHECKLIST=function(companyId,companyName){
    closePopup();
    const el=document.createElement('div');el.className='pi-overlay';el.id='replyChecklistOverlay';el.style.zIndex='10012';
    el.innerHTML='<div class="pi-panel" style="max-width:380px;" role="dialog" aria-modal="true" aria-labelledby="replyChecklistTitle">'+
      '<div class="pi-head"><div class="pi-title" id="replyChecklistTitle">질문서 회신 — 공유·저장했나요?</div></div>'+
      '<div class="pi-body"><div class="reply-checklist-help"><b>'+esc(companyName)+'</b> 질문서 회신이 등록됐습니다. 아래 항목을 체크해 주세요. 지금 못 하면 [나중에]를 누르세요 — 오른쪽 아래 알림으로 남습니다.</div>'+
      '<div class="reply-checklist-body"><div class="reply-checklist-wait">알림 준비 중…</div></div></div>'+
      '<div class="pi-actions"><button type="button" class="co-text-action" data-reply-later>나중에</button></div></div>';
    document.body.appendChild(el);
    el.querySelector('[data-reply-later]').onclick=closePopup;
    el.addEventListener('mousedown',e=>{if(e.target===el)closePopup();});
    popup={el,companyId:String(companyId),row:null,saw:null,timer:setTimeout(()=>{
      if(popup && !popup.row){const w=popup.el.querySelector('.reply-checklist-wait');if(w)w.textContent='알림 생성이 늦어지고 있습니다. 잠시 뒤 오른쪽 아래 "질문서 공유·저장" 알림에서 체크해 주세요.';}
    },20000)};
    renderPopup();
  };
  function renderPopup(){
    if(!popup)return;
    const all=window.SHIN2_WEBSITE_CLEANUP_ITEMS || [];
    const n=popup.saw ? all.find(x=>x.id===popup.saw) : all.find(x=>x.type==='reply' && String(x.companyId)===popup.companyId && !x.completedAt);
    if(!n){ if(popup.saw)closePopup(); return; }
    if(n.completedAt){closePopup();return;}
    popup.saw=n.id;
    const body=popup.el.querySelector('.reply-checklist-body');
    if(!popup.row){popup.row={el:document.createElement('div')};popup.row.el.innerHTML=rowHTML(n,false);body.innerHTML='';body.appendChild(popup.row.el);
      const first=popup.row.el.querySelector('[data-check]');if(first)first.focus();}
    updateRow(popup.row,n,false);
  }
  function render(){
    renderPopup();
    const all=window.SHIN2_WEBSITE_CLEANUP_ITEMS || [];
    for(const [type,def] of Object.entries(definitions)){
      const isHistory=history===type || (history==='followups' && type!=='website');
      const items=all.filter(n=>(n.type || 'website')===type && (isHistory?!!n.completedAt:(!n.completedAt && visibleNow(n))));
      let card=cards.get(type);
      if(!window.SHIN2_CRM_GATE_PASSED || (!items.length && !isHistory)){
        if(card){card.el.remove();cards.delete(type);}continue;
      }
      if(!card)card=makeCard(type);
      const title=isHistory?def.title+' · 완료 이력':def.title;

      const titleEl=card.el.querySelector('.consult-req-alert-title');
      if(titleEl.textContent!==title)titleEl.textContent=title;

      if(isHistory){card.expanded=true;card.list.hidden=false;card.button.setAttribute('aria-expanded','true');}
      const ids=new Set(items.map(n=>n.id));
      for(const [id,row] of card.rows){if(!ids.has(id)){row.el.remove();card.rows.delete(id);}}
      for(const n of items){
        const signature=JSON.stringify([n,isHistory,busy.has(n.id),errors.get(n.id)]);
        let row=card.rows.get(n.id);
        if(row && row.signature===signature)continue;
        if(!row){const el=document.createElement('div');el.className='consult-req-alert-row';el.dataset.cleanupId=n.id;row={el};card.rows.set(n.id,row);card.list.appendChild(el);}
        row.signature=signature;
        // Keep labels, inputs, focus and the open details node stable while saving.
        if(row.history!==isHistory){row.el.innerHTML=rowHTML(n,isHistory);row.history=isHistory;}
        updateRow(row,n,isHistory);
      }
      let footer=card.list.querySelector('[data-history-footer]');
      if(!isHistory){if(footer)footer.remove();}
      else{
        if(!footer){footer=document.createElement('div');footer.className='consult-req-alert-more';footer.dataset.historyFooter='';card.list.appendChild(footer);}
        footer.innerHTML=(items.length?'':'완료 이력이 없습니다. ')+ '<button class="consult-req-alert-done">미완료 알림으로</button>';
        footer.querySelector('button').onclick=()=>{history=null;render();};
      }
    }
  }
  ['website-cleanup-update','shin2-crm-gate-passed','shin2-crm-firebase-ready'].forEach(event=>window.addEventListener(event,schedule));
  window.addEventListener('crm-followup-visibility',()=>{schedule();window.dispatchEvent(new CustomEvent('website-cleanup-update'));});
  for(const [id,type] of [['crmWebsiteCleanupHistoryBtn','website'],['crmFollowupHistoryBtn','followups']]){
    const button=document.getElementById(id);if(button)button.onclick=()=>{document.getElementById('crmUpdateMenu').classList.remove('is-open');history=type;render();};
  }
  render();
})();
