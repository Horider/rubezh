"""Removes the painted cloth flag from flat tower images, keeping the pole.

The game then draws the waving pennant frames on top. The cloth is the blue
area right of the pole, grown over its dark outline and soft fringe; the
pole and its base are never touched. Near-invisible dust left around the tower by
the background cut-out (alpha below 16, away from the silhouette) is cleared too.
Reads source/towers/archers/flat/, writes the game sprite game/towers/archers/level-N.png.

    python tools/strip_flag.py tower-01-thatched.png [...]   (N is taken from the 0N in the name)
"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as nd

POLE_RIGHT, FLAG_BOTTOM, BASE_TOP = 650, 240, 172   # base of the pole starts at y≈172 next to the pole
src_dir, out_dir = 'source/towers/archers/flat/', 'game/towers/archers/'
os.makedirs(out_dir, exist_ok=True)
for name in sys.argv[1:]:
    a = np.asarray(Image.open(src_dir + name).convert('RGBA')).copy()
    H, W = a.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    area = (xx >= POLE_RIGHT) & (yy < FLAG_BOTTOM) & ~((xx < 672) & (yy >= BASE_TOP))
    rgb = a[..., :3].astype(int); alpha = a[..., 3]
    blue = (rgb[..., 2] > rgb[..., 0] + 30) & (alpha > 0) & area
    lab, n = nd.label(blue, structure=np.ones((3, 3)))
    cloth = lab == (np.argmax(nd.sum(blue, lab, range(1, n + 1))) + 1)
    cloth = nd.binary_fill_holes(nd.binary_closing(cloth, iterations=2))
    dark_or_soft = ((rgb.mean(2) < 90) | (alpha < 250)) & (alpha > 0)
    grown = cloth.copy()
    for _ in range(6):                               # take the outline and fringe around the cloth
        grown |= nd.binary_dilation(grown, structure=np.ones((3, 3))) & dark_or_soft & area
    grown |= nd.binary_dilation(cloth, iterations=1) & area   # orange patches and specks inside the edge
    grown = nd.binary_fill_holes(grown) & area
    a[grown] = 0
    # Loose bits of the old outline: anything in the flag area no longer joined to the tower body.
    body, _ = nd.label(a[..., 3] > 0, structure=np.ones((3, 3)))
    main = body == body[600, 630]
    a[area & (a[..., 3] > 0) & ~main] = 0
    # Thin outline threads still touching the pole top: nothing that thin belongs to the pole.
    part = area & (a[..., 3] > 0)
    thick = nd.binary_opening(part, structure=np.ones((3, 3)), iterations=2)
    a[part & ~nd.binary_dilation(thick, iterations=1)] = 0
    # Leftover specks.
    lab, n = nd.label(area & (a[..., 3] > 0), structure=np.ones((3, 3)))
    if n:
        sizes = nd.sum(np.ones_like(lab), lab, range(1, n + 1))
        a[np.isin(lab, 1 + np.nonzero(sizes < 80)[0])] = 0
        # Bits standing apart from the pole (all of it right of x 675) were flag too.
        for i, sl in enumerate(nd.find_objects(lab), 1):
            if sl is not None and sl[1].start > 675:
                a[lab == i] = 0
    # Dust: faint pixels not touching the tower body.
    al = a[..., 3]
    body = nd.binary_fill_holes(nd.binary_closing(al >= 128, iterations=3))
    a[(al < 16) & ~nd.binary_dilation(body, iterations=2)] = 0
    a[a[..., 3] == 0] = 0
    level = int(name.split('-')[1])
    # The pole comes from the pennant (its own drawing may sit a few px off the tower's).
    # In the pole's columns, tower pixels above the pennant's pole base would peek out: clear them.
    pen = np.asarray(Image.open(f'source/towers/archers/pennants/level-{level}/pennant.png').convert('RGBA'))[..., 3] >= 128
    for x in range(560, POLE_RIGHT):
        ys = np.nonzero(pen[:240, x])[0]
        if len(ys): a[:ys.max() - 3, x] = 0
    a[:168, 540:700] = 0                                  # above the pole's plinth only the pennant draws
    Image.fromarray(a).save(out_dir + f'level-{level}.png', optimize=True)
    print(name, 'cloth px removed', int(grown.sum()))
