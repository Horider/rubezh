"""Makes the per-level pennant of the archer tower, each a visible step up.

Starts from that tower's own 04-pennant.png (so the flag fits its pole) and adds:
  level 1  as drawn: worn cloth with orange patches
  level 2  patches mended, richer blue
  level 3  + gold trim along the cloth edge
  level 4  + gold arrow emblem
  level 5  royal blue, two crossed arrows, gold pole finial
The result keeps the 1254 × 1254 canvas; animate it with tools/make_pennant.py.

    python tools/upgrade_pennant.py <level 1-5> <04-pennant.png> <out.png>
    e.g. 3 source/towers/archers/modular/tower-03-mossy-stone/parts/04-pennant.png source/towers/archers/pennants/level-3/pennant.png
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

level, src, dst = int(sys.argv[1]), sys.argv[2], sys.argv[3]
POLE_RIGHT = 650
a = np.asarray(Image.open(src).convert('RGBA')).astype(float)
H, W = a.shape[:2]
yy, xx = np.mgrid[0:H, 0:W]
rgb = a[..., :3]; al = a[..., 3]
right = xx >= POLE_RIGHT
solid = (al >= 128) & right
blue = (rgb[..., 2] > rgb[..., 0] + 30) & solid
patch = (rgb[..., 0] > rgb[..., 2] + 20) & solid & ~nd.binary_erosion(~blue, iterations=0) if False else \
        (rgb[..., 0] > rgb[..., 2] + 20) & solid & (xx > POLE_RIGHT + 8)
cloth = nd.binary_fill_holes(blue | patch) & solid
depth = nd.distance_transform_edt(solid | ~right)          # px from the transparent background
depth[~solid] = 0
lum = rgb.mean(2)
GOLD, GOLD_DARK = np.array([236, 184, 62.]), np.array([96, 52, 14.])

def gold_shade(mask, strength=1.0):
    """Gold that keeps the cloth's own light and folds."""
    rel = np.clip(lum / max(lum[cloth].mean(), 1), .55, 1.45)[..., None]
    rgb[mask] = np.clip(GOLD * rel, 0, 255)[mask]

if level >= 2:                                             # mend the patches with nearby cloth
    hole = nd.binary_dilation(patch, iterations=2) & cloth
    good = cloth & ~hole & (depth > 3)
    _, (iy, ix) = nd.distance_transform_edt(~good, return_indices=True)
    rgb[hole] = rgb[iy, ix][hole]
    for _ in range(2):
        rgb[hole] = nd.uniform_filter(rgb, (3, 3, 1))[hole]
    # richer blue: push saturation of the blue cloth up
    body = cloth & (depth > 3)
    m = rgb.mean(2, keepdims=True)
    boost = {2: 1.18, 3: 1.22, 4: 1.26, 5: 1.3}[level]
    rgb[body] = np.clip(m + (rgb - m) * boost, 0, 255)[body]
    lum = rgb.mean(2)

if level >= 5:                                             # royal: deeper, slightly violet blue
    body = cloth & (depth > 3)
    rgb[body] = np.clip(rgb * np.array([.92, .86, 1.05]), 0, 255)[body]
    lum = rgb.mean(2)

if level >= 3:                                             # gold trim just inside the dark outline
    # Measured from the transparent background only, so dark folds inside the cloth get none.
    edge_dist = nd.distance_transform_edt(al >= 128)
    light = cloth & (lum > 60)
    first = np.median(edge_dist[light & (edge_dist < 12)])  # where the outline ends
    trim = light & (edge_dist >= first - 1) & (edge_dist <= first + 5) & (xx > POLE_RIGHT + 6) & (xx < 850)
    gold_shade(trim)

def stamp(pattern, x0, y0, scale=4):
    """Pixel-art stamp: 'X' gold, 'o' dark gold edge."""
    for j, row in enumerate(pattern):
        for i, ch in enumerate(row):
            if ch == '.': continue
            ys, xs = slice(y0 + j * scale, y0 + (j + 1) * scale), slice(x0 + i * scale, x0 + (i + 1) * scale)
            if ch == 'X':
                m = np.zeros((H, W), bool); m[ys, xs] = True; gold_shade(m & cloth)
            else:
                rgb[ys, xs] = GOLD_DARK

ARROW = ['oo............oo..',
         'oXo...........oXo.',
         '.oXXXXXXXXXXXXXXXo',
         '.oXXXXXXXXXXXXXXXo',
         'oXo...........oXo.',
         'oo............oo..']
CROSSED = ['oo........oo',
           'oXo......oXo',
           '.oXo....oXo.',
           '..oXo..oXo..',
           '...oXooXo...',
           '....oXXo....',
           '...oXooXo...',
           '..oXo..oXo..',
           '.oXo....oXo.',
           'oXXo....oXXo',
           'oXXXo..oXXXo',
           'oooo....oooo']

if level == 4:
    stamp(ARROW, 668, 112, 6)
elif level >= 5:
    stamp(CROSSED, 670, 90, 7)
    # gold finial: the pole cap above the cloth turns gold
    cap = (yy < 72) & (xx < POLE_RIGHT) & (al >= 128) & (rgb[..., 0] > rgb[..., 2] + 30)
    rel = np.clip(lum / max(lum[cap].mean(), 1), .5, 1.5)[..., None]
    rgb[cap] = np.clip(GOLD * rel, 0, 255)[cap]

out = np.dstack([rgb, al]).round().clip(0, 255).astype(np.uint8)
Image.fromarray(out).save(dst, optimize=True)
print(dst)
