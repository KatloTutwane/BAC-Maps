/* Small pieces shared by the views: icons, category tiles, place rows and
   status lines. */
import { createContext, useContext, useEffect, useReducer } from "react";
import Icons from "../lib/icons.js";
import Places from "../lib/places.js";
import Store from "../lib/store.js";
import MapAdapter from "../lib/map-adapter.js";

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* Everything the views need from the app: places, navigation between views,
   the map helpers and the shared search state. Provided by App. */
export const AppContext = createContext(null);
export function useApp() { return useContext(AppContext); }

/* Re-render when the account, saved places or timetable change. */
export function useStore() {
  const [, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => Store.on(bump), []);
  return Store;
}

/* The icon's paths come from the fixed table in lib/icons.js, never from
   user data, so they are safe to set as markup. */
export function Icon({ name, className }) {
  return (
    <svg className={"icon" + (className ? " " + className : "")} viewBox="0 0 24 24" width="24" height="24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: Icons.paths(name) }} />
  );
}

export function Tile({ category, size }) {
  if (!category) return <span className="tile" />;
  const c = Places.category(category);
  return <span className={"tile cat-" + c.key + (size ? " tile-" + size : "")}><Icon name={c.icon} /></span>;
}

/* Second line of a row. Inside a directory group the category is already
   the heading, so only rooms and unmapped places get a note there. */
export function metaText(p, inGroup) {
  const note = p.parent ? "Inside " + p.parent + (p.floorName ? ", " + p.floorName.toLowerCase() : "") : (!p.onMap ? "Not on the map yet" : "");
  if (inGroup) return note;
  const label = Places.category(p.category).label;
  return note ? label + ", " + note.charAt(0).toLowerCase() + note.slice(1) : label;
}

/* Where a class is: a group class's room, or the place the user picked */
export function whereText(c, p) {
  if (c.roomLabel) return c.roomLabel;
  return p ? p.name : "Place not found";
}

/* One result or directory row: icon tile, name, category. Hovering or
   focusing it previews the place on the map without moving it. */
export function PlaceRow({ place: p, inGroup, onChoose }) {
  const app = useApp();
  const preview = () => { if (p.onMap && p.mapName) MapAdapter.highlight(p.mapName); };
  const unpreview = () => MapAdapter.highlight(app.selectedMapName());
  const meta = metaText(p, inGroup);
  return (
    <li>
      <button type="button" className="row" data-place={p.id} aria-current={p.id === app.selected ? "true" : undefined}
        onClick={() => (onChoose ? onChoose(p) : app.openPlace(p))}
        onMouseEnter={preview} onMouseLeave={unpreview} onFocus={preview} onBlur={unpreview}>
        <Tile category={p.category} />
        <span className="row-text">
          <span className="row-name">{p.name}</span>
          {meta && <span className="row-meta">{meta}</span>}
        </span>
        <Icon name="chevron-right" className="row-chevron" />
      </button>
    </li>
  );
}

export function StatusLine({ text, busy, fallback, children }) {
  return (
    <div className={"loc-status" + (busy ? " is-locating" : "") + (fallback ? " is-fallback" : "")} role="status">
      {busy && <span className="spinner" />}
      <div className="loc-text"><p>{text}</p></div>
      {children}
    </div>
  );
}

export function InfoBox({ icon, children }) {
  return (
    <p className="info">
      <span className="info-icon"><Icon name={icon} /></span>
      <span>{children}</span>
    </p>
  );
}

export function SectionHead({ title, count, action }) {
  return (
    <div className="section-head">
      <h3 className="section-title">{title}{count ? <span className="count">{count}</span> : null}</h3>
      {action}
    </div>
  );
}

/* The two buttons under a place or class: Directions and Show on map */
export function GoActions({ place: p, children }) {
  const app = useApp();
  return (
    <div className="actions">
      <button type="button" className="btn btn-primary" onClick={() => app.push("directions", { id: p.id })}>
        <Icon name="directions" /><span>Directions</span>
      </button>
      {p.onMap && (
        <button type="button" className="btn btn-secondary" onClick={() => { app.showOnMap(p); app.collapse(); }}>
          <Icon name="pin" /><span>Show on map</span>
        </button>
      )}
      {children}
    </div>
  );
}
