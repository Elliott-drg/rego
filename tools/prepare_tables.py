#!/usr/bin/env python3
"""Tables : Lunar Prospector GRS 5 deg, hydrogène LP 0,5 deg, nomenclature IAU.

Entrées (tools/raw/) :
  lp/lpgrs_high1_elem_abundance_5deg.tab + .lbl   (Prettyman et al. 2006)
  lp/hydrogenhd.txt, lp/hydrogenhd.dat            (Feldman et al. 2001, produit spécial)
  iau/MOON_nomenclature_center_pts.dbf            (USGS / IAU)
Sorties (public/data/) : lpgrs_5deg.json, lp_hydrogen.json, features.json
"""
import json
import math
import re
import struct
import sys

import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))  # compatible python -I
from grid import DATA, RAW


def sig(x, n=4):
    if x == 0 or not math.isfinite(x):
        return 0.0 if x == 0 else None
    return float(f"{x:.{n}g}")


def do_lpgrs():
    lbl = (RAW / "lp" / "lpgrs_high1_elem_abundance_5deg.lbl").read_text(errors="replace")
    # Colonnes lues dans le label (numéro -> nom), pour ne rien supposer
    cols = {int(m.group(1)): m.group(2) for m in re.finditer(r"^\s+(\d+)\s+([A-Z_0-9\[\],]+)\s+\(", lbl, re.M)}
    assert cols[0] == "PIXEL_INDEX" and cols[1] == "MIN_LAT" and cols[4] == "MAX_LON", cols
    want = {"MgO": "W_MGO", "Al2O3": "W_AL2O3", "SiO2": "W_SIO2", "CaO": "W_CAO", "TiO2": "W_TIO2",
            "FeO": "W_FEO", "K": "W_K", "Th": "W_TH", "U": "W_U"}
    idx = {k: [i for i, n in cols.items() if n == v][0] for k, v in want.items()}
    assert [idx[k] for k in ("MgO", "Al2O3", "SiO2", "CaO", "TiO2", "FeO", "K", "Th", "U")] == list(range(7, 16))
    assert "East longitude convention is used (-180 to 180 degrees)" in lbl
    assert "5 degree equal area pixels" in lbl
    # Matrice d'erreur : E[i,j], i <= j, ordre (MgO, Al2O3, SiO2, CaO, TiO2, FeO, K, Th, U)
    order = ["MgO", "Al2O3", "SiO2", "CaO", "TiO2", "FeO", "K", "Th", "U"]
    diag = {order[i]: [c for c, n in cols.items() if n == f"E[{i},{i}]"][0] for i in range(9)}
    oxides = ("MgO", "Al2O3", "SiO2", "CaO", "TiO2", "FeO")

    rows = []
    for line in (RAW / "lp" / "lpgrs_high1_elem_abundance_5deg.tab").read_text().splitlines():
        if line.strip():
            v = line.split()
            assert len(v) == 61, len(v)
            rows.append([float(x) for x in v])
    assert len(rows) == 1790
    cells, bands = [], []
    for v in rows:
        c = {"i": int(v[0]), "latMin": v[1], "latMax": v[2], "lonMin": v[3], "lonMax": v[4]}
        for k in order:
            f = 100.0 if k in oxides else 1.0  # oxydes : fraction massique g/g -> % massique
            c[k] = sig(v[idx[k]] * f)
            var = v[diag[k]]
            c["s" + k] = sig(math.sqrt(var) * f, 3) if var >= 0 else None
        cells.append(c)
    # Bandes de latitude (du sud au nord dans le fichier) pour une recherche directe
    i = 0
    while i < len(cells):
        j = i
        while j < len(cells) and (cells[j]["latMin"], cells[j]["latMax"]) == (cells[i]["latMin"], cells[i]["latMax"]):
            j += 1
        band = cells[i:j]
        w = 360.0 / len(band)
        assert abs(band[0]["lonMin"] + 180) < 1e-6 and abs(band[-1]["lonMax"] - 180) < 1e-6
        assert all(abs(b["lonMin"] - (-180 + k * w)) < 0.06 for k, b in enumerate(band)), band[1]
        bands.append({"latMin": band[0]["latMin"], "latMax": band[0]["latMax"], "nLon": len(band), "first": i})
        i = j
    assert bands[0]["latMin"] == -90 and bands[-1]["latMax"] == 90
    assert all(abs(bands[k]["latMax"] - bands[k + 1]["latMin"]) < 1e-6 for k in range(len(bands) - 1))
    out = {
        "grid": {"type": "equal-area-cells", "regular5x5": False, "nCells": len(cells), "nominalStepDeg": 5,
                 "note": "Pixels de surface égale (~5 deg d'arc), PAS une grille régulière 5x5 deg : "
                         "bandes de latitude (2,5 deg aux pôles puis 5 deg, centrées sur les multiples de 5) "
                         "découpées en nLon cellules de largeur 360/nLon. Recherche : bande par latitude, "
                         "puis index = first + floor((lon + 180) / (360 / nLon)). Les limites lonMin/lonMax "
                         "du fichier sont arrondies à 0,1 deg.",
                 "lonConvention": "est positif, -180..180", "latBands": bands},
        "units": {"MgO": "wt%", "Al2O3": "wt%", "SiO2": "wt%", "CaO": "wt%", "TiO2": "wt%", "FeO": "wt%",
                  "K": "ppm", "Th": "ppm", "U": "ppm",
                  "note": "Oxydes : fraction massique du label (g/g) x 100, aucune conversion élément -> oxyde "
                          "(le label fournit déjà les oxydes). K, Th, U : ppm massiques tels que dans le label ; "
                          "U est lié à Th par l'algorithme (U = 0,27 Th). sX = incertitude propagée 1 sigma "
                          "= racine du terme diagonal E[i,i] de la matrice d'erreur, mêmes unités."},
        "fields": ["FeO", "TiO2", "Al2O3", "CaO", "SiO2", "MgO", "Th", "K", "U"],
        "cells": cells,
        "nodata": None,
        "source": {"dataset": "LP-L-GRS-5-ELEM-ABUNDANCE-V1.0", "product_id": "LPGRS_HIGH1_ELEM_ABUNDANCE_5DEG",
                   "url": "https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/"
                          "lpgrs_high1_elem_abundance_5deg.tab",
                   "citation": "Prettyman, T. H., et al. (2006), Elemental composition of the lunar surface: "
                               "Analysis of gamma ray spectroscopy data from Lunar Prospector, J. Geophys. Res., "
                               "111, E12007, doi:10.1029/2005JE002656."},
    }
    (DATA / "lpgrs_5deg.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    sp = cells[0]
    print(f"lpgrs_5deg.json : {len(cells)} cellules, {len(bands)} bandes ; cellule polaire sud : "
          f"FeO {sp['FeO']} %, TiO2 {sp['TiO2']} %, Th {sp['Th']} ppm ; "
          f"FeO min/max {min(c['FeO'] for c in cells)}/{max(c['FeO'] for c in cells)} %")


def do_hydrogen():
    txt = RAW / "lp" / "hydrogenhd.txt"
    if not txt.exists():
        print("hydrogène LP : source absente, rien n'est produit")
        return
    head = [l for l in txt.read_text().splitlines()[:20] if l.startswith("#")]
    assert any("H ppm by weight" in l for l in head) and any("259200 binned values" in l for l in head), head
    # Une valeur du fichier ASCII est illisible ("**********", dépassement de format à la source) :
    # elle reste sans donnée (null), rien n'est interpolé.
    rows, bad = [], 0
    for line in txt.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        p = [x.strip() for x in line.split(",")]
        assert len(p) == 5, line
        if "*" in p[4]:
            bad += 1
            p[4] = "nan"
        rows.append([float(x) for x in p])
    a = np.array(rows, dtype=np.float64)
    assert a.shape == (259200, 5) and bad <= 5, (a.shape, bad)
    grid = np.full((360, 720), np.nan)
    r = np.rint((90.0 - a[:, 1]) / 0.5).astype(int)   # ligne 0 = bande 89,5..90 N
    c = np.rint((a[:, 2] + 180.0) / 0.5).astype(int)  # colonne 0 = -180..-179,5
    assert np.allclose(a[:, 1] - a[:, 0], 0.5) and np.allclose(a[:, 3] - a[:, 2], 0.5)
    seen = np.zeros((360, 720), dtype=bool)
    seen[r, c] = True
    assert seen.all()
    grid[r, c] = a[:, 4]
    ok = np.isfinite(grid)
    assert (~ok).sum() == bad
    # Recoupement avec l'image binaire (int16 MSB, valeur x10, 1re ligne = pôle Sud, 1er échantillon = -180)
    dat = RAW / "lp" / "hydrogenhd.dat"
    cross = None
    if dat.exists():
        b = np.fromfile(dat, dtype=">i2").reshape(360, 720)[::-1] / 10.0
        cross = float(np.abs(b - grid)[ok].max())
        assert cross <= 0.1001, cross  # le binaire tronque au dixième
    vals = [round(float(x), 1) if math.isfinite(x) else None for x in grid.ravel()]
    neg = int((grid[ok] < 0).sum())
    out = {
        "grid": {"nLat": 360, "nLon": 720, "stepDeg": 0.5, "latTop": 90, "lonLeft": -180,
                 "order": "ligne par ligne depuis le nord, depuis lon -180 ; est positif"},
        "units": {"H": "ppm massiques d'hydrogène"},
        "layers": {"H": vals},
        "nodata": None,
        "nodataCount": bad,
        "negativeCount": neg,
        "source": {"product": "Lunar Prospector Neutron Spectrometer, 'Hydrogen_halfdeg' (hydrogenhd.txt), "
                              "version du 3 janvier 2002",
                   "url": "https://pds-geosciences.wustl.edu/missions/lunarp/reduced/hydrogenhd.txt",
                   "page": "https://pds-geosciences.wustl.edu/missions/lunarp/reduced_special.html",
                   "citation": "Feldman, W. C., et al. (2001), Evidence for water ice near the lunar poles, "
                               "J. Geophys. Res., 106(E10), 23231-23251, doi:10.1029/2000JE001444.",
                   "limitations": "Produit spécial LANL, non revu par les pairs du PDS. Carte en cases de 0,5 deg "
                                  "mais empreinte réelle de l'instrument de plusieurs dizaines de km (valeurs "
                                  "lissées). Abondances déduites des neutrons épithermiques corrigés des thermiques "
                                  "(Feldman et al. 2001, éq. 3-4) ; peu fiables là où Th et terres rares sont "
                                  "élevés (Maurice et al. 2001). Les valeurs négatives de la source (bruit autour de zéro) "
                                  "sont conservées telles quelles ; les cases illisibles à la source valent null."},
    }
    (DATA / "lp_hydrogen.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"lp_hydrogen.json : 360x720, H min {np.nanmin(grid):.1f} max {np.nanmax(grid):.1f} ppm, "
          f"moyenne au sud de 85 S {np.nanmean(grid[350:]):.1f} ppm, moyenne équatoriale (+-10 deg) "
          f"{np.nanmean(grid[160:200]):.1f} ppm, écart max txt/dat {cross}, {bad} case(s) sans donnée, "
          f"{neg} valeurs négatives")


def read_dbf(path):
    with open(path, "rb") as f:
        h = f.read(32)
        nrec, hlen, rlen = struct.unpack("<IHH", h[4:12])
        fields = []
        while True:
            d = f.read(32)
            if d[0] == 0x0D:
                break
            fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
        f.seek(hlen)
        for _ in range(nrec):
            r = f.read(rlen)
            o, row = 1, {}
            for n, l in fields:
                row[n] = r[o:o + l].decode("utf-8").strip()
                o += l
            yield row


def do_features():
    out, n_all = [], 0
    for r in read_dbf(RAW / "iau" / "MOON_nomenclature_center_pts.dbf"):
        n_all += 1
        if r["approval"] != "Adopted by IAU":
            continue
        lat, lon, d = float(r["center_lat"]), float(r["center_lon"]), float(r["diameter"])
        lon = ((lon + 180.0) % 360.0) - 180.0  # source : 0..360 est -> -180..180 est positif
        if lat < -60.0 or d >= 80.0:
            out.append({"name": r["name"], "type": r["type"], "lat": round(lat, 4), "lon": round(lon, 4),
                        "diamKm": round(d, 2)})
    out.sort(key=lambda x: (-x["diamKm"], x["name"]))
    (DATA / "features.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    south = sum(1 for x in out if x["lat"] < -60)
    byname = {x["name"]: x for x in out}
    print(f"features.json : {len(out)} entités sur {n_all} ({south} au sud de 60 S, {len(out) - south} de "
          f"diamètre >= 80 km ailleurs)")
    for k in ("Shackleton", "de Gerlache", "Haworth", "Shoemaker", "Faustini", "Nobile", "Malapert", "Cabeus",
              "Mons Mouton", "Slater", "Mare Imbrium", "Tycho"):
        print("   ", k, byname.get(k))


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    what = sys.argv[1:] or ["lpgrs", "hydrogen", "features"]
    if "lpgrs" in what:
        do_lpgrs()
    if "hydrogen" in what:
        do_hydrogen()
    if "features" in what:
        do_features()
