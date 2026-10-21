"""让图标和后面的字落在同一条水平线上。

终端拿图标字体当回退字体，图标和文字共用一条基线。Phosphor / Lucide 是照整个 em 方框画的，
中心比 Maple Mono 的文字高一截。这里把每个字体整体缩放、平移，让图标中心对上文字中心，
再把行高度量改成和 Maple Mono 一样：终端不管按基线摆，还是按回退字体自己的行高摆，结果都一样。

用法：python align_icons.py 字体.ttf ...（原地改，可以重复跑，对齐过的不会再变）
build_icons.py 出字体时也会调用 align()。
"""
import statistics
import sys

from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

# 以下都按 1000 的 em 算，取自 Maple Mono NF CN：大写 0..730，汉字 -81..842，行高 1020 / -300
CENTER = 370
HEIGHT = 780
ASCENT, DESCENT = 1020, 300


def align(font):
    upm = font['head'].unitsPerEm
    glyf = font['glyf']
    names = [n for n in font.getGlyphOrder() if n != '.notdef' and glyf[n].numberOfContours > 0]
    for n in names:
        glyf[n].recalcBounds(glyf)
    # 用中位数当一个图标的上下边：个别图标探出去一点，不该带偏整套
    low = statistics.median(glyf[n].yMin for n in names)
    high = statistics.median(glyf[n].yMax for n in names)
    scale = HEIGHT * upm / 1000 / (high - low)
    # 横向绕原来的中心缩放，左右位置不变
    cx = statistics.median((glyf[n].xMin + glyf[n].xMax) / 2 for n in names)
    dy = CENTER * upm / 1000 - scale * (low + high) / 2
    dx = cx - scale * cx
    # 坐标取整会留一点误差，差得不多就算对齐过了
    if abs(scale - 1) > 0.005 or abs(dy) > 2:
        gs = font.getGlyphSet()
        drawn = {}
        for n in names:
            pen = TTGlyphPen(gs)
            gs[n].draw(TransformPen(pen, (scale, 0, 0, scale, dx, dy)))
            drawn[n] = pen.glyph()
        for n, g in drawn.items():
            glyf[n] = g
            g.recalcBounds(glyf)
            font['hmtx'][n] = (font['hmtx'][n][0], g.xMin)
    asc, desc = round(ASCENT * upm / 1000), round(DESCENT * upm / 1000)
    hhea, os2 = font['hhea'], font['OS/2']
    hhea.ascent, hhea.descent, hhea.lineGap = asc, -desc, 0
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = asc, -desc, 0
    os2.usWinAscent, os2.usWinDescent = asc, desc
    return scale, dy


if __name__ == '__main__':
    for path in sys.argv[1:]:
        font = TTFont(path)
        scale, dy = align(font)
        font.save(path)
        print(f'{path}: 缩放 {scale:.3f}，上下挪 {dy:+.0f}')
