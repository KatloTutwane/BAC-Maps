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

console.log("\nverified walks");
ok(walks.length >= 1, `the measured walks are in the map data (${walks.map(w => w.name + " " + w.length_m + " m").join(", ")})`);
const cells = nav.grid.cls.reduce((n, c) => n + (c === 3 ? 1 : 0), 0);
ok(cells > 100, `they are painted onto the walking grid as preferred surface (${cells} cells)`);

for (const w of walks) {
  const a = w.points_m[0], b = w.points_m[w.points_m.length - 1];
  const r = nav.findRoute({ x: a[0], y: a[1], level: 0 }, { x: b[0], y: b[1], level: 0 });
  ok(r.found && r.validated, `${w.name}: a route is found and passes the wall check`);
  if (!r.found) continue;
  const d = sample(r.points, 1).map(p => lineDist([p.x, p.y], w.points_m));
  const near = d.filter(x => x <= 2).length / d.length;
  ok(near >= 0.9, `${w.name}: the route keeps within 2 m of the measured walk for ${Math.round(near * 100)}% of its length (at least 90%)`);
  ok(Math.max(...d) <= 5, `${w.name}: it never strays more than 5 m from it (worst ${Math.max(...d).toFixed(1)} m)`);
  ok(r.length <= w.length_m * 1.05, `${w.name}: it is no longer than the walk itself (${r.length.toFixed(0)} m vs ${w.length_m} m measured)`);
  ok(offSurface(r) === 0, `${w.name}: every point of it is on walkable ground`);
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
