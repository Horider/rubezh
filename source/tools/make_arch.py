"""Builds a looping PNG animation for a ruined stone arch painted on the map.

The doorway gets a soft pulsing glow with light rising through it, and a few
fireflies circle around it. Stone pixels inside the doorway keep their colour,
so the glow seems to sit behind the masonry. Pixels with nothing added are
identical to the map.

    python tools/make_arch.py <name> --door x0,top,x1,bottom [--fireflies 6]
The door top is the highest point of its rounded opening, in map pixels.
Prints the JSON position of the frames on the map.
"""
import argparse, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

FRAMES = 5
GLOW = np.array([120, 245, 225.])
FLY = np.array([255, 238, 150.])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name'); ap.add_argument('--door', required=True)
    ap.add_argument('--fireflies', type=int, default=6)
    ap.add_argument('--margin', type=int, default=12)
    ap.add_argument('--glow', type=float, default=.65, help='glow strength in the doorway')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--map', default='source/maps/1-original.png'); ap.add_argument('--out', default='game/map-anim')
    a = ap.parse_args()
    dx0, dtop, dx1, dbot = (int(v) for v in a.door.split(','))
    full = np.asarray(Image.open(a.map).convert('RGB')).astype(float)
    M = a.margin
    X0, Y0 = max(0, dx0 - M), max(0, dtop - M)
    X1, Y1 = min(full.shape[1], dx1 + M), min(full.shape[0], dbot + 4)
    img = full[Y0:Y1, X0:X1]; h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    cx, r = (dx0 + dx1) / 2 - X0, (dx1 - dx0) / 2
    top = dtop - Y0 + r - np.sqrt(np.clip(r * r - (xx - cx) ** 2, 0, None))   # rounded head of the doorway
    door = (np.abs(xx - cx) <= r) & (yy >= top) & (yy <= dbot - Y0)
    stone = (np.ptp(img, 2) < 38) & (img.min(2) > 85)
    door = nd.gaussian_filter((door & ~stone).astype(float), 1.2)
    depth = np.clip((yy - (dtop - Y0)) / max(1, dbot - dtop), 0, 1)          # brighter towards the ground

    rng = np.random.default_rng(a.seed)
    rise = nd.gaussian_filter(rng.uniform(size=(h, w)), (2.5, 1.2), mode='wrap')   # wraps so the loop is seamless
    rise = (rise - rise.min()) / np.ptp(rise)
    flies = [dict(c=(cx + rng.uniform(-r - 6, r + 6), (dtop - Y0) + rng.uniform(.25, .9) * (dbot - dtop)),
                  rad=rng.uniform(2.5, 5), ph=rng.uniform(0, 2 * np.pi), dir=rng.choice([-1, 1]),
                  tw=rng.uniform(0, 2 * np.pi)) for _ in range(a.fireflies)]

    os.makedirs(f'{a.out}/{a.name}', exist_ok=True)
    for f in range(FRAMES):
        t = 2 * np.pi * f / FRAMES
        shift = int(round(f * h / FRAMES))
        motes = np.roll(rise, -shift, axis=0)                                  # light drifts upwards
        pulse = .55 + .22 * np.sin(t)
        g = door * pulse * (.35 + .65 * depth) * (.7 + .6 * motes)
        light = np.zeros((h, w))
        for fl in flies:
            ang = fl['ph'] + fl['dir'] * t
            px, py = fl['c'][0] + fl['rad'] * np.cos(ang), fl['c'][1] + .6 * fl['rad'] * np.sin(ang)
            d2 = (xx - px) ** 2 + (yy - py) ** 2
            b = .55 + .45 * np.sin(t * 2 + fl['tw'])
            light += b * (np.exp(-d2 / 1.3) + .5 * np.exp(-d2 / 9))
        light = np.clip(light, 0, 1)
        out = img + (GLOW - img) * np.clip(g * a.glow, 0, .8)[..., None]                       # glow in the doorway
        out = out + (FLY - out) * light[..., None]                            # fireflies over everything
        rgba = np.dstack([np.clip(out, 0, 255), np.full((h, w), 255.)]).round().astype(np.uint8)
        Image.fromarray(rgba).save(f'{a.out}/{a.name}/frame-{f+1:02d}.png', optimize=True)
    print(json.dumps({'name': a.name, 'x': X0, 'y': Y0, 'w': w, 'h': h}))

main()
