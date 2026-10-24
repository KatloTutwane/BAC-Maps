# BAC Maps front end (React)

The BAC Maps interface, built with **React 18** and **Vite 5**. It wraps the campus map and the Pathfinder engine in `../web/`, which are plain JavaScript shared with `../web/pathfinder.html` and are not part of the React build. Design notes, decisions and open issues are in `../WEBSITE_HANDOFF.md`.

The map is the two campus drawings (`../web/campus-map.js` with `map_data.js`, `interiors.js` and `renders/`), and directions come from Pathfinder (`../web/nav-engine.js`). The interface never draws or finds a route itself: it calls the map through `src/lib/map-adapter.js` and Pathfinder through `src/lib/nav-adapter.js`.

## Run it

The built app is committed in `../site/`, so the demo runs without Node.js. From the project folder:

```
python server/server.py
```

Then open http://127.0.0.1:8765/site/. See `../server/README.md` for the dummy accounts and options.

## Develop it

Needs Node.js 18 or newer. In this folder:

```
npm install          once, installs React and Vite
npm run dev          http://localhost:5173/site/ with instant reload
npm run build        writes the app to ../site/
```

`npm run dev` sends `/api` (sign in, profile) and `/web` (the map and Pathfinder) to the Python server, so keep `python server/server.py` running alongside it (set `BAC_SERVER` if it is not on port 8765). After changing anything here, run `npm run build` and commit `../site/` so the demo server shows the change.

## Files

| File | What it does |
|---|---|
| `index.html`, `login.html` | The two pages. `index.html` loads the map module, its data and Pathfinder from `../web/` as plain scripts, then the React app. |
| `src/main.jsx`, `src/login.jsx` | Entry points: mount `App` and `LoginPage`. |
| `src/components/App.jsx` | The app shell and its state: top bar, map, map tools, pill and card; the view stack, search, floors, the selected place, expand and collapse, and taps on the map. |
| `src/components/ViewStack.jsx` | The card's views as a stack: the newest slides in over the last; every view in the stack stays mounted. The `VIEWS` table names each view's title and components. |
| `src/components/views/` | The views: `SearchViews.jsx` (search, directory, start or destination picker), `PlaceView.jsx`, `DirectionsView.jsx` (Pathfinder routes, location, walk preview, steps), `ProfileViews.jsx` (profile and timetable, class details, add or edit a class). |
| `src/components/common.jsx` | Shared pieces: `Icon`, category tiles, place rows, status lines, the app context and the `useStore` hook. |
| `src/components/Notices.jsx`, `LoginPage.jsx` | The install and offline notices; the sign-in page. |
| `src/lib/map-adapter.js` | **The only code that talks to the map.** Mounts it (or a placeholder), draws routes, the location dot and the walk preview. |
| `src/lib/nav-adapter.js` | **The only code that talks to Pathfinder.** Builds the navigation model after the map's first frame, finds the Main Gate and Student Entrance from the verified walks, asks for routes. |
| `src/lib/places.js` | The places the interface shows: display names, categories, rooms, entrances, search and quick picks. |
| `src/lib/store.js` | The account, saved places and timetable: the demo server's API when signed in, the browser's storage for guests. |
| `src/lib/geo.js`, `location.js`, `icons.js`, `pwa.js` | GPS to map metres; location states; line icons; installable app helpers. |
| `src/styles/` | `tokens.css` (every colour, size and the font, light and dark), `app.css`, `map-theme.css`, `login.css`. |
| `public/` | Copied as is: `assets/` (logo, app icons), `data/timetables.json` (built by `../tools/build_timetables.py`), `manifest.webmanifest`, `theme.js` (light or dark before the page draws). |
| `sw-template.js` | The service worker. The build fills in the bundle names and writes `../site/sw.js`. Raise `VERSION` to ship an update. |
| `vite.config.js` | Base path `/site/`, both pages, output to `../site/`, the dev proxy and the service worker step. |

## Installable app (PWA)

The app installs on phones and desktops and opens offline. `sw.js` keeps the pages, the React bundles, icons, the map, Pathfinder and both campus drawings on the device (cache first); map, navigation and timetable data are network first; `/api/` is never cached. Because the shell is cache first, **changes reach installed apps only when `VERSION` in `sw-template.js` changes**. While developing, tick "Update on reload" in DevTools, Application, Service workers, or use a private window.

To install on a phone the app must come from an HTTPS host, with `site/` and `web/` side by side. Demo sign in needs `server/server.py`, so it does not work on a static host.

## Changing things

- **A new card view:** write a component in `src/components/views/`, add it to `VIEWS` in `ViewStack.jsx`, and open it with `push(name, params)` from the app context.
- **Brand colours:** `--brand-cyan`, `--brand-dark` and `--brand-ink` in `src/styles/tokens.css`, including the dark block.
- **A place's category, display name or description:** `src/lib/places.js`.
- **New map files:** rebuild them with the pipeline (`../README.md`); if the map's API changes, update `map-adapter.js` only, and for Pathfinder `nav-adapter.js` only.
