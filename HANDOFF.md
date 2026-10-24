# Campus Navigator: Isometric Map Builder, handover

**Status as of 18 October 2026.** The whole campus is mapped: 22 buildings, the roads, parking, walkways, indoor corridors and the chilling area, plus the main building's interior on both floors and a first measured footpath (Main Gate to Hostels). The map is now a reusable JavaScript module that a website or an app can host. Still open: three naming questions, the website and app tech stack, and confirming the pathfinding and main-building-interior assumptions (sections 2.2, 2.2b). This document is for whoever picks the work up next.

| |                                                                                   |
|---|-----------------------------------------------------------------------------------|
| Project | Campus Navigator, BAC group project. This is the Isometric Map Builder component. |
| Owner so far | Maroon 5                                                                          |

| Code | `campus-navigator-map/` (this folder)                                                                                         |
| View | Open `web/index.html` in any browser. No server or Python needed.                                                             |
| Rebuild data | `pip install -r requirements.txt`, then `python pipeline/build.py`                                                            |

---

## 1. What exists today

**On the map:** 22 buildings, 3 roads, 9 routes (2 indoor corridors, 2 bridges and 1 measured walk among them), 10 ground areas (parking, staff parking, yards, paved areas), 1 raised area (the chilling area rock) and 2 stairwells.

**The renderer** (`web/campus-map.js`, plain JavaScript and SVG, no libraries):
- Mounts into any element on any page: `CampusMap.mount(element, { data })`
- Shows the two detailed campus drawings (`web/renders/`, placed by `web/interiors.js`); it has no other way to draw the map and refuses to start without them. The old vector (isometric) view was removed in v2.0
- Touch and mouse: drag to pan, pinch or scroll to zoom, double tap to show the whole campus. The drawings have one fixed viewpoint, so the map never rotates or tilts
- A floor filter (all, ground, first): ground shows the ground-floor cutaway drawing and its rooms
- Tap a building, area or room to select it; the host page gets a `select` event with its details
- `focus()` to fly to a building, `features()` for search lists, `drawRoute()` for pathfinding results, including stair climbs between floors
- Works at phone width

**Two pages built on it:**
- `web/index.html`: demo page with a floor selector, search and an example route. It only uses the public API, so it doubles as sample code for the website.
- `web/embed.html`: the bare map for a WebView or iframe, with a message bridge for Android, Flutter, React Native, iOS and iframes. See README, "Using the map in a website or app".

**The pipeline** (`pipeline/`, Python): turns the Google Earth traces into `map_data.json`. Edit `config.py` for anything a person decides; the code doesn't need touching. A clean rebuild from `data/raw/` reproduces the data byte for byte, which was checked on every release. It also turns measured GPS walks (`data/raw/walks/`) into footpaths that routes prefer when about as short, checked by `tests/walks.test.js`.

**Main building interiors** (added 12 October, see 2.2b): 40 rooms across both floors, derived from two drawings and fitted to the satellite footprint, with doors and five staircases. `pipeline/interiors.py` builds `web/interiors.json`; the pathfinder reads it directly.

**Tested:** desktop mouse (click, wheel zoom, drag), phone touch (tap select, fits the screen, no sideways scrolling), the app bridge in both directions (commands in, `ready` and `select` events out). No script errors.

---

## 2. Open issues, in priority order

### 2.1 Website and app stack: BAC Maps, merged in (23 October 2026)
The website and app are **BAC Maps**: a React application (source in `frontend/`, built into `site/` with `npm run build`), installable as a PWA, with a demo sign in server (`server/`). It was built in the separate `BAC-Maps` folder on an older copy of this map, and is now merged here and wired to this map and to Pathfinder (directions, rooms, floors). Run `python server/server.py` and open http://127.0.0.1:8765/site/. Details and open issues: `WEBSITE_HANDOFF.md`, `frontend/README.md`. The options below stay open for a native wrapper or a different stack:
- **Website:** plain HTML, React or a JSP page can all load `campus-map.js` with a script tag. React would only need a small wrapper component.
- **App:** Kotlin, Flutter, React Native or iOS can all load `embed.html` in a WebView. The bridge for each is already written.

Once it's chosen, the remaining work is wiring the host's own screens (search box, details panel, directions) to the map's API and events.

### 2.2 A* pathfinding: built, with assumptions to confirm
Done: `web/pathfinder.html` (see README, "Pathfinder game"). Search, route drawing, directions, a walkable marker with collision, stairs, off-route recalculation, arrival notice, minimap, challenge mode and an editor all work. 29 engine tests pass (`node tests/nav.test.js`), and the page was exercised in headless Chromium at desktop and phone sizes.

What the traced data could not give, and what was done about it:
| Gap | What was done | To fix properly |
|---|---|---|
| The traced roads, car parks and walkways form 7 separate pieces | Untraced ground inside the campus boundary counts as walkable at x2.5 cost. "Traced surfaces only" turns this off | Trace the missing walkways |
| 19 of 22 buildings have no entrance | Main building doors come from where traced paths meet its wall (5 doors). Other buildings get a door on the wall side nearest a traced walkway | Mark real doors; the editor can add places |
| Nothing joins the two bridges to the first floor corridor | Two links in `web/nav_seed.js`, kept inside the footprint and marked assumed | Survey the first floor |
| No rooms | Editor "Add place" | Collect room positions |
| Stair positions and the first floor corridor | Still the estimates from section 2.4 | As in 2.4 |

Since then (9 October): camera views (3D, top-down, follow, third-person), tap-to-select cards, alternative routes, an off-route offer, a performance monitor, GPU pan and zoom, caching, and a fix for overlapping searches corrupting each other. Browser tests: `tests/e2e_core.py` (28 checks) and `tests/e2e_perf.py` (15). All pass.

Not done: a Python A* service (see README, "Not built yet"), and testing on real phones and on Safari or Firefox.

### 2.2b Main building interiors (two floors), added 12 October
Built from `drawings/main_building_ground_floor_3d.png` and `drawings/Upper_floor_.png` (draft 09). See README, "Main building floors". All tests pass.

To verify on site, in order of importance:
1. **Is there a third level?** Both drawings show two levels (the campus drawing says "main building two levels"). The brief mentioned a Ground, First and Upper floor; the "Upper floor" drawing is treated as the first floor. A third level can be added in `FLOORS` and the room lists in `pipeline/interiors.py` once a plan exists.
2. **Stairs between CAF and LT**: marked as stairs on the campus drawing only. Not connected until confirmed.
3. **Lifts**: none on either drawing, so none modelled.
4. **Office 3** has no wall on the corridor in the satellite footprint, so it has no door and cannot be routed to. Add its door in the editor or confirm where it is.
5. **Room sizes and exact positions** are approximate. The drawings are "not to scale" and put the south-east wing 4-8 m east of the satellite footprint; rooms were fitted to the footprint. Labs on that wing come out 3-4 m deep because the estimated corridor runs near its outer wall; the drawings instead show a covered walkway on the courtyard side.
6. **Doors**: one per room on the corridor side, plus the IT room's glass door; bridges enter CAF and the nearest first-floor room. Where rooms really have their doors is not drawn for most rooms.
7. The new outdoor features in draft 09 (lawn, gazebos, outdoor gym, leisure tent, Block E naming) are not in `map_data.json`.

### 2.3 Three naming questions
| Question | Detail |
|---|---|
| What is "Block \*" called? | The grey-roofed building south of the main building. Traced without a name. |
| Which one is Block K? | The new trace "Block K" sits south of the main building. The original satellite file also has a "Block k" 94 m away, near Pc 1 and Block f. One of the names is wrong. **Both are kept on the map until this is confirmed.** |
| Are Block K and Block K 2 one building? | They sit 0.3 m apart, which looks like one building with two roof sections. |

Renaming is one line in `config.py` (`KML_BUILDINGS`) or a rename in Google Earth before the next export.

### 2.4 Estimates still standing in for real data
| Item | Current value | How to fix |
|---|---|---|
| Storeys for everything traced in Earth (Blocks A, B, K, K 2, \*, Lecturer's offices, clinic, toilets, Tuckshop) | Assumed 1 | Edit `KML_BUILDINGS` in `config.py` |
| Stairwell positions | Estimated from the evacuation route sign | Replace `"fraction"` with `"at": [x, y]` in `STAIRS` |
| First floor corridor | Copy of the ground floor route | Survey it, or confirm the copy is close enough |
| School Clinic outline | 21 m² overlapping Hostel 1 was cut away | Check on site which building the overlap belongs to |
| Roof shapes and heights | Generated from footprints at about 32° | Fine for an isometric map; no action needed |

### 2.5 Minor
- The live map link still runs the older single-file version of the renderer. It has all the current data, but not the module features (gestures, search, example route). Republish when the stack is settled; see section 7.
- "Main buildin" is misspelled in the original footprint file. Renaming it means updating `FLOORS` and `INDOOR` in `config.py` too.
- The inner road has a small kink where its traced edge wiggles. That's real trace data, not a bug.

---

## 3. How the data flows

```
data/raw/campus_footprints.geojson ─┐                       ┌─> data/map_data.json
data/raw/bac_maps.kml ──────────────┼─> pipeline/build.py ──┼─> web/map_data.json
data/raw/walks/ ─────────────────────┘                       └─> web/map_data.js ───────┐
pipeline/config.py ──────────────────┘                                                  │
drawings/ ───> pipeline/interiors.py ──> web/interiors.json, web/interiors.js, renders/ ┤
                                                                                         │
                                     web/campus-map.js ──── draws ──────────────────────┘
```
(full detail, including the renderer's three pages, is in README, "How it works")

**To update the map after tracing in Earth:**
1. In Earth, **Save** each new shape (it only joins the project once saved), then export the project as KML.
2. Replace `data/raw/bac_maps.kml` with the newest export. Earth names every export "BAC Maps (n).kml", so check you have the latest.
3. If you added something new, register it in `config.py` (see below).
4. Run `python pipeline/build.py` and read the summary it prints.
5. Open `web/index.html` to check.

**Registering new things in `config.py`:**
| You traced | Add it to |
|---|---|
| A building | `KML_BUILDINGS`, with `floors`. Tiny structures can use `height_m`. |
| A replacement for a wrong satellite outline | `REPLACED_FOOTPRINTS` |
| A road, walkway or bridge as two edge lines | `EDGE_PAIRS`, with kind and level |
| A parking lot, yard or paved area | `AREA_KINDS` (`parking`, `staff_parking`, `yard`, `plaza`) |
| Something raised above the ground | `ELEVATED_AREAS`, with the floor level it's reached from |

Names in `config.py` must match the KML exactly. A repeated name gets " (2)" added automatically. The build warns and skips anything it can't find instead of failing.

---

## 4. Decisions made, and why

| Decision | Reason |
|---|---|
| Python prepares the data, JavaScript draws it | The geometry needs scipy and shapely, which don't run in a browser. Doing it once ahead of time keeps the page fast and dependency free. |
| The renderer is a framework-free module | The website and app stack are undecided. Plain JavaScript runs in every option, and apps host it in a WebView, so there is one renderer to maintain rather than one per platform. |
| Satellite tracing instead of measuring walls by hand | An isometric map doesn't need wall-by-wall precision, and tracing covers areas students can't access. |
| Indoor corridor computed from the footprint | It's hidden under the roof, so it can't be traced. The computed route came out at 180.5 m against a 186 m hand trace in Earth. |
| Roads and walkways traced as two edge lines | Gives real widths, which vary: the main road is about 4 m at one end and 9 m at the other. |
| Chilling area as a rock at first floor height, reached by two bridges | Matches the site: it's on a large rock and only accessible from the main building's upper floor. |
| No paid map platform (e.g. MapMe) | The assignment is to build the application. Walking directions on MapMe start at about $110/month, and its routing couldn't use our own graph or indoor corridors. |

---

## 5. Things that caught us out

- **One satellite screenshot was upside down.** The phone screenshot of the campus has south at the top. Google Earth exports are north up. The GPS data was always correct.
- **A good outline was deleted because of its name.** The satellite outline called "Block A/B" was removed when Blocks A and B were traced elsewhere. It was actually the grey-roofed building with the wrong label; the later trace "Block \*" lands almost exactly on it (85% overlap). Lesson: check what a shape covers before deleting it. The same may be true of the satellite "Block k".
- **An export with no new traces.** One upload was byte for byte the same as the previous export, because the new shapes hadn't been saved in Earth.
- **Duplicate names in KML.** Earth allows two features with the same name. The pipeline renames the second one, so config entries may need the " (2)" suffix.
- **Two edge lines ending in different places** used to make wedge-shaped roads. The road builder now carries the last measured width forward, but stopping both edges at the same point gives the cleanest result.

---

## 6. File map

```
campus-navigator-map/
├── HANDOFF.md              this file
├── WEBSITE_HANDOFF.md      BAC Maps: layout, how the UI calls the map and Pathfinder, open issues
├── README.md               setup, algorithms, API, integration, update guide
├── frontend/               BAC Maps source: React + Vite (frontend/README.md)
├── site/                   BAC Maps as built by npm run build; served by server/server.py
├── server/                 demo server and SQLite demo accounts for BAC Maps (server/README.md)
├── docs/                   the first website concept image
├── requirements.txt        numpy, scipy, shapely, contourpy, pillow (pipeline only)
├── drawings/               the two draft-09 drawings used for the interiors
├── tests/                  nav.test.js, interiors.test.js, concurrency.test.js, walks.test.js, scenarios.test.js (node);
│                           e2e_core.py, e2e_perf.py, e2e_floors.py, e2e.py (browser, needs Playwright)
├── data/
│   ├── raw/
│   │   ├── campus_footprints.geojson   original satellite outlines
│   │   ├── bac_maps.kml                latest Google Earth export
│   │   └── walks/                      measured GPS walks, one file per walk (see 1, "footpaths")
│   └── map_data.json       generated master copy; do not edit by hand
├── pipeline/
│   ├── config.py           edit this
│   ├── geo.py
│   ├── geometry.py
│   ├── build.py
│   ├── export_doors.js     doors derived from map_data.json, for interiors.py to read
│   └── interiors.py        main building floors from drawings/ (see 2.2b)
├── tools/
│   └── serve.py            local dev server (README, "Detailed renders")
└── web/
    ├── campus-map.js       the renderer module; edit this for visual changes
    ├── index.html          demo page and sample code
    ├── embed.html          bare map with the app and iframe bridge
    ├── map_data.json       generated; for websites and apps to fetch
    ├── map_data.js         generated; lets pages work when opened from disk
    ├── pathfinder.html/.js the pathfinder game (README, "Pathfinder game")
    ├── nav-engine.js       navigation model, A*, collision
    ├── nav_seed.js         assumed links (see 2.2; replaced by interiors when present)
    ├── interiors.json/.js  rooms, doors, stairs per floor (generated, see 2.2b)
    └── renders/            ground_floor.webp, upper_floor.webp (generated by interiors.py)
```

---

## 7. Republishing the live map

The live link is an artifact page. To move it onto the module version, publish `web/index.html` with `campus-map.js`, `map_data.js`, `interiors.js` and the two images in `renders/` as supporting files. Strip the outer `<!DOCTYPE>`, `<html>`, `<head>` and `<body>` tags from the page first, since the host adds its own. Once the website exists, the live link may not be needed at all.
