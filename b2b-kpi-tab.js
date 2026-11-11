/* §B2B KPI 탭(2026-11) — 관리자 전용. 업무트래커(shared/b2bOpsTracker)의 담당자·지표 기록을 함께 읽고 쓴다.
   화면: 상단 6메뉴(홈·신규 협약·기존 고객·상담·전화·고객 의견·민원·팀원 업무·알람). 홈 = 3대 KPI 카드가 가장 먼저 → 행동 진척 → 오늘 행동 → 알람·병목 → 고객 흐름 → AI 요약. 업무 관리 점수(종합·팀·팀원·흐름)는 팀원 업무·알람 메뉴. 메뉴 화면은 b2b-kpi-os.js.
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
  /* 막대 = 현재 관측 비율(0~100%), 세로선 = 목표(KPI3 은 하한 선도 함께) — 팀원 안내서와 같은 읽는 법 */
  function bar(r){
    var w = r.rate == null ? 0 : Math.min(100, r.rate);
    return '<div class="b2bkpi-bar" aria-hidden="true"><i class="is-cur" style="width:' + w + '%"></i>' +
      (r.floor ? '<b class="tick" style="left:' + r.floor + '%" title="하한 ' + r.floor + '%"></b>' : '') +
      '<b class="tick is-goal" style="left:' + r.target + '%" title="목표 ' + r.target + '%"></b></div>';
  }
  function goalText(r){ return r.floor ? '목표 ' + r.target + '% 도전 · ' + r.floor + '% 하한' : '목표 ' + r.target + '%'; }
  function defBlock(r){
    var d = r.def; if(!d) return '';
    return '<details class="b2bkpi-def"><summary>무엇을 세나요 · 관찰기간</summary><div class="b2bkpi-def-b">' +
      '<p><b>관찰기간</b> ' + esc(d.period) + '</p><p><b>분자</b> ' + esc(d.num) + '</p><p><b>분모</b> ' + esc(d.den) + '</p>' +
      '<p class="b2bkpi-muted">' + esc(d.note) + '</p><p class="b2bkpi-muted"><b>범위</b> ' + esc(d.scope) + '</p></div></details>';
  }
  /* 관찰 중(분모 밖) 건수는 접지 않고 바로, 나머지 집계 내역은 펼치기 안에 — 설계: 진행 중 조기 요청은 보이되 관찰 완료분과 합치지 않는다 */
  function obsLine(r){
    var o = r.observing; if(!o) return '';
    return '<div class="b2bkpi-obs"><b>' + esc(o.label + ' ' + o.n.toLocaleString('ko-KR') + (o.unit || '')) + '</b>' + (o.note ? ' <span class="b2bkpi-muted">· ' + esc(o.note) + '</span>' : '') + '</div>';
  }
  function breakdownBlock(r){
    var rest = (r.breakdown || []).filter(function(x){ return x.key !== 'observing'; }); if(!rest.length) return '';
    return '<details class="b2bkpi-def"><summary>집계 내역</summary><div class="b2bkpi-def-b">' + rest.map(function(x){
      return '<p>' + esc(x.label + ' ' + x.n.toLocaleString('ko-KR') + (x.unit || '')) + (x.note ? ' <span class="b2bkpi-muted">· ' + esc(x.note) + '</span>' : '') + '</p>';
    }).join('') + '<p class="b2bkpi-muted">업체명 없는 숫자만 저장합니다. 마감일 기준 확인분입니다.</p></div></details>';
  }
  function floorLines(r){
    if(r.floor == null || r.achFloor == null) return '';
    var gap = r.floorState === 'below' ? '하한 ' + r.floor + '%까지 ' + f1(Math.abs(r.floorGap)) + '%p 부족' : r.floorState === 'between' ? '하한 충족 · 도전까지 ' + f1(Math.abs(r.targetGap)) + '%p' : '도전 목표 달성';
    return '<div class="b2bkpi-floor"><span>도전 ' + r.target + '% 대비 ' + pct(r.ach) + '</span><span>하한 ' + r.floor + '% 대비 ' + pct(r.achFloor) + '</span><b>' + esc(gap) + '</b></div>';
  }
  function cutoffShort(c){ var m = /^\d{4}-(\d{1,2})-(\d{1,2})/.exec(c || ''); return m ? (+m[1]) + '/' + (+m[2]) : '확인분'; }
  function kpiCard(r, withDetail){
    var p = r.floorState ? (r.floorState === 'below' ? pill('warn', '하한 미달') : r.floorState === 'between' ? pill('wait', '하한 충족 · 도전 미달') : pill('ok', '도전 달성'))
      : r.ach == null ? pill('wait', '실적 대기') : r.ach >= 100 ? pill('ok', '순조') : pill('warn', '뒤처짐');
    return '<div class="b2bkpi-card b2bkpi-kpi is-' + esc(String(r.label || '').toLowerCase()) + '"><div class="b2bkpi-kpi-tag">' + pill('kpi', r.label) + (r.auto ? pill('auto', '자동') : '') + '</div><div class="b2bkpi-kpi-name">' + esc(r.name) + '</div>' +
      '<div class="b2bkpi-kpi-val"><b>' + (r.rate == null ? '—' : f1(r.rate) + '%') + '</b></div>' +
      (r.num != null && r.den != null ? '<div class="b2bkpi-muted">' + (r.source === 'official' ? esc(r.num.toLocaleString('ko-KR') + '/' + r.den.toLocaleString('ko-KR') + ' ' + (r.unit || '') + ' · ' + cutoffShort(r.cutoff) + ' 마감 확인분') : r.num + ' / ' + r.den) + '</div>' : '') +
      '<div class="b2bkpi-goal">' + esc(goalText(r)) + '</div>' + bar(r) + (r.floor ? floorLines(r) : '') + '<div class="b2bkpi-kpi-foot"><span class="b2bkpi-muted">' + (r.floor ? '도전 목표 대비 달성 ' : '목표 대비 달성 ') + pct(r.ach) + '</span>' + p + '</div>' +
      '<div class="b2bkpi-kpi-desc">' + esc(r.desc || '') + '</div>' + obsLine(r) + defBlock(r) + breakdownBlock(r) +
      (r.source === 'official' && r.autoRate != null ? '<div class="b2bkpi-muted b2bkpi-autoref">다른 정의의 자동값 참고 ' + f1(r.autoRate) + '% (' + r.autoNum + '/' + r.autoDen + ') · 위 정의와 달라 비교하지 않습니다</div>' : '') +
      (withDetail ? '<div class="b2bkpi-kpi-more"><button type="button" class="b2bkpi-btn" data-kpi-act="kpiDetail" data-kpi="' + esc(r.id) + '">상세 보기</button></div>' : '') + '</div>';
  }
  /* §1·2차 미팅 누락 방지 실측(고객관리카드 도입 2026-08-21 이후) — 숫자를 누르면 업체 목록 */
  var MEETING_DEF = 'LI01';
  var MEET_CLS = { ontime: '기한 내 완료', late: '기한 초과 후 처리(현재 처리 완료)', missed: '미처리 누락', unknown: '판정 불가', upcoming: '기한 전' };
  function meetingLabel(s){ if(!s || !s.due) return '대상 없음'; if(!s.judged) return '미측정'; return '관리 완료 ' + s.ontime + '/' + s.judged + '곳 · ' + (Math.round(s.rate * 10) / 10) + '%'; }
  function meetingExtra(s){ if(!s) return ''; var a = []; if(s.late) a.push('기한 초과 처리 ' + s.late); a.push('누락 ' + s.missed); if(s.unknown) a.push('판정 불가 ' + s.unknown); if(s.upcoming) a.push('기한 전 ' + s.upcoming); return a.join(' · '); }
  function meetingBtn(meeting, stage, group, title){
    var s = meeting.summary[group][stage];
    return '<button type="button" class="b2bkpi-num" data-kpi-act="meetingList" data-stage="' + stage + '" data-group="' + group + '"><b>' + esc(title) + '</b> <span class="b2bkpi-num-val">' + esc(meetingLabel(s)) + '</span>' + (s && s.due ? ' <span class="b2bkpi-muted">' + esc(meetingExtra(s)) + '</span>' : '') + '</button>';
  }
  function meetingBlock(meeting){
    return '<div class="b2bkpi-nums"><div class="b2bkpi-muted">카드 도입 ' + esc(meeting.rule.start) + ' 이후 기한이 돌아온 건 · 누락 방지율 = 기한 내 완료 ÷ 판정 가능 대상</div>' +
      meetingBtn(meeting, 'm1', 'all', '1차 미팅 관리') + meetingBtn(meeting, 'm2', 'all', '2차 미팅 관리') +
      '<div class="b2bkpi-num-new"><span class="b2bkpi-muted">8/25 이후 신규 등록 업체만</span>' + meetingBtn(meeting, 'm1', 'new', '1차') + meetingBtn(meeting, 'm2', 'new', '2차') + '</div></div>';
  }
  function meetingListHtml(meeting, stage, group){
    var ord = { missed: 0, late: 1, unknown: 2, ontime: 3, upcoming: 4 };
    var rows = (meeting.rows || []).filter(function(r){ return r.stage === stage && (group === 'all' || r.group === group) && (r.inScope || r.cls === 'upcoming'); })
      .sort(function(a, b){ return (ord[a.cls] - ord[b.cls]) || (a.due < b.due ? -1 : a.due > b.due ? 1 : 0); });
    var s = meeting.summary[group][stage];
    return '<h3>' + (stage === 'm1' ? '1차' : '2차') + ' 미팅 관리' + (group === 'new' ? ' · 8/25 이후 신규 등록' : '') + '</h3>' +
      '<p class="b2bkpi-muted">' + esc(meetingLabel(s)) + (s && s.due ? ' · ' + esc(meetingExtra(s)) : '') + '. 기한 = 예정일 + ' + meeting.rule.grace + '일(예정일 없으면 앞 단계 완료 + ' + meeting.rule.reg + '일). 기준일 ' + esc(meeting.rule.now) + '. 원본 기록은 바꾸지 않습니다.</p>' +
      (rows.length ? '<div class="b2bkpi-mlist">' + rows.map(function(r){
        return '<div class="b2bkpi-mrow is-' + r.cls + '"><div class="b2bkpi-mrow-h"><b>' + esc(r.name) + '</b>' + (r.code ? ' <span class="b2bkpi-muted">' + esc(r.code) + '</span>' : '') + ' <span class="b2bkpi-pill is-' + (r.cls === 'ontime' ? 'ok' : r.cls === 'missed' ? 'warn' : 'wait') + '">' + esc(MEET_CLS[r.cls]) + '</span></div>' +
          '<div class="b2bkpi-mrow-b">' + esc(r.stageName) + ' · ' + (r.group === 'new' ? '신규 등록 ' + esc(r.regDate) : '8/25 일괄 등록') + ' · 기한 ' + esc(r.due || '—') + ' · 실제 처리일 ' + esc(r.doneAt || '—') + ' · ' + (r.owner ? '담당 ' + esc(r.owner) : '담당 기록 없음') + '</div>' +
          '<div class="b2bkpi-mrow-why">' + esc(r.why) + '</div></div>';
      }).join('') + '</div>' : '<p>대상 없음</p>') +
      (s && s.unplaced ? '<p class="b2bkpi-muted">기한 날짜가 없어 기간에 넣을 수 없는 기록 ' + s.unplaced + '건(대부분 협약 체결로 완료 간주된 도입 전 업체)은 비율에서 뺐습니다.</p>' : '');
  }
  function personCard(model, row, ui){
    var p = model.persons[row.memberId] || { state: 'nodefs', rows: [], total: 0, measured: 0 }, lags = (model.lags || {})[row.memberId] || [];
    var score = p.state === 'ok' ? '<b class="b2bkpi-big2">' + f1(p.value) + '점</b>' : p.state === 'nodefs' ? pill('wait', '지표 미등록') : pill('wait', '산출 대기');
    var out = '<div class="b2bkpi-card b2bkpi-person"><div class="b2bkpi-person-head"><div><b class="b2bkpi-person-name">' + esc(row.name) + '</b>' +
      '<div class="b2bkpi-muted">개인 몫 ' + f1(row.share).replace(/\.0$/, '') + '%' + (row.temporary ? ' (임시 비중)' : '') + '</div></div>' +
      '<div class="b2bkpi-person-score">' + score + (p.total ? '<div class="b2bkpi-muted">' + p.measured + '/' + p.total + '개 측정</div>' : '') + '</div></div>';
    if(model.compareNotes && model.compareNotes[row.memberId]) out += '<div class="b2bkpi-note">측정 항목이 달라 지난달 점수와 단순 비교할 수 없습니다</div>';
    if(p.state === 'nodefs') out += '<p class="b2bkpi-muted">선행·후행 지표가 등록되면 같은 방식으로 계산합니다. 이 사람의 몫은 다른 팀원에게 넘기지 않습니다.</p>';
    var leadLine = function(r){
      var open = ui.openDef === r.id;
      var val = r.state === 'ok' ? f1(r.rate) + '%' : r.state === 'empty' ? '대상 없음' : '미측정';
      var line = '<div class="b2bkpi-lead' + (r.state === 'ok' ? '' : ' is-none') + '"><div class="b2bkpi-lead-main"><span class="b2bkpi-lead-name">' + esc(numPre(r.no) + r.name) + '</span>' + (r.numeric ? pill('auto', '카드 실측') : r.auto ? pill('auto', '자동') : '') +
        '<span class="b2bkpi-lead-val">' + val + (r.target ? ' <span class="b2bkpi-muted">/ 목표 ' + r.target + '</span>' : '') + '</span></div>' +
        '<div class="b2bkpi-lead-sub"><button type="button" class="b2bkpi-linkbtn" data-kpi-act="toggleDef" data-def="' + esc(r.id) + '">세부업무 완료 ' + r.tasks.done + ' · 진행 ' + r.tasks.doing + ' · 남음 ' + r.tasks.todo + (open ? ' · 접기' : ' · 펼치기') + '</button>' +
        '<a class="b2bkpi-linkbtn" href="' + TRACKER_URL + '" target="_blank" rel="noopener">트래커에서 입력</a></div>' +
        (r.cum && r.cum.den > 0 && r.cum.months > 1 ? '<div class="b2bkpi-cum">카드 구축 이후 누적 ' + r.cum.num + '/' + r.cum.den + ' (' + f1(r.cum.num / r.cum.den * 100) + '%) · ' + r.cum.months + '개월</div>' : '');
      if(r.id === MEETING_DEF && model.meeting) line += meetingBlock(model.meeting);
      else if(r.id === MEETING_DEF && model.meetingError) line += '<div class="b2bkpi-num-err">1·2차 미팅 실측: 미측정 (' + esc(model.meetingError) + ')</div>';
      if(open) line += '<div class="b2bkpi-tasks" data-def-tasks="' + esc(r.id) + '"></div>';
      return line + '</div>';
    };
    var okRows = (p.rows || []).filter(function(r){ return r.state === 'ok'; }), waitRows = (p.rows || []).filter(function(r){ return r.state !== 'ok'; });
    if(okRows.length) out += '<div class="b2bkpi-grp is-ok"><div class="b2bkpi-grp-h">측정된 항목 (' + okRows.length + '개) <span class="b2bkpi-muted">· 점수에 반영</span></div>' + okRows.map(leadLine).join('') + '</div>';
    if(waitRows.length) out += '<div class="b2bkpi-grp is-wait"><div class="b2bkpi-grp-h">대기 항목 (' + waitRows.length + '개) <span class="b2bkpi-muted">· 점수에 넣지 않음(0점 아님)</span></div>' + waitRows.map(leadLine).join('') + '</div>';
    if(lags.length) out += '<div class="b2bkpi-lags"><div class="b2bkpi-muted">후행지표 · 관리 후 고객 변화(점수에 넣지 않음)</div>' + lags.map(function(g){
      return '<div class="b2bkpi-lag"><span>' + esc(numPre(g.no) + g.name) + '</span><span>' + (g.rate == null ? '미측정' : f1(g.rate) + '%') + (g.target != null ? ' <span class="b2bkpi-muted">/ 목표 ' + g.target + '</span>' : '') + '</span></div>';
    }).join('') + '</div>';
    return out + '<div class="b2bkpi-person-foot"><button type="button" class="b2bkpi-btn" data-kpi-act="edit" data-member="' + esc(row.memberId) + '">지표 등록·수정</button></div></div>';
  }
  /* 참고 영역 — 확인분 3개의 목표 대비 평균. 공식 점수가 아니며 종합점수에 들어가지 않는다. 재사용 95%·85% 중 종합 적용 기준은 팀장님 확인 전까지 미확정 */
  function referenceArea(a){
    if(a.value == null) return '';
    return '<div class="b2bkpi-card b2bkpi-ref"><div class="b2bkpi-ref-h"><b>참고 · 확인분 3개 평균</b>' + pill('wait', '공식 점수 아님') + '</div>' +
      '<div class="b2bkpi-ref-row"><span>도전 95% 기준 ' + f1(a.value) + '%</span><span>하한 85% 기준 ' + f1(a.valueFloor) + '%</span></div>' +
      '<div class="b2bkpi-muted">KPI ' + a.total + '개 중 ' + a.measured + '개의 확인분을 목표 대비로 평균한 값이며 종합점수에 넣지 않습니다. 평균은 공식 점수가 아닙니다.</div>' +
      '<div class="b2bkpi-ref-basis">' + pill('wait', '미확정') + ' <b>종합점수 적용 기준: 미확정</b> <span class="b2bkpi-muted">· 재사용률에 도전 95%·하한 85% 중 어느 쪽을 쓸지 팀장님 확인 대기</span></div></div>';
  }
  /* 화면을 'KPI 카드 영역(kpi)'과 '업무 관리 점수 영역(score)'으로 나눠 만든다. N 은 번호표. */
  function renderParts(model, ui, N){
    N = N || ['①', '②', '③', '④', '⑤', '⑥'];
    var c = model.composite, a = model.actual, t = model.team;
    var teamP = c.parts.filter(function(p){ return p.key === 'team'; })[0];
    var persP = c.parts.filter(function(p){ return p.key.indexOf('p:') === 0; }), persOk = persP.filter(function(p){ return p.state === 'ok'; });
    var persPts = persOk.reduce(function(s, p){ return s + p.points; }, 0);
    var out = '';
    // ① 3대 KPI — 화면 맨 위(카드·마감 확인분 안내·참고 영역)
    out += sec(N[0], '3대 KPI', a.cutoff ? esc(cutoffShort(a.cutoff)) + ' 마감 확인분' : '', '<div class="b2bkpi-kpis">' + a.rows.map(function(r){ return kpiCard(r, !!osOf(ui)); }).join('') + '</div>' +
      (a.cutoff ? '<p class="b2bkpi-muted b2bkpi-cutoff"><b>위 3개 값은 ' + esc(cutoffShort(a.cutoff)) + ' 마감 확인분이며 11월 최신 실적이 아닙니다.</b> 전체 공식 최신 실적이 아니고, 분모·연결 기준이 달라 다른 숫자와 직접 증감 비교하지 않습니다. 막대는 관측 비율, 세로선은 목표입니다.</p>' : '') +
      referenceArea(a));
    var kpiHtml = out; out = '';
    // ② 종합 KPI
    out += sec(N[1], '종합 KPI', '', '<div class="b2bkpi-big">' +
      '<div class="b2bkpi-card b2bkpi-total"><div class="b2bkpi-muted">종합점수 (반영된 부분)</div><div class="b2bkpi-num">' + (c.reflected > 0 ? f1(c.points) + '점' : '— 점') + '</div>' +
        '<div class="b2bkpi-wline">' + weightLine(c) + '</div><div class="b2bkpi-muted">실적 60 + 팀 공동 20 + 개인 20 · 100점 환산 안 함</div>' +
        '<div class="b2bkpi-basis">공식 실적 60%는 산출 대기라 0점으로 넣지 않았고, 나머지 점수를 100점으로 바꾸지도 않았습니다.</div></div>' +
      '<div class="b2bkpi-card"><div class="b2bkpi-muted">공식 실적 (60%)</div><div class="b2bkpi-num b2bkpi-waitnum">공식 실적 산출 대기</div>' +
        '<div class="b2bkpi-muted">마감 확인분은 맨 위 KPI 카드와 참고 영역에만 표시합니다</div></div>' +
      '<div class="b2bkpi-card"><div class="b2bkpi-muted">업무 관리점수 (40%)</div><div class="b2bkpi-num">' + (teamP.state === 'ok' || persOk.length ? f1((teamP.points || 0) + persPts) + '점' : '산출 대기') + '</div>' +
        '<div class="b2bkpi-muted">팀 공동 ' + (teamP.state === 'ok' ? f1(teamP.points) + '점 / 20' : '산출 대기') + ' · 개인 ' + (persOk.length ? f1(persPts) + '점 / 20' : '산출 대기') + '</div></div>' +
'</div>');
    // ② 뒤처진 부분
    out += sec(N[2], '뒤처진 부분', '', model.laggards.length ? '<ul class="b2bkpi-lag-list">' + model.laggards.map(function(x){
      return '<li>' + pill(x.kind === 'kpi' ? 'warn' : x.kind === 'lead' ? 'warn' : 'wait', x.kind === 'kpi' ? 'KPI' : x.kind === 'lead' ? '업무' : '미측정') + ' <b>' + esc(x.label) + '</b> <span class="b2bkpi-muted">' + esc(x.detail) + '</span></li>';
    }).join('') + '</ul>' : '<p class="b2bkpi-muted">지금 뒤처진 항목이 없습니다</p>');
    // ③ 팀 진척
    out += sec(N[3], '팀 진척', '팀 공동 업무 (20%) · KPI별 관리 업무 체크', '<div class="b2bkpi-card"><div class="b2bkpi-team-head"><b>팀 공동 업무</b>' +
(t.state === 'ok' ? '<span><b class="b2bkpi-big2">' + f1(t.value) + '%</b> <span class="b2bkpi-muted">' + t.checked + '/' + t.total + '개 체크</span></span>' : pill('wait', '산출 대기 · 이번 달 체크 기록 없음')) + '</div>' +
      '<div class="b2bkpi-muted b2bkpi-team-sum">측정 ' + t.checked + '개 · 대기 ' + (t.total - t.checked) + '개 <span>(체크한 업무만 측정, 아직 체크하지 않은 업무는 대기)</span></div>' +
      '<div class="b2bkpi-team-grid">' + t.byKpi.map(function(k){
        var kc = k.items.filter(function(x){ return x.checked; }).length;
        return '<div><div class="b2bkpi-team-kpi">' + esc((k.no ? k.no + ' ' : '') + k.name) + ' <span class="b2bkpi-muted">체크 ' + kc + '개 · 대기 ' + (k.items.length - kc) + '개</span></div>' + k.items.map(function(it){
          return '<button type="button" class="b2bkpi-check' + (it.checked ? ' is-on' : '') + '" data-kpi-act="team" data-k="' + k.id + '" data-i="' + it.i + '" aria-pressed="' + it.checked + '"><span class="box">' + (it.checked ? '✓' : '') + '</span>' + esc(it.text) + '</button>';
        }).join('') + '</div>';
      }).join('') + '</div><div class="b2bkpi-muted">팀 후행지표는 관리 후 고객 변화로, 점수에 넣지 않습니다.</div></div>');
    // ④ 팀원 진척
    var un = model.shares.rows.filter(function(r){ return !r.hasDefs; });
    out += sec(N[4], '팀원 진척', '개인 업무 20% 안에서 나눔', '<div class="b2bkpi-people">' + model.shares.rows.map(function(r){ return personCard(model, r, ui); }).join('') +
      '<button type="button" class="b2bkpi-card b2bkpi-add" data-kpi-act="add">+ 개인 트래커 추가</button></div>' +
      (model.shares.needsRebalance ? '<div class="b2bkpi-note">새로 들어온 사람의 몫이 정해지지 않았습니다(남은 몫만 임시로 나눔). [개인 몫 나누기]에서 개인 몫을 다시 나눠 주세요</div>' : '') +
      (un.length ? '<div class="b2bkpi-note">미배정 ' + f1(model.shares.unassigned).replace(/\.0$/, '') + '% · ' + un.map(function(r){ return esc(r.name); }).join('·') + ' 지표 미등록 — 다른 팀원에게 넘기지 않습니다</div>' : ''),
      '<button type="button" class="b2bkpi-btn" data-kpi-act="shares">개인 몫 나누기</button>');
    // ⑥ 점수 반영 흐름
    out += '<details class="b2bkpi-flow"><summary>' + N[5] + ' 점수 반영 흐름</summary><ol>' + c.parts.map(function(p){
      var w = p.key.indexOf('p:') === 0 ? '몫 ' + f1(p.weight).replace(/\.0$/, '') + '%' + (p.temporary ? '(임시)' : '') : '× ' + (p.weight / 100);
      var v = p.key === 'actual' ? '공식 실적 산출 대기(확인분 평균은 참고 영역에만 표시, 점수에 넣지 않음)' : p.state === 'ok' ? (p.key === 'team' ? f1(t.value) + '%' : f1(p.score) + '점') + ' ' + w + ' = ' + f1(p.points) + '점'
        : p.state === 'unassigned' ? '미배정(지표 미등록)' : '산출 대기';
      return '<li>' + esc(p.label) + ': ' + esc(v) + '</li>';
    }).join('') + '</ol><p>합계 ' + (c.reflected > 0 ? f1(c.points) + '점' : '— 점') + ' (' + weightLine(c) + ', 100점 환산 안 함)</p>' +
      '<p class="b2bkpi-muted">업무 관리점수와 공식 실적은 섞이지 않습니다. 공식 실적은 산출 대기이며, 대기분은 0점으로 넣지 않고 나머지 점수를 100점으로 바꾸지도 않습니다.</p></details>';
    return { kpi: kpiHtml, score: out };
  }
  function osOf(ui){ return ui.os || (typeof window !== 'undefined' && window.B2BKpiOs) || null; }
  /* 팀 OS 메뉴가 있으면: 홈 = KPI 카드가 가장 먼저 + 행동 진척·오늘 행동·알람·고객 흐름·AI 요약, 점수는 팀원 업무·알람 메뉴. 없으면 예전 한 화면. */
  function renderReady(model, ui){
    var O = osOf(ui);
    if(!O){ var all = renderParts(model, ui); return all.kpi + all.score; }
    var menu = ui.menu || 'home', out = O.menuBar(menu);
    if(ui.detail && O.kpiDetail) return out + O.kpiDetail(model, ui.detail, ui.csv && ui.csv[ui.detail] || null, ui.chain && ui.chain[ui.detail] || null);
    if(menu === 'home') return out + renderParts(model, ui).kpi + O.view('home', model);
    if(menu === 'tasks') return out + O.view('tasks', model, renderParts(model, ui, ['①', '③', '④', '⑤', '⑥', '⑦']).score);
    return out + O.view(menu, model);
  }

  /* ---- DOM ---- */
  function el(){ return document.getElementById('b2bKpiView'); }
  function place(v){ var h = document.querySelector('header.gnav'); v.style.top = Math.max(0, h ? h.getBoundingClientRect().bottom : 0) + 'px'; }
  function computeMeeting(){
    var L = window.SHIN2_MEETING_LOGIC, D = window.SHIN2_CRM_DATA, Mt = window.B2BKpiMeeting;
    if(!L || !D || !Mt) throw new Error('카드 판정 함수를 찾지 못함');
    ['buildProgressStages', 'classifyMeetingMiss', 'resolveNewMouForCompany', 'getStageCorrections', 'parsePartnerDateLabel'].forEach(function(k){ if(typeof L[k] !== 'function') throw new Error('카드 함수 없음: ' + k); });
    return Mt.evaluateMeetings(D.loadCompanies(), L, Date.now(), { start: new Date(2026, 7, 21).getTime(), bulkEnd: new Date(2026, 7, 26).getTime() });
  }
  function render(){
    var v = el(); if(!v) return;
    var model = null;
    if(st.ui.state === 'ready' && st.shape && window.B2BKpiCalc){
      // 이번 달을 볼 때만 카드 기록으로 1·2차 미팅을 실측해 LI01 달성률에 연결한다(지난달 화면은 그 달 기록 그대로)
      var shape = st.shape, meeting = null, meetingError = null;
      if(st.ui.month === nowMonth()){
        try { meeting = computeMeeting(); }
        catch(e){ meetingError = String(e && e.message || e); }
        if(meeting){ var p = window.B2BKpiMeeting.pooled(meeting.summary.all); shape = Object.assign({}, st.shape); shape.__cardNumeric = {}; shape.__cardNumeric[MEETING_DEF] = { num: p.num, den: p.den, state: p.state, source: '카드 실측(1·2차 미팅)' }; }
      }
      model = window.B2BKpiCalc.buildModel(shape, st.ui.month);
      model.meeting = meeting; model.meetingError = meetingError;
      st.meeting = meeting;
    }
    if(model && st.ui.detail){ st.ui.chain = st.ui.chain || {}; st.ui.chain[st.ui.detail] = computeChain(st.ui.detail, model); }
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
    if(!v){ v = document.createElement('section'); v.id = 'b2bKpiView'; v.className = 'b2bkpi-view'; v.setAttribute('aria-label', 'B2B KPI'); document.body.appendChild(v); v.addEventListener('click', onClick); v.addEventListener('change', onChange); }
    if(!st.ui.month) st.ui.month = nowMonth();
    var tabs = Array.prototype.slice.call(document.querySelectorAll('#crmTopTabs .top-tab,.gnav-drawer-menu .gnav-drawer-item'));
    tabs.forEach(function(b){ b.classList.toggle('is-active', !!b.dataset.b2bkpiTab); });
    document.body.classList.add('b2bkpi-on');
    place(v); render(); load();
    clearInterval(st.timer);
    st.timer = setInterval(function(){ if(!document.hidden && !st.busy) load(); }, POLL_MS);
  }
  function close(){
    clearInterval(st.timer); st.timer = null; closeModal(); st.ui.csv = null; st.ui.detail = null; st.ui.ledger = null; st.ui.ledgerError = null; st.ui.chain = null;
    var v = el(); if(v) v.remove();
    if(!document.body.classList.contains('b2bkpi-on')) return;
    document.body.classList.remove('b2bkpi-on');
    document.querySelectorAll('[data-b2bkpi-tab]').forEach(function(b){ b.classList.remove('is-active'); });
    var cust = document.getElementById('crmTabCustomer'); if(cust && !document.querySelector('#crmTopTabs .top-tab.is-active')) cust.classList.add('is-active');
  }
  /* 화면 안의 파일 입력(label+input)에서 고른 파일 — 브라우저 메모리에서만 읽는다 */
  function onChange(e){
    var t = e.target, kind = t && t.getAttribute && t.getAttribute('data-kpi-file'); if(!kind) return;
    var f = t.files && t.files[0]; if(!f) return;
    if(kind === 'ledger') readLedgerFile(f); else readCsvFile(f, t.getAttribute('data-kpi'));
    try { t.value = ''; } catch(x){}
  }
  function onClick(e){
    var t = e.target.closest && e.target.closest('[data-kpi-act]'); if(!t) return;
    var act = t.getAttribute('data-kpi-act');
    if(act === 'close'){ var c = document.getElementById('crmTabCustomer'); if(c) c.click(); else close(); return; }
    if(act === 'reload'){ st.ui.state = 'loading'; render(); load(); return; }
    if(act === 'menu'){ st.ui.menu = t.getAttribute('data-menu') || 'home'; st.ui.detail = null; render(); var vv = el(); if(vv) vv.scrollTop = 0; return; }
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
  /* 이어 쌓기: 기준 원장(사용자가 고른 파일, 메모리에서만) + 카드 요청 기록(마감 이후) 으로 마감 시점·오늘 값을 계산 */
  function computeChain(id, model){
    var Ch = window.B2BKpiChain; if(!Ch) return { error: '이어 쌓기 계산 파일(b2b-kpi-chain.js)을 불러오지 못했습니다' };
    if(st.ui.ledgerError) return { error: st.ui.ledgerError };
    if(!st.ui.ledger) return { need: 'ledger' };
    var row = ((model && model.actual && model.actual.rows) || []).filter(function(r){ return r.id === id; })[0];
    if(!row || row.source !== 'official' || !row.cutoff) return { error: '저장된 확인분(마감 값)이 없어 이어 쌓을 수 없습니다' };
    var cohort = null;
    if(id === 'MK1'){ var c = st.ui.csv && st.ui.csv.MK1; cohort = c && c.analysis && c.analysis.cohort; if(!cohort) return { need: 'cohort' }; }
    try {
      var D = window.SHIN2_CRM_DATA; if(!D) return { error: '카드 데이터를 찾지 못했습니다' };
      var card = Ch.mapCardEvents(D.loadSheetRequests(), D.loadCompanies());
      return { report: Ch.chainReport(id, { ledgerEvents: st.ui.ledger.events, cardEvents: card.events, cohort: cohort, cutoff: row.cutoff, asOf: Ch.kstDay(new Date().toISOString()), base: { num: row.num, den: row.den } }) };
    } catch(e){ return { error: String(e && e.message || e) }; }
  }
  function readLedgerFile(file){
    var D = window.B2BKpiDetail, Ch = window.B2BKpiChain, rd = new FileReader();
    rd.onerror = function(){ st.ui.ledger = null; st.ui.ledgerError = '파일을 읽지 못했습니다'; render(); };
    rd.onload = function(){
      try { var r = Ch.ledgerEvents(D.parseCsv(String(rd.result || ''))); st.ui.ledger = { file: file.name, events: r.events, skipped: r.skipped }; st.ui.ledgerError = null; }
      catch(e){ st.ui.ledger = null; st.ui.ledgerError = String(e && e.message || e); }
      render();
    };
    rd.readAsText(file, 'utf-8');
  }
  function readCsvFile(file, id){
    var D = window.B2BKpiDetail, rd = new FileReader(), put = function(o){ st.ui.csv = st.ui.csv || {}; st.ui.csv[id] = o; render(); };
    rd.onerror = function(){ put({ file: file.name, error: '파일을 읽지 못했습니다' }); };
    rd.onload = function(){
      try { put({ file: file.name, analysis: D.analyze(id, D.parseCsv(String(rd.result || ''))), filter: 'all', page: 0 }); }
      catch(e){ put({ file: file.name, error: String(e && e.message || e) }); }
    };
    rd.readAsText(file, 'utf-8');
  }
  var handlers = {
    kpiDetail: function(t){ st.ui.detail = t.getAttribute('data-kpi'); render(); var v = el(); if(v) v.scrollTop = 0; },
    ledgerClear: function(){ st.ui.ledger = null; st.ui.ledgerError = null; render(); },
    kpiBack: function(){ st.ui.detail = null; render(); var v = el(); if(v) v.scrollTop = 0; },
    csvClear: function(t){ if(st.ui.csv) delete st.ui.csv[t.getAttribute('data-kpi')]; render(); },
    csvFilter: function(t){ var c = st.ui.csv && st.ui.csv[t.getAttribute('data-kpi')]; if(c){ c.filter = t.getAttribute('data-f'); c.page = 0; } render(); },
    csvPage: function(t){ var c = st.ui.csv && st.ui.csv[t.getAttribute('data-kpi')]; if(c){ c.page = Math.max(0, (c.page || 0) + (+t.getAttribute('data-n'))); } render(); },
    toggleDef: function(t){ var id = t.getAttribute('data-def'); st.ui.openDef = st.ui.openDef === id ? null : id; render(); },
    task: function(t){ if(st.busy) return; afterWrite(window.B2BKpiStore.setTaskProg(st.shape, t.getAttribute('data-def'), st.ui.month, +t.getAttribute('data-i'), window.B2BKpiCalc.nextTaskProg(+t.getAttribute('data-p')), ACTOR)); },
    team: function(t){ if(st.busy) return; afterWrite(window.B2BKpiStore.toggleTeamCheck(st.shape, t.getAttribute('data-k'), st.ui.month, +t.getAttribute('data-i'), ACTOR)); },
    add: function(){ openEditor(null); },
    edit: function(t){ openEditor(t.getAttribute('data-member')); },
    shares: function(){ openShares(); },
    meetingList: function(t){ if(!st.meeting) return; modalRoot().innerHTML = '<div class="pi-overlay b2bkpi-ov"><div class="pi-panel b2bkpi-modal" role="dialog" aria-modal="true" aria-label="미팅 관리 목록">' + meetingListHtml(st.meeting, t.getAttribute('data-stage'), t.getAttribute('data-group')) + '<div class="b2bkpi-mfoot"><button type="button" class="b2bkpi-btn" data-m="cancel">닫기</button></div></div></div>'; }
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

  var api = { renderHtml: renderHtml, open: open, close: close, render: render, formToInputs: formToInputs, planSave: planSave, runSavePlan: runSavePlan, meetingListHtml: meetingListHtml };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined' && typeof document !== 'undefined'){
    window.B2BKpiTab = api;
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
  }
})();
