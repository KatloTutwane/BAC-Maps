/* Campus Pathfinder: the app. Uses only the public APIs of campus-map.js and nav-engine.js.
 * Sections: state · storage · nav model · overlays · camera · selection · player · routing ·
 *           minimap · challenge · editor · performance monitor · UI wiring
 * Static data (map, navigation model) is built once and only rebuilt when navigation data is
 * edited or the walking mode changes. Everything per-frame (marker, progress) is dynamic. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var INTERIORS = window.CAMPUS_INTERIORS || null;                       // rooms, doors and stairs of the main building
  var DATA = INTERIORS ? Object.assign({}, window.CAMPUS_MAP_DATA, { interiors: INTERIORS }) : window.CAMPUS_MAP_DATA;
  var SEED = window.CAMPUS_NAV_SEED || { links: [] };
  var STORE_KEY = "campus-navigator.nav-edits.v1";
  var EDIT_GROUPS = ["places", "links", "blocked", "walkable", "access"];
  var PLAYER_SPEED = 5, SPRINT = 2, DEMO_SPEED = 7;     // m/s on screen (times shown use real walking speed)
  var OFF_ROUTE = 5, ARRIVE = 1.8;

  if (!INTERIORS || !INTERIORS.renders) {          // the drawings are the only map; never fall back to the plain one
    $("map").innerHTML = '<p style="padding:24px;font:14px system-ui">The campus drawings did not load. Check that <code>interiors.js</code> and the <code>renders</code> folder are next to this page.</p>';
    throw new Error("Campus Pathfinder: interiors.js with its renders is required");
  }
  var FLOOR_Z = INTERIORS.renders.floor_height_m;
  function floorZ(l) { return FLOOR_Z[String(l || 0)] || 0; }       // where the drawing shows a floor, for camera targets
  var map = CampusMap.mount($("map"), { data: DATA, tooltip: "hover" });
  var S = {
    nav: null, edits: { places: [], links: [], blocked: [], walkable: [], access: [] }, strict: false, accessFor: null,
    player: { x: 0, y: 0, level: 0, heading: Math.PI / 2 },
    start: "me", dest: null,                       // dest: { place } or { x, y, level, name }
    route: null, routes: [], navigating: false, auto: false, progress: 0, cam: "iso", follow: false,
    keys: {}, reqId: 0, offSince: 0, offered: false, lastReplan: 0, tool: null, pending: [], arrived: false,
    challenge: null, scores: [], sel: null, perf: false, lastRouteMs: 0, pause: 0,
    fv: { floor: "all", hidden: [], focus: null }   // one shared floor view for map, list, route and controls; opens on the campus drawing (floor 1 rooms such as Lab 14 on top)
  };

  /* ================================================================ */
  /* storage                                                           */
  /* ================================================================ */
  function loadEdits() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) { var o = JSON.parse(raw); EDIT_GROUPS.forEach(function (k) { S.edits[k] = Array.isArray(o[k]) ? o[k] : []; }); }
      $("saveNote").textContent = "Edits are saved in this browser.";
    } catch (e) { $("saveNote").textContent = "This browser will not keep edits between visits. Use Export to keep them."; }
  }
  function saveEdits() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(S.edits)); } catch (e) { $("saveNote").textContent = "Could not save in this browser. Use Export to keep your edits."; }
  }

  /* ================================================================ */
  /* nav model (static; rebuilt only when navigation data or mode changes) */
  /* ================================================================ */
  function rebuild() {
    S.nav = CampusNav.build(DATA, S.edits, { openGround: !S.strict, seedLinks: SEED.links, storeyHeight: map.get().storeyHeight, interiors: INTERIORS });
    var st = S.nav.stats;
    $("navStats").textContent = st.cells.toLocaleString() + " ground cells, " + st.nodes + " graph nodes, built in " + st.buildMs + " ms" + (st.baseCached ? " (cached base)" : "") + " · " + S.nav.places.length + " destinations";
    $("warnings").textContent = S.nav.warnings.join(" · ");
    fillFrom(); renderList(); drawEditor(); drawGraph(); drawPlaces();
    if (!S.nav.walkable(S.player.x, S.player.y, S.player.level)) {
      var l = S.nav.locate(S.player.x, S.player.y, S.player.level)[0];
      if (l) { S.player.x = l.x; S.player.y = l.y; }
    }
  }
  function kindLabel(k) {
    var m = /^room(\d+)$/.exec(k); if (m) return "Rooms · " + S.nav.floorName(+m[1]);
    return { building: "Buildings", room: "Rooms", entrance: "Entrances", area: "Areas and parking", raised: "Raised areas", stairs: "Stairs", custom: "Added places" }[k] || k;
  }
  function groupOf(p) { return p.kind === "room" ? "room" + p.level : p.kind; }
  function kindOrder() { return ["building"].concat(S.nav.floors.map(function (f) { return "room" + f.level; }), ["entrance", "area", "raised", "stairs", "custom"]); }
  function searchPlaces(q) {
    var words = (q || "").toLowerCase().split(/\s+/).filter(Boolean);
    return S.nav.places.filter(function (p) {
      var hay = (p.name + " " + p.kind + " " + (p.subtype || "") + " " + (p.floorName || "") + " " + (p.kind === "room" ? "room floor" : "")).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  function fillFrom() {
    var sel = $("from"), keep = S.start;
    sel.innerHTML = "";
    var o = document.createElement("option"); o.value = "me"; o.textContent = "My marker (current position)"; sel.appendChild(o);
    kindOrder().forEach(function (k) {
      var list = S.nav.places.filter(function (p) { return groupOf(p) === k && p.reachable; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (!list.length) return;
      var g = document.createElement("optgroup"); g.label = kindLabel(k);
      list.forEach(function (p) { var op = document.createElement("option"); op.value = p.id; op.textContent = p.name; g.appendChild(op); });
      sel.appendChild(g);
    });
    sel.value = Array.prototype.some.call(sel.options, function (x) { return x.value === keep; }) ? keep : "me";
    S.start = sel.value;
  }
  /* one delegated click handler for the list, so re-rendering never stacks listeners */
  $("dlist").addEventListener("click", function (e) { var b = e.target.closest("button[data-id]"); if (b) { chooseDest({ place: b.dataset.id }); closeCard(); } });
  function renderList() {
    if (!S.nav) return;                             // routes are still being prepared
    var q = $("q").value, list = searchPlaces(q), box = $("dlist"), frag = document.createDocumentFragment();
    box.innerHTML = "";
    if (!list.length) { box.innerHTML = '<div class="grp">No place matches “' + escapeHtml(q) + '”</div>'; return; }
    kindOrder().forEach(function (k) {
      var items = list.filter(function (p) { return groupOf(p) === k; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (!items.length) return;
      var h = document.createElement("div"); h.className = "grp"; h.textContent = kindLabel(k); frag.appendChild(h);
      items.forEach(function (p) {
        var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "option");
        b.className = p.reachable ? "" : "off"; b.dataset.id = p.id;
        b.setAttribute("aria-selected", S.dest && S.dest.place === p.id ? "true" : "false");
        b.innerHTML = "<span></span><small></small>";
        b.firstChild.textContent = p.name; b.lastChild.textContent = p.reachable ? p.info : (p.kind === "room" ? "no door on the map yet · " : "no entrance on the map yet · ") + p.info;
        frag.appendChild(b);
      });
    });
    box.appendChild(frag);
  }

  /* ================================================================ */
  /* overlays (route visuals live here, never in the map geometry)     */
  /* ================================================================ */
  ["graph", "places", "editor", "route-alt", "route-done", "route", "arrows", "checks", "ends", "sel"].forEach(function (id) { map.setOverlay(id, []); });
  var COL = { route: "#c2185b", alt: "#7a7f87", done: "#8a8f96", me: "#1769e0", start: "#2e7d32", dest: "#c2185b", door: "#ef6c00", stairs: "#c8912a", custom: "#7b1fa2", sel: "#1769e0" };

  function pointAt(route, d) {
    var cum = route.cum, pts = route.points, n = pts.length;
    if (d <= 0) return { x: pts[0].x, y: pts[0].y, level: pts[0].level, seg: 1, h: segHeading(route, 1) };
    if (d >= cum[n - 1]) return { x: pts[n - 1].x, y: pts[n - 1].y, level: pts[n - 1].level, seg: n - 1, h: segHeading(route, n - 1) };
    var lo = 1, hi = n - 1;
    while (lo < hi) { var m = (lo + hi) >> 1; if (cum[m] < d) lo = m + 1; else hi = m; }
    var a = pts[lo - 1], b = pts[lo], t = (d - cum[lo - 1]) / ((cum[lo] - cum[lo - 1]) || 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, level: a.level !== b.level ? (t < 0.5 ? a.level : b.level) : a.level, seg: lo, h: segHeading(route, lo) };
  }
  function segHeading(route, i) {
    for (var k = i; k < route.points.length; k++) {
      var a = route.points[k - 1], b = route.points[k];
      if (a && b && a.level === b.level && Math.hypot(b.x - a.x, b.y - a.y) > 0.05) return Math.atan2(b.y - a.y, b.x - a.x);
    }
    return S.player.heading;
  }
  function pts2(list) { return list.map(function (p) { return { x: p.x, y: p.y, level: p.level }; }); }
  function routeHidden() { return S.challenge && !S.challenge.hint; }

  var lastRouteDraw = -1;
  function drawRoute(force) {
    if (!S.route || routeHidden()) {
      ["route", "route-done", "route-alt", "arrows", "checks", "ends"].forEach(function (id) { map.setOverlay(id, []); });
      lastRouteDraw = -1; return;
    }
    var r = S.route, pr = S.navigating ? S.progress : 0;
    if (!force && Math.abs(pr - lastRouteDraw) < 1.5) return;        // repaint the route at most every 1.5 m walked
    lastRouteDraw = pr;
    var cut = pointAt(r, pr), todo = [{ x: cut.x, y: cut.y, level: cut.level }], done = [];
    for (var i = 0; i < r.points.length; i++) { if (r.cum[i] > pr + 1e-6) todo.push(r.points[i]); else done.push(r.points[i]); }
    done.push({ x: cut.x, y: cut.y, level: cut.level });
    // while walking only the split point moves: redraw what depends on progress, nothing else
    map.setOverlay("route-done", S.navigating && done.length > 1 ? [{ type: "polyline", points: pts2(done), color: COL.done, width: 3, halo: "#ffffff" }] : []);
    map.setOverlay("route", [{ type: "polyline", points: pts2(todo), color: COL.route, width: 3.5, halo: "#ffffff" }]);
    var arrows = [];
    for (var d = Math.ceil(pr / 10) * 10 + 5; d < r.cum[r.cum.length - 1] - 3; d += 10) {
      var p = pointAt(r, d), q = r.points[p.seg - 1], q2 = r.points[p.seg];
      if (q && q2 && q.level !== q2.level) continue;
      arrows.push({ type: "marker", kind: "arrow", x: p.x, y: p.y, level: p.level, heading: p.h, color: COL.route });
    }
    map.setOverlay("arrows", arrows);
    var checks = r.steps.filter(function (st, k) { return !st.final && k > 0; }).map(function (st) { return S.navigating && st.at <= pr ? 1 : 0; }).join("");
    if (force || checks !== lastChecks) {
      lastChecks = checks;
      map.setOverlay("checks", r.steps.filter(function (st, k) { return !st.final && k > 0; }).map(function (st) {
        var p = r.points[st.index]; return { type: "marker", kind: "check", x: p.x, y: p.y, level: p.level, color: COL.route, done: S.navigating && st.at <= pr };
      }).concat((r.transitions || []).reduce(function (a, tr) {        // where to change floor, labelled on both floors
        var word = tr.to > tr.from ? "↑ " : "↓ ";
        a.push({ type: "marker", kind: "diamond", x: tr.x, y: tr.y, level: tr.from, size: 5.5, color: COL.stairs, label: word + S.nav.floorName(tr.to), labelDy: 12 });
        a.push({ type: "marker", kind: "diamond", x: tr.x, y: tr.y, level: tr.to, size: 5.5, color: COL.stairs, label: "from " + S.nav.floorName(tr.from), labelDy: 12 });
        return a;
      }, [])));
    }
    if (!force) return;
    map.setOverlay("route-alt", S.navigating ? [] : S.routes.filter(function (x) { return x !== r; }).map(function (x) { return { type: "polyline", points: pts2(x.points), color: COL.alt, width: 3, dash: "6 6", opacity: .7 }; }));
    floorHint();
    var f = r.points[0], l = r.points[r.points.length - 1];
    map.setOverlay("ends", [
      { type: "marker", kind: "start", x: f.x, y: f.y, level: f.level, color: COL.start, label: r.from === "My marker" ? "" : "Start", labelDy: 12 },
      { type: "marker", kind: "dest", x: l.x, y: l.y, level: l.level, color: COL.dest, label: r.to, labelDy: 14 }
    ]);
  }
  var lastChecks = "";
  function drawPlayer() {
    var p = S.player; lastStair = null;
    map.setSprite("me", { x: p.x, y: p.y, level: p.level, heading: p.heading, color: COL.me });   // HTML layer: moving it never repaints the map
  }
  function drawPlaces() {       // entrances, stairs and added places: things on the map you can tap
    map.setOverlay("places", S.nav.places.filter(function (p) { return p.kind === "entrance" || p.kind === "stairs" || p.kind === "custom"; }).map(function (p) {
      return { type: "marker", kind: "diamond", x: p.x, y: p.y, level: p.level, size: 3, opacity: .75, color: p.kind === "entrance" ? COL.door : p.kind === "stairs" ? COL.stairs : COL.custom, label: p.kind === "custom" ? p.name : "" };
    }));
  }
  function drawGraph() {
    if (!$("showGraph").checked) { map.setOverlay("graph", []); return; }
    var items = [];
    if (INTERIORS) {
      Object.keys(INTERIORS.unassigned || {}).forEach(function (l) { (INTERIORS.unassigned[l] || []).forEach(function (u) { items.push({ type: "polygon", points: u.map(function (q) { return { x: q[0], y: q[1] }; }), level: +l, color: "#d32f2f", opacity: .35 }); }); });
      S.nav.plates.forEach(function (pl) { if (pl.room) items.push({ type: "polygon", points: pl.ring.map(function (q) { return { x: q[0], y: q[1] }; }), level: pl.level, color: "#2e7d32", opacity: .12, stroke: "#2e7d32" }); });
    }
    S.nav.ways.forEach(function (w) { items.push({ type: "polyline", points: [{ x: w.ax, y: w.ay, level: w.level }, { x: w.bx, y: w.by, level: w.level }], color: w.level ? "#7b1fa2" : "#00897b", width: 2, opacity: .85 }); });
    S.nav.doors.forEach(function (d) { items.push({ type: "marker", kind: "diamond", x: d.x, y: d.y, level: 0, color: "#ef6c00", size: 5 }); });
    (INTERIORS ? INTERIORS.rooms : []).forEach(function (r) { if (r.door) items.push({ type: "marker", kind: "dot", x: r.door[0], y: r.door[1], level: r.level, color: "#ef6c00", size: 3 }); });
    (INTERIORS ? INTERIORS.not_connected : []).forEach(function (n) { items.push({ type: "marker", kind: "diamond", x: n.at[0], y: n.at[1], level: 1, color: "#d32f2f", size: 7, label: "unconfirmed: " + n.name }); });
    DATA.paths.forEach(function (p) {                                   // walks measured on site: the router prefers these
      if (p.verified) items.push({ type: "polyline", points: p.points_m.map(function (q) { return { x: q[0], y: q[1], level: 0 }; }), color: "#1565c0", width: 3, dash: "8 5", opacity: .9 });
    });
    var c = S.nav.connectivity();                                       // anything the network cannot reach, in red
    c.disconnected.forEach(function (p) { items.push({ type: "marker", kind: "dot", x: p.x, y: p.y, level: p.level, color: "#d32f2f", size: 6, label: "not connected: " + p.name }); });
    c.stranded.forEach(function (n) { items.push({ type: "marker", kind: "dot", x: n.x, y: n.y, level: n.level, color: "#d32f2f", size: 4 }); });
    map.setOverlay("graph", items);
  }
  function connectivityReport() {
    var c = S.nav.connectivity(), lines = [];
    lines.push(c.networkPlaces + " of " + S.nav.places.length + " destinations are joined in one walkable network" + (S.strict ? " (traced surfaces only)." : "."));
    if (c.noEntrance.length) lines.push("No entrance yet (" + c.noEntrance.length + "): " + c.noEntrance.map(function (p) { return p.name; }).join(", ") + ".");
    if (c.disconnected.length) lines.push("Has an entrance but cannot be reached (" + c.disconnected.length + "): " + c.disconnected.map(function (p) { return p.name; }).join(", ") + ". Join it with Add link, or mark a Walkable area.");
    if (c.stranded.length) lines.push(c.stranded.length + " graph point" + (c.stranded.length > 1 ? "s are" : " is") + " cut off from the network (red dots in Diagnostics).");
    if (!c.noEntrance.length && !c.disconnected.length && !c.stranded.length) lines.push("Everything is connected.");
    return { ok: !c.disconnected.length && !c.stranded.length, text: lines.join(" ") };
  }

  /* ================================================================ */
  /* camera                                                            */
  /* ================================================================ */
  /* The drawings have one fixed viewpoint: the map can be panned, zoomed and turned flat on the
     screen (like a paper map), never tilted. Third-person turns it so the marker walks "up". */
  function setCam(mode, quiet) {
    S.cam = mode; $("camView").value = mode;
    var P = S.player, z = map.get().zoom;
    S.follow = mode === "follow" || mode === "third";
    if (mode === "follow") map.animateTo({ ground: [P.x, P.y], z: floorZ(P.level), scale: Math.max(z, 9) }, 500);
    else if (mode === "third") map.animateTo({ ground: [P.x, P.y], z: floorZ(P.level), scale: Math.max(z, 13) }, 600);
    if (!quiet) toast({ iso: "3D view", follow: "Following your marker", third: "Third-person: W/S walk, A/D turn" }[mode]);
  }
  function resetView() {
    S.follow = false; S.cam = "iso"; $("camView").value = "iso";
    if (map.get().rotation) map.animateTo({ rotation: 0, done: function () { map.fit(); } }, 350); else map.fit();
  }
  function turn(by) { if (S.cam === "third") setCam("follow", true); map.rotateTo(map.get().rotation + by, { animate: true }); }
  var needleAt = null;
  function updateNeedle() {                       // the needle points north, whatever the map's angle
    var rot = map.get().rotation; if (rot === needleAt) return; needleAt = rot;
    var a = map.groundToScreen(70, 70, 0), b = map.groundToScreen(70, 60, 0);
    $("needle").style.transform = "rotate(" + (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90).toFixed(0) + "deg)";
    $("bNorth").setAttribute("aria-pressed", String(!!Math.round(rot)));
  }
  updateNeedle();
  map.on("viewchange", function (v) { if (v && v.rotation !== needleAt) updateNeedle(); });

  /* ================================================================ */
  /* selection: tap anything, get its details and actions              */
  /* ================================================================ */
  function ripple(e) {
    var r = $("stage").getBoundingClientRect(), el = $("ripple");
    el.hidden = true; el.style.left = (e.clientX - r.left) + "px"; el.style.top = (e.clientY - r.top) + "px";
    void el.offsetWidth; el.hidden = false;
  }
  function markerAt(clientX, clientY) {      // entrances, stairs, added places within 18 px of the tap
    var r = $("map").getBoundingClientRect(), best = null, bd = 18, floor = map.get().floor;
    S.nav.places.forEach(function (p) {
      if (p.kind !== "entrance" && p.kind !== "stairs" && p.kind !== "custom") return;
      if (floor !== "all" && +floor !== p.level) return;
      var s = map.groundToScreen(p.x, p.y, p.level), d = Math.hypot(s.x - (clientX - r.left), s.y - (clientY - r.top));
      if (d < bd) { bd = d; best = p; }
    });
    return best;
  }
  map.on("tap", function (e) {
    if (!S.nav) return;
    ripple(e);
    if (S.tool) { editorTap(e); return; }
    var pm = markerAt(e.clientX, e.clientY);
    if (pm) { setTimeout(function () { map.highlight(null); }, 0); openCard({ kind: "place", place: pm }); return; }
    var f = e.feature;
    if (f && f.kind === "room") {                                       // a room in the inside view: same record as in the list and the graph
      var rp = S.nav.place("room:" + f.roomId);
      if (rp) { openCard({ kind: "room", place: rp, feature: f }); return; }
    }
    if (f && (f.kind === "building" || f.kind === "raised_area" || f.name)) {
      var pl = S.nav.places.filter(function (p) { return p.featureName === f.name && (p.kind === "building" || p.kind === "raised" || p.kind === "area"); })[0];
      if (pl && (pl.kind === "building" || pl.kind === "raised")) {
        openCard({ kind: "feature", place: pl, feature: f });
        if (!S.follow && !S.navigating) map.focus(f.name);          // fly to the building
        return;
      }
      if (pl && pl.kind === "area") { openCard({ kind: "point", x: e.x, y: e.y, level: e.level, name: f.name, place: pl }); return; }
    }
    openCard({ kind: "point", x: e.x, y: e.y, level: e.level, name: "Selected point" });
  });
  function openCard(sel) {
    S.sel = sel;
    var name, info, can = true, orbit = false;
    if (sel.kind === "point") {
      var ok = S.nav.locate(sel.x, sel.y, sel.level).length > 0;
      name = sel.name === "Selected point" ? "Selected point" : sel.name; can = ok;
      info = (ok ? (sel.place ? sel.place.info + " · " : "") + "on a walkable surface" : "Not walkable: pick a path, road, car park or open ground") + (sel.level ? " · floor " + sel.level : "");
      map.setOverlay("sel", ok ? [{ type: "marker", kind: "dot", x: sel.x, y: sel.y, level: sel.level, size: 4.5, color: COL.sel }] : []);
    } else {
      var p = sel.place; name = p.name; can = p.reachable; orbit = sel.kind === "feature" || sel.kind === "room" || sel.kind === "place";
      info = p.info + (p.reachable ? "" : " · no entrance on the map yet");
      if (p.kind === "building" && p.anchors.length > 1) info += " · " + p.anchors.length + " entrances";
      if (p.autoDoor) info += " · entrance position estimated";
      map.setOverlay("sel", sel.kind === "place" ? [{ type: "marker", kind: "diamond", x: p.x, y: p.y, level: p.level, size: 6, color: COL.sel, label: p.name, labelDy: 12 }] : []);
    }
    $("cardName").textContent = name; $("cardInfo").textContent = info;
    $("cardGo").disabled = !can; $("cardStart").disabled = !can; $("cardOrbit").hidden = !orbit;
    var hasInside = INTERIORS && sel.feature && sel.feature.name === INTERIORS.building;
    $("cardOrbit").textContent = sel.kind === "room" || (sel.kind === "place" && sel.place.level) ? "Show floor" : hasInside ? "See inside" : "Zoom in";
    if (sel.kind === "place" && !sel.place.level && !hasInside) $("cardOrbit").hidden = true;
    $("card").hidden = false;
  }
  function closeCard() { S.sel = null; $("card").hidden = true; map.setOverlay("sel", []); map.highlight(null); }
  function selSpec() {
    var s = S.sel; if (!s) return null;
    return s.kind === "point" ? { x: s.x, y: s.y, level: s.level, name: s.name === "Selected point" ? "Selected point" : s.name + " (point)" } : { place: s.place.id };
  }
  $("cardGo").addEventListener("click", function () { var sp = selSpec(); if (sp) { chooseDest(sp); closeCard(); } });
  $("cardStart").addEventListener("click", function () {
    var s = S.sel; if (!s) return;
    if (s.kind === "point") {
      var l = S.nav.locate(s.x, s.y, s.level)[0]; if (!l) return;
      S.player.x = l.x; S.player.y = l.y; S.player.level = s.level; drawPlayer(); S.start = "me"; $("from").value = "me";
      toast("Your marker is now here");
    } else { S.start = s.place.id; $("from").value = s.place.id; toast("Start: " + s.place.name); }
    closeCard(); if (S.dest) computeRoute(true);
  });
  $("cardOrbit").addEventListener("click", function () {
    var sl = S.sel; if (!sl) return;
    var t = $("cardOrbit").textContent;
    if (t === "Show floor") { showFloor(sl.place.level); map.animateTo({ ground: [sl.place.x, sl.place.y], z: floorZ(sl.place.level), scale: Math.max(map.get().zoom, 9) }, 500); return; }
    if (t === "See inside") { setFloorView({ floor: 0, hidden: [], focus: null }); toast("Ground floor, cutaway drawing"); return; }
    if (sl.feature) { setCam("iso", true); map.focus(sl.feature.name, { zoom: Math.max(map.get().zoom, 12) }); }
  });
  $("cardClose").addEventListener("click", closeCard);

  /* ================================================================ */
  /* player                                                            */
  /* ================================================================ */
  var keyDirs = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  function inField(e) { var t = e.target && e.target.tagName; return t === "INPUT" || t === "SELECT" || t === "TEXTAREA"; }
  window.addEventListener("keydown", function (e) {
    if (inField(e) && e.key !== "Escape") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (keyDirs[k]) { S.keys[k] = true; if (S.auto) stopAuto(true); e.preventDefault(); }
    else if (k === "shift") S.keys.shift = true;
    else if (k === "e") useStairs();
    else if (k === "f") setCam(S.cam === "follow" ? "iso" : "follow");
    else if (k === "r") resetView();
    else if (k === "`") togglePerf();
    else if (k === "i") setFloorView(S.fv.floor === 0 ? { floor: "all", hidden: [], focus: null } : { floor: 0, hidden: [], focus: null });   // ground-floor cutaway and back
    else if (e.key === "PageUp" || e.key === "PageDown") {
      var lv = S.nav.floors.map(function (f) { return f.level; }), cur = S.fv.floor !== "all" ? S.fv.floor : S.fv.focus != null ? S.fv.focus : S.player.level;
      var nx = lv[Math.max(0, Math.min(lv.length - 1, lv.indexOf(cur) + (e.key === "PageUp" ? 1 : -1)))];
      setFloorView(S.fv.floor !== "all" ? { floor: nx } : { focus: nx }); e.preventDefault();
    }
    else if (e.key === "Escape") escape();
  });
  window.addEventListener("keyup", function (e) { var k = e.key.toLowerCase(); if (keyDirs[k] || k === "shift") S.keys[k] = false; });
  window.addEventListener("blur", function () { S.keys = {}; });
  Array.prototype.forEach.call(document.querySelectorAll("#dpad button"), function (b) {
    var k = b.dataset.k;
    if (k === "e") { b.addEventListener("click", useStairs); return; }
    function on(ev) { S.keys[k] = true; if (S.auto) stopAuto(true); ev.preventDefault(); }
    function off() { S.keys[k] = false; }
    b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
  });

  function stairOpts() { return S.nav.nearestStair(S.player.x, S.player.y, S.player.level, 2.2); }
  function useStairs() {
    if (!S.nav) return;
    var s = stairOpts(); if (!s) { toast("No stairs within reach"); return; }
    var to = s.up != null ? s.up : s.down; if (to == null) return;
    var word = to > S.player.level ? "up" : "down", at = s.pos && s.pos[to];
    if (at) { S.player.x = at.x; S.player.y = at.y; }
    S.player.level = to; drawPlayer(); toast("Taking the stairs " + word + " to the " + S.nav.floorName(to));
    followFloor(to);
  }
  function stopAuto(handOver) { S.auto = false; $("demo").textContent = "Auto-walk demo"; updateMode(); if (handOver) toast("Auto-walk stopped. You have control."); }

  var lastT = 0, lastMini = 0, lastWhere = 0, lastStair = null, lastInfo = 0, fps = { frames: 0, since: 0, value: 0, worst: 0, sum: 0 };
  function frame(t) {
    var dt = Math.min(0.05, (t - (lastT || t)) / 1000), raw = t - (lastT || t); lastT = t;
    fps.frames++; fps.sum += raw; fps.worst = Math.max(fps.worst, raw);
    var moved = false, P = S.player;
    if (S.auto && S.route) moved = stepAuto(dt);
    else {
      var dx = (S.keys.d ? 1 : 0) - (S.keys.a ? 1 : 0), dy = (S.keys.s ? 1 : 0) - (S.keys.w ? 1 : 0), g = null;
      if (S.cam === "third") {                        // third-person: A/D turn, W/S walk forward and back
        if (dx) { P.heading += dx * 2.4 * dt; moved = true; }
        if (dy) g = [Math.cos(P.heading) * -dy, Math.sin(P.heading) * -dy];
      } else if (dx || dy) g = map.screenDirToGround(dx, dy, P);
      if (g) {
        var step = PLAYER_SPEED * (S.keys.shift ? SPRINT : 1) * dt, n = Math.max(1, Math.ceil(step / 0.2)), ok = false;
        for (var i = 0; i < n; i++) {
          var r = S.nav.move(P.x, P.y, P.level, g[0] * step / n, g[1] * step / n);
          if (r.moved) { P.x = r.x; P.y = r.y; ok = true; }
        }
        if (ok) { if (S.cam !== "third") P.heading = Math.atan2(g[1], g[0]); moved = true; }
      }
    }
    if (moved) drawPlayer();
    if (S.navigating && !S.auto) track(t);
    if (S.follow && !map.stats().animating) {
      if (S.cam === "third") {                          // turn the map so the marker faces up the screen
        var a = map.groundToScreen(P.x, P.y, P.level), b = map.groundToScreen(P.x + Math.cos(P.heading), P.y + Math.sin(P.heading), P.level);
        var off = ((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + 90) % 360 + 540) % 360 - 180;
        if (Math.abs(off) > 0.5) map.rotateTo(map.get().rotation - off * 0.2);
      }
      map.centerOn(P.x, P.y, P.level, { lerp: S.cam === "third" ? 0.3 : 0.15 });
    }
    if (moved || lastStair === null) {                // the stairs prompt only changes when the marker moves
      var sp = S.auto ? null : stairOpts(), txt = sp ? "Press E for the stairs " + (sp.up != null ? "up to floor " + sp.up : "down to floor " + sp.down) : "";
      if (txt !== lastStair) { lastStair = txt; $("stairPrompt").hidden = !txt; $("stairPrompt").textContent = txt; }
    }
    if (S.challenge) checkChallenge();
    if (moved && t - lastWhere > 500) { lastWhere = t; updateWhere(); }
    if ((moved && t - lastMini > 100) || t - lastMini > 500) { drawMini(); lastMini = t; }
    if (S.perf && t - fps.since > 500) updatePerf(t);
    requestAnimationFrame(frame);
  }
  function updateWhere() {
    var P = S.player, best = null, bd = 30;
    S.nav.places.forEach(function (p) { if (p.kind === "stairs") return; var d = Math.hypot(p.x - P.x, p.y - P.y); if (d < bd && (p.level || 0) === P.level) { bd = d; best = p; } });
    var b = S.nav.buildingAt(P.x, P.y);
    $("whereNow").textContent = "You are " + (b ? "inside " + b.name : best ? "near " + best.name : "on campus") + " · " + S.nav.floorName(P.level);
  }

  /* ================================================================ */
  /* routing and guidance                                              */
  /* ================================================================ */
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m"; }
  function fmtTime(s) { s = Math.max(0, Math.round(s)); return s < 60 ? s + " s" : Math.floor(s / 60) + " min" + (s % 60 ? " " + (s % 60) + " s" : ""); }
  function say(text, cls) { var m = $("msg"); m.textContent = text || ""; m.className = cls || ""; }
  var lastStatus = null;
  function setStatus(html) { if (html !== lastStatus) { lastStatus = html; $("status").innerHTML = html; } }

  function destName() { return !S.dest ? "" : S.dest.place ? S.nav.place(S.dest.place).name : S.dest.name; }
  function chooseDest(spec) {
    if (!S.nav) return;
    S.dest = spec; S.arrived = false;
    var chip = $("destChip"); chip.hidden = false;
    chip.innerHTML = "<span>To: <b></b></span><button type='button' class='btn small' style='padding:0 6px' aria-label='Remove destination'>×</button>";
    chip.querySelector("b").textContent = destName();
    chip.querySelector("button").onclick = clearAll;           // property, not addEventListener: one handler, never stacked
    renderList(); computeRoute(true);
    if (spec.place) { var dp = S.nav.place(spec.place); if (dp && dp.kind === "room" && !floorShown(dp.level)) { showFloor(dp.level); toast(dp.name + " is on the " + dp.floorName); } }
  }
  function fromSpec() {
    if (S.start === "me") return { x: S.player.x, y: S.player.y, level: S.player.level, name: "My marker" };
    return { place: S.start };
  }
  function busy(on) { $("find").classList.toggle("busy", on); $("find").setAttribute("aria-busy", String(on)); }
  function computeRoute(frameIt, keepNav) {
    if (!S.dest) { say("Choose a destination first: search the list or tap the map.", "bad"); return Promise.resolve(); }
    var id = ++S.reqId, t0 = performance.now(); say(""); setStatus("Calculating route…"); busy(true);
    return S.nav.findRoutesAsync(fromSpec(), S.dest, { alternatives: keepNav ? 0 : 1, cancelled: function () { return id !== S.reqId; } }).then(function (o) {
      if (id !== S.reqId || o.cancelled) return;                     // a newer request replaced this one (and its search stopped)
      busy(false); S.lastRouteMs = performance.now() - t0;
      if (!o.found) {
        S.route = null; S.routes = []; if (!keepNav) S.navigating = false; drawRoute(true); updateInfo(); renderOpts();
        say("No route: " + o.reason, "bad"); setStatus("<b>No valid route.</b> " + escapeHtml(o.reason));
        $("startNav").disabled = true; $("demo").disabled = true; return;
      }
      S.routes = o.routes; setRoute(o.routes[0], keepNav);
      if (!keepNav && frameIt && !S.follow) map.fitTo(pts2(S.route.points), { pad: 50, padTop: 90, padBottom: 130, maxZoom: 12 });
    });
  }
  function setRoute(r, keepNav) {
    S.route = r; S.progress = 0; S.arrived = false; S.offered = false; $("offRoute").hidden = true; lastRouteDraw = -1;
    drawRoute(true); updateInfo(); renderOpts(); drawMini(); renderFloors();
    $("startNav").disabled = false; $("demo").disabled = false;
    say("Route found: " + fmtDist(r.length) + ", about " + fmtTime(r.time) + " on foot." + (S.routes.length > 1 ? " Another option is shown dashed." : ""), "ok");
    if (!keepNav) setStatus("Route ready. Press <b>Start navigation</b>, or walk with WASD.");
  }
  function renderOpts() {
    var box = $("routeOpts"); box.innerHTML = "";
    if (S.routes.length < 2 || S.navigating) { box.hidden = true; return; }
    box.hidden = false;
    S.routes.forEach(function (r, i) {
      var b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-pressed", String(r === S.route));
      var diff = r.length - S.routes[0].length, open = Math.round(r.openShare * 100);
      b.innerHTML = "<b></b><small></small>";
      b.firstChild.textContent = (i === 0 ? "Recommended" : "Alternative") + " · " + fmtDist(r.length);
      b.lastChild.textContent = fmtTime(r.time) + (i ? (diff >= 0 ? " · +" : " · ") + Math.round(diff) + " m" : "") + " · " + (open ? open + "% untraced ground" : "traced paths only");
      b.onclick = function () { setRoute(r); };
      box.appendChild(b);
    });
  }
  function startNavigation() {
    if (!S.route) return;
    closeCard();
    var r = S.route, f = r.points[0], P = S.player;
    if (Math.hypot(P.x - f.x, P.y - f.y) > 3 || P.level !== f.level) { P.x = f.x; P.y = f.y; P.level = f.level; toast("Marker placed at the start: " + r.from); }
    P.heading = segHeading(r, 1); S.navigating = true; S.progress = 0; S.arrived = false; S.offSince = 0; S.offered = false; lastRouteDraw = -1;
    S.routes = [r]; renderOpts();
    drawPlayer(); drawRoute(true); updateInfo(); updateMode();
    if (!S.follow) setCam("follow", true);
  }
  function stopNavigation(msg) {
    S.navigating = false; S.auto = false; $("demo").textContent = "Auto-walk demo"; $("offRoute").hidden = true;
    lastRouteDraw = -1; drawRoute(true); updateInfo(); updateMode();
    if (msg) { setStatus(msg); toast("Exploring freely"); }
    if (PHONE.matches) setSheet(true);
  }
  function updateMode() {
    if (!S.auto) S.paused = false;
    $("modeBar").hidden = !S.navigating;
    $("pauseNav").hidden = !S.auto; $("pauseNav").textContent = S.paused ? "Resume" : "Pause";
    if (S.navigating) $("modeText").textContent = (S.auto ? (S.paused ? "Demo paused: " : "Demo: ") : "Navigating to ") + (S.route ? S.route.to : "");
  }
  function project(r, x, y, level, lo, hi) {
    var best = null;
    for (var i = 1; i < r.points.length; i++) {
      var a = r.points[i - 1], b = r.points[i]; if (a.level !== b.level || a.level !== level) continue;
      if (r.cum[i] < lo || r.cum[i - 1] > hi) continue;
      var dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2)) : 0;
      var d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
      if (!best || d < best.d) best = { d: d, prog: r.cum[i - 1] + t * (r.cum[i] - r.cum[i - 1]) };
    }
    return best;
  }
  var lastTrack = 0;
  function track(t) {
    var r = S.route, P = S.player; if (!r) return;
    var b = project(r, P.x, P.y, P.level, S.progress - 10, S.progress + 30);
    if (!b || b.d > OFF_ROUTE) b = project(r, P.x, P.y, P.level, -1, 1e9) || b;
    var off = !b || b.d > OFF_ROUTE;
    if (b && !off) S.progress = b.prog;
    if (off) {
      if (!S.offSince) S.offSince = t;
      if (t - S.offSince > 800) {
        if ($("autoReroute").checked) { if (t - S.lastReplan > 2500) replan(); }
        else if (!S.offered) { S.offered = true; $("offRoute").hidden = false; }          // offer, don't impose
      }
    } else { S.offSince = 0; if (S.offered) { S.offered = false; $("offRoute").hidden = true; } }
    var f = r.points[r.points.length - 1];
    // arrival means the marker is physically at the destination, never just "far along the route"
    if (S.navigating && P.level === f.level && Math.hypot(P.x - f.x, P.y - f.y) <= ARRIVE + 0.7) { arrive(); return; }
    progressUI(t);
  }
  function replan() {
    S.lastReplan = performance.now(); S.offSince = 0; S.offered = false; $("offRoute").hidden = true;
    toast("Recalculating from where you are…");
    var keepStart = S.start; S.start = "me";
    computeRoute(false, true).then(function () { S.start = keepStart; if (S.route && S.navigating) { S.progress = 0; S.player.heading = segHeading(S.route, 1); } });
  }
  function progressUI(t) {                            // the route line every 90 ms (it skips itself under 1.5 m), the text panel every 250 ms
    if (t - lastTrack > 90) { lastTrack = t; drawRoute(false); }
    if (t - lastInfo > 250) { lastInfo = t; updateInfo(); }
  }
  function stepAuto(dt) {
    var r = S.route, P = S.player; if (!S.navigating) startNavigation();
    if (S.paused) return false;
    if (S.pause > 0) { S.pause -= dt; return false; }
    var before = S.progress, next = Math.min(r.length, S.progress + DEMO_SPEED * dt);
    for (var i = 1; i < r.points.length; i++) if (r.points[i - 1].level !== r.points[i].level && r.cum[i - 1] >= S.progress - 1e-6 && r.cum[i - 1] < next) { next = r.cum[i - 1]; S.pause = 0.5; break; }
    S.progress = next;
    var p = pointAt(r, S.progress);
    P.x = p.x; P.y = p.y; P.heading = p.h;
    if (p.level !== P.level) { toast("Taking the stairs " + (p.level > P.level ? "up" : "down") + " to the " + S.nav.floorName(p.level)); P.level = p.level; followFloor(P.level); }
    for (var j = 1; j < r.points.length; j++) if (r.points[j - 1].level !== r.points[j].level && Math.abs(r.cum[j - 1] - S.progress) < 1e-6) { S.progress = r.cum[j]; P.level = r.points[j].level; followFloor(P.level); }
    progressUI(performance.now());
    if (r.length - S.progress <= 0.2) arrive();
    return S.progress !== before;
  }
  function arrive() {
    if (S.arrived) return; S.arrived = true; S.navigating = false; S.auto = false; $("demo").textContent = "Auto-walk demo"; $("offRoute").hidden = true;
    S.progress = S.route.length; updateInfo(); updateMode(); lastRouteDraw = -1; drawRoute(true);
    toast("You have arrived at " + destName(), "arrive", 4200);
    setStatus("<b>Arrived</b> at " + escapeHtml(destName()) + ".");
    $("startNav").disabled = true;
  }
  function updateInfo() {
    var r = S.route;
    if (!r) { $("navTitle").textContent = S.dest ? "To " + destName() : "No route yet"; $("remain").textContent = $("eta").textContent = $("total").textContent = "–"; $("prog").value = 0; $("steps").innerHTML = ""; $("steps").dataset.sig = ""; return; }
    var pr = S.navigating || S.arrived ? S.progress : 0, rem = Math.max(0, r.length - pr), stairsAhead = 0;
    for (var i = 1; i < r.points.length; i++) if (r.points[i - 1].level !== r.points[i].level && r.cum[i - 1] >= pr - 1e-6) stairsAhead++;
    $("navTitle").textContent = "To " + r.to;
    $("remain").textContent = fmtDist(rem); $("eta").textContent = fmtTime(rem / 1.4 + stairsAhead * 12); $("total").textContent = fmtDist(r.length);
    $("prog").value = r.length ? Math.min(100, pr / r.length * 100) : 0;
    var ol = $("steps"), cur = -1;
    r.steps.forEach(function (st, k) { if (cur < 0 && st.at > pr + 0.5) cur = k; });
    if (cur < 0) cur = r.steps.length - 1;
    var sig = r.length + ":" + r.steps.length + ":" + cur + ":" + S.navigating;
    if (ol.dataset.sig !== sig) {                          // only rebuild the list when it actually changes
      ol.dataset.sig = sig; ol.innerHTML = "";
      var lastFl = null, multi = (r.floors || []).length > 1;
      r.steps.forEach(function (st, k) {
        if (multi && st.level !== lastFl) { var h = document.createElement("li"); h.className = "fl"; h.textContent = S.nav.floorName(st.level); ol.appendChild(h); lastFl = st.level; }
        var li = document.createElement("li"); li.className = S.navigating && k < cur ? "done" : k === cur && S.navigating ? "now" : "";
        li.innerHTML = "<span></span> "; li.firstChild.textContent = st.dist ? "(" + fmtDist(st.dist) + ") " : ""; li.appendChild(document.createTextNode(st.text)); ol.appendChild(li);
      });
      if (S.navigating) { var n = ol.querySelector(".now"); if (n && n.scrollIntoView) n.scrollIntoView({ block: "nearest" }); }
    }
    if (S.navigating) {
      var st = r.steps[cur]; setStatus("<b>" + (S.auto ? "Demo" : "Navigating") + "</b> · next: " + escapeHtml(st.text) + (st.final ? "" : " in " + fmtDist(Math.max(0, st.at - pr))));
    }
  }
  function clearAll() {
    S.reqId++; busy(false); S.route = null; S.routes = []; S.dest = null; S.navigating = false; S.auto = false; S.arrived = false; S.progress = 0; lastRouteDraw = -1;
    $("destChip").hidden = true; $("startNav").disabled = true; $("demo").disabled = true; $("demo").textContent = "Auto-walk demo"; $("offRoute").hidden = true;
    say(""); setStatus("Pick a destination to begin."); drawRoute(true); updateInfo(); renderList(); renderOpts(); updateMode(); drawMini(); renderFloors(); floorHint();
  }
  function escape() {
    if (S.tool) { setTool(null); return; }
    if (!$("card").hidden) { closeCard(); return; }
    if (S.navigating || S.auto) { stopNavigation("Navigation stopped. The route is still shown."); return; }
    if (S.challenge) { endChallenge(true); return; }
    if (S.route || S.dest) { clearAll(); return; }
    if (PHONE.matches) setSheet(false);
  }

  /* ================================================================ */
  /* minimap (top-down)                                                */
  /* ================================================================ */
  var mini = $("mini"), mctx = mini.getContext("2d"), MB = (function () {
    var xs = [], ys = [];
    DATA.buildings.concat(DATA.roads, DATA.areas).forEach(function (o) { o.points_m.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
    return { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
  })();
  var staticMini = null, MT = null;
  function miniT() {
    if (MT) return MT;
    var w = mini.width, h = mini.height, pad = 6, k = Math.min((w - pad * 2) / (MB.x1 - MB.x0), (h - pad * 2) / (MB.y1 - MB.y0));
    return (MT = { k: k, ox: (w - (MB.x1 - MB.x0) * k) / 2 - MB.x0 * k, oy: (h - (MB.y1 - MB.y0) * k) / 2 - MB.y0 * k });
  }
  function miniPoly(ctx, pts, T) { ctx.beginPath(); pts.forEach(function (p, i) { var x = p[0] * T.k + T.ox, y = p[1] * T.k + T.oy; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }
  function buildMiniStatic() {       // drawn once; each frame only copies it and adds the marker
    var c = document.createElement("canvas"); c.width = mini.width; c.height = mini.height; var x = c.getContext("2d"), T = miniT();
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.getAttribute("data-theme") !== "light";
    x.fillStyle = dark ? "#1e2126" : "#f4f2ea"; x.fillRect(0, 0, c.width, c.height);
    DATA.areas.forEach(function (a) { miniPoly(x, a.points_m, T); x.fillStyle = dark ? "#343a41" : "#d3d0c4"; x.fill(); });
    DATA.roads.forEach(function (r) { miniPoly(x, r.points_m, T); x.fillStyle = dark ? "#454b53" : "#b3afa3"; x.fill(); });
    DATA.buildings.forEach(function (b) { miniPoly(x, b.points_m, T); x.fillStyle = dark ? "#8c8570" : "#cfc4a6"; x.fill(); x.strokeStyle = dark ? "#5d574a" : "#8d846e"; x.lineWidth = .6; x.stroke(); });
    x.fillStyle = dark ? "#aaa" : "#555"; x.font = "bold 10px system-ui"; x.fillText("N ↑", 6, 13);
    staticMini = c;
  }
  function drawMini() {
    if (!staticMini) buildMiniStatic();
    mctx.drawImage(staticMini, 0, 0);
    var T = miniT();
    if (S.route && !routeHidden()) {
      mctx.beginPath(); S.route.points.forEach(function (p, i) { var x = p.x * T.k + T.ox, y = p.y * T.k + T.oy; if (i) mctx.lineTo(x, y); else mctx.moveTo(x, y); });
      mctx.strokeStyle = COL.route; mctx.lineWidth = 2.2; mctx.lineJoin = "round"; mctx.stroke();
      var l = S.route.points[S.route.points.length - 1]; mctx.beginPath(); mctx.arc(l.x * T.k + T.ox, l.y * T.k + T.oy, 3.5, 0, 6.3); mctx.fillStyle = COL.route; mctx.fill();
    }
    var P = S.player, px = P.x * T.k + T.ox, py = P.y * T.k + T.oy;
    mctx.save(); mctx.translate(px, py); mctx.rotate(P.heading);
    mctx.beginPath(); mctx.moveTo(7, 0); mctx.lineTo(-4, 4.5); mctx.lineTo(-4, -4.5); mctx.closePath(); mctx.fillStyle = COL.me; mctx.fill(); mctx.restore();
    mctx.beginPath(); mctx.arc(px, py, 3.2, 0, 6.3); mctx.fillStyle = COL.me; mctx.strokeStyle = "#fff"; mctx.lineWidth = 1.5; mctx.fill(); mctx.stroke();
    if (P.level > 0) { mctx.fillStyle = "#7b1fa2"; mctx.font = "bold 10px system-ui"; mctx.fillText("F" + P.level, px + 6, py - 5); }
  }
  mini.addEventListener("pointerdown", function (e) {
    var r = mini.getBoundingClientRect(), T = miniT(), x = ((e.clientX - r.left) * mini.width / r.width - T.ox) / T.k, y = ((e.clientY - r.top) * mini.height / r.height - T.oy) / T.k;
    if (S.follow) setCam("iso", true);
    map.animateTo({ ground: [x, y], scale: Math.max(map.get().zoom, 7) }, 450);
  });

  /* ================================================================ */
  /* challenge                                                         */
  /* ================================================================ */
  function startChallenge() {
    if (!S.nav) return;
    if (S.challenge) { endChallenge(true); return; }
    var pool = S.nav.places.filter(function (p) { return (p.kind === "building" || p.kind === "area") && p.reachable && Math.hypot(p.x - S.player.x, p.y - S.player.y) > 30; });
    if (!pool.length) { toast("No destinations available"); return; }
    var t = pool[Math.floor(Math.random() * pool.length)], opt = S.nav.findRoute({ x: S.player.x, y: S.player.y, level: S.player.level }, { place: t.id });
    if (!opt.found) { toast("Could not set a challenge from here. Try again."); return; }
    clearAll(); closeCard(); S.challenge = { place: t, t0: performance.now(), hint: false, penalty: 0, par: opt.length / PLAYER_SPEED + 6 };
    $("challenge").textContent = "Give up"; $("hint").disabled = false; $("challengeBar").hidden = false; drawRoute(true);
    toast("Find " + t.name + " on the map. Use WASD, or ask for a hint.");
    setCam("iso", true); map.fit();
  }
  function checkChallenge() {
    var C = S.challenge, P = S.player, el = (performance.now() - C.t0) / 1000 + C.penalty;
    $("challengeBar").textContent = "Find: " + C.place.name + " · " + fmtClock(el) + (C.hint ? " · hint on" : "");
    var near = C.place.anchors.some(function (a) { return Math.hypot(a.x - P.x, a.y - P.y) < 3.2 && P.level === (C.place.level || 0); }) || (C.place.autoDoor && Math.hypot(C.place.autoDoor[0] - P.x, C.place.autoDoor[1] - P.y) < 3.2);
    if (C.place.kind === "area" && Math.hypot(C.place.x - P.x, C.place.y - P.y) < 6) near = true;
    if (near) {
      var stars = el <= C.par * 1.4 ? 3 : el <= C.par * 2.2 ? 2 : 1;
      S.scores.push({ name: C.place.name, t: el, stars: stars });
      toast("Found " + C.place.name + " in " + fmtClock(el) + " " + "★★★".slice(0, stars) + "☆☆☆".slice(0, 3 - stars), "arrive", 4200);
      $("scoreLine").textContent = "Recent: " + S.scores.slice(-3).map(function (s) { return s.name + " " + fmtClock(s.t); }).join(" · ");
      endChallenge(false);
    }
  }
  function fmtClock(s) { s = Math.round(s); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  function endChallenge(gaveUp) {
    if (gaveUp && S.challenge) toast("Challenge ended");
    S.challenge = null; $("challenge").textContent = "Start a challenge"; $("hint").disabled = true; $("challengeBar").hidden = true; drawRoute(true); drawMini();
  }
  function hint() {
    var C = S.challenge; if (!C) return;
    C.hint = true; C.penalty += 10; S.start = "me"; $("from").value = "me"; chooseDest({ place: C.place.id });
  }

  /* ================================================================ */
  /* editor (navigation data, saved in the browser)                    */
  /* ================================================================ */
  var HELP = {
    place: "Tap the map to drop a named place (a room, a gate, a landmark). Set its floor first.",
    link: "Tap points along a new walkway or door link. Start and end on existing paths. To join floors, tap the same spot on both floors (change Floor between taps). Then Finish.",
    block: "Tap the corners of an area nobody may walk through. Then Finish shape.",
    walk: "Tap the corners of an area people may walk on (a path, a car park). Then Finish shape.",
    access: "Tap a building, room or area (or choose it as the destination first), then tap where it is really entered. Routes to it will end there."
  };
  function setTool(t) {
    S.tool = t; S.pending = []; S.accessFor = t === "access" && S.dest && S.dest.place ? S.dest.place : null;
    Array.prototype.forEach.call(document.querySelectorAll("#tools button"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.tool === t)); });
    $("toolHelp").textContent = t ? HELP[t] : "Choose a tool, then tap the map.";
    if (S.accessFor) $("toolHelp").textContent = "Tap where " + S.nav.place(S.accessFor).name + " is really entered (set Floor first for a room upstairs).";
    if (t) closeCard();
    syncEdBtns(); drawEditor();
  }
  function syncEdBtns() { $("edFinish").disabled = !(S.tool && S.pending.length >= (S.tool === "link" ? 2 : 3)); $("edUndo").disabled = !S.pending.length; }
  function editorTap(e) {
    var lvl = +$("edLevel").value, name = $("edName").value.trim();
    var p = map.screenToGround(e.clientX, e.clientY, lvl);           // the tap, read at the chosen floor
    if (S.tool === "access") {                               // two taps: which destination, then where it is entered
      if (!S.accessFor) {
        var pl = placeFromFeature(e.feature);
        if (!pl) { toast("Tap a building, a room or an area first"); return; }
        S.accessFor = pl.id; $("edLevel").value = String(pl.level || 0);
        $("toolHelp").textContent = "Now tap where " + pl.name + " is really entered.";
        drawEditor(); return;
      }
      var pid = S.accessFor, target = S.nav.place(pid); S.accessFor = null;
      S.edits.access = S.edits.access.filter(function (a) { return a.place !== pid; });
      S.edits.access.push({ place: pid, name: target.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), level: lvl });
      commitEdit(); $("toolHelp").textContent = HELP.access;
      var moved = S.nav.place(pid); toast(moved && moved.accessEdited ? "Access point set for " + target.name : "That spot is not walkable, so nothing changed");
      return;
    }
    if (S.tool === "place") {
      if (!name) { toast("Type a name first"); $("edName").focus(); return; }
      S.edits.places.push({ id: Date.now().toString(36), name: name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), level: lvl });
      commitEdit(); toast("Added place: " + name); $("edName").value = ""; return;
    }
    S.pending.push({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), level: lvl }); syncEdBtns(); drawEditor();
  }
  function placeFromFeature(f) {                             // the destination behind a tapped building, room or area
    if (!f) return null;
    if (f.kind === "room") return S.nav.place("room:" + f.roomId);
    return S.nav.places.filter(function (p) { return p.featureName === f.name && (p.kind === "building" || p.kind === "area" || p.kind === "raised"); })[0] || null;
  }
  function finishShape() {
    var name = $("edName").value.trim();
    if (S.tool === "link" && S.pending.length >= 2) S.edits.links.push({ name: name || "Added link", points: S.pending.slice() });
    else if (S.tool === "block" && S.pending.length >= 3) S.edits.blocked.push({ name: name || "Blocked area", points: S.pending.map(function (p) { return [p.x, p.y]; }) });
    else if (S.tool === "walk" && S.pending.length >= 3) S.edits.walkable.push({ name: name || "Added walkable area", points: S.pending.map(function (p) { return [p.x, p.y]; }) });
    else return;
    S.pending = []; commitEdit(); toast("Saved"); $("edName").value = "";
  }
  function commitEdit() {                                     // every saved edit is checked against the whole network at once
    var before = S.nav ? S.nav.connectivity() : null;
    saveEdits(); rebuild(); renderEdits(); syncEdBtns(); if (S.dest) computeRoute(false, S.navigating);
    var after = S.nav.connectivity(), r = connectivityReport(); $("checkOut").textContent = r.text;
    function bad(c) { return c.disconnected.length + c.stranded.length + c.noEntrance.length; }
    if (before && bad(after) > bad(before)) toast("That edit cut something off the network: see the report under Edit navigation data", "", 4200);
  }
  $("edits").addEventListener("click", function (e) {       // delegated: re-rendering the list never stacks listeners
    var b = e.target.closest("button[data-g]"); if (!b) return;
    S.edits[b.dataset.g].splice(+b.dataset.i, 1); commitEdit();
  });
  function renderEdits() {
    var ul = $("edits"); ul.innerHTML = "";
    [["places", "Place"], ["links", "Link"], ["blocked", "Blocked"], ["walkable", "Walkable"], ["access", "Access point"]].forEach(function (g) {
      S.edits[g[0]].forEach(function (it, i) {
        var li = document.createElement("li"), s = document.createElement("span"), b = document.createElement("button");
        s.textContent = g[1] + ": " + it.name; b.type = "button"; b.className = "btn small"; b.textContent = "Delete"; b.dataset.g = g[0]; b.dataset.i = i;
        li.appendChild(s); li.appendChild(b); ul.appendChild(li);
      });
    });
    if (!ul.children.length) ul.innerHTML = "<li><span class='hint'>No edits yet.</span></li>";
  }
  function drawEditor() {
    var items = [];
    S.edits.blocked.forEach(function (b) { items.push({ type: "polygon", points: b.points.map(function (p) { return { x: p[0], y: p[1] }; }), level: 0, color: "#d32f2f", opacity: .35 }); });
    S.edits.walkable.forEach(function (b) { items.push({ type: "polygon", points: b.points.map(function (p) { return { x: p[0], y: p[1] }; }), level: 0, color: "#2e7d32", opacity: .3 }); });
    S.edits.links.forEach(function (l) { items.push({ type: "polyline", points: l.points, color: "#00897b", width: 4, dash: "6 4", halo: "#fff" }); });
    S.edits.access.forEach(function (a) {                       // the corrected entrance, joined to the place it serves
      var pl = S.nav && S.nav.place(a.place); if (!pl) return;
      items.push({ type: "polyline", points: [{ x: pl.x, y: pl.y, level: pl.level || 0 }, { x: a.x, y: a.y, level: a.level }], color: "#1565c0", width: 2, dash: "3 3" });
      items.push({ type: "marker", kind: "diamond", x: a.x, y: a.y, level: a.level, color: "#1565c0", size: 5, label: "entrance: " + a.name });
    });
    if (S.accessFor && S.nav) { var af = S.nav.place(S.accessFor); if (af) items.push({ type: "marker", kind: "dot", x: af.x, y: af.y, level: af.level || 0, color: "#1565c0", size: 6, label: af.name }); }
    if (S.pending.length) {
      var closed = S.tool === "block" || S.tool === "walk";
      items.push({ type: closed && S.pending.length > 2 ? "polygon" : "polyline", points: S.pending, level: S.pending[0].level, color: "#ef6c00", width: 3, dash: "4 3", opacity: .3 });
      S.pending.forEach(function (p) { items.push({ type: "marker", kind: "dot", x: p.x, y: p.y, level: p.level, color: "#ef6c00", size: 4 }); });
    }
    map.setOverlay("editor", items);
  }

  /* ================================================================ */
  /* performance monitor (development)                                 */
  /* ================================================================ */
  function togglePerf(on) {
    S.perf = typeof on === "boolean" ? on : !S.perf; $("perfToggle").checked = S.perf; $("perf").hidden = !S.perf;
    fps.since = performance.now(); fps.frames = 0; fps.sum = 0; fps.worst = 0;
  }
  function updatePerf(t) {
    var span = t - fps.since, ms = map.stats(), mem = performance.memory, cs = S.nav.cacheStats();
    var lines = [
      "FPS          " + (fps.frames * 1000 / span).toFixed(0),
      "frame ms     " + (fps.sum / Math.max(1, fps.frames)).toFixed(1) + " avg, " + fps.worst.toFixed(1) + " worst",
      "SVG elements " + ms.nodes + "  (draw calls: n/a, SVG)",
      "map redraws  " + ms.renders + "  last " + ms.renderMs.toFixed(1) + " ms",
      "view commits " + ms.commits + "  overlays " + ms.overlayMs.toFixed(1) + " ms",
      "nav build    " + S.nav.stats.buildMs + " ms" + (S.nav.stats.baseCached ? " (cached)" : ""),
      "last route   " + S.lastRouteMs.toFixed(1) + " ms  cache " + cs.size + "/" + cs.hits + " hits",
      "DOM nodes    " + document.getElementsByTagName("*").length,
      "JS heap      " + (mem ? (mem.usedJSHeapSize / 1048576).toFixed(1) + " MB" : "n/a in this browser")
    ];
    $("perf").textContent = lines.join("\n");
    fps.since = t; fps.frames = 0; fps.sum = 0; fps.worst = 0;
  }

  /* ================================================================ */
  /* UI wiring (each listener registered exactly once)                 */
  /* ================================================================ */
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function toast(text, cls, ms) {
    var d = document.createElement("div"); d.className = "toast " + (cls || ""); d.textContent = text; $("toast").appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, ms || 2600);
    while ($("toast").children.length > 3) $("toast").removeChild($("toast").firstChild);
  }

  var qTimer = 0;
  $("q").addEventListener("input", function () { clearTimeout(qTimer); qTimer = setTimeout(renderList, 80); });
  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter") { var b = $("dlist").querySelector("button[data-id]"); if (b) b.click(); } });
  $("from").addEventListener("change", function () { S.start = this.value; if (S.dest) computeRoute(true); });
  $("find").addEventListener("click", function () { computeRoute(true); });
  $("startNav").addEventListener("click", startNavigation);
  $("demo").addEventListener("click", function () {
    if (S.auto) { stopAuto(false); updateMode(); return; }
    if (!S.route) return; S.auto = true; S.paused = false; S.pause = 0; $("demo").textContent = "Stop demo"; startNavigation(); updateMode(); toast("Auto-walk demo. Press any movement key to take over.");
  });
  $("pauseNav").addEventListener("click", function () { if (!S.auto) return; S.paused = !S.paused; updateMode(); });
  $("clear").addEventListener("click", clearAll);
  $("swap").addEventListener("click", function () {
    if (!S.dest || !S.dest.place) { say("Swap needs a destination chosen from the list.", "bad"); return; }
    var old = S.start === "me" ? null : S.start, d = S.dest.place;
    S.start = d; $("from").value = d;
    if (old) chooseDest({ place: old }); else { clearAll(); toast("Start is now " + S.nav.place(d).name + ". Pick a destination."); }
  });
  $("reroute").addEventListener("click", replan);
  $("stopNav").addEventListener("click", function () { stopNavigation("Exploring. Pick another destination or press Start navigation again."); $("q").focus(); });
  $("strict").addEventListener("change", function () { S.strict = this.checked; rebuild(); toast(S.strict ? "Traced surfaces only" : "Open ground allowed"); if (S.dest && !S.navigating) computeRoute(false); });   // never restart a walk in progress
  $("perfToggle").addEventListener("change", function () { togglePerf(this.checked); });
  $("challenge").addEventListener("click", startChallenge);
  $("hint").addEventListener("click", hint);
  $("camView").addEventListener("change", function () { setCam(this.value); });
  $("bReset").addEventListener("click", resetView);
  $("bRotL").addEventListener("click", function () { turn(-30); });
  $("bRotR").addEventListener("click", function () { turn(30); });
  $("bNorth").addEventListener("click", function () { if (S.cam === "third") setCam("follow", true); map.rotateTo(0, { animate: true }); toast("Back to the drawing's view"); });
  $("bZin").addEventListener("click", function () { map.zoomTo(map.get().zoom * 1.5, { animate: true }); });
  $("bZout").addEventListener("click", function () { map.zoomTo(map.get().zoom / 1.5, { animate: true }); });
  /* ---- floor controller: the one source of truth for which floor (and so which drawing) is shown ---- */
  function setFloorView(ch) {
    var fv = S.fv; Object.keys(ch || {}).forEach(function (k) { fv[k] = ch[k]; });
    map.set({ floor: fv.floor, hiddenFloors: fv.hidden.slice(), focusFloor: fv.focus });
    renderFloors(); drawPlayer(); floorHint();
  }
  function floorShown(l) { return S.fv.floor === "all" ? S.fv.hidden.indexOf(l) < 0 : S.fv.floor === l; }
  function renderFloors() {
    var box = $("flList"), fl = S.nav.floors.slice().reverse(), used = S.route ? S.route.floors || [] : [];
    box.innerHTML = "";
    fl.forEach(function (f) {
      var row = document.createElement("div"); row.className = "fl-row";
      var dot = document.createElement("span"); dot.className = "fl-route" + (used.indexOf(f.level) >= 0 ? " on" : ""); dot.title = used.indexOf(f.level) >= 0 ? "The route uses this floor" : "";
      var nb = document.createElement("button"); nb.type = "button"; nb.className = "fl-name" + (floorShown(f.level) ? "" : " off"); nb.textContent = f.name + (S.player.level === f.level ? " ●" : "");
      nb.setAttribute("aria-pressed", String(S.fv.focus === f.level)); nb.title = "Highlight this floor"; nb.dataset.act = "focus"; nb.dataset.l = f.level;
      var eye = document.createElement("button"); eye.type = "button"; eye.className = "fl-ic"; eye.textContent = floorShown(f.level) ? "👁" : "–";
      eye.setAttribute("aria-label", (floorShown(f.level) ? "Hide " : "Show ") + f.name); eye.title = eye.getAttribute("aria-label"); eye.dataset.act = "eye"; eye.dataset.l = f.level;
      var only = document.createElement("button"); only.type = "button"; only.className = "fl-ic"; only.textContent = "◎";
      only.setAttribute("aria-pressed", String(S.fv.floor === f.level)); only.setAttribute("aria-label", "Show only the " + f.name); only.title = only.getAttribute("aria-label"); only.dataset.act = "only"; only.dataset.l = f.level;
      row.appendChild(dot); row.appendChild(nb); row.appendChild(eye); row.appendChild(only); box.appendChild(row);
    });
  }
  $("flList").addEventListener("click", function (e) {               // delegated: one listener however often the rows are redrawn
    if (!S.nav) return;
    var b = e.target.closest("button[data-act]"); if (!b) return; var l = +b.dataset.l, fv = S.fv;
    if (b.dataset.act === "focus") setFloorView({ focus: fv.focus === l ? null : l, floor: fv.floor !== "all" && fv.floor !== l ? l : fv.floor, hidden: fv.hidden.filter(function (h) { return h !== l; }) });
    else if (b.dataset.act === "only") setFloorView(fv.floor === l ? { floor: "all", hidden: [] } : { floor: l, hidden: [], focus: null });
    else {
      if (fv.floor !== "all") { setFloorView({ floor: "all", hidden: S.nav.floors.map(function (f) { return f.level; }).filter(function (x) { return x !== fv.floor && x !== l; }) }); return; }
      var hid = fv.hidden.indexOf(l) >= 0 ? fv.hidden.filter(function (h) { return h !== l; }) : fv.hidden.concat([l]);
      if (hid.length >= S.nav.floors.length) { toast("At least one floor stays visible"); return; }
      setFloorView({ hidden: hid, focus: fv.focus === l ? null : fv.focus });
    }
  });
  $("flAll").addEventListener("click", function () { setFloorView({ floor: "all", hidden: [], focus: null }); });
  function followFloor(l) {                                          // keep the view on the floor the marker is on
    if (S.fv.floor !== "all" && S.fv.floor !== l) { setFloorView({ floor: l }); toast("Now showing the " + S.nav.floorName(l)); }
    else if (S.fv.hidden.indexOf(l) >= 0) setFloorView({ hidden: S.fv.hidden.filter(function (h) { return h !== l; }) });
    else if (S.fv.focus != null && S.fv.focus !== l) setFloorView({ focus: l });
    else renderFloors();
  }
  function showFloor(l) {                                             // bring a floor into view without losing the others
    if (S.fv.floor !== "all") setFloorView({ floor: l });
    else setFloorView({ hidden: S.fv.hidden.filter(function (h) { return h !== l; }), focus: l });
  }
  function floorHint() {                                              // the route continues on a floor that is not shown
    var r = S.route, el = $("floorHint");
    if (!r || routeHidden() || !r.transitions || !r.transitions.length) { el.hidden = true; return; }
    var off = (r.floors || []).filter(function (l) { return !floorShown(l); });
    if (!off.length) { el.hidden = true; return; }
    var tr = r.transitions.filter(function (t) { return off.indexOf(t.to) >= 0 || off.indexOf(t.from) >= 0; })[0];
    $("floorHintText").textContent = "The route continues on the " + S.nav.floorName(off[0]) + (tr ? " via " + tr.name : "") + ".";
    el.dataset.l = off[0]; el.hidden = false;
  }
  $("floorHintBtn").addEventListener("click", function () { showFloor(+$("floorHint").dataset.l); });
  $("tools").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setTool(S.tool === b.dataset.tool ? null : b.dataset.tool); });
  $("edFinish").addEventListener("click", finishShape);
  $("edUndo").addEventListener("click", function () { S.pending.pop(); syncEdBtns(); drawEditor(); });
  $("showGraph").addEventListener("change", drawGraph);
  $("checkLinks").addEventListener("click", function () { if (!S.nav) return; var r = connectivityReport(); $("checkOut").textContent = r.text; if (!$("showGraph").checked) { $("showGraph").checked = true; drawGraph(); } });
  $("checkAll").addEventListener("click", function () {              // run every room-to-room route through the wall check
    var rooms = S.nav.places.filter(function (p) { return p.kind === "room" && p.reachable; }), pairs = [], i = 0, bad = [], none = 0, t0 = performance.now();
    rooms.forEach(function (a) { rooms.forEach(function (b) { if (a !== b) pairs.push([a, b]); }); });
    var btn = this; btn.disabled = true;
    (function chunk() {
      var t = performance.now();
      while (i < pairs.length && performance.now() - t < 12) {
        var r = S.nav.findRoute({ place: pairs[i][0].id }, { place: pairs[i][1].id });
        if (!r.found) none++; else { var v = S.nav.validate(r.points); if (v) bad.push(pairs[i][0].name + " → " + pairs[i][1].name); }
        i++;
      }
      $("checkOut").textContent = "Checked " + i + " of " + pairs.length + "…";
      if (i < pairs.length) { setTimeout(chunk, 0); return; }
      btn.disabled = false;
      $("checkOut").textContent = "Checked " + pairs.length + " routes in " + ((performance.now() - t0) / 1000).toFixed(1) + " s: " + (bad.length ? bad.length + " cross a wall: " + bad.slice(0, 3).join("; ") : "none cross a wall or leave the walkable area") + (none ? "; " + none + " had no route" : "") + ".";
    })();
  });
  $("exportBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(Object.assign({ format: "campus-navigator-nav-edits", version: 1 }, S.edits), null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "nav_edits.json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });
  $("importBtn").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return; var rd = new FileReader();
    rd.onload = function () {
      try { var o = JSON.parse(rd.result); EDIT_GROUPS.forEach(function (k) { S.edits[k] = Array.isArray(o[k]) ? o[k] : []; }); commitEdit(); toast("Imported"); }
      catch (e) { toast("That file is not valid navigation data"); }
    }; rd.readAsText(f); this.value = "";
  });
  $("resetBtn").addEventListener("click", function () { if (!window.confirm("Delete all navigation edits?")) return; S.edits = { places: [], links: [], blocked: [], walkable: [], access: [] }; commitEdit(); });
  /* phones: the panel is a bottom sheet, closed at first so the map has the screen */
  var PHONE = window.matchMedia("(max-width:820px) and (min-height:521px)");
  function setSheet(open) {
    $("panel").classList.toggle("collapsed", !open);
    $("sheetbtn").setAttribute("aria-expanded", String(open)); $("sheetbtn").lastChild.textContent = open ? "▾" : "▴";
  }
  $("sheetbtn").addEventListener("click", function () { setSheet($("panel").classList.contains("collapsed")); });
  setSheet(!PHONE.matches);
  map.on("select", function (f) { if (!f && !$("card").hidden && S.sel && S.sel.kind === "feature") closeCard(); });

  /* ---- go ---- */
  /* The map is already drawn and can be panned. Building the walkable grid takes a moment (much
     longer on a phone), so it waits until the first frame of the map is on screen. */
  loadEdits(); drawMini(); setStatus("Preparing routes…");
  var started = false;
  function startOnce() { if (!started) { started = true; start(); } }
  requestAnimationFrame(function () { setTimeout(startOnce, 0); });
  setTimeout(startOnce, 250);                       // background tabs get no animation frames; don't wait for one
  function start() {
    rebuild(); renderEdits();
    var p = S.nav.place("area:Parking lot"), a = p && p.anchors[0];
    if (a) { S.player.x = a.x; S.player.y = a.y; }
    drawPlayer(); drawMini(); updateWhere(); setFloorView({}); setStatus("Pick a destination to begin.");
    requestAnimationFrame(frame);
    if (/[?&]dev=1/.test(location.search)) togglePerf(true);
  }
  /* The navigation editor is for whoever maintains the map, not for visitors: it appears only
     with ?admin=1 in the address. Edits stay in that browser until exported. */
  if (!/[?&]admin=1(&|$)/.test(location.search)) { $("admin").hidden = true; if (S.tool) setTool(null); }
  window.pathfinder = { state: S, map: map, nav: function () { return S.nav; }, chooseDest: chooseDest, startNavigation: startNavigation, computeRoute: computeRoute, setCam: setCam, openCard: openCard, setFloorView: setFloorView, connectivity: function () { return connectivityReport(); } };
})();
