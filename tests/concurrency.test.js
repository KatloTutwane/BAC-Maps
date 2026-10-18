/* Run: node tests/concurrency.test.js
 * Overlapping route searches (a new destination picked while the last route is still being
 * found) must not corrupt each other, and cancelled searches must stop. */
const C = require("../web/nav-engine.js"), data = require("../web/map_data.json"), seed = require("../web/nav_seed.js");
const nav = C.build(data, {}, { seedLinks: seed.links });
const ids = nav.places.filter(p => p.reachable).map(p => p.id).slice(0, 15);
const clean = ids.map(id => C.build(data, {}, { seedLinks: seed.links }).findRoute({ x: 80, y: 74, level: 0 }, { place: id }).length);
const runs = ids.map(id => nav.findRoutesAsync({ x: 80, y: 74, level: 0 }, { place: id }, { alternatives: 1 }));
nav.findRoute({ place: ids[3] }, { place: ids[9] });                       // a synchronous search in the middle
let ticks = 0;
const cancelled = nav.findRoutesAsync({ place: ids[1] }, { place: ids[12] }, { cancelled: () => ++ticks > 2 });
Promise.all([Promise.all(runs), cancelled]).then(([rs, c]) => {
  const wrong = rs.filter((r, i) => !r.found || Math.abs(r.routes[0].length - clean[i]) > 0.01).length;
  console.log((wrong ? "  FAIL " : "  ok   ") + "15 overlapping searches give the same routes as clean runs (" + wrong + " wrong)");
  console.log((c.cancelled ? "  ok   " : "  FAIL ") + "a cancelled search stops and reports it");
  process.exit(wrong || !c.cancelled ? 1 : 0);
});
