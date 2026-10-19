"""
Campus Navigator map build.

    python pipeline/build.py

Reads   data/raw/campus_footprints.geojson   building outlines
        data/raw/bac_maps.kml                paths, roads, parking (Google Earth)
        pipeline/config.py                   floors, road pairs, stairs, roof settings
Writes  data/map_data.json                   everything, in metres
        web/map_data.json                    same data, served next to the map for websites and apps
        web/map_data.js                      same data as a script, so pages also work opened from disk
"""
import json
import math
import sys
from pathlib import Path

from shapely.geometry import LineString, Polygon
from shapely.validation import make_valid

sys.path.insert(0, str(Path(__file__).parent))
import config
from geo import Projection, load_footprints, load_kml
from geometry import indoor_centreline, pitched_roof, point_along, road_from_edges

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"


def campus_boundary(parts, buildings, notes, gap_m=3.0):
    """Join the fence lines end to end into one closed outline, reversing any drawn the other way."""
    files = sorted({f for f, _, _ in parts})
    left = [pts for _, _, pts in parts]
    ring = list(left.pop(0))
    while left:
        end = ring[-1]
        k, flip, d = min(((i, r, math.dist(end, p[-1] if r else p[0])) for i, p in enumerate(left) for r in (False, True)),
                         key=lambda t: t[2])
        if d > gap_m:
            sys.exit(f"campus boundary: the fence lines leave a {d:.1f} m gap at ({end[0]}, {end[1]}); "
                     f"check config.WALK_FILES")
        nxt = left.pop(k)
        ring += list(reversed(nxt)) if flip else list(nxt)
    if math.dist(ring[0], ring[-1]) > gap_m:
        sys.exit(f"campus boundary does not close: its ends are {math.dist(ring[0], ring[-1]):.1f} m apart")
    out = [ring[0]]
    for p in ring[1:]:
        if math.dist(out[-1], p) > 0.5:
            out.append(p)
    if math.dist(out[0], out[-1]) <= 0.5:
        out.pop()
    P = Polygon(out)
    if not P.is_valid:                                    # hand-drawn lines overshooting each other at a corner
        pieces = [g for g in getattr(make_valid(P), "geoms", [make_valid(P)]) if g.geom_type == "Polygon"]
        main_piece = max(pieces, key=lambda g: g.area)
        lost = sum(g.area for g in pieces) - main_piece.area
        if lost > 0.01 * main_piece.area:
            sys.exit("campus boundary crosses itself; check the fence lines in " + ", ".join(files))
        P = main_piece.simplify(0.05)
        out = [[round(x, 2), round(y, 2)] for x, y in list(P.exterior.coords)[:-1]]
        notes.append(f"campus boundary: fence lines overlap at a corner, {lost:.1f} m2 trimmed")
    for b in buildings:
        outside = Polygon(b["points_m"]).difference(P).area
        if outside > 0.05:
            notes.append(f"{b['name']}: {outside:.1f} m2 lies outside the campus boundary")
    return {"name": "Campus boundary", "points_m": out, "area_m2": round(P.area), "source": ", ".join(files)}


def main():
    # -- 1. one shared origin, from the building footprints --------------
    footprints = load_footprints(RAW / "campus_footprints.geojson")
    all_ll = [p for _, ring in footprints for p in ring]
    proj = Projection([p[0] for p in all_ll], [p[1] for p in all_ll])

    # -- 2. buildings ------------------------------------------------------
    rename_queue = {k: list(v) for k, v in config.DUPLICATE_RENAMES.items()}
    buildings = []
    for name, ring in footprints:                         # file order decides which duplicate is which
        if name in config.REPLACED_FOOTPRINTS:
            continue
        if name in rename_queue and rename_queue[name]:
            name = rename_queue[name].pop(0)
        pts = [proj.to_m(*p) for p in ring]
        buildings.append({"name": name, "floors": config.FLOORS.get(name, 1), "points_m": pts})

    # -- 3. everything traced in Google Earth ------------------------------
    paths, areas, elevated, traced, notes = [], [], [], {}, []
    footprint_of = {b["name"]: Polygon(b["points_m"]) for b in buildings}
    for name, kind, coords in load_kml(RAW / "bac_maps.kml"):
        pts = [proj.to_m(*c) for c in coords]
        traced[name] = pts

        if name in config.KML_BUILDINGS:                 # a building traced in Earth
            spec = config.KML_BUILDINGS[name]
            P = Polygon(pts).buffer(0)                    # a traced line is closed here
            for other in spec.get("subtract", []):
                cut = P.intersection(footprint_of[other]).area
                if cut > 0.5:
                    P = P.difference(footprint_of[other])
                    notes.append(f"{name}: removed {cut:.0f} m2 overlapping {other}")
            P = max(getattr(P, "geoms", [P]), key=lambda g: g.area)
            ring = [[round(x, 2), round(y, 2)] for x, y in list(P.exterior.coords)[:-1]]
            b = {"name": name, "floors": spec.get("floors", 1),
                 "points_m": ring, "source": "traced in Google Earth"}
            if "height_m" in spec:
                b["height_m"] = spec["height_m"]
            buildings.append(b)
        elif kind == "polygon" and name in config.ELEVATED_AREAS:
            elevated.append({"name": name, "points_m": pts, **config.ELEVATED_AREAS[name],
                             "area_m2": round(Polygon(pts).area)})
        elif kind == "polygon":
            areas.append({"name": name, "kind": config.AREA_KINDS.get(name, "area"),
                          "points_m": pts, "area_m2": round(Polygon(pts).area)})
        else:
            L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
            paths.append({"name": name, "points_m": pts, "length_m": round(L, 1),
                          "level": 0, "indoor": False})

    # -- 4. edge pairs: two traced edges become one surface -----------------
    roads, used = [], set()
    for title, a, b, kind, level in config.EDGE_PAIRS:
        missing = [n for n in (a, b) if n not in traced]
        if missing:
            print(f"  ! '{title}' skipped, KML has no line named {missing}")
            continue
        s = road_from_edges(traced[a], traced[b])
        if kind == "road":
            roads.append({"name": title, **s})
        else:                                             # walkway or bridge: a route with a real width
            paths.append({"name": title, "points_m": s["centre_m"], "length_m": s["length_m"],
                          "width_m": s["width_m"], "level": level, "indoor": False,
                          **({"bridge": True} if kind == "bridge" else {})})
        used |= {a, b}
    paths = [p for p in paths if p["name"] not in used]

    # -- 4b. verified walks: routes walked or measured for real (data/raw/walks/*.kml|kmz) --
    # Each line becomes a footpath the router slightly prefers, so routes follow the way
    # people actually walk. Kept apart from bac_maps.kml so a new walk is just a new file.
    walks, fence_parts = [], []
    for f in sorted((RAW / "walks").glob("*.km[lz]")) if (RAW / "walks").is_dir() else []:
        spec = config.WALK_FILES.get(f.name, {})
        found = set()
        for name, kind, coords in load_kml(f):
            if kind != "line":
                continue
            found.add(name)
            pts = [proj.to_m(*c) for c in coords]
            if name in spec.get("boundary", []):
                fence_parts.append((f.name, name, pts))
                continue
            title = spec.get("names", {}).get(name, name)
            twin = next((w for w in walks if LineString(w["points_m"]).hausdorff_distance(LineString(pts)) < 1.0), None)
            if twin:
                notes.append(f"{f.name}: '{name}' skipped, it repeats the walk '{twin['name']}'")
                continue
            L = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
            walks.append({"name": title, "points_m": pts, "length_m": round(L, 1), "width_m": config.WALK_WIDTH_M,
                          "level": 0, "indoor": False, "verified": True, "source": f.name})
        for name in (set(spec.get("boundary", [])) | set(spec.get("names", {}))) - found:
            print(f"  ! {f.name} has no line named '{name}' (config.WALK_FILES)")
    paths += walks
    boundary = campus_boundary(fence_parts, buildings, notes) if fence_parts else None

    # -- 5. indoor corridor, computed from the footprint -------------------
    ind = config.INDOOR
    host = next(b for b in buildings if b["name"] == ind["building"])
    ends = traced[ind["endpoints_from"]]
    centre, length, tightest = indoor_centreline(host["points_m"], ends[0], ends[-1])
    paths = [p for p in paths if p["name"] != ind["endpoints_from"]]   # replaced by the computed one
    levels = [0, 1] if ind["first_floor_mirrors_ground"] else [0]
    for lvl in levels:
        label = "ground" if lvl == 0 else "first"
        p = {"name": f"{ind['building']} — {label} floor corridor", "points_m": centre,
             "length_m": length, "level": lvl, "indoor": True, "building": ind["building"]}
        if lvl:
            p["assumed"] = "mirrors ground floor, per evacuation diagram"
        paths.append(p)

    # -- 6. stairs ---------------------------------------------------------
    nodes = []
    for s in config.STAIRS:
        at = s.get("at") or point_along(centre, s["fraction"])
        nodes.append({"name": s["name"], "at": at, "connects": s["connects"],
                      "estimated": "at" not in s})

    # -- 7. roofs ----------------------------------------------------------
    for b in buildings:
        b["roof"] = pitched_roof(b["points_m"], config.ROOF_SLOPE, config.ROOF_MAX_RUN_M)

    # -- 8. write ----------------------------------------------------------
    data = {"buildings": buildings, "paths": paths, "areas": areas, "elevated": elevated,
            "roads": roads, "nodes": nodes}
    if boundary:
        data["boundary"] = boundary
    blob = json.dumps(data, separators=(",", ":"))
    (ROOT / "data" / "map_data.json").write_text(blob)
    (ROOT / "web" / "map_data.json").write_text(blob)
    (ROOT / "web" / "map_data.js").write_text(
        "/* Generated by pipeline/build.py. Do not edit. */\nwindow.CAMPUS_MAP_DATA = " + blob + ";\n")

    # -- report ------------------------------------------------------------
    print(f"buildings  {len(buildings)}")
    for b in buildings:
        src = "  (traced in Earth)" if b.get("source") else ""
        print(f"  {b['name']:16s} {b['floors']} storey   roof rise {b['roof']['rise']} m{src}")
    print(f"roads      {len(roads)}")
    for r in roads:
        lo, hi = r["width_range_m"]
        print(f"  {r['name']:30s} {r['length_m']:6.1f} m  x {lo}-{hi} m (typical {r['width_m']} m)")
    print(f"paths      {len(paths)}")
    for p in paths:
        where = "indoor " if p["indoor"] else ("bridge " if p.get("bridge") else "walked " if p.get("verified") else "outdoor")
        width = f"  x {p['width_m']} m" if "width_m" in p else ""
        print(f"  {where} L{p['level']}  {p['name']:40s} {p['length_m']:6.1f} m{width}")
    print(f"  corridor stays >= {tightest} m from any wall")
    print(f"areas      {len(areas)}")
    for a in areas:
        print(f"  {a['name']:36s} {a['area_m2']} m2")
    print(f"elevated   {len(elevated)}")
    for e in elevated:
        print(f"  {e['name']:36s} {e['area_m2']} m2, {e['kind']} at level {e['level']}")
    print(f"stairs     {len(nodes)} ({sum(n['estimated'] for n in nodes)} estimated)")
    if boundary:
        print(f"boundary   {boundary['area_m2']} m2, {len(boundary['points_m'])} corners, from {boundary['source']}")
    for n in notes:
        print(f"  note: {n}")
    print("wrote data/map_data.json, web/map_data.json and web/map_data.js")


if __name__ == "__main__":
    main()
