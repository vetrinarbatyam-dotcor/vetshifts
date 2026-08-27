# -*- coding: utf-8 -*-
"""בונה @font-face עם woff2 מוטמע ב-base64.
מושך מ-Google את הפונט המלא (TTF, לא מפוצל לתת-קבוצות — פיצול היה מפיל את
העברית) ומצמצם לתווים שהדף באמת משתמש בהם: עברית, ספרות ולטינית בסיסית."""
import io, re, base64, urllib.request, os
from fontTools import subset

UNICODES = ('U+0020-007E,U+00A0,U+00D7,U+0590-05FF,U+200C-200F,U+2010-2015,'
            'U+2018-201D,U+2022,U+20AA,U+25CC,U+FB1D-FB4F,U+2190,U+2192,U+2713,U+2715')

css = io.open('_fonts_full.css', encoding='utf-8').read()
faces = re.findall(
    r"font-family:\s*'([^']+)';\s*font-style:\s*normal;\s*font-weight:\s*(\d+);\s*"
    r"src:\s*url\((https://[^)]+\.ttf)\)", css)
assert faces, 'no faces parsed'

out, raw, small = [], 0, 0
for fam, wt, url in faces:
    data = urllib.request.urlopen(url, timeout=60).read()
    raw += len(data)
    io.open('_f_in.ttf', 'wb').write(data)
    subset.main(['_f_in.ttf', '--output-file=_f_out.woff2', '--flavor=woff2',
                 '--layout-features=*', '--unicodes=' + UNICODES,
                 '--no-hinting', '--desubroutinize'])
    cut = io.open('_f_out.woff2', 'rb').read()
    os.remove('_f_in.ttf'); os.remove('_f_out.woff2')
    small += len(cut)
    # בקרה חיובית: הפונט המצומצם חייב להכיל א' (U+05D0) ואת הספרה 0
    from fontTools.ttLib import TTFont
    io.open('_v.woff2', 'wb').write(cut)
    cmap = TTFont('_v.woff2').getBestCmap(); os.remove('_v.woff2')
    assert 0x05D0 in cmap and 0x0030 in cmap, fam + ' ' + wt + ' lost Hebrew/digits'
    out.append("@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:swap;"
               "src:url(data:font/woff2;base64,%s) format('woff2')}"
               % (fam, wt, base64.b64encode(cut).decode()))
    print(fam, wt, len(data), '->', len(cut), 'glyphs ok')

io.open('_fonts_inline.css', 'w', encoding='utf-8').write('\n'.join(out))
print('faces', len(out), '| raw', raw // 1024, 'KB -> subset', small // 1024,
      'KB | inline', len('\n'.join(out)) // 1024, 'KB')
