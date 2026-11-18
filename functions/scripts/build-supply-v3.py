#!/usr/bin/env python3
"""새 기본물품공급계약서(여신 보완본 + 별지 「물품대금 결제조건 확인서」 통합, 2026-11-18 사용자 제공)
→ 등록용 양식과 입력 위치 지도(운영자 PC, 결과물은 Git에 넣지 않는다).

- 양식은 사용자가 준 PDF를 바이트 그대로 쓴다(1~8쪽 계약 조항 레터, 9쪽 결제조건 확인서·10쪽 서명 쪽 A4).
- 시공사 정보(노란 표시 자리): 1쪽 첫 문단 빈칸 상호, 10쪽 (을) 상호·사업자등록번호·주소·대표자, 계약일(20□□년 □월 □일).
- 9쪽 결제조건 A(보증보험)·B(선납) 네모 칸: 시공사가 모두사인에서 둘 중 하나를 직접 체크(체크 그룹 최소 1·최대 1).
- 10쪽: (갑) (인) 자리에 우리 도장 이미지, (을) (인) 자리에 시공사 모두사인 서명·도장 칸.
위치는 PDF 글자·선에서 재고, 찾지 못하면 멈춘다.

사용: py -3 build-supply-v3.py <통합본.pdf> <outdir>
"""
import hashlib
import json
import re
import shutil
import sys

import fitz

src, outdir = sys.argv[1:3]
sys.stdout.reconfigure(encoding='utf-8')
pdf = fitz.open(src)
if pdf.page_count < 3:
    sys.exit(f'쪽 수가 너무 적습니다: {pdf.page_count}')
if pdf.get_sigflags() > 0 or any(len(list(p.widgets() or [])) for p in pdf):
    sys.exit('양식에 서명·입력 폼이 있어 멈춥니다.')
if any(len(list(p.annots() or [])) for p in pdf):
    sys.exit('양식에 메모·강조(주석)가 남아 있습니다. 표시 없는 원본을 주세요.')


def r2(v):
    return round(v, 2)


def one(cands, what):
    if len(cands) != 1:
        sys.exit(f'{what} 위치를 하나로 찾지 못했습니다({len(cands)}개).')
    return cands[0]


def words(page):
    return page.get_text('words')


# ---- 1쪽 첫 문단 빈칸: 「한다)와」 와 「(이하 "을"이라」 사이
p1 = pdf[0]
w1 = words(p1)
wa = one([w for w in w1 if w[4] == '한다)와'], '1쪽 「한다)와」')
ie = one([w for w in w1 if w[4] == '(이하' and abs(w[1] - wa[1]) < 3], '1쪽 「(이하」')
blank = dict(x=r2(wa[2] + 2), y=r2(wa[1] - 0.5), w=r2(ie[0] - wa[2] - 4), h=r2(wa[3] - wa[1] + 1))
if blank['w'] < 80:
    sys.exit(f'1쪽 빈칸이 너무 좁습니다: {blank}')

# ---- 결제조건 확인서 쪽: 「결제조건 확인서」 제목이 있는 쪽. 네모 칸(A·B)은 그린 정사각형 또는 「☐」 글자.
def page_text(page):
    return page.get_text().replace(' ', '')


conf_pages = [i for i, pg in enumerate(pdf) if '결제조건확인서' in page_text(pg) and 'A.보증보험' in page_text(pg) and 'B.선납' in page_text(pg)]
p9 = pdf[one(conf_pages, '결제조건 확인서 쪽')]
CONF_NO = p9.number + 1


def glyph_square(rect):
    # 「☐」 글자 상자(줄 높이 포함) 안에서 실제로 그려진 테두리만 픽셀로 잰다.
    zoom = 4
    pix = p9.get_pixmap(clip=rect, matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csRGB, alpha=False)
    dark = [[sum(pix.pixel(x, y)) < 450 for x in range(pix.width)] for y in range(pix.height)]
    # 표 테두리 같은 가는 선·점은 빼고, 네모의 변(긴 직선)만 남긴다: 어두운 점이 줄의 1/3 이상인 행·열.
    xs = [x for x in range(pix.width) if sum(dark[y][x] for y in range(pix.height)) > pix.height / 3]
    if not xs:
        sys.exit('「☐」 글자 테두리를 찾지 못했습니다.')
    x0, x1 = min(xs), max(xs)
    # 위·아래 변: 네모 가로 폭 안에서 절반 이상 어둡고, 네모 밖(좌우)으로는 이어지지 않는 행(표 가로선 제외).
    ys = [y for y in range(pix.height)
          if sum(dark[y][x0:x1 + 1]) > (x1 - x0) / 2 and sum(dark[y][:max(0, x0 - 3)]) + sum(dark[y][x1 + 4:]) < 3]
    if not ys:
        sys.exit('「☐」 글자 테두리를 찾지 못했습니다.')
    return fitz.Rect(rect.x0 + x0 / zoom, rect.y0 + min(ys) / zoom, rect.x0 + (x1 + 1) / zoom, rect.y0 + (max(ys) + 1) / zoom)


squares = sorted([d['rect'] for d in p9.get_drawings()
                  if d.get('color') and not d.get('fill') and (d.get('width') or 0) > 1.5
                  and 14 < d['rect'].width < 20 and abs(d['rect'].width - d['rect'].height) < 0.5], key=lambda r: r.y0)
if not squares:
    boxes = [fitz.Rect(c['bbox']) for b in p9.get_text('rawdict')['blocks'] for l in b.get('lines', [])
             for sp in l['spans'] for c in sp['chars'] if c['c'] == '\u2610']
    squares = sorted([glyph_square(r) for r in boxes], key=lambda r: r.y0)
if len(squares) != 2:
    sys.exit(f'{CONF_NO}쪽 네모 칸이 2개가 아닙니다: {len(squares)}')
for sq in squares:
    if not (10 < sq.width < 45 and abs(sq.width - sq.height) < 2):
        sys.exit(f'{CONF_NO}쪽 네모 칸 모양이 이상합니다: {sq}')
w9 = words(p9)
labels = []
for sq, letter, name in zip(squares, ['A.', 'B.'], ['보증보험', '선납']):
    cy = (sq.y0 + sq.y1) / 2
    same_row = lambda w: abs((w[1] + w[3]) / 2 - cy) < 12 and 0 < w[0] - sq.x1 < 60
    one([w for w in w9 if w[4] == letter and same_row(w)], f'{CONF_NO}쪽 {letter} 글자')
    one([w for w in w9 if w[4] == name and abs((w[1] + w[3]) / 2 - cy) < 12], f'{CONF_NO}쪽 {name} 글자')
    labels.append((sq, letter[0], name))

# ---- 서명 쪽: 마지막 쪽
p10 = pdf[-1]
SIGN_NO = p10.number + 1
lines = []
for b in p10.get_text('dict')['blocks']:
    for l in b.get('lines', []):
        t = ''.join(s['text'] for s in l['spans']).strip()
        if t:
            lines.append((fitz.Rect(l['bbox']), t))
gab = one([r for r, t in lines if t.replace(' ', '') == '(갑)'], '서명 쪽 (갑)')
eul = one([r for r, t in lines if t.replace(' ', '') == '(을)'], '서명 쪽 (을)')
colons = {}
for key, label in [('name', '상호'), ('bizNo', '사업자등록번호'), ('address', '주소'), ('representative', '대표자')]:
    lab = one([r for r, t in lines if t.replace(' ', '') == label and r.y0 > eul.y1], f'서명 쪽 (을) {label}')
    colons[key] = one([r for r, t in lines if t == ':' and abs(r.y0 - lab.y0) < 3], f'서명 쪽 (을) {label} 쌍점')
ins = sorted([r for r, t in lines if t == '(인)'], key=lambda r: r.y0)
if len(ins) != 2:
    sys.exit(f'서명 쪽 (인)이 2개가 아닙니다: {len(ins)}')
gab_in, eul_in = ins
if not (gab.y0 < gab_in.y0 < eul.y0 < eul_in.y0):
    sys.exit('서명 쪽 (갑)·(을) (인) 순서가 예상과 다릅니다.')
# (갑) 상호 값이 시작하는 x 를 (을) 값 시작 위치로 쓴다(양식마다 쌍점과 값 사이 간격이 다름).
gab_name_lab = one([r for r, t in lines if t.replace(' ', '') == '상호' and gab.y1 < r.y0 < eul.y0], '서명 쪽 (갑) 상호')
gab_value = one([r for r, t in lines if r.x0 > gab_name_lab.x1 + 20 and abs(r.y0 - gab_name_lab.y0) < 3 and t != ':'], '서명 쪽 (갑) 상호 값')
date_line = one([r for r, t in lines if re.match(r'^20\s+년\s+월\s+일$', t.replace('\xa0', ' '))], '서명 쪽 날짜 줄')
dchars = [(c['c'], fitz.Rect(c['bbox'])) for b in p10.get_text('rawdict')['blocks'] for l in b.get('lines', [])
          if abs(l['bbox'][1] - date_line.y0) < 2 for sp in l['spans'] for c in sp['chars'] if c['c'].strip() and c['c'] != '\xa0']
digits = [r for ch, r in dchars if ch.isdigit()]
if len(digits) != 2:
    sys.exit(f'날짜 줄 「20」을 찾지 못했습니다: {[ch for ch, _ in dchars]}')
twenty = fitz.Rect(digits[0].x0, digits[0].y0, digits[1].x1, digits[1].y1)
nen = one([r for ch, r in dchars if ch == '년'], '날짜 「년」')
wol = one([r for ch, r in dchars if ch == '월'], '날짜 「월」')
il = one([r for ch, r in dchars if ch == '일'], '날짜 「일」')
date_size = round(next(sp['size'] for b in p10.get_text('dict')['blocks'] for l in b.get('lines', [])
                       if abs(l['bbox'][1] - date_line.y0) < 2 for sp in l['spans'] if sp['text'].strip()), 1)

W10 = p10.rect.width
value_x = gab_value.x0
right = W10 - 46
dh = date_line.height


def row(key, **kw):
    c = colons[key]
    return dict(page=SIGN_NO, x=r2(value_x), y=r2(c.y0 - 1), h=r2(c.height + 2), **kw)


field_map = {
    'pageCount': pdf.page_count,
    'pageSize': {'width': pdf[0].rect.width, 'height': pdf[0].rect.height},
    'pageSizes': [{'width': r2(p.rect.width), 'height': r2(p.rect.height)} for p in pdf],
    'fields': [
        dict(value='name', label='첫 문단 (을) 상호', page=1, align='center', size=10.0, minSize=6.0, **blank),
        row('name', value='name', label='(을) 상호', size=10.0, minSize=7.0, w=r2(right - value_x)),
        row('bizNo', value='bizNo', label='(을) 사업자등록번호', size=10.0, w=160.0),
        dict(row('address', value='address', label='(을) 주소', size=10.0, minSize=7.0, maxLines=2, w=r2(right - value_x)),
             y=r2(colons['address'].y0 - 6), h=r2(colons['address'].height + 12)),
        row('representative', value='representative', label='(을) 대표자', size=10.0, format='spaced', w=r2(eul_in.x0 - value_x - 6)),
        dict(value='yearShort', label='계약 연도(뒤 두 자리)', page=SIGN_NO, align='center', size=date_size,
             x=r2(twenty.x1 + 1), y=r2(date_line.y0 - 1), w=r2(nen.x0 - twenty.x1 - 2), h=r2(dh + 2)),
        dict(value='monthPlain', label='계약 월', page=SIGN_NO, align='center', size=date_size,
             x=r2(nen.x1 + 1), y=r2(date_line.y0 - 1), w=r2(wol.x0 - nen.x1 - 2), h=r2(dh + 2)),
        dict(value='dayPlain', label='계약 일', page=SIGN_NO, align='center', size=date_size,
             x=r2(wol.x1 + 1), y=r2(date_line.y0 - 1), w=r2(il.x0 - wol.x1 - 2), h=r2(dh + 2)),
    ],
    'checkboxGroups': [{
        'groupLabel': '결제조건', 'minCheckRequired': 1, 'maxCheckLimit': 1,
        'boxes': [dict(dataLabel=f'{letter}_{name}', label=f'{letter}. {name}', page=CONF_NO,
                       x=r2(sq.x0), y=r2(sq.y0), w=r2(sq.width), h=r2(sq.height)) for sq, letter, name in labels],
    }],
    # 우리 도장은 (갑) (인) 위에 이미지로, 시공사 서명·도장 칸은 (을) (인) 위에.
    'signature': {
        'counterparty': dict(page=SIGN_NO, x=r2(eul_in.x0 - 10), y=r2(eul_in.y0 - 14), w=44.0, h=40.0),
        # 우리 측 모두사인 서명(CONTRACT_COMPANY_SIGNS=true 일 때만)은 도장 왼쪽 빈자리.
        'company': dict(page=SIGN_NO, x=r2(gab_in.x0 - 8 - 48), y=r2(gab_in.y0 - 14), w=44.0, h=40.0),
    },
    'sealImage': dict(page=SIGN_NO, x=r2(gab_in.x0 - 8), y=r2(gab_in.y0 - 14), w=40.0, h=40.0),
}
for box in [field_map['signature']['counterparty'], field_map['sealImage']]:
    if box['x'] + box['w'] > W10 - 4:
        sys.exit(f'10쪽 오른쪽 끝을 넘습니다: {box}')

shutil.copyfile(src, f'{outdir}/supply.template.pdf')  # 원본 바이트 그대로
with open(f'{outdir}/supply.map.json', 'w', encoding='utf-8') as f:
    json.dump(field_map, f, ensure_ascii=False, indent=1)
print('supply v3 ok', 'sha256', hashlib.sha256(open(src, 'rb').read()).hexdigest()[:16], 'blank', blank, 'boxes', [b['label'] for b in field_map['checkboxGroups'][0]['boxes']])
