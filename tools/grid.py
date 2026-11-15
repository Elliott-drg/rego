"""Grille polaire de référence de Regolith Finder (contrat, ne pas changer).

LOLA LDEM_75S_240M : 3812 x 3812 px, 240 m/px, stéréographique polaire sud
(sphère R = 1737,4 km, échelle vraie au pôle), centre lat -90, lon 0 vers le
HAUT de l'image, longitudes est positives.

Pixel 0-based (col c, ligne r), centre du pixel :
    x = (c - 1905.5) * 240 m      (x > 0 : vers lon +90 E, à droite)
    y = (1905.5 - r) * 240 m      (y > 0 : vers lon 0, en haut)
    x = rho * sin(lon), y = rho * cos(lon), rho = 2 R tan((90 + lat) / 2)
"""
import math

import numpy as np

N = 3812
PX_M = 240.0
R_M = 1737400.0
C0 = 1905.5  # LINE/SAMPLE_PROJECTION_OFFSET du label (pixel 0-based)

ROOT = __import__("pathlib").Path(__file__).resolve().parent.parent
RAW = ROOT / "tools" / "raw"
DATA = ROOT / "public" / "data"
CHECK = ROOT / "tools" / "check"


def latlon_to_xy(lat, lon):
    """lat, lon en degrés -> x, y en mètres (tableaux numpy acceptés)."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    rho = 2.0 * R_M * np.tan(np.radians(90.0 + lat) / 2.0)
    return rho * np.sin(np.radians(lon)), rho * np.cos(np.radians(lon))


def xy_to_latlon(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    rho = np.hypot(x, y)
    lat = -90.0 + 2.0 * np.degrees(np.arctan(rho / (2.0 * R_M)))
    lon = np.degrees(np.arctan2(x, y))
    return lat, lon


def xy_to_cr(x, y):
    """x, y (m) -> col, ligne flottants (0-based, centre de pixel = entier)."""
    return np.asarray(x) / PX_M + C0, C0 - np.asarray(y) / PX_M


def cr_to_xy(c, r):
    return (np.asarray(c, dtype=np.float64) - C0) * PX_M, (C0 - np.asarray(r, dtype=np.float64)) * PX_M


def latlon_to_cr(lat, lon):
    return xy_to_cr(*latlon_to_xy(lat, lon))


def cr_to_latlon(c, r):
    return xy_to_latlon(*cr_to_xy(c, r))


def great_circle_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_M / 1000.0 * math.asin(min(1.0, math.sqrt(a)))


def load_dem_m():
    """DEM de référence en mètres (float32) par rapport à 1737,4 km."""
    dn = np.fromfile(RAW / "ldem_75s_240m.img", dtype="<i2").reshape(N, N)
    return dn.astype(np.float32) * 0.5


def hillshade(h_m, px_m=PX_M, az_deg=315.0, alt_deg=35.0, z=1.0):
    """Ombrage simple (soleil fictif), renvoie float32 dans [0, 1]."""
    gy, gx = np.gradient(h_m.astype(np.float32) * z, px_m)
    # gy est d/d(ligne) : ligne croissante = y décroissant
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(gy, -gx)
    az = math.radians(360.0 - az_deg + 90.0)
    alt = math.radians(alt_deg)
    s = np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect)
    return np.clip(s, 0, 1).astype(np.float32)
