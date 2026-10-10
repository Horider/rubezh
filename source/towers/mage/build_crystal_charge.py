"""Make five transparent charge frames from each original mage crystal layer."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
GAME = ROOT.parents[2] / "game" / "towers" / "mage"
LEVELS = {0: None, 1: 2, 2: 3, 3: 4, 5: 5}
SOCKET_TOP = {0: 130, 1: 147, 2: 119, 3: 173, 5: 198}
SCALES = (1.0, 1.08, 1.17, 1.27, 1.12)
ENERGY = (0.0, 0.23, 0.46, 0.76, 1.0)


def charge_frame(original: Image.Image, level: int, index: int) -> Image.Image:
    if index == 0:
        return original.copy()
    box = original.getbbox()
    assert box is not None
    left, top, right, bottom = box
    socket_y = SOCKET_TOP[level]
    center = (left + right) // 2
    energy = ENERGY[index]
    scale = SCALES[index]
    crystal = original.crop((left, top, right, socket_y))
    width = round(crystal.width * scale)
    height = round(crystal.height * scale)
    crystal = crystal.resize((width, height), Image.Resampling.NEAREST)
    pixels = np.asarray(crystal).copy()
    visible = pixels[:, :, 3] > 0
    rgb = pixels[:, :, :3].astype(np.float32)
    # The original facets stay recognizable while a violet charge builds inside them.
    tint = np.array((190, 75, 250), dtype=np.float32)
    blend = energy * (0.16 if level < 3 else 0.10)
    rgb = rgb * (1 - blend) + tint * blend
    rgb += np.array((16, 8, 25)) * energy
    pixels[:, :, :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    pixels[~visible, :3] = 0
    crystal = Image.fromarray(pixels, "RGBA")

    out = Image.new("RGBA", original.size)
    x = center - width // 2
    y = socket_y - height
    # Blocky halo remains on the transparent crystal layer, behind the facets.
    halo = Image.new("RGBA", original.size)
    hd = ImageDraw.Draw(halo)
    for radius, alpha in ((65, 14), (45, 23), (25, 34)):
        r = round(radius * (0.7 + energy * 0.5))
        hd.ellipse((center-r, y+height//2-r, center+r, y+height//2+r),
                   fill=(166, 65, 248, round(alpha * energy)))
    out.alpha_composite(halo)
    # The socket is a fixed mounting point. Only the exposed crystal expands.
    out.alpha_composite(original.crop((0, socket_y, original.width, bottom)), (0, socket_y))
    out.alpha_composite(crystal, (x, y))

    marks = Image.new("RGBA", original.size)
    draw = ImageDraw.Draw(marks)
    if index >= 2:
        points = ((center-55, y+height//3), (center+61, y+height//2),
                  (center-29, y-11), (center+31, y+12))
        for n, (sx, sy) in enumerate(points[:index]):
            color = (255, 224, 133, 190) if n % 2 else (226, 149, 255, 205)
            draw.line((sx-4, sy, sx+4, sy), fill=color, width=3)
            draw.line((sx, sy-4, sx, sy+4), fill=color, width=3)
    if index == 4:
        # A condensed bolt appears above the tip. The moving orb continues it.
        orb_y = max(10, y-15)
        draw.ellipse((center-15, orb_y-15, center+15, orb_y+15), fill=(108, 38, 183, 222))
        draw.ellipse((center-9, orb_y-9, center+9, orb_y+9), fill=(219, 150, 255, 250))
        draw.ellipse((center-4, orb_y-4, center+4, orb_y+4), fill=(255, 242, 214, 255))
    out.alpha_composite(marks)
    return out


def main() -> None:
    for source_level, game_level in LEVELS.items():
        src = ROOT / "modular" / f"level-{source_level}" / "parts" / "04-crystal.png"
        original = Image.open(src).convert("RGBA")
        output = ROOT / "modular" / f"level-{source_level}" / "crystal-charge"
        output.mkdir(parents=True, exist_ok=True)
        game = GAME / f"level-{game_level}" if game_level else None
        if game:
            game.mkdir(parents=True, exist_ok=True)
        sheet = Image.new("RGBA", (original.width * 5, original.height))
        for frame in range(5):
            image = charge_frame(original, source_level, frame)
            image.save(output / f"frame-{frame+1:02d}.png")
            if game:
                image.save(game / f"charge-{frame+1:02d}.png")
            sheet.alpha_composite(image, (frame * original.width, 0))
        sheet.save(output / "sheet.png")
    print("Created five transparent charge frames for all five mage towers.")


if __name__ == "__main__":
    main()
