/* §신한솔 개인 KPI 자동 실측(2026-11-16 사용자 「자동으로」) — LI02·LI03·LI04 를 카드 기록으로 바로 계산한다.
   B2B KPI 탭(이번 달 화면)과 업무트래커 자동 집계 서버(Apps Script)가 같은 파일을 쓴다(ES5, 화면·저장 없음, 읽기만).
   기준은 2026-11-16 업무트래커에 저장한 정의 그대로:
     LI02 미회신 재안내  : 질문서 발송 후 7일 안 회신이 없던 업체 중, 발송 후 14일 안에 재발송 메일 또는 연락 활동 기록이 있는 업체 비율.
                          대상 월 = 발송 + 7일이 된 달. 14일이 아직 안 지났고 재안내도 없으면 판정 보류.
     LI03 신규 첫 조치   : 카드 일괄 등록(2026-08-26) 뒤 등록한 업체(시험 업체 제외) 중 등록 후 3일 안에 첫 조치
                          (메일 발송·진행 단계 등록·직접 남긴 활동 기록)가 있는 업체 비율. 대상 월 = 등록 월. 3일이 안 지났고 조치도 없으면 보류.
     LI04 핵심정보 완비  : MOU 체결사(협약 종료·삭제 제외) 중 대표자·연락처(휴대폰 또는 회사)·이메일·주소·사업자번호를 모두 갖춘 비율(지금 상태).
   입력: companies(카드 업체 배열), actsOf(id) → 그 업체 활동 기록 배열, ctx = { replyTs(co), mouDone(co), now, bulkEnd } */
(function(){
  'use strict';
  var DAY = 86400000;
  var BULK_END_DEFAULT = 1787670000000;   // 2026-08-26 00:00(한국) — 카드 MEETING_CARD_BULK_END 와 같은 값
  function ts(v){ if(v == null || v === '') return null; if(typeof v === 'number') return v; var t = Date.parse(v); return isNaN(t) ? null : t; }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function monthOf(t){ var d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function isTest(co){ return /테스트|test/i.test(String(co && co.name || '')); }
  function active(co){ return co && !co.deletedAt && co.agreementStatus !== 'terminated'; }
  function has(v){ return v != null && String(v).trim() !== '' && String(v).trim() !== '-'; }
  function add(m, key, ok){ if(!m[key]) m[key] = { num: 0, den: 0 }; m[key].den++; if(ok) m[key].num++; }
  function total(m){ var o = { num: 0, den: 0 }; Object.keys(m).forEach(function(k){ o.num += m[k].num; o.den += m[k].den; }); return o; }

  // LI03 — 신규 등록 후 3일 안 첫 조치
  function firstAction(companies, actsOf, ctx){
    var now = ctx.now, bulkEnd = ctx.bulkEnd != null ? ctx.bulkEnd : BULK_END_DEFAULT, months = {}, rows = [];
    (companies || []).forEach(function(co){
      if(!active(co) || isTest(co)) return;
      var t0 = ts(co.createdAt); if(t0 == null || t0 < bulkEnd) return;
      var hits = [];
      (co.m1MailLog || []).forEach(function(l){ if(l && l.status === 'sent'){ var t = ts(l.sentAt); if(t != null) hits.push(t); } });
      var sc = (co.partnerDashboard && co.partnerDashboard.stageCorrections) || {};
      Object.keys(sc).forEach(function(k){ var t = ts(sc[k] && sc[k].correctedAt); if(t != null) hits.push(t); });
      (actsOf(co.id) || []).forEach(function(a){ if(!a || a.source === 'google-sheets-request' || a.source === 'partner-dashboard') return; var t = ts(a.createdAt); if(t != null) hits.push(t); });
      var first = hits.filter(function(t){ return t >= t0; }).sort(function(a, b){ return a - b; })[0];
      var due = t0 + 3 * DAY, ok = first != null && first < due + DAY;
      if(!ok && now < due + DAY) return;   // 기한 전 — 아직 판정하지 않는다
      add(months, monthOf(t0), ok);
      rows.push({ id: String(co.id), name: co.name || '', month: monthOf(t0), ok: ok });
    });
    return { months: months, total: total(months), rows: rows };
  }

  // LI02 — 질문서 7일 미회신 → 14일 안 재안내
  var RECONTACT_RE = /재안내|재발송|리마인드|전화|연락|통화|회신 요청|질문서/;
  function reContact(companies, actsOf, ctx){
    var now = ctx.now, months = {}, rows = [];
    (companies || []).forEach(function(co){
      if(!active(co) || isTest(co)) return;
      var sends = (co.m1MailLog || []).filter(function(l){ return l && l.mailType === 'questionnaire' && l.status === 'sent'; })
        .map(function(l){ return ts(l.sentAt); }).filter(function(t){ return t != null; }).sort(function(a, b){ return a - b; });
      if(!sends.length) return;
      var s0 = sends[0], due7 = s0 + 7 * DAY, end = s0 + 14 * DAY;
      if(now < due7 + DAY) return;                              // 7일 아직 안 지남
      var reply = ctx.replyTs ? ctx.replyTs(co) : null;
      if(reply != null && reply < due7 + DAY) return;           // 7일 안 회신 — 대상 아님
      var re = sends.slice(1).some(function(t){ return t < end + DAY; }) ||
        (actsOf(co.id) || []).some(function(a){ var t = ts(a && a.createdAt), tx = String((a && (a.activityText || a.originalText)) || '');
          return t != null && t > s0 + DAY && t < end + DAY && RECONTACT_RE.test(tx) && !/질문서 발송 완료/.test(tx); });
      if(!re && now < end + DAY) return;                        // 재안내 기한 전
      add(months, monthOf(due7), re);
      rows.push({ id: String(co.id), name: co.name || '', month: monthOf(due7), ok: re, replied: reply != null });
    });
    return { months: months, total: total(months), rows: rows };
  }

  // LI04 — MOU 체결사 핵심 5항목 완비(지금 상태)
  function infoComplete(companies, ctx){
    var num = 0, den = 0, missing = [];
    (companies || []).forEach(function(co){
      if(!active(co) || !ctx.mouDone(co)) return;
      den++;
      if(has(co.repName) && (has(co.mobile) || has(co.phone)) && has(co.email) && has(co.address) && has(co.bizRegNo)) num++;
      else missing.push(co.name || '');
    });
    return { num: num, den: den, missing: missing };
  }

  var api = { firstAction: firstAction, reContact: reContact, infoComplete: infoComplete, monthOf: monthOf, BULK_END: BULK_END_DEFAULT };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(typeof window !== 'undefined') window.B2BKpiPersonal = api;
})();
