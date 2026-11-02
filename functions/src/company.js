'use strict';
// 고객관리카드 업체 레코드 → 계약서 입력값. 카드 화면(renderCompanySummaryCard)과 같은 순서로
// 공식 필드를 먼저 읽고, 비어 있을 때만 partnerDashboard 보조값을 쓴다.
// 없거나 모호하면 값을 만들지 않고 issue 로 돌려준다. 업체 레코드는 읽기만 한다.

const COMPANIES_DOC_KEY = 'shin2-companies-staging';

const clean = (v) => String(v == null ? '' : v).replace(/[ \s]+/g, ' ').trim();
const digits = (v) => String(v == null ? '' : v).replace(/\D/g, '');

function validBizNo(num) {
  if (!/^\d{10}$/.test(num)) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(num[i]) * weights[i];
  sum += Math.floor((Number(num[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(num[9]);
}
const formatBizNo = (num) => `${num.slice(0, 3)}-${num.slice(3, 5)}-${num.slice(5)}`;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
const validEmail = (v) => EMAIL_RE.test(String(v || '').trim());
const splitEmails = (v) => clean(v).split(/[\s,;/]+/).filter(Boolean);

function issue(field, kind, message) { return { field, kind, message }; }

// 공식 값과 보조 값이 함께 있고 서로 다르면 어느 쪽이 맞는지 알 수 없다.
function pick(official, fallback, same) {
  const a = clean(official), b = clean(fallback);
  if (a && b && !same(a, b)) return { value: '', conflict: [a, b] };
  return { value: a || b, conflict: null };
}

function evaluateCompany(companies, companyId, expectedCode) {
  const list = Array.isArray(companies) ? companies : [];
  const co = list.find((c) => c && String(c.id) === String(companyId));
  if (!co) return { company: null, issues: [issue('company', 'missing', '업체를 찾을 수 없습니다. 새로고침 후 다시 확인해주세요.')], emailCandidates: [] };

  const issues = [];
  const pd = co.partnerDashboard || {};
  const active = list.filter((c) => c && !c.deletedAt && !c.permanentDeletePending && c !== co);

  if (co.deletedAt || co.permanentDeletePending) issues.push(issue('company', 'invalid', '삭제된 업체에는 계약서를 준비할 수 없습니다.'));
  if (co.agreementStatus === 'terminated') issues.push(issue('company', 'invalid', '협약 종료된 업체입니다. 업체 상태를 먼저 확인해주세요.'));

  const name = clean(co.name);
  if (!name) issues.push(issue('name', 'missing', '업체명이 없습니다.'));

  const code = clean(co.code);
  if (!/^B2B\d{3,}$/.test(code)) issues.push(issue('code', 'missing', 'B2B 전용번호가 없습니다. 번호를 발급한 뒤 다시 준비해주세요.'));
  else if (active.some((c) => clean(c.code) === code)) issues.push(issue('code', 'ambiguous', `B2B 전용번호 ${code}를 쓰는 업체가 둘 이상입니다.`));
  if (expectedCode && clean(expectedCode) !== code) issues.push(issue('code', 'ambiguous', '화면의 B2B 전용번호와 저장된 번호가 다릅니다. 새로고침 후 다시 확인해주세요.'));

  const biz = pick(co.bizRegNo, pd.bizno, (a, b) => digits(a) === digits(b));
  let bizNo = '';
  if (biz.conflict) issues.push(issue('bizNo', 'ambiguous', `사업자등록번호가 두 가지로 저장돼 있습니다: ${biz.conflict.join(' / ')}`));
  else if (!biz.value) issues.push(issue('bizNo', 'missing', '사업자등록번호가 없습니다.'));
  else if (!validBizNo(digits(biz.value))) issues.push(issue('bizNo', 'invalid', `사업자등록번호 형식이 올바르지 않습니다: ${biz.value}`));
  else {
    bizNo = formatBizNo(digits(biz.value));
    if (active.some((c) => digits(c.bizRegNo) === digits(bizNo))) issues.push(issue('bizNo', 'ambiguous', '같은 사업자등록번호를 쓰는 업체가 둘 이상입니다.'));
  }

  const rep = pick(co.repName, pd.ceo, (a, b) => a.replace(/\s/g, '') === b.replace(/\s/g, ''));
  let representative = '';
  if (rep.conflict) issues.push(issue('representative', 'ambiguous', `대표자가 두 가지로 저장돼 있습니다: ${rep.conflict.join(' / ')}`));
  else if (!rep.value) issues.push(issue('representative', 'missing', '대표자가 없습니다.'));
  else if (/[,/·&]|\s외\s*\d*|공동|각자/.test(rep.value)) issues.push(issue('representative', 'ambiguous', `대표자가 여러 명으로 보입니다: ${rep.value}`));
  else if (rep.value.length < 2 || rep.value.length > 30) issues.push(issue('representative', 'invalid', '대표자명은 2~30자여야 합니다.'));
  else representative = rep.value;

  const address = clean(co.address);
  if (!address) issues.push(issue('address', 'missing', '주소가 없습니다.'));
  else if (address.length < 8 || !/\d/.test(address)) issues.push(issue('address', 'ambiguous', `주소가 불완전해 보입니다(번지 없음): ${address}`));

  const emailCandidates = Array.from(new Set([...splitEmails(co.email), ...splitEmails(pd.email)]));
  const validCandidates = emailCandidates.filter(validEmail);
  let email = '';
  if (!emailCandidates.length) issues.push(issue('email', 'missing', '수신자 이메일이 없습니다. 아래 칸에 직접 입력해주세요.'));
  else if (validCandidates.length === 1 && emailCandidates.length === 1) email = validCandidates[0];
  else if (!validCandidates.length) issues.push(issue('email', 'invalid', `이메일 형식이 올바르지 않습니다: ${emailCandidates.join(', ')}`));
  else issues.push(issue('email', 'ambiguous', `이메일이 여러 개입니다. 수신자를 골라주세요: ${emailCandidates.join(', ')}`));

  return {
    company: { id: String(co.id), code, name, bizNo, representative, address, email },
    issues,
    emailCandidates: validCandidates,
  };
}

// 수신자 이메일은 화면에서 고칠 수 있으므로, 이메일 문제는 입력값이 유효하면 해소된다.
function blockingIssues(evaluation, recipientEmail) {
  return evaluation.issues.filter((i) => !(i.field === 'email' && validEmail(recipientEmail)));
}

module.exports = { COMPANIES_DOC_KEY, evaluateCompany, blockingIssues, validEmail, validBizNo, clean };
