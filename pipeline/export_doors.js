/* node pipeline/export_doors.js  ->  pipeline/_doors_cache.json
 * The entrance passages the navigation engine derives from map_data.json. interiors.py keeps
 * these clear of rooms. Run this before interiors.py whenever map_data.json changes. */
const C = require("../web/nav-engine.js"), d = require("../web/map_data.json");
const n = C.build(d, {}, {});
const out = n.doors.map(dr => ({ name: dr.name, x: dr.x, y: dr.y,
  segs: n.ways.filter(w => Math.hypot(w.ax - dr.x, w.ay - dr.y) < 0.01 || Math.hypot(w.bx - dr.x, w.by - dr.y) < 0.01).map(w => [[w.ax, w.ay], [w.bx, w.by]]) }));
require("fs").writeFileSync(__dirname + "/_doors_cache.json", JSON.stringify(out, null, 1));
console.log(out.length + " entrance passages written");
