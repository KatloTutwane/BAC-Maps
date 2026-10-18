/*!
 * Campus Navigator: navigation engine
 * Builds a walkable-area model from map_data.json and finds routes with A*.
 * No dependencies. Works in a browser (window.CampusNav) and in Node (require).
 *
 *   const nav = CampusNav.build(mapData, { links, blocked, walkable, places }, { openGround: true });
 *   nav.places                         destinations built from the map data
 *   nav.findRoute(from, to)            sync; from/to are { place: id } or { x, y, level }
 *   nav.findRouteAsync(from, to)       same, but time-sliced so the page never freezes
 *   nav.walkable(x, y, level)          collision test used by the player marker
 *   nav.move(x, y, level, dx, dy)      slide along walls instead of walking through them
 *
 * Coordinates are metres, x east, y south, the same as map_data.json.
 *
 * WHAT THE MODEL IS MADE OF
 *   Ground grid (0.5 m cells), level 0, outdoors:
 *     traced   roads, parking, yards, plazas and traced walkways. Cost x1.
 *     verified walks measured on site (paths with verified: true). Cost x0.8, so
 *              routes keep to the way people really walk when it is about as short.
 *     open     untraced ground inside the campus boundary. Cost x2.5, optional
 *              (options.openGround = false gives "traced surfaces only").
 *     blocked  every building footprint, the rock under the chilling area, and
 *              anything the administrator blocked.
 *   Graph (explicit nodes), indoors, on bridges and between floors:
 *     corridors, bridges, stairs, doors, administrator links.
 *   The two are joined at doors, which are derived from the map: wherever a
 *   traced path ends inside a building, or a ground floor corridor ends at a
 *   building wall, the crossing point of the wall becomes a door.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CampusNav = factory();
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var CELL = 0.5;            // grid resolution, metres
  var PAD = 4;               // grid margin around the mapped area
  var OPEN_MULT = 2.5;       // cost of walking on untraced ground (traced = 1)
  var VERIFIED_MULT = 0.8;   // cost on a verified walk; the cheapest surface, so A* scales its estimate by it
  var WALKWAY_W = 2.2;       // width for traced walkways that have none recorded
  var CORRIDOR_HALF = 1.4;   // corridor width 2.8 m, measured on site
  var STUB_HALF = 1.0;       // doorway and link width, half
  var CLEAR = 0.2;           // player radius used for collision and line of sight
  var SPEED = 1.4;           // walking speed, m/s
  var STAIR_LEN = 6.4;       // metres of walking per flight
  var STAIR_COST = 10.4;     // routing cost of one flight
  var STAIR_SEC = 12;        // extra seconds per flight
  var DOOR_SEARCH = 12;      // how far from a corridor end to look for a traced path
  var SNAP = 2.0;            // how close a link end must be to existing graph nodes
  var ROOM_WALL = 0.25;      // keep this far from room walls (walls are only crossed at doors)
  var DOOR_HALF = 0.45;      // doors are 0.9 m wide

  /* ---------------- geometry ---------------- */
  function pip(x, y, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var a = r[i], b = r[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
  }
  function segD2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    var t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    var cx = ax + t * dx - px, cy = ay + t * dy - py;
    return cx * cx + cy * cy;
  }
  function ringDist(x, y, r) {
    var m = Infinity;
    for (var i = 0; i < r.length; i++) { var a = r[i], b = r[(i + 1) % r.length]; m = Math.min(m, segD2(x, y, a[0], a[1], b[0], b[1])); }
    return Math.sqrt(m);
  }
  function inOrNear(x, y, r, tol) { return pip(x, y, r) || ringDist(x, y, r) <= tol; }
  function segT(a, b, c, d) {                           // t along a->b where it meets c->d, or null
    var rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    var t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
  }
  function crossings(a, b, ring) {
    var ts = [];
    for (var i = 0; i < ring.length; i++) { var t = segT(a, b, ring[i], ring[(i + 1) % ring.length]); if (t != null) ts.push(t); }
    return ts.sort(function (p, q) { return p - q; });
  }
  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function centroid(r) { var x = 0, y = 0; r.forEach(function (p) { x += p[0]; y += p[1]; }); return [x / r.length, y / r.length]; }
  function area2(r) { var a = 0; for (var i = 0; i < r.length; i++) { var p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function ribbon(pts, w) {
    var l = [], r = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      var dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      l.push([p[0] - dy * w / 2, p[1] + dx * w / 2]); r.push([p[0] + dy * w / 2, p[1] - dx * w / 2]);
    }
    return l.concat(r.reverse());
  }
  function hull(pts) {
    var p = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    function half(src) { var s = []; src.forEach(function (q) { while (s.length >= 2 && cr(s[s.length - 2], s[s.length - 1], q) <= 0) s.pop(); s.push(q); }); s.pop(); return s; }
    return half(p).concat(half(p.slice().reverse()));
  }
  function grow(r, m) {
    var c = centroid(r);
    return r.map(function (p) { var d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1; return [p[0] + (p[0] - c[0]) / d * m, p[1] + (p[1] - c[1]) / d * m]; });
  }
  function densify(pts, step) {
    var out = [pts[0]];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(dist(a, b) / step));
      for (var k = 1; k <= n; k++) out.push(lerp(a, b, k / n));
    }
    return out;
  }
  function compass(dx, dy) {                            // y points south on the map
    var names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
    var a = Math.atan2(dx, -dy) * 180 / Math.PI; if (a < 0) a += 360;
    return names[Math.round(a / 45) % 8];
  }

  /* ---------------- priority queue ---------------- */
  function Heap() { this.f = []; this.id = []; }
  Heap.prototype.push = function (f, id) {
    var F = this.f, I = this.id, i = F.length; F.push(f); I.push(id);
    while (i > 0) { var p = (i - 1) >> 1; if (F[p] <= f) break; F[i] = F[p]; I[i] = I[p]; i = p; }
    F[i] = f; I[i] = id;
  };
  Heap.prototype.pop = function () {
    var F = this.f, I = this.id, top = I[0], lf = F.pop(), li = I.pop(), n = F.length;
    if (n) {
      var i = 0;
      for (;;) {
        var c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= lf) break;
        F[i] = F[c]; I[i] = I[c]; i = c;
      }
      F[i] = lf; I[i] = li;
    }
    return top;
  };
  Heap.prototype.size = function () { return this.f.length; };

  /* Static rasters, cached per map data and mode, so editing navigation data or switching
     modes again does not re-rasterise the whole campus. */
  var BASE_CACHE = [];

  /* ================================================================== */
  function build(data, overrides, options) {
    var t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    overrides = overrides || {}; options = options || {};
    var openGround = options.openGround !== false;
    var CLR = options.clearance != null ? options.clearance : CLEAR;      // configurable clearance from walls
    var IN = options.interiors || null, floorNames = {};
    ((IN && IN.floors) || [{ level: 0, name: "Ground floor" }, { level: 1, name: "First floor" }]).forEach(function (f) { floorNames[f.level] = f.name; });
    function floorName(l) { return floorNames[l] || "floor " + l; }
    var warnings = [];
    var fh = options.storeyHeight || 3.2;

    var buildings = data.buildings.map(function (b, i) { return { i: i, name: b.name, ring: b.points_m, floors: b.floors, area: Math.abs(area2(b.points_m)) }; });
    var elevated = (data.elevated || []).map(function (e) { return { name: e.name, ring: e.points_m, level: e.level || 1, area: e.area_m2 }; });

    /* ---- grid extent ---- */
    var all = [];
    function take(list) { list.forEach(function (p) { all.push(p); }); }
    buildings.forEach(function (b) { take(b.ring); });
    (data.roads || []).forEach(function (r) { take(r.points_m); });
    (data.areas || []).forEach(function (a) { take(a.points_m); });
    (data.paths || []).forEach(function (p) { take(p.points_m); });
    elevated.forEach(function (e) { take(e.ring); });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    all.forEach(function (p) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); });
    var ox = minX - PAD, oy = minY - PAD;
    var W = Math.ceil((maxX - minX + 2 * PAD) / CELL), H = Math.ceil((maxY - minY + 2 * PAD) / CELL), N = W * H;
    var campus = grow(hull(all), 3);                        // the boundary nobody may leave

    var cls = new Uint8Array(N);                            // 0 blocked, 1 traced, 2 open ground, 3 verified walk
    function traced(c) { return c === 1 || c === 3; }
    var owner = new Uint16Array(N);                         // which traced feature painted the cell
    var bld = new Int16Array(N).fill(-1);                   // which building covers the cell
    var featNames = [""];

    function cellX(i) { return ox + (i + 0.5) * CELL; }
    function cellY(j) { return oy + (j + 0.5) * CELL; }
    function cellAt(x, y) {
      var i = Math.floor((x - ox) / CELL), j = Math.floor((y - oy) / CELL);
      return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
    }
    function fill(ring, cb) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      ring.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      var i0 = Math.max(0, Math.floor((x0 - ox) / CELL)), i1 = Math.min(W - 1, Math.floor((x1 - ox) / CELL));
      var j0 = Math.max(0, Math.floor((y0 - oy) / CELL)), j1 = Math.min(H - 1, Math.floor((y1 - oy) / CELL));
      for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) if (pip(cellX(i), cellY(j), ring)) cb(j * W + i);
    }
    function paint(ring, name, c) {
      var id = featNames.indexOf(name); if (id < 0) { id = featNames.length; featNames.push(name); }
      fill(ring, function (k) { cls[k] = c; owner[k] = id; });
    }

    function edgeCells(ring, cb) {                          // every cell a wall passes through, not just cells whose centre is inside
      for (var i = 0; i < ring.length; i++) {
        var a = ring[i], b = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(dist(a, b) / (CELL / 4)));
        for (var k = 0; k <= n; k++) { var c = cellAt(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); if (c >= 0) cb(c); }
      }
    }
    function blockSolids() {
      buildings.forEach(function (b) { function m(k) { cls[k] = 0; bld[k] = b.i; } fill(b.ring, m); edgeCells(b.ring, m); });
      elevated.forEach(function (e) { function m(k) { cls[k] = 0; } fill(e.ring, m); edgeCells(e.ring, m); });
    }
    var base = null;
    for (var bi = 0; bi < BASE_CACHE.length; bi++) { var bc = BASE_CACHE[bi]; if (bc.data === data && bc.open === openGround && bc.N === N) base = bc; }
    var cacheHit = !!base;
    if (base) { cls.set(base.cls); owner.set(base.owner); bld.set(base.bld); featNames = base.featNames.slice(); }
    else {
      if (openGround) fill(campus, function (k) { cls[k] = 2; });
      (data.roads || []).forEach(function (r) { paint(r.points_m, r.name, 1); });
      (data.areas || []).forEach(function (a) { paint(a.points_m, a.name, 1); });
      (data.paths || []).forEach(function (p) {
        if (p.indoor || p.bridge || (p.level || 0) !== 0 || p.verified) return;
        paint(ribbon(p.points_m, p.width_m || WALKWAY_W), p.name, 1);
      });
      (data.paths || []).forEach(function (p) {                // last, so a verified walk wins over the car park it crosses
        if (p.verified && !p.indoor && !p.bridge && !(p.level || 0)) paint(ribbon(p.points_m, p.width_m || WALKWAY_W), p.name, 3);
      });
      blockSolids();
      base = { data: data, open: openGround, N: N, cls: cls.slice(), owner: owner.slice(), bld: bld.slice(), featNames: featNames.slice(), dT: null };
      BASE_CACHE.push(base); if (BASE_CACHE.length > 4) BASE_CACHE.shift();
    }
    var walkEdits = (overrides.walkable || []).filter(function (w) { return w.points && w.points.length >= 3; });
    var blockEdits = (overrides.blocked || []).filter(function (w) { return w.points && w.points.length >= 3; });
    walkEdits.forEach(function (w) { paint(w.points, w.name || "Added walkable area", 1); });
    if (walkEdits.length) blockSolids();                 // an added walkway never opens up a building
    blockEdits.forEach(function (w) { function m(k) { cls[k] = 0; } fill(w.points, m); edgeCells(w.points, m); });
    var gridEdited = walkEdits.length + blockEdits.length > 0;

    buildings.forEach(function (b) {
      b.box = [Infinity, Infinity, -Infinity, -Infinity];
      b.ring.forEach(function (p) { b.box[0] = Math.min(b.box[0], p[0]); b.box[1] = Math.min(b.box[1], p[1]); b.box[2] = Math.max(b.box[2], p[0]); b.box[3] = Math.max(b.box[3], p[1]); });
    });
    function buildingAt(x, y) {
      for (var i = 0; i < buildings.length; i++) { var b = buildings[i], q = b.box; if (x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3] && pip(x, y, b.ring)) return b; }
      return null;
    }

    /* nearest cell of a class around a point (class 0 means "any walkable") */
    function nearestCell(x, y, maxR, only) {
      var c0 = cellAt(x, y), R = Math.ceil(maxR / CELL), ci = Math.floor((x - ox) / CELL), cj = Math.floor((y - oy) / CELL), best = -1, bd = Infinity;
      for (var dj = -R; dj <= R; dj++) for (var di = -R; di <= R; di++) {
        var i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
        var k = j * W + i, c = cls[k]; if (!c || (only && (only === 1 ? !traced(c) : c !== only))) continue;
        var d = Math.hypot(cellX(i) - x, cellY(j) - y); if (d < bd && d <= maxR) { bd = d; best = k; }
      }
      return best;
    }

    /* ---- explicit graph ---- */
    var ex = { x: [], y: [], level: [], kind: [], name: [], bld: [], adj: [] };
    var ways = [];                                          // walkable strips, for collision
    var plates = [];                                        // walkable raised areas
    var gridLinks = {};                                     // cell -> [{to, cost, len}]
    var doors = [], stairsList = [];
    var EB = 4, exBucket = {};                              // spatial index: 4 m buckets of graph nodes
    function addNode(x, y, level, kind, name, b) {
      ex.x.push(x); ex.y.push(y); ex.level.push(level); ex.kind.push(kind); ex.name.push(name || ""); ex.bld.push(b || ""); ex.adj.push([]);
      var key = Math.floor(x / EB) + "," + Math.floor(y / EB); (exBucket[key] = exBucket[key] || []).push(ex.x.length - 1);
      return N + ex.x.length - 1;
    }
    function px(u) { return u < N ? cellX(u % W) : ex.x[u - N]; }
    function py(u) { return u < N ? cellY((u / W) | 0) : ex.y[u - N]; }
    function lv(u) { return u < N ? 0 : ex.level[u - N]; }
    function addEdge(a, b, cost, len, type) {
      var l = len != null ? len : Math.hypot(px(a) - px(b), py(a) - py(b));
      var c = cost != null ? cost : l;
      if (a >= N) ex.adj[a - N].push({ to: b, cost: c, len: l, type: type || "walk" }); else (gridLinks[a] = gridLinks[a] || []).push({ to: b, cost: c, len: l, type: type || "walk" });
      if (b >= N) ex.adj[b - N].push({ to: a, cost: c, len: l, type: type || "walk" }); else (gridLinks[b] = gridLinks[b] || []).push({ to: a, cost: c, len: l, type: type || "walk" });
    }
    function addWay(a, b, half, level) { ways.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], half: half, level: level }); }

    function chain(pts, level, kind, name, half, b) {
      var d = densify(pts, 1.0), ids = [];
      d.forEach(function (p) { ids.push(addNode(p[0], p[1], level, kind, name, b)); });
      for (var i = 1; i < ids.length; i++) { addEdge(ids[i - 1], ids[i]); addWay(d[i - 1], d[i], half, level); }
      return ids;
    }
    function nearestExplicit(x, y, level, maxR, kinds) {
      var best = -1, bd = maxR, R = Math.ceil(maxR / EB), bx = Math.floor(x / EB), by = Math.floor(y / EB);
      for (var di = -R; di <= R; di++) for (var dj = -R; dj <= R; dj++) {
        var list = exBucket[(bx + di) + "," + (by + dj)]; if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var k = list[i]; if (ex.level[k] !== level) continue; if (kinds && kinds.indexOf(ex.kind[k]) < 0) continue;
          var d = Math.hypot(ex.x[k] - x, ex.y[k] - y); if (d < bd || (d === bd && N + k < best)) { bd = d; best = N + k; }
        }
      }
      return best;
    }

    // indoor corridors and bridges
    var corridors = [], bridges = [];
    (data.paths || []).forEach(function (p) {
      if (p.indoor) corridors.push({ p: p, ids: chain(p.points_m, p.level || 0, "corridor", p.name, CORRIDOR_HALF, p.building || "") });
      else if (p.bridge || (p.level || 0) > 0) bridges.push({ p: p, ids: chain(p.points_m, p.level || 1, "bridge", p.name, Math.max(STUB_HALF, (p.width_m || 2.2) / 2), "") });
    });

    // raised areas (the chilling area): a node in the middle, joined to the bridges that land on it
    elevated.forEach(function (e) {
      plates.push({ ring: e.ring, level: e.level, name: e.name });
      var c = centroid(e.ring); if (!pip(c[0], c[1], e.ring)) c = e.ring[0];
      var id = addNode(c[0], c[1], e.level, "area", e.name, "");
      e.node = id; var linked = 0;
      bridges.forEach(function (br) {
        var end = br.ids.filter(function (k) { return inOrNear(ex.x[k - N], ex.y[k - N], e.ring, 0.5); });
        if (!end.length) return;
        var k = end[end.length - 1], from = [ex.x[k - N], ex.y[k - N]];
        addEdge(k, id); addWay(from, c, STUB_HALF, e.level); linked++;
      });
      if (!linked) warnings.push("No bridge reaches " + e.name);
    });

    // stairs
    (data.nodes || []).forEach(function (s) {
      var made = [];
      (s.connects || []).forEach(function (L) {
        var near = nearestExplicit(s.at[0], s.at[1], L, SNAP, ["corridor"]);
        var id = addNode(s.at[0], s.at[1], L, "stairs", s.name, "");
        if (near >= 0) { addEdge(id, near); } else warnings.push(s.name + " is not on a level " + L + " corridor");
        made.push({ level: L, id: id });
      });
      made.sort(function (a, b) { return a.level - b.level; });
      for (var i = 1; i < made.length; i++) addEdge(made[i - 1].id, made[i].id, STAIR_COST, STAIR_LEN, "stairs");
      made.forEach(function (m) { m.x = s.at[0]; m.y = s.at[1]; });
      stairsList.push({ name: s.name, at: s.at, nodes: made, estimated: !!s.estimated });
    });

    // stub check: does a straight connection stay inside the building?
    function stubInside(a, b, ring) {
      var n = Math.max(2, Math.ceil(dist(a, b) / 0.4));
      for (var k = 0; k <= n; k++) { var p = lerp(a, b, k / n); if (!inOrNear(p[0], p[1], ring, 0.5)) return false; }
      return true;
    }
    function lastExit(a, b, ring) {                         // where the line from inside a leaves the ring for good
      var ts = crossings(a, b, ring); if (!ts.length) return null;
      for (var i = ts.length - 1; i >= 0; i--) {
        var t = ts[i], after = lerp(a, b, Math.min(1, t + 0.02));
        if (!pip(after[0], after[1], ring)) return lerp(a, b, t);
      }
      return null;
    }
    function doorNear(x, y) { for (var i = 0; i < doors.length; i++) if (Math.hypot(doors[i].x - x, doors[i].y - y) < 1.5) return doors[i]; return null; }
    function nearestTracedCell(x, y, maxR) {
      var best = -1, bd = Infinity, ci = Math.floor((x - ox) / CELL), cj = Math.floor((y - oy) / CELL), R = Math.ceil(maxR / CELL);
      for (var dj = -R; dj <= R; dj++) for (var di = -R; di <= R; di++) {
        var i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= W || j >= H) continue;
        var k = j * W + i; if (!traced(cls[k])) continue;
        var d = Math.hypot(cellX(i) - x, cellY(j) - y); if (d < bd) { bd = d; best = k; }
      }
      return bd <= maxR ? best : -1;
    }

    // doors, rule 1: a ground floor corridor that ends inside a building meets the nearest traced walkway at the wall
    corridors.forEach(function (c) {
      if ((c.p.level || 0) !== 0) return;
      [0, c.ids.length - 1].forEach(function (ix) {
        var e = [ex.x[c.ids[ix] - N], ex.y[c.ids[ix] - N]], B = buildingAt(e[0], e[1]); if (!B) return;
        var tc = nearestTracedCell(e[0], e[1], DOOR_SEARCH);
        if (tc < 0) { warnings.push("No traced walkway within " + DOOR_SEARCH + " m of the end of " + c.p.name + " (" + e[0].toFixed(1) + ", " + e[1].toFixed(1) + ")"); return; }
        var C = [cellX(tc % W), cellY((tc / W) | 0)], D = lastExit(e, C, B.ring);
        if (!D || doorNear(D[0], D[1])) return;
        if (!stubInside(e, D, B.ring)) { warnings.push("Door near (" + D[0].toFixed(1) + ", " + D[1].toFixed(1) + ") skipped: the link would cross a wall"); return; }
        var via = featNames[owner[tc]], id = addNode(D[0], D[1], 0, "door", B.name + " · entrance by " + via, B.name);
        addEdge(c.ids[ix], id); addWay(e, D, STUB_HALF, 0);
        addEdge(id, tc); addWay(D, C, STUB_HALF, 0);
        doors.push({ node: id, x: D[0], y: D[1], building: B.name, name: ex.name[id - N], via: via });
      });
    });
    // doors, rule 2: a traced outdoor path that runs into a building ends at a door in the wall
    (data.paths || []).forEach(function (p) {
      if (p.indoor || p.bridge || (p.level || 0) !== 0) return;
      [p.points_m, p.points_m.slice().reverse()].forEach(function (pts) {
        var B = buildingAt(pts[0][0], pts[0][1]); if (!B) return;
        var D = null, acc = 0;
        for (var i = 1; i < pts.length && !D; i++) { var t = crossings(pts[i - 1], pts[i], B.ring); if (t.length) D = lerp(pts[i - 1], pts[i], t[0]); }
        if (!D || doorNear(D[0], D[1])) return;
        var oc = nearestCell(D[0], D[1], 1.5, 1); if (oc < 0) oc = nearestCell(D[0], D[1], 1.5, 0);
        var tn = -1, bd = DOOR_SEARCH;
        corridors.forEach(function (c) {
          if ((c.p.level || 0) !== 0 || c.p.building !== B.name) return;
          c.ids.forEach(function (k) { var d = Math.hypot(ex.x[k - N] - D[0], ex.y[k - N] - D[1]); if (d < bd) { bd = d; tn = k; } });
        });
        if (oc < 0 || tn < 0) { warnings.push("Door of " + p.name + " could not be linked"); return; }
        var T = [ex.x[tn - N], ex.y[tn - N]];
        if (!stubInside(D, T, B.ring)) { warnings.push("Entrance of " + p.name + " skipped: its link to the corridor would cross a wall. Add a link in the editor."); return; }
        var id = addNode(D[0], D[1], 0, "door", B.name + " · entrance (" + p.name + ")", B.name);
        addEdge(id, oc); addWay(D, [cellX(oc % W), cellY((oc / W) | 0)], STUB_HALF, 0);
        addEdge(id, tn); addWay(D, T, STUB_HALF, 0);
        doors.push({ node: id, x: D[0], y: D[1], building: B.name, name: ex.name[id - N], via: p.name });
      });
    });

    // links: the seed (assumptions) and anything the administrator added
    var allLinks = (IN && IN.replaces_seed_links ? [] : options.seedLinks || []).concat(overrides.links || []);
    function attach(p, level) {
      var near = nearestExplicit(p.x, p.y, level, SNAP);
      if (near >= 0) return near;
      if (level === 0) { var c = nearestCell(p.x, p.y, 3, 0); if (c >= 0) return c; }
      return -1;
    }
    allLinks.forEach(function (lk) {
      var pts = lk.points || []; if (pts.length < 2) return;
      var ids = [];
      pts.forEach(function (p, i) {
        var lvl = p.level || 0, end = i === 0 || i === pts.length - 1, id = end ? attach(p, lvl) : -1;
        if (id < 0) id = addNode(p.x, p.y, lvl, "link", lk.name || "link", "");
        ids.push({ id: id, level: lvl, x: p.x, y: p.y });
      });
      if (ids[0].id < 0 || ids[ids.length - 1].id < 0) { warnings.push("Link '" + (lk.name || "unnamed") + "' does not touch the network at both ends"); return; }
      for (var i = 1; i < ids.length; i++) {
        var a = ids[i - 1], b = ids[i];
        if (a.id === b.id) continue;
        if (a.level !== b.level) addEdge(a.id, b.id, STAIR_COST, STAIR_LEN, "stairs");
        else { addEdge(a.id, b.id); addWay([px(a.id), py(a.id)], [px(b.id), py(b.id)], STUB_HALF, a.level); }
      }
    });

    /* ---- building interiors: rooms with walls, one door each, and stairs between floors ---- */
    var rooms = [];
    function inRoom(p, ring) { return pip(p[0], p[1], ring) && ringDist(p[0], p[1], ring) >= ROOM_WALL; }
    function clearInside(a, b, ring) { var n = Math.max(2, Math.ceil(dist(a, b) / 0.25)); for (var k = 0; k <= n; k++) if (!inRoom(lerp(a, b, k / n), ring)) return false; return true; }
    function toward(a, b, d) { var L = dist(a, b) || 1; return [a[0] + (b[0] - a[0]) / L * d, a[1] + (b[1] - a[1]) / L * d]; }
    if (IN) {
      (IN.rooms || []).forEach(function (r) {
        var R = { id: r.id, name: r.name, level: r.level, type: r.type, ring: r.points, area: r.area_m2, approx: !!r.approx, doors: 0, box: null };
        R.node = addNode(r.centre[0], r.centre[1], r.level, "room", r.name, IN.building);
        plates.push({ ring: r.points, level: r.level, name: r.name, wall: ROOM_WALL, room: r.id });
        function opening(at, outside, label, target, half) {          // centre -> just inside -> door -> beyond the wall
          var inner = toward(at, r.centre, 0.7);             // one step into the room, towards its middle
          if (!inRoom(inner, r.points)) {
            var bi = null, bdd = Infinity;
            for (var ix = -1.5; ix <= 1.5; ix += 0.1) for (var iy = -1.5; iy <= 1.5; iy += 0.1) {
              var cq = [at[0] + ix, at[1] + iy]; if (!inRoom(cq, r.points) || ringDist(cq[0], cq[1], r.points) < 0.35) continue;
              var dd = dist(cq, at); if (dd < bdd) { bdd = dd; bi = cq; }
            }
            if (bi) inner = bi; else warnings.push(r.name + ": its door opens straight onto a wall corner");
          }
          var inN = addNode(inner[0], inner[1], r.level, "walk", r.name, IN.building), dn = addNode(at[0], at[1], r.level, "door", label, IN.building);
          if (clearInside(r.centre, inner, r.points)) addEdge(R.node, inN);
          else {                                              // L-shaped room: go via a bend point that sees both
            var bend = null, best = Infinity;
            for (var gx = -12; gx <= 12; gx += 0.5) for (var gy = -12; gy <= 12; gy += 0.5) {
              var q = [inner[0] + gx, inner[1] + gy];
              if (!inRoom(q, r.points) || !clearInside(r.centre, q, r.points) || !clearInside(q, inner, r.points)) continue;
              var c = dist(r.centre, q) + dist(q, inner); if (c < best) { best = c; bend = q; }
            }
            if (bend) { var bn = addNode(bend[0], bend[1], r.level, "walk", r.name, IN.building); addEdge(R.node, bn); addEdge(bn, inN); }
            else { addEdge(R.node, inN); warnings.push(r.name + ": no clear way from its middle to its door"); }
          }
          addEdge(inN, dn); addEdge(dn, target);
          addWay(inner, at, half, r.level); addWay(at, [px(target), py(target)], half, r.level);   // the doorway, through the wall
          R.doors++;
        }
        if (r.door) {
          var cn = nearestExplicit(r.door_to[0], r.door_to[1], r.level, 1.5, ["corridor"]);
          if (cn < 0) warnings.push(r.name + ": its door is not next to a corridor");
          else opening(r.door, r.door_to, r.name + " door", cn, DOOR_HALF);
        }
        (r.exits || []).forEach(function (e) {
          var tl = e.to.level || 0, tgt = nearestExplicit(e.to.x, e.to.y, tl, SNAP);
          if (tgt < 0 && tl === 0) tgt = nearestCell(e.to.x, e.to.y, 3, 0);
          if (tgt < 0) { warnings.push(r.name + ": " + e.name + " leads nowhere on the map"); return; }
          opening(e.at, [e.to.x, e.to.y], r.name + " · " + e.name, tgt, DOOR_HALF + 0.15);
        });
        rooms.push(R);
      });
      (IN.stairs || []).forEach(function (s) {
        var made = [];
        s.ends.forEach(function (e) {
          var id = addNode(e.x, e.y, e.level, "stairs", s.name, ""), tgt = -1;
          if (e.room) { var R = rooms.filter(function (q) { return q.id === e.room; })[0]; if (R) tgt = R.node; }
          if (tgt < 0 && e.level === 0 && !buildingAt(e.x, e.y)) tgt = nearestCell(e.x, e.y, 3, 0);     // outside stairs start on the ground
          if (tgt < 0) tgt = nearestExplicit(e.x, e.y, e.level, 6, ["corridor"]);
          if (tgt < 0) { warnings.push(s.name + " does not reach the " + floorName(e.level) + " network"); return; }
          addEdge(id, tgt); addWay([e.x, e.y], [px(tgt), py(tgt)], 1.0, e.level);
          made.push({ level: e.level, id: id, x: e.x, y: e.y });
        });
        made.sort(function (a, b) { return a.level - b.level; });
        for (var i = 1; i < made.length; i++) addEdge(made[i - 1].id, made[i].id, STAIR_COST, STAIR_LEN, "stairs");
        if (made.length) stairsList.push({ name: s.name, at: [made[0].x, made[0].y], nodes: made, external: !!s.external, estimated: !!s.approx });
      });
    }
    plates.forEach(function (pl) {
      pl.box = [Infinity, Infinity, -Infinity, -Infinity];
      pl.ring.forEach(function (q) { pl.box[0] = Math.min(pl.box[0], q[0]); pl.box[1] = Math.min(pl.box[1], q[1]); pl.box[2] = Math.max(pl.box[2], q[0]); pl.box[3] = Math.max(pl.box[3], q[1]); });
    });

    /* ---- way index for collision ---- */
    var WG = 4, wayGrid = {};
    ways.forEach(function (w, k) {
      var x0 = Math.min(w.ax, w.bx) - w.half, x1 = Math.max(w.ax, w.bx) + w.half, y0 = Math.min(w.ay, w.by) - w.half, y1 = Math.max(w.ay, w.by) + w.half;
      for (var gx = Math.floor(x0 / WG); gx <= Math.floor(x1 / WG); gx++) for (var gy = Math.floor(y0 / WG); gy <= Math.floor(y1 / WG); gy++) {
        var key = gx + "," + gy; (wayGrid[key] = wayGrid[key] || []).push(k);
      }
    });
    function onWay(x, y, level) {
      var list = wayGrid[Math.floor(x / WG) + "," + Math.floor(y / WG)]; if (!list) return false;
      for (var i = 0; i < list.length; i++) {
        var w = ways[list[i]]; if (w.level !== level) continue;
        if (segD2(x, y, w.ax, w.ay, w.bx, w.by) <= w.half * w.half) return true;
      }
      return false;
    }
    function gridOK(x, y, r) {                              // the player's disc must sit on walkable cells
      r = r || CLR; var d = r * 0.7071, pts = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [d, d], [d, -d], [-d, d], [-d, -d]];
      for (var i = 0; i < 9; i++) { var k = cellAt(x + pts[i][0], y + pts[i][1]); if (k < 0 || !cls[k]) return false; }
      return true;
    }
    function solidAt(x, y) {                                // exact footprint test, finer than the 0.5 m grid
      if (buildingAt(x, y)) return true;
      for (var i = 0; i < elevated.length; i++) if (pip(x, y, elevated[i].ring)) return true;
      return false;
    }
    function walkable(x, y, level) {
      level = level || 0;
      if (onWay(x, y, level)) return true;
      if (level === 0 && gridOK(x, y) && !solidAt(x, y)) return true;
      for (var i = 0; i < plates.length; i++) {
        var pl = plates[i], b = pl.box;
        if (pl.level !== level || x < b[0] || x > b[2] || y < b[1] || y > b[3] || !pip(x, y, pl.ring)) continue;
        if (!pl.wall || ringDist(x, y, pl.ring) >= pl.wall) return true;               // rooms: not on or through their walls
      }
      return false;
    }
    function move(x, y, level, dx, dy) {
      if (walkable(x + dx, y + dy, level)) return { x: x + dx, y: y + dy, moved: true };
      if (dx && walkable(x + dx, y, level)) return { x: x + dx, y: y, moved: true };
      if (dy && walkable(x, y + dy, level)) return { x: x, y: y + dy, moved: true };
      return { x: x, y: y, moved: false };
    }

    /* ---- distance to the nearest traced cell (for placing doors on buildings that have none) ---- */
    var dT = !gridEdited && base.dT ? base.dT : new Float32Array(N).fill(1e9);
    if (dT !== base.dT) for (var q = 0; q < N; q++) if (traced(cls[q])) dT[q] = 0;
    if (dT !== base.dT) (function () {
      var D1 = CELL, D2 = CELL * Math.SQRT2, i, j, k, v;
      for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
        k = j * W + i; v = dT[k];
        if (i > 0 && dT[k - 1] + D1 < v) v = dT[k - 1] + D1;
        if (j > 0) { if (dT[k - W] + D1 < v) v = dT[k - W] + D1; if (i > 0 && dT[k - W - 1] + D2 < v) v = dT[k - W - 1] + D2; if (i < W - 1 && dT[k - W + 1] + D2 < v) v = dT[k - W + 1] + D2; }
        dT[k] = v;
      }
      for (j = H - 1; j >= 0; j--) for (i = W - 1; i >= 0; i--) {
        k = j * W + i; v = dT[k];
        if (i < W - 1 && dT[k + 1] + D1 < v) v = dT[k + 1] + D1;
        if (j < H - 1) { if (dT[k + W] + D1 < v) v = dT[k + W] + D1; if (i < W - 1 && dT[k + W + 1] + D2 < v) v = dT[k + W + 1] + D2; if (i > 0 && dT[k + W - 1] + D2 < v) v = dT[k + W - 1] + D2; }
        dT[k] = v;
      }
    })();
    if (!gridEdited) base.dT = dT;
    function autoDoor(B) {
      var ring = B.ring, ccw = area2(ring) > 0, best = null;
      for (var e = 0; e < ring.length; e++) {
        var a = ring[e], b = ring[(e + 1) % ring.length], L = dist(a, b); if (L < 1) continue;
        var nx = (ccw ? (b[1] - a[1]) : -(b[1] - a[1])) / L, ny = (ccw ? -(b[0] - a[0]) : (b[0] - a[0])) / L;
        var n = Math.max(1, Math.floor(L / 1.0));
        for (var s = 0; s < n; s++) {
          var sp = lerp(a, b, (s + 0.5) / n), c = cellAt(sp[0] + nx * 0.75, sp[1] + ny * 0.75);
          if (c < 0 || !cls[c]) continue;
          var d = dT[c]; if (!best || d < best.d) best = { d: d, cell: c, x: sp[0], y: sp[1] };
        }
      }
      return best;
    }

    /* ---- places (destinations) ---- */
    var places = [], byId = {};
    function addPlace(p) { p.id = p.id || (p.kind + ":" + p.name); byId[p.id] = p; places.push(p); return p; }
    buildings.forEach(function (B) {
      var mine = doors.filter(function (d) { return d.building === B.name; });
      var c = centroid(B.ring), pl = { name: B.name, kind: "building", level: 0, x: c[0], y: c[1], featureName: B.name, info: B.floors + (B.floors > 1 ? " storeys" : " storey") + ", " + Math.round(B.area) + " m²", anchors: [] };
      if (mine.length) mine.forEach(function (d) { pl.anchors.push({ node: d.node, x: d.x, y: d.y, entry: null }); });
      else {
        var ad = autoDoor(B);
        if (ad) { pl.anchors.push({ node: ad.cell, x: cellX(ad.cell % W), y: cellY((ad.cell / W) | 0), entry: null }); pl.autoDoor = [ad.x, ad.y]; }
      }
      addPlace(pl);
    });
    doors.forEach(function (d) {
      addPlace({ name: d.name, kind: "entrance", level: 0, x: d.x, y: d.y, featureName: d.building, info: "door, joins " + d.via, anchors: [{ node: d.node, x: d.x, y: d.y }] });
    });
    (data.areas || []).forEach(function (a) {
      var c = centroid(a.points_m), k = -1, bd = Infinity;
      fill(a.points_m, function (cell) { if (!cls[cell]) return; var d = Math.hypot(cellX(cell % W) - c[0], cellY((cell / W) | 0) - c[1]); if (d < bd) { bd = d; k = cell; } });
      var kind = (a.kind || "area").replace("_", " ");
      addPlace({ name: a.name, kind: "area", level: 0, x: c[0], y: c[1], featureName: a.name, info: kind + ", " + a.area_m2 + " m²", anchors: k >= 0 ? [{ node: k, x: cellX(k % W), y: cellY((k / W) | 0) }] : [] });
    });
    elevated.forEach(function (e) {
      addPlace({ name: e.name, kind: "raised", level: e.level, x: ex.x[e.node - N], y: ex.y[e.node - N], featureName: e.name, info: "raised area, reached from floor " + e.level, anchors: [{ node: e.node, x: ex.x[e.node - N], y: ex.y[e.node - N] }] });
    });
    stairsList.forEach(function (s) {
      addPlace({ name: s.name, kind: "stairs", level: 0, x: s.at[0], y: s.at[1], featureName: null, info: (s.external ? "outside stairs · " : "") + "joins the " + s.nodes.map(function (n) { return floorName(n.level); }).join(" and the ") + (s.estimated ? " · position estimated" : ""), anchors: [{ node: s.nodes[0].id, x: s.at[0], y: s.at[1] }] });
    });
    // administrator places (rooms, gates, anything with a name)
    (overrides.places || []).forEach(function (p, i) {
      var lvl = p.level || 0, id = attach({ x: p.x, y: p.y }, lvl), anchors = [];
      if (id < 0 && lvl >= 1) id = nearestExplicit(p.x, p.y, lvl, 6);
      if (id >= 0) anchors.push({ node: id, x: px(id), y: py(id) }); else warnings.push("Place '" + p.name + "' is not near any walkable area");
      addPlace({ id: "custom:" + (p.id || i), name: p.name, kind: "custom", level: lvl, x: p.x, y: p.y, featureName: null, info: p.note || "added place", anchors: anchors, custom: true });
    });
    var TYPE_LABEL = { lab: "lab", office: "office", toilet: "toilets", room: "room", service: "service room", lecture: "lecture room", cafeteria: "cafeteria", unspecified: "use not specified" };
    rooms.forEach(function (R) {
      addPlace({ id: "room:" + R.id, name: R.name, kind: "room", subtype: R.type, level: R.level, x: px(R.node), y: py(R.node), featureName: R.name, floorName: floorName(R.level),
        info: floorName(R.level) + " · " + (TYPE_LABEL[R.type] || R.type) + " · about " + R.area + " m²" + (R.approx ? " · layout approximate" : ""),
        anchors: R.doors ? [{ node: R.node, x: px(R.node), y: py(R.node) }] : [], why: R.doors ? null : R.name + " has no door on the map yet, so no route can reach it yet." });
    });
    // administrator corrections: where a destination is really entered. The point snaps to the
    // nearest walkable ground or graph node, so it can never sit inside a wall or a building.
    (overrides.access || []).forEach(function (o) {
      var p = byId[o.place]; if (!p) { warnings.push("Access point for an unknown destination (" + o.place + ")"); return; }
      var lvl = o.level != null ? o.level : (p.level || 0), id = attach({ x: o.x, y: o.y }, lvl);
      if (id < 0 && lvl >= 1) id = nearestExplicit(o.x, o.y, lvl, 6);
      if (id < 0) { warnings.push("The access point set for " + p.name + " is not on walkable ground, so it was ignored"); return; }
      p.anchors = [{ node: id, x: px(id), y: py(id), entry: null }]; p.accessEdited = true; p.why = null;
    });
    places.forEach(function (p) { p.reachable = p.anchors.length > 0; if (p.floorName == null) p.floorName = floorName(p.level || 0); });

    /* ---- locating arbitrary points ---- */
    function locate(x, y, level) {
      level = level || 0; var out = [];
      if (level === 0) {
        var c = nearestCell(x, y, 3, 0);
        if (c >= 0) out.push({ node: c, g0: Math.hypot(cellX(c % W) - x, cellY((c / W) | 0) - y), x: cellX(c % W), y: cellY((c / W) | 0) });
      }
      var e = nearestExplicit(x, y, level, level === 0 ? 2.5 : 8);
      if (e >= 0) out.push({ node: e, g0: Math.hypot(px(e) - x, py(e) - y), x: px(e), y: py(e) });
      return out;
    }
    function resolve(spec) {
      if (spec && spec.place) {
        var p = byId[spec.place]; if (!p) return { error: "Unknown place" };
        if (!p.anchors.length) return { error: p.why || p.name + " has no accessible entrance on the map" };
        return { name: p.name, place: p, starts: p.anchors.map(function (a) { return { node: a.node, g0: 0 }; }), level: p.level, x: p.x, y: p.y, entries: p.anchors.map(function (a) { return a.entry; }) };
      }
      var l = locate(spec.x, spec.y, spec.level || 0);
      if (!l.length) return { error: "That point is not on a walkable surface" };
      return { name: spec.name || "Selected point", starts: l, level: spec.level || 0, x: spec.x, y: spec.y, entries: [] };
    }

    /* ---- A* ---- */
    var NT = N + ex.x.length;
    /* Each search gets its own working arrays from a pool, so searches that overlap in time
       (a new destination picked while the last route is still being found) cannot corrupt each other. */
    var PEN_MULT = 2.2, pool = [], poolMade = 0;                // nodes of earlier routes cost more, to find real alternatives
    function acquire() {
      if (pool.length) return pool.pop();
      poolMade++;
      return { G: new Float64Array(NT), PAR: new Int32Array(NT), STAMP: new Uint32Array(NT), CLOSED: new Uint32Array(NT), PEN: new Uint32Array(NT), stamp: 0 };
    }
    function release(A) { if (A && pool.length < 4) pool.push(A); }
    var dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    function mult(c) { return c === 1 ? 1 : c === 3 ? VERIFIED_MULT : OPEN_MULT; }

    function Search(starts, goals, penNodes) {
      this.goals = {}; this.gl = []; var self = this;
      var A = this.A = acquire(); this.stamp = ++A.stamp; this.pen = 0;
      if (penNodes) {                                       // mark earlier routes (and 1.5 m around them) as costlier
        this.pen = this.stamp;
        penNodes.forEach(function (u) {
          A.PEN[u] = self.pen;
          if (u < N) { var i = u % W, j = (u / W) | 0; for (var dj = -3; dj <= 3; dj++) for (var di = -3; di <= 3; di++) { var a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < W && b < H) A.PEN[b * W + a] = self.pen; } }
        });
      }
      goals.forEach(function (g) { self.goals[g.node] = true; self.gl.push([px(g.node), py(g.node)]); });
      this.open = new Heap(); this.expanded = 0; this.done = false; this.found = false; this.end = -1;
      starts.forEach(function (s) {
        var u = s.node; if (A.STAMP[u] === self.stamp && A.G[u] <= s.g0) return;
        A.STAMP[u] = self.stamp; A.G[u] = s.g0; A.PAR[u] = -1; self.open.push(s.g0 + self.h(u), u);
      });
      if (!this.open.size()) this.done = true;
    }
    Search.prototype.h = function (u) {
      var x = px(u), y = py(u), m = Infinity;
      for (var i = 0; i < this.gl.length; i++) { var d = Math.hypot(this.gl[i][0] - x, this.gl[i][1] - y); if (d < m) m = d; }
      return m * VERIFIED_MULT;                             // the cheapest surface costs this per metre, so the estimate never overestimates
    };
    Search.prototype.relax = function (u, v, c) {
      var A = this.A, ng = A.G[u] + (this.pen && A.PEN[v] === this.pen ? c * PEN_MULT : c);
      if (A.STAMP[v] !== this.stamp) { A.STAMP[v] = this.stamp; A.G[v] = Infinity; }
      if (ng < A.G[v]) { A.G[v] = ng; A.PAR[v] = u; this.open.push(ng + this.h(v), v); }
    };
    Search.prototype.step = function (maxN) {
      var open = this.open, stamp = this.stamp, n = 0;
      while (open.size() && n < maxN) {
        var u = open.pop();
        if (this.A.CLOSED[u] === stamp) continue;
        this.A.CLOSED[u] = stamp; this.expanded++; n++;
        if (this.goals[u]) { this.done = true; this.found = true; this.end = u; return true; }
        if (u < N) {
          var i = u % W, j = (u / W) | 0, cu = mult(cls[u]);
          for (var d = 0; d < 8; d++) {
            var di = dirs[d][0], dj = dirs[d][1], ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
            var v = nj * W + ni, cv = cls[v]; if (!cv) continue;
            if (di && dj && (!cls[j * W + ni] || !cls[nj * W + i])) continue;       // no cutting corners
            this.relax(u, v, dirs[d][2] * CELL * (cu + mult(cv)) / 2);
          }
          var gl = gridLinks[u]; if (gl) for (var g = 0; g < gl.length; g++) this.relax(u, gl[g].to, gl[g].cost);
        } else {
          var adj = ex.adj[u - N]; for (var a = 0; a < adj.length; a++) this.relax(u, adj[a].to, adj[a].cost);
        }
      }
      if (!open.size()) this.done = true;
      return this.done;
    };
    Search.prototype.path = function () {
      if (this.pathCache) return this.pathCache;
      var p = [], u = this.end, PAR = this.A.PAR, guard = NT; while (u >= 0 && guard-- > 0) { p.push(u); u = PAR[u]; }
      return (this.pathCache = p.reverse());
    };
    Search.prototype.free = function () {                  // keep the path, give the arrays back
      if (this.found) this.path();
      release(this.A); this.A = null;
    };

    /* ---- turn the node path into a route that follows the surface ---- */
    function losClear(a, b, budget) {
      var L = dist(a, b), n = Math.max(1, Math.ceil(L / 0.1)), cost = 0;      // finer than the collision test, and a little wider
      for (var k = 0; k <= n; k++) {
        var p = lerp(a, b, k / n); if (!gridOK(p[0], p[1], CLR + 0.07) || solidAt(p[0], p[1])) return false;
        if (k) cost += (L / n) * mult(cls[cellAt(p[0], p[1])] || 2);
        if (cost > budget) return false;
      }
      return true;
    }
    function smoothRun(ids) {                                // string pulling that never makes a route costlier
      var pts = ids.map(function (u) { return [px(u), py(u)]; }), pc = [0];
      for (var i = 1; i < ids.length; i++) pc.push(pc[i - 1] + dist(pts[i - 1], pts[i]) * (mult(cls[ids[i - 1]]) + mult(cls[ids[i]])) / 2);
      var out = [pts[0]], a = 0;
      while (a < pts.length - 1) {
        var far = a + 1;
        for (var j = a + 2; j < pts.length; j++) { if (losClear(pts[a], pts[j], (pc[j] - pc[a]) * 1.001)) far = j; else if (j - far > 6) break; }
        out.push(pts[far]); a = far;
      }
      return out;
    }
    function edgeBetween(u, v) {
      var list = u >= N ? ex.adj[u - N] : gridLinks[u] || [];
      for (var i = 0; i < list.length; i++) if (list[i].to === v) return list[i];
      return null;
    }
    function assemble(nodeIds, from, to, raw) {
      var pts = [], i = 0, n = nodeIds.length;
      function push(x, y, level, kind, name, tag) {
        var last = pts[pts.length - 1];
        if (last && last.level === level && Math.hypot(last.x - x, last.y - y) < 0.05) { if (kind && kind !== "walk") { last.kind = kind; last.name = name; last.tag = tag || last.tag; } return; }
        pts.push({ x: x, y: y, level: level, kind: kind || "walk", name: name || "", tag: tag || null });
      }
      var e0 = from.entries && from.entries[from.starts.findIndex(function (s) { return s.node === nodeIds[0]; })];
      if (e0) push(e0[0], e0[1], 0, "walk");
      while (i < n) {
        var u = nodeIds[i];
        if (u < N) {
          var j = i; while (j + 1 < n && nodeIds[j + 1] < N) j++;
          (raw ? nodeIds.slice(i, j + 1).map(function (u) { return [px(u), py(u)]; }) : smoothRun(nodeIds.slice(i, j + 1))).forEach(function (p) { push(p[0], p[1], 0, "walk"); });
          i = j + 1;
        } else {
          var k = u - N, kind = ex.kind[k], tag = null;
          if (i > 0) { var pe = edgeBetween(nodeIds[i - 1], u); if (pe && pe.type === "stairs") tag = "stairs"; }
          push(ex.x[k], ex.y[k], ex.level[k], kind === "door" || kind === "stairs" ? kind : "walk", ex.name[k], kind === "stairs" ? "stairs" : null);
          i++;
        }
      }
      var e1 = to.entries && to.entries[to.starts.findIndex(function (s) { return s.node === nodeIds[n - 1]; })];
      if (e1) push(e1[0], e1[1], 0, "walk");
      return pts;
    }
    function measure(pts) {
      var cum = [0], stairs = 0;
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i], d = a.level !== b.level ? STAIR_LEN : Math.hypot(b.x - a.x, b.y - a.y);
        if (a.level !== b.level) stairs++;
        cum.push(cum[i - 1] + d);
      }
      return { cum: cum, length: cum[cum.length - 1], stairs: stairs };
    }
    function directions(pts, cum, destName) {
      var steps = [], lastAt = 0, lastIdx = 0;
      function add(text, idx) { steps.push({ text: text, index: idx, at: cum[idx], dist: cum[idx] - lastAt }); lastAt = cum[idx]; }
      var firstDir = null;
      for (var i = 1; i < pts.length; i++) if (pts[i].level === pts[0].level && Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y) > 1) { firstDir = [pts[i].x - pts[0].x, pts[i].y - pts[0].y]; break; }
      var headText = firstDir ? "Head " + compass(firstDir[0], firstDir[1]) : "Start";
      var pending = headText;
      for (var k = 1; k < pts.length - 1; k++) {
        var a = pts[k - 1], b = pts[k], c = pts[k + 1];
        if (b.kind === "stairs" && b.level !== c.level) { add(pending + " to the stairs", k); pending = "Take " + b.name.replace(/^Stair well/i, "the stairs") + (c.level > b.level ? " up" : " down") + " to the " + floorName(c.level); add(pending, k + 1); pending = "Continue"; lastIdx = k + 1; k++; continue; }
        if (b.kind === "door") { add(pending + " to " + b.name, k); pending = "Go through the door and continue"; continue; }
        if (a.level === b.level && b.level === c.level) {
          var v1 = [b.x - a.x, b.y - a.y], v2 = [c.x - b.x, c.y - b.y], l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
          if (l1 < 0.3 || l2 < 0.3) continue;
          var ang = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]) * 180 / Math.PI;
          if (Math.abs(ang) >= 35 && cum[k] - lastAt > 3) { add(pending, k); pending = (ang > 0 ? "Turn right" : "Turn left") + (Math.abs(ang) > 100 ? " sharply" : ""); }
        }
      }
      add(pending, pts.length - 1);
      steps.push({ text: "Arrive at " + destName + (pts[pts.length - 1].level ? " (" + floorName(pts[pts.length - 1].level) + ")" : ""), index: pts.length - 1, at: cum[cum.length - 1], dist: 0, final: true });
      steps.forEach(function (st) { st.level = pts[Math.min(st.index, pts.length - 1)].level; if (/^Take /.test(st.text) && st.index > 0) st.level = pts[st.index - 1].level; });   // you take the stairs on the floor you start from
      return steps;
    }
    function openShare(pts) {                               // how much of the route crosses untraced ground
      var open = 0, all = 0;
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i]; if (a.level !== b.level || a.level !== 0) continue;
        var L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / 1));
        for (var k = 0; k < n; k++) { var c = cellAt(a.x + (b.x - a.x) * (k + .5) / n, a.y + (b.y - a.y) * (k + .5) / n); all += L / n; if (c >= 0 && cls[c] === 2) open += L / n; }
      }
      return all ? open / all : 0;
    }
    function describe(pts, from, to, search) {
      var m = measure(pts), time = m.length / SPEED + m.stairs * STAIR_SEC;
      // stair hops are counted at STAIR_LEN but already contribute that to length, so only time needs the extra
      return { found: true, points: pts, cum: m.cum, length: m.length, time: time, stairs: m.stairs, openShare: openShare(pts), from: from.name, to: to.name, steps: directions(pts, m.cum, to.name), expanded: search.expanded };
    }
    function prepare(fromSpec, toSpec) {
      var f = resolve(fromSpec), t = resolve(toSpec);
      if (f.error) return { error: f.error };
      if (t.error) return { error: t.error };
      var goals = t.starts.map(function (s) { return { node: s.node }; });
      return { f: f, t: t, goals: goals };
    }
    /* Every route is checked before it is shown: each stretch is sampled every 25 cm and must stay
       on walkable ground (never through a wall), and every change of floor must be a stairs edge. */
    function invalidAt(pts) {
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i];
        if (a.level !== b.level) { if (b.kind !== "stairs" && a.kind !== "stairs") return { x: a.x, y: a.y, level: a.level, why: "floor change without stairs" }; continue; }
        var L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / 0.25));
        for (var k = 0; k <= n; k++) { var x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n; if (!walkable(x, y, a.level)) return { x: x, y: y, level: a.level, why: "off the walkable area" }; }
      }
      return null;
    }
    function finish(p, s) {
      if (!s.found) return { found: false, reason: "No walkable connection exists between these two places" + (openGround ? "." : " using traced surfaces only."), expanded: s.expanded };
      var nodes = s.path(), r = describe(assemble(nodes, p.f, p.t), p.f, p.t, s), bad = invalidAt(r.points);
      if (bad) {                                             // never show a route through a wall: fall back to the unsmoothed path
        var r2 = describe(assemble(nodes, p.f, p.t, true), p.f, p.t, s), bad2 = invalidAt(r2.points);
        if (bad2) return { found: false, reason: "The only route found fails the wall check near (" + bad2.x.toFixed(1) + ", " + bad2.y.toFixed(1) + ") on the " + floorName(bad2.level) + ". The navigation data needs fixing there.", invalid: bad2 };
        r = r2; r.validation = "unsmoothed";
      }
      r.validated = true; r.nodes = nodes.length;
      r.floors = []; r.points.forEach(function (q) { if (r.floors.indexOf(q.level) < 0) r.floors.push(q.level); });
      r.transitions = [];
      for (var i = 1; i < r.points.length; i++) if (r.points[i].level !== r.points[i - 1].level) r.transitions.push({ index: i - 1, name: r.points[i - 1].name, from: r.points[i - 1].level, to: r.points[i].level, x: r.points[i].x, y: r.points[i].y });
      return r;
    }
    /* Routes between named places are cached: the map is static, so the answer cannot change
       until the navigation data is rebuilt (which makes a new nav object and a fresh cache). */
    var cache = new Map(), CACHE_MAX = 60, cacheHits = 0;
    function cacheKey(f, t, n) { return f && t && f.place && t.place ? f.place + "|" + t.place + "|" + (n || 0) : null; }
    function remember(k, v) { if (!k) return v; cache.set(k, v); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); return v; }
    function recall(k) { if (!k || !cache.has(k)) return null; var v = cache.get(k); cache.delete(k); cache.set(k, v); cacheHits++; return v; }
    function clock() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

    function findRoute(fromSpec, toSpec) {
      var key = cacheKey(fromSpec, toSpec, 0), hit = recall(key); if (hit) return hit;
      var t0 = clock(), p = prepare(fromSpec, toSpec); if (p.error) return { found: false, reason: p.error };
      var s = new Search(p.f.starts, p.goals); s.step(1e9); s.free(); var r = finish(p, s); r.ms = clock() - t0;
      return r.found ? remember(key, r) : r;
    }
    function runAsync(s, o) {                               // 8 ms slices, so the page never freezes
      return new Promise(function (res) {
        (function tick() {
          if (o && o.cancelled && o.cancelled()) { s.cancelled = true; s.free(); return res(s); }   // a newer request replaced this one
          var t = Date.now(); while (!s.done && Date.now() - t < 8) s.step(1500);
          if (s.done) { s.free(); res(s); } else setTimeout(tick, 0);
        })();
      });
    }
    function findRouteAsync(fromSpec, toSpec) {
      return findRoutesAsync(fromSpec, toSpec, { alternatives: 0 }).then(function (o) { return o.found ? o.routes[0] : { found: false, reason: o.reason }; });
    }
    function overlap(a, b) {                                // share of route a lying within 2.5 m of route b
      if (a.points.length < 2) return 1;                    // a route that never leaves its start is no alternative
      var n = 0, near = 0;
      for (var d = 0; d <= a.length; d += 2) {
        var p = pointOn(a, d); n++;
        for (var i = 1; i < b.points.length; i++) {
          var u = b.points[i - 1], v = b.points[i]; if (u.level !== v.level || u.level !== p.level) continue;
          if (segD2(p.x, p.y, u.x, u.y, v.x, v.y) < 6.25) { near++; break; }
        }
      }
      return n ? near / n : 1;
    }
    function pointOn(r, d) {
      var i = 1; while (i < r.cum.length - 1 && r.cum[i] < d) i++;
      var a = r.points[i - 1], b = r.points[i], t = Math.max(0, Math.min(1, (d - r.cum[i - 1]) / ((r.cum[i] - r.cum[i - 1]) || 1)));
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, level: t < 0.5 ? a.level : b.level };
    }
    /* Best route plus up to n genuinely different alternatives (penalty method). */
    function findRoutesAsync(fromSpec, toSpec, o) {
      var n = o && o.alternatives != null ? o.alternatives : 1, key = cacheKey(fromSpec, toSpec, n), hit = recall(key);
      if (hit) return Promise.resolve(hit);
      var t0 = clock(), p = prepare(fromSpec, toSpec);
      if (p.error) return Promise.resolve({ found: false, reason: p.error, routes: [] });
      var CANCELLED = { found: false, cancelled: true, reason: "Cancelled", routes: [] };
      return runAsync(new Search(p.f.starts, p.goals), o).then(function (s) {
        if (s.cancelled) return CANCELLED;
        var best = finish(p, s); best.ms = clock() - t0;
        if (!best.found) return { found: false, reason: best.reason, routes: [] };
        best.label = "Best route"; var out = { found: true, routes: [best] }, used = s.path();
        function more(k) {
          if (k >= n) return Promise.resolve();
          return runAsync(new Search(p.f.starts, p.goals, used), o).then(function (sx) {
            if (sx.cancelled || !sx.found) return;
            var alt = finish(p, sx);
            if (alt.length <= best.length * 1.6 && out.routes.every(function (r) { return overlap(alt, r) < 0.65; })) { alt.label = "Alternative"; out.routes.push(alt); }
            used = used.concat(sx.path()); return more(k + 1);
          });
        }
        return more(0).then(function () { if (o && o.cancelled && o.cancelled()) return CANCELLED; out.ms = clock() - t0; return remember(key, out); });
      });
    }

    /* ---- helpers for the app ---- */
    function nearestStair(x, y, level, r) {
      var best = null, bd = r;
      stairsList.forEach(function (s) {
        s.nodes.forEach(function (n) { if (n.level !== level) return; var d = Math.hypot(n.x - x, n.y - y); if (d <= bd) { bd = d; best = s; } });
      });
      if (!best) return null;
      var levels = best.nodes.map(function (n) { return n.level; }).sort(), pos = {};
      best.nodes.forEach(function (n) { pos[n.level] = { x: n.x, y: n.y }; });
      return { name: best.name, at: best.at, levels: levels, pos: pos, up: levels.filter(function (l) { return l > level; })[0], down: levels.filter(function (l) { return l < level; }).pop() };
    }
    function search(q) {
      q = (q || "").trim().toLowerCase(); if (!q) return places.slice();
      return places.filter(function (p) { return p.name.toLowerCase().indexOf(q) >= 0 || p.kind.indexOf(q) >= 0; });
    }
    /* ---- connectivity: which destinations and graph nodes can reach each other ----
       Flood-fills the same moves the router may make (grid steps, doors, corridors, stairs,
       links). The component holding the most destinations is the network; anything outside
       it is reported, so a missing door or a link that snapped to nothing is found before a
       visitor asks for a route that cannot exist. */
    function connectivity() {
      var comp = new Int32Array(NT).fill(-1), q = new Int32Array(NT), comps = [];
      function flood(s, id) {
        var h = 0, t = 0; q[t++] = s; comp[s] = id;
        function add(v) { if (comp[v] < 0) { comp[v] = id; q[t++] = v; } }
        while (h < t) {
          var u = q[h++];
          if (u < N) {
            var i = u % W, j = (u / W) | 0;
            for (var d = 0; d < 8; d++) {
              var ni = i + dirs[d][0], nj = j + dirs[d][1]; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
              var v = nj * W + ni; if (!cls[v]) continue;
              if (dirs[d][0] && dirs[d][1] && (!cls[j * W + ni] || !cls[nj * W + i])) continue;
              add(v);
            }
            var gl = gridLinks[u]; if (gl) for (var g = 0; g < gl.length; g++) add(gl[g].to);
          } else { var adj = ex.adj[u - N]; for (var a = 0; a < adj.length; a++) add(adj[a].to); }
        }
        return t;
      }
      function seed(s) { if (s >= 0 && comp[s] < 0) comps.push({ id: comps.length, size: flood(s, comps.length), places: 0 }); }
      places.forEach(function (p) { p.anchors.forEach(function (a) { seed(a.node); }); });
      for (var k = 0; k < ex.x.length; k++) seed(N + k);
      places.forEach(function (p) { var seen = {}; p.anchors.forEach(function (a) { var c = comp[a.node]; if (!seen[c]) { seen[c] = 1; comps[c].places++; } }); });
      var main = comps.reduce(function (m, c) { return !m || c.places > m.places ? c : m; }, null);
      function inMain(u) { return main && comp[u] === main.id; }
      var out = { components: comps.length, networkPlaces: main ? main.places : 0, disconnected: [], noEntrance: [], stranded: [] };
      places.forEach(function (p) {
        if (!p.anchors.length) out.noEntrance.push({ id: p.id, name: p.name, kind: p.kind, level: p.level || 0, why: p.why || p.name + " has no entrance on the map" });
        else if (!p.anchors.some(function (a) { return inMain(a.node); })) out.disconnected.push({ id: p.id, name: p.name, kind: p.kind, level: p.level || 0, x: p.x, y: p.y });
      });
      var doorless = {}; rooms.forEach(function (R) { if (!R.doors) doorless[R.node] = true; });   // already listed under noEntrance
      for (var e = 0; e < ex.x.length; e++) if (!inMain(N + e) && !doorless[N + e]) out.stranded.push({ kind: ex.kind[e], name: ex.name[e], level: ex.level[e], x: ex.x[e], y: ex.y[e] });
      return out;
    }
    var t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

    return {
      connectivity: connectivity,
      places: places, place: function (id) { return byId[id] || null; }, search: search,
      doors: doors, stairs: stairsList, warnings: warnings, openGround: openGround, rooms: rooms, plates: plates, floorName: floorName,
      floors: Object.keys(floorNames).map(Number).sort().map(function (l) { return { level: l, name: floorNames[l] }; }), validate: invalidAt,
      findRoute: findRoute, findRouteAsync: findRouteAsync, findRoutesAsync: findRoutesAsync, locate: locate, resolve: resolve,
      cacheStats: function () { return { size: cache.size, hits: cacheHits, searchBuffers: poolMade }; },
      walkable: walkable, move: move, nearestStair: nearestStair, buildingAt: buildingAt,
      ways: ways, campus: campus,
      grid: { w: W, h: H, cell: CELL, ox: ox, oy: oy, cls: cls },
      stats: { cells: N, nodes: ex.x.length, buildMs: Math.round(t1 - t0), ways: ways.length, baseCached: cacheHit },
      constants: { SPEED: SPEED, STAIR_SEC: STAIR_SEC }
    };
  }

  return { build: build, version: "1.0.0", constants: { CELL: CELL, SPEED: SPEED } };
});
