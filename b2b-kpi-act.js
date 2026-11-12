/* §행동 기록(2026-11) — 고객별 행동을 한 줄 드롭다운으로 남긴다. 항목은 모두 팀장님 파일에서 온다:
   행동 = 팀원 안내서 '고객별로 반복할 운영' 12가지(O11~O34), 결과 = 결과 버튼 9가지, 막힌 이유 = 막힘 코드 8가지. 글로 쓰는 칸 없음.
   순수 함수(DOM·저장 없음). 기록은 카드의 고객 기록(b2bActions 덧붙임 항목, 로그인해야 보임)에 두고 원래 고객 필드는 바꾸지 않는다.
   행동 기록은 행동 진척일 뿐 — 고객 KPI 성과 숫자를 바꾸지 않는다. */
(function(){
  'use strict';
  var KPIS = ['MK1', 'MK3', 'MK2'];
  function kstDay(iso){ var t = Date.parse(iso); if(isNaN(t)) return ''; return new Date(t + 9 * 3600000).toISOString().slice(0, 10); }
  function validDate(s){ var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if(!m) return false; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]; }
  function rid(){ return 'ba_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  /* 입력(드롭다운 값) → 기록. 팀장님 목록에 없는 값은 받지 않는다. */
  function newRecord(input, ctx){
    var D = ctx.data, i = input || {};
    var op = (D.ops || []).filter(function(o){ return o.id === i.opsId; })[0];
    if(!op) throw new Error('행동을 골라 주세요');
    if((D.resultButtons || []).indexOf(i.result) < 0) throw new Error('결과를 골라 주세요');
    var block = i.block || '';
    if(block && (D.blockCodes || []).indexOf(block) < 0) throw new Error('막힌 이유는 목록에서 골라 주세요');
    var nc = i.nextCheck || '';
    if(nc && !validDate(nc)) throw new Error('다음 확인일 날짜가 올바르지 않습니다');
    var day = kstDay(ctx.now);
    return { id: rid(), kind: 'b2bAction', opsId: op.id, kpi: op.kpi, result: i.result, block: block, nextCheck: nc, by: ctx.by, at: ctx.now, day: day,
      key: [op.id, i.result, block, nc, day].join('|') };
  }
  /* 같은 날 같은 행동·결과·막힘·확인일은 한 번만 — 중복 클릭으로 기록이 늘지 않게 */
  function append(list, rec){
    var cur = Array.isArray(list) ? list.slice() : [];
    if(cur.some(function(x){ return x && x.key === rec.key; })) return { list: cur, added: false, dup: true };
    cur.push(rec); return { list: cur, added: true, dup: false };
  }
  /* 카드 업체 목록 → 행동 기록 전체(이름은 화면 표시용으로만 붙임, 저장하지 않음) */
  function flatten(companies){
    var out = [];
    (companies || []).forEach(function(c){
      if(!c || !Array.isArray(c.b2bActions)) return;
      c.b2bActions.forEach(function(r){ if(r && r.kind === 'b2bAction') out.push(Object.assign({ companyId: c.id, companyName: c.name || '' }, r)); });
    });
    return out;
  }
  /* 이번 달 기록 수(주연결 KPI 기준) + 구축 체크 진행 — 이행률이 아니라 '기록 수·진행 수'만 센다 */
  function summarize(records, buildStates, month, D){
    var per = {}, total = { records: 0, buildDone: 0, buildTotal: (D.build || []).length }, st = buildStates || {};
    KPIS.forEach(function(k){ per[k] = { records: 0, buildDone: 0, buildDoing: 0, buildTotal: 0 }; });
    (D.build || []).forEach(function(b){ var p = per[b.kpi]; if(!p) return; p.buildTotal++; if(st[b.id] === 'done'){ p.buildDone++; total.buildDone++; } else if(st[b.id] === 'doing') p.buildDoing++; });
    var recent = (records || []).filter(function(r){ return r && String(r.day || '').slice(0, 7) === month; });
    recent.forEach(function(r){ if(per[r.kpi]) per[r.kpi].records++; total.records++; });
    recent.sort(function(a, b){ return a.day === b.day ? (a.at < b.at ? 1 : -1) : (a.day < b.day ? 1 : -1); });
    return { perKpi: per, total: total, recent: recent };
  }
  function nextBuildState(s){ return s === 'todo' || !s ? 'doing' : s === 'doing' ? 'done' : 'todo'; }

  var api = { newRecord: newRecord, append: append, flatten: flatten, summarize: summarize, nextBuildState: nextBuildState, kstDay: kstDay };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiAct = api;
})();
