"""Pixel-art magic strike on the ground: 10 frames, seen from the map's top-down angle.

   1 beam touches down       2 contact flash, ground cracks open
   3 rune circle lights up   4 shockwave, earth thrown up
   5 wave widens, debris high, sparks rise
   6 debris falls, dust rolls out
   7 dust spreads, cracks still glow     8 scorch mark, embers
   9 runes fade                          10 cooled scorch and a few motes

Ground shapes are ellipses squashed 2:1 like the map's perspective. Layers, back
to front: scorch decal, cracks and runes, dust, magic light, debris. Magic uses the
same violet palette as the orb (tools/make_magic_orb.py); earth and dust have their own.
The 80 × 64 grid is scaled ×3 with no smoothing; the impact point is at (120, 147)
of each 240 × 192 frame.
Output: source/effects/magic-ground-v1/frame-01.png … frame-10.png and sheet.png.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

W, H, SCALE, OUT, FRAMES = 80, 64, 3, 'source/effects/magic-ground-v1', 10
GX, GY = 39.5, 49          # impact point on the ground
VIOLET = [(.10, (58, 18, 110)), (.22, (96, 36, 176)), (.38, (140, 70, 240)), (.55, (186, 118, 255)),
          (.70, (224, 170, 255)), (.84, (255, 205, 246)), (.94, (255, 250, 255))]
EARTH = [(.2, (70, 48, 34)), (.5, (118, 84, 54)), (.8, (166, 124, 82))]
DUST = [(.2, (128, 112, 104)), (.45, (160, 146, 132)), (.7, (192, 180, 162))]
SCORCH = [(.38, (58, 42, 50)), (.7, (42, 26, 46))]
OUTLINE = (34, 12, 54)
BAYER = np.tile(np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16, (H // 4, W // 4))

yy, xx = np.mgrid[0:H, 0:W].astype(float)
rng = np.random.default_rng(5)
NOISE = nd.gaussian_filter(rng.uniform(size=(H, W)), 2.0); NOISE = (NOISE - NOISE.min()) / np.ptp(NOISE)

def gdist(cx=GX, cy=GY): return np.hypot(xx - cx, (yy - cy) * 2)       # ground ellipse distance
def gdisc(r, soft=1.5, cx=GX, cy=GY): return np.clip((r - gdist(cx, cy)) / soft + .5, 0, 1)
def gring(r, w): return np.clip(1 - np.abs(gdist() - r) / w, 0, 1)
def put(f, x, y, v):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < W and 0 <= y < H: f[y, x] = max(f[y, x], v)
def sparkle(f, x, y, arm, v):
    put(f, x, y, v)
    for k in range(1, arm + 1):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)): put(f, x + dx * k, y + dy * k, v * (1 - k / (arm + 1.5)))

# Cracks: jagged lines out from the centre, in ground perspective, with small branches.
CRACKS = []
for k in range(9):
    a = k * 2 * np.pi / 9 + rng.uniform(-.2, .2); pts = []; x, y = GX, GY
    for s in range(int(rng.uniform(9, 15))):
        a += rng.uniform(-.45, .45); x += np.cos(a) * 1.6; y += np.sin(a) * .8; pts.append((x, y))
        if s == 5 and k % 2 == 0:
            b, bx, by = a + rng.choice([-.9, .9]), x, y
            for _ in range(4): bx += np.cos(b) * 1.5; by += np.sin(b) * .75; pts.append((bx, by))
            x, y = pts[-5]
    CRACKS.append(pts)
# Runes on the circle: 8 tiny glyphs.
GLYPHS = [[(0, -1), (0, 0), (0, 1), (1, -1)], [(-1, 0), (0, 0), (1, 0), (0, 1)], [(-1, -1), (0, 0), (1, 1), (1, -1)],
          [(0, -1), (-1, 0), (1, 0)], [(-1, 0), (0, -1), (1, 0), (0, 1)], [(-1, -1), (-1, 0), (0, 0), (1, 0)]]
# Debris: chunks of earth and violet sparks thrown up in a ballistic arc.
CHUNKS = [dict(a=rng.uniform(0, 2 * np.pi), v=rng.uniform(8, 17), up=rng.uniform(14, 26), size=rng.choice([2, 2, 3, 3, 4]))
          for _ in range(18)]
# Dust puffs: where each cloud sits on the ring and how big it gets.
PUFFS = [dict(a=k * 2 * np.pi / 11 + rng.uniform(-.2, .2), r=rng.uniform(.7, 1.05), size=rng.uniform(.8, 1.3)) for k in range(11)]
SPARKS = [dict(a=rng.uniform(0, 2 * np.pi), v=rng.uniform(3, 9), up=rng.uniform(14, 28)) for _ in range(14)]

def ballistic(p, t):
    x = GX + np.cos(p['a']) * p['v'] * t
    ground = GY + np.sin(p['a']) * p['v'] * t * .5
    z = p['up'] * t - 13 * t * t                                   # height above the ground
    return x, ground - max(z, 0), z

def frame(i):
    t = i - 1
    scorch = np.zeros((H, W)); magic = np.zeros((H, W)); dust = np.zeros((H, W)); earth = np.zeros((H, W))
    # scorch decal grows with the blast and stays
    if i >= 2:                                                        # ragged scorch, holes let the ground show
        r = min(4 + t * 2.4, 13)
        scorch = np.maximum(scorch, gdisc(r, 2.5) * (.2 + .9 * NOISE) * min(1, t / 3))
    # cracks glow hot early, cool down later
    if 2 <= i <= 9:
        reach = min(1, (i - 1) / 3); heat = [0, 0, .95, .9, .8, .7, .55, .4, .25][i - 1]
        for pts in CRACKS:
            for k, (x, y) in enumerate(pts[:max(1, int(len(pts) * reach))]):
                put(magic, x, y, heat * (1 - k / len(pts) * .5))
    # rune circle
    if 3 <= i <= 9:
        fade = [0, 0, 0, .75, .8, .7, .6, .5, .38, .25][i]
        r = 15
        magic = np.maximum(magic, gring(r, .8) * fade * .55 * (np.cos(np.arctan2((yy - GY) * 2, xx - GX) * 8) > -.3))
        magic = np.maximum(magic, gring(r - 3, .6) * fade * .35)
        for k in range(8):
            a = k * np.pi / 4 + .2
            for dx, dy in GLYPHS[k % len(GLYPHS)]:
                put(magic, GX + (r - 1.5) * np.cos(a) + dx, GY + (r - 1.5) * np.sin(a) * .5 + dy * .5, fade)
    if i == 1:                                                         # beam comes down, touches the ground
        beam = np.clip(1 - np.abs(xx - GX) / 3.2, 0, 1) * (yy < GY) * np.clip((yy - 2) / 30, 0, 1)
        magic = np.maximum(magic, beam * .85)
        magic = np.maximum(magic, np.clip(1 - np.abs(xx - GX) / 1.2, 0, 1) * (yy < GY) * .97)
        magic = np.maximum(magic, gdisc(5, 1.5) * .7)
        magic += np.clip(1 - gdist() / 12, 0, 1) * .12
    if i == 2:                                                         # contact flash
        magic = np.maximum(magic, gdisc(9, 2) * .9)
        magic = np.maximum(magic, gdisc(4.5) * 1.0)
        dome = np.clip(1 - np.hypot(xx - GX, (yy - GY + 3) * 1.2) / 9, 0, 1)
        magic = np.maximum(magic, dome * 1.0 * (yy < GY))
        for a in np.linspace(0, 2 * np.pi, 8, endpoint=False):
            for s in range(4, 14): put(magic, GX + np.cos(a) * s, GY - 4 + np.sin(a) * s * .7, .8 - s * .04)
        magic += np.clip(1 - gdist() / 24, 0, 1) * .14
    if 3 <= i <= 6:                                                    # shockwave on the ground
        r = [0, 0, 0, 10, 18, 25, 31][i]
        magic = np.maximum(magic, gring(r, 1.8) * [0, 0, 0, .9, .8, .62, .42][i])
        magic = np.maximum(magic, gring(r - 3, 1) * [0, 0, 0, .5, .42, .3, .2][i])
        if i == 3: magic = np.maximum(magic, gdisc(6, 2) * .85)
    if 3 <= i <= 7:                                                    # light column rising from the centre
        h = [0, 0, 0, 22, 18, 12, 7, 4][i]
        col = np.clip(1 - np.abs(xx - GX) / (2.6 - (i - 3) * .3), 0, 1) * (yy < GY) * (yy > GY - h)
        magic = np.maximum(magic, col * [0, 0, 0, .9, .75, .6, .45, .3][i])
    # dust: separate puffs roll outward and rise, lit from above, thinning out
    if i >= 4:
        k = i - 4
        fade = [1, .95, .9, .75, .55, .35, .2][k]
        for p in PUFFS:
            r = (7 + k * 3.6) * p['r']; size = (2.4 + k * .9) * p['size']
            px, py = GX + r * np.cos(p['a']), GY + r * np.sin(p['a']) * .5 - k * 1.3
            body = np.clip(1 - np.hypot(xx - px, (yy - py) * 1.25) / size, 0, 1)
            shade = np.clip(.75 - (yy - (py - size)) / (size * 2.6), 0, 1)       # lighter on top
            dust = np.maximum(dust, body ** .6 * (.3 + .45 * shade + .35 * NOISE) * fade)
    # flying earth and sparks
    if 4 <= i <= 8:
        tt = (i - 3) * .42
        for p in CHUNKS:
            x, y, z = ballistic(p, tt)
            if z < -1: continue
            for dx in range(p['size']):
                for dy in range(p['size']): put(earth, x + dx, y + dy, .55 + .1 * dx)
            put(earth, x, y, .9)
    if 3 <= i <= 9:
        tt = (i - 2) * .38
        for p in SPARKS:
            x, y, z = ballistic(p, tt)
            if z < 0: continue
            if i <= 6: sparkle(magic, x, y, 1, .8)
            else: put(magic, x, y, .6)
    if i >= 8:                                                         # embers left on the scorch
        prng = np.random.default_rng(i)
        for _ in range({8: 9, 9: 6, 10: 3}[i]):
            a, r = prng.uniform(0, 2 * np.pi), prng.uniform(0, 12)
            put(magic, GX + r * np.cos(a), GY + r * np.sin(a) * .5, {8: .7, 9: .55, 10: .4}[i])
    if i == 10:
        for a, r in ((.6, 18), (2.4, 21), (4.0, 17)): put(magic, GX + r * np.cos(a), GY - 6 + r * np.sin(a) * .4, .4)
    return [(scorch, SCORCH, False), (dust, DUST, False), (magic, VIOLET, True), (earth, EARTH, True)]

def paint(img, f, palette, dither):
    if dither:
        lo = palette[0][0]
        m = (f > lo * .45) & (f < lo) & ((f - lo * .45) / (lo * .55) > BAYER)
        img[m, :3] = palette[0][1]; img[m, 3] = 255
    for k, (t, col) in enumerate(palette):
        m = f >= t; img[m, :3] = col; img[m, 3] = 255
        if dither and k + 1 < len(palette):
            t2 = palette[k + 1][0]
            up = m & (f < t2) & ((f - t) / (t2 - t) > .55 + .45 * BAYER)
            img[up, :3] = palette[k + 1][1]

def render(layers):
    img = np.zeros((H, W, 4), np.uint8)
    outlined = np.zeros((H, W), bool)
    for f, palette, line in layers:
        layer = np.zeros((H, W, 4), np.uint8); paint(layer, f, palette, palette is not EARTH)
        solid = layer[..., 3] > 0
        img[solid] = layer[solid]
        if line:                                  # chunks of earth are outlined even when 1 px; magic only as blobs
            outlined |= solid if palette is EARTH else nd.binary_opening(solid, structure=np.ones((2, 2)))
    solid = img[..., 3] > 0
    edge = nd.binary_dilation(outlined) & ~solid
    img[edge, :3] = OUTLINE; img[edge, 3] = 255
    return Image.fromarray(img).resize((W * SCALE, H * SCALE), Image.NEAREST)

os.makedirs(OUT, exist_ok=True)
frames = [render(frame(i)) for i in range(1, FRAMES + 1)]
for i, im in enumerate(frames, 1): im.save(f'{OUT}/frame-{i:02d}.png', optimize=True)
sheet = Image.new('RGBA', (W * SCALE * 5, H * SCALE * 2))
for i, im in enumerate(frames): sheet.paste(im, ((i % 5) * W * SCALE, (i // 5) * H * SCALE))
sheet.save(f'{OUT}/sheet.png', optimize=True)
print(FRAMES, 'frames ->', OUT)
