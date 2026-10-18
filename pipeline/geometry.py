"""
The three pieces of real geometry in the pipeline:

  indoor_centreline  a corridor line through the middle of a building
  road_from_edges    one road surface from two traced kerb lines
  pitched_roof       roof planes generated from a footprint

All inputs and outputs are in metres (see geo.py).
"""
import heapq
import math

import numpy as np
import shapely
from contourpy import contour_generator
from scipy.ndimage import distance_transform_edt
from shapely.geometry import LineString, Polygon


# ----------------------------------------------------------------------
# Indoor corridor centreline
# ----------------------------------------------------------------------
def _rdp(points, eps):
    """Ramer Douglas Peucker: drop points that sit within eps of a straight line."""
    if len(points) < 3:
        return points
    (ax, ay), (bx, by) = points[0], points[-1]
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy)
    dists = [abs(dx * (py - ay) - dy * (px - ax)) / L if L else 0 for px, py in points]
    i = max(range(len(dists)), key=dists.__getitem__)
    if dists[i] > eps:
        return _rdp(points[: i + 1], eps)[:-1] + _rdp(points[i:], eps)
    return [points[0], points[-1]]


def indoor_centreline(footprint, start_xy, end_xy, res=0.4):
    """Least cost route from start to end that stays inside the footprint and
    prefers its middle.

    How: rasterise the footprint, measure every cell's distance to the nearest
    wall (a distance transform), then run Dijkstra where stepping into a cell
    is cheap if it is far from walls and expensive if close. The cheapest
    route naturally follows the centre of the building.
    """
    ring = np.array(footprint)
    x0, y0 = ring[:, 0].min() - 2, ring[:, 1].min() - 2
    x1, y1 = ring[:, 0].max() + 2, ring[:, 1].max() + 2
    W, H = int((x1 - x0) / res), int((y1 - y0) / res)
    gx, gy = np.meshgrid(np.arange(W) * res + x0, np.arange(H) * res + y0)
    inside = shapely.contains_xy(Polygon(footprint), gx, gy)
    clear = distance_transform_edt(inside) * res          # metres to nearest wall

    def snap(p, min_clear=1.2, radius=40):
        """Nearest cell to p that is inside and not hugging a wall."""
        r0, c0 = int((p[1] - y0) / res), int((p[0] - x0) / res)
        best, bd = None, float("inf")
        for r in range(max(0, r0 - radius), min(H, r0 + radius)):
            for c in range(max(0, c0 - radius), min(W, c0 + radius)):
                if clear[r, c] >= min_clear:
                    d = (r - r0) ** 2 + (c - c0) ** 2
                    if d < bd:
                        bd, best = d, (r, c)
        return best

    start, goal = snap(start_xy), snap(end_xy)
    maxc = clear.max()
    cost = np.where(inside, 1.0 + 9.0 * ((maxc - clear) / maxc) ** 3, np.inf)

    dist = np.full((H, W), np.inf)
    prev = {}
    dist[start] = 0.0
    pq = [(0.0, start)]
    steps = [(-1, 0, 1), (1, 0, 1), (0, -1, 1), (0, 1, 1),
             (-1, -1, 1.414), (-1, 1, 1.414), (1, -1, 1.414), (1, 1, 1.414)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == goal:
            break
        if d > dist[u]:
            continue
        for dr, dc, w in steps:
            v = (u[0] + dr, u[1] + dc)
            if 0 <= v[0] < H and 0 <= v[1] < W and inside[v]:
                nd = d + w * res * cost[v]
                if nd < dist[v]:
                    dist[v], prev[v] = nd, u
                    heapq.heappush(pq, (nd, v))

    cells = [goal]
    while cells[-1] in prev:
        cells.append(prev[cells[-1]])
    cells.reverse()
    world = [[round(c * res + x0, 2), round(r * res + y0, 2)] for r, c in cells]
    pts = _rdp(world, 0.9)
    length = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    tightest = min(clear[int((p[1] - y0) / res), int((p[0] - x0) / res)] for p in pts)
    return pts, round(length, 1), round(float(tightest), 2)


def point_along(points, fraction):
    """The point a given fraction of the way along a polyline."""
    cum = [0.0]
    for i in range(len(points) - 1):
        cum.append(cum[-1] + math.dist(points[i], points[i + 1]))
    target = fraction * cum[-1]
    for i in range(len(cum) - 1):
        if cum[i] <= target <= cum[i + 1]:
            t = (target - cum[i]) / ((cum[i + 1] - cum[i]) or 1)
            return [round(points[i][0] + (points[i + 1][0] - points[i][0]) * t, 2),
                    round(points[i][1] + (points[i + 1][1] - points[i][1]) * t, 2)]
    return points[-1]


# ----------------------------------------------------------------------
# Roads from two traced kerb lines
# ----------------------------------------------------------------------
def road_from_edges(edge_a, edge_b, samples=60, min_w=1.5, max_w=12.0):
    """One surface from two traced edges, following the real local width.

    Walk the longer edge. At each step, the width is the distance across to
    the other edge. Where the other edge stops early (the two traces rarely
    end at the same place), the last real width is carried forward instead of
    closing the gap diagonally, which used to leave a wedge.
    """
    A, B = LineString(edge_a), LineString(edge_b)
    long_, short_ = (A, B) if A.length >= B.length else (B, A)
    pts = [long_.interpolate(i / samples, normalized=True) for i in range(samples + 1)]

    def normal(i):
        a, b = (pts[i], pts[i + 1]) if i < samples else (pts[i - 1], pts[i])
        tx, ty = b.x - a.x, b.y - a.y
        L = math.hypot(tx, ty) or 1
        return -ty / L, tx / L

    # local width, plus whether the other edge is actually opposite here
    raw, side_votes = [], 0
    for i, pa in enumerate(pts):
        pb = short_.interpolate(short_.project(pa))
        nx, ny = normal(i)
        across = (pb.x - pa.x) * nx + (pb.y - pa.y) * ny      # signed distance along the normal
        d = pa.distance(pb)
        opposite = d > 0 and abs(across) / d > 0.7            # roughly perpendicular, not off the end
        if opposite and min_w <= d <= max_w:
            raw.append(d)
            side_votes += 1 if across > 0 else -1
        else:
            raw.append(None)
    side = 1 if side_votes >= 0 else -1

    known = [w for w in raw if w is not None] or [4.0]
    # fill gaps from the nearest real measurement on either side
    filled = raw[:]
    for i in range(len(filled)):
        if filled[i] is None:
            left = next((filled[j] for j in range(i - 1, -1, -1) if raw[j] is not None), None)
            right = next((raw[j] for j in range(i + 1, len(raw)) if raw[j] is not None), None)
            filled[i] = left if left is not None else (right if right is not None else known[0])
    # light smoothing so a wobbly trace doesn't make a wobbly road
    width = [sum(filled[max(0, i - 4): i + 5]) / len(filled[max(0, i - 4): i + 5]) for i in range(len(filled))]

    kerb, far, centre = [], [], []
    for i, pa in enumerate(pts):
        nx, ny = normal(i)
        w = width[i]
        kerb.append([pa.x, pa.y])
        far.append([pa.x + side * nx * w, pa.y + side * ny * w])
        centre.append([pa.x + side * nx * w / 2, pa.y + side * ny * w / 2])
    surface = Polygon(kerb + far[::-1]).buffer(0)
    surface = max(getattr(surface, "geoms", [surface]), key=lambda g: g.area).simplify(0.15)
    C = LineString(centre).simplify(0.3)

    ws = sorted(known)
    return {
        "points_m": [[round(x, 2), round(y, 2)] for x, y in list(surface.exterior.coords)[:-1]],
        "centre_m": [[round(x, 2), round(y, 2)] for x, y in C.coords],
        "width_m": round(ws[len(ws) // 2], 1),
        "width_range_m": [round(ws[0], 1), round(ws[-1], 1)],
        "length_m": round(C.length, 1),
    }


# ----------------------------------------------------------------------
# Pitched roofs
# ----------------------------------------------------------------------
def _seg_dist(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy or 1e-9
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _regions(mask, X, Y, res):
    """Outline every connected region of a boolean grid as polygons."""
    m = np.pad(mask.astype(float), 1)
    xs = np.concatenate([[X[0, 0] - res], X[0], [X[0, -1] + res]])
    ys = np.concatenate([[Y[0, 0] - res], Y[:, 0], [Y[-1, 0] + res]])
    out = []
    for line in contour_generator(xs, ys, m).lines(0.5):
        if len(line) < 4:
            continue
        p = Polygon(line).buffer(0).simplify(0.18)
        for g in getattr(p, "geoms", [p]):
            if g.area > 0.25:
                out.append(list(g.exterior.coords)[:-1])
    return out


def pitched_roof(footprint, slope, max_run, res=0.25):
    """Roof height at any point = slope x distance to the nearest wall, capped
    at a ridge. Grouping every point by its nearest wall gives one roof plane
    per wall. Because it is a single continuous height field, planes cannot
    cross or leave gaps, even on concave buildings.

    Returns {"rise": metres, "facets": [{"edge": i, "pts": [[x,y,z],..]}],
             "caps": [[[x,y],..], ..]}   where z is height above the eaves.
    """
    P = Polygon(footprint).buffer(0)
    x0, y0, x1, y1 = P.bounds
    X, Y = np.meshgrid(np.arange(x0, x1 + res, res), np.arange(y0, y1 + res, res))
    inside = shapely.contains_xy(P, X, Y)
    n = len(footprint)
    D = np.stack([_seg_dist(X, Y, footprint[i], footprint[(i + 1) % n]) for i in range(n)])
    nearest, dmin = D.argmin(0), D.min(0)
    run = min(max_run, float(dmin[inside].max()) * 0.92)

    facets = []
    for i in range(n):
        a, b = footprint[i], footprint[(i + 1) % n]
        for poly in _regions(inside & (nearest == i) & (dmin <= run), X, Y, res):
            pts = [[round(x, 2), round(y, 2),
                    round(min(float(_seg_dist(np.array(x), np.array(y), a, b)), run) * slope, 2)]
                   for x, y in poly]
            facets.append({"edge": i, "pts": pts})
    caps = [[[round(x, 2), round(y, 2)] for x, y in c]
            for c in _regions(inside & (dmin > run), X, Y, res)]
    return {"rise": round(run * slope, 2), "facets": facets, "caps": caps}
