/* Run: node tests/scenarios.test.js
   The route scenarios a campus navigator must get right: near and far, around and through
   buildings, narrow corridors, many turns, between floors, cut-off and inaccessible places,
   corrected entrances, alternatives, and the auto-walk following exactly the route shown. */
const CampusNav = require("../web/nav-engine.js");
const data = require("../web/map_data.json");
const interiors = require("../web/interiors.json");
const seed = require("../web/nav_seed.js");
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  ok   " + msg); } else { fail++; console.log("  FAIL " + msg); } }

const opts = { seedLinks: seed.links, interiors };
const nav = CampusNav.build(data, {}, opts);
const M = (r) => r.found ? r.length.toFixed(1) + " m" : "no route (" + r.reason + ")";

/* every 25 cm of a route is walkable, and floors change only on stairs */
function check(r, n) {
  n = n || nav;
  let off = 0, jumps = 0;
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1], b = r.points[i];
    if (a.level !== b.level) { if (!(a.kind === "stairs" || b.kind === "stairs" || b.tag === "stairs")) jumps++; continue; }
    const L = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(1, Math.ceil(L / 0.25));
    for (let s = 0; s <= k; s++) if (!n.walkable(a.x + (b.x - a.x) * s / k, a.y + (b.y - a.y) * s / k, a.level)) off++;
  }
  return { off, jumps, wall: n.validate(r.points) };
}
function clean(r, n) { const c = check(r, n); return r.found && r.validated && !c.off && !c.jumps && !c.wall; }
function turns(r) {                                         // direction changes of more than 30 degrees
  let t = 0, prev = null;
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1], b = r.points[i]; if (a.level !== b.level || Math.hypot(b.x - a.x, b.y - a.y) < 0.5) continue;
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    if (prev != null && Math.abs(((h - prev) * 180 / Math.PI + 540) % 360 - 180) > 30) t++;
    prev = h;
  }
  return t;
}
function pip(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
const B = name => data.buildings.find(b => b.name === name);

console.log("\nnearby destinations");
let r = nav.findRoute({ place: "room:F1-lab-12" }, { place: "room:F1-lab-13" });
ok(clean(r) && r.length < 30, "Lab 12 to Lab 13, next door on the first floor: short and clean (" + M(r) + ")");
r = nav.findRoute({ place: "room:G-lab-5" }, { place: "room:G-lab-6" });
ok(clean(r) && r.length < 30, "Lab 5 to Lab 6 on the ground floor (" + M(r) + ")");

console.log("\nopposite sides of a building");
const main = B("Main buildin").points_m, xs = main.map(p => p[0]), ys = main.map(p => p[1]);
function outside(x, y, dx, dy) { for (let k = 0; k < 120; k++) { x += dx; y += dy; if (!pip(x, y, main) && nav.locate(x, y, 0).length) return { x, y, level: 0 }; } return null; }
const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
const west = outside(Math.min(...xs) + 2, cy, -0.5, 0), east = outside(Math.max(...xs) - 2, cy, 0.5, 0);
r = west && east ? nav.findRoute(west, east) : { found: false, reason: "no outside points" };
ok(clean(r), "west of the main building to east of it: a clean route (" + M(r) + ")");
ok(r.found && r.length > Math.hypot(east.x - west.x, east.y - west.y), "it goes around or through doors, never straight through the walls");

console.log("\nnarrow corridors");
r = nav.findRoute({ place: "room:G-lab-4" }, { place: "room:G-lab-8" });
ok(clean(r), "Lab 4 to Lab 8 along the 2.8 m ground-floor corridor of the lab wing (" + M(r) + ")");
ok(r.found && r.points.every(p => p.level === 0), "it stays on the ground floor");

console.log("\nroutes with many turns");
r = nav.findRoute({ place: "room:F1-kitchen" }, { place: "room:F1-lab-17" });
ok(clean(r) && turns(r) >= 3, "Kitchen to Lab 17 along the bending first-floor corridor: clean, " + turns(r) + " turns (" + M(r) + ")");
r = nav.findRoute({ place: "area:Staff parking 1" }, { place: "building:Hostel 3" });
ok(clean(r) && turns(r) >= 2, "Staff parking 1 to Hostel 3 across campus: clean, " + turns(r) + " turns (" + M(r) + ")");

console.log("\ndifferent floors");
r = nav.findRoute({ place: "room:G-lab-1" }, { place: "room:F1-lab-14" });
const levels = r.found ? [...new Set(r.points.map(p => p.level))] : [];
ok(clean(r) && levels.includes(0) && levels.includes(1), "Lab 1 (ground) to Lab 14 (first): uses both floors (" + M(r) + ")");
ok(r.found && r.transitions && r.transitions.length >= 1 && r.transitions.every(t => /stair/i.test(t.name)), "it changes floor only on stairs: " + (r.transitions || []).map(t => t.name).join(", "));
ok(r.found && check(r).jumps === 0, "no point jumps between floors anywhere else");
r = nav.findRoute({ place: "room:F1-office-10" }, { place: "room:G-lab-8" });
ok(clean(r) && r.floors.join() === "1,0", "Office 10 (first) down to Lab 8 (ground) (" + M(r) + ")");

console.log("\ninaccessible and cut-off destinations");
r = nav.findRoute({ place: "area:Parking lot" }, { place: "room:F1-office-3" });
ok(!r.found && /no door/i.test(r.reason), "Office 3 has no door yet: no route, and the reason says so (\"" + r.reason + "\")");
const d = B("Block D").points_m, dx0 = Math.min(...d.map(p => p[0])) - 5, dx1 = Math.max(...d.map(p => p[0])) + 5, dy0 = Math.min(...d.map(p => p[1])) - 5, dy1 = Math.max(...d.map(p => p[1])) + 5;
const rect = (x0, y0, x1, y1) => ({ name: "test wall", points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const ring = [rect(dx0, dy0, dx1, dy0 + 1.5), rect(dx0, dy1 - 1.5, dx1, dy1), rect(dx0, dy0, dx0 + 1.5, dy1), rect(dx1 - 1.5, dy0, dx1, dy1)];
const walled = CampusNav.build(data, { blocked: ring }, opts);
r = walled.findRoute({ place: "area:Parking lot" }, { place: "building:Block D" });
ok(!r.found && /no walkable connection/i.test(r.reason), "Block D walled in on every side: no route, reported clearly (\"" + r.reason + "\")");
ok(walled.connectivity().disconnected.some(p => p.name === "Block D"), "and the connectivity check lists Block D as cut off");

console.log("\nan alternative when the usual way is closed");
r = nav.findRoute({ place: "area:Staff parking 1" }, { place: "building:Hostel 3" });
const mid = r.points[Math.floor(r.points.length / 2)];
const blockMid = CampusNav.build(data, { blocked: [rect(mid.x - 2, mid.y - 2, mid.x + 2, mid.y + 2)] }, opts);
const r2 = blockMid.findRoute({ place: "area:Staff parking 1" }, { place: "building:Hostel 3" });
ok(clean(r2, blockMid), "a 4 m block dropped in the middle of the best route: another clean route is found (" + M(r) + " -> " + M(r2) + ")");
ok(r2.found && r2.points.every(p => !(Math.abs(p.x - mid.x) < 2 && Math.abs(p.y - mid.y) < 2)), "and it keeps out of the blocked square");

console.log("\nrouting to the right entrance");
r = nav.findRoute({ place: "area:Parking lot" }, { place: "building:Block D" });
const doorsD = nav.places.find(p => p.id === "building:Block D").anchors;
const last = r.points[r.points.length - 1];
ok(clean(r) && doorsD.some(a => Math.hypot(a.x - last.x, a.y - last.y) < 1.5), "a route to a building ends at its entrance, not at its centre (" + M(r) + ")");
ok(!pip(last.x, last.y, d), "and never inside the building's walls");
const far = d.reduce((m, p) => Math.hypot(p[0] - doorsD[0].x, p[1] - doorsD[0].y) > Math.hypot(m[0] - doorsD[0].x, m[1] - doorsD[0].y) ? p : m, d[0]);
const moved = CampusNav.build(data, { access: [{ place: "building:Block D", x: far[0] + 1, y: far[1] + 1, level: 0 }] }, opts);
const rm = moved.findRoute({ place: "area:Parking lot" }, { place: "building:Block D" }), lm = rm.points[rm.points.length - 1];
ok(clean(rm, moved) && Math.hypot(lm.x - far[0], lm.y - far[1]) < 4, "an administrator can move Block D's entrance; routes then end there (" + M(rm) + ")");
const inside = CampusNav.build(data, { access: [{ place: "building:Block D", x: (dx0 + dx1) / 2, y: (dy0 + dy1) / 2, level: 0 }] }, opts);
const ai = inside.places.find(p => p.id === "building:Block D").anchors[0];
ok(!pip(ai.x, ai.y, d) || inside.warnings.some(w => /Block D/.test(w)), "an entrance put inside the walls snaps out to walkable ground (or is refused with a warning)");

console.log("\nthe auto-walk follows exactly the route shown");
function walkAlong(rt, step) {                              // the same interpolation pathfinder.js uses for the demo
  const cum = [0]; for (let i = 1; i < rt.points.length; i++) { const a = rt.points[i - 1], b = rt.points[i]; cum.push(cum[i - 1] + (a.level === b.level ? Math.hypot(b.x - a.x, b.y - a.y) : 0)); }
  const out = [];
  for (let s = 0; s <= cum[cum.length - 1]; s += step) {
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = rt.points[i - 1], b = rt.points[i], t = Math.max(0, Math.min(1, (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1)));
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, level: a.level !== b.level ? (t < 0.5 ? a.level : b.level) : a.level });
  }
  return out;
}
for (const [f, t, label] of [["area:Parking lot", "room:F1-lab-14", "parking lot to Lab 14 (ground, stairs, first floor)"], ["room:F1-office-10", "room:G-lab-8", "Office 10 down to Lab 8 (first floor, stairs, ground)"], ["area:Staff parking 1", "building:Hostel 3", "Staff parking 1 to Hostel 3 (outdoors)"]]) {
  const rt = nav.findRoute({ place: f }, { place: t }), steps = walkAlong(rt, 0.2);
  const bad = steps.filter(p => !nav.walkable(p.x, p.y, p.level)).length;
  ok(rt.found && bad === 0, "demo, " + label + ": " + steps.length + " positions, all on walkable ground");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
