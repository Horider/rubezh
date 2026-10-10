"""Pixel-art magic orb strike: 10 frames from the first spark to the last wisp of smoke.

   1 spark            2 star unfolds       3 motes spiral in     4 core condenses
   5 orb with runes   6 orb in flight      7 squash on contact   8 flash
   9 burst            10 fading ring and smoke

Each frame is a brightness field (plus a smoke field) on a 64 × 64 grid. Brightness
maps to a 7-step violet palette with a hot pink-white core; the faint glow is
dithered with a Bayer matrix like hand-made pixel art. Everything gets a 1 px
dark outline and is scaled ×3 with no smoothing.
Output: source/effects/magic-orb-v1/frame-01.png … frame-10.png (192 × 192, transparent) and sheet.png.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

N, SCALE, OUT = 64, 3, 'source/effects/magic-orb-v1'
FRAMES = 10
PALETTE = [  # (from brightness, colour), darkest first
    (.10, (58, 18, 110)),
    (.22, (96, 36, 176)),
    (.38, (140, 70, 240)),
    (.55, (186, 118, 255)),
    (.70, (224, 170, 255)),
    (.84, (255, 205, 246)),   # pink-hot
    (.94, (255, 250, 255)),
]
SMOKE = [(.18, (70, 52, 92)), (.4, (104, 84, 128)), (.65, (138, 118, 160))]
OUTLINE = (34, 12, 54)
BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16

yy, xx = np.mgrid[0:N, 0:N].astype(float)
C = (N - 1) / 2
rng = np.random.default_rng(7)
NOISE = nd.gaussian_filter(rng.uniform(size=(N, N)), 2.2)
NOISE = (NOISE - NOISE.min()) / np.ptp(NOISE)

def dist(cx, cy, sx=1, sy=1): return np.hypot((xx - cx) / sx, (yy - cy) / sy)
def disc(cx, cy, r, soft=1.2, sx=1, sy=1): return np.clip((r - dist(cx, cy, sx, sy)) / soft + .5, 0, 1)
def glow(cx, cy, r, v): return np.clip(1 - dist(cx, cy) / r, 0, 1) ** 1.6 * v

def put(f, x, y, v):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < N and 0 <= y < N: f[y, x] = max(f[y, x], v)

def sparkle(f, cx, cy, arm, v=1.0, diag=False):
    put(f, cx, cy, v)
    for k in range(1, arm + 1):
        w = v * (1 - k / (arm + 1.5))
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            put(f, cx + dx * k, cy + dy * k, w)
    if diag:
        for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            put(f, cx + dx, cy + dy, v * .5)

def orb(cx, cy, r, swirl=0.0, sx=1, sy=1):
    """Shaded sphere: rim, body, hot core, swirl bands inside, highlight up-left."""
    d = dist(cx, cy, sx, sy) / r
    body = np.clip(1 - d, 0, 1)
    f = (d <= 1) * (.42 + .35 * body)
    if swirl:
        ang = np.arctan2(yy - cy, xx - cx)
        bands = np.sin(ang * 3 + d * 9 + swirl) * .5 + .5
        f = f + (d < .92) * (bands > .72) * .16 - (d < .92) * (bands < .18) * .1
    f = np.maximum(f, disc(cx, cy, r * .42, 1, sx, sy) * .9)
    f = np.maximum(f, disc(cx, cy, r * .2, 1, sx, sy) * 1.0)
    f = np.maximum(f, disc(cx - r * .38 * sx, cy - r * .42 * sy, r * .16, .8) * .97)  # highlight
    put(f, cx - r * .15 * sx, cy - r * .62 * sy, .8)
    return f

def rune(f, cx, cy, kind, v=.62):
    """Tiny 3×3 glyphs orbiting the orb."""
    shapes = [[(0, -1), (0, 0), (0, 1), (-1, -1), (1, 1)],
              [(-1, 0), (0, 0), (1, 0), (0, -1)],
              [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
              [(0, -1), (-1, 0), (1, 0), (0, 1)]]
    for dx, dy in shapes[kind % 4]: put(f, cx + dx, cy + dy, v)

def frame(i):
    f = np.zeros((N, N)); smoke = np.zeros((N, N))
    if i == 1:                                   # a single spark is born
        f += glow(C, C, 7, .13)
        sparkle(f, C, C, 2, 1.0)
        put(f, C + 7, C - 5, .4); put(f, C - 6, C + 6, .3)
    elif i == 2:                                 # the star unfolds, first motes appear far out
        f += glow(C, C, 12, .13)
        f = np.maximum(f, disc(C, C, 2.2) * .9)
        sparkle(f, C, C, 6, 1.0, diag=True)
        for a, r in ((.4, 18), (2.1, 20), (3.9, 17), (5.2, 21)):
            sparkle(f, C + r * np.cos(a), C + r * np.sin(a), 1, .55)
    elif i == 3:                                 # motes spiral inward leaving curved streaks
        f += glow(C, C, 15, .14)
        f = np.maximum(f, orb(C, C, 4))
        for k in range(5):
            a0, r0 = k * 2 * np.pi / 5, 20
            for s in range(10):                  # streak: the path the mote travelled
                a, r = a0 + s * .09, r0 - s * 1.0
                put(f, C + r * np.cos(a), C + r * np.sin(a), .25 + s * .05)
            a, r = a0 + 10 * .09, r0 - 10
            sparkle(f, C + r * np.cos(a), C + r * np.sin(a), 1, .8)
    elif i == 4:                                 # the core condenses and starts to swirl
        f += glow(C, C, 18, .15)
        f = np.maximum(f, orb(C, C, 7, swirl=.0))
        for k in range(7):
            a, r = k * 2 * np.pi / 7 + .3, 11 + (k % 2) * 2
            for s in range(4):
                put(f, C + (r + s) * np.cos(a - s * .12), C + (r + s) * np.sin(a - s * .12), .55 - s * .1)
    elif i == 5:                                 # full orb: swirl inside, runes in orbit, dithered halo
        f += glow(C, C, 22, .16)
        f = np.maximum(f, orb(C, C, 10, swirl=1.3))
        ring = np.abs(dist(C, C) - 15) < .7
        f = np.maximum(f, ring * .3 * (np.cos(np.arctan2(yy - C, xx - C) * 6) > .2))
        for k in range(6):
            a = k * np.pi / 3 + .26
            rune(f, C + 15 * np.cos(a), C + 15 * np.sin(a), k)
        for a in (1.0, 3.4, 5.0):
            sparkle(f, C + 21 * np.cos(a), C + 21 * np.sin(a), 1, .6)
    elif i == 6:                                 # flight: comet tail, streak lines, shed sparks
        cx = C + 13
        back = cx - xx
        width = 9.5 * np.clip(1 - back / 40, 0, 1) ** .8
        tail = np.clip(1 - np.abs(yy - C) / np.maximum(width, .01), 0, 1) * (back > 0) * (width > .5)
        tail *= np.clip(1.1 - back / 42, 0, 1) * (.75 + .5 * NOISE)
        f = np.maximum(f, tail * .62)
        for dy, ln, v in ((-5, 22, .5), (4, 28, .45), (0, 34, .55), (-2, 16, .7), (6, 14, .4)):
            for s in range(ln):
                if s % 7 != 6: put(f, cx - 6 - s, C + dy * (1 - s / (ln * 1.6)), v * (1 - s / ln))
        f = np.maximum(f, glow(cx, C, 18, .15))
        f = np.maximum(f, orb(cx, C, 9.5, swirl=2.6, sx=1.12, sy=.92))
        for dx, dy, v in ((-24, -8, .6), (-31, 6, .5), (-38, -3, .4), (-18, 9, .55), (-43, 2, .3)):
            sparkle(f, cx + dx, C + dy, 1, v)
    elif i == 7:                                 # contact: orb squashes, first cracks of light
        cx = C + 4
        f += glow(cx, C, 24, .17)
        f = np.maximum(f, orb(cx, C, 11, swirl=3.9, sx=.62, sy=1.35))
        for k in range(10):
            a = k * 2 * np.pi / 10 + .15
            ln = 6 + (k % 3) * 3
            for s in range(ln):
                put(f, cx + (9 + s) * np.cos(a) * .8, C + (9 + s) * np.sin(a) * 1.1, .9 - s * .06)
    elif i == 8:                                 # flash: white-hot core with long and short rays
        f += glow(C, C, 31, .2)
        ang = np.arctan2(yy - C, xx - C); d = dist(C, C)
        long_rays = (np.cos(ang * 4) > .93) * np.clip(1 - d / 30, 0, 1)
        short_rays = (np.cos(ang * 4 + np.pi / 4 * 4 / 4 * 1) > .9) * np.clip(1 - d / 19, 0, 1)
        f = np.maximum(f, long_rays * 1.0)
        f = np.maximum(f, np.cos(ang * 8 + np.pi / 8) * 0 + short_rays * .8)
        f = np.maximum(f, disc(C, C, 10, 2) * .97)
        f = np.maximum(f, disc(C, C, 6) * 1.0)
    elif i == 9:                                 # burst: shockwave, churning fire cloud, debris
        d = dist(C, C)
        shock = np.clip(1 - np.abs(d - 22) / 2.2, 0, 1) * (.75 + .25 * np.cos(np.arctan2(yy - C, xx - C) * 9))
        cloud = np.clip(1 - d / 17, 0, 1) * (.55 + .7 * NOISE)
        f = np.maximum(shock * .78, cloud * .85)
        f = np.maximum(f, disc(C - 2, C - 2, 4.5) * .95)
        for k in range(12):
            a = k * 2 * np.pi / 12 + (k % 2) * .2
            r = 25 + (k % 3) * 3
            sparkle(f, C + r * np.cos(a), C + r * np.sin(a), 1 + (k % 2), .75)
            put(f, C + (r - 3) * np.cos(a), C + (r - 3) * np.sin(a), .45)
    elif i == 10:                                # fading: broken thin ring, smoke puffs, last motes
        d = dist(C, C); ang = np.arctan2(yy - C, xx - C)
        f = np.clip(1 - np.abs(d - 27) / 1.3, 0, 1) * (np.cos(ang * 5 + .7) > .1) * .3
        # Smoke: uneven puffs drifting up and out, broken up by noise.
        prng = np.random.default_rng(11)
        for k in range(14):
            a = prng.uniform(0, 2 * np.pi); r = prng.uniform(4, 17)
            px, py = C + r * np.cos(a), C + r * np.sin(a) * .8 - r * .35
            smoke = np.maximum(smoke, disc(px, py, prng.uniform(2.2, 4.8), 1.6) * prng.uniform(.5, .9))
        smoke *= (.35 + .9 * NOISE)
        smoke = np.where(smoke > .18, smoke, 0)
        for a, r in ((.3, 22), (1.6, 25), (2.9, 21), (4.1, 26), (5.4, 23)):
            put(f, C + r * np.cos(a), C + r * np.sin(a), .4)
        put(f, C + 2, C - 1, .5)
    return np.clip(f, 0, 1), np.clip(smoke, 0, 1)

def render(f, smoke):
    img = np.zeros((N, N, 4), np.uint8)
    for t, col in SMOKE:
        m = smoke >= t; img[m, :3] = col; img[m, 3] = 255
    bayer = np.tile(BAYER, (N // 4, N // 4))
    lo, nxt = PALETTE[0][0], PALETTE[1][0]
    # faint glow below the first step: scattered dither pixels instead of a flat disc
    dither = (f > lo * .45) & (f < lo) & ((f - lo * .45) / (lo * .55) > bayer)
    img[dither, :3] = PALETTE[0][1]; img[dither, 3] = 255
    for k, (t, col) in enumerate(PALETTE):
        m = f >= t
        if k + 1 < len(PALETTE):                  # dithered blend into the next step
            t2 = PALETTE[k + 1][0]
            up = (f >= t) & (f < t2) & ((f - t) / (t2 - t) > .55 + .45 * bayer)
        img[m, :3] = col; img[m, 3] = 255
        if k + 1 < len(PALETTE):
            img[up, :3] = PALETTE[k + 1][1]
    solid = img[..., 3] > 0
    grow = np.zeros_like(solid)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        grow |= np.roll(np.roll(solid, dy, 0), dx, 1)
    edge = grow & ~solid
    # lone dither pixels get no outline, so the glow stays airy
    big = nd.binary_opening(solid, structure=np.ones((2, 2)))
    edge &= nd.binary_dilation(big)
    img[edge, :3] = OUTLINE; img[edge, 3] = 255
    return Image.fromarray(img).resize((N * SCALE, N * SCALE), Image.NEAREST)

os.makedirs(OUT, exist_ok=True)
for old in os.listdir(OUT):
    if old.startswith('frame-'): os.remove(os.path.join(OUT, old))
frames = [render(*frame(i)) for i in range(1, FRAMES + 1)]
for i, im in enumerate(frames, 1):
    im.save(f'{OUT}/frame-{i:02d}.png', optimize=True)
sheet = Image.new('RGBA', (N * SCALE * FRAMES, N * SCALE))
for i, im in enumerate(frames): sheet.paste(im, (i * N * SCALE, 0))
sheet.save(f'{OUT}/sheet.png', optimize=True)
print(FRAMES, 'frames ->', OUT)
