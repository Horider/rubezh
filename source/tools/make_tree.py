"""Builds a looping PNG animation of a tree crown painted on the map.

The crown (light, low-saturation leaves) is found inside a rectangle, then
swayed sideways: still at the trunk fork, strongest at the top. Leaf clusters
also shimmer slightly. Uncovered pixels are filled from the nearest non-crown
pixels, and pixels outside the crown stay identical to the map.

    python tools/make_tree.py <name> x0,y0,x1,y1 [--amp 1.8] [--pivot 0.78]
Prints the JSON position of the frames on the map.
"""
import argparse, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

FRAMES = 5

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('name'); ap.add_argument('box')
    ap.add_argument('--amp', type=float, default=1.8)
    ap.add_argument('--pivot', type=float, default=.78, help='fork height as a share of the crown mask height')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--min-blob', type=int, default=150, help='smallest light patch kept as foliage, px')
    ap.add_argument('--map', default='source/maps/1-original.png'); ap.add_argument('--out', default='game/map-anim')
    a = ap.parse_args()
    x0, y0, x1, y1 = (int(v) for v in a.box.split(','))
    full = np.asarray(Image.open(a.map).convert('RGB')).astype(float)
    pad = 4
    X0, Y0 = max(0, x0 - pad), max(0, y0 - pad)
    X1, Y1 = min(full.shape[1], x1 + pad), min(full.shape[0], y1 + pad)
    img = full[Y0:Y1, X0:X1]; h, w = img.shape[:2]
    box = np.zeros((h, w), bool); box[y0-Y0:y1-Y0, x0-X0:x1-X0] = True
    # Sunlit leaves are near white; shaded ones are blue-grey (B >= G), unlike the greenery around.
    light = (img.min(2) > 105) & (np.ptp(img, 2) < 60) & (img[..., 2] >= img[..., 1] - 8) & box
    m = nd.binary_closing(light, iterations=2)
    lab, n = nd.label(m)
    sizes = nd.sum(m, lab, range(1, n + 1))
    m = np.isin(lab, 1 + np.nonzero(sizes >= max(a.min_blob, sizes.max() * .02))[0])   # crown plus shaded clusters
    crown = nd.binary_fill_holes(nd.binary_closing(m, iterations=2)) & box
    crown = nd.binary_dilation(crown) & box       # keep the dark outline with the leaves
    ys, xs = np.nonzero(crown)
    top, bottom = ys.min(), ys.max()
    pivot = top + a.pivot * (bottom - top)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    weight = np.clip((pivot - yy) / (pivot - top), 0, 1) ** 1.2

    idx = nd.distance_transform_edt(crown, return_distances=False, return_indices=True)
    back = np.where(crown[..., None], nd.uniform_filter(img[idx[0], idx[1]], (3, 3, 1)), img)
    rng = np.random.default_rng(a.seed)
    shimmer = nd.gaussian_filter(rng.uniform(0, 2 * np.pi, (h, w)), 3)
    shimmer = (shimmer - shimmer.min()) / (np.ptp(shimmer) + 1e-6) * 4 * np.pi
    region = nd.binary_dilation(crown, iterations=3)

    os.makedirs(f'{a.out}/{a.name}', exist_ok=True)
    for f in range(FRAMES):
        t = 2 * np.pi * f / FRAMES
        dx = a.amp * weight * (np.sin(t) + .25 * np.sin(t * 2 + yy * .08))
        dy = -.25 * a.amp * weight * np.abs(np.sin(t))   # leaves lift a little at the ends of the swing
        sx, sy = xx - dx, yy - dy
        warped = np.stack([nd.map_coordinates(img[..., c], [sy, sx], order=1, mode='nearest') for c in range(3)], -1)
        wm = nd.map_coordinates(crown.astype(float), [sy, sx], order=1, mode='constant')
        shade = 1 + .07 * np.sin(t + shimmer) * (.3 + weight)
        warped = np.clip(warped * shade[..., None], 0, 255)
        out = back * (1 - wm[..., None]) + warped * wm[..., None]
        rgba = np.dstack([out, region * 255.]).round().astype(np.uint8)
        Image.fromarray(rgba).save(f'{a.out}/{a.name}/frame-{f+1:02d}.png', optimize=True)
    print(json.dumps({'name': a.name, 'x': X0, 'y': Y0, 'w': w, 'h': h}))

main()
