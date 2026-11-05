// B2B KPI 탭 화면(b2b-kpi-tab.js)·index.html 연결 — 관리자 전용, 실제 KPI 실적과 업무 관리점수 분리 표시
const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const css = fs.readFileSync(__dirname + '/b2b-kpi-tab.css', 'utf8');
const tabSrc = fs.readFileSync(__dirname + '/b2b-kpi-tab.js', 'utf8');
const load = f => { const c = { module: { exports: {} } }; vm.runInNewContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), c); return c.module.exports; };
const C = load('b2b-kpi-calc.js'), T = load('b2b-kpi-tab.js');
const F = require('./b2b-kpi.fixture.cjs');

test('index_wiring', () => {
  assert.ok(html.includes('<link rel="stylesheet" href="b2b-kpi-tab.css">'));
  const ce = html.indexOf('<script src="contract-esign.js"></script>');
  const a = html.indexOf('<script src="b2b-kpi-calc.js"></script>'), b = html.indexOf('<script src="b2b-kpi-store.js"></script>'), c = html.indexOf('<script src="b2b-kpi-tab.js"></script>');
  assert.ok(ce > 0 && ce < a && a < b && b < c, 'script order');
  assert.ok(html.includes('body:not(.crm-admin-mode) #crmTabB2bKpi, body:not(.crm-admin-mode) #gnavDrawerTabB2bKpi, body:not(.crm-admin-mode) #b2bKpiView{ display:none !important; }'));
  assert.ok(html.includes('if(window.B2BKpiTab) window.B2BKpiTab.close();'));
});
test('syntax', () => { ['b2b-kpi-calc.js', 'b2b-kpi-store.js', 'b2b-kpi-tab.js'].forEach(f => new vm.Script(fs.readFileSync(__dirname + '/' + f, 'utf8'))); });
test('admin_gate', () => {
  const i = tabSrc.indexOf('function open(');
  assert.ok(i > 0); assert.ok(tabSrc.slice(i, i + 300).includes("crmAdminOk('B2B KPI')"));
});
test('renderHtml_error', () => {
  const h = T.renderHtml(null, { state: 'error', error: 'x', month: '2026-11' });
  assert.ok(h.includes('업무트래커에 연결하지 못했습니다')); assert.ok(h.includes('다시 시도'));
});
test('renderHtml_loading', () => {
  assert.ok(T.renderHtml(null, { state: 'loading', month: '2026-11' }).includes('불러오는 중'));
});
test('css_fixed_view', () => { assert.ok(/\.b2bkpi-view\{[^}]*position:fixed/.test(css.replace(/\s+/g, ''))); });
