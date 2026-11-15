#!/usr/bin/env python3
"""Logo : copie de l'image entière + emblème rond recadré (sans le texte).

Entrée : tools/raw/assets/logo.webp (copie de inbox/2026-11-15/logo.webp)
Sorties : public/assets/logo.webp (identique), logo-256.png, favicon.png (64 px), RGBA,
          transparents hors du disque de l'emblème.
"""
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))  # compatible python -I
from grid import RAW, ROOT

SRC = RAW / "assets" / "logo.webp"
OUT = ROOT / "public" / "assets"


def find_ring(rgb):
    """Cercle de l'anneau bleu extérieur : ajustement moindres carrés sur les pixels bleu vif."""
    r, g, b = (rgb[..., k].astype(np.int32) for k in range(3))
    blue = (b > 180) & (r < 90) & (b - g > 60)
    blue[440:, :] = False  # exclut le mot « FINDER » et le filet sous le titre
    ys, xs = np.nonzero(blue)
    # Premier passage : cercle moindres carrés ; second : centre = milieu de l'étendue des pixels
    # de l'anneau (le côté droit est en partie masqué par l'orbite rouge, ce qui biaise l'ajustement).
    A = np.c_[2 * xs, 2 * ys, np.ones(len(xs))]
    sol, *_ = np.linalg.lstsq(A, xs ** 2 + ys ** 2, rcond=None)
    cx, cy = sol[0], sol[1]
    rad = np.sqrt(sol[2] + cx ** 2 + cy ** 2)
    keep = np.abs(np.hypot(xs - cx, ys - cy) - rad) < 10
    xs, ys = xs[keep], ys[keep]
    cx, cy = (xs.min() + xs.max()) / 2.0, (ys.min() + ys.max()) / 2.0
    rout = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2.0 + 0.5
    # Point blanc de l'orbite, qui dépasse de l'anneau en haut à droite
    white = (r > 235) & (g > 235) & (b > 235)
    wy, wx = np.nonzero(white)
    near = (np.hypot(wx - cx, wy - cy) > rout - 6) & (np.hypot(wx - cx, wy - cy) < rout + 16) & (wy < cy) & (wx > cx)
    rdot = float(np.hypot(wx[near] - cx, wy[near] - cy).max()) if near.any() else rout
    return float(cx), float(cy), float(rout), max(float(rout), rdot), int(keep.sum())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SRC, OUT / "logo.webp")
    im = Image.open(SRC).convert("RGB")
    cx, cy, rring, rout, n = find_ring(np.asarray(im))
    print(f"anneau : centre ({cx:.1f}, {cy:.1f}), bord extérieur {rring:.1f} px, avec le point de l'orbite {rout:.1f} px ({n} px)")
    R = rout + 2.5  # petite marge ; le texte « REGOLITH » commence plus bas que le disque
    assert cx - R >= 0 and cy - R >= 0 and cx + R <= im.width and cy + R <= im.height
    box = (cx - R, cy - R, cx + R, cy + R)
    for name, size in (("logo-256.png", 256), ("favicon.png", 64)):
        ss = 4  # suréchantillonnage pour un bord de masque lissé
        big = im.resize((size * ss, size * ss), Image.LANCZOS, box=box).convert("RGBA")
        m = Image.new("L", (size * ss, size * ss), 0)
        ImageDraw.Draw(m).ellipse([0, 0, size * ss - 1, size * ss - 1], fill=255)
        big.putalpha(m)
        big.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
        print(name, (OUT / name).stat().st_size, "octets")


if __name__ == "__main__":
    main()
