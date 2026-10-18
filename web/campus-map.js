/*!
 * Campus Navigator map renderer
 * The two detailed campus drawings, with tappable buildings, areas and rooms, routes and
 * overlays placed on them. Drawn as SVG. No dependencies, no build step.
 *
 *   const map = CampusMap.mount(element, { data: Object.assign({}, CAMPUS_MAP_DATA, { interiors: CAMPUS_INTERIORS }) });
 *   map.on("select", feature => ...);
 *   map.drawRoute([{ x, y, level }, ...]);
 *   map.setOverlay("me", [{ type: "marker", kind: "player", x, y, level, heading }]);
 *
 * The data must carry the drawings (interiors.renders, written by pipeline/interiors.py);
 * there is no other way to draw the map. Works in any web page, and inside an app through a
 * WebView (see web/embed.html for the bridge). Full API in README.md.
 */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  /* ---------------------------------------------------------------- */
  /* Colours of what the map adds on top of the (light) drawings       */
  /* ---------------------------------------------------------------- */
  var P = {
    bg: "#e9e6dc", ink: "#1b1e23", muted: "#6f6c5f", halo: "#eceadf",
    route: "#c2185b", routeHalo: "#ffffff", select: "#1769e0",
    tipBg: "#fbfaf7", tipLine: "#d5d1c2"
  };

  /* ---------------------------------------------------------------- */
  /* Geometry                                                          */
  /* ---------------------------------------------------------------- */
  function area2(r) {
    var a = 0;
    for (var i = 0; i < r.length; i++) { var p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a / 2;
  }
  function centre(r) {
    var sx = 0, sy = 0;
    r.forEach(function (p) { sx += p[0]; sy += p[1]; });
    return [sx / r.length, sy / r.length];
  }

  /* ---------------------------------------------------------------- */
  /* Styles, injected once per page                                    */
  /* ---------------------------------------------------------------- */
  var CSS = [
    ".cm-root{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;",
    "user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;",
    "background:var(--cm-bg);cursor:grab;outline:none}",
    ".cm-root.cm-dragging{cursor:grabbing}",
    ".cm-root:focus-visible{box-shadow:inset 0 0 0 2px var(--cm-select)}",
    ".cm-root>svg{position:relative;z-index:1;display:block;width:100%;height:100%;transform-origin:0 0;will-change:transform}",
    /* the drawings: plain images on their own GPU layer under the SVG, so redrawing a route never repaints them */
    ".cm-imgs{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;will-change:transform;pointer-events:none;z-index:0}",
    ".cm-img{position:absolute;left:0;top:0;overflow:hidden;transform-origin:0 0;transition:opacity .3s ease}",
    ".cm-img img{position:absolute;max-width:none;max-height:none;-webkit-user-drag:none;user-select:none}",
    ".cm-loading{position:absolute;left:50%;top:50%;z-index:3;transform:translate(-50%,-50%);display:none;align-items:center;gap:8px;",
    "padding:6px 12px;border-radius:999px;background:rgba(251,250,247,.92);color:#4a473e;font:12px system-ui,-apple-system,'Segoe UI',sans-serif;pointer-events:none}",
    ".cm-loading.cm-on{display:flex}",
    ".cm-loading:before{content:'';width:12px;height:12px;border-radius:50%;border:2px solid #b5b0a2;border-right-color:transparent;animation:cm-spin .8s linear infinite}",
    "@keyframes cm-spin{to{transform:rotate(360deg)}}",
    ".cm-sprites{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:1}",
    ".cm-sprite{position:absolute;left:0;top:0;will-change:transform}",
    ".cm-sprite .cm-halo{position:absolute;width:24px;height:24px;left:-12px;top:-12px;border-radius:50%;background:var(--c);opacity:.16}",
    ".cm-sprite .cm-dot{position:absolute;width:13px;height:13px;left:-6.5px;top:-6.5px;border-radius:50%;background:var(--c);border:2px solid #fff;box-sizing:border-box;box-shadow:0 1px 2px rgba(0,0,0,.3)}",
    ".cm-sprite .cm-arrow{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0}",
    ".cm-sprite .cm-arrow:after{content:'';position:absolute;left:7px;top:-5px;border-left:8px solid var(--c);border-top:5px solid transparent;border-bottom:5px solid transparent}",
    ".cm-root polygon,.cm-root polyline,.cm-root line,.cm-root circle{vector-effect:non-scaling-stroke}",
    ".cm-pick{cursor:pointer}",
    ".cm-pick .cm-outline{fill:none;stroke:none;transition:stroke-opacity .15s}",
    ".cm-pick.cm-selected .cm-outline{stroke:var(--cm-select);stroke-width:1.25px;stroke-opacity:.6}",
    ".cm-label{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-weight:600;",
    "fill:var(--cm-ink);paint-order:stroke;stroke:var(--cm-halo);stroke-linejoin:round;",
    "text-anchor:middle;pointer-events:none;transform-box:fill-box;transform-origin:center;transform:rotate(var(--cm-unrot,0deg))}",
    ".cm-tip{position:absolute;left:0;top:0;pointer-events:none;opacity:0;transition:opacity .12s;",
    "background:var(--cm-tipbg);color:var(--cm-ink);border:1px solid var(--cm-tipline);",
    "border-radius:8px;padding:7px 10px;font:12px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif;",
    "box-shadow:0 6px 20px rgba(0,0,0,.16);max-width:230px;z-index:2}",
    ".cm-tip.cm-on{opacity:1}",
    ".cm-tip b{display:block;font-size:13px;margin-bottom:2px}",
    ".cm-tip span{color:var(--cm-muted)}",
    ".cm-hit{fill:var(--cm-select);stroke:none}",
    ".cm-hitfill{opacity:0;transition:opacity .15s}",
    ".cm-pick.cm-hot>.cm-hitfill{opacity:.05}",
    ".cm-pick.cm-selected>.cm-hitfill{opacity:.08}",
    "@media (prefers-reduced-motion:reduce){.cm-tip,.cm-img,.cm-hitfill,.cm-pick .cm-outline{transition:none}.cm-loading:before{animation:none}}"
  ].join("");
  function injectCSS() {
    if (typeof document === "undefined" || document.getElementById("cm-style")) return;
    var s = document.createElement("style");
    s.id = "cm-style"; s.textContent = CSS;
    document.head.appendChild(s);
  }

  var DEFAULTS = {
    storeyHeight: 3.2,    // metres per storey (height of the tappable block over each building)
    hiddenFloors: [],     // floor levels not drawn, e.g. [1]
    focusFloor: null,     // the floor whose drawing is shown, if it is visible
    floor: "all",         // "all", 0 or 1: 0 shows the ground-floor cutaway drawing
    tooltip: true,        // built in tooltip: true, false, or "hover" (hover only; the host shows details on select)
    animate: true,        // animated camera moves (always off with prefers-reduced-motion)
    gestures: true,       // drag, pinch, wheel, double tap
    minZoom: 0.6,         // pixels per metre
    maxZoom: 40,
    rotation: 0           // degrees clockwise: the drawings turned flat on the screen, like a paper map on a table
  };
  var RENDER_KEYS = ["storeyHeight", "floor", "hiddenFloors", "focusFloor"];
  function now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

  /* ================================================================ */
  /* mount                                                             */
  /* ================================================================ */
  function mount(el, options) {
    if (!el) throw new Error("CampusMap.mount: no element given");
    options = options || {};
    var data = options.data;
    if (!data || !data.buildings) throw new Error("CampusMap.mount: options.data must be the contents of map_data.json");
    if (!data.interiors || !data.interiors.renders) throw new Error("CampusMap.mount: options.data.interiors must be the contents of interiors.json, with its renders (load interiors.js)");
    data.paths = data.paths || []; data.areas = data.areas || []; data.roads = data.roads || [];
    data.elevated = data.elevated || []; data.nodes = data.nodes || [];

    injectCSS();
    var S = {};
    Object.keys(DEFAULTS).forEach(function (k) { S[k] = k in options ? options[k] : DEFAULTS[k]; });
    var view = { cx: 0, cy: 0, scale: 4 }, userMoved = false, bounds = null;
    var listeners = {}, features = [], route = null, selected = null, hot = null;
    var overlays = {}, overlayOrder = [], gOver = null, overScale = 0;
    var anim = 0, cv = null, commitTimer = 0, lastCommit = 0, sprites = {};
    var stats = { renders: 0, renderMs: 0, renderAvg: 0, commits: 0, nodes: 0, overlayMs: 0 };

    /* The drawings are the map, seen from their own fixed camera: no rotation and no tilt. Map
       metres reach drawing pixels through a thin-plate spline fitted by pipeline/interiors.py;
       scene units are drawing pixels / scale, about a metre. */
    var R = data.interiors.renders;
    var WC = R.warp.centres, WW = R.warp.weights, WA = R.warp.affine;
    var PXM = R.scale_px_per_m, HZ = R.height_px_per_m / R.scale_px_per_m;
    function warp(x, y) {
      var u = WA[0][0] + WA[1][0] * x + WA[2][0] * y, v = WA[0][1] + WA[1][1] * x + WA[2][1] * y;
      for (var i = 0; i < WC.length; i++) {
        var dx = x - WC[i][0], dy = y - WC[i][1], r2 = dx * dx + dy * dy;
        if (r2 > 0) { var k = 0.5 * r2 * Math.log(r2); u += WW[i][0] * k; v += WW[i][1] * k; }
      }
      return [u / PXM, v / PXM];
    }
    function warpInv(sx, sy) {                      // Newton's method from the affine guess; the spline is smooth
      var a = WA, d0 = a[1][0] * a[2][1] - a[2][0] * a[1][1], px = sx * PXM - a[0][0], py = sy * PXM - a[0][1];
      var p = [(px * a[2][1] - py * a[2][0]) / d0, (py * a[1][0] - px * a[1][1]) / d0];
      for (var it = 0; it < 8; it++) {
        var f = warp(p[0], p[1]), ex = sx - f[0], ey = sy - f[1];
        if (ex * ex + ey * ey < 1e-10) break;
        var fx = warp(p[0] + 0.5, p[1]), fy = warp(p[0], p[1] + 0.5);
        var j00 = (fx[0] - f[0]) * 2, j10 = (fx[1] - f[1]) * 2, j01 = (fy[0] - f[0]) * 2, j11 = (fy[1] - f[1]) * 2, d = j00 * j11 - j01 * j10;
        p = [p[0] + (ex * j11 - ey * j01) / d, p[1] + (ey * j00 - ex * j10) / d];
      }
      return p;
    }
    function iso(p, z) { var q = warp(p[0], p[1]); return [q[0], q[1] - z * HZ]; }   // ground metres + height -> scene units
    function isoInv(sx, sy) { return warpInv(sx, sy); }                             // scene units back to ground (z = 0)
    function levelZ(l) { return R.floor_height_m[String(l || 0)] || 0; }            // where the drawing shows that floor
    function lvShown(l) { l = l || 0; return S.floor === "all" ? (S.hiddenFloors || []).indexOf(l) < 0 : +S.floor === l; }
    /* Rotation turns the whole scene flat about the middle of the campus drawing. "View space" is
       the turned scene: the viewBox, panning and zooming all work in it, so they need no change;
       anything converting between the map and the screen goes through toView / fromView. */
    var CLIP = R.images[0].clip, PIV = [(CLIP[0] + CLIP[2]) / 2 / PXM, (CLIP[1] + CLIP[3]) / 2 / PXM];
    var RC = 1, RS = 0;
    function setRot(deg) { S.rotation = ((deg % 360) + 360) % 360; var a = S.rotation * Math.PI / 180; RC = Math.cos(a); RS = Math.sin(a); }
    setRot(S.rotation || 0);
    function toView(c) { var x = c[0] - PIV[0], y = c[1] - PIV[1]; return [PIV[0] + x * RC - y * RS, PIV[1] + x * RS + y * RC]; }
    function fromView(v) { var x = v[0] - PIV[0], y = v[1] - PIV[1]; return [PIV[0] + x * RC + y * RS, PIV[1] - x * RS + y * RC]; }
    function viewBounds() {                           // the campus drawing's frame, turned: what the camera may not leave
      var xs = [], ys = [];
      [[CLIP[0], CLIP[1]], [CLIP[2], CLIP[1]], [CLIP[2], CLIP[3]], [CLIP[0], CLIP[3]]].forEach(function (q) { var v = toView([q[0] / PXM, q[1] / PXM]); xs.push(v[0]); ys.push(v[1]); });
      return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
    }
    function applyRotation() {                       // the scene group and the labels follow the angle; nothing is redrawn
      scene.setAttribute("transform", S.rotation ? "rotate(" + S.rotation.toFixed(3) + " " + PIV[0] + " " + PIV[1] + ")" : "");
      root.style.setProperty("--cm-unrot", (-S.rotation).toFixed(3) + "deg");
      bounds = viewBounds();
    }

    /* -------- DOM -------- */
    var root = document.createElement("div");
    root.className = "cm-root"; root.tabIndex = 0;
    root.setAttribute("role", "application");
    root.setAttribute("aria-label", "Interactive campus map. Drag to move, pinch or scroll to zoom.");
    var vars = { bg: P.bg, ink: P.ink, muted: P.muted, halo: P.halo, select: P.select, tipbg: P.tipBg, tipline: P.tipLine };
    for (var vk in vars) root.style.setProperty("--cm-" + vk, vars[vk]);
    var svg = document.createElementNS(NS, "svg");
    var scene = document.createElementNS(NS, "g");
    svg.appendChild(scene);
    var tip = document.createElement("div"); tip.className = "cm-tip";
    var spriteLayer = document.createElement("div"); spriteLayer.className = "cm-sprites";
    var imgLayer = document.createElement("div"); imgLayer.className = "cm-imgs";
    var loading = document.createElement("div"); loading.className = "cm-loading"; loading.setAttribute("role", "status");
    root.appendChild(imgLayer); root.appendChild(svg); root.appendChild(spriteLayer); root.appendChild(tip); root.appendChild(loading);
    el.appendChild(root);

    function E(n, a) { var e = document.createElementNS(NS, n); for (var k in a) e.setAttribute(k, a[k]); return e; }
    function pts(list) { return list.map(function (p) { return p[0].toFixed(2) + "," + p[1].toFixed(2); }).join(" "); }
    function poly(list, fill, stroke, extra) {
      var a = { points: pts(list), fill: fill, stroke: stroke || "none", "stroke-width": .6, "stroke-linejoin": "round" };
      for (var k in extra) a[k] = extra[k];
      return E("polygon", a);
    }

    /* ============================================================== */
    /* render: the drawing of the floor in view, plus what sits on it  */
    /* ============================================================== */
    /* The drawings carry all the architecture and their own labels. What the map adds on top is
       invisible hit areas (so buildings, areas and rooms stay tappable and can be highlighted),
       the route and the host's overlays, all placed through the drawing's camera. */
    function render() {
      var t0 = now();
      while (scene.firstChild) scene.removeChild(scene.firstChild);
      features = [];
      gOver = E("g", { "class": "cm-over", "pointer-events": "none" });

      function addFeature(f, g) {
        f.id = features.length; features.push(f);
        g.setAttribute("data-cm-id", f.id);
        g.setAttribute("class", (g.getAttribute("class") || "") + " cm-pick" + (f.kind === "building" || f.kind === "raised_area" ? "" : " cm-area"));
        f.el = g;
      }
      var imgFloor = S.focusFloor != null && lvShown(S.focusFloor) ? +S.focusFloor : lvShown(1) ? 1 : 0, gHit = E("g");   // the drawing of the highlighted floor, else the top visible one
      function fillOf(g) {                            // one group per feature, so a highlight composites as a single shape
        if (!g.firstChild || g.firstChild.getAttribute("class") !== "cm-hitfill") g.insertBefore(E("g", { "class": "cm-hitfill" }), g.firstChild);
        return g.firstChild;
      }
      function hit(g, ring, z) { fillOf(g).appendChild(E("polygon", { points: pts(ring.map(function (p) { return iso(p, z); })), "class": "cm-hit" })); }
      function outline(g, ring, z) { g.appendChild(poly(ring.map(function (p) { return iso(p, z); }), "none", null, { "class": "cm-outline" })); }
      function extrude(g, ring, h) {                  // the block as the drawing shows it: every wall plus the top
        for (var i = 0; i < ring.length; i++) {
          var a = ring[i], b = ring[(i + 1) % ring.length];
          fillOf(g).appendChild(E("polygon", { points: pts([iso(a, 0), iso(b, 0), iso(b, h), iso(a, h)]), "class": "cm-hit" }));
        }
        hit(g, ring, h);
      }
      data.areas.forEach(function (a) {
        var g = E("g"); hit(g, a.points_m, 0.03); outline(g, a.points_m, 0.03); gHit.appendChild(g);
        addFeature({ kind: a.kind || "area", name: a.name, area_m2: a.area_m2, centre: centre(a.points_m), top: 0 }, g);
      });
      var IN = data.interiors, solids = [];
      data.buildings.forEach(function (b) { solids.push({ b: b, d: iso(centre(b.points_m), 0)[1] }); });
      data.elevated.forEach(function (e) { solids.push({ e: e, d: iso(centre(e.points_m), 0)[1] }); });
      solids.sort(function (p, q) { return p.d - q.d; }).forEach(function (s) {        // far to near, so the nearest wins a tap
        var g = E("g", { "class": "cm-solid" });
        if (s.b) {
          var b = s.b, h = b.height_m || b.floors * S.storeyHeight, top = h + ((b.roof && b.roof.rise) || 0), sqm = Math.abs(area2(b.points_m));
          if (b.name === IN.building && imgFloor === 0) { hit(g, b.points_m, 0); outline(g, b.points_m, 0); top = 0; }   // cutaway: just the floor plate
          else { extrude(g, b.points_m, top); outline(g, b.points_m, top); }
          addFeature({ kind: "building", name: b.name, floors: b.floors, height_m: +h.toFixed(1), footprint_m2: Math.round(sqm), centre: centre(b.points_m), top: top,
            info: (b.height_m ? "small structure" : b.floors + " storey" + (b.floors > 1 ? "s" : "")) + " · " + Math.round(sqm) + " m²" }, g);
        } else {
          var e = s.e, eh = levelZ(e.level || 1);
          extrude(g, e.points_m, eh); outline(g, e.points_m, eh);
          addFeature({ kind: "raised_area", name: e.name, level: e.level, area_m2: e.area_m2, centre: centre(e.points_m), top: eh,
            info: "on a rock outcrop · reached from floor " + e.level + " · " + e.area_m2 + " m²" }, g);
        }
        gHit.appendChild(g);
      });
      var fl = (IN.floors || []).filter(function (f) { return f.level === imgFloor; })[0], z = levelZ(imgFloor) + 0.06;
      (IN.rooms || []).filter(function (r) { return r.level === imgFloor; }).forEach(function (r) {
        var g = E("g"); hit(g, r.points, z); outline(g, r.points, z); gHit.appendChild(g);
        addFeature({ kind: "room", name: r.name, roomId: r.id, level: r.level, floor: fl ? fl.name : "", type: r.type, centre: r.centre, top: z, approx: !!r.approx,
          info: (fl ? fl.name : "") + " · " + r.type + " · about " + r.area_m2 + " m²" + (r.approx ? " · layout approximate" : "") }, g);
      });
      showDrawing(imgFloor);
      var gRoute = E("g");
      if (route) drawRouteInto(gRoute);
      scene.appendChild(gHit); scene.appendChild(gRoute); scene.appendChild(gOver);
      applyRotation();
      paintOverlayAll();
      if (selected) { var again = findFeature(selected.name); selected = again; }
      paintSelection();
      if (!userMoved) fit(true); else applyView(true);
      var dt = now() - t0; stats.renders++; stats.renderMs = dt; stats.renderAvg = stats.renderAvg ? stats.renderAvg * 0.8 + dt * 0.2 : dt;
      stats.nodes = scene.getElementsByTagName("*").length;
    }

    /* The drawings: one <img> per drawing, created once and only ever moved by the transform of
       their layer, so floor switches, routes and markers never reload, re-decode or repaint them.
       The campus drawing loads first; the ground-floor cutaway loads once the page is idle, or at
       once if that floor is asked for, and fades in over the campus drawing with feathered edges. */
    var IMG = {}, wantFloor = null, imgScale = 0;
    R.images.forEach(function (im, i) {
      var c = im.clip, A = im.matrix, base = i === 0;
      var box = document.createElement("div"); box.className = "cm-img";
      box.style.width = (c[2] - c[0]) + "px"; box.style.height = (c[3] - c[1]) + "px";
      var ex = A[0] * c[0] + A[2] * c[1] + A[4], ey = A[1] * c[0] + A[3] * c[1] + A[5];   // the clip corner, in campus-drawing pixels
      box.style.transform = "matrix(" + [A[0] / PXM, A[1] / PXM, A[2] / PXM, A[3] / PXM, ex / PXM, ey / PXM].join(",") + ")";
      if (!base) {
        var fade = "linear-gradient(to right, transparent, #000 48px, #000 calc(100% - 48px), transparent), linear-gradient(to bottom, transparent, #000 48px, #000 calc(100% - 48px), transparent)";
        box.style.webkitMaskImage = box.style.maskImage = fade;
        box.style.webkitMaskComposite = "source-in"; box.style.maskComposite = "intersect";
        box.style.opacity = "0";
      }
      var img = document.createElement("img");
      img.alt = im.title || ""; img.decoding = "async"; img.draggable = false;
      img.width = im.width; img.height = im.height; img.style.left = -c[0] + "px"; img.style.top = -c[1] + "px";
      if (base) img.setAttribute("fetchpriority", "high");
      box.appendChild(img); imgLayer.appendChild(box);
      IMG[im.floor] = { box: box, img: img, src: im.src, base: base, state: "idle" };
    });
    function loadDrawing(floor) {                    // at most once per drawing; resolves when it can be shown
      var it = IMG[floor];
      if (it.state === "idle") {
        it.state = "loading";
        it.ready = new Promise(function (res) {
          it.img.onload = function () { (it.img.decode ? it.img.decode() : Promise.resolve()).catch(function () {}).then(function () { it.state = "ready"; res(true); }); };
          it.img.onerror = function () { it.state = "failed"; res(false); };
        });
        it.img.src = it.src;
      }
      return it.ready;
    }
    function busyState() {
      var base = IMG[R.images[0].floor], want = wantFloor != null && IMG[wantFloor];
      var pending = base.state === "loading" ? "Loading the campus drawing…" : want && want.state === "loading" ? "Loading the floor drawing…" : "";
      if (base.state === "failed" || (want && want.state === "failed")) pending = "A campus drawing could not be loaded";
      loading.textContent = pending; loading.classList.toggle("cm-on", !!pending);
    }
    function showDrawing(floor) {
      wantFloor = floor;
      Object.keys(IMG).forEach(function (k) {
        var it = IMG[k]; if (it.base) return;
        if (+k !== floor) { it.box.style.opacity = "0"; return; }
        loadDrawing(+k).then(function (ok) { if (ok && wantFloor === +k) it.box.style.opacity = "1"; busyState(); });
      });
      busyState();
    }
    loadDrawing(R.images[0].floor).then(function (ok) {
      busyState();
      if (!ok) return;
      var later = global.requestIdleCallback || function (f) { return setTimeout(f, 300); };
      later(function () { Object.keys(IMG).forEach(function (k) { if (!IMG[k].base) loadDrawing(+k); }); });
    });
    busyState();
    function placeImages() {                         // scene units -> screen pixels: turn about the pivot, then the viewBox mapping
      var s = size(), k = view.scale, ox = view.cx - s.w / 2 / k, oy = view.cy - s.h / 2 / k;
      var ex = k * (PIV[0] - (RC * PIV[0] - RS * PIV[1]) - ox), ey = k * (PIV[1] - (RS * PIV[0] + RC * PIV[1]) - oy);
      imgLayer.style.transform = "matrix(" + [k * RC, k * RS, -k * RS, k * RC].map(function (v) { return v.toFixed(6); }).join(",") + "," + ex.toFixed(2) + "," + ey.toFixed(2) + ")";
    }
    function sharpenImages() {                       // a GPU layer keeps the scale it was drawn at; redraw it after a real zoom
      if (imgScale && Math.abs(Math.log(view.scale / imgScale)) < 0.2) return;
      imgScale = view.scale; imgLayer.style.willChange = "auto";
      requestAnimationFrame(function () { imgLayer.style.willChange = "transform"; });
    }

    function drawRouteInto(g) {
      var pl = route.points, segs = [], cur = [];
      for (var i = 0; i < pl.length; i++) {
        var p = pl[i], lvl = p.level || 0, w = [p.x, p.y];
        if (i > 0 && (pl[i - 1].level || 0) !== lvl) {              // floor change: rise or drop on the spot
          var a = iso(w, levelZ(pl[i - 1].level) + .3);
          cur.push(a); segs.push(cur); cur = [a];
        }
        cur.push(iso(w, levelZ(lvl) + .3));
      }
      segs.push(cur);
      var col = route.color || P.route;
      segs.forEach(function (s) {
        if (s.length < 2) return;
        g.appendChild(E("polyline", { points: pts(s), fill: "none", stroke: P.routeHalo, "stroke-width": 5.5, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: .8 }));
        g.appendChild(E("polyline", { points: pts(s), fill: "none", stroke: col, "stroke-width": 3.5, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      });
      var first = segs[0][0], last = segs[segs.length - 1][segs[segs.length - 1].length - 1];
      g.appendChild(E("circle", { cx: first[0], cy: first[1], r: 0.9, fill: P.routeHalo, stroke: col, "stroke-width": 2.5 }));
      g.appendChild(E("circle", { cx: last[0], cy: last[1], r: 1.1, fill: col, stroke: P.routeHalo, "stroke-width": 2 }));
    }

    /* ============================================================== */
    /* overlays: markers, lines and areas drawn by the host app        */
    /* Cheap to update, because only that overlay is rebuilt, never    */
    /* the whole scene. Sizes are in screen pixels.                     */
    /* ============================================================== */
    function ovPt(p, level) { return iso([p.x, p.y], levelZ(level == null ? (p.level || 0) : level) + 0.35); }
    function ovShown(level) { return lvShown(level); }
    function paintOverlay(id) {
      var o = overlays[id]; if (!o || !gOver) return;
      if (!o.g) o.g = E("g");
      var g = o.g; while (g.firstChild) g.removeChild(g.firstChild);
      var k = 1 / view.scale;                                   // metres per pixel
      function label(it, c, dy) {
        if (!it.label) return;
        var t = E("text", { x: c[0], y: c[1] - (dy || 12) * k, "font-size": (it.fontSize || 11) * k, "stroke-width": 3 * k, "class": "cm-label" });
        t.textContent = it.label; g.appendChild(t);
      }
      function ang(it, c) {                                      // screen angle of a ground heading
        var h = it.heading || 0, c2 = ovPt({ x: it.x + Math.cos(h), y: it.y + Math.sin(h) }, it.level || 0);
        return Math.atan2(c2[1] - c[1], c2[0] - c[0]);
      }
      function tri(c, a, size, fill, stroke) {
        var pts = [[size, 0], [-size * 0.7, size * 0.75], [-size * 0.7, -size * 0.75]].map(function (q) {
          return [c[0] + (q[0] * Math.cos(a) - q[1] * Math.sin(a)) * k, c[1] + (q[0] * Math.sin(a) + q[1] * Math.cos(a)) * k];
        });
        g.appendChild(poly(pts, fill, stroke, { "stroke-width": 1.5 }));
      }
      (o.items || []).forEach(function (it) {
        var col = it.color || P.route, c;
        if (it.type === "polyline" || it.type === "polygon") {
          var pl = it.points || [], run = [], runs = [];
          pl.forEach(function (p) {
            var lvl = p.level != null ? p.level : (it.level || 0);
            if (ovShown(lvl)) run.push(ovPt(p, lvl)); else { if (run.length) runs.push(run); run = []; }
          });
          if (run.length) runs.push(run);
          runs.forEach(function (r) {
            if (it.type === "polygon") {
              g.appendChild(poly(r, col, it.stroke || col, { "fill-opacity": it.opacity == null ? 0.25 : it.opacity, "stroke-width": 1.5, "stroke-dasharray": it.dash || "none" }));
            } else if (r.length > 1) {
              if (it.halo) g.appendChild(E("polyline", { points: pts(r), fill: "none", stroke: it.halo, "stroke-width": (it.width || 4) + 2, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: .8 }));
              var a = { points: pts(r), fill: "none", stroke: col, "stroke-width": it.width || 4, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: it.opacity == null ? 1 : it.opacity };
              if (it.dash) a["stroke-dasharray"] = it.dash;
              g.appendChild(E("polyline", a));
            }
          });
          return;
        }
        if (!ovShown(it.level)) return;
        c = ovPt(it, it.level || 0);
        var kind = it.kind || "dot";
        if (kind === "player") {
          g.appendChild(E("circle", { cx: c[0], cy: c[1], r: 13 * k, fill: col, opacity: .22 }));
          tri(c, ang(it, c), 11, col, "#fff");
          g.appendChild(E("circle", { cx: c[0], cy: c[1], r: 6.5 * k, fill: col, stroke: "#fff", "stroke-width": 2.5 }));
        } else if (kind === "arrow") {
          tri(c, ang(it, c), it.size || 4.5, col, "none");
        } else if (kind === "start") {
          g.appendChild(E("circle", { cx: c[0], cy: c[1], r: 5 * k, fill: P.routeHalo, stroke: col, "stroke-width": 2.5 }));
        } else if (kind === "dest") {                              // a small pin: a coloured dot on a white ring
          g.appendChild(E("circle", { cx: c[0], cy: c[1], r: 6.5 * k, fill: col, stroke: P.routeHalo, "stroke-width": 2 }));
          g.appendChild(E("circle", { cx: c[0], cy: c[1], r: 2 * k, fill: P.routeHalo }));
        } else if (kind === "check") {
          g.appendChild(E("circle", { cx: c[0], cy: c[1], r: 3 * k, fill: it.done ? "#9aa0a6" : P.routeHalo, stroke: it.done ? "#9aa0a6" : col, "stroke-width": 1.5 }));
        } else if (kind === "diamond") {
          var d = (it.size || 4) * k;
          g.appendChild(poly([[c[0], c[1] - d], [c[0] + d, c[1]], [c[0], c[1] + d], [c[0] - d, c[1]]], col, P.routeHalo, { "stroke-width": 1, "fill-opacity": it.opacity == null ? 1 : it.opacity }));
        } else {
          g.appendChild(E("circle", { cx: c[0], cy: c[1], r: (it.size || 4) * k, fill: col, stroke: P.routeHalo, "stroke-width": 1.5, "fill-opacity": it.opacity == null ? 1 : it.opacity }));
        }
        label(it, c, it.labelDy);
      });
    }
    function paintOverlayAll() {
      if (!gOver) return;
      var t0 = now();
      while (gOver.firstChild) gOver.removeChild(gOver.firstChild);
      overScale = view.scale;
      overlayOrder.forEach(function (id) { paintOverlay(id); if (overlays[id] && overlays[id].g) gOver.appendChild(overlays[id].g); });
      stats.overlayMs = now() - t0;
    }
    /* sprites: small HTML markers above the map (the player). Moving one never repaints the map. */
    function placeSprites() {
      var s = size();
      for (var id in sprites) {
        var sp = sprites[id], d = sp.d;
        if (!ovShown(d.level)) { sp.el.style.display = "none"; continue; }
        sp.el.style.display = "";
        var c = toView(ovPt(d, d.level || 0)), x = (c[0] - view.cx) * view.scale + s.w / 2, y = (c[1] - view.cy) * view.scale + s.h / 2;
        sp.el.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px)";
        if (sp.arrow) {
          var h = d.heading || 0, c2 = toView(ovPt({ x: d.x + Math.cos(h), y: d.y + Math.sin(h) }, d.level || 0));
          sp.arrow.style.transform = "rotate(" + Math.atan2(c2[1] - c[1], c2[0] - c[0]).toFixed(3) + "rad)";
        }
      }
    }
    /* screen position (client pixels) -> ground position (metres) at a floor level */
    function toGround(clientX, clientY, level) {
      var r = root.getBoundingClientRect(), s = size();
      var sx = view.cx + (clientX - r.left - s.w / 2) / view.scale, sy = view.cy + (clientY - r.top - s.h / 2) / view.scale;
      var sc = fromView([sx, sy]), q = isoInv(sc[0], sc[1] + (levelZ(level) + 0.35) * HZ);
      return { x: q[0], y: q[1] };
    }
    /* a screen direction (right = +x, down = +y) -> unit vector on the ground. The drawing's
       camera bends, so this uses its slope at that point (or mid-screen). */
    function dirToGround(sx, sy, at) {
      var tx = sx * RC + sy * RS, ty = -sx * RS + sy * RC; sx = tx; sy = ty;   // the screen direction, turned back into the drawing
      var g = at ? [at.x, at.y] : groundAtCentre(), o = iso(g, 0), ex = iso([g[0] + 1, g[1]], 0), ey = iso([g[0], g[1] + 1], 0);
      var j00 = ex[0] - o[0], j10 = ex[1] - o[1], j01 = ey[0] - o[0], j11 = ey[1] - o[1], dj = j00 * j11 - j01 * j10;
      var ux = (sx * j11 - sy * j01) / dj, uy = (sy * j00 - sx * j10) / dj, um = Math.hypot(ux, uy) || 1;
      return [ux / um, uy / um];
    }

    /* ============================================================== */
    /* view: pan and zoom only touch the viewBox, so they stay smooth  */
    /* ============================================================== */
    var SZ = null;                                   // cached: reading it every frame would force a layout each time
    function size() { return SZ || (SZ = { w: root.clientWidth || 1, h: root.clientHeight || 1 }); }
    /* Panning and zooming move the already drawn map with a CSS transform, which the GPU does
       for free. The viewBox and overlay sizes catch up a moment after movement stops
       (commit). Anything that redraws the scene commits at once. */
    function clampView() {
      if (!bounds) return;                                   // keep some of the campus on screen
      view.cx = Math.max(bounds.x0, Math.min(bounds.x1, view.cx));
      view.cy = Math.max(bounds.y0, Math.min(bounds.y1, view.cy));
    }
    function applyView(immediate) {
      clampView();
      if (immediate || !cv) { commit(); return; }
      var s = size(), k = view.scale / cv.scale;
      var tx = view.scale * ((cv.cx - s.w / 2 / cv.scale) - (view.cx - s.w / 2 / view.scale));
      var ty = view.scale * ((cv.cy - s.h / 2 / cv.scale) - (view.cy - s.h / 2 / view.scale));
      svg.style.transform = "translate(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px) scale(" + k.toFixed(5) + ")";
      placeImages(); placeSprites();
      clearTimeout(commitTimer); commitTimer = setTimeout(commit, 140);
      if (Math.abs(Math.log(k)) > 0.2 && now() - lastCommit > 400) commit();      // don't stay blurry while zooming far
      emit("viewchange", { zoom: +view.scale.toFixed(3), rotation: +S.rotation.toFixed(2) });
    }
    function commit() {
      clearTimeout(commitTimer); lastCommit = now(); stats.commits++;
      var s = size(), vw = s.w / view.scale, vh = s.h / view.scale;
      svg.style.transform = "";
      svg.setAttribute("viewBox", (view.cx - vw / 2) + " " + (view.cy - vh / 2) + " " + vw + " " + vh);
      cv = { cx: view.cx, cy: view.cy, scale: view.scale };
      if (gOver && overScale && Math.abs(Math.log(view.scale / overScale)) > 0.1) paintOverlayAll();
      placeImages(); sharpenImages(); placeSprites();
      emit("viewchange", { zoom: +view.scale.toFixed(3), rotation: +S.rotation.toFixed(2) });
    }
    /* ---- animated camera. Targets are ground positions ---- */
    function reducedMotion() { return !S.animate || (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    function groundAtCentre() { var sc = fromView([view.cx, view.cy]); return isoInv(sc[0], sc[1]); }
    function stopAnim() { if (anim) cancelAnimationFrame(anim); anim = 0; }
    function animateTo(t, ms) {
      stopAnim(); stopZoom(); t = t || {};
      var g0 = groundAtCentre(), from = { gx: g0[0], gy: g0[1], z: 0, scale: view.scale };
      var to = { gx: t.ground ? t.ground[0] : g0[0], gy: t.ground ? t.ground[1] : g0[1], z: t.z || 0,
                 scale: t.scale != null ? clampScale(t.scale) : view.scale };
      from.rot = S.rotation;                           // turn the shorter way round
      var dr = t.spin != null ? t.spin : t.rotation != null ? ((t.rotation - S.rotation) % 360 + 540) % 360 - 180 : 0;
      ms = reducedMotion() ? 0 : (ms == null ? 450 : ms);
      var start = now(); userMoved = true;
      function step() {
        anim = 0;
        var u = ms ? Math.min(1, (now() - start) / ms) : 1;
        var e = t.linear ? u : (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
        view.scale = from.scale * Math.pow(to.scale / from.scale, e);
        if (dr) { setRot(from.rot + dr * e); applyRotation(); }
        var c = toView(iso([from.gx + (to.gx - from.gx) * e, from.gy + (to.gy - from.gy) * e], from.z + (to.z - from.z) * e));
        view.cx = c[0]; view.cy = c[1];
        applyView(u >= 1);
        if (u < 1) anim = requestAnimationFrame(step); else if (t.done) t.done();
      }
      step();
    }
    /* ---- eased wheel zoom ---- */
    var zoomTarget = null, zoomAnchor = null, zoomRaf = 0;
    function stopZoom() { if (zoomRaf) cancelAnimationFrame(zoomRaf); zoomRaf = 0; zoomTarget = null; }
    function zoomStep() {
      zoomRaf = 0; if (zoomTarget == null) return;
      var k = view.scale * Math.pow(zoomTarget / view.scale, 0.3);
      if (Math.abs(Math.log(zoomTarget / k)) < 0.004) { k = zoomTarget; zoomTarget = null; }
      zoomAt(k, zoomAnchor[0], zoomAnchor[1]);
      if (zoomTarget != null) zoomRaf = requestAnimationFrame(zoomStep);
    }
    function clampScale(k) { return Math.max(S.minZoom, Math.min(S.maxZoom, k)); }
    function fit(auto) {
      if (!bounds) return;
      var s = size(), pad = 24;
      var k = clampScale(Math.min((s.w - pad * 2) / (bounds.x1 - bounds.x0), (s.h - pad * 2) / (bounds.y1 - bounds.y0)));
      var cx = (bounds.x0 + bounds.x1) / 2, cy = (bounds.y0 + bounds.y1) / 2;
      if (!auto) {
        var gc = fromView([cx, cy]);
        animateTo({ ground: isoInv(gc[0], gc[1]), scale: k, done: function () { userMoved = false; } });
        return;
      }
      view.scale = k; view.cx = cx; view.cy = cy;
      applyView(true);
    }
    function zoomAt(k, mx, my) {                     // keep the point under (mx, my) fixed
      var s = size(), nk = clampScale(k);
      var wx = (mx - s.w / 2) / view.scale + view.cx, wy = (my - s.h / 2) / view.scale + view.cy;
      view.scale = nk;
      view.cx = wx - (mx - s.w / 2) / nk; view.cy = wy - (my - s.h / 2) / nk;
      userMoved = true; applyView();
    }
    function rotateTo(deg) {                         // turn about the middle of the screen, so what you look at stays put
      var sc = fromView([view.cx, view.cy]);
      setRot(deg); applyRotation();
      var c = toView(sc); view.cx = c[0]; view.cy = c[1];
      userMoved = true; applyView(true);
    }
    var rotRaf = 0, rotWant = null;                  // gestures ask for an angle; it is applied once per frame
    function scheduleRotate(deg) {
      rotWant = deg;
      if (!rotRaf) rotRaf = requestAnimationFrame(function () { rotRaf = 0; if (rotWant != null) rotateTo(rotWant); rotWant = null; });
    }

    /* ============================================================== */
    /* picking, hover, tooltip                                         */
    /* ============================================================== */
    function featureAt(x, y) {
      var n = document.elementFromPoint(x, y);
      while (n && n !== root) {
        if (n.getAttribute && n.hasAttribute("data-cm-id")) return features[+n.getAttribute("data-cm-id")];
        n = n.parentNode;
      }
      return null;
    }
    function findFeature(name) {
      for (var i = 0; i < features.length; i++) if (features[i].name === name) return features[i];
      return null;
    }
    function publicFeature(f) {
      if (!f) return null;
      var o = {};
      for (var k in f) if (k !== "el" && k !== "id" && k !== "top") o[k] = f[k];
      return o;
    }
    function paintSelection() {
      features.forEach(function (f) {
        var solid = f.kind === "building" || f.kind === "raised_area";
        var cls = (f.el.getAttribute("class") || "").replace(/ ?cm-(selected|dim|hot)/g, "");
        if (selected && f.name === selected.name) cls += " cm-selected";
        else if (selected && solid && (selected.kind === "building" || selected.kind === "raised_area")) cls += " cm-dim";
        if (hot && f === hot) cls += " cm-hot";
        f.el.setAttribute("class", cls);
      });
    }
    function showTip(f, x, y) {
      if (!S.tooltip || !f) { tip.classList.remove("cm-on"); return; }
      var info = f.info || (f.area_m2 ? f.area_m2 + " m²" : "");
      tip.innerHTML = "<b></b><span></span>";
      tip.firstChild.textContent = f.name; tip.lastChild.textContent = info;
      var r = root.getBoundingClientRect(), tw = tip.offsetWidth || 160, th = tip.offsetHeight || 40;
      var left = Math.min(x - r.left + 14, r.width - tw - 6), top = y - r.top + 14;
      if (top + th > r.height - 6) top = y - r.top - th - 12;
      tip.style.transform = "translate(" + Math.max(6, left) + "px," + Math.max(6, top) + "px)";
      tip.classList.add("cm-on");
    }
    function hideTip() { tip.classList.remove("cm-on"); }
    function selectFeature(f, x, y) {
      selected = f;
      paintSelection();
      if (f && x != null && S.tooltip === true) showTip(f, x, y); else hideTip();
      emit("select", publicFeature(f));
    }

    /* ============================================================== */
    /* gestures                                                        */
    /* ============================================================== */
    var ptrs = {}, gesture = null, down = null;
    function local(e) { var r = root.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function twoFinger() {
      var ids = Object.keys(ptrs); if (ids.length < 2) return null;
      var a = ptrs[ids[0]], b = ptrs[ids[1]];
      return { d: Math.hypot(b[0] - a[0], b[1] - a[1]), ang: Math.atan2(b[1] - a[1], b[0] - a[0]), mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
    }
    function onDown(e) {
      if (!S.gestures) return;
      stopAnim(); stopZoom();
      root.focus({ preventScroll: true });
      try { root.setPointerCapture(e.pointerId); } catch (_) {}
      ptrs[e.pointerId] = local(e);
      var n = Object.keys(ptrs).length;
      if (n === 1) {
        down = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
        var turning = e.shiftKey || e.button === 2;     // Shift+drag or right-drag turns the map
        gesture = { type: turning ? "rotate" : "pan", sx: ptrs[e.pointerId][0], sy: ptrs[e.pointerId][1], cx: view.cx, cy: view.cy, rot: S.rotation };
      } else if (n === 2) {
        var t = twoFinger();
        gesture = { type: "pinch", d0: t.d, k0: view.scale, a0: t.ang, rot0: S.rotation, turning: false };
        if (down) down.moved = true;
      }
    }
    function onMove(e) {
      if (!(e.pointerId in ptrs)) {                     // plain hover with a mouse
        if (e.pointerType === "mouse" && S.gestures !== null) {
          var f = featureAt(e.clientX, e.clientY);
          if (f) {
            if (hot !== f) { hot = f; paintSelection(); }
            if (!selected) showTip(f, e.clientX, e.clientY);
          } else if (hot) { hot = null; paintSelection(); if (!selected) hideTip(); }
        }
        return;
      }
      ptrs[e.pointerId] = local(e);
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
      if (!gesture) return;
      if (gesture.type === "pan" && down && down.moved) {
        var p = ptrs[e.pointerId];
        view.cx = gesture.cx - (p[0] - gesture.sx) / view.scale;
        view.cy = gesture.cy - (p[1] - gesture.sy) / view.scale;
        userMoved = true; root.classList.add("cm-dragging"); hideTip(); applyView();
      } else if (gesture.type === "rotate" && down && down.moved) {
        root.classList.add("cm-dragging"); hideTip();
        scheduleRotate(gesture.rot + (ptrs[e.pointerId][0] - gesture.sx) * 0.4);
      } else if (gesture.type === "pinch") {
        var t = twoFinger(); if (!t) return;
        zoomAt(gesture.k0 * t.d / gesture.d0, t.mx, t.my);
        var turn = ((t.ang - gesture.a0) * 180 / Math.PI + 540) % 360 - 180;
        if (Math.abs(turn) > 6 || gesture.turning) { gesture.turning = true; scheduleRotate(gesture.rot0 + turn); }   // a small wobble is not a twist
        hideTip();
      }
    }
    function onUp(e) {
      var wasTap = down && !down.moved && Date.now() - down.t < 450 && Object.keys(ptrs).length === 1;
      delete ptrs[e.pointerId];
      try { root.releasePointerCapture(e.pointerId); } catch (_) {}
      root.classList.remove("cm-dragging");
      if (wasTap) {
        var now = Date.now();
        if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
          fit(false); lastTap = null;                   // double tap: back to the whole campus
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
          var tf = featureAt(e.clientX, e.clientY), lvl = tf && tf.kind === "room" ? tf.level : S.floor !== "all" ? +S.floor : S.focusFloor != null ? S.focusFloor : 0, tg = toGround(e.clientX, e.clientY, lvl);
          emit("tap", { x: tg.x, y: tg.y, level: lvl, clientX: e.clientX, clientY: e.clientY, feature: publicFeature(tf) });
          selectFeature(tf, e.clientX, e.clientY);
        }
      }
      if (Object.keys(ptrs).length === 0) { gesture = null; down = null; }
      else if (Object.keys(ptrs).length === 1) {          // one finger lifted: carry on panning with the other
        var id = Object.keys(ptrs)[0];
        gesture = { type: "pan", sx: ptrs[id][0], sy: ptrs[id][1], cx: view.cx, cy: view.cy };
        down = { x: 0, y: 0, t: 0, moved: true };
      }
    }
    var lastTap = null;
    function onWheel(e) {
      if (!S.gestures) return;
      e.preventDefault();
      var p = local(e);
      stopAnim();
      if (e.shiftKey) { scheduleRotate(S.rotation + ((e.deltaY || e.deltaX) > 0 ? 8 : -8)); return; }
      var f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      if (reducedMotion()) { zoomAt(view.scale * f, p[0], p[1]); return; }
      zoomTarget = clampScale((zoomTarget || view.scale) * f); zoomAnchor = p;
      if (!zoomRaf) zoomRaf = requestAnimationFrame(zoomStep);
    }
    function onKey(e) {
      var step = 40 / view.scale, used = true;
      switch (e.key) {
        case "ArrowLeft": view.cx -= step; userMoved = true; applyView(); break;
        case "ArrowRight": view.cx += step; userMoved = true; applyView(); break;
        case "ArrowUp": view.cy -= step; userMoved = true; applyView(); break;
        case "ArrowDown": view.cy += step; userMoved = true; applyView(); break;
        case "+": case "=": animateTo({ scale: view.scale * 1.4 }, 220); break;
        case "-": case "_": animateTo({ scale: view.scale / 1.4 }, 220); break;
        case "0": fit(false); break;
        case "[": animateTo({ rotation: S.rotation - 15 }, 220); break;
        case "]": animateTo({ rotation: S.rotation + 15 }, 220); break;
        case "Escape": selectFeature(null); break;
        default: used = false;
      }
      if (used) e.preventDefault();
    }
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    root.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && !(e.pointerId in ptrs)) { hot = null; paintSelection(); if (!selected) hideTip(); } });
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("keydown", onKey);
    root.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    /* keep the view sensible when the container changes size */
    function onResize() { SZ = null; if (!userMoved) fit(true); else applyView(true); }
    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(root); else global.addEventListener("resize", onResize);

    /* ============================================================== */
    /* events                                                          */
    /* ============================================================== */
    function emit(type, payload) {
      (listeners[type] || []).slice().forEach(function (fn) { try { fn(payload); } catch (err) { setTimeout(function () { throw err; }); } });
    }

    /* ============================================================== */
    /* public API                                                      */
    /* ============================================================== */
    var api = {
      /** Change any option, e.g. map.set({ floor: 0 }). Unknown options are ignored. */
      set: function (opts) {
        var needRender = false;
        Object.keys(opts || {}).forEach(function (k) {
          if (!(k in DEFAULTS)) return;
          if (k === "rotation") { rotateTo(+opts[k] || 0); return; }
          if (S[k] !== opts[k]) { S[k] = opts[k]; if (RENDER_KEYS.indexOf(k) >= 0) needRender = true; }
        });
        if (needRender) render();
        return api;
      },
      /** Current options plus zoom. */
      get: function () { var o = {}; for (var k in S) o[k] = S[k]; o.zoom = view.scale; o.detailed = true; return o; },
      /** Show the whole campus. */
      fit: function () { fit(false); return api; },
      /** Turn the map flat on the screen, degrees clockwise (0 = as drawn). { animate: true } to turn smoothly. */
      rotateTo: function (deg, o) { if (o && o.animate) animateTo({ rotation: deg }, 350); else rotateTo(deg); return api; },
      /** Pixels per metre. */
      zoomTo: function (k, o) { var s = size(); if (o && o.animate) animateTo({ scale: k }, 250); else zoomAt(k, s.w / 2, s.h / 2); return api; },
      /** Every selectable thing on the map, for search boxes and lists. */
      features: function () { return features.map(publicFeature); },
      /** Highlight a feature by name (or null to clear). Does not fire "select". */
      highlight: function (name) { selected = name ? findFeature(name) : null; paintSelection(); hideTip(); return api; },
      /** Centre on a feature, optionally zooming in, and highlight it. */
      focus: function (name, o) {
        var f = findFeature(name); if (!f) return false;
        selected = f; paintSelection();
        animateTo({ ground: f.centre, z: (f.top || 0) / 2, scale: o && o.zoom ? o.zoom : Math.max(view.scale, 9) }, o && o.instant ? 0 : 550);   // middle of the building, not its roof peak
        return true;
      },
      /** Draw a route. points: [{x, y, level}] in metres, or [[x, y, level]]. */
      drawRoute: function (points, o) {
        var list = (points || []).map(function (p) { return Array.isArray(p) ? { x: p[0], y: p[1], level: p[2] || 0 } : p; });
        route = list.length >= 2 ? { points: list, color: o && o.color } : null;
        render();
        var len = 0;
        for (var i = 1; i < list.length; i++) len += Math.hypot(list[i].x - list[i - 1].x, list[i].y - list[i - 1].y);
        return Math.round(len * 10) / 10;
      },
      clearRoute: function () { route = null; render(); return api; },
      /** Draw or replace a named overlay. Items: {type:"marker", kind:"player|start|dest|check|arrow|diamond|dot", x, y, level, heading, color, label},
       *  {type:"polyline", points:[{x,y,level}], color, width, dash, halo}, {type:"polygon", points:[{x,y}], level, color, opacity}.
       *  Later overlays are drawn on top. Rebuilds only this overlay. */
      setOverlay: function (id, items) {
        if (!overlays[id]) { overlays[id] = { items: [], g: null }; overlayOrder.push(id); }
        overlays[id].items = items || [];
        if (gOver) { var had = overlays[id].g && overlays[id].g.parentNode === gOver; paintOverlay(id); if (!had) paintOverlayAll(); }
        return api;
      },
      clearOverlay: function (id) {
        var o = overlays[id]; if (!o) return api;
        if (o.g && o.g.parentNode) o.g.parentNode.removeChild(o.g);
        delete overlays[id]; overlayOrder = overlayOrder.filter(function (k) { return k !== id; });
        return api;
      },
      /** Fly the camera: { ground: [x, y], z, scale, linear, done }, duration in ms. */
      animateTo: function (t, ms) { animateTo(t, ms); return api; },
      stopAnimation: function () { stopAnim(); return api; },
      /** Select a feature by name as if it were tapped (fires "select"). */
      select: function (name) { selectFeature(name ? findFeature(name) : null); return api; },
      /** Ground position -> pixel position inside the map element. */
      groundToScreen: function (x, y, level) {
        var c = toView(ovPt({ x: x, y: y }, level || 0)), s = size();
        return { x: (c[0] - view.cx) * view.scale + s.w / 2, y: (c[1] - view.cy) * view.scale + s.h / 2 };
      },
      /** HTML marker that moves without repainting the map. d: { x, y, level, heading, color } */
      setSprite: function (id, d) {
        var sp = sprites[id];
        if (!sp) {
          var el = document.createElement("div"); el.className = "cm-sprite";
          el.innerHTML = '<div class="cm-halo"></div><div class="cm-arrow"></div><div class="cm-dot"></div>';
          spriteLayer.appendChild(el); sp = sprites[id] = { el: el, arrow: el.querySelector(".cm-arrow"), d: d };
        }
        sp.d = d; sp.el.style.setProperty("--c", d.color || "#1769e0"); placeSprites(); return api;
      },
      removeSprite: function (id) { var sp = sprites[id]; if (sp) { sp.el.remove(); delete sprites[id]; } return api; },
      /** Floors of the building interiors: [{ level, name }]. */
      floors: function () { return (data.interiors.floors || []).slice(); },
      /** Rendering counters for a performance overlay. */
      stats: function () { var o = {}; for (var k in stats) o[k] = stats[k]; o.zoom = view.scale; o.animating = !!anim; return o; },
      /** Client pixel position -> {x, y} in metres on the given floor level. */
      screenToGround: function (clientX, clientY, level) { return toGround(clientX, clientY, level); },
      /** Screen direction (dx right, dy down) -> unit vector [x, y] on the ground. */
      screenDirToGround: function (dx, dy, at) { return dirToGround(dx, dy, at); },
      /** Zoom and centre so that all the given {x, y, level} points are visible. */
      fitTo: function (points, o) {
        if (!points || !points.length) return api;
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, s = size(), pad = (o && o.pad) || 50;
        var pt = o && o.padTop != null ? o.padTop : pad, pb = o && o.padBottom != null ? o.padBottom : pad;   // room for the host's own controls
        points.forEach(function (p) { var c = toView(ovPt(p, p.level || 0)); x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]); });
        var k = Math.min((s.w - 2 * pad) / Math.max(x1 - x0, 1), (s.h - pt - pb) / Math.max(y1 - y0, 1));
        var sc = clampScale(Math.min(k, (o && o.maxZoom) || 14)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + (pb - pt) / 2 / sc;
        var gc = fromView([cx, cy]); animateTo({ ground: isoInv(gc[0], gc[1]), scale: sc }, o && o.instant ? 0 : 500); return api;
      },
      /** Centre the view on a ground position. opts: { zoom, lerp (0..1, for smooth following) }. */
      centerOn: function (x, y, level, o) {
        var c = toView(iso([x, y], levelZ(level) / 2));
        var t = o && o.lerp != null ? o.lerp : 1;
        view.cx += (c[0] - view.cx) * t; view.cy += (c[1] - view.cy) * t;
        if (o && o.zoom) view.scale = clampScale(o.zoom);
        userMoved = true; applyView(); return api;
      },
      /** map.on("ready" | "select" | "tap" | "viewchange", fn). Returns a function that unsubscribes. */
      on: function (type, fn) {
        (listeners[type] = listeners[type] || []).push(fn);
        return function () { listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; }); };
      },
      /** The data the map was given. */
      data: function () { return data; },
      destroy: function () {
        if (ro) ro.disconnect();
        stopAnim(); stopZoom(); clearTimeout(commitTimer);
        listeners = {}; if (root.parentNode) root.parentNode.removeChild(root);
      }
    };

    render();
    setTimeout(function () { emit("ready", { features: features.length }); }, 0);
    return api;
  }

  /** Fetch map_data.json (or any URL) and return the parsed data. */
  function load(url) {
    return fetch(url || "map_data.json").then(function (r) {
      if (!r.ok) throw new Error("CampusMap.load: " + r.status + " fetching " + url);
      return r.json();
    });
  }

  var CampusMap = { mount: mount, load: load, version: "2.1.0" };
  if (typeof module !== "undefined" && module.exports) module.exports = CampusMap;
  global.CampusMap = CampusMap;
})(typeof window !== "undefined" ? window : this);
