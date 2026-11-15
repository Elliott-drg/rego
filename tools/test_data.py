#!/usr/bin/env python3
"""Tests de non-régression des données livrées (pytest ou exécution directe).

    tools/.venv/bin/python -I tools/test_data.py
"""
import hashlib
import json
import sys

import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))  # compatible python -I
from grid import DATA, N, RAW, ROOT, cr_to_latlon, great_circle_km, latlon_to_cr


def load(name, dtype):
    return np.fromfile(DATA / name, dtype=dtype).reshape(N, N)


def test_grid_roundtrip_and_orientation():
    c, r = latlon_to_cr(-90, 0)
    assert abs(c - 1905.5) < 1e-9 and abs(r - 1905.5) < 1e-9
    c, r = latlon_to_cr(-85, 0)       # lon 0 vers le haut
    assert abs(c - 1905.5) < 1e-6 and r < 1905.5
    c, r = latlon_to_cr(-85, 90)      # est à droite
    assert c > 1905.5 and abs(r - 1905.5) < 1e-6
    # 5 deg du pôle : rho = 2 R tan(2,5 deg) = 151,72 km = 632,15 px
    assert abs((c - 1905.5) - 2 * 1737400 * np.tan(np.radians(2.5)) / 240) < 1e-6
    la, lo = cr_to_latlon(*latlon_to_cr(-87.3, -123.4))
    assert abs(la + 87.3) < 1e-9 and abs(lo + 123.4) < 1e-9
    # bord de l'image = 75 deg S
    la, _ = cr_to_latlon(1905.5, -0.5)
    assert abs(la + 75) < 0.01


def test_polar_rasters():
    assert (DATA / "sp_dem_240m.i16").stat().st_size == 29062688
    assert (DATA / "sp_dem_240m.i16").read_bytes() == (RAW / "ldem_75s_240m.img").read_bytes()
    dem = load("sp_dem_240m.i16", "<i2").astype(np.float32) * 0.5
    sun, earth, psr = (load(f"sp_{k}_240m.u8", np.uint8) for k in ("sun_avg", "earth_avg", "psr"))
    assert sun.max() <= 250 and earth.max() <= 250 and set(np.unique(psr)) == {0, 1}
    # Fond de Shackleton : profond, en ombre permanente, Terre jamais visible
    c, r = (int(round(float(v))) for v in latlon_to_cr(-89.67, 129.2))
    assert dem[r, c] < -2500 and psr[r, c] == 1 and sun[r, c] == 0 and earth[r, c] == 0
    # Crête voisine : haute et très éclairée (> 60 % dans un voisinage de 1,2 km)
    c, r = (int(round(float(v))) for v in latlon_to_cr(-89.45, -137.3))
    assert dem[r, c] > 1500 and psr[r, c] == 0 and sun[r - 2:r + 3, c - 2:c + 3].max() > 150
    # Massif de Malapert : sommet > 4 500 m, pas en PSR
    c, r = (int(round(float(v))) for v in latlon_to_cr(-85.99, -2.9))
    assert dem[r, c] > 4500 and psr[r, c] == 0
    # La Terre est vers lon 0 (haut de l'image) : bord haut souvent visible, bord bas jamais
    assert earth[5, 1700:2100].mean() > 200 and earth[-5, 1700:2100].mean() < 5
    # PSR => illumination moyenne quasi nulle
    assert sun[psr == 1].mean() < 1.0


def test_diviner():
    tmax, tmin, tavg = (load(f"sp_{k}_240m.u16", "<u2") for k in ("tmax", "tmin", "tavg"))
    psr = load("sp_psr_240m.u8", np.uint8)
    ok = tmax > 0
    assert 0.34 < ok.mean() < 0.36
    # couverture = calotte >= 80 deg S : rien en dehors de 80 deg S (rayon 1266,7 px)
    rr, cc = np.mgrid[0:N, 0:N]
    rad = np.hypot(cc - 1905.5, rr - 1905.5)
    assert not ok[rad > 1270].any() and ok[rad < 1200].mean() > 0.99
    assert np.median(tmax[ok & (psr == 1)]) < 1300 < 2200 < np.median(tmax[ok & (psr == 0)])
    both = ok & (tavg > 0) & (tmin > 0)
    assert (tavg[both] <= tmax[both]).all() and (tmin[both] > tavg[both]).mean() < 1e-3
    c, r = (int(round(float(v))) for v in latlon_to_cr(-89.67, 129.2))
    assert tmax[r, c] < 1100  # fond de Shackleton : < 110 K


def test_global():
    g = np.fromfile(DATA / "global_ldem_4ppd.i16", dtype="<i2").reshape(720, 1440)
    assert g.min() == -8878 and g.max() == 10504
    from PIL import Image
    for name, size in (("moon_color_4k.jpg", (4096, 2048)), ("moon_color_2k.jpg", (2048, 1024))):
        im = Image.open(DATA / name)
        assert im.size == size and im.mode == "RGB"
    # Mare Crisium (17 N, 59 E) sombre, à droite du centre ; hautes terres (17 N, 100 E) claires
    a = np.asarray(Image.open(DATA / "moon_color_2k.jpg").convert("L")).astype(float)
    px = lambda lat, lon: (int((90 - lat) / 180 * 1024), int((lon + 180) / 360 * 2048))
    r1, c1 = px(17, 59)
    r2, c2 = px(17, 100)
    assert a[r1 - 5:r1 + 5, c1 - 5:c1 + 5].mean() + 20 < a[r2 - 5:r2 + 5, c2 - 5:c2 + 5].mean()


def test_tables():
    lp = json.loads((DATA / "lpgrs_5deg.json").read_text())
    assert lp["grid"]["regular5x5"] is False and len(lp["cells"]) == 1790
    bands = lp["grid"]["latBands"]
    assert sum(b["nLon"] for b in bands) == 1790 and bands[0]["nLon"] == 1
    # recherche par bande : cellule contenant (0 N, 0 E)
    b = next(b for b in bands if b["latMin"] <= 0.1 < b["latMax"])
    cell = lp["cells"][b["first"] + int((0.1 + 180) / (360 / b["nLon"]))]
    assert cell["lonMin"] <= 0.1 < cell["lonMax"] and 30 < cell["SiO2"] < 55
    for c in lp["cells"]:
        # somme des 6 oxydes : 88,7 à 107,1 % dans la source (démixage non contraint), médiane 98,5 %
        assert 0.85 < (c["FeO"] + c["TiO2"] + c["Al2O3"] + c["CaO"] + c["SiO2"] + c["MgO"]) / 100 < 1.10
        assert abs(c["U"] - 0.27 * c["Th"]) < 0.02 * max(c["Th"], 0.05) + 1e-3
    h = json.loads((DATA / "lp_hydrogen.json").read_text())
    v = h["layers"]["H"]
    assert len(v) == 360 * 720 and sum(x is None for x in v) == h["nodataCount"] == 1
    south = [x for x in v[350 * 720:] if x is not None]
    eq = [x for x in v[170 * 720:190 * 720] if x is not None]
    assert sum(south) / len(south) > 1.5 * sum(eq) / len(eq)  # enrichissement polaire
    f = json.loads((DATA / "features.json").read_text())
    by = {x["name"]: x for x in f}
    assert abs(by["Shackleton"]["lat"] + 89.67) < 0.05 and 125 < by["Shackleton"]["lon"] < 135
    assert by["Tycho"]["lon"] < 0 and by["Mare Crisium"]["lon"] > 50
    assert all(-180 <= x["lon"] <= 180 and (x["lat"] < -60 or x["diamKm"] >= 80) for x in f)


def test_artemis():
    a = json.loads((DATA / "artemis_regions.json").read_text())
    assert len(a) == 9 and len({x["id"] for x in a}) == 9
    by = {x["id"]: x for x in a}
    for x in a:
        assert len(x["corners"]) == 4 and x["method"] == "georef-image" and 0 < x["residualKm"] < 2
        assert -90 < x["center"]["lat"] < -83
    # Recoupements indépendants : sommet du massif de Malapert dans sa région ; distances au pôle (presse)
    d = lambda i: great_circle_km(by[i]["center"]["lat"], by[i]["center"]["lon"], -90, 0)
    assert great_circle_km(by["malapert-massif"]["center"]["lat"], by["malapert-massif"]["center"]["lon"],
                           -85.99, -2.9) < 12
    assert 180 < d("peak-near-cabeus-b") < 205 and 45 < d("de-gerlache-rim-2") < 60
    assert d("de-gerlache-rim-2") == min(d(i) for i in by)


def test_manifest_and_vendor():
    m = json.loads((DATA / "manifest.json").read_text())
    for e in m["files"]:
        p = (DATA / e["file"]).resolve()
        assert p.stat().st_size == e["bytes"]
        assert hashlib.sha256(p.read_bytes()).hexdigest() == e["sha256"], e["file"]
    v = ROOT / "public" / "vendor"
    assert "from 'three';" in (v / "OrbitControls.js").read_text()
    assert "export function RotationAxis" in (v / "astronomy.js").read_text()
    assert "export function Libration" in (v / "astronomy.js").read_text()


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
