"""Fit four transparent tower cutouts to the existing modular tower canvas."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np

ROOT = Path(__file__).resolve().parent
NAMES = ["01-turquoise-3d", "02-wood-roof", "03-thatch-wood", "04-emblem-turquoise"]
TARGET_BOX = (245, 25, 1009, 1218)
TARGET_SIZE = (764, 1193)
CANVAS = (1254, 1254)


def font(size):
    p = Path("C:/Windows/Fonts/arial.ttf")
    return ImageFont.truetype(str(p), size) if p.exists() else ImageFont.load_default()


def alpha_bbox(image, threshold=10):
    a = np.asarray(image.convert("RGBA"))[:, :, 3]
    ys, xs = np.where(a >= threshold)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def main():
    for name in NAMES:
        source = Image.open(ROOT / "input" / f"{name}.png").convert("RGBA")
        box = alpha_bbox(source)
        cutout = source.crop(box)
        cutout = cutout.resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        cleaned = np.asarray(cutout).copy()
        cleaned[cleaned[:, :, 3] < 5] = 0
        # The generated cutouts can leave saturated red edge pixels from
        # background removal; none of the four tower designs use this red.
        red_fringe = (cleaned[:, :, 0] > 200) & (cleaned[:, :, 1] < 90) & (cleaned[:, :, 2] < 90)
        cleaned[red_fringe] = 0
        cutout = Image.fromarray(cleaned, "RGBA")
        canvas = Image.new("RGBA", CANVAS)
        canvas.alpha_composite(cutout, TARGET_BOX[:2])
        out = ROOT / name
        out.mkdir(exist_ok=True)
        canvas.save(out / "tower-normalized.png")
        print(name, "source", source.size, box, "fitted", alpha_bbox(canvas))

    preview = Image.new("RGB", (1340, 1390), "#f3efe8")
    d = ImageDraw.Draw(preview)
    d.rectangle((0, 0, 1340, 70), fill="#263a35")
    d.text((34, 17), "4 БАШНИ · ОБЩАЯ СЕТКА 1254 × 1254", font=font(27), fill="white")
    for i, name in enumerate(NAMES):
        col, row = i % 2, i // 2
        x, y = 18 + col * 657, 88 + row * 648
        d.rectangle((x, y, x + 638, y + 625), fill="#faf9f6", outline="#d7d1c6", width=2)
        image = Image.open(ROOT / name / "tower-normalized.png").convert("RGBA")
        image.thumbnail((600, 600), Image.Resampling.LANCZOS)
        preview.paste(image, (x + 15, y + 4), image)
        d.text((x + 16, y + 587), name, font=font(19), fill="#263a35")
    preview.save(ROOT / "normalized-preview.png")


if __name__ == "__main__":
    main()
