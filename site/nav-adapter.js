/* BAC Maps: route adapter.
 *
 * The only file that talks to the Pathfinder engine (web/nav-engine.js). It
 * builds the same navigation model as web/pathfinder.html, from the same data
 * (map_data.js, interiors.js, nav_seed.js), and asks it for routes. Nothing
 * here finds a route itself: walls, doors, corridors, stairs and the cost of
 * untraced ground are all the engine's.
 *
 *   NavAdapter.init()            build the model once the map is on screen
 *   NavAdapter.ready()           -> Promise, resolves true (or false if Pathfinder is missing)
 *   NavAdapter.place(navId)      -> the engine's place ({ reachable, why, x, y, level, ... }) or null
 *   NavAdapter.landmark(name)    -> { x, y, level } for "Main Gate" and "Student Entrance", or null
 *   NavAdapter.route(from, to)   -> Promise of { found, routes: [best, alternative?], reason }
 *                                   from/to: { place: navId } or { x, y, level, name }
 *                                   A newer call cancels an older one still searching.
 *   NavAdapter.cancel()
 *   NavAdapter.clean(text)       spelling fixes for names inside the engine's directions
 *
 * Admin edits made in pathfinder.html?admin=1 on this origin are kept in this
 * browser's localStorage; they are applied here too, exactly as the
 * pathfinder applies them.
 */
(function (global) {
  "use strict";

  var EDIT_KEY = "campus-navigator.nav-edits.v1";      // same key as web/pathfinder.js
  var EDIT_GROUPS = ["places", "links", "blocked", "walkable", "access"];

  var nav = null, readyPromise = null, landmarks = {}, seq = 0;

  function available() {
    return !!(global.CampusNav && global.CAMPUS_MAP_DATA && global.CAMPUS_INTERIORS);
  }

  function edits() {
    var e = {};
    EDIT_GROUPS.forEach(function (k) { e[k] = []; });
    try {
      var raw = global.localStorage.getItem(EDIT_KEY);
      if (raw) { var o = JSON.parse(raw); EDIT_GROUPS.forEach(function (k) { if (Array.isArray(o[k])) e[k] = o[k]; }); }
    } catch (err) { /* storage blocked: shipped data only */ }
    return e;
  }

  /* The median of several measured points, so one stray trace can't move it. */
  function median(points) {
    if (!points.length) return null;
    function mid(a) { a = a.slice().sort(function (p, q) { return p - q; }); var n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; }
    return { x: mid(points.map(function (p) { return p[0]; })), y: mid(points.map(function (p) { return p[1]; })), level: 0 };
  }

  /* map_data.json has no gate or entrance points, but the walks verified on
     site start or end there and are named for it ("Main Gate to ...",
     "... to the student entrance"). Read the positions from those ends. */
  function findLandmarks(data) {
    var gate = [], student = [];
    (data.paths || []).forEach(function (p) {
      if (!p.verified || !p.points_m || p.points_m.length < 2) return;
      var first = p.points_m[0], last = p.points_m[p.points_m.length - 1];
      if (/^main gate to /i.test(p.name)) gate.push(first);
      if (/ to the main gate\b/i.test(p.name)) gate.push(last);
      if (/ to the student entrance$/i.test(p.name)) student.push(last);
    });
    landmarks = {};
    if (gate.length) landmarks["Main Gate"] = median(gate);
    if (student.length) landmarks["Student Entrance"] = median(student);
  }

  function build(storeyHeight) {
    var data = Object.assign({}, global.CAMPUS_MAP_DATA, { interiors: global.CAMPUS_INTERIORS });
    var seed = global.CAMPUS_NAV_SEED || { links: [] };
    nav = global.CampusNav.build(data, edits(), {
      openGround: true, seedLinks: seed.links, storeyHeight: storeyHeight || 3.2, interiors: global.CAMPUS_INTERIORS
    });
  }

  /* The model takes a few hundred milliseconds to build, so it waits until
     the map's first frame is on screen, like the pathfinder does. */
  function init(storeyHeight) {
    if (readyPromise) return readyPromise;
    if (global.CAMPUS_MAP_DATA) findLandmarks(global.CAMPUS_MAP_DATA);
    if (!available()) { readyPromise = Promise.resolve(false); return readyPromise; }
    readyPromise = new Promise(function (resolve) {
      var started = false;
      function go() {
        if (started) return;
        started = true;
        setTimeout(function () {
          try { build(storeyHeight); resolve(true); }
          catch (err) { console.warn("Pathfinder failed to build its model.", err); nav = null; resolve(false); }
        }, 0);
      }
      requestAnimationFrame(go);
      setTimeout(go, 400);     // hidden tabs get no animation frames
    });
    return readyPromise;
  }

  function route(from, to) {
    var mine = ++seq;
    return init().then(function (ok) {
      if (!ok || !nav) return { found: false, reason: "Pathfinder isn't available, so no route can be shown.", routes: [] };
      if (mine !== seq) return { found: false, cancelled: true, routes: [] };
      return nav.findRoutesAsync(from, to, { alternatives: 1, cancelled: function () { return mine !== seq; } });
    });
  }

  /* The engine names places as traced ("Main buildin"); show them as the site does. */
  function clean(text) {
    return String(text || "").replace(/\bMain buildin\b/g, "Main Building").replace(/\bChilling area\b/g, "Chilling Area");
  }

  global.NavAdapter = {
    init: init,
    ready: function () { return init(); },
    isAvailable: available,
    place: function (id) { return nav && id ? nav.place(id) : null; },
    landmark: function (name) { return landmarks[name] || null; },
    route: route,
    cancel: function () { seq++; },
    clean: clean
  };
})(window);
