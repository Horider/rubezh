"""Rounds road corners along hand-drawn red strokes and patches white holes.

The input map has red strokes painted along the road edge where the edge
should run, and white rectangles where pieces were cut out. Each stroke
becomes the new road edge; the strip around it is repainted from straight
stretches of the same road (dirt, dark rim, pebbles, grass), picked by the
direction the edge faces. White holes are filled with matching forest
cloned from elsewhere on the map.

    python tools/rework_road.py <in.png> <out.png> [<original.png>]
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

src, dst = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(src).convert('RGB')).astype(float)
H, W = img.shape[:2]
R, G, B = img[..., 0], img[..., 1], img[..., 2]
yy, xx = np.mgrid[0:H, 0:W]

red = (R > 100) & (G < 45) & (B < 45) & (R > G + 60)
lab, n = nd.label(nd.binary_dilation(red, iterations=1))
strokes = [lab == i for i, s in enumerate(nd.find_objects(lab), 1)
           if (s[0].stop - s[0].start) + (s[1].stop - s[1].start) > 60]
red_all = nd.binary_dilation(red, iterations=2)
# Cut-out holes are flat white rectangles (waterfall foam is white too, but not a solid block).
pure = img.min(2) >= 254
wl, n = nd.label(pure)
keep = 1 + np.nonzero(nd.sum(pure, wl, range(1, n + 1)) > 1200)[0]
white = nd.binary_dilation(np.isin(wl, keep), iterations=1)

# Under the paint the map is unchanged, so the original map gives back the exact pixels.
orig = np.asarray(Image.open(sys.argv[3] if len(sys.argv) > 3 else 'source/maps/1-original.png').convert('RGB')).astype(float)
img = img.copy(); img[red_all] = orig[red_all]
R, G, B = img[..., 0], img[..., 1], img[..., 2]

# Road mask, with the paint under the strokes decided by the neighbours.
dirt = (R > G + 12) & (G > B + 12) & (R > 150)
known = ~red_all
dsm = nd.gaussian_filter((dirt & known).astype(float), 3) / np.maximum(nd.gaussian_filter(known.astype(float), 3), 1e-3)
dirt = np.where(known, dirt, dsm > .5)
lab, _ = nd.label(nd.binary_closing(dirt, iterations=2))
road = lab == lab[333, 835]
road = nd.binary_opening(nd.binary_closing(road, iterations=3), iterations=2)
core = nd.binary_erosion(road, iterations=18)

# Copy of the map with the red paint diffused away, used as the colour source.
clean = img.copy()
if red_all.any():
    _, (iy, ix) = nd.distance_transform_edt(red_all, return_indices=True)
    clean[red_all] = img[iy, ix][red_all]
    for _ in range(3):
        clean[red_all] = nd.uniform_filter(clean, (5, 5, 1))[red_all]

# A straight stretch of real road edge is used as a texture strip and bent along each stroke.
# Strip: top edge of the main road (road below), columns STRIP_X; rows run outward from the edge.
STRIP_X = (430, 700)
cols = np.arange(*STRIP_X)
edge_y = np.array([np.nonzero(road[260:340, x])[0].min() + 260 for x in cols])
edge_y = nd.median_filter(edge_y, 21).astype(float)
DIN, DOUT = 34, 26                               # rows into the road / out into the grass
strip = np.stack([np.stack([img[int(edge_y[i]) - d, x] for d in range(-DIN, DOUT)]) for i, x in enumerate(cols)], 1)
L = strip.shape[1]

_sd_old = nd.distance_transform_edt(~road) - nd.distance_transform_edt(road)
def sd0(q): return _sd_old[int(round(q[0])), int(round(q[1]))]

def centreline(m):
    """Ordered, smoothed centre points of a thick stroke."""
    pts = np.argwhere(m); c = pts.mean(0)
    start = pts[np.argmax(((pts - c) ** 2).sum(1))]
    # geodesic distance from one end, through the stroke
    dist = np.full(m.shape, -1); dist[tuple(start)] = 0; front = [tuple(start)]
    while front:
        nxt = []
        for y, x in front:
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy2, xx2 = y + dy, x + dx
                    if 0 <= yy2 < m.shape[0] and 0 <= xx2 < m.shape[1] and m[yy2, xx2] and dist[yy2, xx2] < 0:
                        dist[yy2, xx2] = dist[y, x] + 1; nxt.append((yy2, xx2))
        front = nxt
    g = dist[pts[:, 0], pts[:, 1]]
    line = np.array([pts[(g >= b) & (g < b + 3)].mean(0) for b in range(0, g.max() + 1, 3) if ((g >= b) & (g < b + 3)).any()])
    line = nd.gaussian_filter1d(line, 2, axis=0, mode='nearest')
    # Carry each end on along its direction until it meets the old road edge,
    # so the new edge joins the old one instead of stopping in the middle of the road or grass.
    def extend(pts, tail):
        p, d = pts[-1], pts[-1] - pts[-min(6, len(pts))]
        d = d / (np.linalg.norm(d) + 1e-6); added = []; best = (abs(sd0(p)), 0)
        for k in range(1, 46):
            q = p + d * k
            if not (0 <= q[0] < H - 1 and 0 <= q[1] < W - 1): break
            added.append(q); v = abs(sd0(q))
            if v < best[0]: best = (v, k)
            if v <= 1.5: break
        return pts if best[0] > 3 or best[1] == 0 else np.vstack([pts, np.array(added[:best[1]])])
    def trim(pts):   # drop a tail that dives into the road instead of meeting its edge
        while len(pts) > 8 and sd0(pts[-1]) < -4 and sd0(pts[-1]) < sd0(pts[-3]) - .5:
            pts = pts[:-1]
        return pts
    line = trim(trim(line)[::-1])[::-1]
    line = extend(line, True)[::-1]
    line = extend(line, True)[::-1]
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(line, axis=0).T))]
    return line, seg

# Strokes on the lower bends stop short of the old edge on both ends, and bending the edge
# there leaves torn dirt; those bends keep their shape and only lose the paint.
strokes = [st for st in strokes if np.argwhere(st)[:, 0].min() <= 500]
new_road = road.copy(); out = img.copy(); acc = np.zeros((H, W, 3)); accw = np.zeros((H, W))
zones = np.zeros((H, W), bool)
for k, st in enumerate(strokes):
    line, seg = centreline(st)
    # dense resample
    sgrid = np.arange(0, seg[-1], .5)
    P = np.stack([np.interp(sgrid, seg, line[:, 0]), np.interp(sgrid, seg, line[:, 1])], 1)
    T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1)[:, None]
    N = np.stack([-T[:, 1], T[:, 0]], 1)            # left normal (y, x)
    near = np.zeros((H, W), bool); near[np.round(P[:, 0]).astype(int), np.round(P[:, 1]).astype(int)] = True
    dist, (iy, ix) = nd.distance_transform_edt(~near, return_indices=True)
    zone = dist < 34
    py, px = np.nonzero(zone)
    # nearest resampled point for each zone pixel
    lut = -np.ones((H, W), int); lut[np.round(P[:, 0]).astype(int), np.round(P[:, 1]).astype(int)] = np.arange(len(P))
    j = lut[iy[py, px], ix[py, px]]
    rel = np.stack([py - P[j, 0], px - P[j, 1]], 1)
    side = (rel * N[j]).sum(1)
    # which side is the road: the side holding more of the road core nearby
    votes = 0
    for t in range(8, 32, 3):                   # count old road on each side along the whole stroke
        for sgn in (1, -1):
            q = np.clip((P + N * t * sgn).round().astype(int), 0, [H - 1, W - 1])
            votes += sgn * road[q[:, 0], q[:, 1]].sum()
    road_left = votes > 0
    dout = -side if road_left else side          # >0 away from the road
    along = sgrid[j]
    endfade = np.clip(np.minimum(along, sgrid[-1] - along) / 14, 0, 1)
    inside_ends = (j > 0) & (j < len(P) - 1)
    keep = inside_ends & (np.abs(dout) < 34)
    py, px, dout, along, endfade = py[keep], px[keep], dout[keep], along[keep], endfade[keep]
    nr = dout < 0
    new_road[py, px] = np.where(endfade > .5, nr, road[py, px])
    # sample the bent strip (bilinear)
    u = (along + k * 53) % (L - 1); v = np.clip(dout + DIN, 0, DIN + DOUT - 1.001)
    u0, v0 = np.floor(u).astype(int), np.floor(v).astype(int); fu, fv = (u - u0)[:, None], (v - v0)[:, None]
    col = (strip[v0, u0] * (1 - fu) * (1 - fv) + strip[v0, u0 + 1] * fu * (1 - fv)
           + strip[v0 + 1, u0] * (1 - fu) * fv + strip[v0 + 1, u0 + 1] * fu * fv)
    changed_px = nr != road[py, px]
    w = endfade * np.clip((24 - np.abs(dout)) / 8, 0, 1)      # full near the edge, fading by 24 px
    w = np.where(dout > 0, w * np.clip((15 - dout) / 6, 0, 1), w)   # existing grass beyond the pebbles stays
    w = np.where(changed_px | red_all[py, px], np.maximum(w, .999 * (endfade > 0)), w)
    acc[py, px] += col * w[:, None]; accw[py, px] += w
    zones[py, px] = True
wgt = np.clip(accw, 0, 1)
render = acc / np.maximum(accw, 1e-6)[..., None]
wgt = np.maximum(nd.gaussian_filter(wgt, 1.0), wgt)
out = img * (1 - wgt[..., None]) + render * wgt[..., None]
changed = new_road != road
sd_new = nd.distance_transform_edt(~new_road) - nd.distance_transform_edt(new_road)

# White holes: clone forest whose surroundings match best.
bad = nd.binary_dilation(road | new_road | ((np.ptp(img, 2) < 40) & (img.min(2) > 70)) | white | red_all, iterations=3)
# Road cut back into grass deeper than the pebble row: fill like a hole.
deep_cut = nd.binary_opening(road & ~new_road & (sd_new > 12), iterations=1)
lab, n = nd.label(white | deep_cut)
fills = []
for i in range(1, n + 1):
    if (lab == i).sum() < 20: continue
    m = nd.binary_dilation(lab == i, iterations=3) & ~(new_road & ~(lab == i))
    ys, xs = np.nonzero(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    mm = m[y0:y1, x0:x1]; h, w = mm.shape
    ring = nd.binary_dilation(mm, iterations=6) & ~mm
    tgt = out[y0:y1, x0:x1]
    best = None
    for sy in range(0, H - h, 4):
        for sx in range(0, W - w, 4):
            if abs(sx - x0) < w + 10 and abs(sy - y0) < h + 10: continue
            frac = bad[sy:sy+h, sx:sx+w][mm].mean()
            if frac > .2: continue
            cost = ((out[sy:sy+h, sx:sx+w][ring] - tgt[ring]) ** 2).mean() + 30000 * frac
            if best is None or cost < best[0]: best = (cost, sy, sx)
    _, sy, sx = best
    a = np.clip(nd.gaussian_filter(mm.astype(float), 2) * 1.7, 0, 1)[..., None]
    out[y0:y1, x0:x1] = tgt * (1 - a) + out[sy:sy+h, sx:sx+w] * a
    fills.append(m)
    print(f'hole {x0},{y0} {w}x{h} <- {sx},{sy}')

# Soften straight seams: around the border of a pasted or filled region, cross-fade the
# texture of each side mirrored across the border, so neither side ends in a hard line.
PADS = [(729.5,238.5,96),(943.5,234,96),(342.5,413.5,98),(1325,423.5,97),
        (123,539.5,99),(1545.5,540.5,98),(157.5,740,100),(1520,740.5,99)]
pad_area = np.zeros((H, W), bool)
for px_, py_, pw in PADS:
    pad_area |= ((xx - px_) / (pw / 2 + 6)) ** 2 + ((yy - py_) / (pw * .39 + 6)) ** 2 <= 1
def soften(out, inside, width=7):
    sd = nd.distance_transform_edt(~inside) - nd.distance_transform_edt(inside)      # >0 outside
    gy, gx = np.gradient(nd.gaussian_filter(sd, 2)); gn = np.hypot(gy, gx) + 1e-6
    band = (np.abs(sd) < width) & ~pad_area & ~nd.binary_dilation(new_road, iterations=2)
    py_, px_ = np.nonzero(band); d = sd[py_, px_]; ny_, nx_ = gy[py_, px_] / gn[py_, px_], gx[py_, px_] / gn[py_, px_]
    def at(dist):   # colour at signed distance dist along the normal through each pixel
        ty, tx = py_ + ny_ * (dist - d), px_ + nx_ * (dist - d)
        return np.stack([nd.map_coordinates(out[..., c], [ty, tx], order=1, mode='nearest') for c in range(3)], 1)
    a_in = at(-np.abs(d) - .5)        # mirrored into the inside
    a_out = at(np.abs(d) + .5)        # mirrored into the outside
    w = np.clip(.5 + d / (2 * width), 0, 1)[:, None]; w = w * w * (3 - 2 * w)
    res = out.copy(); res[py_, px_] = a_in * (1 - w) + a_out * w
    return res

# Rectangles the pads were pasted in: pixels equal to the original map shifted by the pad's move.
user = np.asarray(Image.open(src).convert('RGB')).astype(float)
for (dx_, dy_) in [(1, 60), (-1, 56), (-63, -2), (56, 7)]:
    shifted = np.roll(np.roll(orig, dy_, 0), dx_, 1)
    same = (np.abs(user - shifted).sum(2) < 6) & (np.abs(user - orig).sum(2) > 12)
    lab_, n_ = nd.label(nd.binary_closing(same, iterations=4))
    if not n_: continue
    big = lab_ == (np.argmax(nd.sum(same, lab_, range(1, n_ + 1))) + 1)
    sl = nd.find_objects(big.astype(int))[0]
    rect = np.zeros((H, W), bool); rect[sl] = True
    out = soften(out, rect)
for m in fills:
    out = soften(out, m)

# Moved pads: put the whole stone ring back from the original map (a pasted rectangle clipped one).
OLD_PADS = [((728.5, 178.5, 96), (1, 60)), ((944.5, 178, 96), (-1, 56)),
            ((405.5, 415.5, 98), (-63, -2)), ((1269, 416.5, 97), (56, 7))]
for (px_, py_, pw), (dx_, dy_) in OLD_PADS:
    ring = ((xx - px_ - dx_) / (pw / 2 + 5)) ** 2 + ((yy - py_ - dy_) / (pw * .39 + 5)) ** 2 <= 1
    a = np.clip(nd.gaussian_filter(ring.astype(float), 1.2) * 1.5, 0, 1)[..., None]
    out = out * (1 - a) + np.roll(np.roll(orig, dy_, 0), dx_, 1) * a

Image.fromarray(np.clip(out, 0, 255).round().astype(np.uint8)).save(dst)
print('strokes', len(strokes))
