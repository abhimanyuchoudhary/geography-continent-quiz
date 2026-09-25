#!/usr/bin/env python3
"""Build maps.js from Natural Earth 1:50m admin-0 countries (public domain).

The quiz ships the generated file so play works offline with no map API.
Re-run from the repo root:

    python3 scripts/build_maps.py

Downloads the GeoJSON on first run (or reuses scripts/.cache).
"""

from __future__ import annotations

import json
import math
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_JS = ROOT / "data.js"
OUT_JS = ROOT / "maps.js"
CACHE = Path(__file__).resolve().parent / ".cache" / "ne_50m_admin_0_countries.geojson"
NE_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "v5.1.2/geojson/ne_50m_admin_0_countries.geojson"
)

# min lon, max lon, min lat, max lat in degrees, after shifting toward lon0.
# Windows drop overseas territories (French Guiana, Hawaii, Svalbard, …).
CONTINENT_FRAMES = {
    "Africa": {"lon0": 20, "window": (-26, 58, -36, 38)},
    "Asia": {"lon0": 90, "window": (25, 150, -12, 56)},
    "Europe": {"lon0": 15, "window": (-26, 62, 34, 73)},
    "North America": {"lon0": -100, "window": (-170, -52, 7, 72)},
    "South America": {"lon0": -60, "window": (-82, -34, -56, 13)},
    "Oceania": {"lon0": 160, "window": (108, 230, -50, 12)},
}


def load_seed():
    text = DATA_JS.read_text(encoding="utf-8")
    rows = re.findall(
        r'\["([^"]+)", "([A-Z]{2})", "([^"]+)", "(easy|medium|hard)"\]',
        text,
    )
    if len(rows) < 100:
        raise SystemExit(f"Could not parse country seed from {DATA_JS}")
    return [{"name": n, "iso": iso, "continent": c, "tier": t} for n, iso, c, t in rows]


def ensure_geojson():
    if CACHE.exists() and CACHE.stat().st_size > 1_000_000:
        return CACHE
    alt = Path("/tmp/geo/ne_50m.geojson")
    if alt.exists() and alt.stat().st_size > 1_000_000:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_bytes(alt.read_bytes())
        return CACHE
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading Natural Earth 50m from {NE_URL}")
    urllib.request.urlretrieve(NE_URL, CACHE)
    return CACHE


def feature_iso(props):
    iso = props.get("ISO_A2")
    if iso in (None, "-99", ""):
        iso = props.get("ISO_A2_EH")
    return iso


def iter_polygons(geom):
    gtype = geom["type"]
    if gtype == "Polygon":
        yield geom["coordinates"]
    elif gtype == "MultiPolygon":
        for poly in geom["coordinates"]:
            yield poly


def open_ring(ring):
    pts = [[p[0], p[1]] for p in ring]
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def dedupe(pts):
    if not pts:
        return []
    out = [pts[0]]
    for p in pts[1:]:
        if abs(p[0] - out[-1][0]) > 1e-12 or abs(p[1] - out[-1][1]) > 1e-12:
            out.append(p)
    if len(out) >= 2 and abs(out[0][0] - out[-1][0]) < 1e-12 and abs(out[0][1] - out[-1][1]) < 1e-12:
        out = out[:-1]
    return out


def shoelace(ring):
    if len(ring) < 3:
        return 0.0
    area = 0.0
    for i, p in enumerate(ring):
        q = ring[(i + 1) % len(ring)]
        area += p[0] * q[1] - q[0] * p[1]
    return area / 2.0


def bbox_of(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def shift_lon(lon, lon0):
    x = lon - lon0
    while x > 180:
        x -= 360
    while x < -180:
        x += 360
    return x + lon0


def shift_ring(ring, lon0):
    pts = open_ring(ring)
    if not pts:
        return []
    lons = [p[0] for p in pts]
    if max(lons) - min(lons) > 180:
        pts = [[p[0] + 360 if p[0] < 0 else p[0], p[1]] for p in pts]
    return [[shift_lon(p[0], lon0), p[1]] for p in pts]


def clip_ring(ring, box):
    minx, maxx, miny, maxy = box
    pts = dedupe(ring)
    if len(pts) < 3:
        return []

    def clip(points, inside, edge_t):
        if not points:
            return []
        out = []
        prev = points[-1]
        prev_in = inside(prev)
        for cur in points:
            cur_in = inside(cur)
            if cur_in:
                if not prev_in:
                    out.append(edge_t(prev, cur))
                out.append(cur[:])
            elif prev_in:
                out.append(edge_t(prev, cur))
            prev, prev_in = cur, cur_in
        return out

    def hit_x(a, b, x):
        dx = b[0] - a[0]
        t = 0 if abs(dx) < 1e-15 else (x - a[0]) / dx
        return [x, a[1] + t * (b[1] - a[1])]

    def hit_y(a, b, y):
        dy = b[1] - a[1]
        t = 0 if abs(dy) < 1e-15 else (y - a[1]) / dy
        return [a[0] + t * (b[0] - a[0]), y]

    pts = clip(pts, lambda p: p[0] >= minx, lambda a, b: hit_x(a, b, minx))
    pts = clip(pts, lambda p: p[0] <= maxx, lambda a, b: hit_x(a, b, maxx))
    pts = clip(pts, lambda p: p[1] >= miny, lambda a, b: hit_y(a, b, miny))
    pts = clip(pts, lambda p: p[1] <= maxy, lambda a, b: hit_y(a, b, maxy))
    pts = dedupe(pts)
    if len(pts) < 3 or abs(shoelace(pts)) < 1e-8:
        return []
    return pts


def dist_point_seg(p, a, b):
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def douglas_peucker(points, eps):
    pts = dedupe(points)
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        start, end = stack.pop()
        max_d = -1.0
        idx = None
        for i in range(start + 1, end):
            d = dist_point_seg(pts[i], pts[start], pts[end])
            if d > max_d:
                max_d = d
                idx = i
        if idx is not None and max_d > eps:
            keep[idx] = True
            stack.append((start, idx))
            stack.append((idx, end))
    return [p for p, k in zip(pts, keep) if k]


def ring_diag(ring):
    minx, miny, maxx, maxy = bbox_of(ring)
    return math.hypot(maxx - minx, maxy - miny)


def simplify_ring(ring):
    diag = ring_diag(ring)
    if diag < 1.2:
        eps = 0.008
    elif diag < 6:
        eps = 0.025
    elif diag < 18:
        eps = 0.06
    else:
        eps = 0.14
    simplified = douglas_peucker(ring, eps)
    if len(simplified) < 3:
        return ring if len(ring) >= 3 else []
    return simplified


def min_ring_dist(a, b):
    # Grid hash so archipelago checks stay cheap after simplification.
    thresh = 8.0
    cell = thresh
    grid = {}
    for p in b:
        key = (int(math.floor(p[0] / cell)), int(math.floor(p[1] / cell)))
        grid.setdefault(key, []).append(p)
    best = thresh + 1
    for p in a:
        cx = int(math.floor(p[0] / cell))
        cy = int(math.floor(p[1] / cell))
        for ix in range(cx - 1, cx + 2):
            for iy in range(cy - 1, cy + 2):
                for q in grid.get((ix, iy), []):
                    d = math.hypot(p[0] - q[0], p[1] - q[1])
                    if d < best:
                        best = d
                        if best <= thresh:
                            return best
    return best


def cluster_polys(polys):
    """Keep the main landmass, large pieces (Alaska), and islands near those.

    Distance is measured only against large pieces so a chain of specks cannot
    pull in distant atolls (which would also create false neighbors).
    """
    if not polys:
        return []
    areas = [abs(shoelace(p[0])) for p in polys]
    anchor = max(range(len(polys)), key=lambda i: areas[i])
    anchor_area = areas[anchor] or 1e-12
    large = [i for i, area in enumerate(areas) if i == anchor or area >= 0.08 * anchor_area]
    kept = set(large)
    for i, poly in enumerate(polys):
        if i in kept:
            continue
        if any(min_ring_dist(poly[0], polys[j][0]) <= 6.0 for j in large):
            kept.add(i)
    return [polys[i] for i in sorted(kept)]


def prepare_country(geom, frame):
    lon0 = frame["lon0"]
    window = frame["window"]
    polys = []
    for poly in iter_polygons(geom):
        rings = []
        for ring in poly:
            shifted = shift_ring(ring, lon0)
            clipped = clip_ring(shifted, window)
            simple = simplify_ring(clipped) if clipped else []
            if len(simple) >= 3:
                rings.append(simple)
        if not rings:
            continue
        # Drop a polygon whose outer ring vanished; keep holes only if outer exists.
        polys.append(rings)
    return cluster_polys(polys)


def mercator_project(lon, lat):
    lat = max(-84.0, min(84.0, lat))
    x = math.radians(lon)
    y = -math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def project_continent(countries):
    """countries: iso -> list of polygons (rings in shifted lon/lat)."""
    pts = []
    for polys in countries.values():
        for rings in polys:
            for ring in rings:
                pts.extend(ring)
    if not pts:
        raise RuntimeError("No geometry to project")
    projected = [mercator_project(p[0], p[1]) for p in pts]
    minx = min(p[0] for p in projected)
    maxx = max(p[0] for p in projected)
    miny = min(p[1] for p in projected)
    maxy = max(p[1] for p in projected)
    dx = max(maxx - minx, 1e-6)
    dy = max(maxy - miny, 1e-6)
    pad_x = dx * 0.08
    pad_y = dy * 0.08
    minx -= pad_x
    maxx += pad_x
    miny -= pad_y
    maxy += pad_y
    span = max(maxx - minx, maxy - miny)
    scale = 1000.0 / span
    width = (maxx - minx) * scale
    height = (maxy - miny) * scale

    def conv(lon, lat):
        x, y = mercator_project(lon, lat)
        return (x - minx) * scale, (y - miny) * scale

    out = {}
    for iso, polys in countries.items():
        commands = []
        xs = []
        ys = []
        for rings in polys:
            for ring in rings:
                mapped = []
                for lon, lat in ring:
                    x, y = conv(lon, lat)
                    if mapped and abs(mapped[-1][0] - x) < 0.02 and abs(mapped[-1][1] - y) < 0.02:
                        continue
                    mapped.append((x, y))
                if len(mapped) < 3:
                    continue
                commands.append("M" + "L".join(f"{x:.2f} {y:.2f}" for x, y in mapped) + "Z")
                if ring is rings[0]:
                    xs.extend(p[0] for p in mapped)
                    ys.extend(p[1] for p in mapped)
        if not commands or not xs:
            continue
        bx0, by0, bx1, by1 = min(xs), min(ys), max(xs), max(ys)
        bw = max(bx1 - bx0, 0.4)
        bh = max(by1 - by0, 0.4)
        out[iso] = {
            "d": "".join(commands),
            "b": [round(bx0, 2), round(by0, 2), round(bw, 2), round(bh, 2)],
        }
    view = [0, 0, round(width, 2), round(height, 2)]
    return view, out


def outer_points(polys):
    pts = []
    for rings in polys:
        pts.extend(rings[0])
    return pts


def countries_are_neighbors(a_pts, b_pts, thresh=1.7):
    cell = thresh
    grid = {}
    for x, y in b_pts:
        grid.setdefault((int(math.floor(x / cell)), int(math.floor(y / cell))), []).append((x, y))
    for x, y in a_pts:
        cx = int(math.floor(x / cell))
        cy = int(math.floor(y / cell))
        for ix in range(cx - 1, cx + 2):
            for iy in range(cy - 1, cy + 2):
                for px, py in grid.get((ix, iy), []):
                    if (x - px) ** 2 + (y - py) ** 2 <= thresh * thresh:
                        return True
    return False


def centroid(pts):
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def build_neighbors(by_continent):
    neighbors = {}
    for _cont, countries in by_continent.items():
        isos = list(countries)
        points = {iso: outer_points(polys) for iso, polys in countries.items()}
        cents = {iso: centroid(points[iso]) for iso in isos if points[iso]}
        for iso in isos:
            dists = []
            near = []
            for other in isos:
                if other == iso or not points[iso] or not points[other]:
                    continue
                dx = cents[iso][0] - cents[other][0]
                dy = cents[iso][1] - cents[other][1]
                dist = math.hypot(dx, dy)
                dists.append((dist, other))
                if countries_are_neighbors(points[iso], points[other]):
                    near.append((dist, other))
            near.sort()
            chosen = [iso2 for _d, iso2 in near[:12]]
            if len(chosen) < 3:
                dists.sort()
                for _d, other in dists:
                    if other not in chosen:
                        chosen.append(other)
                    if len(chosen) >= 4:
                        break
            neighbors[iso] = chosen
    return neighbors


def pick_feature(features):
    def area(feat):
        total = 0.0
        for poly in iter_polygons(feat["geometry"]):
            total += abs(shoelace(open_ring(poly[0])))
        return total

    return max(features, key=area)


def main():
    seed = load_seed()
    by_iso = {}
    for row in seed:
        by_iso.setdefault(row["iso"], row)

    geo_path = ensure_geojson()
    data = json.loads(geo_path.read_text(encoding="utf-8"))
    features_by_iso = {}
    for feat in data["features"]:
        iso = feature_iso(feat["properties"])
        if iso in by_iso:
            features_by_iso.setdefault(iso, []).append(feat)

    missing = [iso for iso in by_iso if iso not in features_by_iso]
    if missing:
        raise SystemExit(f"Natural Earth is missing ISOs: {missing}")

    raw_by_cont = {name: {} for name in CONTINENT_FRAMES}
    dropped = []
    for iso, row in by_iso.items():
        feat = pick_feature(features_by_iso[iso])
        frame = CONTINENT_FRAMES[row["continent"]]
        polys = prepare_country(feat["geometry"], frame)
        if not polys:
            dropped.append(iso)
            continue
        raw_by_cont[row["continent"]][iso] = polys

    if dropped:
        print("Dropped (no geometry inside continent window):", ", ".join(sorted(dropped)))

    maps = {}
    for cont, countries in raw_by_cont.items():
        view, drawn = project_continent(countries)
        # Drop raw polys that failed to project
        raw_by_cont[cont] = {iso: countries[iso] for iso in drawn}
        maps[cont] = {"view": view, "countries": drawn}
        pts = sum(path["d"].count("L") + path["d"].count("M") for path in drawn.values())
        print(f"{cont}: {len(drawn)} countries, ~{pts} points, view {view[2]:.0f}x{view[3]:.0f}")

    neighbors = build_neighbors(raw_by_cont)

    # Stable key order
    maps_out = {}
    for cont in CONTINENT_FRAMES:
        countries = maps[cont]["countries"]
        maps_out[cont] = {
            "view": maps[cont]["view"],
            "countries": {iso: countries[iso] for iso in sorted(countries)},
        }
    neighbors_out = {iso: neighbors[iso] for iso in sorted(neighbors)}

    header = (
        "/* Generated by scripts/build_maps.py from Natural Earth 1:50m cultural vectors.\n"
        "   Natural Earth is public domain: https://www.naturalearthdata.com/\n"
        "   Bundled so the quiz can draw maps offline. Do not edit by hand. */\n"
    )
    body = (
        "var MAPS = "
        + json.dumps(maps_out, separators=(",", ":"))
        + ";\nvar NEIGHBORS = "
        + json.dumps(neighbors_out, separators=(",", ":"))
        + ";\n"
    )
    OUT_JS.write_text(header + body, encoding="utf-8")
    print(f"Wrote {OUT_JS} ({OUT_JS.stat().st_size / 1024:.0f} KB)")

    # Sanity: every continent can form a 4-choice question, cartographer can fill a long round.
    hard = [r for r in seed if r["tier"] == "hard" and r["iso"] in neighbors_out]
    easy = [r for r in seed if r["tier"] == "easy" and r["iso"] in neighbors_out]
    print(f"Playable easy {len(easy)} hard {len(hard)} total {len(neighbors_out)}")
    for cont, countries in raw_by_cont.items():
        if len(countries) < 4:
            raise SystemExit(f"{cont} has only {len(countries)} drawable countries")
    if len(hard) < 50:
        raise SystemExit(f"Cartographer pool is {len(hard)}, expected at least 50")
    for iso, nbs in neighbors_out.items():
        if len(nbs) < 3:
            raise SystemExit(f"{iso} has fewer than 3 neighbor/fallback countries")
    # A few familiar borders should be detected.
    expect = {
        "FR": "DE",
        "GM": "SN",
        "LS": "ZA",
        "MC": "FR",
        "NP": "IN",
        "CA": "US",
    }
    for iso, other in expect.items():
        if iso not in neighbors_out:
            raise SystemExit(f"missing {iso}")
        if other not in neighbors_out[iso]:
            raise SystemExit(f"expected {iso} near {other}, got {neighbors_out[iso]}")
    print("Neighbor checks ok:", ", ".join(f"{a}-{b}" for a, b in expect.items()))
    for sample in ("FR", "DE", "AU", "NZ", "SG", "TD", "RU", "BR", "JP"):
        print(f"  near {sample}: {', '.join(neighbors_out[sample])}")


if __name__ == "__main__":
    main()
