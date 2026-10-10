"""Paints selected birches out of the map by cloning forest from elsewhere.

For every tree, a mask of its light crown and trunk is built inside the given
rectangle. The mask is filled from the place on the map whose surroundings
match the mask's border best, with no path, water, stone or other birch inside
the copied area. The result is written to a new file; the source map is not touched.

    python tools/remove_trees.py <out.png> x0,y0,x1,y1 [x0,y0,x1,y1 ...]
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

src_path = 'source/maps/1-original.png'
out_path, boxes = sys.argv[1], [tuple(int(v) for v in b.split(',')) for b in sys.argv[2:]]
img = np.asarray(Image.open(src_path).convert('RGB')).astype(float)
H, W = img.shape[:2]
R, G, B = img[..., 0], img[..., 1], img[..., 2]
light = (img.min(2) > 105) & (np.ptp(img, 2) < 70)                  # birch leaves, bark, stones
dirt = (R > G + 15) & (G > B + 15) & (R > 150)                       # path and bare ground
water = (B > R + 40) & (B > G - 10) & (B > 120)
stone = (np.ptp(img, 2) < 40) & (img.min(2) > 70)                    # grey cliffs and rocks
bad = nd.binary_dilation(dirt | water | stone, iterations=2)

# Tower pads must stay intact: ring centres and widths as in game.js (padRings).
PADS = [(728.5,178.5,96),(944.5,178,96),(405.5,415.5,98),(1269,416.5,97),
        (123,539.5,99),(1545.5,540.5,98),(157.5,740,100),(1520,740.5,99)]
yy, xx = np.mgrid[0:H, 0:W]
protect = np.zeros((H, W), bool)
for px, py, pw in PADS:
    protect |= ((xx - px) / (pw / 2 + 8)) ** 2 + ((yy - py) / (pw * .39 + 8)) ** 2 <= 1

masks = []
for x0, y0, x1, y1 in boxes:
    box = np.zeros((H, W), bool); box[y0:y1, x0:x1] = True
    m = nd.binary_closing(light & box & ~protect, iterations=3)
    lab, n = nd.label(m)
    sizes = nd.sum(m, lab, range(1, n + 1))
    m = np.isin(lab, 1 + np.nonzero(sizes >= max(120, sizes.max() * .02))[0])
    m = nd.binary_fill_holes(nd.binary_closing(m, iterations=3))
    m = nd.binary_dilation(m & box & ~protect, iterations=4) & ~protect   # may spill past the box so edges blend
    masks.append(m)
all_trees = np.any(masks, axis=0)
used = np.zeros((H, W), bool)                                        # forest already copied once

out = img.copy()
for m in masks:
    ys, xs = np.nonzero(m)
    by0, by1, bx0, bx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    mm = m[by0:by1, bx0:bx1]
    ring = nd.binary_dilation(mm, iterations=5) & ~mm
    ring_full = np.zeros((H, W), bool); ring_full[by0:by1, bx0:bx1] = ring
    target = img[by0:by1, bx0:bx1]
    h, w = mm.shape
    best = None
    for sy in range(0, H - h, 5):
        for sx in range(0, W - w, 5):
            if abs(sx - bx0) < w and abs(sy - by0) < h: continue          # not from the tree itself
            if all_trees[sy:sy+h, sx:sx+w][mm].any() or used[sy:sy+h, sx:sx+w][mm].mean() > .1: continue
            frac = bad[sy:sy+h, sx:sx+w][mm].mean()
            if frac > .3: continue
            # Border match, plus a penalty for copying rocks, path or water into the forest.
            cost = ((img[sy:sy+h, sx:sx+w][ring] - target[ring]) ** 2).mean() + 30000 * frac
            if best is None or cost < best[0]: best = (cost, sy, sx)
    _, sy, sx = best
    used[sy:sy+h, sx:sx+w] |= mm
    print(f'tree at {bx0},{by0} {w}x{h} <- forest from {sx},{sy}')
    a = nd.gaussian_filter(mm.astype(float), 2.5)
    a = np.clip(a * 1.6, 0, 1)[..., None]
    out[by0:by1, bx0:bx1] = out[by0:by1, bx0:bx1] * (1 - a) + img[sy:sy+h, sx:sx+w] * a
Image.fromarray(out.round().astype(np.uint8)).save(out_path)
