/* Run: node tests/nav.test.js */
const CampusNav = require("../web/nav-engine.js");
const data = require("../web/map_data.json");
const seed = require("../web/nav_seed.js");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  ok   " + msg); } else { fail++; console.log("  FAIL " + msg); } }

const nav = CampusNav.build(data, {}, { seedLinks: seed.links });
console.log("build:", JSON.stringify(nav.stats), "warnings:", nav.warnings);
ok(nav.warnings.length === 0, "no build warnings");
ok(nav.doors.length === 5, "5 doors derived from the map (got " + nav.doors.length + ")");
ok(nav.places.every(p => p.reachable), "every place has an accessible anchor");

/* every route must lie on walkable surface */
function violations(r) {
  let bad = 0, checked = 0;
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1], b = r.points[i];
    if (a.level !== b.level) continue;                       // a flight of stairs
    const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(L / 0.25));
    for (let k = 0; k <= n; k++) {
      const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n; checked++;
      if (!nav.walkable(x, y, a.level)) bad++;
    }
  }
  return { bad, checked };
}

console.log("\nall places to a spread of places (route validity)");
const ids = nav.places.map(p => p.id);
let shownBad = 0, routes = 0, totalBad = 0, shorter = 0, maxMs = 0, notFound = [];
for (let i = 0; i < ids.length; i += 2) for (let j = 1; j < ids.length; j += 3) {
  if (ids[i] === ids[j]) continue;
  const t = Date.now(), r = nav.findRoute({ place: ids[i] }, { place: ids[j] }); maxMs = Math.max(maxMs, Date.now() - t);
  if (!r.found) { notFound.push(ids[i] + " -> " + ids[j]); continue; }
  routes++; const v = violations(r); totalBad += v.bad;
  const a = nav.place(ids[i]), b = nav.place(ids[j]);
  if (r.length + 0.5 < Math.hypot(a.x - b.x, a.y - b.y) - 40) shorter++;   // sanity only, buildings are large
  if (v.bad && shownBad++ < 5) console.log("   bad points on", ids[i], "->", ids[j], v);
}
ok(notFound.length === 0, routes + " routes found, none missing" + (notFound.length ? ": " + notFound.slice(0, 3) : ""));
ok(totalBad === 0, "no route point is off a walkable surface (" + totalBad + " bad)");
ok(maxMs < 400, "slowest route " + maxMs + " ms");

console.log("\nspecific journeys");
let r = nav.findRoute({ place: "area:Parking lot" }, { place: "raised:Chilling area" });
ok(r.found && r.points.some(p => p.level === 1) && r.stairs === 1, "parking lot -> chilling area climbs one flight and crosses a bridge");
ok(r.found && r.steps[r.steps.length - 1].final, "route ends with an arrival instruction");
r = nav.findRoute({ place: "building:Block A" }, { place: "building:Hostel 3" });
ok(r.found && r.length > 100, "Block A -> Hostel 3 over open ground: " + (r.found ? r.length.toFixed(0) + " m" : r.reason));
r = nav.findRoute({ place: "stairs:Stair well (Reception)" }, { place: "stairs:Stair well (Lecture Theatre)" });
const cor = data.paths.find(p => p.name === "Main buildin — ground floor corridor").points_m;
const arc = q => { let best = 0, bd = 1e9, acc = 0, at = 0; for (let i = 1; i < cor.length; i++) { const a = cor[i-1], b = cor[i], L = Math.hypot(b[0]-a[0], b[1]-a[1]); const t = Math.max(0, Math.min(1, ((q[0]-a[0])*(b[0]-a[0])+(q[1]-a[1])*(b[1]-a[1]))/(L*L))); const d = Math.hypot(a[0]+t*(b[0]-a[0])-q[0], a[1]+t*(b[1]-a[1])-q[1]); if (d < bd) { bd = d; at = acc + t*L; } acc += L; } return at; };
const expected = Math.abs(arc(data.nodes[0].at) - arc(data.nodes[1].at));
ok(r.found && Math.abs(r.length - expected) < 3, "between the two stairwells the route follows the corridor: " + r.length.toFixed(1) + " m vs " + expected.toFixed(1) + " m along the traced corridor");

console.log("\nroutes never enter a building except by a door");
function throughBuilding(r) {
  let n = 0;
  r.points.forEach((p, i) => { if (i && p.level === 0 && r.points[i - 1].level === 0) {
    const a = r.points[i - 1], L = Math.hypot(p.x - a.x, p.y - a.y), m = Math.ceil(L / 0.25);
    for (let k = 0; k <= m; k++) { const x = a.x + (p.x - a.x) * k / m, y = a.y + (p.y - a.y) * k / m;
      const B = nav.buildingAt(x, y); if (B && B.name !== "Main buildin") n++; } } });
  return n;
}
r = nav.findRoute({ place: "building:Block D" }, { place: "building:Block F2" });
ok(r.found && throughBuilding(r) === 0, "Block D -> Block F2 passes through no building");
r = nav.findRoute({ place: "building:Block A" }, { place: "area:Parking lot" });
ok(r.found && throughBuilding(r) === 0, "Block A -> Parking lot passes through no building");

console.log("\nclicked points");
r = nav.findRoute({ x: 80, y: 74, level: 0 }, { x: 40, y: 120, level: 0 });
ok(r.found, "free points on the ground");
r = nav.findRoute({ x: 40, y: 120, level: 0 }, { x: 40, y: 120, level: 0 });
ok(r.found && r.length < 1.5, "start equals destination gives a near-zero route");
const inside = nav.findRoute({ x: 80, y: 74, level: 0 }, { x: 100, y: 112, level: 0 });
ok(inside.found || inside.reason, "a point inside a building snaps to the nearest walkable cell or reports why not");
r = nav.findRoute({ x: 80, y: 74, level: 0 }, { x: 500, y: 500, level: 0 });
ok(!r.found && /walkable/.test(r.reason), "point far outside the campus is refused: " + r.reason);

console.log("\ntraced surfaces only (strict)");
const strict = CampusNav.build(data, {}, { openGround: false, seedLinks: seed.links });
const unreach = strict.places.filter(p => !p.reachable).map(p => p.name);
ok(unreach.length > 0, unreach.length + " places have no entrance on traced surfaces: " + unreach.slice(0, 4).join(", ") + "...");
let t = Date.now();
r = strict.findRoute({ place: "area:Parking lot" }, { place: "raised:Chilling area" });
ok(r.found, "parking lot -> chilling area still works on traced surfaces + door links (" + (Date.now() - t) + " ms)");
t = Date.now();
r = strict.findRoute({ place: "area:Recreational area" }, { place: "area:Staff chilling area" });
ok(!r.found && /No walkable connection/.test(r.reason), "disconnected pieces report no route: '" + r.reason + "' (" + (Date.now() - t) + " ms)");
r = strict.findRoute({ place: "building:Block D" }, { place: "area:Parking lot" });
ok(!r.found && /no accessible entrance/.test(r.reason), "building with no entrance reaches no route: '" + r.reason + "'");

console.log("\nadministrator edits");
const edited = CampusNav.build(data, { blocked: [{ name: "wall", points: [[60, 60], [90, 60], [90, 90], [60, 90]] }] }, { seedLinks: seed.links });
const before = nav.findRoute({ place: "area:Parking lot" }, { place: "building:Block D" });
const after = edited.findRoute({ place: "area:Parking lot" }, { place: "building:Block D" });
ok(before.found && after.found && after.length >= before.length - 0.01, "a blocked area never shortens a route (" + before.length.toFixed(0) + " -> " + after.length.toFixed(0) + " m)");
ok(!edited.walkable(75, 75, 0), "the blocked area cannot be walked on");
const withPlace = CampusNav.build(data, { places: [{ name: "Room 101", x: 31.4, y: 50.6, level: 1 }] }, { seedLinks: seed.links });
r = withPlace.findRoute({ place: "area:Parking lot" }, { place: "custom:0" });
ok(r.found && r.points[r.points.length - 1].level === 1, "a custom first floor room is reachable");

console.log("\ncollision");
ok(nav.walkable(80, 74, 0), "parking lot is walkable");
ok(!nav.walkable(154, 96, 0), "inside Block k is not walkable");
ok(!nav.walkable(30, 60, 0), "a point in the main building but off the corridor is not walkable at ground floor");
ok(nav.walkable(53.6, 133.6, 0), "corridor end is walkable");
let m = nav.move(80, 74, 0, 0, 1); ok(m.moved, "can move across the car park");
const wall = nav.move(104, 113, 0, 1.5, 0);
ok(!wall.moved || nav.walkable(wall.x, wall.y, 0), "moving into a wall is stopped or slid");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
