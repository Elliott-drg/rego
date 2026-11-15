#!/usr/bin/env python3
"""Contrôles visuels et valeurs de contrôle des rasters polaires livrés.

Écrit des PNG basse résolution dans tools/check/ et tools/check/control_points.json.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))  # compatible python -I
from grid import CHECK, DATA, N, hillshade, latlon_to_cr

POINTS = [
    ("Crête de Shackleton / Connecting Ridge (approx.)", -89.45, -137.3),
    ("Fond de Shackleton", -89.67, 129.2),
    ("Malapert", -85.99, -2.9),
]
LABELS = [("Shackleton", -89.67, 129.2), ("de Gerlache", -88.5, -87.1), ("Haworth", -87.45, -5.17),
          ("Shoemaker", -88.14, 44.9), ("Faustini", -87.18, 84.31), ("Malapert", -84.9, 12.9),
          ("Nobile", -85.28, 53.27), ("Cabeus", -85.33, -42.13)]


def load(name, dtype):
    p = DATA / name
    return np.fromfile(p, dtype=dtype).reshape(N, N) if p.exists() else None


def colorize(v, lo, hi, stops):
    t = np.clip((v - lo) / (hi - lo), 0, 1)
    xs = np.linspace(0, 1, len(stops))
    st = np.array(stops, dtype=np.float32)
    return np.stack([np.interp(t, xs, st[:, k]) for k in range(3)], axis=-1)


def crop(a, half):
    c = N // 2
    return a[c - half:c + half, c - half:c + half]


def annotate(img, half, scale):
    d = ImageDraw.Draw(img)
    for name, lat, lon in LABELS:
        c, r = latlon_to_cr(lat, lon)
        x, y = (c - (N // 2 - half)) * scale, (r - (N // 2 - half)) * scale
        if 0 <= x < img.width and 0 <= y < img.height:
            d.ellipse([x - 3, y - 3, x + 3, y + 3], outline=(255, 255, 0))
            d.text((x + 5, y - 5), name, fill=(255, 255, 0))
    for _, lat, lon in POINTS:
        c, r = latlon_to_cr(lat, lon)
        x, y = (c - (N // 2 - half)) * scale, (r - (N // 2 - half)) * scale
        d.line([x - 6, y, x + 6, y], fill=(0, 255, 255))
        d.line([x, y - 6, x, y + 6], fill=(0, 255, 255))
    return img


def main():
    CHECK.mkdir(exist_ok=True)
    dem = load("sp_dem_240m.i16", "<i2").astype(np.float32) * 0.5
    sun = load("sp_sun_avg_240m.u8", np.uint8)
    earth = load("sp_earth_avg_240m.u8", np.uint8)
    psr = load("sp_psr_240m.u8", np.uint8)
    tmax = load("sp_tmax_240m.u16", "<u2")
    tmin = load("sp_tmin_240m.u16", "<u2")
    tavg = load("sp_tavg_240m.u16", "<u2")
    hs = hillshade(dem)

    # 1) Zoom pôle : +-60 km (500 px), agrandi x2 : ombrage + PSR (bleu) + soleil > 70 % (jaune)
    for half, scale, tag in ((250, 2, "zoom60km"), (1000, 0.5, "zoom240km"), (N // 2, 0.25, "full")):
        h = crop(hs, half)
        rgb = np.repeat(h[:, :, None], 3, axis=2) * 255
        p = crop(psr, half) > 0
        s = crop(sun, half).astype(np.float32) / 250
        rgb[p] = rgb[p] * 0.45 + np.array([30, 90, 255]) * 0.55
        hot = s > 0.7
        rgb[hot] = rgb[hot] * 0.3 + np.array([255, 230, 0]) * 0.7
        img = Image.fromarray(rgb.clip(0, 255).astype(np.uint8))
        img = img.resize((int(2 * half * scale), int(2 * half * scale)), Image.BILINEAR)
        annotate(img, half, scale).save(CHECK / f"overlay_dem_psr_sun_{tag}.png")

    half, scale = 1000, 0.5
    layers = [("sun", crop(sun, half) / 250.0, 0, 1, [(0, 0, 0), (120, 40, 0), (255, 200, 0), (255, 255, 255)]),
              ("earth", crop(earth, half) / 250.0, 0, 1, [(0, 0, 0), (0, 60, 160), (120, 220, 255)])]
    if tmax is not None:
        thermal = [(0, 0, 60), (0, 80, 255), (0, 220, 180), (255, 230, 0), (255, 40, 0)]
        layers += [("tmax", crop(tmax, half) / 10.0, 40, 330, thermal),
                   ("tmin", crop(tmin, half) / 10.0, 20, 120, thermal),
                   ("tavg", crop(tavg, half) / 10.0, 30, 200, thermal)]
    for tag, v, lo, hi, stops in layers:
        rgb = colorize(v.astype(np.float32), lo, hi, stops)
        rgb = rgb * (0.55 + 0.45 * crop(hs, half)[:, :, None])
        if tag.startswith("t"):
            rgb[v == 0] = 40
        img = Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).resize((1000, 1000), Image.BILINEAR)
        annotate(img, half, scale).save(CHECK / f"layer_{tag}_zoom240km.png")

    out = []
    for name, lat, lon in POINTS:
        c, r = latlon_to_cr(lat, lon)
        ci, ri = int(round(float(c))), int(round(float(r)))
        rec = {"name": name, "lat": lat, "lon": lon, "col": ci, "row": ri,
               "dem_m": float(dem[ri, ci]),
               "sun_avg_pct": round(float(sun[ri, ci]) / 2.5, 1),
               "earth_avg_pct": round(float(earth[ri, ci]) / 2.5, 1),
               "psr": int(psr[ri, ci])}
        # voisinage 5x5 (1,2 km) : utile car les points sont donnés à ~0,01 deg près
        sl = (slice(ri - 2, ri + 3), slice(ci - 2, ci + 3))
        rec["neigh5x5"] = {"dem_m_min": float(dem[sl].min()), "dem_m_max": float(dem[sl].max()),
                           "sun_pct_min": round(float(sun[sl].min()) / 2.5, 1),
                           "sun_pct_max": round(float(sun[sl].max()) / 2.5, 1),
                           "earth_pct_min": round(float(earth[sl].min()) / 2.5, 1),
                           "earth_pct_max": round(float(earth[sl].max()) / 2.5, 1),
                           "psr_count": int(psr[sl].sum())}
        if tmax is not None:
            rec.update(tmax_K=tmax[ri, ci] / 10.0, tmin_K=tmin[ri, ci] / 10.0, tavg_K=tavg[ri, ci] / 10.0)
        out.append(rec)
        print(json.dumps(rec, ensure_ascii=False))
    # Cohérences globales
    stats = {"psr_px": int(psr.sum()), "psr_and_sun_gt0": int(((psr > 0) & (sun > 0)).sum()),
             "sun_eq0_px": int((sun == 0).sum())}
    if tmax is not None:
        ok = tmax > 0
        stats["tmax_median_in_psr_K"] = float(np.median(tmax[ok & (psr > 0)]) / 10)
        stats["tmax_median_outside_psr_K"] = float(np.median(tmax[ok & (psr == 0)]) / 10)
        stats["tmin_gt_tavg_px"] = int((tmin[ok] > tavg[ok]).sum())
        stats["tavg_gt_tmax_px"] = int(((tavg > tmax) & (tavg > 0))[ok].sum())
        for nm, a in (("tmax", tmax), ("tmin", tmin), ("tavg", tavg)):
            v = a[a > 0] / 10.0
            stats[nm + "_pcts_K"] = {str(q): float(np.percentile(v, q)) for q in (0.01, 1, 50, 99, 99.99)}
    print(json.dumps(stats))
    (CHECK / "control_points.json").write_text(json.dumps({"points": out, "stats": stats}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
