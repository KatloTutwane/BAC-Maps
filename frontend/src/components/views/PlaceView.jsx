/* Details of one place: only facts the data actually has, the Directions,
   Show on map and Save actions, and Pathfinder's word on whether a route
   can reach it. */
import { useEffect, useState } from "react";
import Places from "../../lib/places.js";
import NavAdapter from "../../lib/nav-adapter.js";
import { Icon, Tile, GoActions, useApp, useStore } from "../common.jsx";

export function placeTitle(params, app) {
  const p = app.placeById(params.id);
  return p ? p.name : "Place";
}

export default function PlaceView({ params }) {
  const app = useApp();
  const Store = useStore();
  const p = app.placeById(params.id);
  const [unreachable, setUnreachable] = useState(null);

  useEffect(() => {
    let live = true;
    setUnreachable(null);
    if (!p) return undefined;
    NavAdapter.ready().then(() => {
      const np = NavAdapter.place(p.navId);
      if (live && np && !np.reachable) setUnreachable(NavAdapter.clean(np.why || p.name + " has no entrance on the map yet, so no route can reach it."));
    });
    return () => { live = false; };
  }, [p && p.id]);

  if (!p) return <p className="hint">This place is no longer on the map.</p>;

  const facts = [];
  if (p.parent) facts.push(["Location", "Inside " + p.parent]);
  if (p.floorName) facts.push(["Floor", p.floorName]);
  if (p.roomType) facts.push(["Room", p.roomType.charAt(0).toUpperCase() + p.roomType.slice(1), p.approx ? "(layout approximate)" : null]);
  if (p.floors) facts.push(["Floors", String(p.floors), p.floorsAssumed ? "(assumed, not yet confirmed)" : null]);
  if (p.reachedFrom) facts.push(["Access", p.reachedFrom === 1 ? "From the first floor" : "From floor " + p.reachedFrom]);
  const saved = Store.saved.has(p.id);

  return (
    <>
      <div className="place-cat">
        <Tile category={p.category} size="lg" />
        <span>{Places.category(p.category).label}</span>
      </div>
      {facts.length > 0 && (
        <dl className="facts">
          {facts.map(([label, value, note]) => (
            <div className="fact" key={label}>
              <dt>{label}</dt>
              <dd>{value}{note && <span className="fact-note"> {note}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      {p.description && <p className="place-desc">{p.description}</p>}
      <GoActions place={p}>
        <button type="button" className="btn btn-secondary btn-save" aria-pressed={String(saved)} onClick={() => Store.saved.toggle(p.id)}>
          <Icon name={saved ? "bookmark-filled" : "bookmark"} /><span>{saved ? "Saved" : "Save"}</span>
        </button>
      </GoActions>
      {!p.onMap && <p className="hint">This place is not drawn on the map yet.</p>}
      {p.onMap && p.roomUnmapped && <p className="hint">The drawings don’t show this room yet, so the map shows the {p.parent} and directions go there.</p>}
      {unreachable && <p className="hint">{unreachable}</p>}
    </>
  );
}
