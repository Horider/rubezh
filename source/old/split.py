"""Split four aligned towers into the four registered template modules."""

from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
CANVAS = (1254, 1254)
TARGET_BBOX = (245, 25, 1009, 1218)
NAMES = ["01-base.png", "02-upper-room.png", "03-roof.png", "04-pennant.png"]
LABELS = ["Основание", "Верхний ярус", "Крыша", "Флаг"]
STYLES = ["01-turquoise-3d", "02-wood-roof", "03-thatch-wood", "04-emblem-turquoise"]


def font(size):
    p = Path("C:/Windows/Fonts/arial.ttf")
    return ImageFont.truetype(str(p), size) if p.exists() else ImageFont.load_default()


def bbox(image, threshold=5):
    a = np.asarray(image.getchannel("A"))
    yy, xx = np.where(a >= threshold)
    return [int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1]


def dimensions(image):
    box = bbox(image)
    return {"bbox_px_exclusive": box, "visible_size_px": [box[2] - box[0], box[3] - box[1]]}


def template_owner():
    owner = np.full(CANVAS[::-1], -1, dtype=np.int8)
    for index, name in enumerate(NAMES):
        part = Image.open(ROOT / "input" / "template" / "parts" / name).convert("RGBA")
        if part.size != CANVAS:
            raise AssertionError(f"Template part canvas differs: {name}")
        owner[np.asarray(part.getchannel("A")) > 0] = index
    return owner


def extend_owner(owner, source_alpha):
    missing = (source_alpha > 0) & (owner < 0)
    for _ in range(80):
        if not missing.any():
            break
        updated = owner.copy()
        neighbors = (
            np.pad(owner[1:, :], ((0, 1), (0, 0)), constant_values=-1),
            np.pad(owner[:-1, :], ((1, 0), (0, 0)), constant_values=-1),
            np.pad(owner[:, 1:], ((0, 0), (0, 1)), constant_values=-1),
            np.pad(owner[:, :-1], ((0, 0), (1, 0)), constant_values=-1),
        )
        for neighbor in neighbors:
            choose = (updated < 0) & (neighbor >= 0)
            updated[choose] = neighbor[choose]
        if np.array_equal(owner, updated):
            break
        owner = updated
        missing = (source_alpha > 0) & (owner < 0)
    if missing.any():
        ys, xs = np.where(missing)
        raise AssertionError(f"Unassigned source pixels: {int(missing.sum())}, first at {(int(xs[0]), int(ys[0]))}")
    return owner


def split_one(style, owner_base):
    folder = ROOT / style
    source = Image.open(folder / "tower-normalized.png").convert("RGBA")
    if source.size != CANVAS or tuple(bbox(source)) != TARGET_BBOX:
        raise AssertionError(f"Incorrect normalized size: {style} {source.size} {bbox(source)}")
    pix = np.asarray(source).copy()
    owner = extend_owner(owner_base.copy(), pix[:, :, 3])
    yy = np.arange(CANVAS[1])[:, None]
    red = pix[:, :, 0].astype(np.int16)
    green = pix[:, :, 1].astype(np.int16)
    blue = pix[:, :, 2].astype(np.int16)
    roof_mask = owner_base == 2
    roof_bottom = np.max(np.where(roof_mask, np.arange(CANVAS[1])[:, None], -1), axis=0)
    if style in ("01-turquoise-3d", "04-emblem-turquoise"):
        teal = (blue > red * 1.2) & (green > red * 1.25) & (pix[:, :, 3] > 0)
        owner[(owner == 1) & (yy <= roof_bottom[None, :] + 8) & teal] = 2
        owner[(owner == 3) & (yy >= 235) & teal] = 2
    elif style == "03-thatch-wood":
        # Loose straw fringe may hang just below the standard roof outline.
        light_straw = (red > 135) & (green > 95) & (blue < 115) & (red > green * 1.1)
        owner[(owner == 1) & (yy < roof_bottom[None, :] + 12) & light_straw] = 2
    parts_dir = folder / "parts"
    parts_dir.mkdir(exist_ok=True)
    layers = []
    for index, name in enumerate(NAMES):
        part_pix = pix.copy()
        part_pix[owner != index] = 0
        part = Image.fromarray(part_pix, "RGBA")
        part.save(parts_dir / name)
        layers.append(part)
    assembled = Image.new("RGBA", CANVAS)
    for layer in layers:
        assembled.alpha_composite(layer)
    if not np.array_equal(np.asarray(assembled), pix):
        raise AssertionError(f"Layer assembly differs: {style}")
    assembled.save(folder / "tower-assembled.png")
    return {
        "assembled": dimensions(assembled),
        "parts": {name: dimensions(layer) for name, layer in zip(NAMES, layers)},
    }


def preview(records):
    width, height = 1860, 1990
    sheet = Image.new("RGB", (width, height), "#f3efe8")
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((0, 0, width, 78), fill="#263a35")
    draw.text((42, 18), "4 БАШНИ · 4 ЧАСТИ · ОДИН ХОЛСТ 1254 × 1254 px", font=font(27), fill="white")
    for row, style in enumerate(STYLES):
        y0 = 100 + row * 465
        draw.text((42, y0), style, font=font(25), fill="#263a35")
        for col, name in enumerate(NAMES):
            x, y = 42 + col * 455, y0 + 42
            draw.rectangle((x, y, x + 432, y + 392), fill="#faf9f6", outline="#d7d1c6", width=2)
            part = Image.open(ROOT / style / "parts" / name).convert("RGBA")
            crop = part.crop(bbox(part))
            crop.thumbnail((406, 308), Image.Resampling.LANCZOS)
            sheet.paste(crop, (x + (432 - crop.width) // 2, y + (315 - crop.height) // 2), crop)
            size = records[style]["parts"][name]["visible_size_px"]
            draw.text((x + 12, y + 319), f"{col + 1:02d}  {LABELS[col]}", font=font(20), fill="#263a35")
            draw.text((x + 12, y + 353), f"{size[0]} × {size[1]} px", font=font(22), fill="#b14d27")
    sheet.save(ROOT / "parts-preview.png")


def main():
    base_owner = template_owner()
    records = {style: split_one(style, base_owner) for style in STYLES}
    manifest = {
        "schema": "tower-dreamina-modular-v1",
        "canvas_px": [1254, 1254],
        "tower_visible_bbox_px_exclusive": list(TARGET_BBOX),
        "tower_visible_size_px": [764, 1193],
        "axis_x_px": 625,
        "alpha_threshold_for_bbox": 5,
        "module_order_back_to_front": [f"parts/{name}" for name in NAMES],
        "styles": records,
    }
    (ROOT / "dimensions.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    preview(records)
    for style in STYLES:
        print(style, {name: records[style]["parts"][name]["visible_size_px"] for name in NAMES})


if __name__ == "__main__":
    main()
