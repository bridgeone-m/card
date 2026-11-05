/* §B2B KPI 탭(2026-11) — 관리자 전용. 업무트래커(shared/b2bOpsTracker)의 담당자·지표 기록을 함께 읽고 쓴다.
   화면: 종합 KPI → 뒤처진 부분 → 팀 진척 → 팀원 진척 → 점수 반영 흐름.
   원칙: 실제 KPI 실적과 업무 관리점수 분리, 미측정·미배정은 0점 처리·100점 환산 없이 따로 표시.
   계약서 발송 탭(contract-esign.js)과 같은 방식으로 상단 탭 버튼과 전체 화면 패널을 붙인다. */
(function(){
  'use strict';
  var TRACKER_URL = 'https://hansol941201.github.io/B2B/';
  var POLL_MS = 30000;
  var ACTOR = 'B2B KPI 탭(고객관리카드)';
  var st = { shape: null, ui: { state: 'loading', month: null }, timer: null, busy: false };

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nowMonth(){ var d = new Date(), m = d.getMonth() + 1; return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m; }
  function shiftMonth(m, n){ var a = m.split('-'), d = new Date(+a[0], +a[1] - 1 + n, 1), mm = d.getMonth() + 1; return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm; }
  function monthLabel(m){ var a = m.split('-'); return a[0] + '년 ' + (+a[1]) + '월'; }
  function f1(v){ return (Math.round(v * 10) / 10).toFixed(1); }
  function pct(v){ return v == null ? '—' : (Math.round(v * 10) / 10) + '%'; }

  function head(ui){
    return '<div class="b2bkpi-head"><h2 class="b2bkpi-title">B2B KPI</h2>' +
      '<div class="b2bkpi-month"><button type="button" class="b2bkpi-btn" data-kpi-act="month" data-n="-1" aria-label="이전 달">‹</button>' +
      '<b>' + esc(monthLabel(ui.month)) + '</b>' +
      '<button type="button" class="b2bkpi-btn" data-kpi-act="month" data-n="1" aria-label="다음 달">›</button></div>' +
      '<div class="b2bkpi-headr">' + (ui.loadedAt ? '<span class="b2bkpi-muted">읽은 시각 ' + esc(ui.loadedAt) + '</span>' : '') +
      '<a class="b2bkpi-link" href="' + TRACKER_URL + '" target="_blank" rel="noopener">개인 업무트래커 열기 ↗</a>' +
      '<button type="button" class="b2bkpi-btn" data-kpi-act="close">닫기</button></div></div>';
  }
  /* 화면 HTML(순수 함수 — DOM 을 쓰지 않는다). model 은 B2BKpiCalc.buildModel 결과. */
  function renderHtml(model, ui){
    ui = ui || {};
    var out = '<div class="b2bkpi-inner">' + head({ month: ui.month || nowMonth(), loadedAt: ui.loadedAt });
    if(ui.state === 'error'){
      out += '<div class="b2bkpi-card b2bkpi-error"><b>업무트래커에 연결하지 못했습니다</b><p class="b2bkpi-muted">' + esc(ui.error || '') +
        '</p><button type="button" class="b2bkpi-btn is-primary" data-kpi-act="reload">다시 시도</button></div>';
    } else if(ui.state !== 'ready' || !model){
      out += '<div class="b2bkpi-card b2bkpi-muted">불러오는 중…</div>';
    } else {
      out += renderReady(model, ui);
    }
    return out + '</div>';
  }
  function renderReady(model, ui){ return ''; }

  /* ---- DOM ---- */
  function el(){ return document.getElementById('b2bKpiView'); }
  function place(v){ var h = document.querySelector('header.gnav'); v.style.top = Math.max(0, h ? h.getBoundingClientRect().bottom : 0) + 'px'; }
  function render(){
    var v = el(); if(!v) return;
    var model = null;
    if(st.ui.state === 'ready' && st.shape && window.B2BKpiCalc) model = window.B2BKpiCalc.buildModel(st.shape, st.ui.month);
    v.innerHTML = renderHtml(model, st.ui);
  }
  function load(){
    if(!window.B2BKpiStore) return Promise.resolve();
    return window.B2BKpiStore.read().then(function(s){
      st.shape = s || {}; st.ui.state = 'ready'; st.ui.error = null;
      var d = new Date(); st.ui.loadedAt = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }).catch(function(e){
      if(!st.shape){ st.ui.state = 'error'; st.ui.error = String(e && e.message || e); }
    }).then(render);
  }
  function open(){
    if(!window.crmAdminOk('B2B KPI')) return;
    var v = el();
    if(!v){ v = document.createElement('section'); v.id = 'b2bKpiView'; v.className = 'b2bkpi-view'; v.setAttribute('aria-label', 'B2B KPI'); document.body.appendChild(v); v.addEventListener('click', onClick); }
    if(!st.ui.month) st.ui.month = nowMonth();
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#crmTopTabs .top-tab,.gnav-drawer-menu .gnav-drawer-item'));
    tabs.forEach(function(b){ b.classList.toggle('is-active', !!b.dataset.b2bkpiTab); });
    document.body.classList.add('b2bkpi-on');
    place(v); render(); load();
    clearInterval(st.timer);
    st.timer = setInterval(function(){ if(!document.hidden && !st.busy) load(); }, POLL_MS);
  }
  function close(){
    clearInterval(st.timer); st.timer = null;
    var v = el(); if(v) v.remove();
    if(!document.body.classList.contains('b2bkpi-on')) return;
    document.body.classList.remove('b2bkpi-on');
    document.querySelectorAll('[data-b2bkpi-tab]').forEach(function(b){ b.classList.remove('is-active'); });
    var cust = document.getElementById('crmTabCustomer'); if(cust && !document.querySelector('#crmTopTabs .top-tab.is-active')) cust.classList.add('is-active');
  }
  function onClick(e){
    var t = e.target.closest && e.target.closest('[data-kpi-act]'); if(!t) return;
    var act = t.getAttribute('data-kpi-act');
    if(act === 'close'){ var c = document.getElementById('crmTabCustomer'); if(c) c.click(); else close(); return; }
    if(act === 'reload'){ st.ui.state = 'loading'; render(); load(); return; }
    if(act === 'month'){ st.ui.month = shiftMonth(st.ui.month, +t.getAttribute('data-n')); render(); return; }
    if(handlers[act]) handlers[act](t, e);
  }
  var handlers = {};

  var ICON = '<svg class="top-tab-ico" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-8"/></svg>';
  function install(){
    var nav = document.getElementById('crmTopTabs');
    if(!nav || document.getElementById('crmTabB2bKpi')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'top-tab'; btn.id = 'crmTabB2bKpi'; btn.dataset.b2bkpiTab = '1';
    btn.innerHTML = ICON + 'B2B KPI'; btn.onclick = open;
    var cust = document.getElementById('crmTabCustomer');
    if(cust && cust.parentNode === nav) cust.after(btn); else nav.appendChild(btn);
    var drawer = document.querySelector('.gnav-drawer-menu');
    if(drawer){
      var item = document.createElement('button');
      item.type = 'button'; item.className = 'gnav-drawer-item'; item.id = 'gnavDrawerTabB2bKpi'; item.dataset.b2bkpiTab = '1'; item.textContent = 'B2B KPI';
      item.onclick = function(){ var c = document.getElementById('gnavDrawerCloseBtn'); if(c) c.click(); open(); };
      var dc = document.getElementById('gnavDrawerTabCustomer');
      if(dc && dc.parentNode === drawer) dc.after(item); else drawer.appendChild(item);
    }
    // 다른 탭·메뉴를 누르면 이 화면을 닫는다(그 탭의 원래 동작은 그대로).
    document.addEventListener('click', function(e){
      var t = e.target.closest && e.target.closest('#crmTopTabs .top-tab,.gnav-drawer-menu .gnav-drawer-item');
      if(t && !t.dataset.b2bkpiTab) close();
    }, true);
    window.addEventListener('resize', function(){ var v = el(); if(v) place(v); });
  }

  var api = { renderHtml: renderHtml, open: open, close: close, render: render };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined' && typeof document !== 'undefined'){
    window.B2BKpiTab = api;
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  }
})();
