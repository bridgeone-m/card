#!/usr/bin/env python3
"""시험용 도장 이미지(실제 도장 아님). '시험용' 글자가 들어간 빨간 원. 사용: py -3 make-test-seal.py <out.png> <font.ttf>"""
import sys

import fitz

out, font_path = sys.argv[1:3]
doc = fitz.open()
page = doc.new_page(width=120, height=120)
red = (0.78, 0.1, 0.1)
page.draw_circle((60, 60), 52, color=red, width=5)
page.draw_circle((60, 60), 44, color=red, width=1.5)
page.insert_font(fontname='sf', fontfile=font_path)
page.insert_text((30, 68), '시험용', fontname='sf', fontsize=20, color=red)
page.get_pixmap(dpi=216, alpha=True).save(out)
print('ok', out)
