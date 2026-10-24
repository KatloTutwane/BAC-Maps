/* The profile (who, My day with the group timetable, saved places,
   settings), one class from the group timetable, and the form for the
   user's own classes. */
import { useEffect, useReducer, useState } from "react";
import Places from "../../lib/places.js";
import { Icon, PlaceRow, StatusLine, InfoBox, SectionHead, GoActions, whereText, DAY_SHORT, DAY_LONG, useApp, useStore } from "../common.jsx";

const BASE = import.meta.env.BASE_URL;

function Avatar({ user }) {
  const [noPhoto, setNoPhoto] = useState(false);
  const initials = user ? user.name.split(/\s+/).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase() : "";
  return (
    <span className={"who-avatar" + (noPhoto ? " no-photo" : "") + (user ? " has-initials" : "")}>
      <img src={BASE + "assets/profile.png"} alt="" onError={() => setNoPhoto(true)} />
      <span className="avatar-fallback"><Icon name="user" /></span>
      {user && <span className="who-initials">{initials}</span>}
    </span>
  );
}

/* The card at the top of My day: what's on now, or next */
function NextClass() {
  const app = useApp();
  const Store = useStore();
  const [, tick] = useReducer((n) => n + 1, 0);
  useEffect(() => { const t = setInterval(tick, 30000); return () => clearInterval(t); }, []);   // keep "starts in" current
  const n = Store.classes.next(new Date());
  if (!n) return null;
  const c = n.cls, p = app.placeById(c.placeId);
  let when;
  if (n.status === "now") when = "On now, until " + c.end;
  else if (n.status === "later") when = n.minutes < 60 ? "Starts in " + n.minutes + " min" : "Today at " + c.start;
  else when = (n.dayOffset === 1 ? "Tomorrow" : (n.dayOffset === 7 ? "Next " : "") + DAY_LONG[(new Date().getDay() + n.dayOffset) % 7]) + " at " + c.start;
  return (
    <div className="next-slot">
      <div className={"next" + (n.status === "now" ? " is-now" : "")}>
        <div className="next-top">
          <span className="next-label">{n.status === "now" ? "Now" : "Next"}</span>
          <span className="next-when"><Icon name="clock" />{when}</span>
        </div>
        <p className="next-title">{c.title}</p>
        <p className="next-where">{whereText(c, p) + ", " + c.start + " to " + c.end}</p>
        {p && <GoActions place={p} />}
      </div>
    </div>
  );
}

function GroupPicker() {
  const Store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const groups = Store.groups();
  if (!groups.length) return null;
  const byProgramme = {};
  groups.forEach((g) => { (byProgramme[g.programme] = byProgramme[g.programme] || []).push(g); });
  const change = (e) => {
    setBusy(true);
    Store.setGroup(e.target.value).then(() => setBusy(false), (err) => { setBusy(false); setError(err.message); });
  };
  return (
    <>
      <label className="group-pick">
        <span className="group-pick-label">Class group</span>
        <select value={Store.group() || ""} disabled={busy} onChange={change}>
          <option value="">No group</option>
          {Object.keys(byProgramme).map((prog) => (
            <optgroup key={prog} label={prog}>{byProgramme[prog].map((g) => <option key={g.code} value={g.code}>{g.code}</option>)}</optgroup>
          ))}
        </select>
      </label>
      {error && <span className="field-error">{error}</span>}
    </>
  );
}

function MyDay({ day, setDay }) {
  const app = useApp();
  const Store = useStore();
  const today = new Date().getDay();
  const list = Store.classes.list();
  const ttState = Store.timetableState(), myGroup = Store.group();
  const [retrying, setRetrying] = useState(false);
  useEffect(() => { if (ttState !== "loading") setRetrying(false); }, [ttState]);
  return (
    <>
      <SectionHead title="My day" action={
        <button type="button" className="link-btn section-action" onClick={() => app.push("class", { day: day })}>
          <Icon name="plus" /><span>Add class</span>
        </button>
      } />
      <GroupPicker />
      {ttState === "loading" && <StatusLine text="Loading your timetable…" busy />}
      {ttState === "error" && (
        <StatusLine text="Your class timetable couldn’t be loaded. Check your connection and try again." fallback>
          <button type="button" className="link-btn" disabled={retrying} onClick={() => { setRetrying(true); Store.retryTimetables(); }}>Try again</button>
        </StatusLine>
      )}
      {ttState === "ok" && myGroup && !list.some((c) => c.readOnly) && <InfoBox icon="calendar">No timetable is available for {myGroup} yet.</InfoBox>}
      {Store.dataError() && <InfoBox icon="info">Your own classes and saved places couldn’t be loaded from the demo server. Reload the page to try again.</InfoBox>}
      {!list.length ? (
        ttState === "ok" && !myGroup && (
          <InfoBox icon="calendar">
            {Store.groups().length ? "Pick your class group to see your timetable, or add your own classes." : "Add your classes to see where you need to be and when, with directions there."}
          </InfoBox>
        )
      ) : (
        <>
          <NextClass />
          <div className="days" role="group" aria-label="Day">
            {[1, 2, 3, 4, 5, 6].map((d) => (
              <button key={d} type="button" className={"day" + (d === today ? " is-today" : "")} aria-pressed={String(d === day)}
                aria-label={DAY_LONG[d] + (d === today ? ", today" : "")} onClick={() => setDay(d)}>{DAY_SHORT[d]}</button>
            ))}
          </div>
          <DayClasses day={day} />
        </>
      )}
    </>
  );
}

function DayClasses({ day }) {
  const app = useApp();
  const Store = useStore();
  const list = Store.classes.onDay(day);
  if (!list.length) return <p className="hint">No classes on {DAY_LONG[day]}.</p>;
  return (
    <ul className="rows class-rows">
      {list.map((c) => {
        const p = app.placeById(c.placeId), where = whereText(c, p);
        return (
          <li key={c.id}>
            <button type="button" className="row class-row" aria-label={c.title + ", " + c.start + " to " + c.end + ", " + where + (c.readOnly ? ". Details" : ". Edit")}
              onClick={() => app.push(c.readOnly ? "lesson" : "class", { id: c.id })}>
              <span className="class-time"><span>{c.start}</span><span className="class-end">{c.end}</span></span>
              <span className="row-text">
                <span className="row-name">{c.title}{c.readOnly && <span className="class-tag">{c.group}</span>}</span>
                <span className="row-meta">{where}</span>
              </span>
              <Icon name="chevron-right" className="row-chevron" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Appearance() {
  const [choice, setChoice] = useState(window.Theme ? window.Theme.get() : "system");
  if (!window.Theme) return null;
  return (
    <>
      <SectionHead title="Settings" />
      <div className="setting">
        <span className="setting-label">Appearance</span>
        <div className="days theme-switch" role="group" aria-label="Appearance">
          {[["light", "Light"], ["dark", "Dark"], ["system", "Device"]].map(([key, label]) => (
            <button key={key} type="button" className="day" aria-pressed={String(choice === key)}
              title={key === "system" ? "Follow this device's light or dark setting" : undefined}
              onClick={() => { window.Theme.set(key); setChoice(key); }}>{label}</button>
          ))}
        </div>
      </div>
    </>
  );
}

/* Profile: who the user is, My day (signed-in students), saved places and settings */
export function ProfileView() {
  const app = useApp();
  const Store = useStore();
  const today = new Date().getDay();
  const [day, setDay] = useState(today === 0 ? 1 : today);   // Sunday shows Monday
  const [signingOut, setSigningOut] = useState(false);

  // until the account and timetables are known, don't show a guest profile to someone signed in
  if (!Store.loaded()) return <StatusLine text="Loading your profile and timetable…" busy />;

  const user = Store.account();
  const rows = !user ? [["Programme", "Shown after sign in"], ["Year", "Shown after sign in"]]
    : user.role === "staff" ? [["Role", "Staff"]]
    : [["Programme", user.programme || "Not set"], ["Year", user.year ? "Year " + user.year : "Not set"]];
  const saved = Store.saved.list().map(app.placeById).filter(Boolean);
  const tt = Store.timetableInfo();

  return (
    <>
      <div className="who">
        <Avatar user={user} />
        <div className="who-text">
          {user ? (
            <>
              <p className="who-name">{user.name + " "}{user.demo && <span className="demo-badge">Demo account</span>}</p>
              <p className="who-sub">{(user.role === "staff" ? "Staff" : "Student") + ", " + user.bacNumber}</p>
            </>
          ) : (
            <>
              <p className="who-name">Guest</p>
              <p className="who-sub">Not signed in</p>
            </>
          )}
        </div>
        {user ? (
          <button type="button" className="btn btn-secondary btn-sm" disabled={signingOut} onClick={() => { setSigningOut(true); Store.signOut().then(() => setSigningOut(false)); }}>
            <span>Sign out</span>
          </button>
        ) : (
          <a className="btn btn-secondary btn-sm" href="login.html"><Icon name="sign-in" /><span>Sign in</span></a>
        )}
      </div>

      <dl className={"facts" + (user ? "" : " facts-muted")}>
        {rows.map(([label, value]) => <div className="fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>

      {user ? <MyDay day={day} setDay={setDay} /> : (
        <>
          <SectionHead title="My day" />
          <div className="info">
            <span className="info-icon"><Icon name="calendar" /></span>
            <span>Sign in to see your class timetable, with directions to each class. <a className="link-btn" href="login.html">Sign in</a></span>
          </div>
        </>
      )}

      <SectionHead title="Saved places" count={saved.length ? String(saved.length) : null} />
      {!saved.length ? <p className="hint">Tap Save on any place to keep it here.</p> : (
        <ul className="rows">{saved.map((p) => <PlaceRow key={p.id} place={p} />)}</ul>
      )}

      <Appearance />

      {Store.group() && tt && <p className="hint footnote">Group timetable: {tt.term}{tt.source ? ", from " + tt.source : ""}.</p>}
      <p className="hint footnote">{user ? "Your timetable and saved places are kept in the demo database." : "Saved places are kept on this device. Sign in to keep them with your account."}</p>
    </>
  );
}

/* One class from the user's group timetable: read only */
export function lessonTitle(params) {
  const c = window.Store.classes.get(params.id);
  return c ? c.title : "Class";
}
export function LessonView({ params }) {
  const app = useApp();
  const Store = useStore();
  const c = Store.classes.get(params.id);
  if (!c) return <p className="hint">This class is no longer on your timetable.</p>;
  const p = app.placeById(c.placeId);
  const tt = Store.timetableInfo();
  const facts = [["When", DAY_LONG[c.days[0]] + ", " + c.start + " to " + c.end], ["Where", c.roomLabel]];
  if (c.lecturer) facts.push(["Lecturer", c.lecturer]);
  facts.push(["Group", c.group + (c["with"].length ? ", with all of " + c["with"].join(", ") : "")]);
  return (
    <>
      <dl className="facts">{facts.map(([label, value]) => <div className="fact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {p ? <GoActions place={p} /> : !c.placeId && <p className="hint">This class is online, so there are no directions.</p>}
      <p className="hint footnote">From your group timetable{tt ? ": " + tt.term : ""}. To change it, pick another class group in your profile.</p>
    </>
  );
}

/* Add or edit one class on the user's own timetable */
export function classTitle(params) { return params.id ? "Edit class" : "Add class"; }
export function ClassFormView({ params }) {
  const app = useApp();
  const Store = useStore();
  const existing = params.id ? Store.classes.get(params.id) : null;
  const [title, setTitle] = useState(existing ? existing.title : "");
  const [place, setPlace] = useState(existing ? existing.placeId : (params.placeId || ""));
  const [days, setDays] = useState(existing ? existing.days.slice() : (params.day ? [params.day] : []));
  const [start, setStart] = useState(existing ? existing.start : "");
  const [end, setEnd] = useState(existing ? existing.end : "");
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);

  const fail = (msg, id) => { setError(msg); if (id) { const el = document.getElementById(id); if (el) el.focus(); } };
  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return fail("Enter a class name.", "class-title");
    if (!place) return fail("Choose where the class is.", "class-place");
    if (!days.length) return fail("Choose at least one day.");
    if (!start || !end) return fail("Enter when the class starts and ends.", start ? "class-end" : "class-start");
    if (Store.minutes(end) <= Store.minutes(start)) return fail("The class has to end after it starts.", "class-end");
    setSaving(true);
    Store.classes.save({ id: existing ? existing.id : null, title: title.trim(), placeId: place, days: days.slice().sort(), start: start, end: end })
      .then(app.pop, (err) => { setSaving(false); fail(err.message); });
  };
  const remove = () => {
    if (!armed) { setArmed(true); return; }
    setSaving(true);
    Store.classes.remove(existing.id).then(app.pop, (err) => { setSaving(false); fail(err.message); });
  };
  const toggleDay = (d) => setDays((list) => (list.indexOf(d) >= 0 ? list.filter((x) => x !== d) : list.concat(d)));

  return (
    <form className="class-form" noValidate onSubmit={submit}>
      <label className="field">
        <span className="field-label">Class name</span>
        <input id="class-title" type="text" required maxLength={60} autoComplete="off" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Place</span>
        <select id="class-place" required value={place} onChange={(e) => setPlace(e.target.value)}>
          <option value="">Choose a place</option>
          {Places.CATEGORIES.map((cat) => {
            const items = app.places.filter((p) => p.category === cat.key);
            return items.length ? <optgroup key={cat.key} label={cat.label}>{items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup> : null;
          })}
        </select>
      </label>
      <fieldset className="field day-field">
        <legend className="field-label">Days</legend>
        <div className="days">
          {[1, 2, 3, 4, 5, 6].map((d) => (
            <button key={d} type="button" className="day" aria-label={DAY_LONG[d]} aria-pressed={String(days.indexOf(d) >= 0)} onClick={() => toggleDay(d)}>{DAY_SHORT[d]}</button>
          ))}
        </div>
      </fieldset>
      <div className="field-row">
        <label className="field"><span className="field-label">Starts</span><input id="class-start" type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field"><span className="field-label">Ends</span><input id="class-end" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={saving}><Icon name="bookmark" /><span>Save class</span></button>
        {existing && (
          <button type="button" className="btn btn-secondary btn-danger" disabled={saving} onClick={remove}>
            <Icon name="trash" /><span>{armed ? "Tap again to delete" : "Delete"}</span>
          </button>
        )}
      </div>
    </form>
  );
}
