#!/usr/bin/env python3
"""Cartes globales (NASA SVS CGI Moon Kit, id 4720).

Entrées (tools/raw/svs/) : lroc_color_poles_4k.tif, ldem_4.tif
Sorties (public/data/)   : moon_color_4k.jpg, moon_color_2k.jpg, global_ldem_4ppd.i16

Convention (vérifiée par check_convention) : équirectangulaire, ligne 0 = +90 deg,
colonne 0 = lon -180 deg, centre de l'image = lon 0 (face visible), est vers la droite.
Pixel (col c, ligne r) de centre lon = -180 + (c + 0.5) * 360 / W, lat = 90 - (r + 0.5) * 180 / H.
"""
import json
import sys

import numpy as np
import tifffile
from PIL import Image

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))  # compatible python -I
from grid import CHECK, DATA, N, RAW, latlon_to_cr


def px(lat, lon, w, h):
    return int((lon + 180.0) / 360.0 * w) % w, min(h - 1, int((90.0 - lat) / 180.0 * h))


def check_convention(rgb, dem_m):
    """Contrôles d'orientation indépendants ; lève AssertionError si la convention est fausse."""
    res = {}
    h, w = rgb.shape[:2]
    lum = rgb.astype(np.float32).mean(axis=2)

    def box(lat, lon, half=1.5):
        c0, r0 = px(lat + half, lon - half, w, h)
        c1, r1 = px(lat - half, lon + half, w, h)
        return float(lum[r0:r1 + 1, c0:c1 + 1].mean())

    # Mers sombres connues contre terrains clairs voisins (albédo)
    pairs = {"Mare Imbrium (35N, 16W) < hautes terres (40S, 5E)": (box(35, -16), box(-40, 5)),
             "Mare Crisium (17N, 59E) < hautes terres (17N, 100E)": (box(17, 59), box(17, 100)),
             "Tsiolkovskiy (20.4S, 129.1E) < voisinage (20.4S, 136E)": (box(-20.4, 129.1, 0.6), box(-20.4, 136, 0.6)),
             "Mare Orientale (19.5S, 93W) < voisinage (10S, 80W)": (box(-19.5, -93, 1.0), box(-10, -80, 1.0))}
    for k, (a, b) in pairs.items():
        res[k] = [round(a, 1), round(b, 1)]
        assert a < b - 8, (k, a, b)
    # DEM global contre DEM polaire LOLA 240 m sur le parallèle 80 S (tous les 0,25 deg)
    hh, ww = dem_m.shape
    pol = np.fromfile(RAW / "ldem_75s_240m.img", dtype="<i2").reshape(N, N).astype(np.float32) * 0.5
    lons = -180 + (np.arange(ww) + 0.5) * 360.0 / ww
    best = {}
    for lat in (-80.125, -82.125, -85.125):
        c, r = latlon_to_cr(np.full_like(lons, lat), lons)
        ci, ri = np.rint(c).astype(int), np.rint(r).astype(int)
        # moyenne 9x9 (~2 km) du DEM polaire, la cellule globale faisant ~7,6 km en latitude
        p = np.array([pol[y - 4:y + 5, x - 4:x + 5].mean() for x, y in zip(ci, ri)])
        g = dem_m[px(lat, 0, ww, hh)[1]].astype(np.float32)
        corr = {s: float(np.corrcoef(p, np.roll(g, s))[0, 1]) for s in (0, ww // 2)}
        corr["miroir est-ouest"] = float(np.corrcoef(p, g[::-1])[0, 1])
        corr["miroir nord-sud"] = float(np.corrcoef(p, dem_m[hh - 1 - px(lat, 0, ww, hh)[1]].astype(np.float32))[0, 1])
        best[str(lat)] = {"corr convention": round(corr[0], 4), "corr décalé 180": round(corr[ww // 2], 4),
                          "corr miroir E-O": round(corr["miroir est-ouest"], 4),
                          "corr miroir N-S": round(corr["miroir nord-sud"], 4),
                          "écart médian global - polaire (m)": round(float(np.median(g - p)), 1)}
        assert corr[0] > 0.9 and corr[0] > max(corr[ww // 2], corr["miroir est-ouest"], corr["miroir nord-sud"]) + 0.3
    res["DEM global vs DEM polaire"] = best
    return res


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    CHECK.mkdir(exist_ok=True)
    rgb = tifffile.imread(RAW / "svs" / "lroc_color_poles_4k.tif")
    assert rgb.shape == (2048, 4096, 3) and rgb.dtype == np.uint8, (rgb.shape, rgb.dtype)
    km = tifffile.imread(RAW / "svs" / "ldem_4.tif")
    assert km.shape == (720, 1440) and km.dtype == np.float32
    m = np.rint(km.astype(np.float64) * 1000.0)
    assert -9500 < m.min() < -8500 and 10000 < m.max() < 11000, (m.min(), m.max())
    dem = m.astype("<i2")

    res = check_convention(rgb, dem)
    res["global_ldem_4ppd"] = {"min_m": int(dem.min()), "max_m": int(dem.max()), "mean_m": round(float(dem.mean()), 1)}
    # Recoupement avec la version uint16 du kit (demi-mètres par rapport à 1 727 400 m)
    u = RAW / "svs" / "ldem_4_uint.tif"
    if u.exists():
        um = tifffile.imread(u).astype(np.float64) * 0.5 + 1727400.0 - 1737400.0
        res["global_ldem_4ppd"]["écart max float km vs uint demi-mètres (m)"] = float(np.abs(um - km.astype(np.float64) * 1000).max())

    img = Image.fromarray(rgb, "RGB")
    img.save(DATA / "moon_color_4k.jpg", quality=88, optimize=True, subsampling="4:2:0")
    img.resize((2048, 1024), Image.LANCZOS).save(DATA / "moon_color_2k.jpg", quality=88, optimize=True,
                                                 subsampling="4:2:0")
    dem.tofile(DATA / "global_ldem_4ppd.i16")

    # PNG de contrôle : couleur 1024x512 avec repères, et relief global
    small = img.resize((1024, 512), Image.BILINEAR)
    from PIL import ImageDraw
    d = ImageDraw.Draw(small)
    for name, lat, lon in (("Tycho", -43.3, -11.4), ("Copernicus", 9.6, -20.1), ("Mare Crisium", 17, 59),
                           ("Orientale", -19.5, -93), ("Tsiolkovskiy", -20.4, 129.1), ("lon 0 / lat 0", 0, 0)):
        x, y = (lon + 180) / 360 * 1024, (90 - lat) / 180 * 512
        d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 255, 0))
        d.text((x + 6, y - 5), name, fill=(255, 255, 0))
    small.save(CHECK / "global_color_labels.png")
    g = ((dem.astype(np.float32) + 9000) / 20000 * 255).clip(0, 255).astype(np.uint8)
    Image.fromarray(g).save(CHECK / "global_ldem_gray.png")
    (CHECK / "global_convention.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
