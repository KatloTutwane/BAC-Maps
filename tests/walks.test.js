/* Run: node tests/walks.test.js
   Verified walks (data/raw/walks/) and the connectivity check: routes follow the way people
   really walk, stay off walls and buildings, and every destination is joined to the network. */
const CampusNav = require("../web/nav-engine.js");
const data = require("../web/map_data.json");
const interiors = require("../web/interiors.json");
const seed = require("../web/nav_seed.js");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  ok   " + msg); } else { fail++; console.log("  FAIL " + msg); } }

const opts = { seedLinks: seed.links, interiors };
const nav = CampusNav.build(data, {}, opts);
const walks = data.paths.filter(p => p.verified);

function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]); }
function lineDist(p, line) { let m = Infinity; for (let i = 1; i < line.length; i++) m = Math.min(m, segDist(p, line[i - 1], line[i])); return m; }
function sample(points, step) {
  const out = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]; if (a.level !== b.level) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n, level: a.level });
  }
  return out;
}
function offSurface(r) { return sample(r.points, 0.25).filter(p => !nav.walkable(p.x, p.y, p.level)).length; }
function share(r, line) { const s = sample(r.points, 1); return s.filter(p => lineDist([p.x, p.y], line) <= 2).length / s.length; }
function nearAnyWalk(pts) { return pts.map(p => Math.min(...walks.map(v => lineDist([p.x, p.y], v.points_m)))); }
function wallCrossings(w) {                                     // where a walk goes into or out of a building, and how far that is from a door
  const out = []; let prev = null;
  for (const p of sample(w.points_m.map(q => ({ x: q[0], y: q[1], level: 0 })), 0.25)) {
    const b = nav.buildingAt(p.x, p.y), name = b ? b.name : null;
    if (name !== prev) {
      const bn = name || prev, doors = nav.doors.filter(d => d.building === bn);
      out.push({ x: p.x, y: p.y, building: bn, into: !!name, door: doors.length ? Math.min(...doors.map(d => Math.hypot(d.x - p.x, d.y - p.y))) : Infinity });
      prev = name;
    }
  }
  return out;
}

console.log("\nwalk files");
const fromPaths = walks.filter(w => w.source === "paths.kmz");
ok(fromPaths.length === 9, `paths.kmz gives 9 walks: 15 lines, less 5 that trace the fence and 1 repeat of the measured walk (${fromPaths.length})`);
ok(walks.filter(w => Math.abs(w.length_m - 187.2) < 0.5).length === 1, "the repeated Main Gate to Hostels line is kept once, as the measured walk");
ok(!data.paths.some(p => /^paths \([2-6]\)$/.test(p.name)), "the fence lines are not walks");
const fence = data.boundary && data.boundary.points_m;
ok(fence && fence.length >= 3 && data.boundary.area_m2 > 25000, `the campus boundary is one closed outline (${data.boundary && data.boundary.area_m2} m2)`);
const bpip = (x, y) => { let c = false; for (let i = 0, j = fence.length - 1; i < fence.length; j = i++) { const a = fence[i], b = fence[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
ok(data.buildings.every(b => b.points_m.some(p => bpip(p[0], p[1]))), "every building is inside it");
let openOut = 0; const g = nav.grid;
for (let k = 0; k < g.cls.length; k++) if (g.cls[k] === 2 && !bpip(g.ox + (k % g.w + .5) * g.cell, g.oy + (((k / g.w) | 0) + .5) * g.cell)) openOut++;
ok(openOut === 0, `untraced ground outside the fence is never walkable (${openOut} cells; the old hull let routes use 534 m2 of it)`);
const noWalkDoors = CampusNav.build(Object.assign({}, data, { paths: data.paths.filter(p => !p.verified) }), {}, opts).doors.length;
ok(nav.doors.length === noWalkDoors, `walks add no doors: they are drawn freehand, so a wall crossing on one is not an entrance (${nav.doors.length} doors with and without them)`);

console.log("\nverified walks");
ok(walks.length >= 1, `the measured walks are in the map data (${walks.map(w => w.name + " " + w.length_m + " m").join(", ")})`);
const cells = nav.grid.cls.reduce((n, c) => n + (c === 3 ? 1 : 0), 0);
ok(cells > 100, `they are painted onto the walking grid as preferred surface (${cells} cells)`);
const hug = [...nav.grid.cls].filter((c, k) => c === 3 && data.buildings.some(b => { const x = g.ox + (k % g.w + .5) * g.cell, y = g.oy + (((k / g.w) | 0) + .5) * g.cell; return lineDist([x, y], b.points_m.concat([b.points_m[0]])) < 1; })).length;
ok(hug === 0, `no walk is preferred within 1 m of a building wall, so a walk drawn into a wall cannot pull routes along it (${hug} cells)`);

(async () => {
for (const w of walks) {
  const a = w.points_m[0], b = w.points_m[w.points_m.length - 1], cross = wallCrossings(w);
  const from = { x: a[0], y: a[1], level: 0 };
  if (!cross.length) {
    const o = await nav.findRoutesAsync(from, { x: b[0], y: b[1], level: 0 }, { alternatives: 2 });
    const r = o.found ? o.routes[0] : null;
    ok(r && r.validated, `${w.name}: a route is found and passes the wall check`);
    if (!r) continue;
    const d = nearAnyWalk(sample(r.points, 1)), near = d.filter(x => x <= 2).length / d.length, own = share(r, w.points_m);
    ok(near >= 0.9, `${w.name}: the route keeps within 2 m of a walk for ${Math.round(near * 100)}% of its length (at least 90%; ${Math.round(own * 100)}% on this one)`);
    ok(Math.max(...d) <= 5, `${w.name}: it never strays more than 5 m from the walks (worst ${Math.max(...d).toFixed(1)} m)`);
    ok(r.length <= w.length_m * 1.05, `${w.name}: it is no longer than the walk itself (${r.length.toFixed(0)} m vs ${w.length_m} m)`);
    ok(own >= 0.9 || r.length <= w.length_m * 0.95, `${w.name}: where it leaves this walk, it is because a shorter way exists (${r.length.toFixed(0)} m vs ${w.length_m} m)`);
    if (own < 0.5) {
      const alt = o.routes.slice(1).map(x => share(x, w.points_m));
      ok(alt.some(s => s >= 0.9), `${w.name}: the best route takes another way, so this walk is offered as an alternative (${alt.map(s => Math.round(s * 100) + "%").join(", ") || "no alternative"} along it)`);
    }
    ok(offSurface(r) === 0, `${w.name}: every point of it is on walkable ground`);
  } else {
    const where = cross.map(c => `${c.into ? "into" : "out of"} ${c.building} at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}), ` + (c.door === Infinity ? "no door mapped" : `${c.door.toFixed(1)} m from a door`)).join("; ");
    console.log(`  note ${w.name} is drawn through walls: ${where}`);
    const endB = nav.buildingAt(b[0], b[1]);
    const doors = endB ? nav.doors.filter(d => d.building === endB.name) : [];
    const door = doors.sort((p, q) => Math.hypot(p.x - b[0], p.y - b[1]) - Math.hypot(q.x - b[0], q.y - b[1]))[0];
    const to = door ? { place: nav.places.find(p => p.kind === "entrance" && p.x === door.x && p.y === door.y).id } : endB ? { place: "building:" + endB.name } : { x: b[0], y: b[1], level: 0 };
    const r = nav.findRoute(from, to), label = door ? door.name : endB ? endB.name : "its end";
    ok(r.found && r.validated && offSurface(r) === 0, `${w.name}: the route to ${label} passes the wall check and stays on walkable ground`);
    if (!r.found) continue;
    const thru = sample(r.points, 0.25).filter(p => p.level === 0 && nav.buildingAt(p.x, p.y) && !nav.walkable(p.x, p.y, 0)).length;
    ok(thru === 0, `${w.name}: it goes around or through the doors, not the walls the walk crosses`);
  }
}

console.log("\nwithout the walks, routes do not depend on them");
const plain = CampusNav.build(Object.assign({}, data, { paths: data.paths.filter(p => !p.verified) }), {}, opts);
const w0 = walks[0], s0 = { x: w0.points_m[0][0], y: w0.points_m[0][1], level: 0 }, e0 = { x: w0.points_m.at(-1)[0], y: w0.points_m.at(-1)[1], level: 0 };
const rp = plain.findRoute(s0, e0);
ok(rp.found, `the same trip still has a route without the walk (${rp.found ? rp.length.toFixed(0) + " m" : rp.reason})`);

console.log("\nconnectivity");
const c = nav.connectivity();
const noDoor = c.noEntrance.map(p => p.name);
ok(c.disconnected.length === 0, "every destination that has an entrance is joined to the network" + (c.disconnected.length ? ": " + c.disconnected.map(p => p.name).join(", ") : ""));
ok(noDoor.every(n => n === "Office 3"), "the only destination with no entrance is the known one, Office 3 (got: " + (noDoor.join(", ") || "none") + ")");
ok(c.stranded.length === 0, "no graph point is cut off from the network (" + c.stranded.length + ")");
const strict = CampusNav.build(data, {}, Object.assign({ openGround: false }, opts)).connectivity();
ok(strict.disconnected.length + strict.noEntrance.length > 0, `traced-surfaces-only mode reports what tracing still misses (${strict.noEntrance.length} without entrance, ${strict.disconnected.length} cut off)`);

console.log("\nroutes between all buildings and areas stay on walkable ground");
const ids = nav.places.filter(p => (p.kind === "building" || p.kind === "area") && p.reachable).map(p => p.id);
let routes = 0, bad = 0, invalid = 0, missing = 0;
for (let i = 0; i < ids.length; i += 2) for (let j = i + 1; j < ids.length; j += 3) {
  const r = nav.findRoute({ place: ids[i] }, { place: ids[j] }); routes++;
  if (!r.found) { missing++; continue; }
  if (nav.validate(r.points)) invalid++;
  if (offSurface(r)) bad++;
}
ok(missing === 0, `${routes} routes found, none missing`);
ok(invalid === 0 && bad === 0, `none crosses a wall or leaves walkable ground (${invalid} fail the wall check, ${bad} leave it)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
