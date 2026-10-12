(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const definitions=window.WebsiteCleanup.TYPES;
  const labels={jandi:'잔디 토픽에 질문서 올리기',pdf:'질문서 고객관리 PDF 저장',requested:'담당자에게 삭제 요청',verified:'홈페이지 삭제 확인',materials:'체결 서류 받기',documents:'계약서 2건 보내기',signed:'서명·체결 확인'};
  const cards=new Map(), busy=new Set(), errors=new Map(), retries=new Map(), pendingCommands=new Map();
  let history=null, scheduled=false;
  window.crmAlertDock=function(){
    let el=document.getElementById('crmAlertDock');
    if(!el){el=document.createElement('div');el.id='crmAlertDock';el.className='crm-alert-dock';document.body.appendChild(el);
      const fit=()=>el.classList.toggle('is-overflowing',Array.from(el.children).reduce((h,c)=>h+c.getBoundingClientRect().height,0)+Math.max(0,el.children.length-1)*10>el.clientHeight+1);
      new MutationObserver(fit).observe(el,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});window.addEventListener('resize',fit);}
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
  function render(){
    const all=window.SHIN2_WEBSITE_CLEANUP_ITEMS || [];
    for(const [type,def] of Object.entries(definitions)){
      const isHistory=history===type || (history==='followups' && type!=='website');
      const items=all.filter(n=>(n.type || 'website')===type && (isHistory?!!n.completedAt:!n.completedAt));
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
  for(const [id,type] of [['crmWebsiteCleanupHistoryBtn','website'],['crmFollowupHistoryBtn','followups']]){
    const button=document.getElementById(id);if(button)button.onclick=()=>{document.getElementById('crmUpdateMenu').classList.remove('is-open');history=type;render();};
  }
  render();
})();
