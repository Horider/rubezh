"""Builds a looping waving-flag animation from a tower's pennant module.

The pole stays put; the cloth to the right of it waves with a wave running
from the pole to the tail: still where it is tied, strongest at the tip.
Folds facing up get lighter, folds facing down darker. Pixels are taken
without smoothing to keep the crisp pixel look, and the dark outline is
redrawn (3 px, as drawn) after bending so the fill never shows past it. Every frame keeps the
module's 1254 × 1254 canvas, so it replaces 04-pennant.png one to one.

    python tools/make_pennant.py <04-pennant.png> <out dir> [--amp 9] [--wave 200]
    e.g. ... source/towers/archers/pennants/level-3/pennant.png game/towers/archers/pennant/level-3
"""
import argparse, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

FRAMES = 5

ap = argparse.ArgumentParser()
ap.add_argument('src'); ap.add_argument('out')
ap.add_argument('--pole-right', type=int, default=650, help='x where the cloth leaves the pole')
ap.add_argument('--amp', type=float, default=7, help='vertical swing at the tip, px')
ap.add_argument('--wave', type=float, default=200, help='wave length along the cloth, px')
a = ap.parse_args()

img = np.asarray(Image.open(a.src).convert('RGBA')).astype(float)
H, W = img.shape[:2]
alpha = img[..., 3] > 0
xs = np.nonzero(alpha.any(0))[0]
tip = xs.max()
yy, xx = np.mgrid[0:H, 0:W].astype(float)
reach = np.clip((xx - a.pole_right) / (tip - a.pole_right), 0, 1)
weight = reach ** 1.3
k = 2 * np.pi / a.wave

# Outline colour of the cloth: the opaque pixels that touch transparency.
solid = img[..., 3] >= 128
rim = nd.binary_dilation(~solid) & solid & (xx >= a.pole_right)
OUTLINE = np.median(img[rim][:, :3], 0)
CROSS = [[0, 1, 0], [1, 1, 1], [0, 1, 0]]

os.makedirs(a.out, exist_ok=True)
for f in range(FRAMES):
    ph = 2 * np.pi * f / FRAMES
    arg = ph - k * (xx - a.pole_right)
    dy = a.amp * weight * np.sin(arg)
    sy = np.clip(np.round(yy - dy).astype(int), 0, H - 1)
    sx = xx.astype(int)
    out = img[sy, sx].copy()
    slope = a.amp * weight * np.cos(arg) * k            # d(dy)/dx: >0 means the cloth dips to the right
    shade = 1 - .6 * slope * (reach > 0)
    out[..., :3] = np.clip(out[..., :3] * np.clip(shade, .88, 1.12)[..., None], 0, 255)
    # Redraw the outline: any light cloth pixel within 3 px of the empty background turns outline colour.
    op = out[..., 3] >= 128
    near_edge = nd.binary_dilation(~op, structure=CROSS, iterations=3) & op & (xx >= a.pole_right)
    light = out[..., :3].mean(2) > OUTLINE.mean() + 25
    fix = near_edge & light
    out[fix, :3] = OUTLINE; out[fix, 3] = 255
    pole = xx < a.pole_right                            # the pole never moves
    out[pole] = img[pole]
    Image.fromarray(out.round().astype(np.uint8)).save(f'{a.out}/frame-{f+1:02d}.png', optimize=True)
print('frames ->', a.out)
