// B2B KPI 탭 시험용 가짜 업무트래커 데이터(실제 이름·수치 아님 — 설계 12장 계산 예시와 같은 숫자 구성만 재현)
function base(){
  const leadDefs = {};
  for(let i = 1; i <= 9; i++){
    const id = 'LI0' + i;
    leadDefs[id] = { id, no: String(i), name: '시험 선행 ' + i, member: 'shs', owner: '시험A', tasks: ['업무1', '업무2', '업무3', '업무4'], target: i === 1 ? 100 : undefined };
  }
  const manage = n => Array.from({ length: 5 }, (_, i) => n + ' 관리 ' + (i + 1));
  return {
    members: {
      shs: { id: 'shs', name: '시험A', role: '매니저' },
      m2: { id: 'm2', name: '시험B', role: '팀장' },
      m1: { id: 'm1', name: '시험C', role: '매니저' }
    },
    mainKpis: {
      MK1: { id: 'MK1', no: '①', name: '신규업체 첫 서비스 이용률', manage: manage('K1'), links: [{ li: 'LI01', rel: 'core' }, { li: 'LI03', rel: 'core' }] },
      MK2: { id: 'MK2', no: '②', name: '첫 이용 후 60일 내 다른 현장 재이용률', manage: manage('K2'), links: [{ li: 'LI07', rel: 'core' }] },
      MK3: { id: 'MK3', no: '③', name: '현장·공종·시공사별 서비스 이용률', manage: manage('K3'), links: [{ li: 'LI02', rel: 'core' }] }
    },
    leadDefs,
    lagDefs: { LG1: { id: 'LG1', no: '①', name: '시험 후행 1', member: 'shs' } },
    perfAuto: {
      'MK1_2026-11': { ref: 'MK1', month: '2026-11', mode: 'auto', num: 3, den: 17 },
      'MK2_2026-11': { ref: 'MK2', month: '2026-11', mode: 'auto', num: 10, den: 16 },
      'MK3_2026-11': { ref: 'MK3', month: '2026-11', mode: 'auto', num: 19, den: 1014 },
      'LI01_2026-11': { ref: 'LI01', month: '2026-11', mode: 'auto', num: 5, den: 6 },
      'LI01_2026-10': { ref: 'LI01', month: '2026-10', mode: 'auto', num: 7, den: 8 }
    },
    perfMonthly: {
      'MK1_2026-11': { ref: 'MK1', month: '2026-11', mode: 'auto', num: 9, den: 10 }
    },
    perfHistory: {},
    projects: { p1: { id: 'p1', name: '시험 프로젝트', owner: 'm1' } },
    programs: { g1: { id: 'g1', owner: 'jjy' } }
  };
}
module.exports = { base, clone: o => JSON.parse(JSON.stringify(o)) };
