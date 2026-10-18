"""Main building interiors: rooms, doors and stairs for each floor.

    python pipeline/interiors.py        ->  web/interiors.json, web/interiors.js

SOURCES
  * drawings/main_building_ground_floor_3d.png  "Main building - ground floor (cutaway)", draft 09
  * drawings/Upper_floor_.png                   "Campus - 3D model view", draft 09 (first-floor labels)
  Both say "concept only, not to scale". They are used for WHAT is where (names, order, side
  of the corridor, which stairs exist); the satellite-traced footprint and corridor in
  map_data.json stay the ground truth for WHERE.

REGISTRATION (how drawing pixels become metres)
  The campus drawing was fitted to map_data.json with a least-squares affine transform over
  17 building labels (median error 1.5 m, worst 6.7 m). The ground-floor drawing was fitted to
  the campus drawing over 9 shared features (within 13 px, about 1.5 m). Heights are corrected
  with 9.05 px per metre (cutaway labels at 0.8 m, roof labels at 7.5 m).

HOW ROOMS ARE MADE
  footprint - corridor strip (1.4 m half width + 0.15 m wall) - entrance passages = room space.
  Each drawn room becomes a seed; the room space on each floor is divided between seeds by
  Voronoi cells, so rooms keep the drawn order and neighbours but fill the real footprint.
  Space with no seed stays "unassigned" (not walkable). Every room is marked approximate.
"""
import json, math, pathlib
from PIL import Image
import numpy as np
from shapely.geometry import Polygon, LineString, Point, MultiPoint, MultiPolygon, GeometryCollection
from shapely.ops import unary_union, voronoi_diagram, nearest_points, polylabel

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "web/map_data.json").read_text())
BUILDING = "Main buildin"
CORR_HALF, WALL = 1.4, 0.15

# ---------- registration ----------
M = np.array([[0.0, 0.0], [0.0, 0.0], [0.0, 0.0]])   # filled below from control points
UPPER_CTRL = {'Block D': (1390, 1083), 'Block g': (1547, 1066), 'Block F2': (1591, 1151), 'Maitron house': (1650, 1007), 'Hostel 1': (1839, 889),
              'School Clinic': (1953, 885), 'Hostel 2': (1911, 1085), 'Hostel 3': (2143, 1002), 'Block f': (2151, 897), 'Pc 1': (2187, 810),
              'Block K 2': (1837, 1257), 'Block K': (1887, 1319), 'Block *': (1510, 1319), "Lecturer's offices": (1622, 1393),
              'Block B': (1493, 1507), 'Block A': (1419, 1570), 'Ladies Toilet': (1330, 1493)}
GROUND_TO_UPPER = {'Block D': ((1650, 1060), (1390, 1083)), 'Blue stairs': ((1785, 1290), (1463, 1223)), 'Lecture chairs': ((270, 570), (470, 758)),
                   'Walking path': ((773, 322), (805, 592)), 'Lawn': ((1018, 276), (970, 560)), 'Staff parking': ((1655, 810), (1394, 918)),
                   'Smoking area': ((755, 938), (792, 1003)), 'Rock outcrop': ((825, 1210), (839, 1183)), 'Ramp': ((133, 625), (377, 792))}
K_HEIGHT, H_LAB = 9.05, 4.0

def fit(src, dst):
    A = np.c_[np.array(src, float), np.ones(len(src))]
    T, *_ = np.linalg.lstsq(A, np.array(dst, float), rcond=None)
    err = np.hypot(*(A @ T - np.array(dst)).T)
    return T, err
cent = {b['name']: Polygon(b['points_m']).centroid for b in DATA['buildings']}
M, err_u = fit(list(UPPER_CTRL.values()), [(cent[n].x, cent[n].y) for n in UPPER_CTRL])
T, err_g = fit([v[0] for v in GROUND_TO_UPPER.values()], [v[1] for v in GROUND_TO_UPPER.values()])
def up2m(px, z):
    return tuple(np.array([px[0], px[1] + (z - H_LAB) * K_HEIGHT, 1.0]) @ M)
def g2m(px, z=0.8):
    u = np.array([px[0], px[1], 1.0]) @ T
    return up2m(u, z)

# ---------- what the drawings show ----------
#   name, type, pixel position
GROUND_ROOMS = [("Unspecified room (north-west)", "unspecified", (318, 347)), ("Student centre / marketing office", "office", (690, 402)),
                ("Unspecified room (east)", "unspecified", (693, 560)), ("Laundry", "service", (463, 757)),
                ("Lab 1", "lab", (727, 669)), ("Lab 3", "lab", (886, 678)), ("Lab 2", "lab", (774, 773)),
                ("IT room", "room", (1050, 690)), ("Room 1", "room", (1225, 725)), ("M toilets", "toilet", (1349, 760)),
                ("Room 2", "room", (1415, 819)), ("Lab 4", "lab", (1488, 910)), ("W toilets", "toilet", (1536, 982)),
                ("Lab 5", "lab", (1527, 1059)), ("Lab 6", "lab", (1497, 1142)), ("Lab 7", "lab", (1576, 1246)), ("Lab 8", "lab", (1688, 1277))]
FIRST_ROOMS = [("Kitchen", "service", (425, 600)), ("Office 1", "office", (460, 567)), ("Office 2", "office", (516, 547)), ("Office 3", "office", (569, 529)),
               ("Reception", "office", (668, 516)), ("Office 4", "office", (719, 562)), ("Office 5", "office", (740, 590)), ("Office 6", "office", (752, 618)),
               ("Office 7", "office", (753, 650)), ("Office 8", "office", (745, 679)), ("Office 9", "office", (746, 706)), ("Office 10", "office", (752, 731)),
               ("CAF", "cafeteria", (602, 828)), ("LT", "lecture", (817, 800)), ("Lecture Room 119", "lecture", (1049, 797)), ("WC M", "toilet", (1190, 830)),
               ("Lab 12", "lab", (1235, 871)), ("Lab 13", "lab", (1285, 931)), ("WC F", "toilet", (1314, 978)), ("Lab 14", "lab", (1308, 1031)),
               ("Lab 15", "lab", (1285, 1100)), ("Lab 16", "lab", (1320, 1149)), ("Lab 17", "lab", (1414, 1176))]
GLASS_DOOR = g2m((1052, 658), 1.0)            # outer door of the IT room, ground floor
STAIRS_SOUTH = [g2m((1500, 1215), 0.5), up2m((1235, 1103), 7.5)]   # "L-shaped stairs" / "Stair tower" (south)
BLUE_STAIRS = [g2m((1785, 1290), 1.5), up2m((1465, 1226), 7.5)]
MAIN_ENTRANCE_STAIRS = up2m((682, 470), 2.0)  # "Main entrance · stairs to floor 1"
CONFIRMED = {"Stair well (Reception)": [g2m((446, 380), 0.5), up2m((587, 568), 7.5)],
             "Stair well (Lecture Theatre)": [g2m((995, 790), 0.5), up2m((954, 845), 7.5)]}
NOT_CONNECTED = [{"name": "Stairs between CAF and LT", "at": [round(v, 1) for v in up2m((697, 853), 7.5)],
                  "why": "Marked as stairs only on the campus drawing; the ground-floor drawing shows nothing there. Not connected until confirmed."}]
MISSING = ["No plan for a third level ('Upper floor'): both drawings show a two-level building (the campus drawing's notes say 'main building two levels'). Level 2 can be added to FLOORS when a plan exists.",
           "No lifts are shown on either drawing, so none are modelled.",
           "Room boundaries are not to scale on the drawings; rooms here divide the satellite footprint in the drawn order. Verify on site.",
           "The drawings place the south-east wing 4-8 m east of the satellite footprint; rooms were fitted to the footprint.",
           "Doors inside the building are not all drawn; every room gets one door on its corridor side unless the drawing shows otherwise.",
           "The gazebos (lecture chairs, smoking area), lawn and other new outdoor features in draft 09 are not in map_data.json yet.",
           "Rooms along the south-east wing are only 3-4 m deep, because the estimated corridor runs near that wing's outer wall. The space on the courtyard side is left unassigned.",
           "The ground-floor corridor is the estimated centreline from map_data.json; the drawings show a covered walkway on the courtyard side instead."]
FLOORS = [{"level": 0, "name": "Ground floor", "short": "G"}, {"level": 1, "name": "First floor", "short": "1", "aka": "Upper floor"}]

# ---------- geometry ----------
F = Polygon(next(b for b in DATA['buildings'] if b['name'] == BUILDING)['points_m']).buffer(0)
P = {p['name']: p for p in DATA['paths']}
C = LineString(P[BUILDING + " — ground floor corridor"]['points_m'])
strip = C.buffer(CORR_HALF + WALL)
doors = json.loads((ROOT / "pipeline/_doors_cache.json").read_text())
passages = unary_union([LineString(s).buffer(0.9 + WALL) for d in doors for s in d['segs']]).intersection(F)

def side(pt):
    s = C.project(Point(pt)); a = C.interpolate(max(0, s - 0.5)); b = C.interpolate(min(C.length, s + 0.5)); f = C.interpolate(s)
    return math.copysign(1, (b.x - a.x) * (pt[1] - f.y) - (b.y - a.y) * (pt[0] - f.x))

def parts(g):
    if g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    return [x for x in getattr(g, "geoms", []) if isinstance(x, Polygon) and x.area > 1.0]

def divide(level, seeds, space):
    pieces = [p for p in parts(space) if p.area > 4]
    owner = {}
    for i, (name, typ, pt) in enumerate(seeds):
        sd = side(pt)
        cands = sorted(pieces, key=lambda q: q.distance(Point(pt)))
        same = [q for q in cands if side((q.representative_point().x, q.representative_point().y)) == sd and q.distance(Point(pt)) < 12]
        pc = (same or cands)[0]
        if not pc.contains(Point(pt)):            # drawn outside the traced footprint: pull it 1 m inside, keeping its order
            q, _ = nearest_points(pc.buffer(-1.0) if not pc.buffer(-1.0).is_empty else pc, Point(pt))
            seeds[i] = (name, typ, (q.x, q.y))
        owner.setdefault(id(pc), (pc, []))[1].append(i)
    rooms, used = [], []
    for piece, idx in owner.values():
        if len(idx) == 1: cells = {idx[0]: piece}
        else:
            vor = voronoi_diagram(MultiPoint([seeds[i][2] for i in idx]), envelope=piece.buffer(60))
            cells = {}
            for i in idx:
                cell = next(c for c in vor.geoms if c.contains(Point(seeds[i][2])) or c.distance(Point(seeds[i][2])) < 1e-6)
                cells[i] = cell.intersection(piece)
        for i, cell in cells.items():
            ps = parts(cell)
            if not ps: print("  warning: no space left for", seeds[i][0])
            if not ps: continue
            cell = min(ps, key=lambda q: q.distance(Point(seeds[i][2])))       # keep the piece next to the drawn label
            reach = 14 if seeds[i][1] in ("lecture", "cafeteria", "service") else 12
            capped = parts(cell.intersection(Point(seeds[i][2]).buffer(reach)))     # a lone room does not swallow the courtyard side
            if capped: cell = min(capped, key=lambda q: q.distance(Point(seeds[i][2])))
            rooms.append((i, cell)); used.append(cell)
    leftover = space.difference(unary_union(used)) if used else space
    return rooms, [q for q in parts(leftover) if q.area > 6]

def ring(poly): return [[round(x, 2), round(y, 2)] for x, y in list(poly.exterior.coords)[:-1]]

def build_level(level, spec, z):
    seeds = [(n, t, (g2m(px, z) if level == 0 else up2m(px, z))) for n, t, px in spec]
    space = F.difference(strip)
    if level == 0: space = space.difference(passages)
    rooms, leftover = divide(level, seeds, space)
    out, flags = [], []
    polys = {i: c for i, c in rooms}
    for i, cell in rooms:
        name, typ, pt = seeds[i]
        # the door goes in the middle of the wall that faces the corridor, not at its nearest corner
        ext = cell.exterior; n = max(8, int(ext.length / 0.2)); samples = [ext.interpolate(k / n, normalized=True) for k in range(n)]
        dmin = min(C.distance(q) for q in samples)
        front = [q for q in samples if C.distance(q) <= dmin + 0.35]
        door = front[len(front) // 2]; foot = C.interpolate(C.project(door))
        stub = LineString([door, foot])
        others = [polys[j].buffer(-0.05) for j in polys if j != i]
        blocked = any(stub.intersects(o) for o in others if not o.is_empty)
        rp = polylabel(cell, tolerance=0.05)        # the point furthest from every wall: a sensible room centre
        room = {"id": ("G-" if level == 0 else "F1-") + name.lower().replace(" / ", "-").replace(" ", "-").replace("(", "").replace(")", ""),
                "name": name, "level": level, "type": typ, "points": ring(cell), "centre": [round(rp.x, 2), round(rp.y, 2)],
                "area_m2": round(cell.area), "drawn_at": [round(pt[0], 1), round(pt[1], 1)], "approx": True,
                "door": [round(door.x, 2), round(door.y, 2)], "door_to": [round(foot.x, 2), round(foot.y, 2)], "exits": []}
        if blocked or stub.length > 4:
            room["door"] = None; flags.append(f"{name} (floor {level}): no corridor frontage in the footprint, so it has no door yet. Add one in the editor.")
        out.append(room)
    return out, leftover, flags

rooms0, left0, flags0 = build_level(0, GROUND_ROOMS, 0.8)
rooms1, left1, flags1 = build_level(1, FIRST_ROOMS, 7.5)
rooms = rooms0 + rooms1
by = {r['name'] + "@" + str(r['level']): r for r in rooms}

def exit_from(room, target, toward_level, name):
    poly = Polygon(room['points']); at, _ = nearest_points(poly.exterior, Point(target))
    room['exits'].append({"name": name, "at": [round(at.x, 2), round(at.y, 2)], "to": {"x": round(target[0], 2), "y": round(target[1], 2), "level": toward_level}})

# glass door: IT room to the walking path outside
out_pt, _ = nearest_points(F.exterior, Point(GLASS_DOOR))
it = by["IT room@0"]; ipoly = Polygon(it['points'])
gd, _ = nearest_points(ipoly.exterior, out_pt)
nx, ny = gd.x - ipoly.representative_point().x, gd.y - ipoly.representative_point().y; L = math.hypot(nx, ny)
exit_from(it, (gd.x + nx / L * 1.6, gd.y + ny / L * 1.6), 0, "Glass door")
# first floor: the two ramps/bridges land in the nearest first-floor room
for p in DATA['paths']:
    if p.get('bridge'):
        st = p['points_m'][0]; r = min(rooms1, key=lambda q: Polygon(q['points']).distance(Point(st)))
        exit_from(r, st, 1, p['name'])

def boundary_out(pt, d=1.6):
    b, _ = nearest_points(F.exterior, Point(pt)); c = F.representative_point()
    vx, vy = b.x - c.x, b.y - c.y; L = math.hypot(vx, vy)
    inside = F.contains(Point(b.x + vx / L * .3, b.y + vy / L * .3))
    s = -1 if inside else 1
    return (b.x, b.y), (b.x + s * vx / L * d, b.y + s * vy / L * d)

stairs = []
s_mid = C.interpolate(C.project(Point(np.mean([STAIRS_SOUTH[0][0], STAIRS_SOUTH[1][0]]), np.mean([STAIRS_SOUTH[0][1], STAIRS_SOUTH[1][1]]))))
stairs.append({"id": "stairs-south", "name": "Stair tower (south) / L-shaped stairs", "connects": [0, 1], "external": False,
               "ends": [{"level": 0, "x": round(s_mid.x, 2), "y": round(s_mid.y, 2)}, {"level": 1, "x": round(s_mid.x, 2), "y": round(s_mid.y, 2)}],
               "source": "ground drawing 'L-shaped stairs' and campus drawing 'Stair tower', both by Labs 6-7 / 15-16", "approx": True})
(bx, by_), outp = boundary_out(np.mean(BLUE_STAIRS, axis=0))
stairs.append({"id": "stairs-blue", "name": "Blue stairs (outside)", "connects": [0, 1], "external": True,
               "ends": [{"level": 0, "x": round(outp[0], 2), "y": round(outp[1], 2)}, {"level": 1, "x": round(bx, 2), "y": round(by_, 2)}],
               "source": "both drawings, outside the south-east end", "approx": True})
(mx, my), mout = boundary_out(MAIN_ENTRANCE_STAIRS)
rec = by["Reception@1"]
stairs.append({"id": "stairs-main-entrance", "name": "Main entrance stairs to floor 1", "connects": [0, 1], "external": True,
               "ends": [{"level": 0, "x": round(mout[0], 2), "y": round(mout[1], 2)}, {"level": 1, "x": round(mx, 2), "y": round(my, 2), "room": rec['id'] if Polygon(rec['points']).distance(Point(mx, my)) < 6 else None}],
               "source": "campus drawing label 'Main entrance · stairs to floor 1'", "approx": True})

# ---------- renders: the two drawings shown as the app's map ----------
# The drawings are not to scale, so one affine fit leaves the main building and the roads several
# metres off. A thin-plate spline from map metres to campus-drawing pixels bends the display
# instead (navigation data is never moved). Control points: building labels, every room label
# matched to its room centre, and outdoor features matched by eye (below). Heights are removed
# with K_HEIGHT so every control point is a ground pixel.
OUTDOOR_CTRL = [   # (map metres, campus-drawing ground pixel)
    ("Staff entrance road, east end", (44.4, -13.4), (618, 425)), ("Main road, start", (48.7, -14.5), (700, 375)),
    ("Inner road, start", (46.5, -10.0), (700, 415)), ("Staff entrance road, corner", (-0.5, -11.5), (216, 577)),
    ("Staff entrance road, south end", (-0.9, 12.3), (350, 779)), ("Staff parking 1", (15.2, -17.4), (341, 465)),
    ("Staff parking 2", (20.4, -6.4), (440, 540)), ("Staff parking 3", (64.3, -7.6), (850, 390)), ("Staff parking 4", (61.9, -17.3), (840, 310)),
    ("Main road, west of bend", (78.8, -12.8), (990, 290)), ("Main road, bend", (96.1, 0.9), (1180, 320)), ("Main road, east", (97.2, 9.1), (1260, 390)),
    ("Main road, south", (101.7, 40.1), (1560, 650)), ("Main road, corner", (102.7, 46.3), (1640, 740)),
    ("Inner road, bend", (58.6, 3.6), (850, 428)), ("Inner road, east", (75.4, 11.6), (1080, 480)), ("Inner road, south", (80.7, 39.0), (1180, 720)),
    ("Inner road, end", (73.0, 49.6), (1210, 800)), ("Parking lot, west", (62.4, 63.4), (1210, 840)),
    ("Parking lot, south (gate)", (89.3, 103.0), (1600, 960)), ("Staff parking 5", (82.8, 88.2), (1400, 920)),
    ("Walking path, north", (44.9, 5.6), (745, 505)), ("Walking path, middle", (46.1, 29.6), (840, 650)), ("Walking path, south", (35.5, 45.2), (900, 760)),
    ("Student entrance", (41.7, 49.6), (950, 800))]
SMOOTH = {"building": 300.0, "ground room": 300.0, "first-floor room": 4000.0, "outdoor": 150.0}   # roof labels are the least exact

def g2u(px): return tuple(np.array([px[0], px[1], 1.0]) @ T)
ctrl = [((cent[n].x, cent[n].y), (px[0], px[1] + H_LAB * K_HEIGHT), "building") for n, px in UPPER_CTRL.items()]
ctrl += [(tuple(by[n + "@0"]['centre']), (g2u(px)[0], g2u(px)[1] + 0.8 * K_HEIGHT), "ground room") for n, t, px in GROUND_ROOMS]
ctrl += [(tuple(by[n + "@1"]['centre']), (px[0], px[1] + 7.5 * K_HEIGHT), "first-floor room") for n, t, px in FIRST_ROOMS]
ctrl += [(w, u, "outdoor") for _, w, u in OUTDOOR_CTRL]
Cw = np.array([c[0] for c in ctrl], float); Cu = np.array([c[1] for c in ctrl], float)
def tps_u(r): return np.where(r > 0, r * r * np.log(np.maximum(r, 1e-12)), 0.0)
n_c = len(ctrl); A_t = np.zeros((n_c + 3, n_c + 3))
A_t[:n_c, :n_c] = tps_u(np.linalg.norm(Cw[:, None] - Cw[None], axis=2)) + np.diag([SMOOTH[c[2]] for c in ctrl])
A_t[:n_c, n_c:] = np.c_[np.ones(n_c), Cw]; A_t[n_c:, :n_c] = A_t[:n_c, n_c:].T
sol = np.linalg.solve(A_t, np.r_[Cu, np.zeros((3, 2))])
tps_w, tps_a = sol[:n_c], sol[n_c:]
def to_pixel(x, y): return tps_a[0] + tps_a[1] * x + tps_a[2] * y + tps_u(np.linalg.norm(Cw - [x, y], axis=1)) @ tps_w
warp_err = np.array([np.hypot(*(to_pixel(*w) - u)) for w, u in zip(Cw, Cu)])
px_per_m = float(np.sqrt(abs(np.linalg.det(tps_a[1:]))))
def publish(src, name):
    """Copy a drawing for the web as lossless WebP (same pixels, about 40% fewer bytes than the PNG)."""
    with Image.open(ROOT / "drawings" / src) as im:
        im = im.convert("RGB") if im.mode != "RGB" and im.getextrema()[-1] == (255, 255) else im
        im.save(ROOT / "web/renders" / (name + ".webp"), "WEBP", lossless=True, method=6)
        return "renders/" + name + ".webp", im.size
(ROOT / "web/renders").mkdir(exist_ok=True)
for old in (ROOT / "web/renders").glob("*.png"): old.unlink()              # superseded by the WebP copies
upper_src, upper_size = publish("Upper_floor_.png", "upper_floor")
ground_src, ground_size = publish("main_building_ground_floor_3d.png", "ground_floor")
RENDERS = {
    "about": "The two drawings are the map. Pixels of the campus drawing are the scene; map metres reach them through a thin-plate spline (to_pixel = affine + sum of weights * r^2 ln r). Heights rise height_px_per_m pixels per metre.",
    "scale_px_per_m": round(px_per_m, 4), "height_px_per_m": K_HEIGHT,
    "floor_height_m": {"0": 0.0, "1": 7.2},            # floor 1 overlays sit on the roof, where the drawing labels its rooms
    "warp": {"centres": [[round(v, 3) for v in c] for c in Cw], "weights": [[round(v, 7) for v in w] for w in tps_w],
             "affine": [[round(v, 7) for v in a] for a in tps_a]},
    "images": [
        {"id": "upper", "src": upper_src, "width": upper_size[0], "height": upper_size[1], "floor": 1, "clip": [40, 215, 2540, 1870],
         "matrix": [1, 0, 0, 1, 0, 0], "title": "Campus - 3D model view (floor 1 on top)"},
        {"id": "ground", "src": ground_src, "width": ground_size[0], "height": ground_size[1], "floor": 0, "clip": [0, 112, 1860, 1443],
         "matrix": [round(float(v), 6) for v in (T[0, 0], T[0, 1], T[1, 0], T[1, 1], T[2, 0], T[2, 1])],
         "title": "Main building - ground floor (cutaway)"}],
    "fit": {"median_m": round(float(np.median(warp_err)) / px_per_m, 1), "max_m": round(float(warp_err.max()) / px_per_m, 1), "control_points": n_c}}

result = {
    "format": "campus-interiors", "version": 1, "building": BUILDING, "floors": FLOORS, "renders": RENDERS,
    "rooms": rooms, "stairs": stairs, "confirmed_existing_stairs": {k: [[round(a, 1) for a in v[0]], [round(a, 1) for a in v[1]]] for k, v in CONFIRMED.items()},
    "not_connected": NOT_CONNECTED, "unassigned": {"0": [ring(q) for q in left0], "1": [ring(q) for q in left1]},
    "replaces_seed_links": True, "flags": flags0 + flags1, "missing": MISSING,
    "registration": {"campus_drawing_median_m": round(float(np.median(err_u)), 1), "campus_drawing_max_m": round(float(err_u.max()), 1),
                     "ground_drawing_max_px": round(float(err_g.max()), 1)}}
(ROOT / "web/interiors.json").write_text(json.dumps(result, indent=1))
(ROOT / "web/interiors.js").write_text("/* generated by pipeline/interiors.py */\n(typeof window!==\"undefined\"?window:global).CAMPUS_INTERIORS = " + json.dumps(result) + ";\n")
print(len(rooms0), "ground rooms,", len(rooms1), "first-floor rooms,", len(stairs), "new stairs")
print("unassigned pieces:", len(left0), len(left1)); print("flags:", *result['flags'], sep="\n  ")
print("renders: %d control points, median %.1f m, worst %.1f m" % (n_c, RENDERS["fit"]["median_m"], RENDERS["fit"]["max_m"]))
