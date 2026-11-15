#!/usr/bin/env python3
"""Resize source textures into assets/textures (512px JPG). usage: assets.py SRC_DIR
Sources: ambientCG WoodFloor043 + Tiles036 (CC0, via github.com/pmndrs/market-assets), brick from three.js examples."""
import sys
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np
src = Path(sys.argv[1]); out = Path(__file__).resolve().parent.parent / "assets" / "textures"
out.mkdir(parents=True, exist_ok=True)
def save(im, name, size=512, q=84):
    im.convert("RGB").resize((size, size), Image.LANCZOS).save(out / name, quality=q, optimize=True)
def bump2normal(im, k=3.0):
    h = np.asarray(im.convert("L").resize((512, 512), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 255
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * k; dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * k
    n = np.dstack([-dx, dy, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))
save(Image.open(src / "wood-floor-43_WoodFloor043_1K_Color.jpg"), "wood_c.jpg")
save(Image.open(src / "wood-floor-43_WoodFloor043_1K_Normal.jpg"), "wood_n.jpg")
save(Image.open(src / "wood-floor-43_WoodFloor043_1K_Roughness.jpg"), "wood_r.jpg", q=75)
save(Image.open(src / "tiles_Tiles036_1K_Color.jpg"), "tile_c.jpg")
save(Image.open(src / "tiles_Tiles036_1K_Normal.jpg"), "tile_n.jpg")
save(Image.open(src / "brick_diffuse.jpg"), "brick_c.jpg")
save(bump2normal(Image.open(src / "brick_bump.jpg")), "brick_n.jpg")
for f in sorted(out.glob("*_c.jpg")):
    a = np.asarray(Image.open(f), dtype=np.float32) / 255
    print(f.name, "avg linear", [round(float(x), 3) for x in (a ** 2.2).mean((0, 1))])
