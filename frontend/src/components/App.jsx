/* BAC Maps: the app shell. The map fills the screen; a top bar (desktop) or a
   pill (phones) opens the card, whose views are a stack (ViewStack).
   The map is reached only through MapAdapter and Pathfinder only through
   NavAdapter (src/lib). */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import MapAdapter from "../lib/map-adapter.js";
import NavAdapter from "../lib/nav-adapter.js";
import Places from "../lib/places.js";
import ViewStack from "./ViewStack.jsx";
import Notices from "./Notices.jsx";
import { AppContext, Icon } from "./common.jsx";

const BASE = import.meta.env.BASE_URL;
const desktop = window.matchMedia("(min-width: 768px)");
let nextKey = 1;
const newEntry = (name, params) => ({ key: nextKey++, name: name, params: params || {} });

export default function App() {
  const appRef = useRef(null), mapRef = useRef(null), cardRef = useRef(null), pillRef = useRef(null), needleRef = useRef(null);
  const topSearchRef = useRef(null), topInputRef = useRef(null), pillSearchRef = useRef(null), gripRef = useRef(null);

  const [live, setLive] = useState(false);
  const [places, setPlaces] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [stack, setStack] = useState([]);
  const [floor, setFloorState] = useState("all");
  const [selected, setSelected] = useState(null);
  const [recent, setRecent] = useState([]);           // ids viewed this visit, newest first
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState(null);              // index into Places.CHIPS
  const [dirOpen, setDirOpen] = useState({});          // directory groups that are open
  const [noLogo, setNoLogo] = useState(false), [noPhoto, setNoPhoto] = useState(false);

  const focus = useRef(false);                         // move focus into the next top view
  const views = useRef(new Map());                     // view key -> its element
  const activeTrip = useRef(null);                     // the Directions view whose route is on the map
  const opener = useRef(null), refocusing = useRef(false), openedByMap = useRef(false), drag = useRef(null);
  const latest = useRef({});
  latest.current = { stack: stack, expanded: expanded, places: places, floor: floor, selected: selected };

  /* ---------------- places ---------------- */
  function placeById(id) {
    id = Places.canonicalId(id);
    return latest.current.places.find((p) => p.id === id) || null;
  }
  function placeByMapName(name) {
    return latest.current.places.find((p) => p.mapName === name && p.kind !== "room") || null;
  }
  function selectedMapName() {
    const p = placeById(latest.current.selected);
    return p && p.onMap ? p.mapName : null;
  }
  function remember(id) { setRecent((r) => [id].concat(r.filter((x) => x !== id)).slice(0, 4)); }

  /* ---------------- floors and the map ---------------- */
  function setFloor(v) { latest.current.floor = v; setFloorState(v); MapAdapter.setFloor(v); }
  /* Rooms upstairs show on the campus drawing (All or First), rooms downstairs on the ground floor cutaway */
  function showLevel(level) {
    level = level || 0;
    const f = latest.current.floor;
    if (f === "all" && level === 1) return;
    if (f !== level) setFloor(level === 0 ? 0 : (f === 0 ? "all" : level));
  }
  /* Fly to a place: rooms bring their floor into view first; the gate and entrances get a pin */
  function showOnMap(p) {
    if (!p || !p.onMap) return false;
    if (p.point) { MapAdapter.focusPoint(p.point); return true; }
    MapAdapter.focusPoint(null);
    if (p.kind === "room" && !p.roomUnmapped) showLevel(p.level);
    return MapAdapter.focus(p.mapName);
  }
  /* The parts of the map the top bar, the card or panel and the map tools leave free, in map pixels */
  function freeRects() {
    const m = mapRef.current.getBoundingClientRect();
    const rel = (r) => ({ left: r.left - m.left, top: r.top - m.top, right: r.right - m.left, bottom: r.bottom - m.top });
    const bar = rel(document.getElementById("topbar").getBoundingClientRect()), tools = rel(document.getElementById("map-tools").getBoundingClientRect());
    const wide = desktop.matches, open = latest.current.expanded;
    let top = bar.bottom, bottom = m.height, left = 0, right = m.width;
    if (wide) right = tools.left;                              // zoom and compass run down the right edge
    else if (!open) bottom = rel(pillRef.current.getBoundingClientRect()).top;
    if (!open) return [{ left, top, right, bottom }];
    const c = rel(cardRef.current.getBoundingClientRect());
    if (!wide) return [{ left, top, right, bottom: c.top }];
    return [
      { left: left, top: top, right: c.left, bottom: bottom },            // left of the panel
      { left: c.right, top: top, right: right, bottom: bottom },          // right of it
      { left: left, top: c.bottom, right: right, bottom: bottom }         // below it
    ];
  }
  /* While a route is on the map the card is shorter (app.css), so more of the map shows */
  function routeShown(on) {
    if (on) appRef.current.setAttribute("data-route", "on"); else appRef.current.removeAttribute("data-route");
  }

  /* ---------------- the view stack ---------------- */
  function push(name, params) { focus.current = true; setStack((s) => s.concat(newEntry(name, params))); }
  function pop() { focus.current = true; setStack((s) => (s.length < 2 ? s : s.slice(0, -1))); }
  function replaceTop(name, params) { setStack((s) => s.slice(0, -1).concat(newEntry(name, params))); }
  function reset(name, quiet) { focus.current = !quiet; setStack([newEntry(name)]); }
  /* Back from the start or destination picker to its Directions view, with the new trip */
  function finishPick(dirKey, trip) {
    focus.current = true;
    setStack((s) => s.slice(0, -1).map((e) => (e.key === dirKey ? { ...e, params: trip } : e)));
  }
  function openPlace(p) {
    setSelected(p.id);
    remember(p.id);
    openedByMap.current = false;
    showOnMap(p);
    push("place", { id: p.id });
  }

  /* ---------------- expand and collapse ---------------- */
  function expand(rootView, openerEl, quiet) {
    opener.current = openerEl || pillSearchRef.current;
    openedByMap.current = false;
    const s = latest.current, top = s.stack[s.stack.length - 1];
    // reopening from the pill or the top search brings back a route instead of throwing it away
    const resume = !s.expanded && rootView === "search" && top && top.name === "directions" &&
      (openerEl === pillSearchRef.current || openerEl === topInputRef.current);
    if (!resume) reset(rootView, quiet);
    else if (!quiet) focus.current = true;
    if (!s.expanded) { latest.current.expanded = true; setExpanded(true); }
  }
  function collapse() {
    if (!latest.current.expanded) return;
    latest.current.expanded = false;
    setExpanded(false);
    cardRef.current.style.transform = "";
    // give focus back to whatever opened the card, without the top search reopening it
    if (opener.current) {
      refocusing.current = true;
      opener.current.focus({ preventScroll: true });
      refocusing.current = false;
    }
  }

  /* ---------------- search ---------------- */
  function results() {
    if (chip !== null) return { mode: "list", list: Places.forChip(places, Places.CHIPS[chip]), heading: Places.CHIPS[chip].label };
    if (query.trim()) return { mode: "list", list: Places.search(places, query), heading: "Results" };
    return { mode: "recent", list: recent.map(placeById).filter(Boolean) };
  }
  /* The top bar search drives the panel's search view */
  function ensureSearch() {
    const s = latest.current, top = s.stack[s.stack.length - 1];
    if (!s.expanded || !top || top.name !== "search") expand("search", topInputRef.current, true);
  }

  /* ---------------- a tap on the map ---------------- */
  function onMapSelect(f) {
    const s = latest.current, top = s.stack[s.stack.length - 1];
    if (!f) {
      setSelected(null);
      if (s.expanded && top && top.name === "place") {
        if (openedByMap.current && s.stack.length <= 2) collapse(); else pop();
      }
      return;
    }
    const p = f.kind === "room" ? placeById("room:" + f.roomId) : placeByMapName(f.name);
    if (!p) return;                                         // e.g. "Block *", which the site leaves out
    setSelected(p.id);
    remember(p.id);
    if (!s.expanded) {
      expand("search", pillSearchRef.current);
      openedByMap.current = true;
      push("place", { id: p.id });
    } else if (top && top.name === "place") {
      replaceTop("place", { id: p.id });
    } else {
      push("place", { id: p.id });
    }
  }

  const ctx = {
    places, selected, query, setQuery, chip, setChip, dirOpen, floor,
    toggleDir: (key) => setDirOpen((d) => ({ ...d, [key]: !d[key] })),
    placeById, selectedMapName, openPlace, showOnMap, showLevel, setFloor, freeRects, routeShown, results,
    push, pop, finishPick, expand, collapse, activeTrip, onMapSelect,
    registerView: (key, el) => { if (el) views.current.set(key, el); else views.current.delete(key); },
    viewEl: (key) => views.current.get(key)
  };
  const api = useRef(ctx);
  api.current = ctx;

  /* ---------------- mount the map once ---------------- */
  useLayoutEffect(() => {
    const info = MapAdapter.init(mapRef.current);
    if (info.live) NavAdapter.init(MapAdapter.storeyHeight());    // Pathfinder builds its model after the first frame
    setLive(info.live);
    const built = Places.build(MapAdapter.places(), MapAdapter.rooms(), NavAdapter.landmark, MapAdapter.floorName);
    latest.current.places = built;
    setPlaces(built);
    const turnNeedle = () => { if (needleRef.current) needleRef.current.style.transform = "rotate(" + MapAdapter.northAngle().toFixed(1) + "deg)"; };
    const offRotate = MapAdapter.on("rotate", turnNeedle);
    requestAnimationFrame(turnNeedle);
    const offSelect = MapAdapter.on("select", (f) => api.current.onMapSelect(f));
    // on desktop the panel starts open on Search, without taking focus from the page
    if (desktop.matches) api.current.expand("search", topInputRef.current, true);
    return () => { offRotate(); offSelect(); };
  }, []);

  useLayoutEffect(() => {
    cardRef.current.inert = !expanded;
    pillRef.current.inert = expanded;
  }, [expanded]);

  /* Pointer or keyboard: focus rings a press would trigger show for keyboard users only (map-theme.css) */
  useEffect(() => {
    const onPointer = () => appRef.current.setAttribute("data-input", "pointer");
    const onKey = (e) => {
      if (e.key === "Tab" || e.key.indexOf("Arrow") === 0) appRef.current.setAttribute("data-input", "keyboard");
      if (e.key === "Escape" && latest.current.expanded) { e.preventDefault(); api.current.collapse(); }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onPointer, true); document.removeEventListener("keydown", onKey, true); };
  }, []);

  /* On desktop the panel drops down under the top search: centred on it, at least 360 px wide, kept on screen */
  useEffect(() => {
    const card = cardRef.current, search = topSearchRef.current;
    function align() {
      if (!desktop.matches) { card.style.removeProperty("--dock-left"); card.style.removeProperty("--dock-width"); return; }
      const r = search.getBoundingClientRect(), edge = 12;
      const w = Math.min(Math.max(r.width, 360), window.innerWidth - 2 * edge);
      const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, edge), window.innerWidth - edge - w);
      card.style.setProperty("--dock-left", left + "px");
      card.style.setProperty("--dock-width", w + "px");
    }
    window.addEventListener("resize", align);
    const ro = window.ResizeObserver ? new ResizeObserver(align) : null;
    if (ro) ro.observe(search);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(align);
    align();
    return () => { window.removeEventListener("resize", align); if (ro) ro.disconnect(); };
  }, []);

  /* For the console and the browser tests (tests/e2e_site.py, tests/e2e_profile.py) */
  useEffect(() => {
    window.CampusApp = {
      get state() {
        const s = latest.current;
        return { stack: s.stack.map((e) => ({ name: e.name, params: e.params, el: views.current.get(e.key) })), places: s.places, floor: s.floor, expanded: s.expanded, selected: s.selected };
      },
      push: (n, p) => api.current.push(n, p),
      pop: () => api.current.pop(),
      expand: (n, o, q) => api.current.expand(n || "search", o, q),
      collapse: () => api.current.collapse()
    };
  }, []);

  /* Drag the grip down to collapse (phones); a plain tap on the handle collapses too */
  const grip = {
    onPointerDown: (e) => {
      if (!expanded || e.button > 0) return;
      drag.current = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0 };
      gripRef.current.setPointerCapture(e.pointerId);
      cardRef.current.classList.add("is-dragging");
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      d.dy = Math.max(0, e.clientY - d.y);
      cardRef.current.style.transform = "translateY(" + d.dy + "px)";
    }
  };
  function endDrag(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const speed = d.dy / Math.max(1, performance.now() - d.t);
    drag.current = null;
    cardRef.current.classList.remove("is-dragging");
    cardRef.current.style.transform = "";
    if (d.dy > 80 || (d.dy > 24 && speed > 0.5)) collapse();
    gripRef.current.dataset.dragged = d.dy > 6 ? "1" : "";
  }

  const floorButton = (v, label) => (
    <button type="button" className="seg" data-floor={String(v)} aria-pressed={String(floor === v)} onClick={() => setFloor(v)}>{label}</button>
  );
  const avatar = (id, extra, onClick) => (
    <button type="button" className={"pill-avatar" + (extra ? " " + extra : "") + (noPhoto ? " no-photo" : "")} id={id}
      aria-label="Profile" title={extra ? "Profile" : undefined} aria-controls="card" onClick={onClick}>
      <img src={BASE + "assets/profile.png"} alt="" width="40" height="40" onError={() => setNoPhoto(true)} />
      <span className="avatar-fallback"><Icon name="user" /></span>
    </button>
  );

  return (
    <AppContext.Provider value={ctx}>
      <main className="app" id="app" ref={appRef} data-dock={expanded ? "expanded" : "collapsed"} data-map={live ? "live" : "placeholder"}>
        <h1 className="sr-only">BAC Maps, Botswana Accountancy College</h1>

        {/* The map module (or the placeholder) mounts here. Only map-adapter.js touches it. */}
        <div id="campus-map" className="map" ref={mapRef} />

        <header className="topbar" id="topbar">
          <div className="topbar-left">
            <div className={"brand" + (noLogo ? " no-logo" : "")} id="brand-logo">
              <img src={BASE + "assets/bac-logo.png"} alt="BAC, Botswana Accountancy College" onError={() => setNoLogo(true)} />
              <span className="logo-fallback" aria-hidden="true">bac</span>
              <span className="wordmark desktop-only" aria-hidden="true">Maps</span>
            </div>
            <div className="map-controls raised" id="map-controls">
              <div className="floor-switch" role="group" aria-label="Floor">
                {floorButton("all", "All")}{floorButton(0, "Ground")}{floorButton(1, "First")}
              </div>
              <button type="button" className="icon-btn btn-whole phone-only" id="whole-campus" aria-label="Whole campus" title="Whole campus" onClick={() => MapAdapter.fit()}>
                <Icon name="fit" />
              </button>
            </div>
          </div>

          <form className="top-search raised desktop-only" id="top-search" role="search" ref={topSearchRef}
            onSubmit={(e) => { e.preventDefault(); ensureSearch(); const first = results().list[0]; if (first) openPlace(first); }}>
            <label className="sr-only" htmlFor="top-search-input">Search places on campus</label>
            <input type="search" id="top-search-input" placeholder="Dumela! Where to on campus?" autoComplete="off" enterKeyHint="search" ref={topInputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setChip(null); ensureSearch(); }}
              onFocus={() => { if (!latest.current.expanded && !refocusing.current) expand("search", topInputRef.current, true); }}
              onClick={() => { if (!latest.current.expanded) expand("search", topInputRef.current, true); }}
              onKeyDown={(e) => { if (e.key === "Escape" && latest.current.expanded) { e.stopPropagation(); collapse(); } }} />
            <button type="button" className="icon-btn top-search-clear" id="top-search-clear" aria-label="Clear search" hidden={!query}
              onClick={() => { setQuery(""); setChip(null); ensureSearch(); topInputRef.current.focus(); }}>
              <Icon name="close" />
            </button>
            <button type="submit" className="top-search-go" aria-label="Search"><Icon name="search" /></button>
          </form>

          <div className="top-actions desktop-only">
            <button type="button" className="icon-btn" id="top-directory" aria-label="Directory" title="Directory" onClick={(e) => expand("directory", e.currentTarget)}>
              <Icon name="directory" />
            </button>
            {avatar("top-avatar", "top-avatar", (e) => expand("profile", e.currentTarget))}
          </div>
        </header>

        <div className="map-tools" id="map-tools">
          <button type="button" className="raised icon-btn compass" id="compass" aria-label="Compass. Reset map rotation" onClick={() => MapAdapter.faceNorth()}>
            <span className="compass-tile"><span className="compass-needle" id="compass-needle" ref={needleRef}><Icon name="compass" /></span></span>
          </button>
          <button type="button" className="raised icon-btn tool desktop-only" id="fit-campus" aria-label="Whole campus" title="Whole campus" onClick={() => MapAdapter.fit()}>
            <Icon name="fit" />
          </button>
          <div className="zoom raised desktop-only" role="group" aria-label="Zoom">
            <button type="button" className="icon-btn" id="zoom-in" aria-label="Zoom in" onClick={() => MapAdapter.zoomBy(1.5)}><Icon name="plus" /></button>
            <button type="button" className="icon-btn" id="zoom-out" aria-label="Zoom out" onClick={() => MapAdapter.zoomBy(1 / 1.5)}><Icon name="minus" /></button>
          </div>
        </div>

        {/* Collapsed: the pill */}
        <div className="pill raised" id="pill" ref={pillRef}>
          {avatar("pill-avatar", null, (e) => expand("profile", e.currentTarget))}
          <button type="button" className="pill-prompt" id="pill-search" ref={pillSearchRef} aria-controls="card" aria-expanded={String(expanded)}
            onClick={() => expand("search", pillSearchRef.current)}>
            Dumela! Where to on campus?
          </button>
          <button type="button" className="icon-btn pill-dir" id="pill-directory" aria-label="Directory" aria-controls="card" aria-expanded={String(expanded)}
            onClick={(e) => expand("directory", e.currentTarget)}>
            <Icon name="directory" />
          </button>
        </div>

        {/* Expanded: the card. Views slide inside #views. */}
        <section className="card" id="card" aria-label="BAC Maps" ref={cardRef}>
          <div className="card-grip" id="card-grip" ref={gripRef} {...grip} onPointerUp={endDrag} onPointerCancel={endDrag}>
            <button type="button" className="handle" id="card-handle" aria-label="Collapse"
              onClick={() => { if (gripRef.current.dataset.dragged) { gripRef.current.dataset.dragged = ""; return; } collapse(); }}>
              <span />
            </button>
          </div>
          <div className="card-tools">
            <button type="button" className="icon-btn desktop-only" id="card-min" aria-label="Minimise" onClick={collapse}><Icon name="minus" /></button>
            <button type="button" className="icon-btn" id="card-close" aria-label="Close" onClick={collapse}><Icon name="close" /></button>
          </div>
          <div className="views" id="views"><ViewStack stack={stack} focus={focus} /></div>
          <Notices />
        </section>
      </main>
    </AppContext.Provider>
  );
}
