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

  var DEFAULT_MEMBERS = ['shs', 'm2'];
  var PERSONAL_TOTAL = WEIGHTS.personal * 100; // 개인 몫 합계 20(%) — 사람 수와 무관

  function prevMonth(m){
    var a = String(m).split('-'), y = +a[0], mo = +a[1] - 1;
    if(mo === 0){ y--; mo = 12; }
    return y + '-' + (mo < 10 ? '0' : '') + mo;
  }
  function memberName(shape, id){
    var m = ((shape && shape.members) || {})[id];
    return m && String(m.name || '').trim() || id;
  }

  /* 팀 공동 업무 — KPI별 '관리 업무'(mainKpis.manage) 체크. 그 달 기록이 하나도 없으면 산출 대기 */
  function teamCommon(shape, month){
    var mk = (shape && shape.mainKpis) || {}, tc = (shape && shape.kpiTeamChecks) || {}, any = false, checked = 0, total = 0;
    var byKpi = KPI_IDS.map(function(id){
      var d = mk[id] || {}, rec = tc[id + '_' + month];
      if(rec) any = true;
      var items = (d.manage || []).map(function(text, i){
        var on = !!(rec && rec.checks && rec.checks['c' + (i + 1)] === true);
        if(on) checked++;
        total++;
        return { i: i, text: text, checked: on };
      });
      return { id: id, no: d.no || '', name: d.name || id, items: items };
    });
    return { state: any && total ? 'ok' : 'wait', value: any && total ? checked / total * 100 : null, checked: checked, total: total, byKpi: byKpi };
  }

  /* 개인 몫 나누기 — 저장값(kpiTabConfig.shares)이 없으면 같은 비율의 '임시 비중'.
     지표 없는 팀원의 몫은 미배정으로 남기고 다른 사람에게 넘기지 않는다. */
  function shareRows(shape){
    var cfg = (shape && shape.kpiTabConfig) || {}, ids = (cfg.members && cfg.members.length ? cfg.members : DEFAULT_MEMBERS).slice();
    var saved = cfg.shares || {}, assigned = 0, unassigned = 0;
    var rows = ids.map(function(id){
      var has = leadDefsOf(shape, id).length > 0, s = isNum(saved[id]);
      var share = s ? saved[id] : PERSONAL_TOTAL / ids.length;
      if(has) assigned += share; else unassigned += share;
      return { memberId: id, name: memberName(shape, id), share: share, temporary: !s, hasDefs: has };
    });
    return { rows: rows, assigned: assigned, unassigned: unassigned };
  }
  function validateShares(map, memberIds){
    var errs = [], sum = 0;
    (memberIds || []).forEach(function(id){
      var v = map && map[id];
      if(!isNum(v) || v < 0 || v > PERSONAL_TOTAL) errs.push(id + ': 0~' + PERSONAL_TOTAL + ' 사이 숫자');
      else sum += v;
    });
    if(!errs.length && Math.abs(sum - PERSONAL_TOTAL) > 0.001) errs.push('합계 ' + Math.round(sum * 100) / 100 + ' — ' + PERSONAL_TOTAL + '이 되어야 합니다');
    return errs;
  }

  /* 종합점수 = 실적×0.6 + 팀 공동×0.2 + Σ(개인 점수 × 개인 몫%). 산출 대기·미배정은 더하지 않고, 100점으로 환산하지 않는다. */
  function composite(actual, team, persons, shares){
    var parts = [], r2 = function(v){ return Math.round(v * 1e6) / 1e6; };
    var aOk = actual && actual.value != null;
    parts.push({ key: 'actual', label: '실제 KPI 실적', weight: WEIGHTS.actual * 100, state: aOk ? 'ok' : 'wait', points: aOk ? actual.value * WEIGHTS.actual : null });
    var tOk = team && team.state === 'ok';
    parts.push({ key: 'team', label: '팀 공동 업무', weight: WEIGHTS.team * 100, state: tOk ? 'ok' : 'wait', points: tOk ? team.value * WEIGHTS.team : null });
    ((shares && shares.rows) || []).forEach(function(r){
      var p = (persons || {})[r.memberId] || { state: 'nodefs' };
      var st = !r.hasDefs || p.state === 'nodefs' ? 'unassigned' : p.state === 'ok' ? 'ok' : 'wait';
      parts.push({ key: 'p:' + r.memberId, memberId: r.memberId, label: r.name, weight: r.share, temporary: r.temporary, state: st,
        score: st === 'ok' ? p.value : null, points: st === 'ok' ? p.value * r.share / 100 : null });
    });
    var sum = function(st){ return r2(parts.filter(function(p){ return p.state === st; }).reduce(function(s, p){ return s + p.weight; }, 0)); };
    return { parts: parts, points: parts.reduce(function(s, p){ return s + (p.points || 0); }, 0),
      reflected: sum('ok'), waiting: sum('wait'), unassigned: sum('unassigned') };
  }

  /* 뒤처진 부분 — 목표 미달 KPI → 목표 대비 낮은 선행지표 → 사람별 미측정 개수(최대 5줄) */
  function laggards(actual, persons, shape){
    var kp = ((actual && actual.rows) || []).filter(function(r){ return r.ach != null && r.ach < 100; }).sort(function(a, b){ return a.ach - b.ach; })
      .map(function(r){ return { kind: 'kpi', label: (r.no ? r.no + ' ' : '') + r.name, detail: '목표 ' + r.target + '% 대비 달성 ' + Math.round(r.ach * 10) / 10 + '%' }; });
    var leads = [], um = [];
    Object.keys(persons || {}).forEach(function(id){
      var p = persons[id]; if(!p || !p.rows) return;
      p.rows.forEach(function(r){ if(r.score != null && r.score < 100) leads.push({ kind: 'lead', label: memberName(shape, id) + ' · ' + (r.no ? r.no + ' ' : '') + r.name, detail: '목표 대비 ' + Math.round(r.score * 10) / 10 + '점', s: r.score }); });
      var miss = p.total - p.measured - p.rows.filter(function(r){ return r.state === 'empty'; }).length;
      if(miss > 0) um.push({ kind: 'unmeasured', label: memberName(shape, id), detail: '선행지표 ' + miss + '개 미측정(' + p.measured + '/' + p.total + '개 측정)' });
    });
    leads.sort(function(a, b){ return a.s - b.s; }).forEach(function(x){ delete x.s; });
    var room = Math.max(0, 5 - kp.length - um.length);
    return kp.concat(leads.slice(0, room), um).slice(0, 5);
  }

  function buildModel(shape, month){
    var pm = prevMonth(month), actual = kpiActual(shape, month), team = teamCommon(shape, month), shares = shareRows(shape), persons = {}, notes = {};
    shares.rows.forEach(function(r){
      var cur = personScore(shape, r.memberId, month), prev = personScore(shape, r.memberId, pm);
      persons[r.memberId] = cur;
      notes[r.memberId] = prev.measured > 0 && measuredChanged(prev.measuredIds, cur.measuredIds);
    });
    return { month: month, prevMonth: pm, actual: actual, team: team, persons: persons, shares: shares,
      composite: composite(actual, team, persons, shares), laggards: laggards(actual, persons, shape), compareNotes: notes };
  }

  var api = { TARGETS: TARGETS, WEIGHTS: WEIGHTS, KPI_IDS: KPI_IDS, DEFAULT_MEMBERS: DEFAULT_MEMBERS, rate: rate, view: view, kpiActual: kpiActual,
    leadDefsOf: leadDefsOf, taskPct: taskPct, personScore: personScore, measuredChanged: measuredChanged, prevMonth: prevMonth,
    memberName: memberName, teamCommon: teamCommon, shareRows: shareRows, validateShares: validateShares, composite: composite,
    laggards: laggards, buildModel: buildModel };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiCalc = api;
})();
