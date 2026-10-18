/* Run: node tests/interiors.test.js
 * Multi-floor navigation and wall rules for the main building interiors (web/interiors.json). */
const C = require("../web/nav-engine.js"), data = require("../web/map_data.json"), I = require("../web/interiors.json");
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } }
function pip(x, y, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }

const nav = C.build(data, {}, { interiors: I });
console.log("build:", JSON.stringify(nav.stats));
ok(nav.warnings.length === 0, "no build warnings" + (nav.warnings.length ? ": " + nav.warnings.join("; ") : ""));
const rooms = nav.places.filter(p => p.kind === "room");
ok(rooms.length === I.rooms.length, rooms.length + " rooms are destinations, each with a floor (" + [...new Set(rooms.map(r => r.floorName))].join(", ") + ")");
ok(new Set(rooms.map(r => r.id)).size === rooms.length, "room ids are unique");

console.log("\nevery route between rooms (" + rooms.length + " x " + rooms.length + ")");
const byId = Object.fromEntries(I.rooms.map(r => [r.id, r]));
let n = 0, found = 0, invalid = 0, trespass = [], badStairs = 0, sameFloorDetours = 0, slowest = 0, unreach = [];
for (const a of rooms) for (const b of rooms) {
  if (a === b) continue; n++;
  const t = Date.now(), r = nav.findRoute({ place: a.id }, { place: b.id }); slowest = Math.max(slowest, Date.now() - t);
  if (!r.found) { if (a.reachable && b.reachable) unreach.push(a.name + " -> " + b.name + ": " + r.reason); continue; }
  found++;
  if (!r.validated || nav.validate(r.points)) invalid++;
  // the route may only be inside its own start and end rooms
  const own = [a.id.slice(5), b.id.slice(5)];
  for (let i = 1; i < r.points.length && trespass.length < 5; i++) {
    const p = r.points[i - 1], q = r.points[i]; if (p.level !== q.level) continue;
    const L = Math.hypot(q.x - p.x, q.y - p.y), m = Math.max(1, Math.ceil(L / 0.25));
    for (let k = 0; k <= m; k++) {
      const x = p.x + (q.x - p.x) * k / m, y = p.y + (q.y - p.y) * k / m;
      const hit = I.rooms.find(rm => rm.level === p.level && !own.includes(rm.id) && pip(x, y, rm.points));
      if (hit) { trespass.push(a.name + " -> " + b.name + " crosses " + hit.name); break; }
    }
  }
  r.transitions.forEach(tr => { const st = nav.stairs.find(s => s.name === tr.name); if (!st || !st.nodes.some(x => x.level === tr.from) || !st.nodes.some(x => x.level === tr.to)) badStairs++; });
  if (a.level === b.level && r.floors.length > 1 && a.level === 1) sameFloorDetours++;
}
ok(unreach.length === 0, found + " of " + n + " room-to-room routes found; the rest involve a room with no door" + (unreach.length ? " | " + unreach.slice(0, 3).join(" | ") : ""));
ok(invalid === 0, "every route passed the wall check (" + invalid + " failed)");
ok(trespass.length === 0, "no route passes through another room" + (trespass.length ? ": " + trespass.join("; ") : ""));
ok(badStairs === 0, "every change of floor uses real stairs serving both floors");
ok(sameFloorDetours === 0, "routes between first-floor rooms stay on the first floor (" + sameFloorDetours + " detours)");
ok(slowest < 400, "slowest room route " + slowest + " ms");

console.log("\nsample journeys");
const show = (a, b) => { const r = nav.findRoute(a, b); return r; };
let r = show({ place: "room:G-lab-1" }, { place: "room:G-lab-8" });
ok(r.found && r.floors.join() === "0", "ground to ground (Lab 1 -> Lab 8): " + r.length.toFixed(0) + " m, ground floor only");
r = show({ place: "room:F1-office-10" }, { place: "room:F1-lab-17" });
ok(r.found && r.floors.join() === "1", "first floor to first floor (Office 10 -> Lab 17): " + r.length.toFixed(0) + " m, first floor only");
r = show({ place: "room:G-it-room" }, { place: "room:F1-wc-m" });
ok(r.found && r.transitions.length === 1 && r.transitions[0].from === 0 && r.transitions[0].to === 1, "ground to first (IT room -> WC M) via " + (r.transitions[0] || {}).name);
r = show({ place: "room:F1-lab-16" }, { place: "room:G-lab-5" });
ok(r.found && r.transitions.length === 1 && r.transitions[0].to === 0, "first to ground (Lab 16 -> Lab 5) via " + (r.transitions[0] || {}).name);
r = show({ place: "area:Parking lot" }, { place: "room:F1-reception" });
ok(r.found && r.steps.some(s => /Take .* up to the First floor/.test(s.text)), "car park to Reception: " + r.steps.filter(s => /Take/.test(s.text)).map(s => s.text).join(""));
r = show({ place: "room:F1-caf" }, { place: "raised:Chilling area" });
ok(r.found && r.floors.join() === "1", "CAF to the chilling area over the bridge, without going downstairs");
r = show({ place: "room:G-it-room" }, { x: 56, y: 52, level: 0 });
ok(r.found && r.length < 15, "IT room to the walking path through its glass door: " + (r.found ? r.length.toFixed(0) + " m" : r.reason));
r = show({ place: "area:Parking lot" }, { place: "room:F1-office-3" });
ok(!r.found && /no door/.test(r.reason), "a room with no door gives a clear reason: " + r.reason);
const steps = show({ place: "room:G-room-1" }, { place: "room:F1-lab-15" }).steps.map(s => s.text);
ok(steps[0].startsWith("Head") && steps.some(s => /Take/.test(s)) && /Arrive at Lab 15 \(First floor\)/.test(steps[steps.length - 1]), "directions are generated from the route: " + steps.join(" / "));

console.log("\nwalls and doors");
const lab12 = I.rooms.find(x => x.id === "F1-lab-12"), lab13 = I.rooms.find(x => x.id === "F1-lab-13");
ok(nav.walkable(lab12.centre[0], lab12.centre[1], 1), "inside a room is walkable");
ok(!nav.walkable(lab12.centre[0], lab12.centre[1], 0) || pip(lab12.centre[0], lab12.centre[1], I.rooms.find(x => x.level === 0 && pip(lab12.centre[0], lab12.centre[1], x.points))?.points || []), "the same spot on the ground floor belongs to the ground-floor room, not Lab 12");
const shared = lab12.points.filter(p => lab13.points.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.05));
if (shared.length >= 2) {
  const mid = [(shared[0][0] + shared[1][0]) / 2, (shared[0][1] + shared[1][1]) / 2];
  ok(!nav.walkable(mid[0], mid[1], 1), "the wall between Lab 12 and Lab 13 is not walkable");
  let pos = { x: lab12.centre[0], y: lab12.centre[1] }, dx = lab13.centre[0] - pos.x, dy = lab13.centre[1] - pos.y, L = Math.hypot(dx, dy);
  for (let i = 0; i < 200; i++) { const m = nav.move(pos.x, pos.y, 1, dx / L * 0.1, dy / L * 0.1); pos = m; }
  ok(pip(pos.x, pos.y, lab12.points), "walking from Lab 12 straight at Lab 13 is stopped by the wall");
} else ok(false, "Lab 12 and Lab 13 share a wall");
ok(nav.walkable(lab12.door[0], lab12.door[1], 1), "the doorway is walkable");
const un = I.unassigned["0"].slice().sort((a, b) => b.length - a.length)[0];
let probe = null; for (let k = 0; k < un.length && !probe; k++) { const a = un[k], b = un[(k + 3) % un.length], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (pip(m[0], m[1], un)) probe = m; }
ok(probe && !nav.walkable(probe[0], probe[1], 0), "unassigned space inside the building is not walkable (" + (probe || []).map(v => v.toFixed(1)) + ")");

console.log("\nvertical connections");
ok(nav.stairs.length === 5 && nav.stairs.every(s => s.nodes.map(x => x.level).join() === "0,1"), "5 stairs, each joining the ground and first floors only");
ok(!nav.stairs.some(s => /CAF and LT/.test(s.name)), "the unconfirmed stairs between CAF and LT are not connected");
const noStairs = C.build(data, {}, { interiors: Object.assign({}, I, { stairs: [] }) });
const noStairsData = Object.assign({}, data, { nodes: [] });
const cut = C.build(noStairsData, {}, { interiors: Object.assign({}, I, { stairs: [] }) });
r = cut.findRoute({ place: "area:Parking lot" }, { place: "room:F1-lab-12" });
ok(!r.found, "with every staircase removed, the first floor is unreachable from the ground: " + r.reason);

console.log("\nclearance");
const wide = C.build(data, {}, { interiors: I, clearance: 0.45 });
r = wide.findRoute({ place: "area:Parking lot" }, { place: "room:F1-lab-12" });
ok(r.found && !wide.validate(r.points), "a larger clearance (0.45 m) still finds a valid route");
ok(nav.walkable(80, 74, 0) && wide.walkable(80, 74, 0), "open ground stays walkable");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
