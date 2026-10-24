/* Search, the directory, and the picker for a route's start or destination. */
import Places from "../../lib/places.js";
import { Icon, Tile, PlaceRow, useApp } from "../common.jsx";

/* Desktop: the search lives in the top bar, so the panel greets instead;
   phones type here. Both edit the same query in App. */
export function SearchHead() {
  const app = useApp();
  return (
    <>
      <h2 className="view-title greet" tabIndex={-1}><span className="label-hi">Dumela!</span></h2>
      <label className="search-field">
        <Icon name="search" />
        <span className="sr-only">Search places on campus</span>
        <input type="search" id="search-input" placeholder="Search a building or service" autoComplete="off" enterKeyHint="search"
          value={app.query}
          onChange={(e) => { app.setQuery(e.target.value); app.setChip(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { const first = app.results().list[0]; if (first) { e.preventDefault(); app.openPlace(first); } } }} />
        <button type="button" className="icon-btn clear-btn" aria-label="Clear search" hidden={!app.query}
          onClick={(e) => { app.setQuery(""); app.setChip(null); e.currentTarget.parentNode.querySelector("input").focus(); }}>
          <Icon name="close" />
        </button>
      </label>
    </>
  );
}

export function SearchView() {
  const app = useApp();
  const r = app.results();
  let announce = "";
  if (r.mode === "list") announce = r.list.length ? r.list.length + (r.list.length === 1 ? " place" : " places") + " found" : "No places found";
  return (
    <>
      <div className="info">
        <span className="info-icon"><Icon name="info" /></span>
        <span className="info-text">{app.places.length} places on campus</span>
        <button type="button" className="btn-small" onClick={() => app.push("directory")}>Show list</button>
      </div>
      <h3 className="section-heading">Quick picks</h3>
      <div className="chips" role="group" aria-label="Quick picks">
        {Places.CHIPS.map((chip, i) => (
          <button key={chip.label} type="button" className={"chip cat-" + chip.category} aria-pressed={String(app.chip === i)}
            onClick={() => { const next = app.chip === i ? null : i; app.setChip(next); if (next !== null) app.setQuery(""); }}>
            <Icon name={Places.category(chip.category).icon} /><span>{chip.label}</span>
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">{announce}</p>
      <div className="results">
        {r.mode === "recent" && (r.list.length ? (
          <>
            <h3 className="section-heading">Recently viewed</h3>
            <ul className="rows">{r.list.map((p) => <PlaceRow key={p.id} place={p} />)}</ul>
          </>
        ) : <p className="hint">Search for a place, or pick one of the quick picks above.</p>)}
        {r.mode === "list" && !r.list.length && (
          <div className="empty">
            <p>No places match “{app.query.trim()}”.</p>
            <button type="button" className="link-btn" onClick={() => app.push("directory")}>Browse the directory</button>
          </div>
        )}
        {r.mode === "list" && r.list.length > 0 && (
          <>
            <h3 className="list-heading">{r.heading} <span className="count">{r.list.length}</span></h3>
            <ul className="rows">{r.list.map((p) => <PlaceRow key={p.id} place={p} />)}</ul>
          </>
        )}
      </div>
    </>
  );
}

/* Every place grouped by category, each group collapsible */
export function DirectoryView() {
  const app = useApp();
  return Places.CATEGORIES.map((c) => {
    const items = app.places.filter((p) => p.category === c.key);
    if (!items.length) return null;
    const open = !!app.dirOpen[c.key], id = "group-" + c.key;
    return (
      <section className="group" key={c.key}>
        <button type="button" className="group-head" aria-controls={id} aria-expanded={String(open)} onClick={() => app.toggleDir(c.key)}>
          <Tile category={c.key} />
          <span className="group-label"><span>{c.label}</span></span>
          <span className="count">{items.length}</span>
          <Icon name="chevron-down" className="group-chevron" />
        </button>
        <ul className="rows" id={id} hidden={!open}>
          {items.map((p) => <PlaceRow key={p.id} place={p} inGroup />)}
        </ul>
      </section>
    );
  });
}

/* Pick the start or the destination of a route. params: { field, dirKey, trip }.
   The head's search field and the list share `local.q` (see ViewStack). */
export function PickHead({ params, local, setLocal }) {
  return (
    <label className="search-field">
      <Icon name="search" />
      <span className="sr-only">{params.field === "from" ? "Search for a start" : "Search for a destination"}</span>
      <input type="search" id="pick-input" placeholder="Search a building, room or service" autoComplete="off"
        value={local.q || ""} onChange={(e) => setLocal({ q: e.target.value })} />
    </label>
  );
}

export function PickView({ params, local }) {
  const app = useApp();
  const choose = (id) => app.finishPick(params.dirKey, params.field === "from" ? { ...params.trip, from: id } : { ...params.trip, id: id });
  const text = (local.q || "").trim();
  const list = text ? Places.search(app.places, text) : app.places;
  return (
    <ul className="rows">
      {params.field === "from" && !text && (
        <li>
          <button type="button" className="row" onClick={() => choose("me")}>
            <span className="tile trip-icon-me"><Icon name="location" /></span>
            <span className="row-text">
              <span className="row-name">Your location</span>
              <span className="row-meta">Or the Main Gate when you’re not on campus</span>
            </span>
          </button>
        </li>
      )}
      {list.map((p) => <PlaceRow key={p.id} place={p} onChoose={(pl) => choose(pl.id)} />)}
      {!list.length && <li className="hint">No places match.</li>}
    </ul>
  );
}
