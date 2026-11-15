#!/usr/bin/env python3
"""Refait toutes les données de public/data, public/vendor et public/assets depuis tools/raw/.

Usage :
    bash tools/fetch_raw.sh                      # télécharge les sources (réseau, IPv4)
    tools/.venv/bin/python -I tools/prepare_data.py   # tout refaire (~1 min, < 1 Go de RAM)

Étapes (une à la fois, les gros rasters sont lus par bandes / memmap) :
    prepare_polar.py   DEM, illumination, Terre, PSR, températures Diviner (grille 3812 x 3812, 240 m)
    check_polar.py     PNG de contrôle + valeurs aux points de contrôle (tools/check/)
    prepare_global.py  cartes globales couleur et relief (+ contrôle de convention)
    prepare_tables.py  LP GRS 5 deg, hydrogène LP 0,5 deg, nomenclature IAU
    georef_artemis.py  régions Artemis III géoréférencées depuis l'image NASA
    prepare_assets.py  logo
    (vendor)           copie de three.module.js, OrbitControls.js, astronomy.js depuis les paquets npm
    build_manifest.py  public/data/manifest.json
"""
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STEPS = ["prepare_polar.py", "check_polar.py", "prepare_global.py", "prepare_tables.py", "georef_artemis.py",
         "prepare_assets.py"]


def vendor():
    npm = HERE / "raw" / "npm"
    out = ROOT / "public" / "vendor"
    out.mkdir(parents=True, exist_ok=True)
    for src, dst in ((npm / "three/package/build/three.module.js", "three.module.js"),
                     (npm / "three/package/examples/jsm/controls/OrbitControls.js", "OrbitControls.js"),
                     (npm / "astro/package/esm/astronomy.js", "astronomy.js")):
        shutil.copyfile(src, out / dst)
    txt = (out / "OrbitControls.js").read_text()
    assert "from 'three';" in txt and "three/addons" not in txt and "../" not in txt.split("from 'three';")[0]
    assert "const REVISION = '170';" in (out / "three.module.js").read_text()[:2000]
    print("vendor : three r170 (three.module.js, OrbitControls.js) et astronomy-engine 2.1.19 copiés")


def main():
    for s in STEPS:
        print(f"\n=== {s}")
        subprocess.run([sys.executable, "-I", str(HERE / s)], check=True)
    print("\n=== vendor")
    vendor()
    print("\n=== build_manifest.py")
    subprocess.run([sys.executable, "-I", str(HERE / "build_manifest.py")], check=True)


if __name__ == "__main__":
    main()
