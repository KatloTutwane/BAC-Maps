# BAC Maps: system overview and current posture

> **Update, 23 October 2026.** BAC Maps now lives in `campus-navigator-map/` and runs on the finished map (the campus drawings, `web/campus-map.js` 2.1) and Pathfinder (`web/nav-engine.js`): directions draw real routes, and the Main Building's rooms are places. See `WEBSITE_HANDOFF.md` (top) and `README.md`, "BAC Maps". The timetables, demo students and appearance setting below were merged in unchanged, with two fixes: a database made before class groups now gives its existing demo students their group (before, their profile showed no timetable), and the profile shows loading, error (with Try again) and empty states for the timetable. `python tests/e2e_profile.py` checks the timetable on the profile. Sections 1, 3.1, 7 and 8 still describe the older map in places.

**As of 21 October 2026.** A single reference for what BAC Maps is, how its parts fit together, and exactly where each part stands. For history and design reasoning see `HANDOFF.md` (the map builder) and `WEBSITE_HANDOFF.md` (the website); for day to day use see `site/README.md` and `server/README.md`.

| | |
|---|---|
| Product | **BAC Maps**: a campus map, wayfinding and timetable app for Botswana Accountancy College |
| Project | Campus Navigator, a BAC group project (the map builder component is shared with teammates) |
| Repository | github.com/Kaeloselome-dev/BAC-Maps, private, branch `main` |
| Stack | Plain HTML, CSS and JavaScript (no framework, no build step); Python 3 standard library for the demo server and data tools |
| Runs as | A website and an installable Progressive Web App (PWA) from the same code |
| Status | Working prototype. Demo accounts only; not connected to any BAC system; not hosted publicly |

---

## 1. What it does

**For everyone (no account):**
- A full screen isometric 3D map of the campus: pan, zoom, rotate, floor filter (All, Ground, First), Whole campus, compass.
- Search with quick picks (Clinic, Tuckshop, ATM, Toilets, Parking, Chilling area), results, and a categorised directory of 40 places.
- Place details: category, floors (marked "assumed" where unconfirmed), location for rooms inside the Main Building, and Save.
- Directions from the user's GPS position (or from Main Gate when they can't be placed on campus), with a pulsing location dot. **Routes are not drawn yet** ("Route coming soon") because pathfinding doesn't exist.
- Saved places, kept on the device.
- Light, Dark or Device appearance (profile, Settings).
- Installs to the home screen and opens offline.

**For signed in students (demo accounts):**
- Profile with name, role, number, programme, year and a "Demo account" badge.
- **My day:** their class group's **real timetable** (CSE Year 3, Semester 1 2026/27) with room, lecturer initials and directions to the building, a "next class" card ("Starts in 20 min", "On now, until 12:00", "Tomorrow at 08:00"), day by day lists, plus any extra classes they add themselves.
- Timetable, group and saved places stored in the demo database.

Guests do not see the timetable at all; the profile asks them to sign in.

---

## 2. Architecture

```
                         ┌──────────────────────────── browser ────────────────────────────┐
 data/raw/*.kml,geojson  │  site/index.html                                                 │
        │                │   ├─ theme.js      light/dark before first paint                 │
 pipeline/build.py ──────┼─► web/map_data.js ─► web/campus-map.js (isometric SVG renderer)   │
        │                │                      ▲                                           │
 web/map_data.json       │   ├─ map-adapter.js ─┘ the ONLY file that calls the map          │
                         │   ├─ places.js     names, categories, search, quick picks        │
 data/timetables/*.json  │   ├─ store.js      account, saved places, timetable ──┐          │
        │                │   ├─ geo.js + location.js   GPS → map metres, states  │          │
 tools/build_timetables ─┼─► site/data/timetables.json (static, cached)          │          │
                         │   ├─ app.js        views, card/panel, profile         │          │
                         │   ├─ pwa.js + sw.js  install, offline cache           │          │
                         │   └─ login.html/js  demo sign in                       │          │
                         └───────────────────────────────────────────────────────┼──────────┘
                                                                                 │ /api/ (JSON, cookie)
                                              server/server.py ── server/campus.db (SQLite, demo data)
```

**Principles that shaped it:**
- **One map adapter.** Every call into `campus-map.js` goes through `site/map-adapter.js`, so the teammate's new map can drop in with changes in one file.
- **No invented data.** No distances, hours or descriptions unless real. Demo people are clearly labelled; the timetables are real.
- **Static first.** The map, search, directions, guest profile and timetables all work from a plain static host and offline. Only demo sign in needs the Python server.
- **Portable.** Views are render functions over one `state` object, so the UI can move to React or JSP later.

---

## 3. Components

### 3.1 Map builder (`pipeline/`, `web/`, `data/`)
Built by a teammate; documented in `HANDOFF.md` and `README.md`.
- `pipeline/build.py` turns Google Earth traces into `map_data.json` (22 buildings, 3 roads, 8 paths including indoor corridors and 2 bridges, 10 areas, the raised Chilling Area, 2 stairwells).
- `web/campus-map.js`: framework free isometric SVG renderer with `mount`, `focus`, `highlight`, `set`, `fit`, `rotateTo`, `features`, `drawRoute`, and `select`/`viewchange` events.
- **Being replaced:** a teammate is rebuilding the map. The site has not been changed to match yet.

### 3.2 Website and app (`site/`)
| File | Role |
|---|---|
| `index.html` | The map page. Top bar on desktop (logo, floors, search, Directory, profile); bottom pill on phones |
| `login.html`, `login.css`, `login.js` | Sign in page: Microsoft (explains it needs BAC approval) or BAC number and password against the demo server; Continue as guest |
| `tokens.css` | All colours, shadows, radii, font; light and dark sets |
| `app.css` | Layout and components |
| `map-theme.css` | Restyles the map's light palette from outside; brand blue selection; no focus frame on press |
| `theme.js` | Sets `<html data-theme>` from Light, Dark or Device before first paint |
| `map-adapter.js` | Mounts the map (or a placeholder with mock places) and draws the location dot overlay |
| `places.js` | Display names, categories, rooms in the Main Building, entrances, search, quick picks |
| `store.js` | Account, saved places, own classes and group timetables; API when signed in, localStorage for guests |
| `geo.js`, `location.js` | GPS to map metres (same formula as `pipeline/geo.py`); asking, locating, found, fallback states |
| `app.js` | Card and panel, views (search, place, directions, pick, directory, profile, class, lesson), notices |
| `icons.js` | Inline SVG line icons |
| `pwa.js`, `sw.js`, `manifest.webmanifest` | Installable app and offline cache |
| `data/timetables.json` | Built class timetables (do not edit by hand) |
| `assets/` | BAC logo (from bac.ac.bw) and app icons generated from it |

**Layout.** Phones (under 768 px): bottom pill expands into a card. Desktop: a top bar with a centred search; the panel drops down under the search and opens on load. Both are the same card positioned by CSS.

**Style.** Clean and airy: white panels, soft shadows, hairline borders, Plus Jakarta Sans, BAC brand blue for actions and cyan for accents. Magenta is reserved for walking routes.

### 3.3 Demo server (`server/`)
- `server.py`: Python standard library HTTP server on **127.0.0.1:8765** only. Serves the project as static files and a JSON API: `login`, `logout`, `me`, `me/group`, `classes`, `saved`.
- `db.py`: SQLite schema (`users`, `sessions`, `classes`, `saved_places`), PBKDF2 password hashing, migrations.
- `seed.py`: six dummy accounts: **demo1 to demo5** (students in CSE3-1 to CSE3-5) and **staff1**. One shared demo password, defined in `seed.py` (not repeated here).
- Starts with `python server/server.py`; `--reset` rebuilds the database from the seed; `--port` picks another port.

### 3.4 Timetables (`data/timetables/`, `tools/build_timetables.py`)
- Source: five JSON exports from primetimetable.com, one per group (CSE3-1 to CSE3-5), term "SCIS 2026-2027 Semester 1 V1". 40 classes in total.
- `tools/build_timetables.py` builds `site/data/timetables.json` and maps each room code to a building:

| Room code | Shown as | Map place |
|---|---|---|
| `MC-PC1/D001` | Room D001, PC 1 | PC 1 |
| `MC-B001-3 (PC)` | Rooms B001 to B003, Block B | Block B |
| `MC-Lab 1/017` | Lab 1 (room 017), Main Building | Main Building |
| `MC-Lab 2/018` | Lab 2 (room 018), Main Building | Main Building |
| `#Online` | Online | none |

  An unknown room stops the build rather than being guessed. Course names are abbreviations (CSA, AWD (Java), IS, R & I) until full names are added.

### 3.5 PWA
- Manifest: "BAC Maps", standalone, theme `#0B6E99`, background `#F5F3EE`, 192, 512 and maskable 512 icons.
- Service worker **v6**: precaches 27 files (pages, CSS, JS, icons, the map module, map data, timetables). Shell is cache first; `map_data.js` and `timetables.json` are network first; `/api/` is never cached. Old caches are deleted when `VERSION` changes.
- Install prompts: an "Install app" row on Android and desktop Chrome; a one time "Install: tap Share, then Add to Home Screen." hint on iPhone Safari; both hidden once installed. An offline notice shows in the card.

---

## 4. Running it

```
python server/server.py              # then open http://127.0.0.1:8765/site/
python server/server.py --reset      # rebuild the demo database from server/seed.py
python tools/build_timetables.py     # after changing data/timetables/
python pipeline/build.py             # after re-tracing the map (needs requirements.txt)
```

Add `?map=off` to the site URL to see the placeholder and mock places used when the map files are missing. After changing any site file that installed apps should receive, raise `VERSION` in `site/sw.js`.

---

## 5. Security and privacy posture

| Area | Current state |
|---|---|
| Accounts | Six **dummy** demo accounts; no real student data. Passwords stored as salted PBKDF2 (200,000 rounds); never stored in the browser |
| Sessions | Random 256 bit tokens in an HttpOnly, SameSite=Strict cookie, 7 days |
| Exposure | Server binds to 127.0.0.1 only. `server/`, `.claude/`, `pipeline/`, `tools/`, `data/raw/` and `data/timetables/` are never served as files (path normalised, case insensitive), so the database can't be downloaded |
| Port safety | Refuses to start if the port is busy, and only resets the database after it has the port |
| Repository | Private. Excludes the database, `.claude/`, `.venv/` and caches. Contains the BAC logo, campus GPS traces and the CSE Year 3 timetables (lecturer initials only), so it should stay private until BAC agrees |
| Real sign in | Not connected. Microsoft 365 needs BAC's approval and an app registration; BAC numbers need BAC's systems |
| Transport | Plain HTTP on localhost. A public deployment needs HTTPS (also required for the PWA and location) |
| Not hardened for production | No rate limiting on sign in, no CSRF tokens beyond SameSite=Strict, no audit logging. Fine for a local demo; required before real users |

---

## 6. Testing done

- Layout and features at 375, 414, 700, 768, 820, 1000 and 1440 px, light and dark, keyboard and screen reader labels, WCAG AA contrast checked numerically.
- Search, quick picks, directory, place details, map taps, directions with simulated GPS (found, denied, off campus), location dot through rotation.
- Demo API with curl: sign in, wrong password, timetable, group changes, saved places, private paths, port guard.
- Timetables: all five groups, guest hidden, own classes alongside group classes, "next class" at set times including the following week.
- Service worker in headless Microsoft Edge (the app's built in browser refuses service workers): install and precache, offline load, update from one version to the next, install prompt fired.
- Appearance: switching, persistence, Device following the system, map and login page following the choice.

**Not yet tested:** on a real phone (needs an HTTPS host), with a real screen reader, and against the teammate's new map.

---

## 7. Current posture

| | |
|---|---|
| Git | Local `main` is **3 commits ahead** of GitHub (timetables, five demo students, appearance setting). **Not pushed: the owner asked to hold the push.** `.gitignore` has an uncommitted duplicate `.venv/` line; `files.zip` (the original timetable upload) is untracked |
| Running locally | The app's preview server serves the project on port 8765 with the current code |
| Data | Demo database has the six accounts; timetables built from the five source files |
| Map | Waiting on the teammate's new `campus-map.js` and `map_data.js` |
| Hosting | None. Not public |

---

## 8. Open issues, by priority

1. **Pathfinding (A\*)**: blocks drawn routes and distances. The map data already has centre lines with floor levels and stair links; `map.drawRoute()` is ready.
2. **New map from a teammate**: update `site/map-adapter.js`, then check `places.js` names, the place ids in `server/seed.py` and `tools/build_timetables.py`, and `map-theme.css`; raise the service worker version.
3. **Main Gate and entrances have no coordinates**: they can't be shown or used as route starts yet.
4. **Real sign in and real data**: needs BAC's approval (Microsoft 365 app registration, or BAC's systems for numbers and timetables).
5. **Timetables cover CSE Year 3 only**; course names are abbreviations; rooms point to buildings, not rooms.
6. **Hosting over HTTPS** to install on phones and test GPS on campus.
7. **GPS origin** isn't exported by the pipeline (`site/geo.js` recomputes it; exact today).
8. **Map module gaps**: no marker API (the location dot is an overlay) and no palette option (colours restyled from outside).
9. **Brand colours unverified**: sample them from the logo now in `site/assets/`; the 512 px icons are soft because the logo is small.
10. **Names to confirm**: "Block \*" (left out) and "Block k" versus "Block K".

---

## 9. Change log of the website

| Date | Change |
|---|---|
| 17 Oct 2026 | Website built in phases: shell, search and details, directions and location, dark mode and accessibility, handoffs |
| 17 to 18 Oct | Visual iterations (clay, glass, outlined, then the current clean style); desktop top bar and panel; real BAC logo |
| 18 Oct | Profile with My day and saved places; sign in page; local SQLite demo server |
| 18 Oct | Installable PWA; renamed to BAC Maps; pink focus frame removed; panel closes at launch; pushed to GitHub |
| 21 Oct | Real CSE Year 3 timetables with a class group picker; five demo students; timetable hidden from guests; Light, Dark, Device setting (local commits, not pushed) |
