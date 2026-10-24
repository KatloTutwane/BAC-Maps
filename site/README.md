# BAC Maps website

A single page web app around the campus map and the Pathfinder engine in `../web/`. Plain HTML, CSS and JavaScript: no framework, no build step, no map platform. Design notes, decisions and open issues are in `../WEBSITE_HANDOFF.md`.

The map is the two campus drawings (`../web/campus-map.js` with `map_data.js`, `interiors.js` and `renders/`), and directions come from Pathfinder (`../web/nav-engine.js`), the same engine as `../web/pathfinder.html`. The site never draws or finds a route itself.

## Run it

Start the demo server from the project folder (the one above `site/`):

```
python server/server.py
```

Then open http://127.0.0.1:8765/site/. It serves the site, the demo database for sign in and the profile, and a secure origin for location. See `../server/README.md` for the dummy accounts and options. Add `?map=off` to see the placeholder and mock places that appear when the map files are missing.

Without the server (opened from disk, or any plain file server) the map, search, directions and a guest profile still work; sign in explains that the demo server isn't running.

## Files

| File | What it does |
|---|---|
| `index.html` | The page: map container, top bar, map tools, bottom pill and card. Loads `../web/campus-map.js`, `map_data.js`, `interiors.js`, `nav_seed.js` and `nav-engine.js`. |
| `tokens.css` | Every colour, shadow, radius, size and the font, light and dark. Swap the brand values here. |
| `app.css` | Layout and components: phones below 768 px, desktop top bar and the panel under its search above. |
| `map-theme.css` | What the site sets on the map: the background around the drawings, the selection colour, the focus ring and the location dot. |
| `map-adapter.js` | **The only file that talks to the map.** Mounts it, or draws the placeholder and returns mock places. Draws routes, the location dot and the walk preview with the map's own API. |
| `nav-adapter.js` | **The only file that talks to Pathfinder.** Builds the navigation model after the map's first frame, finds the Main Gate and Student Entrance from the verified walks, and asks for routes (best plus an alternative). |
| `places.js` | Turns `features()` and the Main Building's rooms into the places the UI shows: display names, categories, floors, entrances, search and quick picks. Each place carries its Pathfinder id. No map calls. |
| `geo.js` | GPS to map metres, the same formula as `pipeline/geo.py`. |
| `location.js` | The location states: asking, locating, found, fallback. |
| `icons.js` | Inline SVG line icons. |
| `app.js` | UI state, the card's views (search, place, directions, pick, directory, profile, class), expand and collapse. |
| `store.js` | The account, saved places and class timetable. Signed in: read from and written to the demo database through the API. Guest: kept in this browser (localStorage). |
| `data/timetables.json` | Class group timetables, built from `../data/timetables/` by `../tools/build_timetables.py`. Don't edit by hand; rebuild instead. |
| `manifest.webmanifest` | App name, colours, start page and icons, so browsers offer to install it. |
| `sw.js` | Service worker: keeps the app working offline. Raise `VERSION` to ship an update. |
| `theme.js` | Light or dark: sets `<html data-theme>` from the profile's Appearance setting (Light, Dark, or Device), before the page draws. Loaded in `<head>`. |
| `pwa.js` | Registers the service worker and tracks install state for the Install app row and the iOS hint. |
| `login.html`, `login.css`, `login.js` | The sign in page. BAC number and password are checked against the demo database; Sign in with Microsoft waits for BAC's approval and says so. |
| `assets/` | `bac-logo.png` is BAC's logo from bac.ac.bw; `icons/` holds the app icons made from it. Put `profile.png` here; until then the profile slot shows a generic person. If the logo is missing, the badge shows "bac" instead. |

## Installable app (PWA)

The site installs as an app on phones and desktops and opens offline.

**How it works.** `manifest.webmanifest` gives the name, colours and icons. `sw.js` caches the pages, CSS, JavaScript, icons and `../web/campus-map.js` the first time the site loads, then serves them from the cache (cache first). `../web/map_data.js` is network first, so a new map arrives whenever the device is online and the cached copy is used offline. The Google Fonts stylesheet is cached at install and the font files on first use. `/api/` calls (demo sign in) are never cached.

**Shipping an update.** Change `VERSION` at the top of `sw.js` (v1 to v2, and so on). Because the shell is cache first, **edits to other files don't reach installed apps or returning visitors until `VERSION` changes.** While developing, tick "Update on reload" in DevTools, Application, Service workers, or use a private window.

**Testing it.**
- **Chrome DevTools, Application tab:** *Manifest* shows the name, icons and any installability problems; *Service workers* shows `sw.js` as activated and running, with Offline, Update on reload and Unregister; *Cache storage* lists `cn-shell-v4` and `cn-runtime-v4` (the number follows `VERSION`). Tick *Offline* in the Service workers panel and reload: the map should still load and the card should say you're offline.
- **Lighthouse:** Chrome removed Lighthouse's separate PWA audit in 2024 (Lighthouse 12). Run it for Performance, Accessibility and Best practices; for installability use the Application tab above, where the Manifest panel lists any problems.
- **On a real phone:** the site has to come from an HTTPS address; `http://127.0.0.1` only counts as secure on the computer itself. Host the project on any HTTPS static host (GitHub Pages, Netlify, the college's server) with `site/` and `web/` side by side, then open `https://<your host>/site/` on the phone. Android Chrome: open the card and tap Install app (or the browser menu, Install app). iPhone Safari: Share, then Add to Home Screen. Open it from the home screen, turn on airplane mode, and open it again: the map should still work. Demo sign in won't work on a static host, because `server/server.py` only runs on your computer.

**Icons.** Made from `assets/bac-logo.png` by `../tools/make-icons.ps1`, a PowerShell script using Windows' built in imaging (nothing to install): 192 and 512 px, a 512 px maskable icon with the logo inside the safe circle, a 180 px Apple touch icon and a 32 px favicon, all on white. The logo is only 236 x 113 px, so the large icons are slightly soft; with a bigger logo, run `powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1 -Logo site/assets/bac-logo.png -OutDir site/assets/icons` from the project folder, then raise `VERSION` in `sw.js`.

## Changing things

- **New map files:** rebuild them with the pipeline (`../README.md`, "Updating the map"); the site reads them from `../web/`. If the map's API changes, update `map-adapter.js` only; if Pathfinder's changes, `nav-adapter.js` only.
- **Brand colours:** edit `--brand-cyan`, `--brand-dark` and `--brand-ink` in `tokens.css`, including the dark mode block. Keep white text only on `--brand-dark`.
- **A place's category, display name or description:** `places.js`. Add descriptions or hours only when the team has real ones.
- **Routes:** the `directions` view in `app.js` asks `NavAdapter.route(from, to)` and draws the answer with `MapAdapter.showRoute()`. It starts from `Locator.current()` when its status is `found`, otherwise from the Main Gate, unless the user picks another start.
- **A new card view:** add an entry to `VIEWS` in `app.js` with a `title` and `render(body, params)`, then open it with `push(name, params)`.

## Porting to React or JSP

Each view in `VIEWS` maps to one component, `state` to component or app state, and `map-adapter.js` to a small hook or service. The CSS and tokens carry over as they are.
