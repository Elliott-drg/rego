#!/usr/bin/env python3
"""Rasters polaires sur la grille de référence 3812 x 3812 à 240 m.

Entrées (tools/raw/) :
  ldem_75s_240m.img                              LOLA GDR (référence)
  illum/AVGVISIB_75S_120M_201608.IMG             illumination solaire moyenne
  illum/AVGVISIB_75S_120M_201608_EARTH.IMG       visibilité moyenne de la Terre
  illum/LPSR_75S_120M_201608.IMG                 ombre permanente
  diviner/polar_south_80_{summer,winter}_{max,min,avg}-float.tif  (Williams et al. 2019)
Sorties (public/data/) :
  sp_dem_240m.i16, sp_sun_avg_240m.u8, sp_earth_avg_240m.u8, sp_psr_240m.u8,
  sp_tmax_240m.u16, sp_tmin_240m.u16, sp_tavg_240m.u16
Les labels PDS (.LBL) sont relus et contrôlés avant tout traitement.
"""
import re
import shutil
import sys

import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))  # compatible python -I
from grid import C0, DATA, N, PX_M, RAW, cr_to_xy

ILLUM_N = 7624  # 120 m/px


def read_label(path):
    """Mots-clés utiles d'un label PDS3 (dernier gagnant pour les doublons)."""
    out = {}
    for line in path.read_text(errors="replace").splitlines():
        m = re.match(r"\s*([A-Z_\^:]+)\s*=\s*(.+?)\s*$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def num(v):
    return float(re.match(r"[-+0-9.eE]+", v.strip("\"' ")).group(0))


def check_polar_label(lbl, lines, scale_m, offset):
    assert int(num(lbl["LINES"])) == lines and int(num(lbl["LINE_SAMPLES"])) == lines, lbl
    assert lbl["SAMPLE_TYPE"] == "LSB_INTEGER" and int(num(lbl["SAMPLE_BITS"])) == 16
    assert "POLAR STEREOGRAPHIC" in lbl["MAP_PROJECTION_TYPE"]
    assert num(lbl["CENTER_LATITUDE"]) == -90 and num(lbl["CENTER_LONGITUDE"]) == 0
    assert num(lbl["MAP_SCALE"]) == scale_m
    assert num(lbl["LINE_PROJECTION_OFFSET"]) == offset and num(lbl["SAMPLE_PROJECTION_OFFSET"]) == offset
    assert num(lbl["A_AXIS_RADIUS"]) == 1737.4
    assert "EAST" in lbl["POSITIVE_LONGITUDE_DIRECTION"]
    assert num(lbl["MAP_PROJECTION_ROTATION"]) == 0.0


def block_sum_2x2(mm, dtype=np.int32, chunk=512):
    """Somme des blocs 2x2 d'un memmap 7624x7624 -> 3812x3812, par bandes."""
    out = np.empty((N, N), dtype=dtype)
    for r0 in range(0, N, chunk):
        r1 = min(N, r0 + chunk)
        a = np.asarray(mm[2 * r0:2 * r1], dtype=dtype)
        out[r0:r1] = a[0::2, 0::2] + a[0::2, 1::2] + a[1::2, 0::2] + a[1::2, 1::2]
    return out


def do_dem():
    src = RAW / "ldem_75s_240m.img"
    lbl = read_label(RAW / "ldem_75s_240m.lbl")
    check_polar_label(lbl, N, 240, C0)
    assert num(lbl["SCALING_FACTOR"]) == 0.5
    assert src.stat().st_size == 29062688, src.stat().st_size
    shutil.copyfile(src, DATA / "sp_dem_240m.i16")
    print("sp_dem_240m.i16 : copie identique,", src.stat().st_size, "octets")


def do_avgvisib(stem, out_name):
    lbl = read_label(RAW / "illum" / f"{stem}.LBL")
    # 120 m : centre à 3811.5 ; les blocs 2x2 (2k, 2k+1) ont pour centre
    # (2k + 0.5 - 3811.5) * 120 = (k - 1905.5) * 240 : alignement exact.
    check_polar_label(lbl, ILLUM_N, 120, 3811.5)
    sf, off = num(lbl["SCALING_FACTOR"]), num(lbl["OFFSET"])
    assert sf == 0.00004 and off == 0.0, (sf, off)
    mm = np.memmap(RAW / "illum" / f"{stem}.IMG", dtype="<i2", mode="r", shape=(ILLUM_N, ILLUM_N))
    s = block_sum_2x2(mm)
    assert s.min() >= 0 and s.max() <= 4 * 25000, (s.min(), s.max())
    frac = s.astype(np.float64) * (sf / 4.0)
    out = np.rint(frac * 250.0).astype(np.uint8)  # 0..250 ; 255 = sans donnée (aucun ici)
    out.tofile(DATA / out_name)
    print(f"{out_name} : min {out.min()} max {out.max()} moyenne {frac.mean():.4f}")
    return out


def do_psr():
    stem = "LPSR_75S_120M_201608"
    lbl = read_label(RAW / "illum" / f"{stem}.LBL")
    check_polar_label(lbl, ILLUM_N, 120, 3811.5)
    sf, off = num(lbl["SCALING_FACTOR"]), num(lbl["OFFSET"])
    assert sf == 0.000025 and off == 0.5, (sf, off)  # DN +20000 -> 1 (PSR), -20000 -> 0
    mm = np.memmap(RAW / "illum" / f"{stem}.IMG", dtype="<i2", mode="r", shape=(ILLUM_N, ILLUM_N))
    out = np.empty((N, N), dtype=np.uint8)
    ties = 0
    for r0 in range(0, N, 512):
        r1 = min(N, r0 + 512)
        a = np.asarray(mm[2 * r0:2 * r1])
        assert np.isin(a, (-20000, 20000)).all()
        b = (a > 0).astype(np.uint8)
        cnt = b[0::2, 0::2] + b[0::2, 1::2] + b[1::2, 0::2] + b[1::2, 1::2]
        ties += int((cnt == 2).sum())
        out[r0:r1] = cnt >= 3  # majorité stricte des 4 sous-pixels de 120 m
    out.tofile(DATA / "sp_psr_240m.u8")
    print(f"sp_psr_240m.u8 : {int(out.sum())} px PSR ({out.mean() * 100:.3f} %), "
          f"{ties} px à égalité 2/4 classés non-PSR")
    return out


def read_diviner_tif(name):
    """GeoTIFF float32 de Williams et al. (2019) : renvoie tableau + géotransformation."""
    import tifffile

    with tifffile.TiffFile(RAW / "diviner" / name) as t:
        p = t.pages[0]
        a = p.asarray().astype(np.float32)
        sx, sy, _ = p.tags["ModelPixelScaleTag"].value
        _, _, _, x0, y0, _ = p.tags["ModelTiepointTag"].value
        dbl = p.tags["GeoDoubleParamsTag"].value
        keys = p.tags["GeoKeyDirectoryTag"].value
    # Contrôles : stéréographique polaire (code 15), lat origine -90, lon 0, R = 1737400
    kd = {keys[i]: keys[i + 3] for i in range(4, len(keys), 4)}
    assert kd.get(3075) == 15 and kd.get(1025) == 1, kd  # CT_PolarStereographic, PixelIsArea
    assert -90.0 in dbl and 1737400.0 in dbl, dbl
    assert abs(sx - sy) < 1e-9
    return a, (x0, y0, sx)


def resample_bilinear(a, geo):
    """Bilinéaire vers la grille de référence, pondéré par les voisins valides.

    Hors emprise ou poids valide < 0,5 : NaN.
    """
    x0, y0, s = geo
    h, w = a.shape
    out = np.full((N, N), np.nan, dtype=np.float32)
    cols = np.arange(N)
    for r0 in range(0, N, 256):
        r1 = min(N, r0 + 256)
        cc, rr = np.meshgrid(cols, np.arange(r0, r1))
        x, y = cr_to_xy(cc, rr)
        fc = (x - x0) / s - 0.5  # indice flottant de colonne source (centre de pixel)
        fr = (y0 - y) / s - 0.5
        c0 = np.floor(fc).astype(np.int64)
        r0s = np.floor(fr).astype(np.int64)
        tx = (fc - c0).astype(np.float32)
        ty = (fr - r0s).astype(np.float32)
        acc = np.zeros(cc.shape, dtype=np.float32)
        wsum = np.zeros(cc.shape, dtype=np.float32)
        for dr, dc, wgt in ((0, 0, (1 - tx) * (1 - ty)), (0, 1, tx * (1 - ty)),
                            (1, 0, (1 - tx) * ty), (1, 1, tx * ty)):
            ri, ci = r0s + dr, c0 + dc
            ok = (ri >= 0) & (ri < h) & (ci >= 0) & (ci < w)
            v = np.full(cc.shape, np.nan, dtype=np.float32)
            v[ok] = a[ri[ok], ci[ok]]
            good = np.isfinite(v)
            acc[good] += v[good] * wgt[good]
            wsum[good] += wgt[good]
        good = wsum >= 0.5
        blk = np.full(cc.shape, np.nan, dtype=np.float32)
        blk[good] = acc[good] / wsum[good]
        out[r0:r1] = blk
    return out


def to_u16_k10(a):
    out = np.zeros(a.shape, dtype=np.uint16)
    ok = np.isfinite(a)
    out[ok] = np.clip(np.rint(a[ok] * 10.0), 1, 65535).astype(np.uint16)
    return out


def do_diviner():
    need = [f"polar_south_80_{s}_{k}-float.tif" for s in ("summer", "winter") for k in ("max", "min", "avg")]
    if not all((RAW / "diviner" / n).exists() for n in need):
        print("Diviner : fichiers sources absents, rien n'est produit")
        return None
    g = {}
    geo = None
    for n in need:
        a, geo_n = read_diviner_tif(n)
        assert geo is None or geo == geo_n
        geo = geo_n
        g[n.split("80_")[1].split("-")[0]] = resample_bilinear(a, geo)
    with np.errstate(invalid="ignore"):
        tmax = np.fmax(g["summer_max"], g["winter_max"])  # max sur les deux saisons (NaN ignoré)
        tmin = np.fmin(g["summer_min"], g["winter_min"])
        tavg = 0.5 * (g["summer_avg"] + g["winter_avg"])  # NaN si l'une des deux saisons manque
    for nm, a in (("sp_tmax_240m.u16", tmax), ("sp_tmin_240m.u16", tmin), ("sp_tavg_240m.u16", tavg)):
        u = to_u16_k10(a)
        u.astype("<u2").tofile(DATA / nm)
        ok = u > 0
        print(f"{nm} : couverture {ok.mean() * 100:.2f} % de la grille, "
              f"min {u[ok].min() / 10:.1f} K, médiane {np.median(u[ok]) / 10:.1f} K, max {u[ok].max() / 10:.1f} K")
    return tmax, tmin, tavg


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    what = sys.argv[1:] or ["dem", "sun", "earth", "psr", "diviner"]
    if "dem" in what:
        do_dem()
    if "sun" in what:
        do_avgvisib("AVGVISIB_75S_120M_201608", "sp_sun_avg_240m.u8")
    if "earth" in what:
        do_avgvisib("AVGVISIB_75S_120M_201608_EARTH", "sp_earth_avg_240m.u8")
    if "psr" in what:
        do_psr()
    if "diviner" in what:
        do_diviner()
