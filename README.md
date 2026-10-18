# Campus Navigator: Isometric Map Builder

A map of the BAC campus: two detailed 3D drawings of the campus, with navigation data built from satellite traces laid over them, drawn as SVG in the browser. The map is a reusable JavaScript module, so the same code can run inside the website and the app.

```
open web/index.html          the demo page (no server needed)
open web/embed.html          the bare map, as an app or iframe would host it
python pipeline/build.py     rebuild the data after changing any traces
```

## Setup

Python 3.10 or newer, for the pipeline only. Viewing the map needs nothing but a browser.

```
pip install -r requirements.txt
```

## How it works

The project has two halves that run at different times.

**The pipeline** (Python, runs when data changes) does all the geometry once and writes it to one data file, in three copies:
- `data/map_data.json`: the master copy
- `web/map_data.json`: served next to the map for websites and apps
- `web/map_data.js`: the same data as a script, so pages also work when opened straight from disk

**The renderer** (`web/campus-map.js`, plain JavaScript and SVG, no libraries) shows the two campus drawings (`web/renders/`, placed by `web/interiors.js`, see "Detailed renders" below) and puts tappable buildings, rooms, routes and markers on them. Any page can mount it into any element. It has no other way to draw the map: without the drawings it refuses to start.

```
data/raw/campus_footprints.geojson ─┐                       ┌─> data/map_data.json
data/raw/bac_maps.kml ──────────────┼─> pipeline/build.py ──┼─> web/map_data.json
pipeline/config.py ─────────────────┘                       └─> web/map_data.js ───────┐
drawings/ ───> pipeline/interiors.py ──> web/interiors.json, web/interiors.js, renders/ ┤
                                                                                        │
                                    web/campus-map.js ──── draws ───────────────────────┘
                                      ├─ web/index.html       demo page with controls
                                      ├─ web/embed.html       bare map for apps and iframes
                                      └─ web/pathfinder.html  navigation game
```

### Pipeline files

| File | What it does |
|---|---|
| `config.py` | Everything a person decides: storey counts, buildings traced in Earth, satellite outlines that were replaced, which traced edges form a road, walkway or bridge, what each area is, raised areas, stair positions, roof pitch. **Edit this, not the code.** |
| `geo.py` | Reads the GeoJSON and KML files. Converts GPS to metres from one fixed origin (the north west corner of the footprints; x east, y south). |
| `geometry.py` | The three real algorithms, described below. |
| `build.py` | Runs everything in order and prints a summary. |

### The three algorithms

**Indoor corridor** (`indoor_centreline`). The main building's corridor is hidden under its roof, so it can't be traced from satellite. The footprint is rasterised at 40 cm, every cell gets its distance to the nearest wall, and Dijkstra finds the cheapest route between the corridor's two ends, where cells near walls are expensive. The result follows the middle of the building. It measures 180.5 m against 186 m traced by hand in Google Earth, and stays at least 1.26 m from every wall.

**Roads, walkways and bridges** (`road_from_edges`). Each was traced as two edge lines. Walking along the longer edge, the width at every step is the distance across to the other edge, lightly smoothed, so a road that is 4 m at one end and 9 m at the other is drawn that way. Where one edge stops early, the last real width carries forward rather than closing the gap diagonally.

**Roofs** (`pitched_roof`). Roof height at any point is the roof pitch times its distance to the nearest wall, up to a ridge. Grouping points by nearest wall gives one plane per wall. It is one continuous surface, so planes can't cross or leave gaps, even on the concave main building.

The roof planes (`roof.facets`, `roof.caps`) were drawn by the old vector map and are no longer used by any page; the web only reads `roof.rise`, to make each building's tap area as tall as its roof. They are still written to `map_data.json`.

### Renderer basics

Map metres reach drawing pixels through the thin-plate spline in `interiors.json` (`renders.warp`); a height `z` moves a point up the drawing by `height_px_per_m` pixels per metre. The drawings have one fixed viewpoint, so the map pans and zooms but never rotates or tilts. Buildings, areas and the rooms of the floor in view become invisible hit areas through the same warp, so they can be tapped and highlighted. Panning and zooming only move the SVG viewBox, so they stay smooth on phones; the scene is only rebuilt when the floor or the route changes.

## Using the map in a website or app

The website and app stack haven't been chosen yet. The module was written so either can use it without changes.

### In a web page

```html
<div id="map" style="height: 600px"></div>
<script src="campus-map.js"></script>
<script>
  Promise.all([CampusMap.load("map_data.json"), CampusMap.load("interiors.json")]).then(([data, interiors]) => {
    const map = CampusMap.mount(document.getElementById("map"), { data: Object.assign({}, data, { interiors }) });
    map.on("select", feature => console.log(feature));   // null when the user taps empty ground
  });
</script>
```

The data must include `interiors` with its `renders` (the drawings), and the `renders/` folder must be next to the page; `mount` throws otherwise. `fetch` doesn't work for pages opened from disk, so for a local file load `map_data.js` and `interiors.js` with script tags and pass `Object.assign({}, CAMPUS_MAP_DATA, { interiors: CAMPUS_INTERIORS })` instead, as `index.html` does. The map fills whatever element it is given, so give that element a height.

### In an app

Load `embed.html` in a WebView. It has no controls of its own; the app drives it and listens for events. It shows the two campus drawings, so ship `interiors.js` and the `renders/` folder next to it (with `campus-map.js` and `map_data.js`); if the drawings are missing it shows a message and sends an `error` event.

- **App to map:** call methods on `window.campusMap`, for example `campusMap.focus('Block D')`. On Android that's `webView.evaluateJavascript(...)`. Or post a message: `{ "target": "campus-map", "cmd": "focus", "args": ["Block D"] }` (add an `"id"` to get a `result` event back).
- **Map to app:** every event arrives as a JSON string, `{ "source": "campus-map", "type": "select", "payload": {...} }`, through whichever channel the app provides: Android `addJavascriptInterface` object named `AndroidBridge` (method `onMapEvent`), Flutter JavaScript channel `CampusMapChannel`, React Native WebView, iOS message handler `campusMap`, or `postMessage` to an iframe's parent. Types: `ready` (`{ features }`), `select` (the feature, or `null`), `viewchange` (`{ zoom, rotation }`), `result`, `error`.
- **Options in the URL:** `embed.html?floor=0&rotation=30&tooltip=0&gestures=0`. `floor` is `all`, `0` (the ground-floor cutaway drawing) or `1`; `rotation` turns the drawings flat on the screen, in degrees clockwise. `?data=https://…/map_data.json` loads the map data from a server; the drawings still come from `interiors.js`.
- **No longer supported:** the URL options `theme`, `labels`, `shadows` and `cutaway`, and the command `orbit`, belonged to the old vector map. The options are ignored and the command does nothing (a command with an `id` gets no `result`). The drawings are light whatever the system theme. They can be turned flat on the screen (`rotation`, `rotateTo`) but not tilted or seen from another side: each is one picture from one viewpoint.

### API

`CampusMap.mount(element, options)` returns a map object. All options are optional except `data`.

| Option | Default | |
|---|---|---|
| `data` | | contents of `map_data.json`, plus `interiors` (contents of `interiors.json`, with `renders`) |
| `floor` | `"all"` | `"all"`, `0` or `1`. `0` shows the ground-floor cutaway drawing and its rooms; otherwise the campus drawing with the first floor's rooms |
| `hiddenFloors`, `focusFloor` | `[]`, `null` | finer floor control, used by the pathfinder's Floors panel |
| `tooltip` | `true` | `false` if the host shows its own details panel; `"hover"` for mouse hover only |
| `gestures` | `true` | drag to pan, pinch or scroll to zoom, twist (two fingers), Shift+drag, right-drag or Shift+scroll to turn, double tap to reset |
| `rotation` | `0` | degrees clockwise: the drawings, routes, markers and taps all turn together about the middle of the campus drawing; labels stay upright |
| `animate` | `true` | animated camera moves (off with reduced motion) |
| `minZoom`, `maxZoom` | `0.6`, `40` | pixels per metre |
| `storeyHeight` | `3.2` | metres; sets how tall each building's tap area is |

| Method | |
|---|---|
| `set({ ... })` | change any option, e.g. `map.set({ floor: 0 })`; unknown options are ignored |
| `get()` | current options plus zoom |
| `fit()` | show the whole campus |
| `zoomTo(pxPerMetre)` | |
| `rotateTo(degrees, { animate })` | turn the map about the middle of the screen; `0` is the drawing as drawn |
| `focus(name, { zoom })` | centre on and highlight a building, area or room |
| `highlight(name)` | highlight without moving; `null` clears |
| `select(name)` | as if tapped (fires `"select"`) |
| `features()` | everything selectable, for search boxes and lists (rooms are those of the floor in view) |
| `drawRoute(points)` | draw a route; points are `{ x, y, level }` in metres. Returns the length. A change in `level` is drawn as a stair climb. |
| `clearRoute()` | |
| `on(event, fn)` | `"ready"`, `"select"`, `"tap"`, `"viewchange"`. Returns a function that unsubscribes. |
| `data()`, `destroy()` | |

The pathfinder also uses `setOverlay`, `clearOverlay`, `setSprite`, `removeSprite`, `animateTo({ ground, z, scale })`, `fitTo`, `centerOn`, `groundToScreen`, `screenToGround`, `screenDirToGround`, `floors()` and `stats()`. `animateTo` also takes `rotation` (turns the shorter way) and `spin`; `tilt` and `orbit` went with the vector map in 2.0. Rotation came back in 2.1 as a flat turn of the drawings.

Keyboard, once the map has focus: arrows pan, `+` and `-` zoom, `0` resets, `Esc` clears the selection.

## Pathfinder game (`web/pathfinder.html`)

Open `web/pathfinder.html` in a browser (no server needed). It is built on this renderer, not instead of it, and reads the same `map_data.json`.

```
web/pathfinder.html    page and styles
web/pathfinder.js      app: player marker, route following, minimap, challenge, editor
web/nav-engine.js      navigation model + A* + collision (no dependencies, runs in Node too)
web/nav_seed.js        links the traced data cannot provide (marked as assumptions)
tests/nav.test.js      node tests/nav.test.js
```

**How routes are found.** `nav-engine.js` builds two things from `map_data.json` and joins them at doors:
- a 0.5 m ground grid for outdoors: traced roads, car parks, yards, plazas and walkways cost x1, untraced ground inside the campus boundary costs x2.5 (switch it off with "Traced surfaces only"), buildings and the rock are blocked;
- a graph for corridors (every metre), bridges, stairs and doors, on levels 0 and 1.

Doors are derived, not invented: where a traced path ends inside a building, or a ground floor corridor ends at a wall, the point where it crosses the wall becomes a door. Buildings with no door get one on the wall side nearest a traced walkway. A* uses straight-line distance as its heuristic, then each stretch of grid is pulled straight, but only where that is no costlier and keeps clear of walls. Search runs in 8 ms slices so the page stays responsive.

**Controls.** WASD move relative to the screen; in Third-person, W/S walk and A/D turn. Shift sprints, E uses stairs, F follow, I ground-floor cutaway and back, R whole campus as drawn, `[` `]` turn the map (also ⟲ ⟳, Shift+drag, right-drag, Shift+scroll or a two-finger twist; the N button points north and turns the map back), Esc closes or cancels, `` ` `` shows the performance monitor (also `?dev=1`). Tap a building, entrance (◆), car park or open ground for a card with *Navigate here*, *Start here* and *Zoom in* (*See inside* for the main building, *Show floor* for a room). On-screen buttons cover the movement keys.

**Camera views.** 3D view (the whole drawing), Follow marker, Third-person (follows the marker and turns the map so it always walks up the screen; A/D turn it). The drawings have one fixed viewpoint, so the camera pans, zooms and turns the map flat like a paper map, but cannot tilt or show another side. Camera moves are animated and respect reduced-motion settings; wheel zoom is eased; the view cannot be dragged off the campus.

**Routes.** A recommended route plus, when one exists, a genuinely different alternative (A* run again with the first route made costlier), each labelled with how much untraced ground it crosses. Leaving the route during navigation offers a recalculation (or does it automatically, if that setting is on).

**Performance.** The two drawings are plain images on their own GPU layer under the SVG, so routes, markers and the walking marker never make the browser repaint them; pan and zoom only move layers (the drawings are redrawn once after a zoom, so they stay sharp). The campus drawing loads first, the ground-floor cutaway once the page is idle, and each is downloaded and decoded once. The walking grid is built after the map's first frame is on screen. During the auto-walk demo only the parts of the route that depend on progress are redrawn (about 11 times a second), the text panel updates every 250 ms and the minimap at most every 100 ms. The demo can be paused and resumed from the bar at the bottom of the map. The player marker is an HTML sprite, so walking and following never repaint the map. The static campus outline and the base navigation grid are cached; edits only re-apply the edits (about 10-35 ms instead of 80+). Routes between named places are cached. Every search has its own pooled working arrays, so overlapping searches cannot interfere, and superseded searches are cancelled.

**Editing navigation data (admin only).** Open `pathfinder.html?admin=1`; visitors never see the editor. The "Edit navigation data" panel adds named places (rooms), links between paths or floors, blocked areas and walkable areas, and moves a destination's entrance ("Move a destination's entrance": tap the building, room or area, then tap where it is really entered; the point snaps to walkable ground, never inside a wall, and routes to that destination end there). Edits are saved in the browser (`localStorage`) and can be exported to and imported from `nav_edits.json`. Every saved edit re-checks the whole network and warns if anything is now cut off. "Check that every destination is connected" lists destinations with no entrance, destinations that have one but cannot be reached, and graph points cut off from the network (shown as red dots in Diagnostics, which also draws verified walks as dashed blue lines). "Check every room route" runs all room-to-room routes through the wall check.

**Renderer additions (nothing removed).** v1.1: `setOverlay(id, items)`, `clearOverlay(id)`, `screenToGround()`, `screenDirToGround()`, `centerOn()`, `fitTo()` and a `"tap"` event carrying ground coordinates. v1.2: option `view: "iso" | "top"`, `animateTo({ ground, z, scale, rotation, tilt, spin })`, `orbit(name)`, `select(name)`, `groundToScreen()`, `setSprite()` / `removeSprite()`, `stats()`, options `tooltip: "hover"`, `orbitSelected`, `animate`. `focus()` and `fit()` now fly instead of jumping. v2.0 removed the vector map: the drawings are required, and `view`, `rotateTo()`, `orbit()` and the rotation, theme and display options went with it.

**Tests.** `node tests/nav.test.js` (engine, 29 checks), `node tests/interiors.test.js` (floors, rooms, walls: 29 checks over all 1,560 room pairs), `node tests/concurrency.test.js` (overlapping searches), `node tests/walks.test.js` (routes follow verified walks, everything is connected, nothing crosses a wall: 14), `node tests/scenarios.test.js` (near and far, around a building, narrow corridors, many turns, between floors, inaccessible and walled-in places, alternatives, entrances, the auto-walk on the shown route: 24), `python tests/e2e_floors.py` (floor controls in the browser, 24), `python tests/e2e_core.py` and `python tests/e2e_perf.py` (browser: camera, selection, routes, navigation, memory, regressions; needs Playwright). `tests/e2e.py` runs both browser halves in one go.

## Detailed renders (the map you see in the pathfinder)

The two drawings in `drawings/` are the map: `web/renders/upper_floor.webp` (the campus, floor 1 on top) shows whenever floor 1 is visible, and `web/renders/ground_floor.webp` (the ground-floor cutaway) fades in over it when only the ground floor is shown. The pipeline writes them as lossless WebP (Pillow): the same pixels as the PNGs in `drawings/`, about 40% smaller. Navigation data is never moved to fit them. Instead `pipeline/interiors.py` fits a thin-plate spline from map metres to drawing pixels (control points: building labels, every room label against its room centre, and roads, car parks and paths matched by eye in `OUTDOOR_CTRL`) and writes it to `interiors.json` as `renders`. The renderer projects routes, markers, taps and invisible hit areas through that warp, so everything stays on the drawing while zooming, panning and switching floors.

- The drawings are the only map, on every page. `campus-map.js` has no vector view any more and `mount` throws without `interiors.renders`; `pathfinder.html`, `index.html` and `embed.html` show a message instead if `interiors.js` or `renders/` is missing.
- `python tools/serve.py` (IntelliJ: *Open map in browser*, then Run) serves `web/` at http://localhost:8765/pathfinder.html with caching off, so an outdated copy of the page can never come back, and opens it in your default browser. `--browser chrome` (or `edge`, `firefox`, ...) picks another browser, `--no-browser` only serves, and running it again while it is already serving just opens the map.
- Floor 1 overlays sit at roof height (`floor_height_m`), where the drawing labels its rooms.
- The drawings are not to scale, so alignment is approximate: median 1.6 m over the control points. The car park is drawn much narrower than it is, so routes there look squeezed. To improve alignment, add or correct a point in `OUTDOOR_CTRL` and re-run `python pipeline/interiors.py`.

## Main building floors (`web/interiors.json`)

The pathfinder now knows the inside of the main building on two floors: 40 rooms (17 ground, 23 first floor), a door for each, a glass door from the IT room, and five staircases between the floors. They come from the two draft-09 drawings in `drawings/`, but are fitted to the satellite footprint and corridor already in `map_data.json`, which stay the ground truth.

**How the drawings became data** (`pipeline/interiors.py`). The campus drawing was fitted to map coordinates with an affine transform over 17 buildings both share (median error 1.5 m, worst 6.7 m); the ground-floor drawing was fitted to the campus drawing over 9 shared features. Room labels then become positions in metres. The building's room space (footprint minus the 2.8 m corridor, its walls and the entrance passages) is shared between the rooms of each floor by Voronoi cells, so rooms keep the drawn order and side of the corridor but fill the real outline. Each room gets one door, in the middle of the wall facing the corridor. Re-run after changing the drawings' readings or `map_data.json`: `node pipeline/export_doors.js && python pipeline/interiors.py`.

**Walls.** Rooms are walkable inside, 25 cm clear of their walls; walls can only be crossed at doors (0.9 m doorways); space with no room stays blocked. Every route is sampled every 25 cm before it is shown. If the straightened line touched a wall it falls back to the unsmoothed path, and if that fails too, no route is shown and the spot is reported. Clearance from walls is an engine option (`clearance`, default 0.2 m).

**Floors in the app.** The Floors panel: for each floor highlight, hide/show and show only (◎). Showing or highlighting only the ground floor brings up the ground-floor cutaway drawing; anything with the first floor in view shows the campus drawing. One shared state drives the map, the list, the route and the marker. Searching "first floor lab" finds rooms by floor. Picking a room on a hidden floor brings that floor into view. If the route continues on a floor you cannot see, a prompt offers to show it. Walking or the demo going up or down stairs moves the view with you. Directions are grouped by floor. Keys: I ground-floor cutaway, PgUp/PgDn floor up/down.

**Diagnostics.** In Edit navigation data: "Diagnostics" draws room outlines, blocked space (red), walkable ways, doors and the unconfirmed stairs; "Check every room route" runs all 1,482 room-to-room routes through the wall check in about a second.

## Updating the map

**You re-traced something in Google Earth.** Export the project as KML, replace `data/raw/bac_maps.kml`, and run `python pipeline/build.py`. Names in the KML must match the names in `config.py` exactly.

**A building has a different storey count.** Change `FLOORS` (satellite footprints) or `KML_BUILDINGS` (traced in Earth) in `config.py` and rebuild.

**You traced a building in Earth.** Add it to `KML_BUILDINGS` with its storey count. A traced line is closed into an outline automatically. List any footprint it must not overlap under `subtract`, and use `height_m` for tiny structures like a booth.

**A satellite outline turns out to be wrong.** Add it to `REPLACED_FOOTPRINTS` and it is left out. Check what it covers first: the outline once named "Block A/B" turned out to be a real building with the wrong name.

**You found where a stairwell actually is.** In `config.py`, replace `"fraction": 0.42` with `"at": [x, y]` in metres. Stairs given by `at` are no longer marked as estimated.

**You walked or measured a route for real.** In Google Earth (phone or Pro), use Measure along the way people actually walk, save it, and export it as `.kml` or `.kmz`. Put the file in `data/raw/walks/` (one walk per file, any name) and run `python pipeline/build.py`, `node pipeline/export_doors.js` and `python pipeline/interiors.py`. Each walk becomes a 2 m footpath (`WALK_WIDTH_M` in `config.py`) that routes slightly prefer (cost ×0.8 against ×1 for other traced ground and ×2.5 for untraced ground), so a route follows it whenever it is about as short. Then run `node tests/walks.test.js`: it checks that the route between each walk's two ends stays on the walk. A walk across untraced ground also draws nearby routes onto it; walking or tracing the ground around it as well keeps those routes honest.

**You traced a new road, walkway or bridge.** Trace both edges as lines in Earth, then add a row to `EDGE_PAIRS` with its kind (`road`, `walkway` or `bridge`) and level.

**You traced an area.** Add it to `AREA_KINDS` (`parking`, `staff_parking`, `yard` or `plaza`) to set its colour. Areas that sit above the ground, like the chilling area on its rock, go in `ELEVATED_AREAS` with the floor level they are reached from.

## What is measured and what is estimated

| Data | Status |
|---|---|
| Building footprints | Traced from satellite, or in Google Earth for newer buildings |
| Storey counts | Stated by the team for the main building and hostels; **assumed** 1 for everything else |
| Roads, parking, outdoor walkways | Traced in Google Earth |
| Corridor width (2.8 m) | Measured on site |
| Ground floor indoor corridor | Computed from the footprint, checked against a hand trace |
| First floor indoor corridor | **Assumed** to mirror the ground floor, per the evacuation route sign |
| Stairwell positions | **Estimated** from the evacuation sign |
| Roof shapes and heights | **Generated** from footprints at a standard pitch |
| School Clinic outline | Traced in Earth under tree cover; 21 m² overlapping Hostel 1 was **cut away** |
| Chilling area rock height | **Set** to first floor level, since it is reached by bridge from the first floor |
| Names "Block \*" and the satellite "Block k" | **Unconfirmed**; see HANDOFF.md |
| Storey height (3.2 m) | Default; adjustable |

## Not built yet

- A Python or server side A*. The team spec asked for one; pathfinding currently runs in the browser (`nav-engine.js`), which also works offline and inside a WebView. The graph builder is a pure function of `map_data.json`, so porting it is mechanical.
- Rooms. The map has none, so room destinations come from the editor.
- WebGL. The renderer is SVG, so instancing, LOD and draw calls do not apply; the scene is about 480 elements and a full redraw takes 10-35 ms.
