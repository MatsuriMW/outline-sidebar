"""把 Phosphor / Lucide 里要用的图标挑出来，搬到补充私用区 B（U+100000 起），打成两个小字体。

不和 Nerd Font（Maple Mono NF）占的私用区撞车，两套之间也不撞。
同时输出每个图标的码位和 SVG 路径（桌面版用），给 mod 生成 icons.ts。
"""
import json
import re
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

from align_icons import align

pkgs, out = sys.argv[1], sys.argv[2]

SPIN_BASE = 0x100120

PHOSPHOR = {
    'did': 'wrench', 'files': 'file-text', 'conclusion': 'lightbulb', 'question': 'question',
    'resolved': 'seal-check', 'ask': 'chat-text', 'stats': 'chart-bar', 'tokens': 'database',
    'cache': 'target', 'time': 'clock', 'model': 'brain', 'skills': 'puzzle-piece', 'mcp': 'plug',
    'slash': 'terminal-window', 'agents': 'robot', 'outline': 'receipt', 'live': 'hourglass-medium',
    'last': 'footprints', 'note': 'note-pencil', 'recap': 'compass', 'total': 'sigma', 'empty': 'plant',
    'folder': 'folder', 'celebrate': 'confetti', 'pending': 'pencil-simple-line', 'past': 'clock-counter-clockwise',
    'dot': 'circle', 'spinner': 'spinner',
}
LUCIDE = {
    'todo': 'circle-dashed', 'bot': 'bot', 'doing': 'rotate-cw', 'done': 'circle-check', 'paused': 'pause',
    'waiting': 'hourglass', 'suspended': 'snowflake', 'cancelled': 'ban', 'failed': 'x', 'review': 'eye',
    'needok': 'hand', 'errored': 'badge-alert', 'hitlimit': 'gauge', 'delegated': 'send', 'queued': 'alarm-clock',
    'rework': 'pencil-line', 'unclear': 'message-circle-question',
    'yes': 'thumbs-up', 'no': 'thumbs-down',
}


def source_codes():
    css = open(f'{pkgs}/phosphor/package/src/regular/style.css', encoding='utf-8').read()
    ph = {name: int(code, 16) for name, code in re.findall(r'\.ph\.ph-([a-z0-9-]+):before\s*\{\s*content:\s*"\\([0-9a-f]+)"', css)}
    info = json.load(open(f'{pkgs}/lucide/package/font/info.json', encoding='utf-8'))
    lu = {name: int(v['encodedCode'].lstrip('\\'), 16) for name, v in info.items()}
    return ph, lu


def build(src, icons, codes, base, family, path, spin=None):
    font = TTFont(src)
    cmap = font.getBestCmap()
    upm = font['head'].unitsPerEm
    ascent = font['hhea'].ascent
    glyphs, table = {}, {}
    for i, (key, name) in enumerate(icons.items()):
        glyph = cmap[codes[name]]
        new = base + i
        glyphs[new] = glyph
        pen = SVGPathPen(font.getGlyphSet())
        # 字体坐标 y 轴朝上，SVG 朝下：翻过来再挪到 0..upm
        font.getGlyphSet()[glyph].draw(TransformPen(pen, (1, 0, 0, -1, 0, ascent)))
        table[key] = {'code': new, 'name': name, 'path': pen.getCommands(), 'size': upm}
    # 只留要的字形，再把 cmap 换成新码位
    opts = Options()
    opts.notdef_outline = True
    opts.name_IDs = ['*']
    sub = Subsetter(opts)
    sub.populate(glyphs=list(glyphs.values()))
    sub.subset(font)
    for t in font['cmap'].tables:
        t.cmap = {}
    fmt12 = next((t for t in font['cmap'].tables if t.format == 12), None)
    if fmt12 is None:
        from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
        fmt12 = CmapSubtable.newSubtable(12)
        fmt12.platformID, fmt12.platEncID, fmt12.language = 3, 10, 0
        font['cmap'].tables.append(fmt12)
    for t in font['cmap'].tables:
        if t.format in (12, 13) or (t.platformID == 0 and t.format == 12):
            t.cmap = dict(glyphs)
    font['cmap'].tables = [t for t in font['cmap'].tables if t.format == 12 or t.cmap]
    ps = family.replace(' ', '')
    for rec in font['name'].names:
        if rec.nameID in (1, 4, 16):
            rec.string = family
        elif rec.nameID == 6:
            rec.string = ps
        elif rec.nameID == 3:
            rec.string = f'{ps};2026-10-21'
    if spin is not None:
        # 转圈的帧放在 Lucide 图标后面留出的空当里，图标再多也不会撞上
        add_spin_frames(font, glyphs[base + list(icons).index(spin)], SPIN_BASE, table)
    align(font)
    font.save(path)
    return table


def add_spin_frames(font, glyph, base, table):
    """终端画不了动画：把转圈图标转 8 个角度各做一个字形，树视图按节拍轮流显示"""
    import math
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    gs = font.getGlyphSet()
    upm = font['head'].unitsPerEm
    # 图标画在 0..upm 的方框里，绕中心转
    cx = cy = upm / 2
    order = font.getGlyphOrder()
    frames = []
    for k in range(8):
        a = -math.radians(45 * k)  # 顺时针
        c, s = math.cos(a), math.sin(a)
        pen = TTGlyphPen(gs)
        gs[glyph].draw(TransformPen(pen, (c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy)))
        name = f'{glyph}.spin{k}'
        font['glyf'][name] = pen.glyph()
        font['hmtx'][name] = font['hmtx'][glyph]
        if name not in order:
            order.append(name)
        frames.append(base + k)
        for t in font['cmap'].tables:
            t.cmap[base + k] = name
    font.setGlyphOrder(order)
    font['glyf'].glyphOrder = order
    font['maxp'].numGlyphs = len(order)
    table['_spin'] = {'codes': frames}


ph, lu = source_codes()
tables = {
    'phosphor': build(f'{pkgs}/phosphor/package/src/regular/Phosphor.ttf', PHOSPHOR, ph, 0x100000, 'OutlineSidebar Phosphor', f'{out}/OutlineSidebarPhosphor.ttf'),
    'lucide': build(f'{pkgs}/lucide/package/font/lucide.ttf', LUCIDE, lu, 0x100100, 'OutlineSidebar Lucide', f'{out}/OutlineSidebarLucide.ttf', spin='doing'),
}
json.dump(tables, open(f'{out}/icons.json', 'w'), ensure_ascii=False)
print({k: len(v) for k, v in tables.items()})
