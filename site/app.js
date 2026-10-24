/* BAC Maps: page logic.
 *
 * Talks to the map only through MapAdapter. UI state lives in `state`, and
 * each card view is a render function, so the structure ports to React or
 * JSP components without a rewrite.
 */
(function () {
  "use strict";

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  var app = $("#app"), pill = $("#pill"), card = $("#card"), viewsEl = $("#views");
  var controls = $("#map-controls"), needle = $("#compass-needle");
  var pillSearch = $("#pill-search"), pillDir = $("#pill-directory");
  var topInput = $("#top-search-input"), topClear = $("#top-search-clear");

  var state = {
    expanded: false,
    stack: [],          // [{ name, params, el }]
    floor: "all",
    opener: null        // element to return focus to on collapse
  };

  Icons.hydrate(document);

  /* Remember whether the last input was a press or the keyboard, so focus
     rings that a press would trigger (the map focuses itself on every press)
     can show for keyboard users only. See map-theme.css. */
  document.addEventListener("pointerdown", function () { app.setAttribute("data-input", "pointer"); }, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Tab" || e.key.indexOf("Arrow") === 0) app.setAttribute("data-input", "keyboard");
  }, true);
  var mapInfo = MapAdapter.init($("#campus-map"));
  app.setAttribute("data-map", mapInfo.live ? "live" : "placeholder");
  // Pathfinder builds its model once the map's first frame is on screen
  if (mapInfo.live) NavAdapter.init(MapAdapter.storeyHeight());

  /* ================================================================ */
  /* Map controls                                                      */
  /* ================================================================ */
  /* One floor state for the switcher and the map: "all", 0 (the ground
     floor cutaway drawing) or 1. */
  function setFloor(v) {
    state.floor = v;
    controls.querySelectorAll("[data-floor]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-floor") === String(v)));
    });
    MapAdapter.setFloor(v);
  }
  /* Make sure a floor level is in view: rooms upstairs show on the campus
     drawing (All or First), rooms downstairs on the ground floor cutaway. */
  function showLevel(level) {
    level = level || 0;
    if (state.floor === "all" && level === 1) return;
    if (state.floor !== level) setFloor(level === 0 ? 0 : (state.floor === 0 ? "all" : level));
  }
  controls.querySelectorAll("[data-floor]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var v = btn.getAttribute("data-floor");
      setFloor(v === "all" ? "all" : +v);
    });
  });
  $("#whole-campus").addEventListener("click", function () { MapAdapter.fit(); });
  $("#compass").addEventListener("click", function () { MapAdapter.faceNorth(); });

  function turnNeedle() {
    needle.style.transform = "rotate(" + MapAdapter.northAngle().toFixed(1) + "deg)";
  }
  MapAdapter.on("rotate", turnNeedle);
  requestAnimationFrame(turnNeedle);


  /* ================================================================ */
  /* Places                                                            */
  /* ================================================================ */
  state.places = Places.build(MapAdapter.places(), MapAdapter.rooms(), NavAdapter.landmark, MapAdapter.floorName);
  state.selected = null;     // id of the selected place
  state.query = "";
  state.chip = null;         // index into Places.CHIPS
  state.dirOpen = {};        // directory groups that are expanded
  state.openedByMap = false; // card was opened by tapping the map
  state.recent = [];         // ids viewed this visit, newest first (kept in memory only)
  var activeTrip = null;     // the Directions view whose route is on the map

  /* The parts of the map that the top bar, the card or panel and the map
     tools leave free, in map pixels. A route or pin is placed in the one
     where it shows largest: beside the desktop panel, below it, or above
     the phone card. */
  function freeRects() {
    var m = $("#campus-map").getBoundingClientRect();
    function rel(r) { return { left: r.left - m.left, top: r.top - m.top, right: r.right - m.left, bottom: r.bottom - m.top }; }
    var bar = rel($("#topbar").getBoundingClientRect()), tools = rel($("#map-tools").getBoundingClientRect());
    var wide = window.matchMedia("(min-width: 768px)").matches;
    var top = bar.bottom, bottom = m.height, left = 0, right = m.width;
    if (wide) right = tools.left;                              // zoom and compass run down the right edge
    else bottom = state.expanded ? bottom : rel(pill.getBoundingClientRect()).top;
    if (!state.expanded) return [{ left: left, top: top, right: right, bottom: bottom }];
    var c = rel(card.getBoundingClientRect());
    if (!wide) return [{ left: left, top: top, right: right, bottom: c.top }];
    return [
      { left: left, top: top, right: c.left, bottom: bottom },            // left of the panel
      { left: c.right, top: top, right: right, bottom: bottom },          // right of it
      { left: left, top: c.bottom, right: right, bottom: bottom }         // below it
    ];
  }
  /* While a route is on the map the card is shorter (see app.css), so more
     of the map shows around it. */
  function routeShown(on) {
    if (on) app.setAttribute("data-route", "on"); else app.removeAttribute("data-route");
  }

  function remember(id) {
    state.recent = [id].concat(state.recent.filter(function (r) { return r !== id; })).slice(0, 4);
  }

  function placeById(id) {
    id = Places.canonicalId(id);
    for (var i = 0; i < state.places.length; i++) if (state.places[i].id === id) return state.places[i];
    return null;
  }
  /* Fly to a place: rooms bring their floor into view first; the gate and
     entrances, which have a position but no shape, get a pin. */
  function showOnMap(p) {
    if (!p || !p.onMap) return false;
    if (p.point) { MapAdapter.focusPoint(p.point); return true; }
    MapAdapter.focusPoint(null);
    if (p.kind === "room" && !p.roomUnmapped) showLevel(p.level);
    return MapAdapter.focus(p.mapName);
  }
  function placeByMapName(name) {
    for (var i = 0; i < state.places.length; i++) {
      var p = state.places[i];
      if (p.mapName === name && p.kind !== "room") return p;
    }
    return null;
  }
  function selectedMapName() {
    var p = placeById(state.selected);
    return p && p.onMap ? p.mapName : null;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* Category icon on its tint tile */
  function tile(categoryKey, size) {
    var c = Places.category(categoryKey);
    var t = el("span", "tile cat-" + c.key + (size ? " tile-" + size : ""));
    t.innerHTML = Icons.svg(c.icon);
    return t;
  }

  /* Second line of a row. Inside a directory group the category is already
     the heading, so only rooms and unmapped places get a note there. */
  function metaText(p, inGroup) {
    var note = p.parent ? "Inside " + p.parent + (p.floorName ? ", " + p.floorName.toLowerCase() : "") : (!p.onMap ? "Not on the map yet" : "");
    if (inGroup) return note;
    var label = Places.category(p.category).label;
    return note ? label + ", " + note.charAt(0).toLowerCase() + note.slice(1) : label;
  }

  /* Where a class is: a group class's room ("Lab 1 (room 017), Main Building",
     "Online"), or the place the user picked for their own class */
  function whereText(c, p) {
    if (c.roomLabel) return c.roomLabel;
    return p ? p.name : "Place not found";
  }

  /* One result or directory row: icon tile, name, category. Distances
     appear in Directions, where they are measured from a real start. */
  function placeRow(p, inGroup) {
    var li = el("li");
    var b = el("button", "row");
    b.type = "button";
    b.setAttribute("data-place", p.id);
    if (p.id === state.selected) b.setAttribute("aria-current", "true");
    b.appendChild(tile(p.category));
    var text = el("span", "row-text");
    text.appendChild(el("span", "row-name", p.name));
    var meta = metaText(p, inGroup);
    if (meta) text.appendChild(el("span", "row-meta", meta));
    b.appendChild(text);
    b.insertAdjacentHTML("beforeend", Icons.svg("chevron-right", "row-chevron"));

    b.addEventListener("click", function () { openPlace(p); });
    // preview on the map without moving it
    function preview() { if (p.onMap && p.mapName) MapAdapter.highlight(p.mapName); }
    function unpreview() { MapAdapter.highlight(selectedMapName()); }
    b.addEventListener("mouseenter", preview);
    b.addEventListener("mouseleave", unpreview);
    b.addEventListener("focus", preview);
    b.addEventListener("blur", unpreview);
    li.appendChild(b);
    return li;
  }

  /* Keep the selected row marked in every open view */
  function markSelectedRows() {
    viewsEl.querySelectorAll("[data-place]").forEach(function (b) {
      if (b.getAttribute("data-place") === state.selected) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
  }

  /* Tap a result: fly to it on the map and open its details */
  function openPlace(p) {
    state.selected = p.id;
    remember(p.id);
    state.openedByMap = false;
    showOnMap(p);
    markSelectedRows();
    push("place", { id: p.id });
  }

  /* ================================================================ */
  /* Views                                                             */
  /* ================================================================ */
  /* Each view: { title, render(body, params, head) }. Search draws its own
     header (the search field) instead of a title. */
  var VIEWS = {
    search: {
      title: "Search",
      head: function (head, params, view) {
        // desktop: the search lives in the top bar, so the panel greets instead
        var greet = el("h2", "view-title greet");
        greet.tabIndex = -1;
        greet.appendChild(el("span", "label-hi", "Dumela!"));
        head.appendChild(greet);
        var field = el("label", "search-field");
        field.innerHTML = Icons.svg("search") +
          '<span class="sr-only">Search places on campus</span>' +
          '<input type="search" id="search-input" placeholder="Search a building or service" autocomplete="off" enterkeyhint="search">' +
          '<button type="button" class="icon-btn clear-btn" aria-label="Clear search" hidden>' + Icons.svg("close") + "</button>";
        head.appendChild(field);
      },
      render: function (body, params, head) {
        var input = $("#search-input", head), clear = $(".clear-btn", head);
        var chips = el("div", "chips");
        chips.setAttribute("role", "group");
        chips.setAttribute("aria-label", "Quick picks");
        var results = el("div", "results");
        // announce only the count, not the whole list, as the user types
        var announce = el("p", "sr-only");
        announce.setAttribute("role", "status");
        // info banner, like the reference's "We found 4 potential places"
        var banner = el("div", "info");
        banner.innerHTML = '<span class="info-icon">' + Icons.svg("info") + "</span>";
        banner.appendChild(el("span", "info-text", state.places.length + " places on campus"));
        var showList = el("button", "btn-small", "Show list");
        showList.type = "button";
        showList.addEventListener("click", function () { push("directory"); });
        banner.appendChild(showList);
        var picksHead = el("h3", "section-heading", "Quick picks");
        body.appendChild(banner); body.appendChild(picksHead);
        body.appendChild(chips); body.appendChild(announce); body.appendChild(results);

        Places.CHIPS.forEach(function (chip, i) {
          var b = el("button", "chip cat-" + chip.category);
          b.type = "button";
          b.setAttribute("aria-pressed", "false");
          b.innerHTML = Icons.svg(Places.category(chip.category).icon) + "<span></span>";
          b.lastChild.textContent = chip.label;
          b.addEventListener("click", function () {
            state.chip = state.chip === i ? null : i;
            if (state.chip !== null) { state.query = ""; input.value = ""; }
            update();
          });
          chips.appendChild(b);
        });

        function update() {
          clear.hidden = !input.value;
          if (topInput.value !== state.query) topInput.value = state.query;
          topClear.hidden = !state.query;
          chips.querySelectorAll(".chip").forEach(function (b, i) { b.setAttribute("aria-pressed", String(state.chip === i)); });
          results.innerHTML = "";
          announce.textContent = "";
          var list, heading;
          if (state.chip !== null) {
            list = Places.forChip(state.places, Places.CHIPS[state.chip]);
            heading = Places.CHIPS[state.chip].label;
          } else if (state.query.trim()) {
            list = Places.search(state.places, state.query);
            heading = "Results";
          } else {
            var recent = state.recent.map(placeById).filter(Boolean);
            if (recent.length) {
              results.appendChild(el("h3", "section-heading", "Recently viewed"));
              var rl = el("ul", "rows");
              recent.forEach(function (p) { rl.appendChild(placeRow(p)); });
              results.appendChild(rl);
            } else {
              results.appendChild(el("p", "hint", "Search for a place, or pick one of the quick picks above."));
            }
            return;
          }
          announce.textContent = list.length ? list.length + (list.length === 1 ? " place" : " places") + " found" : "No places found";
          if (!list.length) {
            var empty = el("div", "empty");
            empty.appendChild(el("p", null, "No places match “" + state.query.trim() + "”."));
            var dir = el("button", "link-btn", "Browse the directory");
            dir.type = "button";
            dir.addEventListener("click", function () { push("directory"); });
            empty.appendChild(dir);
            results.appendChild(empty);
            return;
          }
          var h = el("h3", "list-heading", heading + " ");
          h.appendChild(el("span", "count", String(list.length)));
          var ul = el("ul", "rows");
          list.forEach(function (p) { ul.appendChild(placeRow(p)); });
          results.appendChild(h); results.appendChild(ul);
        }

        input.value = state.query;
        input.addEventListener("input", function () {
          state.query = input.value;
          state.chip = null;
          update();
        });
        input.addEventListener("keydown", function (e) {
          if (e.key !== "Enter") return;
          var first = results.querySelector("[data-place]");
          if (first) { e.preventDefault(); first.click(); }
        });
        clear.addEventListener("click", function () {
          input.value = ""; state.query = ""; state.chip = null;
          update(); input.focus();
        });
        update();
      }
    },

    place: {
      title: function (params) { var p = placeById(params.id); return p ? p.name : "Place"; },
      render: function (body, params) {
        var p = placeById(params.id);
        if (!p) { body.appendChild(el("p", "hint", "This place is no longer on the map.")); return; }

        var cat = el("div", "place-cat");
        cat.appendChild(tile(p.category, "lg"));
        cat.appendChild(el("span", null, Places.category(p.category).label));
        body.appendChild(cat);

        // Only facts the data actually has. No hours or descriptions are invented.
        var facts = el("dl", "facts");
        function fact(label, value, note) {
          var row = el("div", "fact");
          row.appendChild(el("dt", null, label));
          var dd = el("dd", null, value);
          if (note) dd.appendChild(el("span", "fact-note", " " + note));
          row.appendChild(dd);
          facts.appendChild(row);
        }
        if (p.parent) fact("Location", "Inside " + p.parent);
        if (p.floorName) fact("Floor", p.floorName);
        if (p.roomType) fact("Room", p.roomType.charAt(0).toUpperCase() + p.roomType.slice(1), p.approx ? "(layout approximate)" : null);
        if (p.floors) fact("Floors", String(p.floors), p.floorsAssumed ? "(assumed, not yet confirmed)" : null);
        if (p.reachedFrom) fact("Access", p.reachedFrom === 1 ? "From the first floor" : "From floor " + p.reachedFrom);
        if (facts.children.length) body.appendChild(facts);
        if (p.description) body.appendChild(el("p", "place-desc", p.description));

        var actions = el("div", "actions");
        var go = el("button", "btn btn-primary");
        go.type = "button";
        go.innerHTML = Icons.svg("directions") + "<span>Directions</span>";
        go.addEventListener("click", function () { push("directions", { id: p.id }); });
        actions.appendChild(go);
        if (p.onMap) {
          var show = el("button", "btn btn-secondary");
          show.type = "button";
          show.innerHTML = Icons.svg("pin") + "<span>Show on map</span>";
          show.addEventListener("click", function () {
            showOnMap(p);
            collapse();          // get the card out of the way so the place is visible
          });
          actions.appendChild(show);
        }
        // Save to the profile's saved places (kept on this device)
        var keep = el("button", "btn btn-secondary btn-save");
        keep.type = "button";
        function syncKeep() {
          var on = Store.saved.has(p.id);
          keep.setAttribute("aria-pressed", String(on));
          keep.innerHTML = Icons.svg(on ? "bookmark-filled" : "bookmark") + "<span>" + (on ? "Saved" : "Save") + "</span>";
        }
        keep.addEventListener("click", function () { Store.saved.toggle(p.id); syncKeep(); });
        syncKeep();
        actions.appendChild(keep);
        body.appendChild(actions);
        if (!p.onMap) body.appendChild(el("p", "hint", "This place is not drawn on the map yet."));
        else if (p.roomUnmapped) body.appendChild(el("p", "hint", "The drawings don’t show this room yet, so the map shows the " + p.parent + " and directions go there."));
        // Pathfinder's own word on whether a route can reach it
        var reach = el("p", "hint");
        reach.hidden = true;
        body.appendChild(reach);
        NavAdapter.ready().then(function () {
          var np = NavAdapter.place(p.navId);
          if (!np || np.reachable) return;
          reach.textContent = NavAdapter.clean(np.why || p.name + " has no entrance on the map yet, so no route can reach it.");
          reach.hidden = false;
        });
      }
    },

    /* Directions, worked out by Pathfinder (web/nav-engine.js) through
       NavAdapter. The start is the user's location, or the Main Gate when we
       can't place them on campus, unless another place is chosen as From.
       The route is drawn on the map; its summary and steps are listed here. */
    directions: {
      title: "Directions",
      render: function (body, params) {
        var dest = placeById(params.id);
        var fromPlace = params.from && params.from !== "me" ? placeById(params.from) : null;
        var token = {};                 // a newer Directions view makes this one's answers stale
        activeTrip = token;
        params._token = token;

        var trip = el("div", "trip");
        // From: the user's location by default; tap to start somewhere else
        var from = el("button", "trip-row trip-pick trip-from");
        from.type = "button";
        if (fromPlace) from.appendChild(tile(fromPlace.category));
        else from.innerHTML = '<span class="trip-icon trip-icon-me">' + Icons.svg("location") + "</span>";
        var fromText = el("span", "trip-text");
        fromText.appendChild(el("span", "trip-label", "From"));
        var fromValue = el("span", "trip-value", fromPlace ? fromPlace.name : "Your location");
        fromText.appendChild(fromValue);
        from.appendChild(fromText);
        from.insertAdjacentHTML("beforeend", Icons.svg("chevron-right", "row-chevron"));
        from.setAttribute("aria-label", "From: " + (fromPlace ? fromPlace.name : "your location") + ". Change start");
        from.addEventListener("click", function () { push("pick", { id: params.id, from: params.from, field: "from" }); });
        // To: tap to choose another place
        var to = el("button", "trip-row trip-pick trip-to");
        to.type = "button";
        to.setAttribute("aria-label", "To: " + (dest ? dest.name : "choose a place") + ". Change destination");
        to.appendChild(dest ? tile(dest.category) : el("span", "tile"));
        var toText = el("span", "trip-text");
        toText.appendChild(el("span", "trip-label", "To"));
        toText.appendChild(el("span", "trip-value", dest ? dest.name : "Choose a place"));
        to.appendChild(toText);
        to.insertAdjacentHTML("beforeend", Icons.svg("chevron-right", "row-chevron"));
        to.addEventListener("click", function () { push("pick", { id: params.id, from: params.from, field: "to" }); });
        trip.appendChild(from);
        trip.appendChild(el("span", "trip-line"));
        trip.appendChild(to);
        body.appendChild(trip);

        var status = el("div", "loc-status");
        status.setAttribute("role", "status");
        body.appendChild(status);

        var out = el("div", "route");
        out.setAttribute("aria-live", "polite");
        body.appendChild(out);

        /* ---------------- route ---------------- */
        function specFor(p) {
          if (!p) return null;
          if (p.point) return { x: p.point.x, y: p.point.y, level: p.point.level || 0, name: p.name };
          return p.navId ? { place: p.navId } : null;
        }
        function gateSpec() {
          var g = NavAdapter.landmark("Main Gate");
          return g ? { x: g.x, y: g.y, level: 0, name: "Main Gate" } : null;
        }
        function startSpec() {
          if (fromPlace) return specFor(fromPlace);
          var loc = Locator.current();
          if (loc.status === "found") return { x: loc.x, y: loc.y, level: 0, name: "Your location" };
          return gateSpec();
        }
        function sameSpot(a, b) {
          if (!a || !b) return false;
          if (a.place || b.place) return a.place === b.place;
          return (a.level || 0) === (b.level || 0) && Math.hypot(a.x - b.x, a.y - b.y) < 5;
        }

        function message(title, text, extra) {
          MapAdapter.stopWalk();
          MapAdapter.clearRoute();
          routeShown(false);
          out.innerHTML = "";
          var box = el("div", "soon");
          box.appendChild(el("p", "soon-title", title));
          if (text) box.appendChild(el("p", null, text));
          if (extra) box.appendChild(extra);
          out.appendChild(box);
        }

        var lastStart = null;
        function compute(force) {
          var s = startSpec(), t = specFor(dest);
          if (!force && lastStart && sameSpot(s, lastStart)) return;   // GPS jitter: same route
          lastStart = s;
          if (!dest) return message("Choose a destination", "Tap To above to pick where you want to go.");
          if (!t) return message("No route yet", dest.name + " has no position on the map yet, so Pathfinder can’t route there.");
          if (!s) return message("No start", (fromPlace ? fromPlace.name : "The Main Gate") + " has no position on the map yet, so Pathfinder can’t route from there.");
          if (sameSpot(s, t)) return message("You’re already there", null);
          run(s, t, false);
        }
        function run(s, t, isRetry) {
          out.innerHTML = "";
          var busy = el("div", "loc-status is-locating");
          busy.appendChild(el("span", "spinner"));
          busy.appendChild(el("p", null, "Finding the walking route…"));
          out.appendChild(busy);
          NavAdapter.route(s, t).then(function (res) {
            if (activeTrip !== token || res.cancelled) return;
            if (res.found) { params._routes = res.routes; params._pick = 0; params._fromGate = isRetry; showRoute(); return; }
            // a GPS fix off the mapped ground: start from the Main Gate instead
            if (!isRetry && s.name === "Your location" && gateSpec()) { run(gateSpec(), t, true); return; }
            message("No route found", NavAdapter.clean(res.reason || "Pathfinder found no walkable way between these two places."));
          });
        }

        function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m"; }
        function fmtTime(s) { var m = Math.max(1, Math.round(s / 60)); return m + " min"; }

        function showRoute() {
          var routes = params._routes, r = routes[params._pick];
          MapAdapter.stopWalk();
          routeShown(true);                       // the shorter card while a route shows
          out.innerHTML = "";

          var sum = el("div", "route-summary");
          var total = el("p", "route-total");
          total.appendChild(el("span", "route-dist", fmtDist(r.length)));
          total.appendChild(el("span", "route-time", fmtTime(r.time) + " walk"));
          sum.appendChild(total);
          var notes = [];
          if (r.stairs) notes.push(r.stairs === 1 ? "1 flight of stairs" : r.stairs + " flights of stairs");
          if (r.openShare >= 0.05) notes.push("about " + Math.round(r.openShare * 100) + "% on ground that isn’t a mapped path");
          if (notes.length) sum.appendChild(el("p", "route-meta", notes.join(" · ").replace(/^./, function (c) { return c.toUpperCase(); })));
          if (params._fromGate) sum.appendChild(el("p", "route-meta", "Your position isn’t on a mapped path, so this route starts at the Main Gate."));
          out.appendChild(sum);

          if (routes.length > 1) {
            var opts = el("div", "chips route-options");
            opts.setAttribute("role", "group");
            opts.setAttribute("aria-label", "Route");
            routes.forEach(function (alt, i) {
              var b = el("button", "chip", (i ? "Alternative" : "Best route") + ", " + fmtDist(alt.length));
              b.type = "button";
              b.setAttribute("aria-pressed", String(i === params._pick));
              b.addEventListener("click", function () { if (params._pick !== i) { params._pick = i; showRoute(); } });
              opts.appendChild(b);
            });
            out.appendChild(opts);
          }

          var actions = el("div", "actions");
          var walkBtn = el("button", "btn btn-primary");
          walkBtn.type = "button";
          function syncWalk(on) {
            walkBtn.setAttribute("aria-pressed", String(on));
            walkBtn.innerHTML = Icons.svg(on ? "close" : "directions") + "<span>" + (on ? "Stop walk" : "Walk it") + "</span>";
          }
          syncWalk(false);
          walkBtn.addEventListener("click", function () {
            if (walkBtn.getAttribute("aria-pressed") === "true") { MapAdapter.stopWalk(); syncWalk(false); return; }
            showLevel(r.points[0].level);
            MapAdapter.walk(r, showLevel, function () { syncWalk(false); });
            syncWalk(true);
          });
          var clear = el("button", "btn btn-secondary");
          clear.type = "button";
          clear.innerHTML = Icons.svg("close") + "<span>Clear route</span>";
          clear.addEventListener("click", function () {
            var again = el("button", "link-btn", "Show the route again");
            again.type = "button";
            again.addEventListener("click", function () { compute(true); });
            message("Route cleared", null, again);
          });
          actions.appendChild(walkBtn); actions.appendChild(clear);
          out.appendChild(actions);

          // Steps, grouped by floor when the route changes floor
          out.appendChild(el("h3", "section-heading", "Steps"));
          var ol = el("ol", "steps"), floor = null, n = 0;
          var multi = r.points.some(function (p) { return (p.level || 0) !== (r.points[0].level || 0); });
          r.steps.forEach(function (st) {
            if (multi && st.level !== floor) { floor = st.level; ol.appendChild(el("li", "step-floor", MapAdapter.floorName(floor))); }
            var li = el("li");
            var b = el("button", "step" + (st.final ? " is-final" : ""));
            b.type = "button";
            b.appendChild(el("span", "step-num", String(++n)));
            b.appendChild(el("span", "step-text", NavAdapter.clean(st.text)));
            if (st.dist >= 1 && !st.final) b.appendChild(el("span", "step-dist", fmtDist(st.dist)));
            b.addEventListener("click", function () {
              var p = r.points[Math.min(st.index, r.points.length - 1)];
              showLevel(p.level);
              MapAdapter.focusPoint({ x: p.x, y: p.y, level: p.level }, freeRects());
            });
            li.appendChild(b);
            ol.appendChild(li);
          });
          out.appendChild(ol);
          // place the route last, once the card has its final size
          MapAdapter.showRoute(r.points, freeRects());
        }

        /* ---------------- where the user is ---------------- */
        var COPY = {
          asking: "Allow location access to start from where you are. Until then the route starts at the Main Gate.",
          locating: "Finding you on campus… Until then the route starts at the Main Gate.",
          found: "Found you. Ground floor assumed, since GPS can’t tell floors apart.",
          fallback: "We couldn’t find you on campus. Directions start from the Main Gate."
        };
        var REASON = {
          denied: "Location access is turned off for this site.",
          off_campus: "Your location is outside the campus.",
          timeout: "Your location took too long to arrive.",
          unavailable: "Location isn’t available on this device or connection."
        };

        function show(loc) {
          if (activeTrip !== token) return;
          status.className = "loc-status is-" + loc.status;
          status.innerHTML = "";
          if (loc.status !== "idle") {
            if (loc.status === "asking" || loc.status === "locating") status.appendChild(el("span", "spinner"));
            var text = el("div", "loc-text");
            text.appendChild(el("p", null, COPY[loc.status]));
            if (loc.status === "fallback" && REASON[loc.reason]) text.appendChild(el("p", "loc-reason", REASON[loc.reason]));
            status.appendChild(text);
            if (loc.status === "fallback" && loc.reason !== "denied") {
              var retry = el("button", "link-btn", "Try again");
              retry.type = "button";
              retry.addEventListener("click", startLocating);
              status.appendChild(retry);
            }
          }
          fromValue.textContent = loc.status === "found" ? "Your location" : "Main Gate";
          from.classList.toggle("is-found", loc.status === "found");
          MapAdapter.showUser(loc.status === "found" ? { x: loc.x, y: loc.y, level: 0 } : null);
          compute(false);
        }
        function startLocating() { Locator.start(MapAdapter.bounds(), MapAdapter.origin(), show); }

        if (fromPlace) {
          // starting from a chosen place: no need to watch the user's position
          if (state.locating) { Locator.stop(); state.locating = false; }
          MapAdapter.showUser(null);
          compute(true);
        } else if (state.locating) Locator.listen(show);   // back from the picker: keep the running watch
        else { state.locating = true; startLocating(); }
      },
      destroy: function (params) {
        // leaving directions (not just opening the picker on top of it)
        Locator.stop();
        state.locating = false;
        MapAdapter.showUser(null);
        if (activeTrip === params._token) {
          activeTrip = null;
          NavAdapter.cancel();
          MapAdapter.stopWalk();
          MapAdapter.clearRoute();
          MapAdapter.focusPoint(null);
          routeShown(false);
        }
      }
    },

    /* Pick the start or the destination for directions */
    pick: {
      title: function (params) { return params.field === "from" ? "Choose start" : "Choose destination"; },
      head: function (head, params) {
        var field = el("label", "search-field");
        field.innerHTML = Icons.svg("search") +
          '<span class="sr-only">' + (params.field === "from" ? "Search for a start" : "Search for a destination") + "</span>" +
          '<input type="search" id="pick-input" placeholder="Search a building, room or service" autocomplete="off">';
        head.appendChild(field);
      },
      render: function (body, params, head) {
        var picking = params.field === "from" ? "from" : "to";
        var input = $("#pick-input", head);
        var ul = el("ul", "rows");
        body.appendChild(ul);
        function choose(id) {
          pop();                                   // back to directions
          replaceTop("directions", picking === "from" ? { id: params.id, from: id } : { id: id, from: params.from }, true);
        }
        function update() {
          ul.innerHTML = "";
          var q = input.value.trim();
          if (picking === "from" && !q) {
            var li = el("li"), me = el("button", "row");
            me.type = "button";
            me.innerHTML = '<span class="tile trip-icon-me">' + Icons.svg("location") + "</span>";
            var t = el("span", "row-text");
            t.appendChild(el("span", "row-name", "Your location"));
            t.appendChild(el("span", "row-meta", "Or the Main Gate when you’re not on campus"));
            me.appendChild(t);
            me.addEventListener("click", function () { choose("me"); });
            li.appendChild(me);
            ul.appendChild(li);
          }
          var list = q ? Places.search(state.places, q) : state.places;
          list.forEach(function (p) {
            var li = placeRow(p);
            var b = li.firstChild, fresh = b.cloneNode(true);  // drop the row's usual handlers
            fresh.addEventListener("click", function () { choose(p.id); });
            li.replaceChild(fresh, b);
            ul.appendChild(li);
          });
          if (!list.length) ul.appendChild(el("li", "hint", "No places match."));
        }
        input.addEventListener("input", update);
        update();
      }
    },

    directory: {
      title: "Directory",
      render: function (body) {
        Places.CATEGORIES.forEach(function (c) {
          var items = state.places.filter(function (p) { return p.category === c.key; });
          if (!items.length) return;
          var group = el("section", "group");
          var id = "group-" + c.key;
          var head = el("button", "group-head");
          head.type = "button";
          head.setAttribute("aria-controls", id);
          head.appendChild(tile(c.key));
          var label = el("span", "group-label");
          label.appendChild(el("span", null, c.label));
          head.appendChild(label);
          head.appendChild(el("span", "count", String(items.length)));
          head.insertAdjacentHTML("beforeend", Icons.svg("chevron-down", "group-chevron"));
          var ul = el("ul", "rows");
          ul.id = id;
          items.forEach(function (p) { ul.appendChild(placeRow(p, true)); });
          function sync() {
            var open = !!state.dirOpen[c.key];
            head.setAttribute("aria-expanded", String(open));
            ul.hidden = !open;
          }
          head.addEventListener("click", function () { state.dirOpen[c.key] = !state.dirOpen[c.key]; sync(); });
          sync();
          group.appendChild(head); group.appendChild(ul);
          body.appendChild(group);
        });
      }
    },

    /* Profile: who the user is (once BAC sign in exists), where they need to
       be next on their own timetable, and the places they saved. The
       timetable and saved places stay on this device for now (store.js). */
    profile: {
      title: "Profile",
      render: function (body, params) {
        var today = new Date().getDay();
        if (params.day == null) params.day = today === 0 ? 1 : today;   // Sunday shows Monday
        var nextSlot = null;

        function sectionHead(title, action) {
          var h = el("div", "section-head");
          h.appendChild(el("h3", "section-title", title));
          if (action) h.appendChild(action);
          return h;
        }

        function statusLine(text, busy) {
          var s = el("div", "loc-status" + (busy ? " is-locating" : ""));
          s.setAttribute("role", "status");
          if (busy) s.appendChild(el("span", "spinner"));
          var t = el("div", "loc-text");
          t.appendChild(el("p", null, text));
          s.appendChild(t);
          return s;
        }
        function infoBox(icon, text) {
          var box = el("p", "info");
          box.innerHTML = '<span class="info-icon">' + Icons.svg(icon) + "</span>";
          box.appendChild(el("span", null, text));
          return box;
        }

        function draw() {
          body.innerHTML = "";

          // Until the account and timetables are known, don't show a guest
          // profile to someone who is signed in; Store.on(draw) redraws.
          if (!Store.loaded()) {
            body.appendChild(statusLine("Loading your profile and timetable…", true));
            return;
          }

          // Who: name, photo, programme and year come from BAC sign in later
          var who = el("div", "who");
          var av = el("span", "who-avatar");
          var img = new Image();
          img.alt = "";
          img.onerror = function () { av.classList.add("no-photo"); };
          img.src = "assets/profile.png";
          av.appendChild(img);
          av.insertAdjacentHTML("beforeend", '<span class="avatar-fallback">' + Icons.svg("user") + "</span>");
          var user = Store.account();
          var whoText = el("div", "who-text");
          if (user) {
            // initials until a photo exists
            av.classList.add("has-initials");
            av.appendChild(el("span", "who-initials", user.name.split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase()));
            var nameRow = el("p", "who-name", user.name + " ");
            if (user.demo) nameRow.appendChild(el("span", "demo-badge", "Demo account"));
            whoText.appendChild(nameRow);
            whoText.appendChild(el("p", "who-sub", (user.role === "staff" ? "Staff" : "Student") + ", " + user.bacNumber));
          } else {
            whoText.appendChild(el("p", "who-name", "Guest"));
            whoText.appendChild(el("p", "who-sub", "Not signed in"));
          }
          var acct;
          if (user) {
            acct = el("button", "btn btn-secondary btn-sm");
            acct.type = "button";
            acct.innerHTML = "<span>Sign out</span>";
            acct.addEventListener("click", function () { acct.disabled = true; Store.signOut(); });
          } else {
            acct = el("a", "btn btn-secondary btn-sm");
            acct.href = "login.html";
            acct.innerHTML = Icons.svg("sign-in") + "<span>Sign in</span>";
          }
          who.appendChild(av); who.appendChild(whoText); who.appendChild(acct);
          body.appendChild(who);

          // Programme and year come from the account (demo data for now)
          var facts = el("dl", "facts" + (user ? "" : " facts-muted"));
          var rows = !user ? [["Programme", "Shown after sign in"], ["Year", "Shown after sign in"]]
            : user.role === "staff" ? [["Role", "Staff"]]
            : [["Programme", user.programme || "Not set"], ["Year", user.year ? "Year " + user.year : "Not set"]];
          rows.forEach(function (f) {
            var row = el("div", "fact");
            row.appendChild(el("dt", null, f[0]));
            row.appendChild(el("dd", null, f[1]));
            facts.appendChild(row);
          });
          body.appendChild(facts);

          // My day: signed in students only. Guests get a prompt to sign in.
          if (!user) {
            body.appendChild(sectionHead("My day"));
            var locked = el("div", "info");
            locked.innerHTML = '<span class="info-icon">' + Icons.svg("calendar") + "</span>";
            var lockedText = el("span", null, "Sign in to see your class timetable, with directions to each class. ");
            var lockedLink = el("a", "link-btn", "Sign in");
            lockedLink.href = "login.html";
            lockedText.appendChild(lockedLink);
            locked.appendChild(lockedText);
            body.appendChild(locked);
          }
          if (user) {
          var add = el("button", "link-btn section-action");
          add.type = "button";
          add.innerHTML = Icons.svg("plus") + "<span>Add class</span>";
          add.addEventListener("click", function () { push("class", { day: params.day }); });
          body.appendChild(sectionHead("My day", add));

          // Class group: fills My day from the real timetable
          var groups = Store.groups();
          if (groups.length) {
            var pick = el("label", "group-pick");
            pick.appendChild(el("span", "group-pick-label", "Class group"));
            var sel = el("select");
            sel.appendChild(new Option("No group", ""));
            var byProgramme = {};
            groups.forEach(function (g) { (byProgramme[g.programme] = byProgramme[g.programme] || []).push(g); });
            Object.keys(byProgramme).forEach(function (prog) {
              var og = el("optgroup");
              og.label = prog;
              byProgramme[prog].forEach(function (g) { og.appendChild(new Option(g.code, g.code)); });
              sel.appendChild(og);
            });
            sel.value = Store.group() || "";
            var pickError = el("span", "field-error");
            pickError.hidden = true;
            sel.addEventListener("change", function () {
              sel.disabled = true;
              Store.setGroup(sel.value).catch(function (e) {
                sel.disabled = false;
                pickError.textContent = e.message;
                pickError.hidden = false;
              });
            });
            pick.appendChild(sel);
            body.appendChild(pick);
            body.appendChild(pickError);
          }

          // The group timetable's own state: loading, failed, or nothing for this group
          var ttState = Store.timetableState(), myGroup = Store.group();
          if (ttState === "loading") {
            body.appendChild(statusLine("Loading your timetable…", true));
          } else if (ttState === "error") {
            var failed = statusLine("Your class timetable couldn’t be loaded. Check your connection and try again.");
            failed.classList.add("is-fallback");
            var again = el("button", "link-btn", "Try again");
            again.type = "button";
            again.addEventListener("click", function () { again.disabled = true; Store.retryTimetables(); });
            failed.appendChild(again);
            body.appendChild(failed);
          } else if (myGroup && !Store.classes.list().some(function (c) { return c.readOnly; })) {
            body.appendChild(infoBox("calendar", "No timetable is available for " + myGroup + " yet."));
          }
          if (Store.dataError()) {
            body.appendChild(infoBox("info", "Your own classes and saved places couldn’t be loaded from the demo server. Reload the page to try again."));
          }

          if (!Store.classes.list().length) {
            if (ttState === "ok" && !myGroup) {
              body.appendChild(infoBox("calendar", groups.length
                ? "Pick your class group to see your timetable, or add your own classes."
                : "Add your classes to see where you need to be and when, with directions there."));
            }
          } else {
            nextSlot = el("div", "next-slot");
            body.appendChild(nextSlot);
            drawNext();

            var days = el("div", "days");
            days.setAttribute("role", "group");
            days.setAttribute("aria-label", "Day");
            [1, 2, 3, 4, 5, 6].forEach(function (d) {
              var b = el("button", "day" + (d === today ? " is-today" : ""), DAY_SHORT[d]);
              b.type = "button";
              b.setAttribute("aria-pressed", String(d === params.day));
              b.setAttribute("aria-label", DAY_LONG[d] + (d === today ? ", today" : ""));
              b.addEventListener("click", function () { params.day = d; draw(); body.querySelector(".day[aria-pressed=true]").focus(); });
              days.appendChild(b);
            });
            body.appendChild(days);

            var list = Store.classes.onDay(params.day);
            if (!list.length) body.appendChild(el("p", "hint", "No classes on " + DAY_LONG[params.day] + "."));
            else {
              var ul = el("ul", "rows class-rows");
              list.forEach(function (c) {
                var p = placeById(c.placeId);
                var li = el("li");
                var b = el("button", "row class-row");
                b.type = "button";
                var time = el("span", "class-time");
                time.appendChild(el("span", null, c.start));
                time.appendChild(el("span", "class-end", c.end));
                b.appendChild(time);
                var text = el("span", "row-text");
                var nameRow = el("span", "row-name", c.title);
                if (c.readOnly) nameRow.appendChild(el("span", "class-tag", c.group));
                text.appendChild(nameRow);
                text.appendChild(el("span", "row-meta", whereText(c, p)));
                b.appendChild(text);
                b.insertAdjacentHTML("beforeend", Icons.svg("chevron-right", "row-chevron"));
                b.setAttribute("aria-label", c.title + ", " + c.start + " to " + c.end + ", " + whereText(c, p) + (c.readOnly ? ". Details" : ". Edit"));
                b.addEventListener("click", function () { push(c.readOnly ? "lesson" : "class", { id: c.id }); });
                li.appendChild(b);
                ul.appendChild(li);
              });
              body.appendChild(ul);
            }
          }

          }   // end of My day for signed in students

          // Saved places
          var saved = Store.saved.list().map(placeById).filter(Boolean);
          var savedHead = sectionHead("Saved places");
          if (saved.length) savedHead.firstChild.appendChild(el("span", "count", String(saved.length)));
          body.appendChild(savedHead);
          if (!saved.length) body.appendChild(el("p", "hint", "Tap Save on any place to keep it here."));
          else {
            var sl = el("ul", "rows");
            saved.forEach(function (p) { sl.appendChild(placeRow(p)); });
            body.appendChild(sl);
          }

          // Settings: appearance, kept on this device (theme.js)
          if (window.Theme) {
            body.appendChild(sectionHead("Settings"));
            var appearance = el("div", "setting");
            appearance.appendChild(el("span", "setting-label", "Appearance"));
            var themes = el("div", "days theme-switch");
            themes.setAttribute("role", "group");
            themes.setAttribute("aria-label", "Appearance");
            [["light", "Light"], ["dark", "Dark"], ["system", "Device"]].forEach(function (t) {
              var b = el("button", "day", t[1]);
              b.type = "button";
              b.setAttribute("aria-pressed", String(Theme.get() === t[0]));
              if (t[0] === "system") b.title = "Follow this device's light or dark setting";
              b.addEventListener("click", function () {
                Theme.set(t[0]);
                themes.querySelectorAll(".day").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
              });
              themes.appendChild(b);
            });
            appearance.appendChild(themes);
            body.appendChild(appearance);
          }

          var tt = Store.timetableInfo();
          if (Store.group() && tt) {
            body.appendChild(el("p", "hint footnote", "Group timetable: " + tt.term + (tt.source ? ", from " + tt.source : "") + "."));
          }
          body.appendChild(el("p", "hint footnote", user
            ? "Your timetable and saved places are kept in the demo database."
            : "Saved places are kept on this device. Sign in to keep them with your account."));
        }

        // The card at the top of My day: what's on now, or next
        function drawNext() {
          if (!nextSlot) return;
          nextSlot.innerHTML = "";
          var n = Store.classes.next(new Date());
          if (!n) return;
          var c = n.cls, p = placeById(c.placeId);
          var when;
          if (n.status === "now") when = "On now, until " + c.end;
          else if (n.status === "later") when = n.minutes < 60 ? "Starts in " + n.minutes + " min" : "Today at " + c.start;
          else when = (n.dayOffset === 1 ? "Tomorrow" : (n.dayOffset === 7 ? "Next " : "") + DAY_LONG[(new Date().getDay() + n.dayOffset) % 7]) + " at " + c.start;

          var card = el("div", "next" + (n.status === "now" ? " is-now" : ""));
          var top = el("div", "next-top");
          top.appendChild(el("span", "next-label", n.status === "now" ? "Now" : "Next"));
          var whenEl = el("span", "next-when");
          whenEl.innerHTML = Icons.svg("clock");
          whenEl.appendChild(document.createTextNode(when));
          top.appendChild(whenEl);
          card.appendChild(top);
          card.appendChild(el("p", "next-title", c.title));
          card.appendChild(el("p", "next-where", whereText(c, p) + ", " + c.start + " to " + c.end));
          if (p) {
            var actions = el("div", "actions");
            var go = el("button", "btn btn-primary");
            go.type = "button";
            go.innerHTML = Icons.svg("directions") + "<span>Directions</span>";
            go.addEventListener("click", function () { push("directions", { id: p.id }); });
            actions.appendChild(go);
            if (p.onMap) {
              var show = el("button", "btn btn-secondary");
              show.type = "button";
              show.innerHTML = Icons.svg("pin") + "<span>Show on map</span>";
              show.addEventListener("click", function () { showOnMap(p); collapse(); });
              actions.appendChild(show);
            }
            card.appendChild(actions);
          }
          nextSlot.appendChild(card);
        }

        draw();
        params._off = Store.on(draw);                         // redraw after edits in the class view
        params._tick = setInterval(drawNext, 30000);          // keep "starts in" current
      },
      destroy: function (params) {
        if (params._off) params._off();
        clearInterval(params._tick);
      }
    },

    /* One class from the user's group timetable: read only */
    lesson: {
      title: function (params) { var c = Store.classes.get(params.id); return c ? c.title : "Class"; },
      render: function (body, params) {
        var c = Store.classes.get(params.id);
        if (!c) { body.appendChild(el("p", "hint", "This class is no longer on your timetable.")); return; }
        var p = placeById(c.placeId);
        var facts = el("dl", "facts");
        function fact(label, value) {
          var row = el("div", "fact");
          row.appendChild(el("dt", null, label));
          row.appendChild(el("dd", null, value));
          facts.appendChild(row);
        }
        fact("When", DAY_LONG[c.days[0]] + ", " + c.start + " to " + c.end);
        fact("Where", c.roomLabel);
        if (c.lecturer) fact("Lecturer", c.lecturer);
        fact("Group", c.group + (c["with"].length ? ", with all of " + c["with"].join(", ") : ""));
        body.appendChild(facts);
        if (p) {
          var actions = el("div", "actions");
          var go = el("button", "btn btn-primary");
          go.type = "button";
          go.innerHTML = Icons.svg("directions") + "<span>Directions</span>";
          go.addEventListener("click", function () { push("directions", { id: p.id }); });
          actions.appendChild(go);
          if (p.onMap) {
            var show = el("button", "btn btn-secondary");
            show.type = "button";
            show.innerHTML = Icons.svg("pin") + "<span>Show on map</span>";
            show.addEventListener("click", function () { showOnMap(p); collapse(); });
            actions.appendChild(show);
          }
          body.appendChild(actions);
        } else if (!c.placeId) {
          body.appendChild(el("p", "hint", "This class is online, so there are no directions."));
        }
        var tt = Store.timetableInfo();
        body.appendChild(el("p", "hint footnote", "From your group timetable" + (tt ? ": " + tt.term : "") + ". To change it, pick another class group in your profile."));
      }
    },

    /* Add or edit one class on the user's own timetable */
    "class": {
      title: function (params) { return params.id ? "Edit class" : "Add class"; },
      render: function (body, params) {
        var existing = params.id ? Store.classes.get(params.id) : null;
        var days = existing ? existing.days.slice() : (params.day ? [params.day] : []);

        var form = el("form", "class-form");
        form.noValidate = true;

        function field(label, control) {
          var l = el("label", "field");
          l.appendChild(el("span", "field-label", label));
          l.appendChild(control);
          return l;
        }

        var title = el("input");
        title.type = "text"; title.required = true; title.maxLength = 60;
        title.autocomplete = "off";
        title.value = existing ? existing.title : "";
        form.appendChild(field("Class name", title));

        var place = el("select");
        place.required = true;
        place.appendChild(new Option("Choose a place", ""));
        Places.CATEGORIES.forEach(function (cat) {
          var items = state.places.filter(function (p) { return p.category === cat.key; });
          if (!items.length) return;
          var g = el("optgroup");
          g.label = cat.label;
          items.forEach(function (p) { g.appendChild(new Option(p.name, p.id)); });
          place.appendChild(g);
        });
        place.value = existing ? existing.placeId : (params.placeId || "");
        form.appendChild(field("Place", place));

        var dayBox = el("fieldset", "field day-field");
        dayBox.appendChild(el("legend", "field-label", "Days"));
        var dayRow = el("div", "days");
        [1, 2, 3, 4, 5, 6].forEach(function (d) {
          var b = el("button", "day", DAY_SHORT[d]);
          b.type = "button";
          b.setAttribute("aria-label", DAY_LONG[d]);
          b.setAttribute("aria-pressed", String(days.indexOf(d) >= 0));
          b.addEventListener("click", function () {
            var i = days.indexOf(d);
            if (i >= 0) days.splice(i, 1); else days.push(d);
            b.setAttribute("aria-pressed", String(i < 0));
          });
          dayRow.appendChild(b);
        });
        dayBox.appendChild(dayRow);
        form.appendChild(dayBox);

        var times = el("div", "field-row");
        var start = el("input"); start.type = "time"; start.required = true; start.value = existing ? existing.start : "";
        var end = el("input"); end.type = "time"; end.required = true; end.value = existing ? existing.end : "";
        times.appendChild(field("Starts", start));
        times.appendChild(field("Ends", end));
        form.appendChild(times);

        var error = el("p", "field-error");
        error.hidden = true;
        error.setAttribute("role", "alert");
        form.appendChild(error);

        var actions = el("div", "actions");
        var save = el("button", "btn btn-primary");
        save.type = "submit";
        save.innerHTML = Icons.svg("bookmark") + "<span>Save class</span>";
        actions.appendChild(save);
        if (existing) {
          var del = el("button", "btn btn-secondary btn-danger");
          del.type = "button";
          del.innerHTML = Icons.svg("trash") + "<span>Delete</span>";
          var armed = false;
          del.addEventListener("click", function () {
            if (!armed) { armed = true; del.lastChild.textContent = "Tap again to delete"; return; }
            del.disabled = true;
            Store.classes.remove(existing.id).then(pop, function (e) { del.disabled = false; fail(e.message); });
          });
          actions.appendChild(del);
        }
        form.appendChild(actions);

        function fail(msg, control) {
          error.textContent = msg; error.hidden = false;
          if (control) control.focus();
        }
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          if (!title.value.trim()) return fail("Enter a class name.", title);
          if (!place.value) return fail("Choose where the class is.", place);
          if (!days.length) return fail("Choose at least one day.", dayRow.firstChild);
          if (!start.value || !end.value) return fail("Enter when the class starts and ends.", start.value ? end : start);
          if (Store.minutes(end.value) <= Store.minutes(start.value)) return fail("The class has to end after it starts.", end);
          save.disabled = true;
          Store.classes.save({
            id: existing ? existing.id : null,
            title: title.value.trim(),
            placeId: place.value,
            days: days.slice().sort(),
            start: start.value,
            end: end.value
          }).then(pop, function (e) { save.disabled = false; fail(e.message); });
        });
        body.appendChild(form);
      }
    }
  };

  var DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function buildView(name, params) {
    var def = VIEWS[name];
    var el = document.createElement("div");
    el.className = "view";
    el.setAttribute("data-view", name);

    var head = document.createElement("div");
    head.className = "view-head";
    if (state.stack.length > 0) {
      var back = document.createElement("button");
      back.type = "button";
      back.className = "icon-btn back";
      back.setAttribute("aria-label", "Back");
      back.innerHTML = Icons.svg("back");
      back.addEventListener("click", pop);
      head.appendChild(back);
    }
    var titleText = typeof def.title === "function" ? def.title(params) : def.title;
    if (def.head) {
      var h = document.createElement("h2");
      h.className = "sr-only"; h.textContent = titleText;
      head.appendChild(h);
      def.head(head, params);
    } else {
      var title = document.createElement("h2");
      title.className = "view-title"; title.tabIndex = -1;
      var hi = document.createElement("span");    // `el` is the view element here
      hi.className = "label-hi";
      hi.textContent = titleText;
      title.appendChild(hi);
      head.appendChild(title);
    }

    var body = document.createElement("div");
    body.className = "view-body";
    def.render(body, params, head);

    el.appendChild(head); el.appendChild(body);
    return el;
  }

  function slide(el, from, to) {
    if (reduceMotion.matches || !el.animate) return { finished: Promise.resolve() };
    // the view leaving fades out fully so the two never show through each other
    return el.animate([{ transform: from, opacity: from === "none" ? 1 : 0 }, { transform: to, opacity: to === "none" ? 1 : 0 }],
      { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
  }

  /* Run fn when a slide ends, or after its duration anyway: background tabs
     can hold animations back, and a view left showing would bleed through
     the card. */
  function after(anim, fn) {
    var done = false;
    function once() { if (!done) { done = true; fn(); } }
    anim.finished.then(once, once);
    setTimeout(once, 280);
  }

  function focusView(el) {
    var target = el.querySelector("#search-input") || el.querySelector(".view-title") || el.querySelector("button");
    if (target) target.focus({ preventScroll: true });
  }

  /* Open a view on top of the current one, sliding in from the right. */
  function push(name, params) {
    params = params || {};             // views may keep their own state here
    var prev = state.stack[state.stack.length - 1];
    var el = buildView(name, params);
    state.stack.push({ name: name, params: params, el: el });
    viewsEl.appendChild(el);
    if (prev) {
      slide(el, "translateX(100%)", "none");
      after(slide(prev.el, "none", "translateX(-30%)"), function () { prev.el.hidden = true; });
    }
    focusView(el);
  }

  /* Views may clean up after themselves when they leave the stack */
  function destroy(entry) {
    var def = VIEWS[entry.name];
    if (def && def.destroy) def.destroy(entry.params);
  }

  /* Go back one view, sliding the current one out to the right. */
  function pop() {
    if (state.stack.length < 2) return;
    var cur = state.stack.pop(), prev = state.stack[state.stack.length - 1];
    destroy(cur);
    prev.el.hidden = false;
    slide(prev.el, "translateX(-30%)", "none");
    after(slide(cur.el, "none", "translateX(100%)"), function () { cur.el.remove(); });
    focusView(prev.el);
  }

  /* Replace the whole stack with one root view. */
  function reset(name, params) {
    state.stack.forEach(function (v) { destroy(v); v.el.remove(); });
    state.stack = [];
    push(name, params);
  }

  /* ================================================================ */
  /* Expand and collapse                                               */
  /* ================================================================ */
  function expand(rootView, opener, quiet) {
    state.opener = opener || pillSearch;
    state.openedByMap = false;
    // Reopening from the pill or the top search brings back a route on the
    // map instead of throwing it away; typing a new search replaces it.
    var top = state.stack[state.stack.length - 1];
    var resume = !state.expanded && rootView === "search" && top && top.name === "directions" &&
      (opener === pillSearch || opener === topInput);
    if (!resume) reset(rootView);
    if (!state.expanded) {
      state.expanded = true;
      app.setAttribute("data-dock", "expanded");
      card.inert = false; pill.inert = true;
      pillSearch.setAttribute("aria-expanded", "true");
      pillDir.setAttribute("aria-expanded", "true");
    }
    if (!quiet) focusView(state.stack[state.stack.length - 1].el);
  }

  var refocusing = false;    // true while collapse() hands focus back to the opener
  function collapse() {
    if (!state.expanded) return;
    state.expanded = false;
    app.setAttribute("data-dock", "collapsed");
    card.inert = true; pill.inert = false;
    card.style.transform = "";
    pillSearch.setAttribute("aria-expanded", "false");
    pillDir.setAttribute("aria-expanded", "false");
    // Return focus to whatever opened the card. When that is the top search,
    // its focus handler would open the panel again, so tell it not to.
    if (state.opener) {
      refocusing = true;
      state.opener.focus({ preventScroll: true });
      refocusing = false;
    }
  }

  /* Swap the top view for another without sliding (map taps between places) */
  function replaceTop(name, params, keepAlive) {
    var cur = state.stack.pop();
    if (cur) { if (!keepAlive) destroy(cur); cur.el.remove(); }
    push(name, params);
    var prev = state.stack[state.stack.length - 2];
    if (prev) prev.el.hidden = true;
  }

  /* Tapping a building on the map opens its details; empty ground closes them */
  MapAdapter.on("select", function (f) {
    var top = state.stack[state.stack.length - 1];
    if (!f) {
      state.selected = null;
      markSelectedRows();
      if (state.expanded && top && top.name === "place") {
        if (state.openedByMap && state.stack.length <= 2) collapse(); else pop();
      }
      return;
    }
    var p = f.kind === "room" ? placeById("room:" + f.roomId) : placeByMapName(f.name);
    if (!p) return;                       // e.g. "Block *", which the site leaves out
    state.selected = p.id;
    remember(p.id);
    if (!state.expanded) {
      expand("search", pillSearch);
      state.openedByMap = true;
      push("place", { id: p.id });
    } else if (top && top.name === "place") {
      replaceTop("place", { id: p.id });
    } else {
      push("place", { id: p.id });
    }
    markSelectedRows();
  });

  pillSearch.addEventListener("click", function () { expand("search", pillSearch); });
  $("#card-close").addEventListener("click", collapse);
  pillDir.addEventListener("click", function () { expand("directory", pillDir); });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.expanded) { e.preventDefault(); collapse(); }
  });

  /* Drag the grip down to collapse; a plain tap on the handle collapses too. */
  (function () {
    var grip = $("#card-grip"), handle = $("#card-handle");
    var drag = null;
    grip.addEventListener("pointerdown", function (e) {
      if (!state.expanded || e.button > 0) return;
      drag = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0 };
      grip.setPointerCapture(e.pointerId);
      card.classList.add("is-dragging");
    });
    grip.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      card.style.transform = "translateY(" + drag.dy + "px)";
    });
    function end(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dy = drag.dy, speed = dy / Math.max(1, performance.now() - drag.t);
      drag = null;
      card.classList.remove("is-dragging");
      card.style.transform = "";
      if (dy > 80 || (dy > 24 && speed > 0.5)) collapse();
      grip.dataset.dragged = dy > 6 ? "1" : "";
    }
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
    handle.addEventListener("click", function () {
      if (grip.dataset.dragged) { grip.dataset.dragged = ""; return; }
      collapse();
    });
  })();


  /* On desktop the panel starts open on Search, like a docked side panel,
     without taking keyboard focus away from the page. */
  var desktop = window.matchMedia("(min-width: 768px)");
  if (desktop.matches) expand("search", topInput, true);

  /* On desktop the panel drops down under the top search. The top bar's
     grid moves the search off the page centre when the logo tab is wide,
     so the panel follows the search's real position: centred on it, at
     least 360 px wide, and kept on screen. */
  var topSearch = $("#top-search");
  function alignPanel() {
    if (!desktop.matches) { card.style.removeProperty("--dock-left"); card.style.removeProperty("--dock-width"); return; }
    var r = topSearch.getBoundingClientRect(), edge = 12;
    var w = Math.min(Math.max(r.width, 360), window.innerWidth - 2 * edge);
    var left = Math.min(Math.max(r.left + r.width / 2 - w / 2, edge), window.innerWidth - edge - w);
    card.style.setProperty("--dock-left", left + "px");
    card.style.setProperty("--dock-width", w + "px");
  }
  window.addEventListener("resize", alignPanel);
  if (window.ResizeObserver) new ResizeObserver(alignPanel).observe(topSearch);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(alignPanel);
  alignPanel();

  /* ================================================================ */
  /* Desktop top bar and map tools                                     */
  /* ================================================================ */
  /* The top bar search drives the panel's search view: it opens the panel
     on Search and forwards what is typed to the view's own field. */
  function searchView() {
    var top = state.stack[state.stack.length - 1];
    if (!state.expanded || !top || top.name !== "search") {
      // the new view syncs the top bar to state.query, so carry over what was just typed
      state.query = topInput.value; state.chip = null;
      expand("search", topInput, true);
    }
    return $("#search-input");
  }
  topInput.addEventListener("focus", function () { if (!state.expanded && !refocusing) expand("search", topInput, true); });
  // after closing, focus stays in the search, so a click there must reopen it too
  topInput.addEventListener("click", function () { if (!state.expanded) expand("search", topInput, true); });
  topInput.addEventListener("input", function () {
    var field = searchView();
    field.value = topInput.value;
    field.dispatchEvent(new Event("input"));
  });
  $("#top-search").addEventListener("submit", function (e) {
    e.preventDefault();
    var field = searchView();
    field.value = topInput.value;
    field.dispatchEvent(new Event("input"));
    var first = viewsEl.querySelector('.view[data-view="search"] [data-place]');
    if (first) first.click();
  });
  topInput.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && state.expanded) { e.stopPropagation(); collapse(); }
  });
  topClear.addEventListener("click", function () {
    var field = searchView();
    field.value = ""; topInput.value = "";
    field.dispatchEvent(new Event("input"));
    topInput.focus();
  });
  $("#top-directory").addEventListener("click", function () { expand("directory", $("#top-directory")); });
  $("#fit-campus").addEventListener("click", function () { MapAdapter.fit(); });
  $("#zoom-in").addEventListener("click", function () { MapAdapter.zoomBy(1.5); });
  $("#zoom-out").addEventListener("click", function () { MapAdapter.zoomBy(1 / 1.5); });
  $("#card-min").addEventListener("click", collapse);
  $("#top-avatar").addEventListener("click", function () { expand("profile", $("#top-avatar")); });
  $("#pill-avatar").addEventListener("click", function () { expand("profile", $("#pill-avatar")); });

  /* ================================================================ */
  /* Installable app and offline notices, at the foot of the card      */
  /* ================================================================ */
  var notices = $("#card-notices");
  function drawNotices() {
    notices.innerHTML = "";

    if (!navigator.onLine) {
      var off = el("p", "notice notice-offline");
      off.setAttribute("role", "status");
      off.innerHTML = Icons.svg("offline");
      off.appendChild(el("span", null, "You’re offline. The map still works; sign in needs a connection."));
      notices.appendChild(off);
    }

    if (window.PWA && PWA.canInstall()) {
      var row = el("div", "notice notice-install");
      row.innerHTML = '<span class="notice-icon">' + Icons.svg("download") + "</span>";
      var text = el("span", "notice-text");
      text.appendChild(el("strong", null, "Install app"));
      text.appendChild(el("span", null, "Open BAC Maps from your home screen, even offline."));
      row.appendChild(text);
      var go = el("button", "btn btn-primary btn-sm", "Install");
      go.type = "button";
      go.addEventListener("click", function () { PWA.install(); });
      row.appendChild(go);
      notices.appendChild(row);
    } else if (window.PWA && PWA.showIosHint()) {
      var hint = el("div", "notice notice-ios");
      hint.innerHTML = '<span class="notice-icon">' + Icons.svg("share") + "</span>";
      hint.appendChild(el("span", "notice-text", "Install: tap Share, then Add to Home Screen."));
      var x = el("button", "icon-btn notice-dismiss");
      x.type = "button";
      x.setAttribute("aria-label", "Dismiss install hint");
      x.innerHTML = Icons.svg("close");
      x.addEventListener("click", function () { PWA.dismissIosHint(); });
      hint.appendChild(x);
      notices.appendChild(hint);
    }
    notices.hidden = !notices.children.length;
  }
  window.addEventListener("online", drawNotices);
  window.addEventListener("offline", drawNotices);
  if (window.PWA) PWA.on(drawNotices);
  drawNotices();

  /* Exposed for the next phases and for debugging in the console. */
  window.CampusApp = { state: state, push: push, pop: pop, expand: expand, collapse: collapse, VIEWS: VIEWS };
})();
