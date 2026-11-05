/* §B2B KPI 탭 — 1·2차 미팅 누락 방지 실측(고객관리카드 도입 2026-08-21 이후).
   판정은 카드에 이미 있는 규칙과 함수(buildProgressStages·classifyMeetingMiss)를 그대로 쓴다. 원본 기록은 읽기만 한다.
     기한 = 예정일 + 3일(예정일이 있을 때) / 앞 단계 완료일 + 14일(예정일이 없을 때)
     ② 기한 내 완료  : 실제 완료일 ≤ 기한
     ③ 기한 초과 후 처리: 실제 완료일 > 기한 — 지금은 처리 완료지만 기한 내 성공으로 세지 않는다
     ④ 미처리 누락  : 기한이 지났는데 완료 기록 없음
     ⑤ 판정 불가    : 실제 완료일 기록이 없는 '완료 간주'(협약 체결 등), 지사·조율 메모, 날짜 없음
   누락 방지율 = ② ÷ (② + ③ + ④). 기한이 아직 안 온 건은 대상에 넣지 않는다. 등록일로는 대상·완료를 추정하지 않는다
   (등록일은 8/25 일괄 등록과 그 뒤 신규 등록을 나누는 데만 쓴다). */
(function(){
  'use strict';
  var DAY = 86400000;
  function d10(t){ if(t == null) return ''; var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate(); }
  function tsOf(v){ if(!v) return null; if(typeof v === 'number') return v; var t = Date.parse(v); return isNaN(t) ? null : t; }
  var STAGE = { m1: '1차', m2: '2차' };

  function evaluateMeetings(companies, L, now, opts){
    opts = opts || {};
    var start = opts.start, bulkEnd = opts.bulkEnd, GRACE = L.GRACE, REG = L.REG;
    var P = function(s){ var p = L.parsePartnerDateLabel(s); return p ? p.ts : null; };
    var rows = [], excluded = [];
    (companies || []).forEach(function(co){
      if(!co) return;
      if(co.deletedAt){ excluded.push({ name: co.name, why: '삭제된 업체' }); return; }
      if(L.isAgreementTerminated(co)){ excluded.push({ name: co.name, why: '협약 종료 업체' }); return; }
      var ca = tsOf(co.createdAt), group = ca != null && bulkEnd != null && ca >= bulkEnd ? 'new' : 'bulk';
      var nm = L.resolveNewMouForCompany(co) || {}, sc = L.getStageCorrections(co) || {}, pr = L.buildProgressStages(co), st = {};
      pr.stages.forEach(function(s){ st[s.key] = s; });
      var items = L.classifyMeetingMiss(co, pr, now) || [];
      ['m1', 'm2'].forEach(function(k){
        var it = items.filter(function(x){ return x.key === k; })[0]; if(!it) return;
        var s = st[k] || {}, prevKey = k === 'm1' ? 'q' : 'm1', prev = st[prevKey];
        var sched = sc[k + 'Scheduled'], doneCorr = sc[k + 'Done'] || (sched && sched.status === 'done' ? sched : null);
        var labelDone = P(nm[k + 'Label']);
        var doneTs = doneCorr ? P(doneCorr.dateText) : (labelDone != null && labelDone <= now ? labelDone : null);
        var schedTs = sched ? P(sched.dateText) : P(nm[k + 'ScheduledLabel']);
        var anchor = prev && prev.state === 'done' && typeof prev.ts === 'number' ? prev.ts : null;
        var prevName = prevKey === 'q' ? '질문서 회신 ' : '1차 완료 ';
        var due = null, basis = '';
        if(schedTs != null){ due = schedTs + GRACE * DAY; basis = '예정일 ' + d10(schedTs) + ' + ' + GRACE + '일'; }
        else if(anchor != null){ due = anchor + REG * DAY; basis = prevName + d10(anchor) + ' + ' + REG + '일' + (doneTs != null ? '(예정일 기록 없음)' : ''); }
        var cls, why;
        if(it.status === 'branch' || it.status === 'coord' || it.status === 'format'){
          cls = 'unknown'; why = (it.status === 'branch' ? '지사 진행 메모' : it.status === 'coord' ? '조율 중 메모' : '날짜를 읽을 수 없는 메모') + (it.text ? ' "' + String(it.text).slice(0, 20) + '"' : '');
        } else if(s.state === 'done' && doneTs == null){ cls = 'unknown'; why = '완료로 표시되지만 실제 완료일 기록 없음(협약 체결 등으로 완료 간주)'; }
        else if(due == null){ cls = 'unknown'; why = '기한을 정할 날짜 없음'; }
        else if(doneTs != null){ cls = doneTs <= due ? 'ontime' : 'late'; why = basis + ' → 완료 ' + d10(doneTs); }
        else if(due <= now){ cls = 'missed'; why = basis + ' 지남, 완료 기록 없음'; }
        else { cls = 'upcoming'; why = basis + '(아직 기한 전)'; }
        rows.push({ id: String(co.id), name: co.name || '', code: co.code || '', group: group, regDate: d10(ca), stage: k, stageName: STAGE[k],
          cls: cls, due: due != null ? d10(due) : '', dueTs: due, doneAt: doneTs != null ? d10(doneTs) : '', why: why,
          owner: (sched && sched.owner) || nm[k + 'Owner'] || '',
          inScope: due != null && (start == null || due >= start) && due <= now });
      });
    });
    function sum(filter, k){
      var x = rows.filter(function(r){ return r.stage === k && filter(r); });
      var c = function(cl){ return x.filter(function(r){ return r.inScope && r.cls === cl; }).length; };
      var o = { due: x.filter(function(r){ return r.inScope; }).length, ontime: c('ontime'), late: c('late'), missed: c('missed'), unknown: c('unknown'),
        upcoming: x.filter(function(r){ return r.cls === 'upcoming'; }).length, unplaced: x.filter(function(r){ return r.dueTs == null; }).length };
      o.judged = o.ontime + o.late + o.missed;
      o.rate = o.judged ? o.ontime / o.judged * 100 : null;
      return o;
    }
    var all = function(){ return true; }, isNew = function(r){ return r.group === 'new'; };
    return { rows: rows, excluded: excluded,
      summary: { all: { m1: sum(all, 'm1'), m2: sum(all, 'm2') }, new: { m1: sum(isNew, 'm1'), m2: sum(isNew, 'm2') } },
      rule: { grace: GRACE, reg: REG, start: d10(start), bulkEnd: d10(bulkEnd), now: d10(now) } };
  }
  /* 화면 표시 — 대상 0 이면 '대상 없음', 판정 가능한 건이 0 이면 '미측정'(100%·0%로 쓰지 않는다) */
  function label(s){
    if(!s || !s.due) return '대상 없음';
    if(!s.judged) return '미측정';
    return '관리 완료 ' + s.ontime + '/' + s.judged + '곳 · ' + (Math.round(s.rate * 10) / 10) + '%';
  }
  /* 지표 하나로 합치기(1차+2차) — 이 값이 지표 달성률을 대신한다(체크 점수와 더하지 않는다) */
  function pooled(group){
    var num = group.m1.ontime + group.m2.ontime, den = group.m1.judged + group.m2.judged;
    return { num: num, den: den, rate: den ? num / den * 100 : null, state: den ? 'ok' : (group.m1.due + group.m2.due ? 'none' : 'empty') };
  }
  var api = { evaluateMeetings: evaluateMeetings, label: label, pooled: pooled };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiMeeting = api;
})();
