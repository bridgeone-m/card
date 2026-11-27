/* 담당자·연락처 공통 폼 — 「신규 고객 등록」과 「고객 정보 수정」이 함께 쓴다.

   저장 규칙(두 화면 동일)
   · 담당자 01(대표)      : repName, mobile, phone, email, fax + 대표 직급
   · 기존 담당자 칸        : contactName / position(그 담당자의 직급) / contactMobile / contactEmail
                             — contactName 이 대표자와 다른 이름일 때만 별도 카드로 보여 준다.
   · + 로 추가한 담당자    : extraContacts[{ name, position, mobile, email }]
   · 대표 직급 저장 칸     : 별도 담당자(contactName)가 있으면 repPosition, 없으면 position.
                             position 은 원래 contactName 의 직급이라, 다른 담당자의 직급을
                             대표 직급으로 덮거나 그 반대가 되지 않게 나눈다.
   · 담당자를 추가·수정해도 대표자 필드는 건드리지 않는다. 자동 승격도 없다.
   · 수정 화면은 changedFields() 로 실제 바뀐 필드만 저장한다. */
(function(root){
  'use strict';
  var POSITIONS = ['대표','이사','전무','경리'];
  var MAIN_FIELDS = ['repName','mobile','phone','email','fax'];

  function str(v){ return String(v == null ? '' : v).trim(); }

  // 대표자와 다른 이름의 담당자가 저장돼 있는가
  function hasSeparateContact(co){
    var name = str(co && co.contactName);
    return !!name && name !== str(co && co.repName);
  }

  // 저장된 업체 → 폼에 보여 줄 값
  function toModel(co){
    co = co || {};
    var separate = hasSeparateContact(co);
    var main = { rank: str(separate ? co.repPosition : (co.repPosition || co.position)) };
    MAIN_FIELDS.forEach(function(k){ main[k] = str(co[k]); });
    var primary = separate ? {
      name: str(co.contactName), position: str(co.position),
      mobile: str(co.contactMobile), email: str(co.contactEmail)
    } : null;
    var extras = (Array.isArray(co.extraContacts) ? co.extraContacts : []).filter(Boolean)
      .map(function(c){ return Object.assign({}, c); });
    return { main: main, primary: primary, extras: extras };
  }

  function isBlank(c){ return !str(c.name) && !str(c.position) && !str(c.mobile) && !str(c.email); }

  // 폼 값 → 저장할 필드. co 는 폼을 열 때의 업체(신규는 {}).
  function toFields(model, co){
    co = co || {};
    var out = {};
    MAIN_FIELDS.forEach(function(k){ out[k] = str(model.main[k]); });
    var rank = str(model.main.rank);
    var p = model.primary && !isBlank(model.primary) ? model.primary : null;
    // 담당자 칸의 이름이 대표자와 같아도 직급 칸은 서로 섞지 않는다.
    if(p){
      out.contactName = str(p.name);
      out.position = str(p.position);
      out.contactMobile = str(p.mobile);
      out.contactEmail = str(p.email);
      out.repPosition = rank;
    }else{
      out.position = rank;
      out.repPosition = '';
      if(hasSeparateContact(co) || model.primaryRemoved){
        out.contactName = ''; out.contactMobile = ''; out.contactEmail = '';
      }
    }
    out.extraContacts = (model.extras || []).filter(function(c){ return !isBlank(c); }).map(function(c){
      return Object.assign({}, c, { name: str(c.name), position: str(c.position), mobile: str(c.mobile), email: str(c.email) });
    });
    return out;
  }

  // 이름 없이 직급·연락처만 있는 담당자 칸은 대표 직급과 섞일 수 있어 막는다.
  function validate(model){
    var p = model.primary;
    if(p && !isBlank(p) && !str(p.name)) return '담당자 이름을 입력하세요.';
    return '';
  }

  // 폼을 연 직후 값(before)과 저장 시 값(after)을 비교해 바뀐 필드만 돌려준다.
  function changedFields(before, after){
    var out = {};
    Object.keys(after).forEach(function(k){
      if(JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = after[k];
    });
    return out;
  }

  // 화면 표시용 — 대표자 외 담당자 목록
  function others(co){
    var m = toModel(co);
    return (m.primary ? [m.primary] : []).concat(m.extras);
  }
  function describe(c){
    return [[str(c.name), str(c.position)].filter(Boolean).join(' '), str(c.mobile), str(c.email)].filter(Boolean).join(' · ');
  }
  function repRank(co){ return toModel(co).main.rank; }

  /* ---------------- 화면 ---------------- */
  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }
  function field(label, id, key, value, type){
    return '<div class="coc-field"><label' + (id ? ' for="' + id + '"' : '') + '>' + label + '</label>' +
      '<input type="' + (type || 'text') + '"' + (id ? ' id="' + id + '"' : ' aria-label="' + label + '"') +
      ' data-coc="' + key + '" value="' + esc(value) + '" autocomplete="off" /></div>';
  }
  function select(label, id, key, value){
    var list = POSITIONS.slice();
    if(value && list.indexOf(value) < 0) list.push(value);   // 기존·명함 직급은 그대로 보존
    return '<div class="coc-field"><label' + (id ? ' for="' + id + '"' : '') + '>' + label + '</label>' +
      '<select' + (id ? ' id="' + id + '"' : ' aria-label="' + label + '"') + ' data-coc="' + key + '">' +
      '<option value="">선택</option>' +
      list.map(function(o){ return '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
      '</select></div>';
  }
  var TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

  function mount(host, co, prefix){
    var model = toModel(co);
    var id = function(k){ return prefix + k; };
    var m = model.main;
    host.classList.add('coc');
    host.innerHTML =
      '<section class="coc-card is-main" data-coc-card="main">' +
        '<div class="coc-head"><span class="coc-title"></span><span class="coc-badge">대표</span></div>' +
        '<div class="coc-grid">' +
          field('대표자', id('repName'), 'repName', m.repName) + select('직급', id('repRank'), 'rank', m.rank) +
          field('휴대전화', id('mobile'), 'mobile', m.mobile, 'tel') + field('회사전화', id('phone'), 'phone', m.phone, 'tel') +
          field('이메일', id('email'), 'email', m.email) + field('팩스번호', id('fax'), 'fax', m.fax, 'tel') +
        '</div>' +
      '</section>' +
      '<div class="coc-list"></div>' +
      '<button type="button" class="coc-add"><span aria-hidden="true">+</span> 다른 담당자 추가</button>';
    var list = host.querySelector('.coc-list');
    var primaryRemoved = false;

    function renumber(){
      Array.prototype.forEach.call(host.querySelectorAll('.coc-card'), function(card, i){
        var label = '담당자 ' + (i < 9 ? '0' : '') + (i + 1);
        card.querySelector('.coc-title').textContent = label;
        var del = card.querySelector('.coc-del');
        if(del){ del.setAttribute('aria-label', label + ' 삭제'); del.title = '삭제'; }
      });
    }
    // kind: 'primary'(기존 contactName 칸) | 'extra'
    function addCard(kind, data){
      var card = document.createElement('section');
      card.className = 'coc-card';
      card.setAttribute('data-coc-card', kind);
      card._cocSource = data || {};            // 알 수 없는 속성도 저장 때 그대로 남긴다
      var d = data || {};
      var pid = kind === 'primary' ? { name: id('contactName'), position: id('contactPosition'), mobile: id('contactMobile'), email: id('contactEmail') } : {};
      card.innerHTML =
        '<div class="coc-head"><span class="coc-title"></span><button type="button" class="coc-del">' + TRASH + '</button></div>' +
        '<div class="coc-grid">' +
          field('이름', pid.name, 'name', str(d.name)) + select('직급', pid.position, 'position', str(d.position)) +
          field('휴대전화', pid.mobile, 'mobile', str(d.mobile), 'tel') + field('이메일', pid.email, 'email', str(d.email)) +
        '</div>';
      card.querySelector('.coc-del').addEventListener('click', function(){
        if(kind === 'primary') primaryRemoved = true;
        card.remove(); renumber();
      });
      if(kind === 'primary') list.insertBefore(card, list.firstChild); else list.appendChild(card);
      renumber();
      return card;
    }
    if(model.primary) addCard('primary', model.primary);
    model.extras.forEach(function(c){ addCard('extra', c); });
    renumber();
    host.querySelector('.coc-add').addEventListener('click', function(){
      addCard('extra').querySelector('input').focus();
    });

    function val(card, key){ var el = card.querySelector('[data-coc="' + key + '"]'); return el ? el.value : ''; }
    function readCard(card){
      return Object.assign({}, card._cocSource, { name: val(card,'name'), position: val(card,'position'), mobile: val(card,'mobile'), email: val(card,'email') });
    }
    function readModel(){
      var mainCard = list.parentNode.querySelector('[data-coc-card="main"]');
      var main = { rank: val(mainCard, 'rank') };
      MAIN_FIELDS.forEach(function(k){ main[k] = val(mainCard, k); });
      var p = list.querySelector('[data-coc-card="primary"]');
      return {
        main: main,
        primary: p ? readCard(p) : null,
        primaryRemoved: primaryRemoved,
        extras: Array.prototype.map.call(list.querySelectorAll('[data-coc-card="extra"]'), readCard)
      };
    }
    return {
      // 명함 인식에서 대표가 아닌 사람이 나왔을 때 쓰는 담당자 칸(없으면 만든다)
      ensurePrimary: function(){ if(!list.querySelector('[data-coc-card="primary"]')) addCard('primary'); },
      readModel: readModel,
      read: function(){ return toFields(readModel(), co); },
      validate: function(){ return validate(readModel()); }
    };
  }

  var api = { POSITIONS: POSITIONS, toModel: toModel, toFields: toFields, validate: validate,
    changedFields: changedFields, others: others, describe: describe, repRank: repRank, mount: mount };
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
  if(root) root.CompanyContacts = api;
})(typeof window !== 'undefined' ? window : null);
