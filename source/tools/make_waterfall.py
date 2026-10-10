"""Builds a looping PNG animation for one waterfall painted on the map.

The frames are the map's own pixels, cropped to the water and given moving
streaks and foam. Each frame is RGBA with the same size and canvas offset,
so the game draws it at (x, y) from the printed JSON without scaling.

    python tools/make_waterfall.py <name> <x0> <y0> <x1> <y1> --sheet x0,y0,x1,y1 ... --foam x0,y0,x1,y1 ...
Rectangles are in map pixels; the first one is the crop.
"""
import argparse, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

FRAMES = 5

def rect(s): return tuple(int(v) for v in s.split(','))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name'); ap.add_argument('crop', type=rect)
    ap.add_argument('--sheet', type=rect, action='append', default=[])
    ap.add_argument('--foam', type=rect, action='append', default=[])
    ap.add_argument('--period', type=int, default=30)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--map', default='source/maps/1-original.png')
    ap.add_argument('--out', default='game/map-anim')
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    X0, Y0, X1, Y1 = a.crop
    img = np.asarray(Image.open(a.map).convert('RGB')).astype(float)[Y0:Y1, X0:X1]
    h, w = img.shape[:2]
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    water = ((B > R + 30) & (B > 90)) | ((img.min(2) > 195) & (B >= R))

    def area(rects):
        m = np.zeros((h, w), bool)
        for x0, y0, x1, y1 in rects: m[y0-Y0:y1-Y0, x0-X0:x1-X0] = True
        return m
    sheet = nd.binary_opening(water & area(a.sheet))
    foam = nd.binary_opening(water & area(a.foam))
    sheet_a = nd.gaussian_filter(sheet.astype(float), .6)
    foam_a = nd.gaussian_filter(foam.astype(float), .8)

    # Periodic streak texture: P rows tall, wraps vertically.
    P = a.period
    tex = np.zeros((P, w))
    for x in range(w):
        for _ in range(2):
            y, ln, v = rng.integers(P), rng.integers(5, 13), rng.uniform(-.55, .85)
            for k in range(ln):
                tex[(y + k) % P, x] += v * np.sin(np.pi * (k + .5) / ln)
    tex = nd.gaussian_filter1d(tex, .7, axis=1, mode='wrap')
    tex = nd.gaussian_filter1d(tex, .8, axis=0, mode='wrap')
    blobs = [rng.uniform(0, 1, (h, w)) for _ in range(FRAMES)]

    light = np.array([238, 250, 255.]); dark = np.array([40, 120, 170.])
    os.makedirs(f'{a.out}/{a.name}', exist_ok=True)
    alpha = np.maximum(sheet_a, foam_a)
    ys, xs = np.nonzero(alpha > .02)
    bx0, by0, bx1, by1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    for f in range(FRAMES):
        rows = (np.arange(h)[:, None] - f * P / FRAMES) % P
        t = tex[rows.astype(int), np.arange(w)[None, :]][..., None]
        out = img.copy()
        s = sheet_a[..., None]
        out = out + s * (np.clip(t, 0, 1) * (light - out) * .75 + np.clip(-t, 0, 1) * (dark - out) * .5)
        fz = nd.gaussian_filter(blobs[f], 1.2)
        fz = np.clip((fz - .5) * 9, -1, 1)[..., None] * foam_a[..., None]
        out = out + np.clip(fz, 0, 1) * (light - out) * .8 + np.clip(-fz, 0, 1) * (dark - out) * .25
        rgba = np.dstack([np.clip(out, 0, 255), alpha * 255]).round().astype(np.uint8)
        Image.fromarray(rgba[by0:by1, bx0:bx1]).save(f'{a.out}/{a.name}/frame-{f+1:02d}.png', optimize=True)
    print(json.dumps({'name': a.name, 'x': int(X0 + bx0), 'y': int(Y0 + by0), 'w': int(bx1 - bx0), 'h': int(by1 - by0), 'frames': FRAMES}))

main()
