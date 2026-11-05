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
      if(ui.stale) out += '<div class="b2bkpi-note b2bkpi-stale">연결이 끊겼습니다 · 마지막 읽기 ' + esc(ui.loadedAt || '') + ' · 아래 숫자는 그때 기준입니다 <button type="button" class="b2bkpi-btn" data-kpi-act="reload">다시 시도</button></div>';
      out += renderReady(model, ui);
    }
    return out + '</div>';
  }
  /* 번호: 숫자는 '2. ', 원문자(①) 등은 '① ' — '①.' 처럼 점이 겹치지 않게 */
  function numPre(no){ no = String(no == null ? '' : no); return !no ? '' : /^\d+$/.test(no) ? no + '. ' : no + ' '; }
  function pts(v){ return v == null ? '— 점' : f1(v) + '점'; }
  function pill(kind, text){ return '<span class="b2bkpi-pill is-' + kind + '">' + esc(text) + '</span>'; }
  function sec(no, title, sub, body, extra){
    return '<section class="b2bkpi-sec"><div class="b2bkpi-sec-head"><h3>' + no + ' ' + esc(title) + '</h3>' + (sub ? '<span class="b2bkpi-muted">' + sub + '</span>' : '') + (extra || '') + '</div>' + body + '</section>';
  }
  function weightLine(c){
    var w = function(v){ return f1(v).replace(/\.0$/, ''); }, a =['반영 ' + w(c.reflected) + '%'];
    if(c.waiting > 0.001) a.push('대기 ' + w(c.waiting) + '%');
    if(c.unassigned > 0.001) a.push('미배정 ' + w(c.unassigned) + '%');
    return a.join(' · ');
  }
  function bar(r){
    var w = r.rate == null ? 0 : Math.min(100, r.rate / r.challenge * 100), at = function(v){ return Math.min(100, v / r.challenge * 100); };
    return '<div class="b2bkpi-bar" aria-hidden="true"><i class="is-cur" style="width:' + w + '%"></i>' +
      '<b class="tick" style="left:' + at(r.base) + '%" title="기준 ' + r.base + '"></b><b class="tick is-goal" style="left:' + at(r.target) + '%" title="목표 ' + r.target + '"></b>' +
      '<b class="tick is-stretch" style="left:100%" title="도전 ' + r.challenge + '"></b></div>';
  }
  function kpiCard(r){
    var p = r.ach == null ? pill('wait', '실적 대기') : r.ach >= 100 ? pill('ok', '순조') : pill('warn', '뒤처짐');
    return '<div class="b2bkpi-card b2bkpi-kpi"><div class="b2bkpi-kpi-name">' + esc((r.no ? r.no + ' ' : '') + r.name) + (r.auto ? pill('auto', '자동') : '') + '</div>' +
      '<div class="b2bkpi-kpi-val"><b>' + (r.rate == null ? '—' : f1(r.rate) + '%') + '</b>' + (r.num != null && r.den != null ? '<span class="b2bkpi-muted"> ' + r.num + ' / ' + r.den + '</span>' : '') + '</div>' +
      bar(r) + '<div class="b2bkpi-kpi-foot"><span class="b2bkpi-muted">기준 ' + r.base + ' · <b>목표 ' + r.target + '</b> · 도전 ' + r.challenge + '</span>' + p + '</div>' +
      '<div class="b2bkpi-muted">달성 ' + pct(r.ach) + '</div></div>';
  }
  function personCard(model, row, ui){
    var p = model.persons[row.memberId] || { state: 'nodefs', rows: [], total: 0, measured: 0 }, lags = (model.lags || {})[row.memberId] || [];
    var score = p.state === 'ok' ? '<b class="b2bkpi-big2">' + f1(p.value) + '점</b>' : p.state === 'nodefs' ? pill('wait', '지표 미등록') : pill('wait', '산출 대기');
    var out = '<div class="b2bkpi-card b2bkpi-person"><div class="b2bkpi-person-head"><div><b class="b2bkpi-person-name">' + esc(row.name) + '</b>' +
      '<div class="b2bkpi-muted">개인 몫 ' + f1(row.share).replace(/\.0$/, '') + '%' + (row.temporary ? ' (임시 비중)' : '') + '</div></div>' +
      '<div class="b2bkpi-person-score">' + score + (p.total ? '<div class="b2bkpi-muted">' + p.measured + '/' + p.total + '개 측정</div>' : '') + '</div></div>';
    if(model.compareNotes && model.compareNotes[row.memberId]) out += '<div class="b2bkpi-note">측정 항목이 달라 지난달 점수와 단순 비교할 수 없습니다</div>';
    if(p.state === 'nodefs') out += '<p class="b2bkpi-muted">선행·후행 지표가 등록되면 같은 방식으로 계산합니다. 이 사람의 몫은 다른 팀원에게 넘기지 않습니다.</p>';
    out += (p.rows || []).map(function(r){
      var open = ui.openDef === r.id;
      var val = r.state === 'ok' ? f1(r.rate) + '%' : r.state === 'empty' ? '대상 없음' : '미측정';
      var line = '<div class="b2bkpi-lead' + (r.state === 'ok' ? '' : ' is-none') + '"><div class="b2bkpi-lead-main"><span class="b2bkpi-lead-name">' + esc(numPre(r.no) + r.name) + '</span>' + (r.auto ? pill('auto', '자동') : '') +
        '<span class="b2bkpi-lead-val">' + val + (r.target ? ' <span class="b2bkpi-muted">/ 목표 ' + r.target + '</span>' : '') + '</span></div>' +
        '<div class="b2bkpi-lead-sub"><button type="button" class="b2bkpi-linkbtn" data-kpi-act="toggleDef" data-def="' + esc(r.id) + '">세부업무 완료 ' + r.tasks.done + ' · 진행 ' + r.tasks.doing + ' · 남음 ' + r.tasks.todo + (open ? ' · 접기' : ' · 펼치기') + '</button>' +
        '<a class="b2bkpi-linkbtn" href="' + TRACKER_URL + '" target="_blank" rel="noopener">트래커에서 입력</a></div>';
      if(open) line += '<div class="b2bkpi-tasks" data-def-tasks="' + esc(r.id) + '"></div>';
      return line + '</div>';
    }).join('');
    if(lags.length) out += '<div class="b2bkpi-lags"><div class="b2bkpi-muted">후행지표 · 관리 후 고객 변화(점수에 넣지 않음)</div>' + lags.map(function(g){
      return '<div class="b2bkpi-lag"><span>' + esc(numPre(g.no) + g.name) + '</span><span>' + (g.rate == null ? '미측정' : f1(g.rate) + '%') + (g.target != null ? ' <span class="b2bkpi-muted">/ 목표 ' + g.target + '</span>' : '') + '</span></div>';
    }).join('') + '</div>';
    return out + '<div class="b2bkpi-person-foot"><button type="button" class="b2bkpi-btn" data-kpi-act="edit" data-member="' + esc(row.memberId) + '">지표 등록·수정</button></div></div>';
  }
  function renderReady(model, ui){
    var c = model.composite, a = model.actual, t = model.team;
    var teamP = c.parts.filter(function(p){ return p.key === 'team'; })[0];
    var persP = c.parts.filter(function(p){ return p.key.indexOf('p:') === 0; }), persOk = persP.filter(function(p){ return p.state === 'ok'; });
    var persPts = persOk.reduce(function(s, p){ return s + p.points; }, 0);
    var out = '';
    // ① 종합 KPI
    out += sec('①', '종합 KPI', '', '<div class="b2bkpi-big">' +
      '<div class="b2bkpi-card b2bkpi-total"><div class="b2bkpi-muted">종합점수</div><div class="b2bkpi-num">' + (c.reflected > 0 ? f1(c.points) + '점' : '— 점') + '</div>' +
        '<div class="b2bkpi-wline">' + weightLine(c) + '</div><div class="b2bkpi-muted">실적 60 + 팀 공동 20 + 개인 20 · 100점 환산 안 함</div></div>' +
      '<div class="b2bkpi-card"><div class="b2bkpi-muted">실제 KPI 실적 (60%)</div><div class="b2bkpi-num">' + (a.value == null ? '실적 대기' : f1(a.value) + '%') + '</div>' +
        '<div class="b2bkpi-muted">KPI ' + a.total + '개 중 ' + a.measured + '개 측정 · 고객 요청 기록 기준</div></div>' +
      '<div class="b2bkpi-card"><div class="b2bkpi-muted">업무 관리점수 (40%)</div><div class="b2bkpi-num">' + (teamP.state === 'ok' || persOk.length ? f1((teamP.points || 0) + persPts) + '점' : '산출 대기') + '</div>' +
        '<div class="b2bkpi-muted">팀 공동 ' + (teamP.state === 'ok' ? f1(teamP.points) + '점 / 20' : '산출 대기') + ' · 개인 ' + (persOk.length ? f1(persPts) + '점 / 20' : '산출 대기') + '</div></div>' +
      '</div><div class="b2bkpi-kpis">' + a.rows.map(kpiCard).join('') + '</div>');
    // ② 뒤처진 부분
    out += sec('②', '뒤처진 부분', '', model.laggards.length ? '<ul class="b2bkpi-lag-list">' + model.laggards.map(function(x){
      return '<li>' + pill(x.kind === 'kpi' ? 'warn' : x.kind === 'lead' ? 'warn' : 'wait', x.kind === 'kpi' ? 'KPI' : x.kind === 'lead' ? '업무' : '미측정') + ' <b>' + esc(x.label) + '</b> <span class="b2bkpi-muted">' + esc(x.detail) + '</span></li>';
    }).join('') + '</ul>' : '<p class="b2bkpi-muted">지금 뒤처진 항목이 없습니다</p>');
    // ③ 팀 진척
    out += sec('③', '팀 진척', '팀 공동 업무 (20%) · KPI별 관리 업무 체크', '<div class="b2bkpi-card"><div class="b2bkpi-team-head"><b>팀 공동 업무</b>' +
      (t.state === 'ok' ? '<span><b class="b2bkpi-big2">' + f1(t.value) + '%</b> <span class="b2bkpi-muted">' + t.checked + '/' + t.total + '개 체크</span></span>' : pill('wait', '산출 대기 · 이번 달 체크 기록 없음')) + '</div>' +
      '<div class="b2bkpi-team-grid">' + t.byKpi.map(function(k){
        return '<div><div class="b2bkpi-team-kpi">' + esc((k.no ? k.no + ' ' : '') + k.name) + '</div>' + k.items.map(function(it){
          return '<button type="button" class="b2bkpi-check' + (it.checked ? ' is-on' : '') + '" data-kpi-act="team" data-k="' + k.id + '" data-i="' + it.i + '" aria-pressed="' + it.checked + '"><span class="box">' + (it.checked ? '✓' : '') + '</span>' + esc(it.text) + '</button>';
        }).join('') + '</div>';
      }).join('') + '</div><div class="b2bkpi-muted">팀 후행지표는 관리 후 고객 변화로, 점수에 넣지 않습니다.</div></div>');
    // ④ 팀원 진척
    var un = model.shares.rows.filter(function(r){ return !r.hasDefs; });
    out += sec('④', '팀원 진척', '개인 업무 20% 안에서 나눔', '<div class="b2bkpi-people">' + model.shares.rows.map(function(r){ return personCard(model, r, ui); }).join('') +
      '<button type="button" class="b2bkpi-card b2bkpi-add" data-kpi-act="add">+ 개인 트래커 추가</button></div>' +
      (model.shares.needsRebalance ? '<div class="b2bkpi-note">새로 들어온 사람의 몫이 정해지지 않았습니다(남은 몫만 임시로 나눔). [개인 몫 나누기]에서 개인 몫을 다시 나눠 주세요</div>' : '') +
      (un.length ? '<div class="b2bkpi-note">미배정 ' + f1(model.shares.unassigned).replace(/\.0$/, '') + '% · ' + un.map(function(r){ return esc(r.name); }).join('·') + ' 지표 미등록 — 다른 팀원에게 넘기지 않습니다</div>' : ''),
      '<button type="button" class="b2bkpi-btn" data-kpi-act="shares">개인 몫 나누기</button>');
    // ⑤ 점수 반영 흐름
    out += '<details class="b2bkpi-flow"><summary>⑤ 점수 반영 흐름</summary><ol>' + c.parts.map(function(p){
      var w = p.key.indexOf('p:') === 0 ? '몫 ' + f1(p.weight).replace(/\.0$/, '') + '%' + (p.temporary ? '(임시)' : '') : '× ' + (p.weight / 100);
      var v = p.state === 'ok' ? (p.key === 'actual' ? f1(a.value) + '%' : p.key === 'team' ? f1(t.value) + '%' : f1(p.score) + '점') + ' ' + w + ' = ' + f1(p.points) + '점'
        : p.state === 'unassigned' ? '미배정(지표 미등록)' : '산출 대기';
      return '<li>' + esc(p.label) + ': ' + esc(v) + '</li>';
    }).join('') + '</ol><p>합계 ' + (c.reflected > 0 ? f1(c.points) + '점' : '— 점') + ' (' + weightLine(c) + ', 100점 환산 안 함)</p>' +
      '<p class="b2bkpi-muted">업무 관리점수는 실제 KPI 실적에 더해지지 않습니다. 실적은 고객 요청 기록으로만 계산합니다.</p></details>';
    return out;
  }

  /* ---- DOM ---- */
  function el(){ return document.getElementById('b2bKpiView'); }
  function place(v){ var h = document.querySelector('header.gnav'); v.style.top = Math.max(0, h ? h.getBoundingClientRect().bottom : 0) + 'px'; }
  function render(){
    var v = el(); if(!v) return;
    var model = null;
    if(st.ui.state === 'ready' && st.shape && window.B2BKpiCalc) model = window.B2BKpiCalc.buildModel(st.shape, st.ui.month);
    v.innerHTML = renderHtml(model, st.ui);
    fillTasks();
  }
  function load(){
    if(!window.B2BKpiStore){ st.ui.state = 'error'; st.ui.error = '업무트래커 연결 파일(b2b-kpi-store.js)을 불러오지 못했습니다'; render(); return Promise.resolve(); }
    return window.B2BKpiStore.read().then(function(s){
      st.shape = s || {}; st.ui.state = 'ready'; st.ui.error = null; st.ui.stale = false;
      var d = new Date(); st.ui.loadedAt = (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }).catch(function(e){
      if(!st.shape){ st.ui.state = 'error'; st.ui.error = String(e && e.message || e); } else st.ui.stale = true;
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
    clearInterval(st.timer); st.timer = null; closeModal();
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
  /* ---- 개인 트래커 추가·수정: 폼 값 → 입력 → 저장 계획(순수 함수, 테스트 대상) ---- */
  function numOrNull(v){ var s = String(v == null ? '' : v).trim(); if(!s) return null; var n = Number(s); return isFinite(n) ? n : NaN; }
  function formToInputs(fv){
    var leadEmpty = function(r){ return !r.id && !String(r.name || '').trim() && !String(r.tasksText || '').trim() && !String(r.target || '').trim() && !String(r.numLabel || '').trim() && !String(r.denLabel || '').trim(); };
    var member = fv.memberId ? { id: fv.memberId } : { name: String(fv.newName || '').trim(), role: String(fv.newRole || '').trim() };
    var leads = (fv.leads || []).filter(function(r){ return !leadEmpty(r); }).map(function(r){
      var o = { name: String(r.name || '').trim(), cycle: String(r.cycle || '').trim(), purpose: String(r.purpose || '').trim(),
        tasks: String(r.tasksText || '').split(/\r?\n/).map(function(t){ return t.trim(); }).filter(Boolean),
        numLabel: String(r.numLabel || '').trim(), denLabel: String(r.denLabel || '').trim(), target: numOrNull(r.target),
        cardKpis: (r.kpis || []).slice(), cardWeight: numOrNull(r.weight) };
      if(r.id){ o.id = r.id; if(String(r.rev || '') !== '') o.openedRev = Number(r.rev); }
      return o;
    });
    var lags = (fv.lags || []).filter(function(r){ return !leadEmpty(r); }).map(function(r){
      var o = { name: String(r.name || '').trim(), numLabel: String(r.numLabel || '').trim(), denLabel: String(r.denLabel || '').trim(), target: numOrNull(r.target) };
      if(r.id){ o.id = r.id; if(String(r.rev || '') !== '') o.openedRev = Number(r.rev); }
      return o;
    });
    return { member: member, leads: leads, lags: lags };
  }
  /* 저장할 정의와 ID 를 미리 확정한다(두 번 눌러도 같은 ID → 두 번째는 저장소가 'exists' 로 막음). */
  function planSave(shape, inp, nowIso, calc){
    calc = calc || (typeof window !== 'undefined' && window.B2BKpiCalc);
    var tmp = JSON.parse(JSON.stringify(shape || {})); tmp.members = tmp.members || {}; tmp.leadDefs = tmp.leadDefs || {}; tmp.lagDefs = tmp.lagDefs || {};
    var out = { member: null, leads: [], lags: [], errors: [] }, memberId = inp.member && inp.member.id;
    if(!memberId){
      if(!inp.member || !String(inp.member.name || '').trim()) out.errors.push('새 트래커의 이름을 입력해 주세요');
      else { var m = calc.buildMember(inp.member, tmp, nowIso); tmp.members[m.id] = m; memberId = m.id; out.member = { def: m, openedRev: null }; }
    } else if(!tmp.members[memberId]) out.errors.push('트래커 담당자를 찾을 수 없습니다');
    if(!memberId) return out;
    [['leads', 'leadDefs', 'buildLeadDef'], ['lags', 'lagDefs', 'buildLagDef']].forEach(function(k){
      (inp[k[0]] || []).forEach(function(x, i){
        var e = calc.validateDefInput(x);
        if(e.length){ out.errors.push((k[0] === 'leads' ? '선행' : '후행') + ' ' + (i + 1) + '번째: ' + e.join(', ')); return; }
        var prev = x.id ? tmp[k[1]][x.id] : null;
        if(x.id && !prev){ out.errors.push(x.id + ' 지표를 찾을 수 없습니다'); return; }
        var input = Object.assign({}, x); delete input.id; delete input.openedRev;
        var def = calc[k[2]](memberId, input, tmp, nowIso, prev || undefined);
        tmp[k[1]][def.id] = def;
        out[k[0]].push({ def: def, openedRev: prev ? (typeof x.openedRev === 'number' && isFinite(x.openedRev) ? x.openedRev : (prev.rev || 0)) : null });
      });
    });
    return out;
  }

  /* ---- 조작(업무트래커에 저장 후 다시 읽기) ---- */
  function busy(on){ st.busy = on; var v = el(); if(v) v.classList.toggle('is-busy', on); }
  function afterWrite(p){
    busy(true);
    return p.then(function(){ return load(); }).catch(function(e){ alert('저장하지 못했습니다: ' + (e && e.message || e)); }).then(function(){ busy(false); });
  }
  function modalRoot(){ var r = document.getElementById('b2bKpiModal'); if(!r){ r = document.createElement('div'); r.id = 'b2bKpiModal'; document.body.appendChild(r); r.addEventListener('click', onModalClick); } return r; }
  function closeModal(){ st.editPlan = null; var r = typeof document !== 'undefined' && document.getElementById('b2bKpiModal'); if(r) r.innerHTML = ''; }
  function field(label, html){ return '<label class="b2bkpi-f"><span>' + label + '</span>' + html + '</label>'; }
  function inp(name, v, extra){ return '<input class="b2bkpi-in" data-f="' + name + '" value="' + esc(v == null ? '' : v) + '"' + (extra || '') + '>'; }
  function leadRow(d, isLag){
    var kpis = (d && d.cardKpis) || (d && !isLag && d.id && st.shape.mainKpis ? Object.keys(st.shape.mainKpis).filter(function(k){ return (st.shape.mainKpis[k].links || []).some(function(l){ return l.li === d.id; }); }) : []);
    var o = '<fieldset class="b2bkpi-row" data-row="' + (isLag ? 'lag' : 'lead') + '" data-id="' + esc(d && d.id || '') + '" data-rev="' + (d && d.id ? (d.rev || 0) : '') + '"><legend>' + (isLag ? '후행지표' : '선행지표') + (d && d.id ? ' · ' + esc(d.id) : ' · 새로 추가') + '</legend>' +
      field('지표 이름', inp('name', d && d.name)) +
      '<div class="b2bkpi-f2">' + field('분자 이름', inp('numLabel', d && d.numLabel)) + field('분모 이름', inp('denLabel', d && d.denLabel)) + field('목표(%)', inp('target', d && d.target, ' inputmode="decimal"')) + '</div>';
    if(!isLag){
      o += '<div class="b2bkpi-f2">' + field('주기', inp('cycle', d && d.cycle)) + field('지표 비중(비우면 같은 비율)', inp('weight', d && d.cardWeight, ' inputmode="decimal"')) + '</div>' +
        field('목적(선택)', inp('purpose', d && d.purpose)) +
        field('세부업무(한 줄에 하나)', '<textarea class="b2bkpi-in" data-f="tasksText" rows="4">' + esc(((d && d.tasks) || []).join('\n')) + '</textarea>') +
        '<div class="b2bkpi-f"><span>연결 KPI(이 탭 표시용)</span><div class="b2bkpi-kpichk">' + ['MK1', 'MK2', 'MK3'].map(function(k, i){
          return '<label><input type="checkbox" data-kpi="' + k + '"' + (kpis.indexOf(k) >= 0 ? ' checked' : '') + '> ' + ['①', '②', '③'][i] + '</label>';
        }).join('') + '</div></div>';
    }
    if(!(d && d.id)) o += '<button type="button" class="b2bkpi-linkbtn" data-m="rmrow">이 줄 빼기</button>';
    return o + '</fieldset>';
  }
  function openEditor(memberId){
    var s = st.shape || {}, C = window.B2BKpiCalc, cfgIds = C.shareRows(s).rows.map(function(r){ return r.memberId; });
    var others = Object.keys(s.members || {}).filter(function(id){ return cfgIds.indexOf(id) < 0; });
    var leads = memberId ? C.leadDefsOf(s, memberId) : [], lags = memberId ? Object.keys(s.lagDefs || {}).map(function(k){ return s.lagDefs[k]; }).filter(function(d){ return d && d.member === memberId; }).sort(function(a, b){ return a.id < b.id ? -1 : 1; }) : [];
    var who = memberId ? '<div class="b2bkpi-f"><span>담당자</span><b>' + esc(C.memberName(s, memberId)) + '</b><input type="hidden" data-f="memberId" value="' + esc(memberId) + '"></div>'
      : field('기존 팀원에서 고르기', '<select class="b2bkpi-in" data-f="memberId"><option value="">새 사람</option>' + others.map(function(id){ return '<option value="' + esc(id) + '">' + esc(C.memberName(s, id)) + '</option>'; }).join('') + '</select>') +
        '<div class="b2bkpi-f2">' + field('새 사람 이름', inp('newName', '')) + field('역할(선택)', inp('newRole', '')) + '</div>';
    modalRoot().innerHTML = '<div class="pi-overlay b2bkpi-ov"><div class="pi-panel b2bkpi-modal" role="dialog" aria-modal="true" aria-label="개인 트래커">' +
      '<h3>' + (memberId ? '지표 등록·수정' : '개인 트래커 추가') + '</h3><p class="b2bkpi-muted">업무트래커와 같은 기록에 저장됩니다. 삭제는 하지 않습니다.</p>' + who +
      '<div data-list="lead">' + leads.map(function(d){ return leadRow(d, false); }).join('') + (leads.length ? '' : leadRow(null, false)) + '</div>' +
      '<button type="button" class="b2bkpi-btn" data-m="addLead">+ 선행지표 줄</button>' +
      '<div data-list="lag">' + lags.map(function(d){ return leadRow(d, true); }).join('') + '</div>' +
      '<button type="button" class="b2bkpi-btn" data-m="addLag">+ 후행지표 줄</button>' +
      '<div class="b2bkpi-err" id="b2bKpiErr"></div><div class="b2bkpi-mfoot"><button type="button" class="b2bkpi-btn" data-m="cancel">취소</button><button type="button" class="b2bkpi-btn is-primary" data-m="save">저장</button></div></div></div>';
  }
  function readForm(root){
    var g = function(sc, f){ var x = sc.querySelector('[data-f="' + f + '"]'); return x ? x.value : ''; };
    var rows = function(kind){ return Array.prototype.slice.call(root.querySelectorAll('fieldset[data-row="' + kind + '"]')).map(function(fs){
      return { id: fs.getAttribute('data-id') || '', rev: fs.getAttribute('data-rev') || '', name: g(fs, 'name'), cycle: g(fs, 'cycle'), purpose: g(fs, 'purpose'), tasksText: g(fs, 'tasksText'),
        numLabel: g(fs, 'numLabel'), denLabel: g(fs, 'denLabel'), target: g(fs, 'target'), weight: g(fs, 'weight'),
        kpis: Array.prototype.slice.call(fs.querySelectorAll('input[data-kpi]:checked')).map(function(c){ return c.getAttribute('data-kpi'); }) };
    }); };
    return { memberId: g(root, 'memberId'), newName: g(root, 'newName'), newRole: g(root, 'newRole'), leads: rows('lead'), lags: rows('lag') };
  }
  /* 저장 계획을 순서대로 저장한다. 이미 저장한 항목(plan._done)은 건너뛰므로, 중간에 실패한 뒤 다시 눌러도
     같은 ID 로 이어서 저장되고 사람·지표가 두 번 생기지 않는다. config(콜백)는 새 사람 저장 직후에 부른다. */
  function runSavePlan(plan, store, afterMember){
    plan._done = plan._done || {};
    var items = [];
    if(plan.member) items.push(['members', plan.member]);
    plan.leads.forEach(function(x){ items.push(['leadDefs', x]); }); plan.lags.forEach(function(x){ items.push(['lagDefs', x]); });
    var chain = Promise.resolve();
    items.forEach(function(it){
      var key = it[0] + '/' + it[1].def.id;
      chain = chain.then(function(){
        if(plan._done[key]) return;
        return store.saveDef(it[0], it[1].def, it[1].openedRev).then(function(r){
          if(!r.ok) throw new Error(r.reason);
          plan._done[key] = true;
          if(it[0] === 'members' && afterMember) return afterMember(it[1].def.id);
        });
      });
    });
    return chain;
  }
  function addToTab(memberId){
    return window.B2BKpiStore.addTabMember(memberId, window.B2BKpiCalc.DEFAULT_MEMBERS, ACTOR).then(function(r){ if(r && r.value) st.shape.kpiTabConfig = r.value; });
  }
  function saveEditor(btn){
    var root = modalRoot(), errEl = document.getElementById('b2bKpiErr');
    if(btn.disabled) return;
    // 첫 시도의 계획을 팝업 동안 유지 — 다시 시도해도 같은 ID 로 이어서 저장
    var plan = st.editPlan || planSave(st.shape, formToInputs(readForm(root)), new Date().toISOString());
    if(plan.errors.length){ errEl.textContent = plan.errors.join(' / '); return; }
    st.editPlan = plan;
    btn.disabled = true; btn.textContent = '저장 중…';
    var mid = plan.member ? null : readForm(root).memberId;
    runSavePlan(plan, window.B2BKpiStore, addToTab).then(function(){ return mid ? addToTab(mid) : null; }).then(function(){ st.editPlan = null; closeModal(); return load(); }).catch(function(e){
      var why = String(e && e.message || e);
      errEl.textContent = why === 'conflict' || why === 'exists' ? '다른 곳에서 먼저 수정되었습니다. 저장된 항목은 그대로 두었습니다. 창을 닫고 다시 열어 저장해 주세요' : '저장하지 못했습니다: ' + why + ' — [저장]을 다시 누르면 남은 항목만 이어서 저장합니다';
      btn.textContent = '저장'; btn.disabled = false;
    });
  }
  function openShares(){
    st.shareOpenedAt = (st.shape && st.shape.kpiTabConfig && st.shape.kpiTabConfig.updatedAt) || null;
    var C = window.B2BKpiCalc, sh = C.shareRows(st.shape || {});
    modalRoot().innerHTML = '<div class="pi-overlay b2bkpi-ov"><div class="pi-panel b2bkpi-modal" role="dialog" aria-modal="true" aria-label="개인 몫 나누기"><h3>개인 몫 나누기</h3>' +
      '<p class="b2bkpi-muted">개인 업무 20% 를 나눕니다(합계 20). 관리자가 정한 비중으로 저장됩니다. 저장 전까지는 같은 비율의 임시 비중입니다.</p>' +
      sh.rows.map(function(r){ return field(esc(r.name) + (r.hasDefs ? '' : ' (지표 미등록)'), '<input class="b2bkpi-in" data-share="' + esc(r.memberId) + '" inputmode="decimal" value="' + (Math.round(r.share * 100) / 100) + '">'); }).join('') +
      '<div class="b2bkpi-err" id="b2bKpiErr"></div><div class="b2bkpi-mfoot"><button type="button" class="b2bkpi-btn" data-m="cancel">취소</button><button type="button" class="b2bkpi-btn is-primary" data-m="saveShares">저장</button></div></div></div>';
  }
  function saveShares(btn){
    var C = window.B2BKpiCalc, ids = C.shareRows(st.shape).rows.map(function(r){ return r.memberId; }), map = {};
    Array.prototype.slice.call(document.querySelectorAll('[data-share]')).forEach(function(x){ map[x.getAttribute('data-share')] = numOrNull(x.value); });
    var errs = C.validateShares(map, ids);
    if(errs.length){ document.getElementById('b2bKpiErr').textContent = errs.join(' / '); return; }
    btn.disabled = true;
    var cfg = JSON.parse(JSON.stringify((st.shape && st.shape.kpiTabConfig) || {})); cfg.members = ids; cfg.shares = map;
    window.B2BKpiStore.saveConfig(cfg, ACTOR, st.shareOpenedAt).then(function(r){ if(!r.ok) throw new Error('다른 관리자가 먼저 바꿨습니다. 창을 닫고 다시 열어 주세요'); closeModal(); return load(); }).catch(function(e){ btn.disabled = false; document.getElementById('b2bKpiErr').textContent = '저장하지 못했습니다: ' + (e && e.message || e); });
  }
  function onModalClick(e){
    var t = e.target.closest && e.target.closest('[data-m]');
    if(!t){ if(e.target.classList && e.target.classList.contains('b2bkpi-ov')) closeModal(); return; }
    var m = t.getAttribute('data-m');
    if(m === 'cancel') closeModal();
    else if(m === 'save') saveEditor(t);
    else if(m === 'saveShares') saveShares(t);
    else if(m === 'addLead' || m === 'addLag'){ var list = modalRoot().querySelector('[data-list="' + (m === 'addLead' ? 'lead' : 'lag') + '"]'); list.insertAdjacentHTML('beforeend', leadRow(null, m === 'addLag')); }
    else if(m === 'rmrow'){ var fs = t.closest('fieldset'); if(fs) fs.remove(); }
  }
  function fillTasks(){
    var v = el(); if(!v || !st.shape) return;
    Array.prototype.slice.call(v.querySelectorAll('[data-def-tasks]')).forEach(function(box){
      var id = box.getAttribute('data-def-tasks'), d = (st.shape.leadDefs || {})[id] || {}, rec = (st.shape.perfMonthly || {})[id + '_' + st.ui.month];
      box.innerHTML = (d.tasks || []).length ? (d.tasks || []).map(function(name, i){
        var p = window.B2BKpiCalc.taskPct(rec, i), k = p >= 100 ? 'done' : p > 0 ? 'doing' : 'todo';
        return '<div class="b2bkpi-task is-' + k + '"><button type="button" class="b2bkpi-st" data-kpi-act="task" data-def="' + esc(id) + '" data-i="' + i + '" data-p="' + p + '" aria-label="' + esc(name) + ' 상태 바꾸기">' + { todo: '○', doing: '▶', done: '✓' }[k] + '</button><span>' + (i + 1) + '. ' + esc(name) + '</span><span class="b2bkpi-muted">' + p + '%</span></div>';
      }).join('') : '<span class="b2bkpi-muted">세부업무가 없습니다</span>';
    });
  }
  var handlers = {
    toggleDef: function(t){ var id = t.getAttribute('data-def'); st.ui.openDef = st.ui.openDef === id ? null : id; render(); },
    task: function(t){ if(st.busy) return; afterWrite(window.B2BKpiStore.setTaskProg(st.shape, t.getAttribute('data-def'), st.ui.month, +t.getAttribute('data-i'), window.B2BKpiCalc.nextTaskProg(+t.getAttribute('data-p')), ACTOR)); },
    team: function(t){ if(st.busy) return; afterWrite(window.B2BKpiStore.toggleTeamCheck(st.shape, t.getAttribute('data-k'), st.ui.month, +t.getAttribute('data-i'), ACTOR)); },
    add: function(){ openEditor(null); },
    edit: function(t){ openEditor(t.getAttribute('data-member')); },
    shares: function(){ openShares(); }
  };

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

  var api = { renderHtml: renderHtml, open: open, close: close, render: render, formToInputs: formToInputs, planSave: planSave, runSavePlan: runSavePlan };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined' && typeof document !== 'undefined'){
    window.B2BKpiTab = api;
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  }
})();
