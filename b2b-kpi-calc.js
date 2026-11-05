/* §B2B KPI 탭 — 순수 계산(화면·저장 없음). 브라우저(window.B2BKpiCalc)와 Node 테스트에서 함께 쓴다.
   원칙(2026-11-05 사용자 확정): 실제 KPI 실적과 업무 관리점수는 분리, 미측정·미배정은 0점으로 치지 않고
   100점으로 다시 환산하지 않는다. 데이터는 B2B 업무트래커(shared/b2bOpsTracker)와 같은 모양을 읽는다. */
(function(){
  'use strict';
  var TARGETS = { MK1: { base: 50, target: 60, challenge: 70 }, MK2: { base: 80, target: 85, challenge: 90 }, MK3: { base: 30, target: 35, challenge: 40 } };
  var WEIGHTS = { actual: 0.6, team: 0.2, personal: 0.2 };
  var KPI_IDS = ['MK1', 'MK2', 'MK3'];

  function isNum(v){ return typeof v === 'number' && isFinite(v); }
  function clamp(v){ return Math.max(0, Math.min(100, v)); }
  function vals(o){ return o ? Object.keys(o).map(function(k){ return o[k]; }) : []; }
  function byId(a, b){ return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }

  /* 업무트래커 PerfCalc.rate 와 같은 규칙 — none: 미측정 / empty: 대상 없음 / ok: 값 있음 */
  function rate(rec){
    if(!rec) return { state: 'none' };
    if(rec.mode === 'direct'){
      if(!isNum(rec.direct)) return { state: 'none' };
      return { state: 'ok', value: clamp(rec.direct) };
    }
    if(!isNum(rec.den)) return { state: 'none' };
    if(rec.den === 0) return { state: 'empty', den: 0, num: rec.num };
    if(!isNum(rec.num)) return { state: 'none', den: rec.den };
    return { state: 'ok', value: clamp(rec.num / rec.den * 100), num: rec.num, den: rec.den };
  }
  function view(shape, ref, month){
    var k = ref + '_' + month;
    return ((shape && shape.perfAuto) || {})[k] || ((shape && shape.perfMonthly) || {})[k] || null;
  }

  /* 실제 KPI 실적 — KPI별 달성 = min(100, 실적률 ÷ 공식 목표), 값 = 측정된 KPI 평균 */
  function kpiActual(shape, month){
    var mk = (shape && shape.mainKpis) || {};
    var rows = KPI_IDS.map(function(id){
      var t = TARGETS[id], d = mk[id] || {}, r = rate(view(shape, id, month));
      var row = { id: id, no: d.no || '', name: d.name || id, state: r.state, rate: r.state === 'ok' ? r.value : null,
        num: isNum(r.num) ? r.num : null, den: isNum(r.den) ? r.den : null, base: t.base, target: t.target, challenge: t.challenge,
        auto: !!(((shape && shape.perfAuto) || {})[id + '_' + month]) };
      row.ach = r.state === 'ok' ? Math.min(100, r.value / t.target * 100) : null;
      return row;
    });
    var ok = rows.filter(function(r){ return r.ach != null; });
    return { rows: rows, value: ok.length ? ok.reduce(function(s, r){ return s + r.ach; }, 0) / ok.length : null, measured: ok.length, total: KPI_IDS.length };
  }

  function leadDefsOf(shape, memberId){
    return vals(shape && shape.leadDefs).filter(function(d){ return d && d.member === memberId; }).sort(byId);
  }
  /* 세부업무 진행률 — 트래커 taskPct: prog 우선, 없으면 예전 checks 표시는 완료(100) */
  function taskPct(rec, i){
    var k = 't' + (i + 1), p = rec && rec.prog && rec.prog[k];
    if(isNum(p)) return clamp(p);
    return rec && rec.checks && rec.checks[k] ? 100 : 0;
  }
  function taskStats(names, rec){
    var o = { done: 0, doing: 0, todo: 0, total: (names || []).length };
    for(var i = 0; i < o.total; i++){ var p = taskPct(rec, i); if(p >= 100) o.done++; else if(p > 0) o.doing++; else o.todo++; }
    return o;
  }

  /* 개인 업무 관리점수 — 측정된 선행지표만 평균(미측정·대상 없음 제외, 0점 처리 금지).
     지표 점수 = min(100, 달성률 ÷ 지표 목표) (목표 없으면 달성률), 비중은 cardWeight(없으면 같은 비율). */
  function personScore(shape, memberId, month){
    var defs = leadDefsOf(shape, memberId);
    var rows = defs.map(function(d){
      var r = rate(view(shape, d.id, month)), tgt = isNum(d.target) && d.target > 0 ? d.target : null;
      return { id: d.id, no: d.no || '', name: d.name || d.id, state: r.state, rate: r.state === 'ok' ? r.value : null,
        num: isNum(r.num) ? r.num : null, den: isNum(r.den) ? r.den : null, target: tgt,
        score: r.state === 'ok' ? (tgt ? Math.min(100, r.value / tgt * 100) : r.value) : null,
        weight: isNum(d.cardWeight) ? d.cardWeight : null,
        auto: !!(((shape && shape.perfAuto) || {})[d.id + '_' + month]),
        tasks: taskStats(d.tasks, ((shape && shape.perfMonthly) || {})[d.id + '_' + month]) };
    });
    var out = { rows: rows, total: rows.length, measured: 0, measuredIds: [], value: null };
    if(!rows.length){ out.state = 'nodefs'; return out; }
    var ok = rows.filter(function(r){ return r.state === 'ok'; });
    out.measured = ok.length; out.measuredIds = ok.map(function(r){ return r.id; });
    var anyW = rows.some(function(r){ return r.weight != null; });
    var use = ok.map(function(r){ return { s: r.score, w: anyW ? (r.weight || 0) : 1 }; }).filter(function(x){ return x.w > 0; });
    var wsum = use.reduce(function(s, x){ return s + x.w; }, 0);
    if(!wsum){ out.state = 'wait'; return out; }
    out.value = use.reduce(function(s, x){ return s + x.s * x.w; }, 0) / wsum;
    out.state = 'ok';
    return out;
  }
  function measuredChanged(prevIds, curIds){
    var a = (prevIds || []).slice().sort().join('|'), b = (curIds || []).slice().sort().join('|');
    return a !== b;
  }

  var api = { TARGETS: TARGETS, WEIGHTS: WEIGHTS, KPI_IDS: KPI_IDS, rate: rate, view: view, kpiActual: kpiActual,
    leadDefsOf: leadDefsOf, taskPct: taskPct, personScore: personScore, measuredChanged: measuredChanged };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiCalc = api;
})();
