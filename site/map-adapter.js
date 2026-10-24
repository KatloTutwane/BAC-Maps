/* BAC Maps: map adapter.
 *
 * The only file that talks to the map module (web/campus-map.js, the campus
 * drawings with tappable buildings, areas and rooms). The rest of the site
 * calls MapAdapter, so replacing the map later touches nothing else.
 *
 * If campus-map.js, map_data.js and interiors.js (with the drawings in
 * web/renders/) loaded, the real map is mounted. If not, a placeholder is
 * drawn and places() returns a small mock list, so every UI feature keeps
 * working. Add ?map=off to the URL to force the placeholder.
 *
 *   MapAdapter.init(el)        -> { live: true | false }
 *   MapAdapter.isLive()
 *   MapAdapter.places()        -> map features [{ kind, name, floors?, level?, ... }]
 *   MapAdapter.rooms()         -> every room of every floor, from interiors.json
 *   MapAdapter.floorName(l)    -> "Ground floor", "First floor"
 *   MapAdapter.focus(name)     -> true if the map knows the name (rooms: only on the floor in view)
 *   MapAdapter.focusPoint(p, rects) -> fly to { x, y, level } and pin it inside one of rects; null removes the pin
 *   MapAdapter.highlight(name) -> null clears
 *   MapAdapter.setFloor(v)     -> "all", 0 or 1
 *   MapAdapter.fit()
 *   MapAdapter.zoomBy(f)       -> multiply the zoom, e.g. 1.5 in, 1 / 1.5 out
 *   MapAdapter.faceNorth()
 *   MapAdapter.northAngle()    -> screen angle of north, degrees clockwise from up
 *   MapAdapter.bounds()        -> { x0, y0, x1, y1 } in map metres, or null
 *   MapAdapter.origin()        -> GPS origin from map_data.json, or null
 *   MapAdapter.showUser(pos)   -> the location dot at { x, y, level }; null hides it
 *   MapAdapter.showRoute(points, rects) -> draw a Pathfinder route and fit it into the largest
 *                                 free part of the map (rects: { left, top, right, bottom } in map pixels)
 *   MapAdapter.clearRoute()
 *   MapAdapter.walk(route, onLevel, onDone) -> a marker walks the route; returns stop()
 *   MapAdapter.on("select" | "rotate" | "view", fn) -> unsubscribe
 */
(function (global) {
  "use strict";

  /* Stand in for map.features() while the real map is missing. Real names
     from the brief; no floors, sizes or other details are invented. */
  var MOCK_PLACES = [
    { kind: "building", name: "Main Building" },
    { kind: "building", name: "Block A" },
    { kind: "building", name: "Block D" },
    { kind: "building", name: "Lecturer's Offices" },
    { kind: "building", name: "Hostel 1" },
    { kind: "building", name: "Maitron House" },
    { kind: "building", name: "School Clinic" },
    { kind: "building", name: "Tuckshop" },
    { kind: "building", name: "School ATM" },
    { kind: "building", name: "Ladies Toilets" },
    { kind: "building", name: "Gents Toilets" },
    { kind: "parking", name: "Parking Lot" },
    { kind: "staff_parking", name: "Staff Parking 1" },
    { kind: "raised_area", name: "Chilling Area" },
    { kind: "yard", name: "Recreational Area" },
    { kind: "yard", name: "Mitron's Yard" }
  ];

  var USER_COLOUR = "#12A5DD", WALK_COLOUR = "#0B6E99";   // brand cyan and brand dark, as in tokens.css

  var map = null, live = false, listeners = {}, rotation = 0, mapEl = null;

  /* The drawings' paths in interiors.js ("renders/upper_floor.webp") are
     relative to web/, where the map's own pages live; the site is in site/. */
  var WEB_DIR = "../web/";
  function withDrawingsFrom(interiors, dir) {
    var renders = Object.assign({}, interiors.renders, {
      images: interiors.renders.images.map(function (im) {
        return /^(\/|[a-z]+:)/i.test(im.src) ? im : Object.assign({}, im, { src: dir + im.src });
      })
    });
    return Object.assign({}, interiors, { renders: renders });
  }

  function emit(type, payload) {
    (listeners[type] || []).slice().forEach(function (fn) { fn(payload); });
  }

  function on(type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
    return function () {
      listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; });
    };
  }

  function init(el) {
    mapEl = el;
    // ?map=off forces the placeholder, for testing the fallback
    var forced = /[?&]map=off\b/.test(global.location.search);
    if (!forced && global.CampusMap && global.CAMPUS_MAP_DATA && global.CAMPUS_INTERIORS) {
      try {
        var data = Object.assign({}, global.CAMPUS_MAP_DATA, { interiors: withDrawingsFrom(global.CAMPUS_INTERIORS, WEB_DIR) });
        map = global.CampusMap.mount(el, { data: data, tooltip: false });
        live = true;
        map.on("select", function (f) { emit("select", f); });
        map.on("viewchange", function (v) {
          if (v.rotation !== rotation) { rotation = v.rotation; emit("rotate", rotation); }
          emit("view", v);
        });
        rotation = map.get().rotation || 0;
        return { live: true };
      } catch (err) {
        console.warn("Campus map failed to mount, showing the placeholder instead.", err);
        map = null; live = false; el.innerHTML = "";
      }
    }
    drawPlaceholder(el);
    return { live: false };
  }

  /* Warm off white with a faint isometric grid and the words "Campus map". */
  function drawPlaceholder(el) {
    var wrap = document.createElement("div");
    wrap.className = "map-placeholder";
    wrap.innerHTML =
      '<svg aria-hidden="true" focusable="false">' +
        '<defs><pattern id="iso-grid" width="56" height="32.33" patternUnits="userSpaceOnUse">' +
          '<path d="M0 0L56 32.33M0 32.33L56 0M28 0V32.33" stroke="currentColor" stroke-width="1" fill="none"/>' +
        "</pattern></defs>" +
        '<rect width="100%" height="100%" fill="url(#iso-grid)"/>' +
      "</svg>" +
      '<span class="map-placeholder-label">Campus map</span>';
    el.appendChild(wrap);
  }

  function places() {
    if (!live) return MOCK_PLACES.map(function (p) { return Object.assign({}, p); });
    // rooms come from rooms(), which has every floor; features() only has the floor in view
    return map.features().filter(function (f) { return f.kind !== "room"; });
  }

  function rooms() {
    var IN = global.CAMPUS_INTERIORS;
    if (!live || !IN) return [];
    return (IN.rooms || []).map(function (r) {
      return { id: r.id, name: r.name, level: r.level, type: r.type, building: IN.building, approx: !!r.approx, centre: r.centre };
    });
  }

  function floorName(level) {
    var IN = global.CAMPUS_INTERIORS, f = IN && (IN.floors || []).filter(function (x) { return x.level === level; })[0];
    return f ? f.name : level ? "Floor " + level : "Ground floor";
  }

  /* North is ground (0, -1), with y growing south. The drawings are not
     drawn north up, and the map can be turned, so measure it on the map. */
  function northAngle() {
    if (!live) return 0;
    var b = bounds(); if (!b) return 0;
    var cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    var a = map.groundToScreen(cx, cy, 0), n = map.groundToScreen(cx, cy - 20, 0);
    return Math.atan2(n.x - a.x, -(n.y - a.y)) * 180 / Math.PI;
  }

  /* Campus extent in map metres, from the loaded data. */
  var boundsCache = null;
  function bounds() {
    if (boundsCache) return boundsCache;
    var d = global.CAMPUS_MAP_DATA;
    if (!d || !d.buildings) return null;
    var xs = [], ys = [];
    ["buildings", "areas", "roads", "paths", "elevated"].forEach(function (k) {
      (d[k] || []).forEach(function (f) {
        (f.points_m || []).forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
      });
    });
    boundsCache = { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
    return boundsCache;
  }

  /* The location dot is one of the map's own sprites: an HTML marker the map
     moves with every pan and zoom without repainting itself. */
  function showUser(pos) {
    if (!live) return;
    if (!pos) { map.removeSprite("me"); return; }
    map.setSprite("me", { x: pos.x, y: pos.y, level: pos.level || 0, color: USER_COLOUR });
  }

  /* Move the camera so `points` sit inside the best of `rects`, the parts of
     the map the site's panels leave free ({ left, top, right, bottom } in
     pixels of the map element). The best one shows them largest, without
     needing the camera to leave the campus (it is clamped to the drawing).
     scale: a fixed zoom instead of fitting. Returns false if none fits. */
  function placeInView(points, rects, scale) {
    if (!rects || !rects.length) return false;
    var box = mapEl.getBoundingClientRect();
    var W = box.width, H = box.height, z0 = map.get().zoom, opts = map.get(), M = 24;
    // the route, sampled along each stretch, in view units from the current centre
    var u = [];
    points.forEach(function (p, i) {
      var q = map.groundToScreen(p.x, p.y, p.level || 0), cur = [(q.x - W / 2) / z0, (q.y - H / 2) / z0];
      if (i && u.length) { var a = u[u.length - 1]; for (var k = 1; k < 8; k++) u.push([a[0] + (cur[0] - a[0]) * k / 8, a[1] + (cur[1] - a[1]) * k / 8]); }
      u.push(cur);
    });
    var xs = u.map(function (q) { return q[0]; }), ys = u.map(function (q) { return q[1]; });
    var ux0 = Math.min.apply(null, xs), ux1 = Math.max.apply(null, xs), uy0 = Math.min.apply(null, ys), uy1 = Math.max.apply(null, ys);
    var ucx = (ux0 + ux1) / 2, ucy = (uy0 + uy1) / 2;
    // the camera's centre may not leave the campus drawing: its frame, in the same units
    var img = mapEl.querySelector(".cm-img"), f = img ? img.getBoundingClientRect() : null;
    var fr = f && f.width ? { x0: (f.left - box.left - W / 2) / z0, x1: (f.right - box.left - W / 2) / z0, y0: (f.top - box.top - H / 2) / z0, y1: (f.bottom - box.top - H / 2) / z0 } : null;
    function inFree(x, y) {
      for (var i = 0; i < rects.length; i++) { var r = rects[i]; if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true; }
      return false;
    }
    // where to aim: each free part, or all of them together (the route may then cross the panel)
    var all = rects.reduce(function (a, r) { return { left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }; },
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
    var best = null;
    rects.concat([all]).forEach(function (r) {
      var bw = r.right - r.left - 2 * M, bh = r.bottom - r.top - 2 * M;
      if (bw < 60 || bh < 60) return;
      var zFit = scale || Math.min(bw / Math.max(ux1 - ux0, 1e-3), bh / Math.max(uy1 - uy0, 1e-3), 14);
      for (var z = Math.max(zFit, opts.minZoom), tries = 0; tries < 12 && z >= opts.minZoom; tries++, z *= 0.85) {
        var dx = ucx - ((r.left + r.right) / 2 - W / 2) / z, dy = ucy - ((r.top + r.bottom) / 2 - H / 2) / z;
        if (fr) { dx = Math.max(fr.x0, Math.min(fr.x1, dx)); dy = Math.max(fr.y0, Math.min(fr.y1, dy)); }   // as the map will clamp it
        var seen = 0;
        for (var i = 0; i < u.length; i++) if (inFree((u[i][0] - dx) * z + W / 2, (u[i][1] - dy) * z + H / 2)) seen++;
        var share = Math.round(seen / u.length * 50) / 50;     // what can be seen counts first, then size
        var score = share * 1000 + z;
        if (!best || score > best.score) best = { score: score, dx: dx, dy: dy, z: z };
        if (scale || share === 1) break;                       // zooming out further only makes it smaller
      }
    });
    if (!best) return false;
    var g = map.screenToGround(box.left + W / 2 + best.dx * z0, box.top + H / 2 + best.dy * z0, 0);
    map.animateTo({ ground: [g.x, g.y], z: 0.35, scale: best.z }, 550);
    return true;
  }

  /* p: { x, y, level }; rects as in placeInView, so the pin lands where it can be seen */
  function focusPoint(p, rects) {
    if (!live) return;
    if (!p) { map.clearOverlay("pin"); return; }
    map.setOverlay("pin", [{ type: "marker", kind: "dest", x: p.x, y: p.y, level: p.level || 0, color: WALK_COLOUR }]);
    var scale = Math.max(map.get().zoom, 9);
    if (!rects || !placeInView([p], rects, scale)) map.animateTo({ ground: [p.x, p.y], scale: scale }, 550);
  }

  /* rects: the parts of the map the card or panel leaves free, so the whole
     route lands where it can be seen. */
  function showRoute(points, rects) {
    if (!live) return 0;
    map.clearOverlay("pin");
    var len = map.drawRoute(points);
    if (!rects || !placeInView(points, rects)) map.fitTo(points, { pad: 40, maxZoom: 14 });
    return len;
  }

  function clearRoute() { if (live) map.clearRoute(); }

  /* A marker walks the route, like the pathfinder's demo: 8x walking pace,
     one animation frame loop, stopped by the returned function. onLevel(l)
     fires when the walk changes floor, so the host can show that floor. */
  var walking = null;
  function walk(route, onLevel, onDone) {
    stopWalk();
    if (!live || !route || !route.points || route.points.length < 2) return function () {};
    var pts = route.points, cum = route.cum, total = route.length, speed = 1.4 * 8;
    var t0 = null, i = 1, level = pts[0].level || 0, raf = 0;
    function frame(t) {
      if (t0 === null) t0 = t;
      var d = Math.min(total, (t - t0) / 1000 * speed);
      while (i < pts.length - 1 && cum[i] < d) i++;
      var a = pts[i - 1], b = pts[i], seg = (cum[i] - cum[i - 1]) || 1, k = Math.max(0, Math.min(1, (d - cum[i - 1]) / seg));
      var lv = k < 0.5 ? (a.level || 0) : (b.level || 0);
      if (lv !== level) { level = lv; if (onLevel) onLevel(level); }
      map.setSprite("walk", { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, level: lv, heading: Math.atan2(b.y - a.y, b.x - a.x), color: WALK_COLOUR });
      if (d >= total) { raf = 0; if (onDone) onDone(); return; }   // the marker stays at the destination until stopWalk()
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    walking = function () { if (raf) cancelAnimationFrame(raf); raf = 0; map.removeSprite("walk"); };
    return stopWalk;
  }
  function stopWalk() { if (walking) { var w = walking; walking = null; w(); } }

  global.MapAdapter = {
    init: init,
    isLive: function () { return live; },
    places: places,
    rooms: rooms,
    floorName: floorName,
    focus: function (name) { return live ? map.focus(name) : false; },
    focusPoint: focusPoint,
    highlight: function (name) { if (live) map.highlight(name || null); },
    setFloor: function (v) { if (live) map.set({ floor: v }); },
    floor: function () { return live ? map.get().floor : "all"; },
    fit: function () { if (live) map.fit(); },
    zoomBy: function (f) { if (live) map.zoomTo(map.get().zoom * f, { animate: true }); },
    faceNorth: function () { if (live) map.rotateTo(0, { animate: true }); },
    rotation: function () { return rotation; },
    northAngle: northAngle,
    bounds: bounds,
    origin: function () { var d = global.CAMPUS_MAP_DATA; return d && d.origin ? d.origin : null; },
    storeyHeight: function () { return live ? map.get().storeyHeight : 3.2; },
    showUser: showUser,
    showRoute: showRoute,
    clearRoute: clearRoute,
    walk: walk,
    stopWalk: stopWalk,
    on: on
  };
})(window);
