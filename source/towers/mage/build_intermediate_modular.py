"""Split the repaired straw tower and animate only its separate spire layer."""

from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent / "modular" / "level-intermediate"
SOURCE = ROOT / "tower-source.png"
SIZE = (1254, 1254)
NAMES = ("01-base.png", "02-upper-room.png", "03-roof.png", "04-spire.png")
SPIRE_BOX = (575, 0, 685, 252)
SOCKET_TOP = 181  # copper collar and wooden throat below this line stay fixed
SCALES = (1.0, 1.08, 1.17, 1.27, 1.12)
HEIGHT_SCALES = (1.0, 1.025, 1.05, 1.08, 1.04)
ENERGY = (0.0, 0.23, 0.46, 0.76, 1.0)


def profile(points):
    xs, ys = zip(*points)
    return np.rint(np.interp(np.arange(SIZE[0]), xs, ys)).astype(np.int16)


def split(source):
    pixels = np.asarray(source)
    y = np.arange(SIZE[1], dtype=np.int16)[:, None]
    roof_edge = profile([(290, 570), (350, 590), (500, 635), (630, 658),
                         (750, 635), (900, 590), (965, 570)])
    base_edge = profile([(290, 755), (350, 805), (500, 845), (630, 868),
                         (750, 845), (900, 805), (965, 755)])
    owner = np.zeros(SIZE[::-1], dtype=np.uint8)
    owner[y < base_edge[None, :]] = 1
    owner[y < roof_edge[None, :]] = 2
    owner[SPIRE_BOX[1]:SPIRE_BOX[3], SPIRE_BOX[0]:SPIRE_BOX[2]] = 3
    parts = []
    for index, name in enumerate(NAMES):
        data = pixels.copy()
        data[owner != index] = 0
        image = Image.fromarray(data, "RGBA")
        path = ROOT / "parts" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path)
        parts.append(image)
    return parts


def charge(spire, frame):
    if frame == 0:
        return spire.copy()
    box = spire.getbbox()
    assert box is not None
    left, top, right, bottom = box
    center = (left + right) // 2
    energy = ENERGY[frame]
    straw = spire.crop((left, top, right, SOCKET_TOP))
    width = round(straw.width * SCALES[frame])
    # The straw spire has less headroom than level 1's crystal; keep its tip intact.
    height = round(straw.height * HEIGHT_SCALES[frame])
    straw = straw.resize((width, height), Image.Resampling.NEAREST)
    pixels = np.asarray(straw).copy()
    visible = pixels[:, :, 3] > 0
    rgb = pixels[:, :, :3].astype(np.float32)
    tint = np.array((190, 75, 250), dtype=np.float32)
    blend = energy * .16
    rgb = rgb * (1 - blend) + tint * blend
    rgb += np.array((16, 8, 25)) * energy
    pixels[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    pixels[~visible, :3] = 0
    straw = Image.fromarray(pixels, "RGBA")

    out = Image.new("RGBA", SIZE)
    x = center - width // 2
    y = SOCKET_TOP - height

    halo = Image.new("RGBA", SIZE)
    hd = ImageDraw.Draw(halo)
    for radius, alpha in ((65, 14), (45, 23), (25, 34)):
        r = round(radius * (0.7 + energy * 0.5))
        hd.ellipse((center-r, y+height//2-r, center+r, y+height//2+r),
                   fill=(166, 65, 248, round(alpha * energy)))
    out.alpha_composite(halo)
    out.alpha_composite(spire.crop((0, SOCKET_TOP, SIZE[0], bottom)),
                        (0, SOCKET_TOP))
    out.alpha_composite(straw, (x, y))

    marks = Image.new("RGBA", SIZE)
    draw = ImageDraw.Draw(marks)
    if frame >= 2:
        points = ((center-55, y+height//3), (center+61, y+height//2),
                  (center-29, y-11), (center+31, y+12))
        for i, (sx, sy) in enumerate(points[:frame]):
            color = (255, 224, 133, 190) if i % 2 else (226, 149, 255, 205)
            draw.line((sx-4, sy, sx+4, sy), fill=color, width=3)
            draw.line((sx, sy-4, sx, sy+4), fill=color, width=3)
    if frame == 4:
        orb_y = max(10, y-15)
        draw.ellipse((center-15, orb_y-15, center+15, orb_y+15), fill=(108, 38, 183, 222))
        draw.ellipse((center-9, orb_y-9, center+9, orb_y+9), fill=(219, 150, 255, 250))
        draw.ellipse((center-4, orb_y-4, center+4, orb_y+4), fill=(255, 242, 214, 255))
    out.alpha_composite(marks)
    return out


def main():
    source = Image.open(SOURCE).convert("RGBA")
    if source.size != SIZE:
        raise ValueError(f"Unexpected canvas: {source.size}")
    clean = np.asarray(source).copy()
    clean[clean[:, :, 3] == 0, :3] = 0
    source = Image.fromarray(clean, "RGBA")
    source.save(SOURCE)
    parts = split(source)
    assembled = Image.new("RGBA", SIZE)
    for part in parts:
        assembled.alpha_composite(part)
    if not np.array_equal(np.asarray(assembled), np.asarray(source)):
        raise AssertionError("Four parts did not reconstruct the source exactly")
    assembled.save(ROOT / "tower-assembled.png")

    strip = Image.new("RGBA", (SIZE[0]*5, SIZE[1]))
    preview = Image.new("RGBA", (240*5, 360), "#20242e")
    for index in range(5):
        spire = charge(parts[3], index)
        charge_path = ROOT / "spire-charge" / f"frame-{index+1:02d}.png"
        charge_path.parent.mkdir(parents=True, exist_ok=True)
        spire.save(charge_path)
        tower = Image.new("RGBA", SIZE)
        for part in parts[:3]:
            tower.alpha_composite(part)
        tower.alpha_composite(spire)
        tower_path = ROOT / "tower-charge" / f"frame-{index+1:02d}.png"
        tower_path.parent.mkdir(parents=True, exist_ok=True)
        tower.save(tower_path)
        strip.alpha_composite(spire, (index*SIZE[0], 0))
        crop = tower.crop((500, 0, 760, 390)).resize((240, 360), Image.Resampling.NEAREST)
        preview.alpha_composite(crop, (index*240, 0))
    strip.save(ROOT / "spire-charge" / "sheet.png")
    preview.convert("RGB").save(ROOT / "preview.png")
    (ROOT / "manifest.json").write_text(json.dumps({
        "schema": "mage-intermediate-modular-v1",
        "canvas_px": [1254, 1254],
        "order_back_to_front": [f"parts/{name}" for name in NAMES],
        "charge_frames": 5,
        "charge_layer": "spire-charge/frame-{01..05}.png",
        "assembled_charge": "tower-charge/frame-{01..05}.png",
        "next_effects": ["assets/magic-orb-v2", "assets/magic-ground-v2"],
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Built four lossless layers and five spire-only charge frames.")


if __name__ == "__main__":
    main()
