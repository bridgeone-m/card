#!/usr/bin/env python3
"""서명 전 원본 PDF 2종에서 등록용 양식과 입력 위치 지도를 만든다(운영자 PC, 결과물은 Git에 넣지 않는다).

- MOU: 원본 파일을 바이트 그대로 복사한다. 입력 위치만 잰다.
- 공급계약서: 첫 문단만 지운다(업체명 길이에 따라 줄이 달라져 서버가 다시 그린다). 빈 AcroForm 은 제거한다.
  서명·입력 폼이 실제로 있으면 멈춘다.

사용: py -3 build-templates.py <supply원본.pdf> <mou원본.pdf> <outdir>
"""
import json
import re
import shutil
import sys

import fitz

supply_src, mou_src, outdir = sys.argv[1:4]
sys.stdout.reconfigure(encoding='utf-8')


def lines(page):
    out = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            text = ''.join(s['text'] for s in line['spans']).strip()
            if text:
                out.append((fitz.Rect(line['bbox']), text))
    return sorted(out, key=lambda x: (x[0].y0, x[0].x0))


def rounded(**kw):
    return {k: round(v, 2) if isinstance(v, float) else v for k, v in kw.items()}


def strip_empty_acroform(pdf):
    catalog = pdf.pdf_catalog()
    kind, ref = pdf.xref_get_key(catalog, 'AcroForm')
    if kind == 'null':
        return
    xref = int(ref.split()[0]) if kind == 'xref' else None
    body = pdf.xref_object(xref) if xref else ref
    fields = re.search(r'/Fields\s*\[(.*?)\]', body, re.S)
    if '/SigFlags' in body or (fields and fields.group(1).strip()):
        sys.exit(f'양식에 서명·입력 폼이 있어 멈춥니다: {body[:200]}')
    pdf.xref_set_key(catalog, 'AcroForm', 'null')


def build_supply():
    pdf = fitz.open(supply_src)
    first, last = pdf[0], pdf[-1]
    W, H = first.rect.width, first.rect.height
    strip_empty_acroform(pdf)

    # ---- 첫 문단: 양식의 글자를 그대로 이어 붙이고 빈칸만 {name} 으로 둔다.
    all_lines = lines(first)
    start = next(i for i, (_, t) in enumerate(all_lines) if '(이하 "갑"이라 한다)' in t)
    end = next(i for i, (_, t) in enumerate(all_lines) if re.match(r'^제\s*1\s*조', t))
    rects = [r for r, _ in all_lines[start:end]]
    raw = ' '.join(t for _, t in all_lines[start:end])
    filled, count = re.subn(r'와\s+\(이하 "을"', '와 {name}(이하 "을"', raw)
    if count != 1:
        sys.exit('첫 문단의 (을) 빈칸을 찾지 못했습니다.')
    # PDF 글자 추출이 영문·한글 사이에 넣은 공백만 원문대로 되돌린다.
    paragraph = re.sub(r'POUR\s+공법', 'POUR공법', filled)
    line_height = rects[1].y0 - rects[0].y0
    next_top = all_lines[end][0].y0
    for r in rects:
        first.add_redact_annot(r + (-1, -1, 1, 1), fill=False)
    first.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)

    # ---- 마지막 쪽 위치
    page_no = len(pdf)
    last_lines = lines(last)
    date = next(r for r, t in last_lines if re.match(r'^년\s+월\s+일', t))
    nen = next(q for q in last.search_for('년') if abs(q.y0 - date.y0) < 3)
    wol = next(q for q in last.search_for('월') if abs(q.y0 - date.y0) < 3)
    il = next(q for q in last.search_for('일') if abs(q.y0 - date.y0) < 3 and q.x0 > wol.x0)
    eul = next(i for i, (_, t) in enumerate(last_lines) if t.replace(' ', '') == '(을)')
    colons = {}
    labels = {'상호': 'name', '사업자등록번호': 'bizNo', '주소': 'address', '대표자': 'representative'}
    below = last_lines[eul + 1:]
    for rect, text in below:
        key = text.replace(' ', '')
        if key in labels:
            colons[labels[key]] = next(r for r, t in below if t.startswith(':') and abs(r.y0 - rect.y0) < 3)
    ins = last.search_for('(인)')
    gab_in, eul_in = min(ins, key=lambda q: q.y0), max(ins, key=lambda q: q.y0)
    value_x = colons['name'].x0 + 9
    right = W - 60

    def row(field, **kw):
        c = colons[field]
        return dict(x=round(value_x, 2), y=round(c.y0 - 1, 2), h=round(c.height + 2, 2), page=page_no, **kw)

    field_map = {
        'pageCount': page_no,
        'pageSize': {'width': W, 'height': H},
        'fields': [
            rounded(value='year', label='계약 연도', page=page_no, align='center', size=10.7, x=nen.x0 - 42, y=date.y0 - 1, w=40.0, h=date.height + 2),
            rounded(value='month', label='계약 월', page=page_no, align='center', size=10.7, x=nen.x1 + 2, y=date.y0 - 1, w=wol.x0 - nen.x1 - 4, h=date.height + 2),
            rounded(value='day', label='계약 일', page=page_no, align='center', size=10.7, x=wol.x1 + 2, y=date.y0 - 1, w=il.x0 - wol.x1 - 4, h=date.height + 2),
            row('name', value='name', label='(을) 상호', size=9.7, minSize=7, w=round(right - value_x, 2)),
            row('bizNo', value='bizNo', label='(을) 사업자등록번호', size=9.7, w=160),
            dict(row('address', value='address', label='(을) 주소', size=9.7, minSize=7, maxLines=2, w=round(right - value_x, 2)), y=round(colons['address'].y0 - 6, 2), h=round(colons['address'].height + 12, 2)),
            row('representative', value='representative', label='(을) 대표자', size=9.7, format='spaced', w=round(eul_in.x0 - value_x - 4, 2)),
        ],
        'paragraphs': [rounded(
            label='첫 문단', page=1, template=paragraph, size=9.7, maxLines=5, lineHeight=line_height, minLineHeight=20.0,
            x=rects[0].x0, y=rects[0].y0 - 6, w=W - 2 * rects[0].x0, h=next_top - rects[0].y0 + 2,
        )],
        'signature': {
            'counterparty': rounded(page=page_no, x=eul_in.x0 - 10, y=eul_in.y0 - 14, w=44.0, h=40.0),
            'company': rounded(page=page_no, x=gab_in.x0 - 10, y=gab_in.y0 - 14, w=44.0, h=40.0),
        },
        'sealImage': rounded(page=page_no, x=gab_in.x0 - 8, y=gab_in.y0 - 14, w=40.0, h=40.0),
    }
    pdf.set_metadata({'title': '', 'author': '', 'subject': '', 'keywords': '', 'creator': '', 'producer': '', 'creationDate': '', 'modDate': ''})
    pdf.del_xml_metadata()
    pdf.save(f'{outdir}/supply.template.pdf', garbage=4, deflate=True, clean=True)
    with open(f'{outdir}/supply.map.json', 'w', encoding='utf-8') as f:
        json.dump(field_map, f, ensure_ascii=False, indent=1)
    print('supply ok pages', page_no, 'lineHeight', round(line_height, 2))


def build_mou():
    shutil.copyfile(mou_src, f'{outdir}/mou.template.pdf')  # 원본을 바이트 그대로 쓴다
    pdf = fitz.open(mou_src)
    if pdf.get_sigflags() > 0 or len(list(pdf[0].widgets() or [])):
        sys.exit('MOU 양식에 서명·입력 폼이 있어 멈춥니다.')
    W, H = pdf[0].rect.width, pdf[0].rect.height
    brackets = [c for b in pdf[0].get_text('rawdict')['blocks'] for l in b.get('lines', []) for s in l['spans'] for c in s['chars'] if c['c'] in '[]' and c['bbox'][1] < 155]
    left, close = brackets[0]['bbox'], brackets[1]['bbox']
    page2 = pdf[1]
    date = next(r for r, t in lines(page2) if re.match(r'^년\s+월\s+일', t))
    nen = next(q for q in page2.search_for('년') if abs(q.y0 - date.y0) < 3)
    wol = next(q for q in page2.search_for('월') if abs(q.y0 - date.y0) < 3)
    il = next(q for q in page2.search_for('일') if abs(q.y0 - date.y0) < 3 and q.x0 > wol.x0)
    # 서명 칸은 표의 '대표 이사' 줄 안에 넣는다(위아래 1pt 여백). 줄 경계는 표의 가로선에서 잰다.
    rep_y = max(q.y0 for q in page2.search_for('대표'))
    rules = sorted({round(it[1].y, 2) for d in page2.get_drawings() for it in d['items']
                    if it[0] == 'l' and abs(it[1].y - it[2].y) < 0.5})
    row_top = max(y for y in rules if y <= rep_y)
    row_bottom = min(y for y in rules if y > rep_y)
    sig_y, sig_h = round(row_top + 1, 2), round(row_bottom - row_top - 2, 2)
    field_map = {
        'pageCount': len(pdf),
        'pageSize': {'width': W, 'height': H},
        'fields': [
            rounded(value='name', label='업체명', page=1, x=left[2] + 1, y=left[1] - 0.5, w=close[0] - left[2] - 2, h=13.0, size=10.0, minSize=6.0, align='center'),
            rounded(value='year', label='계약 연도', page=2, x=nen.x0 - 34, y=date.y0 - 0.5, w=30.0, h=13.0, size=10.0, align='center'),
            rounded(value='monthPlain', label='계약 월', page=2, x=nen.x1 + 2, y=date.y0 - 0.5, w=wol.x0 - nen.x1 - 4, h=13.0, size=10.0, align='center'),
            rounded(value='dayPlain', label='계약 일', page=2, x=wol.x1 + 2, y=date.y0 - 0.5, w=il.x0 - wol.x1 - 4, h=13.0, size=10.0, align='center'),
            dict(value='name', label='(을) 상호', page=2, x=358, y=705, w=170, h=16, size=10, minSize=7),
            dict(value='address', label='(을) 주소', page=2, x=358, y=726, w=170, h=23, size=9, minSize=7, maxLines=2, lineHeight=10.5),
            dict(value='representative', label='(을) 대표 성명', page=2, x=358, y=755, w=90, h=14, size=10, format='spaced'),
        ],
        'signature': {
            'counterparty': dict(page=2, x=450, y=sig_y, w=40, h=sig_h),
            'company': dict(page=2, x=171.6, y=sig_y, w=40, h=sig_h),
        },
        'sealImage': dict(page=2, x=172, y=745, w=39, h=39),
    }
    with open(f'{outdir}/mou.map.json', 'w', encoding='utf-8') as f:
        json.dump(field_map, f, ensure_ascii=False, indent=1)
    print('mou ok pages', len(pdf))


build_supply()
build_mou()
