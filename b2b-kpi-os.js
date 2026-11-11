/* §팀 OS 화면(2026-11) — 팀장님 제작지시문의 6메뉴(홈·신규 협약·기존 고객·상담·전화·고객 의견·민원·팀원 업무·알람)와 홈 6영역.
   순수 함수(DOM 없음). 고객 정보는 넣지 않는다: 숫자는 값 저장소의 확인분(업체명 없음)과 로그인한 카드가 계산한 값만 쓴다.
   원칙: 행동 템플릿은 업무 실체가 아니다 — 확정 업무·과거 이력이 없으면 '행동 기록 수집 전', 가짜 0%/100% 금지.
   업무 완료는 고객 KPI 성과를 올리지 않는다. 90일 무요청은 자동 해지가 아니다. 활동 후보 166곳은 이탈 확정이 아니다. */
(function(){
  'use strict';
  var D = (typeof window !== 'undefined' && window.B2BKpiOsData) || {};
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function f1(v){ return (Math.round(v * 10) / 10).toFixed(1); }
  function n0(v){ return Number(v).toLocaleString('ko-KR'); }
  function pill(kind, text){ return '<span class="b2bkpi-pill is-' + kind + '">' + esc(text) + '</span>'; }
  function sec(no, title, sub, body){
    return '<section class="b2bkpi-sec"><div class="b2bkpi-sec-head"><h3>' + no + ' ' + esc(title) + '</h3>' + (sub ? '<span class="b2bkpi-muted">' + esc(sub) + '</span>' : '') + '</div>' + body + '</section>';
  }
  function cutoffShort(c){ var m = /^\d{4}-(\d{1,2})-(\d{1,2})/.exec(c || ''); return m ? (+m[1]) + '/' + (+m[2]) : '확인분'; }
  function menuBtn(id, label, cls){ return '<button type="button" class="b2bkpi-btn' + (cls ? ' ' + cls : '') + '" data-kpi-act="menu" data-menu="' + id + '">' + esc(label) + '</button>'; }
  function tpls(filter){ return (D.templates || []).filter(filter); }
  function tplRow(t){
    var rel = (t.related || []).map(function(k){ return (D.kpiNames[k] || k).split(' ')[0]; });
    return '<div class="b2bkpi-tpl"><div class="b2bkpi-tpl-h"><b>' + esc(t.id) + '</b> ' + (t.hypothesis ? pill('wait', '추가 가설') : '') + ' <span>' + esc(t.action) + '</span></div>' +
      '<div class="b2bkpi-muted">완료 조건 · ' + esc(t.done) + '</div>' + (rel.length ? '<div class="b2bkpi-muted">관련 ' + esc(rel.join(' · ')) + '</div>' : '') + '</div>';
  }
  function row(model, id){ return (model && model.actual && model.actual.rows || []).filter(function(r){ return r.id === id; })[0] || null; }
  function missedRows(model){ return model && model.meeting ? (model.meeting.rows || []).filter(function(r){ return r.cls === 'missed' && r.inScope; }) : []; }

  /* ---- 메뉴 막대 ---- */
  function menuBar(active){
    return '<nav class="b2bkpi-menu" role="tablist" aria-label="B2B 팀 OS 메뉴">' + (D.menus || []).map(function(m){
      var on = m.id === active;
      return '<button type="button" role="tab" class="b2bkpi-menubtn' + (on ? ' is-on' : '') + '" aria-selected="' + on + '" data-kpi-act="menu" data-menu="' + m.id + '">' + esc(m.label) + '</button>';
    }).join('') + '</nav>';
  }

  /* ---- 홈: KPI 카드(맨 위, 탭이 그림) 아래의 5영역 ---- */
  function actionProgress(model){
    var cards = ['MK1', 'MK3', 'MK2'].map(function(id){
      var r = row(model, id), n = tpls(function(t){ return t.kpi === id; }).length;
      var perf = r && r.rate != null ? (r.source === 'official' ? cutoffShort(r.cutoff) + ' 마감 확인분 ' : '') + f1(r.rate) + '%' : '실적 대기';
      return '<div class="b2bkpi-card b2bkpi-act-card"><div class="b2bkpi-kpi-name">' + esc(D.kpiNames[id]) + '</div>' +
        '<div class="b2bkpi-act-row"><span class="b2bkpi-muted">우리 행동 이행률</span><span>' + pill('wait', '행동 기록 수집 전') + '</span></div>' +
        '<div class="b2bkpi-act-row"><span class="b2bkpi-muted">고객 성과</span><b>' + esc(perf) + '</b></div>' +
        '<div class="b2bkpi-muted">확정 업무 0건 · 행동 템플릿 ' + n + '개(주연결)</div></div>';
    }).join('');
    return sec('②', 'KPI별 행동 진척', '행동과 고객 성과를 나란히 · 섞지 않음',
      '<div class="b2bkpi-kpis">' + cards + '</div><p class="b2bkpi-muted">실제 고객·담당·기한을 정해 만든 업무만 셉니다. 과거 행동 이력이 없어 완료율을 만들지 않았고(0%도 100%도 아님), 오늘 쌓는 행동이 10/20 마감 숫자를 만든 것으로 해석하지 않습니다. 업무 완료만으로 고객 성과 숫자는 바뀌지 않습니다.</p>');
  }
  function todayActions(model){
    var miss = missedRows(model);
    var body;
    if(miss.length){
      body = '<ul class="b2bkpi-lag-list">' + miss.slice(0, 5).map(function(r){
        return '<li>' + pill('warn', '미처리 누락') + ' <b>' + esc(r.name) + '</b> <span class="b2bkpi-muted">' + esc(r.stageName || '') + ' · 기한 ' + esc(r.due || '—') + ' · ' + (r.owner ? '담당 ' + esc(r.owner) : '담당 기록 없음') + ' · 관련 KPI1 · 완료 조건: 미팅 처리 기록</span></li>';
      }).join('') + '</ul>' + (miss.length > 5 ? '<p class="b2bkpi-muted">나머지 ' + (miss.length - 5) + '곳은 목록에서 확인</p>' : '');
    } else {
      body = '<p class="b2bkpi-muted">등록된 오늘 업무가 없습니다. 업무는 실제 고객·담당·기한을 정해 만든 것만 표시합니다. 행동 템플릿을 보고 업무를 등록하세요.</p>' + menuBtn('tasks', '업무 템플릿 보기', 'is-primary');
    }
    return sec('③', '오늘 꼭 할 행동', '담당·고객·관련 KPI·완료 조건', body);
  }
  function alerts(model){
    var items = [], miss = missedRows(model), k3 = row(model, 'MK2');
    if(miss.length) items.push({ lv: 'danger', title: '미팅 미처리 누락 ' + miss.length + '곳', why: '카드에 기록된 1·2차 미팅이 기한(예정일+3일)을 넘기고 처리되지 않음 · 우리 지원 쪽 지연', next: '목록에서 업체별 담당·기한 확인', btn: '<button type="button" class="b2bkpi-btn" data-kpi-act="meetingList" data-stage="m1" data-group="all">1차 목록</button> <button type="button" class="b2bkpi-btn" data-kpi-act="meetingList" data-stage="m2" data-group="all">2차 목록</button>' });
    if(k3 && k3.floorState === 'below') items.push({ lv: 'warn', title: 'KPI3 재사용 하한 85% 미달', why: (k3.cutoff ? cutoffShort(k3.cutoff) + ' 마감 확인분 ' : '') + f1(k3.rate) + '% · 하한까지 ' + f1(Math.abs(k3.floorGap)) + '%p 부족 · 고객 성과 지표', next: '재사용 대상 목록에서 막힌 이유 확인(원인 단정 금지)' });
    var un = model && model.shares ? model.shares.rows.filter(function(r){ return !r.hasDefs; }) : [];
    if(un.length) items.push({ lv: 'warn', title: '담당 업무(지표) 미등록 ' + un.length + '명', why: '지표가 등록되지 않아 점수에 반영되지 않음 · 데이터 누락', next: '팀원 업무·알람에서 지표 등록' });
    var cut = model && model.actual && model.actual.cutoff;
    items.push({ lv: 'info', title: '3대 KPI는 ' + cutoffShort(cut) + ' 마감 확인분', why: '실시간 연동 전 · 최신 공식 실적이 아님 · 원천 갱신 상태는 별도로 확인', next: '실시간 연동 후 마감일 갱신' });
    items.push({ lv: 'info', title: '고객 일정 대기 / 우리 지원 지연', why: '서로 다른 이유로 분리해 표시합니다 · 업무 기록 수집 전이라 지금은 집계 없음', next: '업무 등록 후 자동 분리' });
    var body = '<ul class="b2bkpi-alerts">' + items.map(function(a){
      return '<li class="is-' + a.lv + '"><div class="b2bkpi-alert-h">' + pill(a.lv === 'danger' ? 'warn' : a.lv === 'warn' ? 'wait' : 'auto', a.lv === 'danger' ? '위험' : a.lv === 'warn' ? '주의' : '안내') + ' <b>' + esc(a.title) + '</b></div>' +
        '<div class="b2bkpi-muted">' + esc(a.why) + '</div><div>다음 행동 · ' + esc(a.next) + (a.btn ? ' ' + a.btn : '') + '</div></li>';
    }).join('') + '</ul>';
    return sec('④', '빨간 알람·병목', '사유와 다음 행동을 함께', body);
  }
  function customerFlow(model){
    var k1 = row(model, 'MK1'), k3 = row(model, 'MK2'), b = D.baseline || {};
    var side = function(r){ if(!r) return '<p class="b2bkpi-muted">확인분 없음</p>'; return '<ul class="b2bkpi-flowlist">' + (r.breakdown || []).map(function(x){ return '<li>' + esc(x.label + ' ' + n0(x.n) + (x.unit || '')) + '</li>'; }).join('') + '</ul>'; };
    var body = '<div class="b2bkpi-flowgrid">' +
      '<div class="b2bkpi-card"><b>신규 협약</b><div class="b2bkpi-muted">첫 요청 · 90일 관찰</div>' + side(k1) + menuBtn('new', '신규 협약 보기') + '</div>' +
      '<div class="b2bkpi-card"><b>기존 고객</b><div class="b2bkpi-muted">재사용 관찰 · 반응 감소 후보</div>' + side(k3) +
        '<div class="b2bkpi-note">최근 90일 L2·L3 미관측 연결업체 후보 ' + n0(b.inactiveCandidate || 0) + '곳 · 이탈 확정이 아닙니다(원천 갱신·기록 누락·시즌 대기를 먼저 확인).</div>' + menuBtn('existing', '기존 고객 보기') + '</div>' +
      '</div><p class="b2bkpi-muted">공종 수요·다음 행동 필요 고객은 고객·업무 데이터를 연결한 뒤 표시합니다(미수집).</p>';
    return sec('⑤', '신규·기존 고객 흐름', '있는 데이터만 표시 · 없는 항목은 미수집 안내', body);
  }
  function aiSummary(){
    return sec('⑥', '주간 AI 운영 요약', '', '<div class="b2bkpi-card">' + pill('wait', '미연동') + ' <b>주간 리포트 가져오기 전</b>' +
      '<p class="b2bkpi-muted">연결되면 상승·하락의 근거(고객·시점)와 우선 행동 3개를 보여주고 담당 업무로 보냅니다. 수치·기한·중복은 코드로 계산하고 AI 추정을 고객 발언이나 성과로 저장하지 않습니다. 기존 월요일 08:30 예약은 바꾸지 않으며, AI 없이도 규칙 알람과 업무는 동작합니다.</p></div>');
  }
  function homeBlocks(model){ return actionProgress(model) + todayActions(model) + alerts(model) + customerFlow(model) + aiSummary(); }

  /* ---- 신규 협약 ---- */
  function newView(model){
    var k1 = row(model, 'MK1');
    var stages = '<div class="b2bkpi-stages">' + (D.newStages || []).map(function(s, i){
      return '<div class="b2bkpi-stage"><span class="b2bkpi-stage-no">' + (i + 1) + '</span><b>' + esc(s.label) + '</b><span class="b2bkpi-muted">' + esc(s.ids.join(' · ')) + '</span></div>';
    }).join('') + '</div>';
    var perf = k1 ? '<div class="b2bkpi-card"><div class="b2bkpi-kpi-name">KPI1 신규 협약 활용 · 90일 관찰 결과</div><div class="b2bkpi-kpi-val"><b>' + (k1.rate == null ? '—' : f1(k1.rate) + '%') + '</b></div>' +
      '<div class="b2bkpi-muted">' + esc(n0(k1.num) + '/' + n0(k1.den) + ' ' + (k1.unit || '') + ' · ' + cutoffShort(k1.cutoff) + ' 마감 확인분') + ' · 목표 ' + k1.target + '%</div>' +
      (k1.observing ? '<div class="b2bkpi-obs"><b>' + esc(k1.observing.label + ' ' + n0(k1.observing.n) + (k1.observing.unit || '')) + '</b>' + (k1.observing.note ? ' <span class="b2bkpi-muted">· ' + esc(k1.observing.note) + '</span>' : '') + '</div>' : '') +
      '<ul class="b2bkpi-flowlist">' + (k1.breakdown || []).filter(function(x){ return x.key !== 'observing'; }).map(function(x){ return '<li>' + esc(x.label + ' ' + n0(x.n) + (x.unit || '')) + '</li>'; }).join('') + '</ul></div>' : '';
    var meet = model && model.meeting ? '<div class="b2bkpi-card"><b>협약 직후 1·2차 미팅 관리(8/25 이후 신규 등록)</b><div class="b2bkpi-muted">카드에 기록된 미팅 처리 현황</div>' +
      '<button type="button" class="b2bkpi-btn" data-kpi-act="meetingList" data-stage="m1" data-group="new">1차 목록 보기</button> <button type="button" class="b2bkpi-btn" data-kpi-act="meetingList" data-stage="m2" data-group="new">2차 목록 보기</button></div>' : '';
    var list = tpls(function(t){ return t.kpi === 'MK1'; }).map(tplRow).join('');
    return sec('①', '신규 협약 관리', '협약 전 준비 → 체결 → 웰컴 → 첫 요청 → 90일 결과', stages) + perf + meet +
      '<p class="b2bkpi-muted">웰컴은 요청이 없어도 제공 대상입니다. D+7/14/30/60/90 점검은 설정 가능한 운영안이지 매번 전화하라는 뜻이 아닙니다. D+90 무요청은 사유 확인·후속 대상이며 자동 해지가 아닙니다. 고객 일정 대기는 다음 확인일을 두고 유지합니다.</p>' +
      sec('②', '신규 협약 행동 템플릿', '주연결 KPI1 · 업무 실체가 아님', list) +
      '<p class="b2bkpi-muted">고객별 단계·D+경과·미완료 행동 표시는 고객 데이터 연결 단계에서 붙입니다(미연결).</p>';
  }

  /* ---- 기존 고객 ---- */
  function existingView(model){
    var b = D.baseline || {}, k2 = row(model, 'MK3'), k3 = row(model, 'MK2');
    var base = '<div class="b2bkpi-card"><b>기준선 · ' + esc(cutoffShort(b.cutoff)) + ' 마감 확인분</b><ul class="b2bkpi-flowlist"><li>실제 MOU ' + n0(b.mouTotal) + '곳 · 연결 ' + n0(b.mouLinked) + '곳</li><li>유효 L2 ' + n0(b.validL2) + ' · 유효 L3 ' + n0(b.validL3) + '</li>' +
      '<li>최근 90일 L2·L3 미관측 연결업체 후보 ' + n0(b.inactiveCandidate) + '곳</li></ul><div class="b2bkpi-note">미관측 후보는 이탈 확정이 아닙니다. 원천 갱신 실패·기록 누락·시즌 대기와 구분해 먼저 확인합니다. 등급은 기존 CRM 근거가 있을 때만 쓰고, 없으면 미분류입니다.</div></div>';
    var kp = function(r, name){ return r ? '<div class="b2bkpi-card"><div class="b2bkpi-kpi-name">' + esc(name) + '</div><div class="b2bkpi-kpi-val"><b>' + (r.rate == null ? '—' : f1(r.rate) + '%') + '</b></div><div class="b2bkpi-muted">' + esc(n0(r.num) + '/' + n0(r.den) + ' ' + (r.unit || '') + ' · ' + cutoffShort(r.cutoff) + ' 마감 확인분') + '</div></div>' : ''; };
    var scripts = (D.scripts || []).filter(function(s){ return /^[④⑤⑥]/.test(s.no); }).map(function(s){ return '<div class="b2bkpi-card"><b>' + esc(s.no + ' ' + s.title) + '</b><div class="b2bkpi-muted">' + esc(s.when) + '</div><div>' + esc(s.record) + '</div></div>'; }).join('');
    var list = tpls(function(t){ return /^(R09|R10|HB01|HA01|HC01|HU01)$/.test(t.id) || (t.kpi === 'MK3' && /^R0[1-8]$/.test(t.id)); }).map(tplRow).join('');
    return sec('①', '기존 고객 활용 현황', '요청·단지·공종·구매 변화 · 막힘과 다음 행동', base + '<div class="b2bkpi-kpis">' + kp(k2, 'KPI2 문의별 L3 도달') + kp(k3, 'KPI3 다른 단지 재사용') + '</div>') +
      sec('②', '등급별 대응', 'A 확장 · B 한 장 교체 · C 재시작', '<div class="b2bkpi-flowgrid">' + scripts + '</div>') +
      sec('③', '기존 고객 행동 템플릿', '업무 실체가 아님', list) +
      '<p class="b2bkpi-muted">업체별 최근 28일/직전 28일 요청, 단지·공종·구매 변화 목록은 고객·거래 데이터를 연결한 뒤 표시합니다(미연결). 요청과 발행을 더해 수요를 부풀리지 않습니다.</p>';
  }

  /* ---- 상담·전화 ---- */
  function consultView(){
    var scripts = (D.scripts || []).map(function(s){
      return '<div class="b2bkpi-script"><div class="b2bkpi-script-h"><b>' + esc(s.no + ' ' + s.title) + '</b> <span class="b2bkpi-muted">' + esc(s.when) + '</span></div><blockquote>“' + esc(s.text) + '”</blockquote><div class="b2bkpi-muted">직원 처리 · ' + esc(s.record) + '</div></div>';
    }).join('');
    var c01 = tpls(function(t){ return t.id === 'C01'; }).map(tplRow).join('');
    return sec('①', '상담 전에 볼 것', '', '<p class="b2bkpi-muted">고객 이력·진행 현장·최근 연락·약속을 먼저 봅니다. 반복 전화보다 앱 사용 상태 버튼, 기존 문의 응답, 상담 중 한 질문을 우선합니다. 녹음·음성전사는 기본 꺼짐입니다.</p>') +
      sec('②', '상황별 짧은 대본', '초안 · 빈칸은 확인한 뒤 채움', scripts) +
      sec('③', '결과 버튼', '', '<div class="b2bkpi-chips">' + (D.resultButtons || []).map(function(x){ return '<span class="b2bkpi-chip">' + esc(x) + '</span>'; }).join('') + '</div>') +
      sec('④', '팀원이 남길 3가지', '고객·담당·시각·관련 KPI는 자동 채움', '<ol class="b2bkpi-flowlist"><li>고객이 말한 핵심</li><li>다음 행동</li><li>다음 확인일</li></ol>' + c01 + '<p class="b2bkpi-muted">한 번 저장하면 고객 타임라인·다음 업무·(실제 불편이 있으면) 고객 의견이 갱신되도록 연결할 예정입니다 — 저장 연결은 다음 단계(미연결).</p>') +
      sec('⑤', '금지 약속', '', '<ul class="b2bkpi-flowlist">' + (D.forbidden || []).map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>');
  }

  /* ---- 고객 의견·민원 ---- */
  function feedbackView(){
    var steps = '<ol class="b2bkpi-flowlist">' + (D.feedbackSteps || []).map(function(x){ return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';
    var list = tpls(function(t){ return /^V0[1-4]$/.test(t.id); }).map(tplRow).join('');
    return sec('①', '고객 의견·민원 처리 흐름', '접수 → 책임 부서 → 개선 → 회신 → 고객 확인·재열기', steps +
      '<p class="b2bkpi-muted">부서 완료와 고객 해결은 다릅니다. 무응답은 고객 확인 대기, 미해결이면 재열기합니다. 민원 조치의 KPI 연결은 지원 기여 관계이며, 만족을 KPI 성공으로 바꾸지 않습니다. 불만과 AI 추정은 구분해 저장합니다.</p>') +
      sec('②', '민원 행동 템플릿', '업무 실체가 아님', list) +
      '<p class="b2bkpi-muted">접수·회신 기록과 알람은 고객 의견 데이터를 연결한 뒤 표시합니다(미연결).</p>';
  }

  /* ---- 팀원 업무·알람 ---- */
  function tasksView(scoreHtml){
    var groups = ['MK1', 'MK3', 'MK2'].map(function(id){
      var list = tpls(function(t){ return t.kpi === id; });
      return '<details class="b2bkpi-flow" open><summary>' + esc(D.kpiNames[id]) + ' · 템플릿 ' + list.length + '개</summary>' + list.map(tplRow).join('') + '</details>';
    }).join('');
    var rules = '<ul class="b2bkpi-alerts">' + (D.alertRules || []).map(function(a){ return '<li class="is-' + a.level + '"><div class="b2bkpi-alert-h"><b>' + esc(a.sign) + '</b></div><div class="b2bkpi-muted">기준 · ' + esc(a.rule) + '</div><div>다음 행동 · ' + esc(a.next) + '</div></li>'; }).join('') + '</ul>';
    return sec('①', '업무 템플릿', '', '<p class="b2bkpi-muted">' + esc(D.note) + ' 업무마다 주연결 KPI 1개를 정하고 관련 KPI는 참고로만 봅니다. 전사 합계는 업무 하나를 한 번만 셉니다. 완료 체크는 고객 KPI 성과를 바꾸지 않습니다.</p>' + groups) +
      sec('②', '알람 기준', '초기 기준은 제안 · 파일럿 후 보정', rules) +
      '<div class="b2bkpi-scoreslot">' + (scoreHtml || '') + '</div>';
  }

  /* ---- KPI 상세 — 성과값과 목표 대비 달성률은 다른 이름으로, 아래에 행동 진척·병목·대상 목록 ---- */
  var CSV_FILE = { MK1: '신규_HTML36_90일.csv', MK3: '기회_30일.csv', MK2: '재사용_60일.csv' };
  var PAGE = 50;
  var FILTERS = [['all', '전체'], ['observing', '관찰 중'], ['hit', '기간 종료 · 성과 있음'], ['miss', '기간 종료 · 미관측'], ['excluded', '제외']];
  function filt(items, f){
    return items.filter(function(x){ return f === 'observing' ? x.phase === '관찰 중' : f === 'hit' ? x.phase === '기간 종료' && x.ok === true : f === 'miss' ? x.phase === '기간 종료' && x.ok === false : f === 'excluded' ? x.phase === '제외' : true; });
  }
  function targetRow(x){
    var cls = x.phase === '관찰 중' ? 'wait' : x.phase === '제외' ? 'wait' : x.ok ? 'ok' : 'warn';
    return '<div class="b2bkpi-trow is-' + (x.phase === '관찰 중' ? 'observing' : x.phase === '제외' ? 'excluded' : x.ok ? 'hit' : 'miss') + '"><div class="b2bkpi-trow-h"><b>' + esc(x.name || '(이름 없음)') + '</b> ' + pill('wait', x.phase) + ' ' + pill(cls, x.result) + '</div>' +
      (x.scope ? '<div class="b2bkpi-trow-b">' + esc(x.scope) + '</div>' : '') +
      '<div class="b2bkpi-trow-b">시작 ' + esc(x.start || '날짜 미확인') + ' · 마감 ' + esc(x.end || '날짜 미확인') + (x.detail ? ' · ' + esc(x.detail) : '') + '</div>' +
      '<div class="b2bkpi-muted">우리 행동 · 기록 수집 전 · 담당·다음 행동·다음 확인일 · 미등록</div></div>';
  }
  /* 화면 안의 진짜 파일 입력(label 안 input) — 눌러서 파일을 고르면 change 로 전달된다 */
  function fileBtn(kind, id, text){ return '<label class="b2bkpi-btn is-primary b2bkpi-filelab">' + esc(text) + '<input type="file" accept=".csv,text/csv" class="b2bkpi-fileinp" data-kpi-file="' + kind + '" data-kpi="' + id + '"></label>'; }
  function targetList(model, id, csv, r){
    var file = CSV_FILE[id], intro = '<p class="b2bkpi-muted">고객 이름이 들어 있는 근거 파일은 공개 저장소에 올리지 않습니다. 내려받아 둔 <b>' + esc(file) + '</b> 를 골라 주시면 이 화면에서만 읽어 목록을 만들고, 저장·전송하지 않습니다(다른 메뉴로 가거나 닫으면 사라집니다).</p>';
    if(!csv) return intro + fileBtn('csv', id, '근거 파일 고르기 · ' + file);
    if(csv.error) return intro + '<div class="b2bkpi-note">' + esc(csv.error) + '</div>' + fileBtn('csv', id, '다른 파일 고르기');
    var a = csv.analysis, f = csv.filter || 'all', list = filt(a.items, f), pages = Math.max(1, Math.ceil(list.length / PAGE)), pg = Math.min(Math.max(0, csv.page || 0), pages - 1);
    var same = r && r.num === a.num && r.den === a.den;
    var chk = '<div class="b2bkpi-' + (same ? 'obs' : 'note') + '">파일에서 센 값 ' + n0(a.num) + '/' + n0(a.den) + ' · 저장된 확인분 ' + (r && r.num != null ? n0(r.num) + '/' + n0(r.den) : '없음') + ' · ' + (same ? '일치합니다' : '다릅니다(파일 버전이 다르거나 저장값을 다시 확인해야 합니다)') +
      ' <span class="b2bkpi-muted">· 관찰 중 ' + n0(a.observing) + ' · 제외 ' + n0(a.excluded) + ' · 파일 ' + esc(csv.file) + '</span></div>';
    var chips = '<div class="b2bkpi-filters">' + FILTERS.map(function(x){ return '<button type="button" class="b2bkpi-filterbtn' + (f === x[0] ? ' is-on' : '') + '" data-kpi-act="csvFilter" data-kpi="' + id + '" data-f="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + esc(x[1]) + ' ' + n0(filt(a.items, x[0]).length) + '</button>'; }).join('') + '</div>';
    var rows = list.slice(pg * PAGE, pg * PAGE + PAGE).map(targetRow).join('') || '<p class="b2bkpi-muted">해당 항목이 없습니다</p>';
    var pager = list.length > PAGE ? '<div class="b2bkpi-pager"><button type="button" class="b2bkpi-btn" data-kpi-act="csvPage" data-kpi="' + id + '" data-n="-1"' + (pg === 0 ? ' disabled' : '') + '>이전</button><span class="b2bkpi-muted">' + n0(list.length) + '건 중 ' + (pg * PAGE + 1) + '–' + Math.min(list.length, pg * PAGE + PAGE) + '</span><button type="button" class="b2bkpi-btn" data-kpi-act="csvPage" data-kpi="' + id + '" data-n="1"' + (pg >= pages - 1 ? ' disabled' : '') + '>다음</button></div>' : '';
    return chk + chips + pager + '<div class="b2bkpi-tlist">' + rows + '</div>' + pager +
      '<button type="button" class="b2bkpi-btn" data-kpi-act="csvClear" data-kpi="' + id + '">파일 내용 지우기</button>';
  }
  /* 이어 쌓기 — 시작점(기준선) 위에 마감 이후 새로 성숙한 건을 같은 정의로 더한 값. 행동(선행)은 이 숫자에 섞지 않는다. */
  var LEDGER_NOTE = '기준 원장 한정정규원장.csv 를 골라 주세요. 단지명이 들어 있어 공개 저장소에는 올리지 않으며, 이 화면에서만 읽고 저장·전송하지 않습니다(다른 메뉴로 가거나 닫으면 사라집니다).';
  function chainSection(model, id, r, chain){
    var pick = fileBtn('ledger', id, '기준 원장 고르기 · 한정정규원장.csv');
    var intro = '<p class="b2bkpi-muted">' + LEDGER_NOTE + '</p>';
    if(chain && chain.error) return intro + '<div class="b2bkpi-note">' + esc(chain.error) + '</div>' + pick;
    if(chain && chain.need === 'cohort') return '<div class="b2bkpi-note">신규 협약 활용은 신규 명단이 필요합니다. 아래 대상 목록에서 신규_HTML36_90일.csv 를 먼저 골라 주세요.</div>' + fileBtn('csv', id, '근거 파일 고르기 · 신규_HTML36_90일.csv');
    if(!chain || !chain.report) return intro + pick;
    var p = chain.report, u = (r && r.unit) || '', f = function(x){ return x.rate == null ? '—' : f1(x.rate) + '%'; };
    var head = '<div class="b2bkpi-' + (p.check ? 'obs' : 'note') + '">마감 시점(' + esc(cutoffShort(p.cutoff)) + ')을 기준 원장으로 다시 계산한 값 ' + n0(p.start.num) + '/' + n0(p.start.den) + ' · 저장된 확인분 ' + (r && r.num != null ? n0(r.num) + '/' + n0(r.den) : '없음') + ' · ' + (p.check ? '일치합니다' : '기준선과 다릅니다 — 원장 파일 버전을 확인하세요. 누적 값을 쓰지 않습니다') + '</div>';
    var body = '';
    if(p.check){
      body = '<div class="b2bkpi-flowgrid">' +
        '<div class="b2bkpi-card"><div class="b2bkpi-muted">시작점 · ' + esc(cutoffShort(p.cutoff)) + ' 마감 확인분</div><div class="b2bkpi-kpi-val"><b>' + f(p.start) + '</b></div><div class="b2bkpi-muted">' + esc(n0(p.start.num) + '/' + n0(p.start.den) + ' ' + u) + '</div></div>' +
        '<div class="b2bkpi-card"><div class="b2bkpi-muted">이후 새로 성숙한 건</div><div class="b2bkpi-kpi-val"><b>+' + n0(p.added.num) + '/+' + n0(p.added.den) + '</b></div><div class="b2bkpi-muted">' + esc(cutoffShort(p.cutoff) + ' 다음 날 ~ ' + cutoffShort(p.asOf) + ' 사이 관찰이 끝난 건') + '</div></div>' +
        '<div class="b2bkpi-card b2bkpi-total"><div class="b2bkpi-muted">누적 · ' + esc(cutoffShort(p.asOf)) + ' 기준</div><div class="b2bkpi-kpi-val"><b>' + f(p.now) + '</b></div><div class="b2bkpi-muted">' + esc(n0(p.now.num) + '/' + n0(p.now.den) + ' ' + u) + '</div></div></div>';
    }
    return head + body + '<p class="b2bkpi-muted">관찰 중 ' + n0(p.observing) + esc(u) + '은 분모·분자에 넣지 않았습니다(마감 시점 ' + n0(p.observingAtCutoff) + '). 사건 = 기준 원장 ' + n0(p.ledgerEvents) + '건(마감까지) + 카드 기록 ' + n0(p.cardEvents) + '건(마감 이후). 행동(선행)이 올라도 이 숫자는 고객의 실제 요청이 확인되는 후행 결과로만 오릅니다. 과거 값과는 비교하지 않습니다.</p>' +
      '<button type="button" class="b2bkpi-btn" data-kpi-act="ledgerClear" data-kpi="' + id + '">원장 내용 지우기</button>';
  }
  function kpiDetail(model, id, csv, chain){
    var r = row(model, id); if(!r) return '<p class="b2bkpi-muted">KPI 정보를 찾지 못했습니다</p>' + menuBtn('home', '홈으로');
    var back = '<button type="button" class="b2bkpi-btn" data-kpi-act="kpiBack">← 홈으로</button>';
    var d = r.def || {};
    var perf = '<div class="b2bkpi-card b2bkpi-kpi is-' + esc(String(r.label || '').toLowerCase()) + '"><div class="b2bkpi-kpi-name">' + esc(r.label + ' ' + r.name) + '</div>' +
      '<div class="b2bkpi-muted">관측률 · ' + (r.source === 'official' ? esc(cutoffShort(r.cutoff)) + ' 마감 확인분' : '자동 계산값') + '</div>' +
      '<div class="b2bkpi-kpi-val"><b>' + (r.rate == null ? '—' : f1(r.rate) + '%') + '</b></div>' +
      (r.num != null && r.den != null ? '<div class="b2bkpi-muted">' + esc(n0(r.num) + '/' + n0(r.den) + ' ' + (r.unit || '')) + '</div>' : '') +
      '<div class="b2bkpi-goal">' + esc(r.floor ? '목표 도전 ' + r.target + '% · 하한 ' + r.floor + '%' : '목표 ' + r.target + '%') + '</div>' +
      '<div class="b2bkpi-muted">목표 대비 달성률 ' + (r.ach == null ? '—' : f1(r.ach) + '%') + (r.floor && r.achFloor != null ? ' (도전 기준) · 하한 대비 ' + f1(r.achFloor) + '%' : '') + '</div>' +
      (r.floor ? '<div class="b2bkpi-ref-basis">' + pill('wait', '미확정') + ' <b>종합점수 적용 기준: 미확정</b> <span class="b2bkpi-muted">· 팀장님 확인 대기</span></div>' : '') +
      '<p class="b2bkpi-muted">전체 공식 최신 실적이 아니며 일부 확인분입니다. 과거 값과는 정의·범위가 달라 직접 증감 비교하지 않습니다.</p></div>' +
      '<div class="b2bkpi-card"><b>무엇을 세나요</b><ul class="b2bkpi-flowlist">' + [['관찰기간', d.period], ['분자', d.num], ['분모', d.den], ['범위', d.scope], ['참고', d.note]].filter(function(x){ return x[1]; }).map(function(x){ return '<li><b>' + x[0] + '</b> · ' + esc(x[1]) + '</li>'; }).join('') + '</ul></div>';
    var br = '';
    if(r.observing) br += '<div class="b2bkpi-obs"><b>' + esc(r.observing.label + ' ' + n0(r.observing.n) + (r.observing.unit || '')) + '</b>' + (r.observing.note ? ' <span class="b2bkpi-muted">· ' + esc(r.observing.note) + '</span>' : '') + '</div>';
    var rest = (r.breakdown || []).filter(function(x){ return x.key !== 'observing'; });
    br += rest.length ? '<div class="b2bkpi-card"><ul class="b2bkpi-flowlist">' + rest.map(function(x){ return '<li>' + esc(x.label + ' ' + n0(x.n) + (x.unit || '')) + '</li>'; }).join('') + '</ul></div>' : (r.observing ? '' : '<p class="b2bkpi-muted">저장된 집계 내역이 없습니다</p>');
    var tp = tpls(function(t){ return t.kpi === id; });
    var act = '<div class="b2bkpi-card"><div class="b2bkpi-act-row"><span class="b2bkpi-muted">우리 행동 이행률</span>' + pill('wait', '행동 기록 수집 전') + '</div><div class="b2bkpi-muted">확정 업무 0건 · 행동 템플릿 ' + tp.length + '개(주연결). 행동이 100%여도 고객 성과가 없으면 "행동 완료 · 성과 미관측"으로 따로 표시하며, 미달을 팀원 과실로 단정하지 않습니다.</div>' +
      '<details class="b2bkpi-flow"><summary>행동 템플릿 보기</summary>' + tp.map(tplRow).join('') + '</details></div>';
    var bn = '<ul class="b2bkpi-alerts">';
    var miss = id === 'MK1' ? missedRows(model) : [];
    if(miss.length) bn += '<li class="is-danger"><div class="b2bkpi-alert-h">' + pill('warn', '위험') + ' <b>미팅 미처리 누락 ' + miss.length + '곳</b></div><div class="b2bkpi-muted">신규 첫 요청 전에 우리 쪽 미팅이 기한을 넘김 · 우리 지원 지연</div><div>다음 행동 · <button type="button" class="b2bkpi-btn" data-kpi-act="meetingList" data-stage="m1" data-group="all">1차 목록</button> <button type="button" class="b2bkpi-btn" data-kpi-act="meetingList" data-stage="m2" data-group="all">2차 목록</button></div></li>';
    if(r.floorState === 'below') bn += '<li class="is-warn"><div class="b2bkpi-alert-h">' + pill('wait', '주의') + ' <b>하한 85% 미달</b></div><div class="b2bkpi-muted">' + esc(cutoffShort(r.cutoff)) + ' 마감 확인분 ' + f1(r.rate) + '% · 고객 성과 지표</div><div>다음 행동 · 대상 목록에서 막힌 이유 확인(원인 단정 금지)</div></li>';
    bn += '<li class="is-info"><div class="b2bkpi-alert-h">' + pill('auto', '안내') + ' <b>막힌 이유 분류</b></div><div class="b2bkpi-muted">' + esc((D.blockCodes || []).join(' · ')) + ' — 상담·업무 기록이 쌓이면 고객별로 표시합니다. 고객 일정 대기와 우리 지원 지연은 서로 다른 이유로 나눕니다.</div></li></ul>';
    return '<div class="b2bkpi-detailtop">' + back + '</div>' +
      sec('①', '성과값과 목표 대비 달성률', '확인분 기준선', perf) + sec('②', '이어 쌓기', '시작점 위에 같은 정의로 쌓은 값', chainSection(model, id, r, chain)) +
      sec('③', '집계 내역', '관찰 중은 분모에 넣지 않음', br) +
      sec('④', '우리 행동 진척', '행동과 고객 성과는 섞지 않음', act) + sec('⑤', '병목', '사유와 다음 행동', bn) +
      sec('⑥', '대상 목록', '고객 · 단지·공종 · 시작·마감 · 관찰 상태 · 성과 판정', targetList(model, id, csv, r));
  }

  function view(id, model, scoreHtml){
    if(id === 'new') return newView(model);
    if(id === 'existing') return existingView(model);
    if(id === 'consult') return consultView();
    if(id === 'feedback') return feedbackView();
    if(id === 'tasks') return tasksView(scoreHtml);
    return homeBlocks(model);
  }

  var api = { kpiDetail: kpiDetail, menuBar: menuBar, homeBlocks: homeBlocks, newView: newView, existingView: existingView, consultView: consultView, feedbackView: feedbackView, tasksView: tasksView, view: view };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiOs = api;
})();
