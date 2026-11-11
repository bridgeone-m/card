/* §KPI 이어 쌓기 계산(2026-11) — 팀장님 정의(고객여정/기준.md)를 고객관리카드 요청 기록에 그대로 적용한다.
   순수 함수(DOM·저장 없음). 입력은 카드의 sheetRequests 미러 행과 업체 협약일뿐이고, 업체명은 다루지 않는다(id 만).
   규칙: 기회 = 같은 시공사·단지·공종. 첫 L2 후 0~30일 안 L3 또는 직접 L3 = 도달. 관찰이 안 끝난 건은 분모·분자에 넣지 않고 '관찰 중'으로만 센다.
   L2 = 기술자문문의, L3 = 컨설팅요청_통합·공법설명회이력(등록일 기준). 샘플·카탈로그·기타문의는 L3 가 아니다. 한국 달력일 기준. */
(function(){
  'use strict';
  var DAY = 86400000;
  function dn(s){ var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : NaN; }
  function addDays(s, n){ return new Date((dn(s) + n) * DAY).toISOString().slice(0, 10); }
  function diff(a, b){ return dn(b) - dn(a); }
  /* UTC 시각 문자열 → 한국(+9h) 달력일. 날짜만 있으면 그대로. */
  function kstDay(v){
    var s = String(v == null ? '' : v).trim(); if(!s) return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var t = Date.parse(s); if(isNaN(t)) return '';
    return new Date(t + 9 * 3600000).toISOString().slice(0, 10);
  }
  /* 기준선 키 규칙(원장 단지키·공종키와 1346행 대조로 확인): 유니코드 호환 정리(NFKC) + 소문자 + 공백 제거(+ 법인표기). 단어를 지우거나 별칭을 합치지 않는다. */
  function normSite(s){ return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\(주\)|\(유\)|\(합\)|주식회사/g, '').replace(/\s+/g, ''); }
  function normTrade(s){
    var t = String(s == null ? '' : s).normalize('NFKC').toLowerCase().split(/[+\/,·]/).map(function(x){ return x.replace(/\s+/g, ''); }).filter(Boolean).sort();
    return t.join('+');
  }
  function field(summary, names){
    var parts = String(summary || '').split(' · '), i, m;
    for(i = 0; i < parts.length; i++){ m = /^([^:]+):\s*(.*)$/.exec(parts[i]); if(m && names.indexOf(m[1].trim()) >= 0) return m[2].trim(); }
    return '';
  }
  /* 카드 요청 기록 → L2/L3 사건. 쓸 수 없는 행은 이유별로 센다(숨기지 않음). */
  function buildEvents(rows){
    var events = [], sk = { sample: 0, other: 0, noCompany: 0, noDate: 0, noSiteOrTrade: 0 };
    (rows || []).forEach(function(r){
      var sh = r && r.sourceSheet, kind = sh === '기술자문문의' ? 'L2' : (sh === '컨설팅요청_통합' || sh === '공법설명회이력') ? 'L3' : '';
      if(!kind){ if(sh === '샘플카달로그요청') sk.sample++; else sk.other++; return; }
      if(!r.companyId){ sk.noCompany++; return; }
      var date = kstDay(r.requestDate); if(!date){ sk.noDate++; return; }
      var site = normSite(r.siteName || field(r.summary, ['현장명'])), trade = normTrade(field(r.summary, ['공종', '공종별']));
      if(!site || !trade){ sk.noSiteOrTrade++; return; }
      events.push({ co: String(r.companyId), site: site, trade: trade, date: date, kind: kind, src: sh });
    });
    return { events: events, skipped: sk };
  }
  function upTo(events, asOf){ return events.filter(function(e){ return diff(e.date, asOf) >= 0; }); }

  /* 기회(시공사·단지·공종)별 진입일·도달. 직접 L3 = 같은 기회에 앞선 L2 가 없는 L3. */
  function opportunities(events){
    var map = {};
    events.forEach(function(e){ var k = e.co + '|' + e.site + '|' + e.trade; (map[k] = map[k] || { co: e.co, site: e.site, trade: e.trade, l2: [], l3: [] })[e.kind === 'L2' ? 'l2' : 'l3'].push(e.date); });
    return Object.keys(map).map(function(k){
      var o = map[k], l2 = o.l2.slice().sort()[0] || '', l3 = o.l3.slice().sort()[0] || '';
      var direct = !!l3 && (!l2 || l3 < l2), entry = direct ? l3 : l2, days = null, reached = false;
      if(direct){ reached = true; days = 0; }
      else if(l3s(o, entry) != null){ days = l3s(o, entry); reached = days <= 30; }
      return { co: o.co, site: o.site, trade: o.trade, entry: entry, direct: direct, reached: reached, days: days };
    });
  }
  function l3s(o, entry){ var best = null; o.l3.forEach(function(d){ var x = diff(entry, d); if(x >= 0 && (best == null || x < best)) best = x; }); return best; }

  /* KPI2 문의별 L3 도달 — 성숙: 진입+30일이 마감 전날까지(진입 ≤ 마감−31일), 다음 날 판정 */
  function kpi2(events, asOf){
    var ops = opportunities(upTo(events, asOf)), den = 0, num = 0, obs = 0, direct = 0, l3160 = 0, items = [];
    ops.forEach(function(o){
      var mature = diff(o.entry, asOf) >= 31;
      if(!mature){ obs++; items.push(o); return; }
      den++; if(o.reached) num++; if(o.direct) direct++;
      if(!o.reached && o.days != null && o.days > 30 && o.days <= 60) l3160++;
      o.mature = true; items.push(o);
    });
    return { num: num, den: den, observing: obs, direct: direct, late31to60: l3160, items: items };
  }
  /* KPI3 다른 단지 재사용 — 업체별 데이터상 첫 L3 후 1~60일 안 다른 단지의 새 L2 또는 직접 L3. 성숙: 첫 L3 ≤ 마감−61일 */
  function kpi3(events, asOf){
    var ev = upTo(events, asOf), byCo = {}, den = 0, num = 0, obs = 0, l61 = 0, l90 = 0, items = [];
    ev.forEach(function(e){ (byCo[e.co] = byCo[e.co] || []).push(e); });
    Object.keys(byCo).forEach(function(co){
      var list = byCo[co], l3 = list.filter(function(e){ return e.kind === 'L3'; }).map(function(e){ return e.date; }).sort()[0];
      if(!l3) return;
      var firstSites = {}; list.forEach(function(e){ if(e.kind === 'L3' && e.date === l3) firstSites[e.site] = 1; });
      if(diff(l3, asOf) < 61){ obs++; items.push({ co: co, first: l3, phase: 'observing' }); return; }
      var ops = opportunities(list).filter(function(o){ return !firstSites[o.site]; });
      var best = null;
      ops.forEach(function(o){ var d = diff(l3, o.entry); if(d >= 1 && (best == null || d < best)) best = d; });
      den++;
      var hit = best != null && best <= 60;
      if(hit) num++; else if(best != null && best <= 90) l61++; else if(best != null) l90++;
      items.push({ co: co, first: l3, phase: 'mature', reused: hit, days: best });
    });
    return { num: num, den: den, observing: obs, late61to90: l61, late90plus: l90, items: items };
  }
  /* KPI1 신규 협약 활용 — 협약 전 90일~후 89일(D−90~D+89)의 유효 L2/L3 1회 이상. 성숙: D+90 ≤ 마감. 협약일 불확실은 제외로 따로 센다. */
  function kpi1(companies, events, asOf){
    var den = 0, num = 0, obs = 0, unc = 0, items = [], ev = upTo(events, asOf), byCo = {};
    ev.forEach(function(e){ (byCo[e.co] = byCo[e.co] || []).push(e.date); });
    (companies || []).forEach(function(c){
      var mou = kstDay(c.mou);
      if(!mou){ unc++; items.push({ id: c.id, phase: 'unconfirmed' }); return; }
      if(diff(mou, asOf) < 90){ obs++; items.push({ id: c.id, phase: 'observing', mou: mou }); return; }
      var lo = addDays(mou, -90), hi = addDays(mou, 89), hit = (byCo[String(c.id)] || []).some(function(d){ return d >= lo && d <= hi; });
      den++; if(hit) num++; items.push({ id: c.id, phase: 'mature', mou: mou, hit: hit });
    });
    return { num: num, den: den, observing: obs, unconfirmed: unc, items: items };
  }
  /* 이어 쌓기 — 기준선(마감 cut) + 마감 이후 asOf 까지 새로 성숙한 건. KPI2 는 진입일 기준으로 기준선과 겹치지 않게 나눈다. */
  function chainKpi2(events, base, cut, asOf){
    var r = kpi2(events, asOf), addNum = 0, addDen = 0;
    r.items.forEach(function(o){ if(o.mature && diff(o.entry, cut) < 31){ addDen++; if(o.reached) addNum++; } });
    var num = base.num + addNum, den = base.den + addDen;
    return { base: base, added: { num: addNum, den: addDen }, total: { num: num, den: den, rate: den ? num / den * 100 : null }, observing: r.observing };
  }
  var api = { kstDay: kstDay, normSite: normSite, normTrade: normTrade, buildEvents: buildEvents, opportunities: opportunities, kpi1: kpi1, kpi2: kpi2, kpi3: kpi3, chainKpi2: chainKpi2, addDays: addDays };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiChain = api;
})();
