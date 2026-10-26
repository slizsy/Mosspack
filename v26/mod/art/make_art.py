"""Draw the Mosspack 26.3 boot logo and page icon (wordmark + pixel moss block)."""
import sys
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
FONT = '/System/Library/Fonts/Supplemental/Georgia Bold.ttf'
# 8x8 moss block: mossy top, stone body
G1, G2, G3 = (74, 140, 52), (98, 168, 64), (52, 104, 40)
S1, S2, S3 = (128, 128, 128), (104, 104, 104), (150, 150, 150)
rows = ['ababcaba', 'bacababc', 'cbAbacAb', 'sAstsAts', 'tssstsss', 'sstsssts', 'stssutss', 'ssusssst']
pal = {'a': G1, 'b': G2, 'c': G3, 'A': G3, 's': S1, 't': S2, 'u': S3}
block = Image.new('RGBA', (8, 8))
for y, r in enumerate(rows):
    for x, ch in enumerate(r): block.putpixel((x, y), pal[ch] + (255,))

def draw(size, word_px, sub=None, mode='RGBA', bg=(255, 255, 255, 255), fg=(46, 82, 36, 255), sub_fg=(40, 40, 40, 255)):
    im = Image.new('RGBA', size, bg)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, word_px)
    text = 'mosspack'
    tw = d.textlength(text, font=f)
    bs = int(word_px * 0.8) // 8 * 8 or 8
    gap = word_px // 5
    total = tw + gap + bs
    x0 = (size[0] - total) / 2
    asc, desc = f.getmetrics()
    sub_h = 0
    if sub:
        fs = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', word_px // 2)
        sub_h = word_px // 2 + word_px // 2
    y0 = (size[1] - (asc + desc) - sub_h) / 2
    d.text((x0, y0), text, font=f, fill=fg)
    im.alpha_composite(block.resize((bs, bs), Image.NEAREST), (int(x0 + tw + gap), int(y0 + asc - bs)))
    if sub:
        sw = d.textlength(sub, font=fs)
        d.text(((size[0] - sw) / 2, y0 + asc + desc + word_px // 3), sub, font=fs, fill=sub_fg)
    return im.convert(mode) if mode != 'RGBA' else im


# 26.3: boot logo on the dark loading screen (the status line underneath says what is loading) and the page icon
draw((512, 512), 78, bg=(18, 23, 15, 255), fg=(233, 238, 227, 255)).save(f'{out}/boot.png')
block.resize((128, 128), Image.NEAREST).convert('RGB').save(f'{out}/icon-128.png')
print('ok')

# ---- title banner: "MOSSPACK" in place of "JAVA EDITION" (512x64, same blocky 3D style) ----------------------
FONT5 = {   # 5x5 block letters
    'M': ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'], 'O': ['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.'],
    'S': ['.XXXX', 'X....', '.XXX.', '....X', 'XXXX.'], 'P': ['XXXX.', 'X...X', 'XXXX.', 'X....', 'X....'],
    'A': ['.XXX.', 'X...X', 'XXXXX', 'X...X', 'X...X'], 'C': ['.XXXX', 'X....', 'X....', 'X....', '.XXXX'],
    'K': ['X...X', 'X..X.', 'XXX..', 'X..X.', 'X...X'],
}
def banner(text, size=(512, 64), cell=9):
    face, top, side, edge = (214, 232, 196, 255), (238, 248, 226, 255), (70, 108, 50, 255), (18, 24, 14, 255)
    w = len(text) * 6 * cell - cell
    im = Image.new('RGBA', size, (0, 0, 0, 0))
    ox, oy = (size[0] - w - cell) // 2, (size[1] - 6 * cell) // 2
    cells = {(ox + (i * 6 + x) * cell, oy + y * cell) for i, ch in enumerate(text) for y, row in enumerate(FONT5[ch]) for x, c in enumerate(row) if c == 'X'}
    d = ImageDraw.Draw(im)
    for x, y in cells:                       # outline + extrusion one cell down-right
        d.rectangle([x - 2, y - 2, x + cell + cell // 2 + 1, y + cell + cell // 2 + 1], fill=edge)
    for x, y in cells:
        d.rectangle([x + cell // 2, y + cell // 2, x + cell + cell // 2 - 1, y + cell + cell // 2 - 1], fill=side)
    for x, y in cells:
        d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=face)
        if (x, y - cell) not in cells: d.rectangle([x, y, x + cell - 1, y + 1], fill=top)
    return im
banner('MOSSPACK').save(f'{out}/edition.png')

print("ok")
