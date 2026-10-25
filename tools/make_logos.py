"""Draw the Mosspack logo (wordmark + pixel moss block) at the sizes the client expects."""
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

def draw(size, word_px, sub=None, mode='RGBA', bg=(255, 255, 255, 255)):
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
    d.text((x0, y0), text, font=f, fill=(46, 82, 36, 255))
    im.alpha_composite(block.resize((bs, bs), Image.NEAREST), (int(x0 + tw + gap), int(y0 + asc - bs)))
    if sub:
        sw = d.textlength(sub, font=fs)
        d.text(((size[0] - sw) / 2, y0 + asc + desc + word_px // 3), sub, font=fs, fill=(40, 40, 40, 255))
    return im.convert(mode) if mode != 'RGBA' else im

draw((512, 512), 78, sub='WASM-GC').save(f'{out}/splash.png')
draw((305, 113), 56, mode='L').save(f'{out}/logo-305x113.png')
draw((256, 256), 38, bg=(255, 255, 255, 0)).save(f'{out}/eagtek.png')
block.resize((32, 32), Image.NEAREST).convert('RGB').save(f'{out}/icon-32.png')
print('ok')
