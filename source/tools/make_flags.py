"""Builds a looping PNG animation of the cloth banners painted on the map.

Each banner is given as a rectangle in map pixels. Teal cloth inside it is
found by colour, its top edge stays pinned to the crossbar and the lower part
sways sideways with a travelling wave and moving light folds. Pixels that the
cloth uncovers are filled from the nearest non-cloth pixels.

    python tools/make_flags.py <name> --banner x0,y0,x1,y1 [--banner ...]
Prints the JSON position of the frames on the map.
"""
import argparse, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

FRAMES = 5

def rect(s): return tuple(int(v) for v in s.split(','))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name'); ap.add_argument('--banner', type=rect, action='append', required=True)
    ap.add_argument('--amp', type=float, default=1.6)
    ap.add_argument('--map', default='source/maps/1-original.png'); ap.add_argument('--out', default='game/map-anim')
    a = ap.parse_args()
    full = np.asarray(Image.open(a.map).convert('RGB')).astype(float)
    pad = 4
    X0 = max(0, min(b[0] for b in a.banner) - pad); Y0 = max(0, min(b[1] for b in a.banner) - pad)
    X1 = min(full.shape[1], max(b[2] for b in a.banner) + pad); Y1 = min(full.shape[0], max(b[3] for b in a.banner) + pad)
    img = full[Y0:Y1, X0:X1]; h, w = img.shape[:2]
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    teal = (B > R + 45) & (G > R + 35)

    cloth = np.zeros((h, w), bool); weight = np.zeros((h, w)); phase0 = np.zeros((h, w))
    for k, (x0, y0, x1, y1) in enumerate(a.banner):
        box = np.zeros((h, w), bool); box[y0-Y0:y1-Y0, x0-X0:x1-X0] = True
        m = nd.binary_fill_holes(nd.binary_closing(teal & box, iterations=1))
        lab, n = nd.label(m)
        if n: m = lab == (np.argmax(nd.sum(m, lab, range(1, n + 1))) + 1)
        m = nd.binary_dilation(m) & box            # include the dark outline
        ys, xs = np.nonzero(m)
        top = np.full(w, ys.max(), float)
        for x in np.unique(xs): top[x] = ys[xs == x].min()
        hgt = ys.max() - ys.min() + 1
        yy = np.arange(h)[:, None]
        wgt = np.clip((yy - top[None, :]) / hgt, 0, 1) ** 1.4
        weight = np.where(box, wgt, weight); phase0 = np.where(box, k * 1.7, phase0)
        cloth |= m

    # Background behind the cloth: nearest pixel that is not cloth.
    idx = nd.distance_transform_edt(cloth, return_distances=False, return_indices=True)
    back = img[idx[0], idx[1]]
    back = np.where(cloth[..., None], nd.uniform_filter(back, (3, 3, 1)), img)

    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    region = nd.binary_dilation(cloth, iterations=3)
    os.makedirs(f'{a.out}/{a.name}', exist_ok=True)
    for f in range(FRAMES):
        t = 2 * np.pi * f / FRAMES
        wave = np.sin(t - yy * .35 + phase0)
        dx = a.amp * weight * wave
        sx = xx - dx
        warped = np.stack([nd.map_coordinates(img[..., c], [yy, sx], order=1, mode='nearest') for c in range(3)], -1)
        wm = nd.map_coordinates(cloth.astype(float), [yy, sx], order=1, mode='constant')
        shade = 1 + .16 * np.cos(t - yy * .35 + phase0 + .8) * (.35 + weight)
        warped = np.clip(warped * shade[..., None], 0, 255)
        out = back * (1 - wm[..., None]) + warped * wm[..., None]
        alpha = region.astype(float)
        rgba = np.dstack([out, alpha * 255]).round().astype(np.uint8)
        Image.fromarray(rgba).save(f'{a.out}/{a.name}/frame-{f+1:02d}.png', optimize=True)
    print(json.dumps({'name': a.name, 'x': X0, 'y': Y0, 'w': w, 'h': h, 'frames': FRAMES}))

main()
