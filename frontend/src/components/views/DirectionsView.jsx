/* Directions, worked out by Pathfinder (web/nav-engine.js) through
   NavAdapter. The start is the user's location, or the Main Gate when we
   can't place them on campus, unless another place is chosen as From.
   The route is drawn on the map; its summary and steps are listed here.
   params: { id: destination, from: "me" | place id } */
import { useEffect, useRef, useState } from "react";
import MapAdapter from "../../lib/map-adapter.js";
import NavAdapter from "../../lib/nav-adapter.js";
import Locator from "../../lib/location.js";
import { Icon, Tile, StatusLine, useApp } from "../common.jsx";

const COPY = {
  asking: "Allow location access to start from where you are. Until then the route starts at the Main Gate.",
  locating: "Finding you on campus… Until then the route starts at the Main Gate.",
  found: "Found you. Ground floor assumed, since GPS can’t tell floors apart.",
  fallback: "We couldn’t find you on campus. Directions start from the Main Gate."
};
const REASON = {
  denied: "Location access is turned off for this site.",
  off_campus: "Your location is outside the campus.",
  timeout: "Your location took too long to arrive.",
  unavailable: "Location isn’t available on this device or connection."
};

const fmtDist = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m) + " m");
const fmtTime = (s) => Math.max(1, Math.round(s / 60)) + " min";

function specFor(p) {
  if (!p) return null;
  if (p.point) return { x: p.point.x, y: p.point.y, level: p.point.level || 0, name: p.name };
  return p.navId ? { place: p.navId } : null;
}
function gateSpec() {
  const g = NavAdapter.landmark("Main Gate");
  return g ? { x: g.x, y: g.y, level: 0, name: "Main Gate" } : null;
}
function sameSpot(a, b) {
  if (!a || !b) return false;
  if (a.place || b.place) return a.place === b.place;
  return (a.level || 0) === (b.level || 0) && Math.hypot(a.x - b.x, a.y - b.y) < 5;
}

export default function DirectionsView({ params, entry }) {
  const app = useApp();
  const dest = app.placeById(params.id);
  const fromMe = !params.from || params.from === "me";
  const fromPlace = fromMe ? null : app.placeById(params.from);

  const token = useRef({}).current;               // a newer Directions view makes this one's answers stale
  const live = useRef(true);
  const [loc, setLoc] = useState({ status: "idle" });
  const [result, setResult] = useState({ kind: "busy" });   // busy | route | message
  const [pick, setPick] = useState(0);
  const [walking, setWalking] = useState(false);
  const [again, setAgain] = useState(0);           // "Show the route again"
  const lastStart = useRef(null), lastTrip = useRef(null);

  // this view's route is the one on the map; leaving it clears the map
  useEffect(() => {
    app.activeTrip.current = token;
    return () => {
      live.current = false;
      if (app.activeTrip.current !== token) return;
      app.activeTrip.current = null;
      NavAdapter.cancel();
      MapAdapter.stopWalk();
      MapAdapter.clearRoute();
      MapAdapter.focusPoint(null);
      app.routeShown(false);
    };
  }, []);

  // where the user is, while the start is "Your location"
  const startLocating = () => Locator.start(MapAdapter.bounds(), MapAdapter.origin(), (l) => { if (live.current) setLoc({ ...l }); });
  useEffect(() => {
    if (!fromMe) { setLoc({ status: "idle" }); return undefined; }
    startLocating();
    return () => { Locator.stop(); MapAdapter.showUser(null); };
  }, [fromMe]);
  useEffect(() => {
    MapAdapter.showUser(fromMe && loc.status === "found" ? { x: loc.x, y: loc.y, level: 0 } : null);
  }, [fromMe, loc.status, loc.x, loc.y]);

  // ask Pathfinder whenever the start or the destination changes
  function startSpec() {
    if (fromPlace) return specFor(fromPlace);
    if (loc.status === "found") return { x: loc.x, y: loc.y, level: 0, name: "Your location" };
    return gateSpec();
  }
  function run(s, t, isRetry) {
    setResult({ kind: "busy" });
    NavAdapter.route(s, t).then((res) => {
      if (!live.current || app.activeTrip.current !== token || res.cancelled) return;
      if (res.found) { setPick(0); setResult({ kind: "route", routes: res.routes, fromGate: isRetry }); return; }
      // a GPS fix off the mapped ground: start from the Main Gate instead
      if (!isRetry && s.name === "Your location" && gateSpec()) { run(gateSpec(), t, true); return; }
      setResult({ kind: "message", title: "No route found", text: NavAdapter.clean(res.reason || "Pathfinder found no walkable way between these two places.") });
    });
  }
  useEffect(() => {
    const trip = params.id + "|" + (params.from || "me") + "|" + again;
    const s = startSpec(), t = specFor(dest);
    if (lastTrip.current === trip && lastStart.current && sameSpot(s, lastStart.current)) return;   // GPS jitter: same route
    lastTrip.current = trip; lastStart.current = s;
    if (!dest) return setResult({ kind: "message", title: "Choose a destination", text: "Tap To above to pick where you want to go." });
    if (!t) return setResult({ kind: "message", title: "No route yet", text: dest.name + " has no position on the map yet, so Pathfinder can’t route there." });
    if (!s) return setResult({ kind: "message", title: "No start", text: (fromPlace ? fromPlace.name : "The Main Gate") + " has no position on the map yet, so Pathfinder can’t route from there." });
    if (sameSpot(s, t)) return setResult({ kind: "message", title: "You’re already there" });
    run(s, t, false);
  }, [params.id, params.from, loc.status, loc.x, loc.y, again]);

  // draw the chosen route once the panel has its final size, so it lands in the free part of the map
  const route = result.kind === "route" ? result.routes[pick] : null;
  useEffect(() => {
    MapAdapter.stopWalk();
    setWalking(false);
    if (!route) {
      if (result.kind === "message") { MapAdapter.clearRoute(); app.routeShown(false); }
      return;
    }
    app.routeShown(true);
    MapAdapter.showRoute(route.points, app.freeRects());
  }, [result, pick]);

  const toggleWalk = () => {
    if (walking) { MapAdapter.stopWalk(); setWalking(false); return; }
    app.showLevel(route.points[0].level);
    MapAdapter.walk(route, app.showLevel, () => { if (live.current) setWalking(false); });
    setWalking(true);
  };
  const pickField = (field) => app.push("pick", { field: field, dirKey: entry.key, trip: { id: params.id, from: params.from } });

  const fromLabel = fromPlace ? fromPlace.name : loc.status === "found" || loc.status === "idle" ? "Your location" : "Main Gate";
  return (
    <>
      <div className="trip">
        <button type="button" className={"trip-row trip-pick trip-from" + (fromMe && loc.status === "found" ? " is-found" : "")}
          aria-label={"From: " + (fromPlace ? fromPlace.name : "your location") + ". Change start"} onClick={() => pickField("from")}>
          {fromPlace ? <Tile category={fromPlace.category} /> : <span className="trip-icon trip-icon-me"><Icon name="location" /></span>}
          <span className="trip-text"><span className="trip-label">From</span><span className="trip-value">{fromLabel}</span></span>
          <Icon name="chevron-right" className="row-chevron" />
        </button>
        <span className="trip-line" />
        <button type="button" className="trip-row trip-pick trip-to"
          aria-label={"To: " + (dest ? dest.name : "choose a place") + ". Change destination"} onClick={() => pickField("to")}>
          <Tile category={dest && dest.category} />
          <span className="trip-text"><span className="trip-label">To</span><span className="trip-value">{dest ? dest.name : "Choose a place"}</span></span>
          <Icon name="chevron-right" className="row-chevron" />
        </button>
      </div>

      {fromMe && loc.status !== "idle" && (
        <div className={"loc-status is-" + loc.status} role="status">
          {(loc.status === "asking" || loc.status === "locating") && <span className="spinner" />}
          <div className="loc-text">
            <p>{COPY[loc.status]}</p>
            {loc.status === "fallback" && REASON[loc.reason] && <p className="loc-reason">{REASON[loc.reason]}</p>}
          </div>
          {loc.status === "fallback" && loc.reason !== "denied" && <button type="button" className="link-btn" onClick={startLocating}>Try again</button>}
        </div>
      )}

      <div className="route" aria-live="polite">
        {result.kind === "busy" && <StatusLine text="Finding the walking route…" busy />}
        {result.kind === "message" && (
          <div className="soon">
            <p className="soon-title">{result.title}</p>
            {result.text && <p>{result.text}</p>}
            {result.cleared && <button type="button" className="link-btn" onClick={() => setAgain((n) => n + 1)}>Show the route again</button>}
          </div>
        )}
        {route && (
          <>
            <div className="route-summary">
              <p className="route-total"><span className="route-dist">{fmtDist(route.length)}</span><span className="route-time">{fmtTime(route.time)} walk</span></p>
              <RouteNotes route={route} />
              {result.fromGate && <p className="route-meta">Your position isn’t on a mapped path, so this route starts at the Main Gate.</p>}
            </div>
            {result.routes.length > 1 && (
              <div className="chips route-options" role="group" aria-label="Route">
                {result.routes.map((alt, i) => (
                  <button key={i} type="button" className="chip" aria-pressed={String(i === pick)} onClick={() => setPick(i)}>
                    {(i ? "Alternative" : "Best route") + ", " + fmtDist(alt.length)}
                  </button>
                ))}
              </div>
            )}
            <div className="actions">
              <button type="button" className="btn btn-primary" aria-pressed={String(walking)} onClick={toggleWalk}>
                <Icon name={walking ? "close" : "directions"} /><span>{walking ? "Stop walk" : "Walk it"}</span>
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setResult({ kind: "message", title: "Route cleared", cleared: true })}>
                <Icon name="close" /><span>Clear route</span>
              </button>
            </div>
            <h3 className="section-heading">Steps</h3>
            <Steps route={route} />
          </>
        )}
      </div>
    </>
  );
}

function RouteNotes({ route }) {
  const notes = [];
  if (route.stairs) notes.push(route.stairs === 1 ? "1 flight of stairs" : route.stairs + " flights of stairs");
  if (route.openShare >= 0.05) notes.push("about " + Math.round(route.openShare * 100) + "% on ground that isn’t a mapped path");
  if (!notes.length) return null;
  const text = notes.join(" · ");
  return <p className="route-meta">{text.charAt(0).toUpperCase() + text.slice(1)}</p>;
}

/* The steps, grouped by floor when the route changes floor; tapping one pins it on the map */
function Steps({ route }) {
  const app = useApp();
  const multi = route.points.some((p) => (p.level || 0) !== (route.points[0].level || 0));
  const items = [];
  let floor = null, n = 0;
  route.steps.forEach((st, i) => {
    if (multi && st.level !== floor) { floor = st.level; items.push(<li key={"f" + i} className="step-floor">{MapAdapter.floorName(floor)}</li>); }
    const num = ++n;
    const show = () => {
      const p = route.points[Math.min(st.index, route.points.length - 1)];
      app.showLevel(p.level);
      MapAdapter.focusPoint({ x: p.x, y: p.y, level: p.level }, app.freeRects());
    };
    items.push(
      <li key={i}>
        <button type="button" className={"step" + (st.final ? " is-final" : "")} onClick={show}>
          <span className="step-num">{num}</span>
          <span className="step-text">{NavAdapter.clean(st.text)}</span>
          {st.dist >= 1 && !st.final && <span className="step-dist">{fmtDist(st.dist)}</span>}
        </button>
      </li>
    );
  });
  return <ol className="steps">{items}</ol>;
}
