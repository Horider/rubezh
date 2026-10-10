"""Split the five aligned mage sprites into four lossless layers and glow frames.

Editable material lives in source/towers/mage/ (this script, pixel-v3/ drawings,
modular/ layers and previews). Drawings 1,2,3,5 are written to game levels 2–5.
The old drawing 0 remains in source; build_intermediate_modular.py creates game level 1.
"""

from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "pixel-v3"
OUTPUT = ROOT / "modular"
GAME = ROOT.parents[2] / "game" / "towers" / "mage"
GAME_LEVEL = {1: 2, 2: 3, 3: 4, 5: 5}   # old drawing 0 is archived in source, not used in game
SIZE = (1254, 1254)
LEVELS = (0, 1, 2, 3, 5)
PARTS = ("01-base.png", "02-upper-room.png", "03-roof.png", "04-crystal.png")
LABELS = ("Основание", "Верхний ярус", "Крыша", "Кристалл")

# Curved seams follow the bottom of the roof and the bottom of the balcony.
# Coordinates are shared by all 1254 px canvases and adjusted for each silhouette.
SEAMS = {
    0: {"roof": [(290, 555), (350, 565), (500, 620), (630, 645), (750, 620), (900, 565), (965, 555)],
        "base": [(290, 755), (350, 805), (500, 845), (630, 868), (750, 845), (900, 805), (965, 755)],
        "crystal": (580, 24, 682, 145)},
    1: {"roof": [(290, 510), (350, 540), (500, 600), (630, 625), (750, 600), (900, 540), (965, 510)],
        "base": [(290, 745), (350, 795), (500, 835), (630, 855), (750, 835), (900, 795), (965, 745)],
        "crystal": (580, 24, 684, 171)},
    2: {"roof": [(290, 500), (350, 535), (500, 585), (630, 610), (750, 585), (900, 535), (965, 500)],
        "base": [(290, 720), (350, 770), (500, 805), (630, 828), (750, 805), (900, 770), (965, 720)],
        "crystal": (575, 24, 681, 143)},
    3: {"roof": [(290, 525), (350, 560), (500, 605), (630, 638), (750, 605), (900, 560), (965, 525)],
        "base": [(290, 750), (350, 800), (500, 835), (630, 855), (750, 835), (900, 800), (965, 750)],
        "crystal": (555, 24, 698, 204)},
    5: {"roof": [(290, 570), (350, 610), (500, 650), (630, 680), (750, 650), (900, 610), (965, 570)],
        "base": [(290, 780), (350, 820), (500, 860), (630, 884), (750, 860), (900, 820), (965, 780)],
        "crystal": (525, 24, 726, 235)},
}


def profile(points):
    xs, ys = zip(*points)
    return np.rint(np.interp(np.arange(SIZE[0]), xs, ys)).astype(np.int16)


def crystal_mask(box):
    # The fourth layer holds the top crystal/finial. The hanging banner remains
    # with the base, so changing this layer never affects the fabric.
    shape = Image.new("1", SIZE)
    draw = ImageDraw.Draw(shape)
    draw.rectangle(box, fill=1)
    return np.asarray(shape, dtype=bool)


def bounds(image):
    box = image.getbbox()
    return list(box) if box else None


def shimmer(part, level, frame):
    if level == 0 or frame == 0 or frame == 4:
        return part.copy()
    pixels = np.asarray(part).copy()
    strength = (0, 0.48, 1, 0.48, 0)[frame]
    lift = (7 if level == 1 else 12 if level == 2 else 17 if level == 3 else 24) * strength
    rgb = pixels[:, :, :3].astype(np.float32)
    tint = np.array((lift, lift * (0.7 if level < 3 else 0.35), lift * (0.4 if level < 3 else 1.5)))
    pixels[:, :, :3] = np.clip(rgb + tint, 0, 255).astype(np.uint8)
    pixels[pixels[:, :, 3] == 0, :3] = 0
    return Image.fromarray(pixels, "RGBA")


def add_glow(image, cx, cy, radius, color, opacity):
    if opacity <= 0:
        return
    yy, xx = np.ogrid[-radius:radius, -radius:radius]
    strength = np.maximum(0, 1 - (xx * xx + yy * yy) / (radius * radius)) ** 2
    halo = np.zeros((radius * 2, radius * 2, 4), dtype=np.uint8)
    halo[:, :, :3] = color
    halo[:, :, 3] = np.rint(strength * opacity).astype(np.uint8)
    image.alpha_composite(Image.fromarray(halo, "RGBA"), (cx - radius, cy - radius))


def animated_tower(parts, level, frame):
    assembled = Image.new("RGBA", SIZE)
    for layer in parts[:3]:
        assembled.alpha_composite(layer)
    assembled.alpha_composite(shimmer(parts[3], level, frame))
    strength = (0, .48, 1, .48, 0)[frame]
    if strength:
        window_color = (255, 190, 95) if level <= 1 else (196, 103, 255)
        for x in (512, 742):
            add_glow(assembled, x, 690, 50, window_color, 34 * strength)
        if level > 0:
            crystal_color = (255, 178, 70) if level <= 2 else (194, 85, 255)
            crystal_y = {1: 85, 2: 83, 3: 109, 5: 121}[level]
            add_glow(assembled, 628, crystal_y, 85, crystal_color, (45 + 8 * level) * strength)
    return assembled


def split(level):
    source_path = SOURCE / f"mage-tower-level-{level}-pixel.png"
    source = Image.open(source_path).convert("RGBA")
    if source.size != SIZE:
        raise ValueError(f"Unexpected canvas: {source_path}: {source.size}")
    pixels = np.asarray(source).copy()
    # Generated transparent pixels can carry invisible RGB values. Normalize
    # those bytes so compositing remains exact without changing visible art.
    pixels[pixels[:, :, 3] == 0, :3] = 0
    y = np.arange(SIZE[1], dtype=np.int16)[:, None]
    config = SEAMS[level]
    roof_edge, base_edge = profile(config["roof"]), profile(config["base"])
    owner = np.zeros((SIZE[1], SIZE[0]), dtype=np.uint8)
    owner[y < base_edge[None, :]] = 1
    owner[y < roof_edge[None, :]] = 2
    owner[crystal_mask(config["crystal"])] = 3

    folder = OUTPUT / f"level-{level}"
    parts_dir = folder / "parts"
    anim_dir = folder / "crystal-anim"
    tower_anim_dir = folder / "tower-anim"
    parts_dir.mkdir(parents=True, exist_ok=True)
    anim_dir.mkdir(parents=True, exist_ok=True)
    tower_anim_dir.mkdir(parents=True, exist_ok=True)
    images = []
    for index, name in enumerate(PARTS):
        layer = pixels.copy()
        layer[owner != index] = 0
        image = Image.fromarray(layer, "RGBA")
        image.save(parts_dir / name)
        images.append(image)
    for index in range(5):
        shimmer(images[3], level, index).save(anim_dir / f"frame-{index + 1:02d}.png")
        animated_tower(images, level, index).save(tower_anim_dir / f"frame-{index + 1:02d}.png")

    assembled = Image.new("RGBA", SIZE)
    for image in images:
        assembled.alpha_composite(image)
    if not np.array_equal(np.asarray(assembled), pixels):
        raise AssertionError(f"Level {level} did not reassemble pixel for pixel")
    assembled.save(folder / "tower-assembled.png")
    if level in GAME_LEVEL:
        game = GAME / f"level-{GAME_LEVEL[level]}"
        game.mkdir(parents=True, exist_ok=True)
        for image, name in zip(images[:3], ("base.png", "upper.png", "roof.png")):
            image.save(game / name)
        for index in range(5):
            shimmer(images[3], level, index).save(game / f"crystal-{index + 1:02d}.png")
        assembled.save(game / "tower.png")
    return {name: bounds(image) for name, image in zip(PARTS, images)}


def overview(records):
    cell = 220
    sheet = Image.new("RGB", (cell * 5 + 30, cell * 5 + 86), "#182523")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 19)
    except OSError:
        font = ImageFont.load_default()
    for col, title in enumerate(("Сборка",) + LABELS):
        draw.text((14 + col * cell, 15), title, fill="#f4e4b7", font=font)
    for row, level in enumerate(LEVELS):
        draw.text((14, 64 + row * cell), f"Уровень {level}", fill="#f4e4b7", font=font)
        folder = OUTPUT / f"level-{level}"
        paths = [folder / "tower-assembled.png"] + [folder / "parts" / name for name in PARTS]
        for col, path in enumerate(paths):
            image = Image.open(path).convert("RGBA")
            thumb = image.resize((cell - 10, cell - 10), Image.Resampling.NEAREST)
            sheet.paste(thumb, (col * cell + 5, row * cell + 74), thumb)
    sheet.save(OUTPUT / "overview.png")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = {str(level): split(level) for level in LEVELS}
    manifest = {
        "schema": "mage-tower-modular-v1",
        "canvas_px": list(SIZE),
        "source": "../pixel-v3/mage-tower-level-{level}-pixel.png",
        "levels": list(LEVELS),
        "order_back_to_front": [f"parts/{name}" for name in PARTS],
        "crystal_animation_fps": 6,
        "crystal_animation_frames": 5,
        "full_tower_animation_frames": 5,
        "level_0_note": "This earliest tower has a wooden finial rather than a crystal; its fourth layer is static.",
        "reassembly": "Pixel-identical after normalizing invisible RGB in fully transparent pixels.",
        "parts_visible_bbox_px_exclusive": records,
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    overview(records)
    print("Created 5 mage towers with 4 parts and 5 animation frames each; all reassemblies exact.")


if __name__ == "__main__":
    main()
