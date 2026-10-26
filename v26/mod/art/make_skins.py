"""Draw the two fun preset skins (64x64, standard layout): Claude (slim arms) and Mosspack (wide arms)."""
import os, random
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'skins')


def box(im, x, y, w, h, d, faces):
    """Fill a box's unwrapped faces: faces = dict top/bottom/right/front/left/back -> fn(px, u, v, fw, fh)."""
    layout = {'top': (x + d, y, w, d), 'bottom': (x + d + w, y, w, d), 'right': (x, y + d, d, h),
              'front': (x + d, y + d, w, h), 'left': (x + d + w, y + d, d, h), 'back': (x + d + w + d, y + d, w, h)}
    px = im.load()
    for name, (fx, fy, fw, fh) in layout.items():
        paint = faces.get(name, faces.get('*'))
        for v in range(fh):
            for u in range(fw):
                c = paint(u, v, fw, fh, name)
                if c: px[fx + u, fy + v] = c


def solid(c, noise=0, seed=1):
    rnd = random.Random(seed)
    def f(u, v, w, h, face):
        if not noise: return c
        k = rnd.randint(-noise, noise)
        return tuple(max(0, min(255, ch + k)) for ch in c[:3]) + (255,)
    return f


def limbs(im, slim, arm, leg, shoe=None):
    aw = 3 if slim else 4
    def legf(u, v, w, h, face):
        return shoe if (shoe and face not in ('top',) and v >= h - 2) or face == 'bottom' and shoe else leg(u, v, w, h, face)
    box(im, 40, 16, aw, 12, 4, {'*': arm})            # right arm
    box(im, 32, 48, aw, 12, 4, {'*': arm})            # left arm
    box(im, 0, 16, 4, 12, 4, {'*': legf})             # right leg
    box(im, 16, 48, 4, 12, 4, {'*': legf})            # left leg


# ---- Claude: terracotta hoodie with the cream spark, warm skin, dark hair --------------------------------------
def claude():
    im = Image.new('RGBA', (64, 64))
    SKIN, HAIR, EYE = (233, 190, 160, 255), (61, 43, 31, 255), (40, 34, 30, 255)
    CORAL, CORAL_D, CREAM, SLATE, SHOE = (217, 119, 87, 255), (190, 98, 70, 255), (245, 240, 232, 255), (61, 57, 41, 255), (250, 249, 245, 255)
    def head(u, v, w, h, face):
        if face == 'top': return HAIR
        if face == 'bottom': return SKIN
        if face == 'back': return HAIR
        if v < 2 or (face != 'front' and v < 4): return HAIR
        if face == 'front':
            if v == 4 and u in (2, 5): return EYE
            if v == 6 and 3 <= u <= 4: return (198, 120, 100, 255)
        return SKIN
    box(im, 0, 0, 8, 8, 8, {'*': head})
    spark = {(3, 4), (4, 4), (3, 5), (4, 5), (3, 3), (4, 3), (3, 6), (4, 6), (2, 4), (5, 4), (2, 5), (5, 5),
             (1, 2), (6, 2), (1, 7), (6, 7), (3, 1), (4, 8), (0, 5), (7, 4), (2, 3), (5, 6)}
    def body(u, v, w, h, face):
        if face == 'front':
            if v >= 10: return CORAL_D                          # hoodie pocket band
            if (u, v) in spark: return CREAM
        if face == 'top' and 2 <= u <= 5: return CORAL_D        # hood around the neck
        return CORAL
    box(im, 16, 16, 8, 12, 4, {'*': body})
    def arm(u, v, w, h, face):
        if v >= 10 and face not in ('top', 'bottom'): return SKIN
        return CORAL_D if face == 'bottom' else CORAL
    limbs(im, True, arm, solid(SLATE, 6, 2), SHOE)
    return im


# ---- Mosspack: moss-block head, mossy cloak, stone-grey trousers ------------------------------------------------
def mosspack():
    im = Image.new('RGBA', (64, 64))
    G1, G2, G3 = (74, 140, 52, 255), (98, 168, 64, 255), (52, 104, 40, 255)
    S1, S2 = (128, 128, 128, 255), (104, 104, 104, 255)
    rnd = random.Random(7)
    def moss_block(u, v, w, h, face):
        if face == 'top': return rnd.choice((G1, G2, G3))
        if face == 'bottom': return rnd.choice((S1, S2))
        if v < 2 or (v == 2 and rnd.random() < 0.5): return rnd.choice((G1, G2, G3))
        if face == 'front' and v == 4 and u in (2, 5): return (230, 255, 200, 255)       # glowing eyes
        return rnd.choice((S1, S2, S1))
    box(im, 0, 0, 8, 8, 8, {'*': moss_block})
    def cloak(u, v, w, h, face):
        if face == 'front' and 3 <= u <= 4 and 2 <= v <= 9: return (200, 170, 90, 255)  # wooden toggles
        return rnd.choice((G1, G2, G1, G3))
    box(im, 16, 16, 8, 12, 4, {'*': cloak})
    def arm(u, v, w, h, face):
        return (150, 120, 90, 255) if v >= 10 and face not in ('top', 'bottom') else rnd.choice((G1, G2, G3))
    limbs(im, False, arm, solid(S2, 10, 3), (70, 60, 50, 255))
    return im


if __name__ == '__main__':
    claude().save(os.path.join(OUT, 'Claude.png'))
    mosspack().save(os.path.join(OUT, 'Mosspack.png'))
    print('ok')
