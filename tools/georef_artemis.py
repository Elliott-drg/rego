#!/usr/bin/env python3
"""Géoréférence la carte NASA des 9 régions candidates Artemis III (28/10/2024).

Entrée : tools/raw/artemis/site-atterrissage.webp (815 x 622 px, mosaïque LROC WAC,
         étoile verte = pôle Sud, barre d'échelle 0-25-50 km), copie de l'image fournie.
Méthode :
  1. détection des rectangles jaunes (arêtes affinées au sous-pixel sur le profil de « jaune ») ;
  2. échelle initiale mesurée sur la barre d'échelle, pôle = centre de l'étoile verte, lon 0 en haut ;
  3. recalage (similitude : pôle u0,v0, échelle, rotation) en maximisant la corrélation entre la
     luminance de l'image et la carte d'illumination moyenne PGDA (dérivée du DEM LOLA), sur la
     grille de référence ; les zones d'annotation (jaune, textes, barre d'échelle) sont masquées ;
  4. erreur résiduelle : pour des cratères nets, décalage local (corrélation de fenêtres) restant
     entre l'image recalée et la carte de référence, en km.
Sortie : public/data/artemis_regions.json + PNG de contrôle dans tools/check/.
Les coordonnées obtenues sont approximatives (lecture d'une image basse résolution).
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.optimize import minimize

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))  # compatible python -I
from grid import CHECK, DATA, N, PX_M, RAW, C0, xy_to_latlon, latlon_to_xy, hillshade

SRC = RAW / "artemis" / "site-atterrissage.webp"

# Boîtes approximatives (x0, y0, x1, y1) en px image, issues d'une première détection des
# segments jaunes ; chaque arête est ensuite affinée automatiquement dans une fenêtre de +-3 px.
BOXES = [
    ("peak-near-cabeus-b", "Peak near Cabeus B", (44.5, 271.5, 84.5, 311.0)),
    ("haworth", "Haworth", (318.0, 220.5, 378.5, 280.5)),
    ("malapert-massif", "Malapert Massif", (405.5, 167.5, 444.5, 209.5)),
    ("mons-mouton-plateau", "Mons Mouton Plateau", (523.5, 76.5, 677.5, 193.5)),
    ("mons-mouton", "Mons Mouton", (555.0, 180.0, 588.0, 211.0)),
    ("nobile-rim-1", "Nobile Rim 1", (573.0, 191.5, 612.5, 232.0)),
    ("nobile-rim-2", "Nobile Rim 2", (720.0, 221.5, 760.0, 262.0)),
    ("de-gerlache-rim-2", "de Gerlache Rim 2", (307.0, 366.0, 348.0, 406.0)),
    ("slater-plain", "Slater Plain", (545.0, 512.0, 585.5, 552.5)),
]
# Estimations grossières du demandeur (contrôle de vraisemblance uniquement)
ROUGH = {"malapert-massif": (-86.6, 0), "mons-mouton-plateau": (-85.2, 30), "mons-mouton": (-86.1, 31),
         "nobile-rim-1": (-86.1, 37), "nobile-rim-2": (-84.8, 59), "haworth": (-87.2, -23),
         "de-gerlache-rim-2": (-88.5, -65), "peak-near-cabeus-b": (-84.5, -69), "slater-plain": (-87.6, 126)}
# Cratères nets pour l'erreur résiduelle (centres IAU ; seule la fenêtre autour du centre est utilisée)
CRATERS = [("Shackleton", -89.67, 129.78, 21), ("de Gerlache", -88.48, -88.34, 33), ("Haworth", -87.45, -5.17, 51),
           ("Shoemaker", -88.14, 45.91, 52), ("Faustini", -87.18, 84.31, 42), ("Nobile", -85.28, 53.27, 79),
           ("Malapert", -85.0, 11.4, 72), ("Slater", -88.08, 111.29, 25), ("Sverdrup", -88.3, -152.0, 32),
           ("Wiechert J", -85.6, 177.0, 34), ("Cabeus B", -82.3, -54.0, 60), ("Amundsen", -84.44, 83.07, 103)]


def yellowness(rgb):
    r, g, b = (rgb[..., k].astype(np.float32) for k in range(3))
    return np.clip(np.minimum(r, g) - b, 0, None)


def refine_edge(Y, pos, lo, hi, vertical, win=3.0):
    """Position sous-pixel d'une arête jaune proche de `pos`.

    vertical=True : arête verticale (x = pos), profil pris entre les lignes lo..hi.
    Profil = 35e centile du « jaune » le long de l'arête (une vraie arête est jaune sur toute sa
    longueur ; un trait qui la croise ne l'est qu'en un point).
    """
    a, b = int(math.floor(pos - win)), int(math.ceil(pos + win))
    m = 5  # marge pour éviter les coins
    if vertical:
        strip = Y[int(lo) + m:int(hi) - m, a:b + 1]
        prof = np.percentile(strip, 35, axis=0)
    else:
        strip = Y[a:b + 1, int(lo) + m:int(hi) - m]
        prof = np.percentile(strip, 35, axis=1)
    k = int(np.argmax(prof))
    # barycentre du pic principal (au-dessus de la moitié du maximum, connexe au maximum)
    thr = prof[k] * 0.5
    i0 = k
    while i0 > 0 and prof[i0 - 1] >= thr:
        i0 -= 1
    i1 = k
    while i1 < len(prof) - 1 and prof[i1 + 1] >= thr:
        i1 += 1
    w = prof[i0:i1 + 1]
    return a + float((np.arange(i0, i1 + 1) * w).sum() / w.sum()), float(prof[k])


def detect_boxes(rgb):
    Y = yellowness(rgb)
    out = []
    for bid, name, (x0, y0, x1, y1) in BOXES:
        l, sl = refine_edge(Y, x0, y0, y1, True)
        r, sr = refine_edge(Y, x1, y0, y1, True)
        t, st = refine_edge(Y, y0, x0, x1, False)
        b, sb = refine_edge(Y, y1, x0, x1, False)
        out.append({"id": bid, "name": name, "px": [l, t, r, b], "edge_strength": [sl, st, sr, sb]})
    return out


def detect_star(rgb):
    r, g, b = (rgb[..., k].astype(np.int32) for k in range(3))
    grn = (g > 120) & (g - r > 40) & (g - b > 20)
    lab, n = ndi.label(grn)
    sizes = ndi.sum(grn, lab, range(1, n + 1))
    k = int(np.argmax(sizes)) + 1
    cy, cx = ndi.center_of_mass(grn, lab, k)
    return float(cx), float(cy), int(sizes[k - 1])


def measure_scale_bar(rgb):
    """Longueur en px de la barre d'échelle 0-50 km (bas gauche de l'image).

    Sur chaque ligne de la zone, plus long segment continu « non blanc » (cadre + moitié noire +
    cadre de la moitié blanche) : son étendue maximale est la longueur hors tout du cadre. Le trait
    du cadre faisant ~2 px (anti-crénelé), la longueur d'axe à axe vaut hors-tout - 2, à +-1 px près.
    Renvoie (longueur_axe_px, x_gauche, x_droite, ligne) ou None.
    """
    lum = rgb[..., :3].astype(np.float32).mean(axis=2)
    best = None
    for r in range(588, 604):
        row = lum[r, 20:138] < 170
        d = np.diff(np.concatenate([[0], row.astype(int), [0]]))
        st, en = np.where(d == 1)[0], np.where(d == -1)[0]
        for s, e in zip(st, en):
            if e - s >= 80 and (best is None or e - s > best[0] + 2):
                best = (e - s - 2, 20 + int(s), 20 + int(e) - 1, r)
    return best


class Ref:
    """Carte de référence rééchantillonnée à ~480 m pour la corrélation."""

    def __init__(self):
        sun = np.fromfile(DATA / "sp_sun_avg_240m.u8", dtype=np.uint8).reshape(N, N).astype(np.float32) / 250.0
        self.sun2 = sun.reshape(N // 2, 2, N // 2, 2).mean(axis=(1, 3))  # 480 m

    def sample(self, x_m, y_m):
        c = (x_m / PX_M + C0 - 0.5) / 2.0
        r = (C0 - y_m / PX_M - 0.5) / 2.0
        return ndi.map_coordinates(self.sun2, [r, c], order=1, mode="constant", cval=np.nan)


def img_to_xy(u, v, p):
    """px image -> x, y (m). p = (u0, v0, km_par_px, rotation_deg) ; rotation = sens horaire de l'image."""
    u0, v0, s, rot = p
    du, dv = (u - u0) * s * 1000.0, -(v - v0) * s * 1000.0
    c, sn = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    return c * du - sn * dv, sn * du + c * dv


def ncc(a, b, mask):
    ok = mask & np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 200:
        return -1.0
    a, b = a[ok], b[ok]
    a = a - a.mean()
    b = b - b.mean()
    den = math.sqrt(float((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / den) if den > 0 else -1.0


def main():
    CHECK.mkdir(exist_ok=True)
    rgb = np.asarray(Image.open(SRC).convert("RGB"))
    H, W = rgb.shape[:2]
    assert (W, H) == (815, 622), (W, H)
    lum = rgb.astype(np.float32).mean(axis=2)
    Y = yellowness(rgb)

    boxes = detect_boxes(rgb)
    sx, sy, sn = detect_star(rgb)
    bar = measure_scale_bar(rgb)
    print("étoile verte (pôle) :", round(sx, 2), round(sy, 2), f"({sn} px)")
    assert bar is not None and 95 <= bar[0] <= 108, bar
    print("barre d'échelle 0-50 km (longueur d'axe px, x gauche, x droite, ligne) :", bar)
    km_px0 = 50.0 / bar[0]
    print(f"échelle initiale : {1 / km_px0:.3f} px/km ({km_px0:.4f} km/px)")

    # Masque des pixels utilisables pour la corrélation
    mask = np.ones((H, W), dtype=bool)
    mask &= ~ndi.binary_dilation(Y > 40, iterations=3)          # traits jaunes
    mask[570:, :170] = False                                    # barre d'échelle
    mask[600:, 620:] = False                                    # crédit
    mask[:8, :] = mask[-8:, :] = False
    mask[:, :8] = mask[:, -8:] = False
    r, g, b = (rgb[..., k].astype(np.int32) for k in range(3))
    mask &= ~ndi.binary_dilation((g > 120) & (g - r > 40), iterations=4)  # étoile
    # textes blancs : zones autour des étiquettes (boîtes manuelles larges)
    for (x0, y0, x1, y1) in [(505, 55, 690, 78), (385, 128, 465, 168), (310, 198, 390, 220), (20, 232, 110, 272),
                             (275, 328, 380, 366), (500, 195, 560, 235), (612, 195, 720, 218), (685, 262, 795, 285),
                             (425, 408, 480, 445), (515, 490, 615, 512)]:
        mask[y0:y1, x0:x1] = False

    ref = Ref()
    vv, uu = np.mgrid[0:H, 0:W].astype(np.float64)

    def score(p):
        x, y = img_to_xy(uu, vv, p)
        return ncc(lum, ref.sample(x, y), mask)

    p0 = np.array([sx, sy, km_px0, 0.0])
    s0 = score(p0)
    # Recherche grossière puis fine (Nelder-Mead, plusieurs départs)
    best_p, best_s = p0, s0
    for du in (-4, 0, 4):
        for dv in (-4, 0, 4):
            for ds in (0.97, 1.0, 1.03):
                for dr in (-2.0, 0.0, 2.0):
                    p = np.array([sx + du, sy + dv, km_px0 * ds, dr])
                    sc = score(p)
                    if sc > best_s:
                        best_p, best_s = p, sc
    res = minimize(lambda p: -score(p), best_p, method="Nelder-Mead",
                   options={"xatol": 0.01, "fatol": 1e-6, "maxiter": 600,
                            "initial_simplex": best_p + np.array([[0, 0, 0, 0], [1.5, 0, 0, 0], [0, 1.5, 0, 0],
                                                                   [0, 0, 0.01, 0], [0, 0, 0, 0.7]])})
    p = res.x
    print(f"corrélation initiale {s0:.4f} (pôle étoile, échelle barre, rotation 0)")
    print(f"corrélation recalée  {-res.fun:.4f} : pôle px ({p[0]:.2f}, {p[1]:.2f}), "
          f"{p[2]:.5f} km/px ({1 / p[2]:.4f} px/km), rotation {p[3]:.3f} deg")
    print(f"écart pôle recalé - étoile : {math.hypot(p[0] - sx, p[1] - sy) * p[2]:.2f} km ; "
          f"écart d'échelle vs barre : {(p[2] / km_px0 - 1) * 100:+.2f} %")

    # Erreur résiduelle locale sur des cratères nets
    resid = []
    for name, lat, lon, diam in CRATERS:
        x, y = latlon_to_xy(lat, lon)
        # position image prédite (inverse de img_to_xy)
        c, s_ = math.cos(math.radians(p[3])), math.sin(math.radians(p[3]))
        du = (c * x + s_ * y) / (p[2] * 1000.0)
        dv = (-s_ * x + c * y) / (p[2] * 1000.0)
        u, v = p[0] + du, p[1] - dv
        half = int(max(22, diam / p[2] * 0.75))
        if not (half + 6 <= u < W - half - 6 and half + 6 <= v < H - half - 6):
            continue
        ui, vi = int(round(u)), int(round(v))
        win = (slice(vi - half, vi + half + 1), slice(ui - half, ui + half + 1))
        if mask[win].mean() < 0.6:
            continue
        x_, y_ = img_to_xy(uu[win], vv[win], p)
        best = (-2, 0, 0)
        grid_s = {}
        for ddv in range(-6, 7):
            for ddu in range(-6, 7):
                w2 = (slice(vi - half + ddv, vi + half + 1 + ddv), slice(ui - half + ddu, ui + half + 1 + ddu))
                sc = ncc(lum[w2], ref.sample(x_, y_), mask[w2])
                grid_s[(ddu, ddv)] = sc
                if sc > best[0]:
                    best = (sc, ddu, ddv)
        sc, ddu, ddv = best
        # affinement parabolique au sous-pixel
        def para(m1, c0, p1):
            den = m1 - 2 * c0 + p1
            return 0.0 if den == 0 else float(np.clip(0.5 * (m1 - p1) / den, -0.5, 0.5))
        fu = ddu + (para(grid_s.get((ddu - 1, ddv), sc), sc, grid_s.get((ddu + 1, ddv), sc)) if abs(ddu) < 6 else 0)
        fv = ddv + (para(grid_s.get((ddu, ddv - 1), sc), sc, grid_s.get((ddu, ddv + 1), sc)) if abs(ddv) < 6 else 0)
        d_km = math.hypot(fu, fv) * p[2]
        resid.append({"crater": name, "px": [round(u, 1), round(v, 1)], "shift_px": [round(fu, 2), round(fv, 2)],
                      "shift_km": round(d_km, 2), "ncc": round(sc, 3), "at_search_limit": abs(ddu) == 6 or abs(ddv) == 6})
        print(f"  résidu {name:12s} px ({u:6.1f},{v:6.1f}) décalage ({fu:+.2f},{fv:+.2f}) px = {d_km:.2f} km, ncc {sc:.3f}")
    good = [r_ for r_ in resid if r_["ncc"] >= 0.5 and not r_["at_search_limit"]]
    rms = math.sqrt(sum(r_["shift_km"] ** 2 for r_ in good) / len(good))
    mx = max(r_["shift_km"] for r_ in good)
    print(f"erreur résiduelle sur {len(good)} cratères : RMS {rms:.2f} km, max {mx:.2f} km")
    # incertitude de lecture des arêtes : ~1 px
    px_km = p[2]

    regions = []
    for bx in boxes:
        l, t, r_, b_ = bx["px"]
        cu, cv = (l + r_) / 2, (t + b_) / 2
        clat, clon = xy_to_latlon(*img_to_xy(cu, cv, p))
        corners = []
        for (u, v) in ((l, t), (r_, t), (r_, b_), (l, b_)):  # NO, NE, SE, SO dans l'image (haut = lon 0)
            la, lo = xy_to_latlon(*img_to_xy(u, v, p))
            corners.append({"lat": round(float(la), 3), "lon": round(float(lo), 2)})
        cx, cy = img_to_xy(cu, cv, p)
        regions.append({
            "id": bx["id"], "name": bx["name"],
            "center": {"lat": round(float(clat), 3), "lon": round(float(clon), 2)},
            "corners": corners,
            "sizeKm": [round(float((r_ - l) * px_km), 1), round(float((b_ - t) * px_km), 1)],
            "centerXYkm": [round(cx / 1000, 2), round(cy / 1000, 2)],
            "method": "georef-image",
            "residualKm": round(rms, 2),
            "imagePx": [round(l, 2), round(t, 2), round(r_, 2), round(b_, 2)],
            "published": None,
        })
        rl, ro = ROUGH[bx["id"]]
        dx, dy = np.array(latlon_to_xy(rl, ro)) - np.array([cx, cy])
        print(f"  {bx['name']:20s} centre {clat:8.3f} {clon:8.2f}  taille {regions[-1]['sizeKm']} km  "
              f"(estimation grossière {rl} {ro} : écart {math.hypot(dx, dy) / 1000:.1f} km)  arêtes {['%.0f' % e for e in bx['edge_strength']]}")

    meta = {"source_image": "site-atterrissage.webp (carte NASA des 9 régions candidates Artemis III, 28/10/2024)",
            "georef": {"model": "similitude image -> stéréographique polaire sud (R = 1737,4 km)",
                       "pole_px": [round(float(p[0]), 2), round(float(p[1]), 2)],
                       "km_per_px": round(float(p[2]), 5), "rotation_deg": round(float(p[3]), 3),
                       "star_px": [round(sx, 2), round(sy, 2)], "scale_bar_km_per_px": round(km_px0, 5),
                       "ncc_initial": round(s0, 4), "ncc_final": round(float(-res.fun), 4),
                       "residuals": resid, "residual_rms_km": round(rms, 2), "residual_max_km": round(mx, 2),
                       "edge_reading_uncertainty_km": round(px_km, 2)}}
    (DATA / "artemis_regions.json").write_text(json.dumps(regions, ensure_ascii=False, indent=1))
    (CHECK / "artemis_georef.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))

    # PNG de contrôle 1 : image x2 avec boîtes détectées
    big = Image.fromarray(rgb).resize((W * 2, H * 2), Image.LANCZOS)
    d = ImageDraw.Draw(big)
    for bx in boxes:
        l, t, r_, b_ = [2 * (x + 0.5) for x in bx["px"]]
        d.rectangle([l, t, r_, b_], outline=(255, 0, 255))
    d.ellipse([2 * p[0] - 5, 2 * p[1] - 5, 2 * p[0] + 5, 2 * p[1] + 5], outline=(255, 0, 0))
    big.save(CHECK / "artemis_boxes_detected.png")
    # PNG de contrôle 2 : ombrage du DEM à la même emprise + régions + damier image / référence
    dem = np.fromfile(DATA / "sp_dem_240m.i16", dtype="<i2").reshape(N, N).astype(np.float32) * 0.5
    hs = hillshade(dem)
    x, y = img_to_xy(np.repeat(uu, 2, 0).repeat(2, 1)[:, :] * 0 + np.linspace(-0.25, W - 0.75, 2 * W)[None, :],
                     np.linspace(-0.25, H - 0.75, 2 * H)[:, None] + np.zeros((2 * H, 2 * W)), p)
    cc, rr = x / PX_M + C0, C0 - y / PX_M
    hs2 = ndi.map_coordinates(hs, [rr, cc], order=1, mode="constant", cval=0)
    sun = np.fromfile(DATA / "sp_sun_avg_240m.u8", dtype=np.uint8).reshape(N, N).astype(np.float32) / 250.0
    sun2 = ndi.map_coordinates(sun, [rr, cc], order=1, mode="constant", cval=0)
    shade = Image.fromarray((np.clip(hs2 * 0.6 + sun2 * 0.8, 0, 1) * 255).astype(np.uint8)).convert("RGB")
    d = ImageDraw.Draw(shade)
    for bx in boxes:
        l, t, r_, b_ = [2 * (x + 0.5) for x in bx["px"]]
        d.rectangle([l, t, r_, b_], outline=(255, 255, 0))
        d.text((l, t - 12), bx["name"], fill=(255, 255, 0))
    for name, lat, lon, diam in CRATERS:
        xx, yy = latlon_to_xy(lat, lon)
        c, s_ = math.cos(math.radians(p[3])), math.sin(math.radians(p[3]))
        u = p[0] + (c * xx + s_ * yy) / (p[2] * 1000.0)
        v = p[1] - (-s_ * xx + c * yy) / (p[2] * 1000.0)
        d.text((2 * u - 20, 2 * v), name, fill=(0, 255, 255))
    shade.save(CHECK / "artemis_dem_same_extent.png")
    a = np.asarray(big).astype(np.float32)
    bimg = np.asarray(shade).astype(np.float32)
    yy_, xx_ = np.mgrid[0:2 * H, 0:2 * W]
    chk = ((yy_ // 160 + xx_ // 160) % 2 == 0)[..., None]
    Image.fromarray(np.where(chk, a, bimg).astype(np.uint8)).save(CHECK / "artemis_checkerboard.png")
    print(json.dumps(regions, ensure_ascii=False)[:300])


if __name__ == "__main__":
    main()
