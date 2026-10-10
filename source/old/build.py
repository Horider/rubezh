"""Clean the roof/upper-room boundary while keeping approved pixel dimensions."""

from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "input"
CANVAS = (1254, 1254)
MASTER_BOX = (245, 25, 1009, 1218)
AXIS_X = 625
NAMES = ["01-base.png", "02-upper-room.png", "03-roof.png", "04-pennant.png"]
TITLES = ["Основание", "Верхний ярус", "Крыша", "Флаг и навершие"]
STYLES = [
    ("template", INPUT / "template" / "tower-assembled.png"),
    ("01-weathered", INPUT / "1lvl.png"),
    ("02-finished", INPUT / "2lvl.png"),
]


def rgba(path):
    image = Image.open(path).convert("RGBA")
    if image.size != CANVAS:
        raise ValueError(f"Unexpected canvas for {path}: {image.size}")
    return image


def bbox(image, threshold=5):
    alpha = np.asarray(image.getchannel("A"))
    yy, xx = np.where(alpha >= threshold)
    if not len(xx):
        raise ValueError("Empty module")
    return (int(xx.min()), int(yy.min()), int(xx.max()) + 1, int(yy.max()) + 1)


def dimensions(image):
    box = bbox(image)
    return {"bbox_px_exclusive": list(box), "visible_size_px": [box[2] - box[0], box[3] - box[1]]}


def font(size):
    path = Path("C:/Windows/Fonts/arial.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def build_clean_template():
    parts = [rgba(INPUT / "template" / "parts" / name) for name in NAMES]
    roof = np.asarray(parts[2]).copy()
    red = roof[:, :, 0].astype(np.int16)
    green = roof[:, :, 1].astype(np.int16)
    blue = roof[:, :, 2].astype(np.int16)
    alpha = roof[:, :, 3]

    # In the original template the orange eave was mistakenly embedded in
    # the roof layer. The first bright wooden pixel in each column identifies
    # the lower eave strip. Transfer that whole strip, including its dark
    # underside, to the upper room without altering the assembled picture.
    wood = (alpha >= 5) & (red >= 60) & (red > green * 1.12) & (green > blue * 1.18)
    transfer = np.zeros(alpha.shape, dtype=bool)
    starts = np.full(CANVAS[0], np.nan)
    for x in range(CANVAS[0]):
        rows = np.where(wood[:, x])[0]
        if len(rows):
            starts[x] = int(rows.min())
    known = np.where(~np.isnan(starts))[0]
    interpolated = np.interp(np.arange(known[0], known[-1] + 1), known, starts[known])
    for x in range(int(known[0]), int(known[-1]) + 1):
        start = int(starts[x]) if not np.isnan(starts[x]) else int(round(interpolated[x - known[0]]))
        transfer[start:, x] = alpha[start:, x] > 0
    if not transfer.any():
        raise AssertionError("No wooden eave found in the roof module")

    moved = roof.copy()
    moved[~transfer] = 0
    roof[transfer] = 0
    parts[1] = Image.alpha_composite(parts[1], Image.fromarray(moved, "RGBA"))
    parts[2] = Image.fromarray(roof, "RGBA")

    original_assembled = rgba(INPUT / "template" / "tower-assembled.png")
    assembled = Image.new("RGBA", CANVAS)
    for part in parts:
        assembled.alpha_composite(part)
    if not np.array_equal(np.asarray(assembled), np.asarray(original_assembled)):
        diff = np.any(np.asarray(assembled) != np.asarray(original_assembled), axis=2)
        raise AssertionError(f"Template assembled pixels changed: {int(diff.sum())} pixels")
    if bbox(assembled) != MASTER_BOX:
        raise AssertionError(f"Master dimensions changed: {bbox(assembled)}")

    out = ROOT / "template"
    (out / "parts").mkdir(parents=True, exist_ok=True)
    assembled.save(out / "tower-assembled.png")
    for name, part in zip(NAMES, parts):
        part.save(out / "parts" / name)
    return parts, int(transfer.sum())


def fill_owner_gaps(owner, source_alpha):
    # Existing module masks define the approved seams. Style-only contour
    # pixels outside that silhouette inherit the nearest neighboring module.
    unknown = (source_alpha > 0) & (owner < 0)
    for _ in range(80):
        if not unknown.any():
            return owner
        updated = owner.copy()
        neighbors = (
            np.pad(owner[1:, :], ((0, 1), (0, 0)), constant_values=-1),
            np.pad(owner[:-1, :], ((1, 0), (0, 0)), constant_values=-1),
            np.pad(owner[:, 1:], ((0, 0), (0, 1)), constant_values=-1),
            np.pad(owner[:, :-1], ((0, 0), (1, 0)), constant_values=-1),
        )
        for neighbor in neighbors:
            eligible = (updated < 0) & (neighbor >= 0)
            updated[eligible] = neighbor[eligible]
        if np.array_equal(updated, owner):
            break
        owner = updated
        unknown = (source_alpha > 0) & (owner < 0)
    if unknown.any():
        raise AssertionError(f"Could not assign {int(unknown.sum())} style contour pixels")
    return owner


def split_style(folder, source, owner_base):
    original = rgba(source)
    if bbox(original) != MASTER_BOX:
        raise AssertionError(f"Source dimensions changed: {source} {bbox(original)}")
    pixels = np.asarray(original).copy()
    owner = fill_owner_gaps(owner_base.copy(), pixels[:, :, 3])
    out = ROOT / folder
    (out / "parts").mkdir(parents=True, exist_ok=True)
    parts = []
    for index, name in enumerate(NAMES):
        layer = pixels.copy()
        layer[owner != index] = 0
        image = Image.fromarray(layer, "RGBA")
        image.save(out / "parts" / name)
        parts.append(image)
    assembled = Image.new("RGBA", CANVAS)
    for part in parts:
        assembled.alpha_composite(part)
    if not np.array_equal(np.asarray(assembled), pixels):
        raise AssertionError(f"{folder}: split/assembly differs from supplied PNG")
    assembled.save(out / "tower-assembled.png")
    return parts


def draw_guide(records):
    width, height = 1920, 1580
    sheet = Image.new("RGB", (width, height), "#f3efe8")
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((0, 0, width, 88), fill="#263a35")
    draw.text((48, 22), "БАШНЯ · РАЗМЕРЫ КАЖДОЙ ЧАСТИ", font=font(32), fill="#fffaf0")
    draw.text((48, 105), "Общий холст: 1254 × 1254 px   |   Башня: 764 × 1193 px   |   Ось: x = 625 px", font=font(24), fill="#263a35")
    labels = [("template", "Чистый шаблон"), ("01-weathered", "1 уровень"), ("02-finished", "2 уровень")]
    for row, (folder, label) in enumerate(labels):
        top = 166 + row * 460
        draw.text((48, top), label, font=font(27), fill="#263a35")
        for col, name in enumerate(NAMES):
            x, y = 48 + col * 465, top + 44
            draw.rectangle((x, y, x + 440, y + 390), fill="#faf9f6", outline="#d7d1c6", width=2)
            image = rgba(ROOT / folder / "parts" / name)
            crop = image.crop(bbox(image))
            crop.thumbnail((405, 295), Image.Resampling.NEAREST)
            sheet.paste(crop, (x + (440 - crop.width) // 2, y + (300 - crop.height) // 2), crop)
            size = records[folder]["parts"][name]["visible_size_px"]
            box = records[folder]["parts"][name]["bbox_px_exclusive"]
            draw.text((x + 12, y + 310), f"{col + 1:02d}  {TITLES[col]}", font=font(20), fill="#263a35")
            draw.text((x + 12, y + 342), f"{size[0]} × {size[1]} px", font=font(24), fill="#b14d27")
            draw.text((x + 12, y + 372), f"x {box[0]}–{box[2] - 1}  ·  y {box[1]}–{box[3] - 1}", font=font(15), fill="#51645f")
    sheet.save(ROOT / "module-dimensions.png")


def main():
    template_parts, transferred = build_clean_template()
    owner = np.full((CANVAS[1], CANVAS[0]), -1, dtype=np.int8)
    for index, part in enumerate(template_parts):
        owner[np.asarray(part.getchannel("A")) > 0] = index
    parts_by_style = {"template": template_parts}
    parts_by_style["01-weathered"] = split_style("01-weathered", INPUT / "1lvl.png", owner)
    parts_by_style["02-finished"] = split_style("02-finished", INPUT / "2lvl.png", owner)

    records = {
        "schema": "tower-modular-family-v7",
        "canvas_px": [1254, 1254],
        "tower_visible_bbox_px_exclusive": list(MASTER_BOX),
        "tower_visible_size_px": [764, 1193],
        "axis_x_px": AXIS_X,
        "alpha_threshold_for_bbox": 5,
        "module_order_back_to_front": [f"parts/{name}" for name in NAMES],
        "wood_eave_pixels_moved_from_roof_to_upper_room": transferred,
        "styles": {},
    }
    for folder, parts in parts_by_style.items():
        records["styles"][folder] = {
            "assembled": dimensions(rgba(ROOT / folder / "tower-assembled.png")),
            "parts": {name: dimensions(part) for name, part in zip(NAMES, parts)},
        }
    (ROOT / "dimensions.json").write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    draw_guide(records["styles"])
    print("Moved roof eave pixels:", transferred)
    for folder in ("template", "01-weathered", "02-finished"):
        print(folder, {name: records["styles"][folder]["parts"][name]["visible_size_px"] for name in NAMES})


if __name__ == "__main__":
    main()
