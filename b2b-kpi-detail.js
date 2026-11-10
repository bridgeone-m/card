/* §KPI 상세의 대상 목록(2026-11) — 팀장님이 준 근거 CSV(신규_HTML36_90일·기회_30일·재사용_60일)를 사용자가 직접 고른 파일로 읽는다.
   순수 함수(파일 읽기는 탭이 한다). 고객 이름이 든 파일이라 공개 저장소·서버·브라우저 저장소에 넣지 않고, 화면이 열려 있는 동안 메모리에서만 쓴다.
   날짜·연결이 미확인인 항목은 실패로 단정하지 않는다. 관찰 중 항목의 조기 성과는 관찰 완료 집계(분모·분자)에 합치지 않는다. */
(function(){
  'use strict';
  var DAY = 86400000;
  function parseCsv(text){
    var s = String(text == null ? '' : text).replace(/^﻿/, ''), rows = [], r = [], f = '', q = false, i, c;
    for(i = 0; i < s.length; i++){
      c = s[i];
      if(q){ if(c === '"'){ if(s[i + 1] === '"'){ f += '"'; i++; } else q = false; } else f += c; }
      else if(c === '"') q = true;
      else if(c === ','){ r.push(f); f = ''; }
      else if(c === '\n'){ r.push(f); rows.push(r); r = []; f = ''; }
      else if(c !== '\r') f += c;
    }
    if(f !== '' || r.length){ r.push(f); rows.push(r); }
    rows = rows.filter(function(x){ return x.length > 1 || (x.length === 1 && x[0] !== ''); });
    if(!rows.length) return [];
    var head = rows[0].map(function(h){ return String(h).trim(); });
    return rows.slice(1).map(function(x){ var o = {}; head.forEach(function(h, k){ o[h] = x[k] == null ? '' : x[k]; }); return o; });
  }
  function iso(v){ var m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(String(v || '').trim()); if(!m) return ''; var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); }
  function addDays(s, n){ if(!s) return ''; var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + n * DAY).toISOString().slice(0, 10); }
  function yes(v){ return String(v).trim().toLowerCase() === 'true'; }
  var NEED = {
    MK1: ['HTML업체명', 'HTML협약일', 'mature_90d', 'activated_90d', '상태'],
    MK3: ['고객명', '단지원문', '공종키', 'entry_date', 'reached_30d', 'mature_30d', 'route'],
    MK2: ['고객명', 'first_valid_L3_date', 'reused_60d', 'mature_60d', 'route']
  };
  var FILE = { MK1: '신규_HTML36_90일.csv', MK3: '기회_30일.csv', MK2: '재사용_60일.csv' };
  function check(id, rows){
    if(!rows || !rows.length) throw new Error('파일이 비어 있습니다');
    var miss = (NEED[id] || []).filter(function(k){ return !(k in rows[0]); });
    if(miss.length) throw new Error('파일이 맞지 않습니다 — ' + FILE[id] + ' 가 아닌 것 같습니다(없는 열: ' + miss.join(', ') + ')');
  }
  function item(o){ return o; }
  /* 항목: { name, scope, start, end, phase('관찰 중'|'기간 종료'|'제외'), result, detail, ok(true|false|null) } */
  function kpi1(r){
    var st = String(r['상태'] || ''), mature = yes(r.mature_90d), act = yes(r.activated_90d), ex = /제외/.test(st);
    var start = iso(r['HTML협약일']) || iso(r['마스터협약일']), phase, result, ok = null;
    if(ex){ phase = '제외'; result = '협약일 불확정 · 제외(날짜 미확인이며 실패가 아님)'; }
    else if(!mature){ phase = '관찰 중'; result = act ? '진행 중 조기 요청 있음 · 관찰 완료 후 합산(분모에 넣지 않음)' : '관찰 중 · 아직 요청 없음(분모에 넣지 않음)'; }
    else { phase = '기간 종료'; ok = act; result = act ? '활동 확인' : '활동 미관측(실패 확정 아님)'; }
    var d = r.first_activity_in_window ? '첫 활동 ' + r.first_activity_in_window + (r['활동소요일'] ? ' (' + r['활동소요일'] + '일)' : '') : '';
    return item({ name: r['HTML업체명'], scope: '', start: start, end: addDays(start, 90), phase: phase, result: result, detail: d, ok: ok, _mature: mature && !ex });
  }
  function kpi2(r){
    var mature = yes(r.mature_30d), hit = yes(r.reached_30d), start = iso(r.entry_date), route = String(r.route || '');
    var d = r.first_L3 ? '첫 L3 ' + r.first_L3 + (r.days_to_L3 ? ' (' + r.days_to_L3 + '일)' : '') : '';
    return item({ name: r['고객명'], scope: (r['단지원문'] || '단지 미확인') + ' · ' + (r['공종키'] || '공종 미확인'), start: start, end: addDays(start, 30),
      phase: mature ? '기간 종료' : '관찰 중', result: mature ? route : '관찰 중 · ' + route + ' · 분모에 넣지 않음', detail: d, ok: mature ? hit : null, _mature: mature });
  }
  function kpi3(r){
    var mature = yes(r.mature_60d), hit = yes(r.reused_60d), start = iso(r.first_valid_L3_date), route = String(r.route || '');
    var d = r.reuse_date ? '재사용 ' + r.reuse_date + (r.reuse_type ? ' · 새 ' + r.reuse_type : '') + (r.days_to_reuse ? ' (' + r.days_to_reuse + '일)' : '') : '';
    return item({ name: r['고객명'], scope: '첫 L3 ' + (r.first_L3_sites || '단지 미확인') + (r.reuse_site ? ' → 재사용 ' + r.reuse_site : ''), start: start, end: addDays(start, 60),
      phase: mature ? '기간 종료' : '관찰 중', result: mature ? route : '관찰 중 · ' + route + ' · 분모에 넣지 않음', detail: d, ok: mature ? hit : null, _mature: mature });
  }
  function analyze(id, rows){
    check(id, rows);
    var f = id === 'MK1' ? kpi1 : id === 'MK3' ? kpi2 : kpi3;
    var items = rows.map(f), den = 0, num = 0, obs = 0, exc = 0;
    items.forEach(function(x){ if(x._mature){ den++; if(x.ok) num++; } if(x.phase === '관찰 중') obs++; if(x.phase === '제외') exc++; delete x._mature; });
    return { id: id, total: items.length, den: den, num: num, observing: obs, excluded: exc, items: items };
  }
  function filterItems(items, f){
    return items.filter(function(x){
      return f === 'observing' ? x.phase === '관찰 중' : f === 'hit' ? x.phase === '기간 종료' && x.ok === true : f === 'miss' ? x.phase === '기간 종료' && x.ok === false : f === 'excluded' ? x.phase === '제외' : true;
    });
  }
  var api = { parseCsv: parseCsv, analyze: analyze, filterItems: filterItems, FILE: FILE };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiDetail = api;
})();
