// 계약서 2종 준비: 업체 정보·계약일 확인 → PDF 2종 생성 → 문서별 미리보기 → 수정·재생성·다운로드 → 발송 확인.
// 이 파일은 화면만 담당한다. 권한 판단·PDF 생성·발송·중복 방지는 모두 서버(functions/)가 한다.
// 비밀값이 없고, 미리보기·다운로드는 서버의 발송 경로를 호출하지 않는다.
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const PDFJS='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs';
  const PDFJS_WORKER='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const TYPES=['supply','mou'];
  const TYPE_LABEL={supply:'기본물품공급계약서',mou:'MOU 체결서'};
  const STEP_LABEL=[['info','정보 확인'],['preview','미리보기'],['confirm','발송 확인'],['result','발송 결과']];
  const FIELD_LABEL={name:'업체명',code:'B2B 전용번호',bizNo:'사업자등록번호',address:'주소',representative:'대표자',email:'수신자 이메일',company:'업체'};
  const config=()=>window.SHIN2_CONTRACT_CONFIG||{apiBase:''};
  const auth=()=>window.SHIN2_CONTRACT_AUTH;
  let st=null;

  function apiError(res,body){
    const e=new Error((body&&body.error&&body.error.message)||'요청을 처리하지 못했습니다.');
    e.code=body&&body.error&&body.error.code; e.extra=body&&body.error&&body.error.extra; e.status=res.status;
    return e;
  }
  async function api(method,path,body,opts){
    const a=auth();
    if(!a) throw new Error('로그인 정보를 확인할 수 없습니다.');
    const headers={authorization:'Bearer '+await a.sharedToken()};
    if(opts&&opts.personal) headers['x-contract-sender-token']=await a.senderToken();
    if(body) headers['content-type']='application/json';
    const res=await fetch(config().apiBase+path,{method,headers,body:body?JSON.stringify(body):undefined});
    if(opts&&opts.binary){
      if(res.ok) return {bytes:new Uint8Array(await res.arrayBuffer()),sha256:res.headers.get('x-pdf-sha256')||''};
      throw apiError(res,await res.json().catch(()=>null));
    }
    const json=await res.json().catch(()=>null);
    if(!res.ok) throw apiError(res,json);
    return json;
  }

  function root(plain){
    let el=document.getElementById('cesignOverlay');
    if(!el){
      el=document.createElement('div');el.id='cesignOverlay';el.className='cesign-overlay';
      el.innerHTML='<div class="cesign-panel" role="dialog" aria-modal="true" aria-labelledby="cesignTitle"><div class="cesign-head"><div class="cesign-title" id="cesignTitle"></div><button type="button" class="cesign-close" aria-label="닫기">&times;</button></div><div class="cesign-steps"></div><div class="cesign-body"></div><div class="cesign-foot"></div></div>';
      document.body.appendChild(el);
      el.querySelector('.cesign-close').onclick=close;
    }
    el.classList.toggle('is-plain',!!plain);
    return el;
  }
  function close(){const el=document.getElementById('cesignOverlay');if(el)el.remove();st=null;}
  const q=s=>document.querySelector('#cesignOverlay '+s);

  function shell(title,step){
    const el=root(false);
    el.querySelector('.cesign-title').textContent=title;
    q('.cesign-steps').innerHTML=STEP_LABEL.map(([k,l])=>`<span class="${k===step?'is-on':''}">${esc(l)}</span>`).join('');
    q('.cesign-steps').hidden=false;
    q('.cesign-body').scrollTop=0;
  }
  function setBusy(text){q('.cesign-body').innerHTML=`<div class="cesign-busy" role="status">${esc(text)}</div>`;q('.cesign-foot').innerHTML='';}
  function errorBox(e){
    if(!e) return '';
    const issues=e.extra&&e.extra.issues;
    const blockers=e.extra&&e.extra.blockers;
    const list=issues?issues.map(i=>i.message):blockers?blockers.map(b=>b.message):null;
    return `<div class="cesign-note is-error" role="alert">${esc(e.message)}${list?'<ul>'+list.map(m=>`<li>${esc(m)}</li>`).join('')+'</ul>':''}</div>`;
  }
  function foot(buttons){
    q('.cesign-foot').innerHTML='';
    for(const b of buttons){
      const el=document.createElement('button');el.type='button';el.className='cesign-btn'+(b.primary?' is-primary':'');el.textContent=b.label;
      el.disabled=!!b.disabled;if(b.id)el.id=b.id;el.onclick=b.onClick;q('.cesign-foot').appendChild(el);
    }
  }

  // ---- 1단계: 정보 확인 --------------------------------------------------------
  async function open(co){
    close();
    st={companyId:String(co.id),companyCode:co.code||'',companyName:co.name||'',check:null,form:{contractDate:'',recipientEmail:'',includeSeal:false},version:null,tab:'supply',viewed:{},pdfCache:{},send:null,sends:[],error:null,showSig:true};
    shell(`계약서 2종 준비 · ${st.companyName}`,'info');
    if(!config().apiBase){
      q('.cesign-body').innerHTML='<div class="cesign-note is-warn">계약서 서버가 아직 연결되지 않았습니다. 서버 배포·설정을 마친 뒤 사용할 수 있습니다. 지금은 계약서가 생성·발송되지 않습니다.</div>';
      foot([{label:'닫기',onClick:close}]);
      return;
    }
    await reloadInfo();
  }
  async function reloadInfo(){
    setBusy('업체 정보를 확인하는 중…');
    try{
      const [check,list]=await Promise.all([
        api('POST','/company-check',{companyId:st.companyId,companyCode:st.companyCode}),
        api('GET',`/sends?companyId=${encodeURIComponent(st.companyId)}`),
      ]);
      st.check=check;st.sends=list.sends||[];
      if(!st.form.contractDate) st.form.contractDate=check.defaultContractDate;
      if(!st.form.recipientEmail&&check.company) st.form.recipientEmail=check.company.email||'';
      st.error=null;
    }catch(e){st.error=e;st.check=st.check||{company:null,issues:[],emailCandidates:[],sealImage:{available:false},sendBlockers:[]};}
    renderInfo();
  }
  function renderInfo(){
    if(!st) return;
    shell(`계약서 2종 준비 · ${st.companyName}`,'info');
    const c=st.check.company||{};
    const issues=st.check.issues||[];
    const nonEmail=issues.filter(i=>i.field!=='email');
    const bad=f=>issues.some(i=>i.field===f);
    const kv=(k,v,f,wide)=>`<dl class="cesign-kv${bad(f)?' is-missing':''}${wide?' is-wide':''}"><dt>${esc(k)}</dt><dd>${esc(v||'미등록')}</dd></dl>`;
    const seal=st.check.sealImage||{};
    const active=st.sends[0];
    q('.cesign-body').innerHTML=`
      ${errorBox(st.error)}
      ${active?`<div class="cesign-note">이 업체의 발송 기록이 있습니다(${esc(fmtDate(active.createdAt))}, PDF v${esc(active.version)}). <button type="button" class="cesign-chip" id="cesignSeeHistory">발송 결과 보기</button></div>`:''}
      ${issues.length?`<div class="cesign-note is-warn" role="status"><b>보완이 필요합니다.</b> 임의로 채우지 않습니다.<ul>${issues.map(i=>`<li><b>${esc(FIELD_LABEL[i.field]||i.field)}</b>: ${esc(i.message)}</li>`).join('')}</ul>${nonEmail.length?'고객 카드의 기본 정보를 고친 뒤 [다시 확인]을 눌러주세요.':''}</div>`:''}
      <div class="cesign-grid" style="margin-top:12px">
        ${kv('업체명',c.name,'name')}${kv('B2B 전용번호',c.code,'code')}${kv('사업자등록번호',c.bizNo,'bizNo')}${kv('대표자',c.representative,'representative')}${kv('주소',c.address,'address',true)}
      </div>
      <label class="cesign-field">계약일<input type="date" id="cesignDate" value="${esc(st.form.contractDate)}"></label>
      <label class="cesign-field">수신자 이메일<input type="email" inputmode="email" autocomplete="off" id="cesignEmail" value="${esc(st.form.recipientEmail)}" placeholder="name@example.com"></label>
      ${(st.check.emailCandidates||[]).length>1?`<div class="cesign-chips">${st.check.emailCandidates.map(m=>`<button type="button" class="cesign-chip" data-email="${esc(m)}">${esc(m)}</button>`).join('')}</div>`:''}
      ${seal.available?`<label class="cesign-check"><input type="checkbox" id="cesignSeal"${st.form.includeSeal?' checked':''}><span>우리 도장 이미지를 지정 위치에 넣기 ${seal.kind==='test'?'<span class="cesign-tag">시험용 이미지</span>':''}<br><small>이미지를 넣는 것일 뿐, 모두사인에서 우리 측 전자서명이 완료되는 것은 아닙니다.</small></span></label>`:'<div class="cesign-note">승인된 우리 도장 이미지가 등록되지 않아 도장 없이 생성합니다.</div>'}
      ${seal.available&&seal.kind!=='test'?`<div class="cesign-field">담당자 인증 <small style="font-weight:400">(실제 도장 이미지를 넣을 때 필요)</small></div><div id="cesignSender">${senderForm(auth()&&auth().senderEmail())}</div>`:''}`;
    if(q('#cesignSender'))bindSender(renderInfo);
    const see=q('#cesignSeeHistory');if(see)see.onclick=()=>{st.send=active;renderResult();};
    q('#cesignDate').oninput=e=>{st.form.contractDate=e.target.value;updateGen();};
    q('#cesignEmail').oninput=e=>{st.form.recipientEmail=e.target.value.trim();updateGen();};
    const sealEl=q('#cesignSeal');if(sealEl)sealEl.onchange=e=>{st.form.includeSeal=e.target.checked;};
    document.querySelectorAll('#cesignOverlay [data-email]').forEach(b=>b.onclick=()=>{st.form.recipientEmail=b.dataset.email;q('#cesignEmail').value=b.dataset.email;updateGen();});
    foot([{label:'다시 확인',onClick:reloadInfo},{label:'PDF 2종 생성',primary:true,id:'cesignGenerate',onClick:generate}]);
    updateGen();
  }
  function updateGen(){
    const btn=q('#cesignGenerate');if(!btn)return;
    const nonEmail=(st.check.issues||[]).filter(i=>i.field!=='email');
    btn.disabled=!!nonEmail.length||!st.form.contractDate||!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(st.form.recipientEmail)||!st.check.company;
  }
  async function generate(){
    setBusy('PDF 2종을 만드는 중…');
    try{
      const seal=st.check.sealImage||{};
      st.version=await api('POST','/prepare',{companyId:st.companyId,companyCode:st.companyCode,contractDate:st.form.contractDate,recipientEmail:st.form.recipientEmail,includeSeal:st.form.includeSeal,actorLabel:'사용자 '+(localStorage.getItem('shin2-active-user-id')||'1')},{personal:!!(st.form.includeSeal&&seal.kind!=='test')});
      st.viewed={};st.pdfCache={};st.tab='supply';st.error=null;
      renderPreview();
    }catch(e){
      if(await showActiveSend(e)) return;
      st.error=e;renderInfo();
    }
  }
  // 진행 중인 발송이 있으면 새로 만들지 않고 그 발송 결과를 보여 준다.
  async function showActiveSend(e){
    if(e.code!=='ACTIVE_SEND_EXISTS'||!(e.extra&&e.extra.sendId)) return false;
    try{
      const list=await api('GET',`/sends?companyId=${encodeURIComponent(st.companyId)}`);
      st.send=(list.sends||[]).find(s=>s.sendId===e.extra.sendId)||null;
    }catch(_){st.send=null;}
    if(!st.send) return false;
    st.error=e;renderResult();
    return true;
  }

  // ---- 2단계: 문서별 미리보기 ----------------------------------------------------
  function renderPreview(){
    shell(`계약서 미리보기 · ${st.companyName}`,'preview');
    const v=st.version;
    q('.cesign-body').innerHTML=`
      <div class="cesign-tabs" role="tablist">${TYPES.map(t=>`<button type="button" role="tab" class="cesign-tab${t===st.tab?' is-on':''}" aria-selected="${t===st.tab}" data-tab="${t}">${esc(TYPE_LABEL[t])}</button>`).join('')}</div>
      <p class="cesign-meta" id="cesignMeta"></p>
      <label class="cesign-check" style="margin-top:0"><input type="checkbox" id="cesignShowSig"${st.showSig?' checked':''}><span>서명 위치 표시(화면에만 보이고 PDF에는 들어가지 않습니다)</span></label>
      ${testNotice(v)}
      <div class="cesign-pages" id="cesignPages"></div>`;
    document.querySelectorAll('#cesignOverlay [data-tab]').forEach(b=>b.onclick=()=>{st.tab=b.dataset.tab;renderPreview();});
    q('#cesignShowSig').onchange=e=>{st.showSig=e.target.checked;showTab();};
    foot([
      {label:'정보 수정·재생성',onClick:renderInfo},
      {label:'이 문서 다운로드',id:'cesignDownload',onClick:download},
      {label:'발송 확인으로',primary:true,id:'cesignToConfirm',disabled:!TYPES.every(t=>st.viewed[t]),onClick:renderConfirm},
    ]);
    showTab();
  }
  function testNotice(v){
    const test=TYPES.filter(t=>v.docs[t].templateStatus==='test');
    return test.length?`<div class="cesign-note is-warn">시험용 양식입니다(${test.map(t=>esc(TYPE_LABEL[t])).join(', ')}). 실제 모두사인으로 발송할 수 없습니다.</div>`:'';
  }
  async function sha256Hex(bytes){
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  // 캐시는 버전별로 둔다. 재생성 전 요청의 늦은 응답이 새 버전 자리에 들어가지 않게 하고, 받은 내용의 지문을 직접 확인한다.
  async function loadPdf(type){
    const session=st,v=session.version,key=v.version+':'+type;
    if(session.pdfCache[key]) return session.pdfCache[key];
    const personal=!!(v.sealImage&&v.sealImage.inserted&&v.sealImage.kind!=='test');
    const file=await api('GET',`/pdf?companyId=${encodeURIComponent(v.companyId)}&version=${v.version}&type=${type}`,null,{binary:true,personal});
    if(await sha256Hex(file.bytes)!==v.docs[type].sha256) throw new Error('받은 PDF가 생성 기록과 다릅니다. 다시 생성해주세요.');
    session.pdfCache[key]=file;
    return file;
  }
  async function showTab(){
    const type=st.tab,v=st.version,d=v.docs[type],box=q('#cesignPages');
    const wanted=()=>st&&st.version===v&&st.tab===type;
    q('#cesignMeta').textContent=`PDF v${v.version} · ${d.pageCount}쪽 · 지문 ${d.sha256.slice(0,12)} · 양식 ${d.templateVersion}`;
    box.innerHTML='<div class="cesign-busy" role="status">PDF를 불러오는 중…</div>';
    try{
      const file=await loadPdf(type);
      if(!wanted()) return;
      await renderPages(box,file.bytes,d,st.showSig,wanted);
      if(!wanted()) return;
      st.viewed[type]=true;
      const next=q('#cesignToConfirm');if(next)next.disabled=!TYPES.every(t=>st.viewed[t]);
    }catch(e){if(wanted())box.innerHTML=errorBox(e);}
  }
  let pdfjsPromise=null;
  function pdfjs(){
    if(!pdfjsPromise) pdfjsPromise=import(PDFJS).then(lib=>{lib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;return lib;}).catch(e=>{pdfjsPromise=null;throw e;});
    return pdfjsPromise;
  }
  async function renderPages(box,bytes,doc,showSig,stillWanted){
    const lib=await pdfjs();
    const pdf=await lib.getDocument({data:bytes.slice()}).promise;
    if(!stillWanted()) return;
    box.innerHTML='';
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const positions=(doc&&doc.signaturePositions)||{};
    for(let n=1;n<=pdf.numPages;n++){
      const page=await pdf.getPage(n);
      if(!stillWanted()) return;
      const base=page.getViewport({scale:1});
      const width=Math.min(box.clientWidth||760,760);
      const vp=page.getViewport({scale:(width/base.width)*dpr});
      const canvas=document.createElement('canvas');canvas.width=vp.width;canvas.height=vp.height;
      const wrap=document.createElement('div');wrap.className='cesign-page';wrap.setAttribute('data-page',n);wrap.appendChild(canvas);box.appendChild(wrap);
      // 기본(display)은 requestAnimationFrame 을 써서 탭이 가려지면 렌더링이 멈춘다.
      await page.render({canvasContext:canvas.getContext('2d'),viewport:vp,intent:'print'}).promise;
      if(showSig){
        for(const [key,label,cls] of [['counterparty','상대방 서명',''],['company','우리 측 서명','is-company']]){
          const b=positions[key];
          if(!b||b.page!==n) continue;
          const s=document.createElement('div');s.className='cesign-sigbox '+cls;
          s.style.cssText=`left:${b.x/base.width*100}%;top:${b.y/base.height*100}%;width:${b.w/base.width*100}%;height:${b.h/base.height*100}%`;
          s.innerHTML=`<b>${label}</b>`;wrap.appendChild(s);
        }
      }
    }
  }
  async function download(){
    try{
      const file=await loadPdf(st.tab);
      saveBlob(file.bytes,st.version.docs[st.tab].title+'.pdf');
    }catch(e){alert(e.message);}
  }
  function saveBlob(bytes,name){
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
    const a=document.createElement('a');a.href=url;a.download=name.replace(/[\\/:*?"<>|]/g,'_');document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }

  // ---- 3단계: 발송 확인 ----------------------------------------------------------
  function renderConfirm(){
    shell(`발송 확인 · ${st.companyName}`,'confirm');
    const v=st.version,c=v.company,blockers=st.check.sendBlockers||[],who=auth()&&auth().senderEmail();
    q('.cesign-body').innerHTML=`
      ${errorBox(st.error)}
      <div class="cesign-grid">
        <dl class="cesign-kv"><dt>업체</dt><dd>${esc(c.name)} (${esc(c.code)})</dd></dl>
        <dl class="cesign-kv"><dt>계약일</dt><dd>${esc(v.contractDate)}</dd></dl>
        <dl class="cesign-kv"><dt>대표자(서명자)</dt><dd>${esc(c.representative)}</dd></dl>
        <dl class="cesign-kv"><dt>수신자 이메일</dt><dd>${esc(v.recipientEmail)}</dd></dl>
        ${TYPES.map(t=>`<dl class="cesign-kv is-wide"><dt>${esc(TYPE_LABEL[t])} · PDF v${v.version}</dt><dd>지문 ${esc(v.docs[t].sha256.slice(0,24))}…</dd></dl>`).join('')}
      </div>
      <div class="cesign-note"><b>서명 순서(임시 방식)</b><br>상대방 먼저 서명 → 노란 알림 → 우리 담당자가 모두사인에서 직접 날인. 두 계약서는 문서별로 따로 발송되어 상대방은 서명 요청을 2건 받습니다.<br>
      <b>우리 도장 이미지:</b> ${v.sealImage&&v.sealImage.inserted?`넣음${v.sealImage.kind==='test'?' (시험용)':''}`:'넣지 않음'} · 이미지 삽입은 모두사인 전자서명 완료와 별개입니다.</div>
      ${testNotice(v)}
      ${blockers.length?`<div class="cesign-note is-warn"><b>지금은 발송할 수 없습니다.</b><ul>${blockers.map(b=>`<li>${esc(b.message)}</li>`).join('')}</ul></div>`:''}
      <div class="cesign-field" style="margin-top:16px">발송 담당자 인증 <small style="font-weight:400">(공용 로그인과 별도인 개인 계정)</small></div>
      <div id="cesignSender">${senderForm(who)}</div>
      <label class="cesign-check"><input type="checkbox" id="cesignConfirm"><span>대표자·수신자·계약일과 PDF 2종의 내용을 확인했으며, 위 PDF 그대로 발송합니다.</span></label>`;
    bindSender(renderConfirm);
    q('#cesignConfirm').onchange=refreshSendBtn;
    foot([{label:'미리보기로',onClick:()=>{st.error=null;renderPreview();}},{label:'2종 발송',primary:true,id:'cesignSend',disabled:true,onClick:send}]);
    refreshSendBtn();
  }
  function senderForm(who){
    if(who) return `<div class="cesign-note">${esc(who)} 인증됨 <button type="button" class="cesign-chip" id="cesignSenderOut">다른 계정</button></div>`;
    return `<label class="cesign-field">담당자 이메일<input type="email" id="cesignSenderEmail" autocomplete="username"></label>
      <label class="cesign-field">비밀번호<input type="password" id="cesignSenderPw" autocomplete="current-password"></label>
      <div id="cesignSenderErr"></div>
      <div class="cesign-doc-actions"><button type="button" class="cesign-btn" id="cesignSenderIn">담당자 인증</button></div>`;
  }
  function bindSender(rerender){
    const out=q('#cesignSenderOut');
    if(out)out.onclick=async()=>{await auth().signOutSender();rerender();};
    const btn=q('#cesignSenderIn');
    if(btn)btn.onclick=async()=>{
      btn.disabled=true;q('#cesignSenderErr').innerHTML='';
      try{await auth().signInSender(q('#cesignSenderEmail').value.trim(),q('#cesignSenderPw').value);rerender();}
      catch(_){q('#cesignSenderErr').innerHTML='<div class="cesign-note is-error" role="alert">담당자 인증에 실패했습니다. 이메일·비밀번호를 확인해주세요.</div>';btn.disabled=false;}
    };
  }
  function refreshSendBtn(){
    const btn=q('#cesignSend');if(!btn)return;
    btn.disabled=!(q('#cesignConfirm')&&q('#cesignConfirm').checked&&auth()&&auth().senderEmail()&&!(st.check.sendBlockers||[]).length);
  }
  async function send(){
    const v=st.version;
    const btn=q('#cesignSend');if(btn)btn.disabled=true;
    setBusy('문서별로 발송하는 중입니다. 창을 닫지 마세요…');
    try{
      st.send=await api('POST','/send',{companyId:v.companyId,version:v.version,hashes:{supply:v.docs.supply.sha256,mou:v.docs.mou.sha256},recipientEmail:v.recipientEmail,representative:v.company.representative,confirmed:true},{personal:true});
      st.error=null;renderResult();
    }catch(e){
      st.error=e;
      if(e.code==='SENDER_REAUTH_REQUIRED') await auth().signOutSender();
      if(await showActiveSend(e)) return;
      renderConfirm();
    }
  }

  // ---- 4단계: 결과·이력 ----------------------------------------------------------
  // 서버가 멈춘 뒤 남은 처리 중·대기 문서도 재시도 대상이다. 서버가 상태를 확인한 뒤에만 보낸다.
  const RETRYABLE=['pending','creating','failed','unknown','unknown_not_found'];
  const DELIVERY={pending:['대기','wait'],creating:['처리 중','wait'],created:['발송 완료','ok'],failed:['실패','bad'],unknown:['결과 확인 중','wait'],unknown_not_found:['문서 없음 · 확인 필요','bad'],duplicate_suspect:['중복 의심 · 확인 필요','bad']};
  function fmtDate(iso){
    if(!iso) return '';
    const d=new Date(iso);
    return isNaN(d)?String(iso):d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function renderResult(){
    shell(`발송 결과 · ${st.companyName}`,'result');
    const s=st.send,who=auth()&&auth().senderEmail();
    const needsPersonal=TYPES.some(t=>RETRYABLE.concat('duplicate_suspect').includes(s.documents[t].delivery));
    q('.cesign-body').innerHTML=`
      ${errorBox(st.error)}
      <div class="cesign-grid">
        <dl class="cesign-kv"><dt>수신자 · 대표자</dt><dd>${esc(s.recipientEmail)} · ${esc(s.representative)}</dd></dl>
        <dl class="cesign-kv"><dt>계약일 · PDF</dt><dd>${esc(s.contractDate)} · v${esc(s.version)}</dd></dl>
        <dl class="cesign-kv"><dt>처리자</dt><dd>${esc((s.processedBy&&s.processedBy.email)||'')}</dd></dl>
        <dl class="cesign-kv"><dt>우리 도장 이미지</dt><dd>${s.sealImage&&s.sealImage.inserted?`넣음${s.sealImage.kind==='test'?' (시험용)':''}`:'넣지 않음'}</dd></dl>
      </div>
      ${TYPES.map(t=>docCard(s.documents[t])).join('')}
      <div class="cesign-note">상대방 서명 완료, 양측 최종 서명 완료, 고객관리카드의 MOU 체결 상태는 서로 다른 상태입니다. MOU 체결 상태는 자동으로 바뀌지 않습니다.</div>
      ${needsPersonal||!who?`<div class="cesign-field" style="margin-top:14px">담당자 인증 <small style="font-weight:400">(재시도·문서 보기에 필요)</small></div><div id="cesignSender">${senderForm(who)}</div>`:''}`;
    if(q('#cesignSender'))bindSender(renderResult);
    document.querySelectorAll('#cesignOverlay [data-retry]').forEach(b=>b.onclick=()=>retry(b.dataset.retry));
    document.querySelectorAll('#cesignOverlay [data-keep]').forEach(b=>b.onclick=()=>keepDuplicate(b.dataset.keepType,b.dataset.keep));
    document.querySelectorAll('#cesignOverlay [data-view]').forEach(b=>b.onclick=()=>viewSigned({sendId:s.sendId,docType:b.dataset.view,companyName:s.companyName}));
    foot([{label:'상태 조회',id:'cesignRefresh',onClick:refresh},{label:'새로 준비',onClick:()=>{st.error=null;st.send=null;reloadInfo();}},{label:'닫기',primary:true,onClick:close}]);
  }
  function docCard(d){
    const [label,cls]=DELIVERY[d.delivery]||[d.delivery,''];
    const retryable=RETRYABLE.includes(d.delivery);
    const last=(d.attempts||[])[(d.attempts||[]).length-1];
    return `<section class="cesign-doc" data-doc="${esc(d.type)}">
      <h4>${esc(d.label)}<span class="cesign-state is-${cls}">${esc(label)}</span></h4>
      ${d.failure?`<div class="cesign-note ${d.delivery==='unknown'?'is-warn':'is-error'}" style="margin-top:4px">${esc(d.failure.message)}</div>`:''}
      <dl>
        <dt>모두사인 문서 ID</dt><dd>${esc(d.modusignDocumentId||'-')}</dd>
        <dt>시도</dt><dd>${(d.attempts||[]).length}회${last?` · ${esc(fmtDate(last.at))} · ${esc(last.by)}`:''}</dd>
        <dt>상대방 서명</dt><dd>${d.counterpartySignedAt?esc(fmtDate(d.counterpartySignedAt)):'대기'}</dd>
        <dt>우리 측 전자서명</dt><dd>${d.companySignedAt?esc(fmtDate(d.companySignedAt)):'대기'}</dd>
        <dt>양측 최종 완료</dt><dd>${d.allSignedAt?esc(fmtDate(d.allSignedAt)):'미완료'}</dd>
        ${d.abortedAt?`<dt>중단</dt><dd>${esc(d.abortType||'')} · ${esc(fmtDate(d.abortedAt))}</dd>`:''}
      </dl>
      ${d.abortedAt?'<div class="cesign-note is-warn">이 문서는 중단됐습니다. 다시 보내려면 진행 중인 다른 문서를 모두사인에서 취소한 뒤 [새로 준비]로 새 버전을 만들어주세요.</div>':''}
      ${d.delivery==='unknown_not_found'?`<label class="cesign-check"><input type="checkbox" data-manual="${esc(d.type)}"><span>모두사인 화면에서 이 문서가 없는 것을 확인했습니다.</span></label>`:''}
      <div class="cesign-doc-actions">
        ${retryable?`<button type="button" class="cesign-btn" data-retry="${esc(d.type)}">이 문서만 재시도</button>`:''}
        ${d.delivery==='duplicate_suspect'?(d.duplicateCandidates||[]).map(id=>`<button type="button" class="cesign-btn" data-keep-type="${esc(d.type)}" data-keep="${esc(id)}">이 문서로 확정: ${esc(String(id).slice(0,8))}</button>`).join(''):''}
        ${d.modusignDocumentId?`<button type="button" class="cesign-btn" data-view="${esc(d.type)}">문서 보기</button>`:''}
      </div>
    </section>`;
  }
  async function retry(type){
    const manualEl=q(`[data-manual="${type}"]`);
    const body={sendId:st.send.sendId,type,manualChecked:!!(manualEl&&manualEl.checked)};
    setBusy('이 문서의 상태를 확인하는 중…');
    try{st.send=await api('POST','/retry',body,{personal:true});st.error=null;}
    catch(e){st.error=e;await reloadSend();}
    renderResult();
  }
  async function keepDuplicate(type,keepDocumentId){
    if(!confirm('모두사인에서 나머지 문서를 취소했나요? 이 문서를 발송 문서로 확정합니다.')) return;
    setBusy('문서를 확인하는 중…');
    try{st.send=await api('POST','/resolve-duplicate',{sendId:st.send.sendId,type,keepDocumentId},{personal:true});st.error=null;}
    catch(e){st.error=e;}
    renderResult();
  }
  async function reloadSend(){
    try{st.send=await api('POST','/refresh',{sendId:st.send.sendId});}catch(_){/* 화면의 마지막 값을 유지 */}
  }
  async function refresh(){
    setBusy('모두사인 상태를 조회하는 중…');
    try{st.send=await api('POST','/refresh',{sendId:st.send.sendId});st.error=null;}
    catch(e){st.error=e;}
    renderResult();
  }

  // ---- 서명 문서 보기: 알림·결과 화면 공용. 배경을 어둡게 하지 않는 옆 패널이다. --------
  async function viewSigned(item){
    if(!st) st={sendsOnly:true};
    const hadSend=st.send;
    const el=root(true);
    el.querySelector('.cesign-title').textContent=`${TYPE_LABEL[item.docType]||'문서'} · ${item.companyName||''}`;
    q('.cesign-steps').hidden=true;
    const backToResult=()=>{ el.classList.remove('is-plain'); if(hadSend) renderResult(); else close(); };
    const show=async()=>{
      if(!(auth()&&auth().senderEmail())){
        q('.cesign-body').innerHTML=`<div class="cesign-note">서명 문서는 권한이 확인된 담당자만 볼 수 있습니다.</div><div id="cesignSender">${senderForm(null)}</div>`;
        bindSender(show);
        foot([{label:'닫기',onClick:backToResult}]);
        return;
      }
      setBusy('문서를 불러오는 중…');
      let file;
      try{
        file=await api('GET',`/signed-document?sendId=${encodeURIComponent(item.sendId)}&type=${encodeURIComponent(item.docType)}`,null,{binary:true,personal:true});
      }catch(e){
        q('.cesign-body').innerHTML=errorBox(e);
        foot([{label:'닫기',onClick:backToResult}]);
        return;
      }
      q('.cesign-body').innerHTML='<div class="cesign-pages" id="cesignPages"></div>';
      foot([{label:'다운로드',onClick:()=>saveBlob(file.bytes,`${TYPE_LABEL[item.docType]}_${item.companyName||''}.pdf`)},{label:'닫기',primary:true,onClick:backToResult}]);
      try{await renderPages(q('#cesignPages'),file.bytes,null,false,()=>!!document.getElementById('cesignOverlay'));}
      catch(e){q('#cesignPages').innerHTML=errorBox(e);}
    };
    await show();
  }

  window.SHIN2_CONTRACT_ESIGN={open,viewSigned};
})();
