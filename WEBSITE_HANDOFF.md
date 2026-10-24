# BAC Maps: Website, handover

**Update, 24 October 2026: rebuilt in React.** The interface is now a React 18 application built with Vite. The source is in `frontend/` (see `frontend/README.md`); `npm run build` writes the app to `site/`, which `server/server.py` serves as before. Views became components, the card's views a `ViewStack` component, and `map-adapter.js`, `nav-adapter.js`, `places.js` and `store.js` ES modules in `frontend/src/lib/`. The design, CSS and behaviour are unchanged, and both browser suites (`tests/e2e_site.py`, `tests/e2e_profile.py`) pass against it. Where this document names `site/` files below, they now live under `frontend/`.

**Update, 23 October 2026: merged with the finished map.** The site now lives in `campus-navigator-map/` next to the map it hosts, and runs on the finished map and Pathfinder instead of the older isometric copy it was built on (the `BAC-Maps` folder, left as it was). What changed:
- **The map** is the campus drawings (`web/campus-map.js` 2.1, `interiors.js`, `renders/`), with the Main Building's 40 rooms on two floors. The floor switcher shows the ground-floor cutaway (Ground) or the campus drawing (All, First).
- **Directions are real.** `site/nav-adapter.js` builds Pathfinder's model (`web/nav-engine.js`, the same as `web/pathfinder.html`) and the Directions view shows its route on the map with distance, walking time, stairs, the share on unmapped ground, an alternative route, and steps grouped by floor; tapping a step pins it on the map. "Walk it" runs a marker along the route; "Clear route" removes it. From can now be changed (Your location, or any place); it still defaults to the user's location, or the Main Gate.
- **Places** come from the map and the interiors: every room is searchable ("first floor lab", "lecture theatre"), and taps on rooms open them. Reception and Lecture Theatre are now the real rooms (old saved ids still work); Refectory, Tutorial Building and Administration are still not drawn, so they lead to the Main Building and say so.
- **Main Gate and Student Entrance** have positions, read from where the verified walks start and end (2.2). Staff Entrance still has none.
- **The location dot** is the map's own sprite, so the workaround in 2.4 is gone; `map-theme.css` no longer recolours the map (the drawings have their own colours, 2.4b).
- Superseded below: 2.1, 2.2 (partly), 2.4, 2.4b, and the "no distances" and "Route coming soon" notes in section 1.

**Status as of 17 October 2026.** The website is built as a working prototype in `site/`: plain HTML, CSS and JavaScript, no framework and no build step, around the existing map module. It replaces the design tool concept described in earlier versions of this document. The concept's prompts are kept as Appendices A and B for history; parts of them are now superseded (see section 4).

| | |
|---|---|
| The site | `site/index.html`; see `site/README.md` to run it |
| The map it hosts | `web/campus-map.js`, documented in `README.md` and `HANDOFF.md` |
| First concept (superseded) | `docs/website-concept-v1.png`, Appendix A |

---

## 1. What the site has

The map fills the whole screen. Everything else floats over it.

**Phones and narrow screens (under 768 px): bottom pill and card.** A white floating pill at the bottom centre: a profile picture slot on the left (a generic person until there are accounts), the prompt "Dumela! Where to on campus?" in the middle, and a Directory button on the right. Tapping it expands it upward into a card with a cyan line along its top: full width on phones, at most 70% of the screen height. Drag the handle down, tap it, tap the close button, or press Escape to collapse it.

Views slide inside the card with a back arrow:
- **Search:** search field with a clear button, six quick picks (Clinic, Tuckshop, ATM, Toilets, Parking, Chilling area), and results showing an icon tile, name and category. **No distances** until A* exists.
- **Place details:** name, category, floors (marked "assumed" where the team hasn't confirmed them), location for rooms inside the Main Building, access for the Chilling Area, and the one description the team has written. "Directions" (primary) and "Show on map". No hours anywhere, because none are known.
- **Directions:** see below.
- **Directory:** collapsible category groups with counts.

**Phones (under 768 px).** Top left: one tab holding the BAC logo, the floor switcher (All, Ground, First) and a Whole campus icon. Top right: the compass. The pill and card sit at the bottom.

**Desktop (768 px and wider), laid out like the reference design.** A top bar: the logo, "Maps" wordmark (it reads "bac Maps" beside the logo) and floor switcher on the left, a search pill in the centre, and Directory and the profile picture on the right. The card drops down as a panel under the search pill, centred on it and matching its width (at least 360 px), and opens on load with a "Dumela!" greeting, minimise and close buttons, a "40 places on campus" banner with "Show list", the quick picks, and the places viewed this visit. The top bar search drives the panel. Compass, Whole campus and zoom in and out sit bottom right. The light map is restyled to the reference's white ground, light grey streets and buildings, with the selected building in blue (`site/map-theme.css`).

Nothing else sits on the map: no footer strip, no breadcrumb, no annotation toolbar.

**Profile (a view in the card or panel).** Opened from the profile picture (in the pill on phones, top right on desktop). It shows:
- **Who:** signed in, the account's name, initials, role, number, programme and year, with a "Demo account" badge and Sign out. As a guest, "Guest, Not signed in" with a Sign in button.
- **Signed in students only:** guests don't see My day at all, just a prompt to sign in for their timetable. Saved places still work for guests.
- **Class group:** students pick their group (CSE3-1 to CSE3-5 for now) and My day fills in from the **real timetable**: course, room and lecturer initials for each class, with Directions to the room's building. Group classes are read only; tapping one shows when, where, lecturer and who it's shared with. The timetables come from `data/timetables/` (CSE Year 3, Semester 1 2026/27, exported from primetimetable.com) and are built into `site/data/timetables.json` by `tools/build_timetables.py`, which also says which building each room is in.
- **My day:** the user can also add their own classes (name, place, days Monday to Saturday, start and end time). A card at the top says what's on now or next, for example "Next: Financial Accounting, Block D, starts in 20 min", with Directions and Show on map. Day buttons list each day's classes; tapping one edits or deletes it.
- **Saved places:** places saved with the new Save button in place details.
- **Settings, Appearance:** Light, Dark or Device (follows the phone or computer; the default). Kept on the device. `site/theme.js` sets `<html data-theme>` before the page draws, and every stylesheet and the map follow it.
Signed in, the timetable and saved places live in the demo database; a guest's saved places stay in the browser (`site/store.js`).

**Installable app (PWA).** The site is also the mobile app. `site/manifest.webmanifest` names it "BAC Maps" with icons made from the BAC logo, and `site/sw.js` is a service worker that keeps the app shell, icons, `campus-map.js` and `map_data.js` on the device so it opens offline. Android and desktop Chrome get an "Install app" row at the foot of the card; iPhone Safari gets a one time hint, "Install: tap Share, then Add to Home Screen."; neither shows once installed. When the device is offline the card says so.

**Sign in page (`site/login.html`).** Its own page: "Sign in with Microsoft" on top, then student or staff number and password, and "Continue as guest". Sign in is optional; the map works without it. The number and password are checked against a **local SQLite database of dummy accounts** run by `server/server.py` (see `server/README.md`); the page says it is a demo build. Sign in with Microsoft waits for BAC's approval and says so.

**Directions from the user's location.** There is no From field and no swap button. "From: Your location" is shown with a location icon and can't be edited; "To" is a button that opens a destination picker. The browser Geolocation API drives four states: asking permission, locating, found (a pulsing cyan dot on the map, ground floor assumed because GPS can't detect floors), and fallback. Fallback covers denied, unavailable, timed out and off campus, and says "We couldn't find you on campus. Directions will start from the Main Gate." Pathfinding doesn't exist yet, so the view shows the start and destination and a "Route coming soon" note. **It never draws a fake route.**

**Also:** light and dark mode, following the device unless the user picks one in the profile (the map follows too), keyboard support, visible focus rings, labels on every icon button, 44 px minimum tap targets, and no sideways scrolling at 375 px. If the map files fail to load, a placeholder (faint isometric grid, "Campus map") and a small mock list of places keep every feature working.

---

## 2. Open issues, in priority order

### 2.1 A* pathfinding (blocks real directions and distances)
Directions stop at "Route coming soon". Once A* returns points, the Directions view calls `map.drawRoute(points)` through the adapter, and distances can be shown. The start is either the user's dot (`{ x, y, level: 0 }` in map metres) or Main Gate.

### 2.1b Sign in uses dummy data until BAC approves the product
Sign in, the profile, the timetable and saved places run on a local demo server and SQLite database of made up accounts (`server/`). That is enough to show the features; it is not connected to BAC. After approval: replace the demo accounts with BAC sign in (Microsoft 365 needs an app registration with BAC's IT office; BAC numbers need BAC's systems to check them), keep the same API so `site/store.js` and `site/login.js` barely change, and fill the profile from the real account.

### 2.1c The app needs an HTTPS host to install on phones
Service workers and installing only work over HTTPS (or on localhost for testing). To install the PWA on a phone, host the project on any HTTPS static host (GitHub Pages, Netlify, the college's web server), with `site/` and `web/` side by side so `../web/` resolves. Static hosting runs the map, search, directions and guest profile; demo sign in needs `server/server.py`, which only runs on the developer's computer. Ship updates by raising `VERSION` in `site/sw.js`. The app icons are made from the 236 x 113 px logo, so the 512 px icons are slightly soft; a larger or SVG logo from BAC would sharpen them (see `site/README.md`, "Icons").

### 2.1d Timetables cover CSE Year 3 only
Only the five CSE Year 3 groups are in. To add more programmes or a new semester: put each group's exported `timetable_<GROUP>.json` in `data/timetables/`, add any new room codes to `ROOMS` in `tools/build_timetables.py`, run `python tools/build_timetables.py`, and raise `VERSION` in `site/sw.js`. Course names show as abbreviations (CSA, AWD (Java), IS, R & I) until full names are added to `COURSES` in the same script. Rooms point to a building, not to the room itself, until the map has rooms.

### 2.2 Main Gate has no coordinates
Nothing in `map_data.json` marks the Main Gate, Student Entrance or Staff Entrance. The site lists them (marked "Not on the map yet") and uses Main Gate as the fallback start by name only. Trace them as points in Google Earth, or add them to `config.py`, so routes can start there.

### 2.3 GPS origin not exported
`site/geo.js` converts latitude and longitude to map metres with the same formula as `pipeline/geo.py`. The origin isn't saved in `map_data.json`, so its constants were recomputed from `data/raw/campus_footprints.geojson`; they reproduce the map's footprint coordinates exactly. If the footprints change, the origin moves. Fix: have `build.py` write `"origin": { "lng0", "lat0", "m_lng", "m_lat" }` into the data; the site already uses it when present.

### 2.4 The map module can't draw markers
The location dot is drawn in an overlay by `site/map-adapter.js`, which repeats the module's projection maths and reads the SVG viewBox. That depends on module internals. Adding either of these to `campus-map.js` would remove the workaround:
- `map.project({ x, y, level })` returning container pixels, or
- `map.setMarker(id, { x, y, level, kind })` and `map.clearMarker(id)`.

### 2.4b The map module has no palette option
`site/map-theme.css` recolours the light map from outside by matching the hex values in `PALETTES.light` in `campus-map.js` and filtering the building groups. If the module's palette changes, those rules stop matching. A `palette` option on `CampusMap.mount` (and a class on the selected building that the site can colour) would make this robust.

### 2.5 BAC brand colours not verified
The site uses brand cyan `#12A5DD` (accents only) and brand dark `#0B6E99` (fills with white text), replacing the earlier `#274A80`. Neither comes from an official brand guide. Get them from BAC or colour pick a high resolution logo, then change them in `site/tokens.css`; every colour is a custom property there.

### 2.6 Profile picture missing
`site/assets/bac-logo.png` is BAC's own logo, downloaded on 18 October 2026 from https://www.bac.ac.bw/assets/images/logo.png (236 x 113 PNG). It sits straight over the map, top left, beside the floor tab, with no box behind it: a soft white halo in light mode and a thin white outline in dark mode keep its black strokes readable. `site/assets/profile.png` doesn't exist yet, so the profile slot shows a generic person. Tapping the profile picture does nothing until accounts exist.

### 2.7 Names still unconfirmed
"Block \*" is left out of the site. "Block k" (the satellite trace) is shown as is, next to "Block K", until the naming questions in `HANDOFF.md` 2.3 are settled. The site fixes spelling and case for display only ("Main buildin" shows as "Main Building"); the map's own labels still show the raw names.

### 2.8 Not yet tested
A real phone's permission prompt and GPS (the preview browser blocks location, so the states were tested with simulated positions), and a screen reader.

---

## 3. How the website talks to the map

The site keeps the map in an empty container (`id="campus-map"`) and does not use Google Maps, Mapbox or Leaflet. **Every map call lives in `site/map-adapter.js`**, so swapping in a new map touches nothing else. Each UI control maps to one call:

| UI element | Adapter | Map call |
|---|---|---|
| Search, quick picks and directory | `places()`, `rooms()` | `map.features()`, `interiors.rooms` |
| Tap a result, or "Show on map" | `focus(name)`; rooms switch floor first; gate and entrances `focusPoint(p)` | `map.focus(name)`; `map.animateTo` and a pin overlay |
| Hover or keyboard focus on a row | `highlight(name)` | `map.highlight(name)` |
| Floor switcher | `setFloor(v)` | `map.set({ floor: "all" })`, `0` or `1` |
| Whole campus | `fit()` | `map.fit()` |
| Zoom in and out (desktop) | `zoomBy(f)` | `map.zoomTo(map.get().zoom * f, { animate: true })` |
| Compass | `faceNorth()`; needle turned by `northAngle()` | `map.rotateTo(0)`; north measured with `map.groundToScreen` |
| User taps a building or room | `on("select")` opens place details; `null` closes them | `map.on("select", ...)` |
| User location dot | `showUser({ x, y })` | `map.setSprite("me", ...)` |
| On campus check | `bounds()`, `origin()` | reads the map data |
| Directions | `NavAdapter.route(from, to)`, then `showRoute(points, pad)` | Pathfinder `findRoutesAsync`; `map.drawRoute`, `map.fitTo` |
| Clear route, Walk it | `clearRoute()`, `walk(route)` | `map.clearRoute()`; `map.setSprite("walk", ...)` |
| Map's own popup | | `tooltip: false` when mounting |

The drawings are not drawn north up, so the compass needle shows where north falls on them; tapping it turns the map back to the drawings as drawn (rotation 0).

`site/places.js` adds what the map data doesn't carry: categories, display names, rooms inside the Main Building (they focus the Main Building), entrances, search and the quick picks. `map.features()` stays the source of truth.

The mobile app is this same site installed as a PWA, so it uses the same calls. `embed.html` is only needed if a native wrapper is wanted later; see "Using the map in a website or app" in `README.md`.

---

## 4. Decisions made, and why

| Decision | Reason |
|---|---|
| Plain HTML, CSS and JavaScript, no build step | The stack is still undecided; this moves into React or JSP without a rewrite. Views are render functions and state lives in one object. |
| The app is called BAC Maps | Renamed from Campus Navigator in October 2026. The group project is still the Campus Navigator project; the website and installed app are BAC Maps. |
| The mobile app is a PWA, not a native app | One codebase for website and app, installable on Android and iPhone without an app store, and it works offline. A native wrapper around `embed.html` stays possible later. |
| Bottom pill and card on phones, a panel under the top search on desktop | The pill keeps the map the hero on small screens; on desktop the panel drops down from the search, so the results sit where the user typed. Both are the same pill and card, positioned by CSS. Supersedes Appendix A's side panel and three height bottom sheet. |
| No From field or swap button | Directions always start from where the user is, or from Main Gate. Supersedes Appendix A's From and To fields. |
| No distances, times or steps | They would be invented until A* exists. The first concept showed made up distances. |
| No hours or descriptions unless the team wrote them | Same reason. The one description (Chilling Area) comes from Appendix A. |
| All map calls in one adapter file | The map files may be replaced; only the adapter needs to change. |
| Placeholder and mock list when the map is missing | Lets the UI be worked on without the map; add `?map=off` to the URL to test it. |
| Brand cyan for accents only, brand dark for fills | White text on cyan fails contrast (2.8:1); on brand dark it passes (5.7:1). |
| Focus ring: dark core with a cyan halo | Cyan alone is 2.8:1 on white, below the 3:1 a focus ring needs. |
| Dark mode keeps the brand dark fill | A lightened blue under white text drops below 4.5:1. Category accents and cyan are lightened about 20%. |
| Clean, airy style: white floating panels with soft shadows, hairline borders, content in light bordered cards, a close button on the card, Plus Jakarta Sans | Chosen after review from a reference design, after trying soft claymorphism, frosted glass and an outlined style with hard shadows. Colours stay BAC: brand dark for fills, cyan for accents and the card's top line. |
| Magenta kept for routes only | It is the map's route colour; using it elsewhere would make routes harder to spot. |
| "Block \*" left out | Its real name is still unconfirmed (`HANDOFF.md`, 2.3). |

---

## 5. Next steps

1. Build A* and connect it to the Directions view (2.1).
2. Add Main Gate and the entrances to the map data (2.2).
3. Export the GPS origin from the pipeline (2.3) and add a marker API to the map module (2.4).
4. Confirm the BAC brand colours, for example by sampling them from the logo now in site/assets (2.5).
5. Test on a real phone on campus and with a screen reader (2.8).
6. Pick the final stack; the site ports as it is.

---

## Appendix A: the prompt that produced v1

Kept for history. Superseded by the built site: the left side panel and three height bottom sheet (now the pill and card), the From field and swap button, distances and step lists (until A* exists), and `#274A80` (now `#12A5DD` and `#0B6E99`).

```text
Design a mobile first, responsive web app called "Campus Navigator" for Botswana
Accountancy College (BAC) in Gaborone, Botswana. It helps new students, visitors and
staff find buildings and facilities on campus and get walking directions, including
routes inside buildings, up stairs and between floors.

THE MAP (important)
The centre of every screen is an interactive isometric 3D campus map that we have
already built ourselves. Do NOT build a map with Google Maps, Mapbox or Leaflet. Leave
a full bleed container for it (id "campus-map") showing a soft placeholder: a light
warm grey area with a faint isometric grid and the text "Campus map". All other UI
floats over or beside this container. Our map will later connect to the UI through:
focus(placeName), showFloor("all" | 0 | 1), drawRoute(points), and a select(place)
event when someone taps a building.

VISUAL STYLE: minimal layout with soft claymorphism controls
- Calm, uncluttered, lots of breathing room. The map is the hero; UI stays light.
- Claymorphism only on interactive elements (search bar, chips, buttons, floor
  switcher, bottom sheet handle): soft rounded shapes (16 to 24px radius), gentle
  inner highlight plus a soft outer shadow so they feel pressable. Flat, quiet surfaces
  everywhere else.
- Colours: take BAC's brand colours from the attached BAC logo if provided. Otherwise use:
    BAC blue (primary, buttons, active states)  #274A80
    Deep navy (headings, body text)              #16233D
    Blue tint (selected rows, chips)             #E6ECF5
    Warm off white (page background)            #F5F3EE
    Route highlight (walking route on the map)  #C2185B
  Use the blue with restraint: one primary action per screen.
- Typography: one clean humanist sans serif (e.g. "Plus Jakarta Sans" or "Manrope").
  Clear hierarchy, large tap targets (min 44px), tabular numbers for distances.
- Simple line icons, no emoji, no stock photos of people, no gradients.
- Include a dark mode version of the palette.

SCREENS
1. Home (map): full screen map. Floating search bar at the top ("Search a building,
   room or service"). Under it, a row of quick chips: Clinic, Tuckshop, ATM, Toilets,
   Parking, Chilling area. Bottom right: a floor switcher (All / Ground / First) and a
   "Whole campus" button.
2. Search: results list as you type, each with a category icon, name, category and
   walking distance from the main gate (e.g. "Block D · Academic · 140 m").
3. Place details: a bottom sheet on mobile, a left side panel on desktop. Shows name,
   category, number of floors, a short description, opening hours where relevant, and
   two buttons: "Directions" (primary) and "Show on map".
4. Directions: "From" (defaults to Main gate) and "To" fields with a swap button.
   Summary card: total distance and walking time (e.g. "320 m · 4 min"). Then numbered
   steps, e.g. "Enter through the Student entrance", "Follow the ground floor corridor
   for 60 m", "Take the stairs near the Lecture Theatre to the first floor", "Cross the
   bridge to the Chilling area". Tapping a step highlights it on the map.
5. Directory: browse everything by category, as collapsible groups with counts.

REAL PLACES TO USE (no placeholder text)
Academic and offices: Main Building (Reception, Refectory, Lecture Theatre, Tutorial
Building, Administration), Block A, Block B, Block D, Block F, Block F2, Block G,
Block K, Block K 2, Lecturer's Offices, PC 1
Residences: Hostel 1, Hostel 2, Hostel 3, Maitron House
Services: School Clinic, Tuckshop, School ATM
Facilities: Ladies Toilets, Gents Toilets, Parking Lot, Parking Lot 2, Staff Parking 1 to 5
Outdoor: Chilling Area (on the rock, reached by bridge from the Main Building first
floor), Staff Chilling Area, Recreational Area, Mitron's Yard
Entrances: Main Gate, Student Entrance, Staff Entrance

LAYOUT
- Mobile (375px): map full screen, search on top, details and directions in a
  draggable bottom sheet with three heights (peek, half, full).
- Desktop (1440px): 380px left panel for search, details and directions; map fills
  the rest.
- Show empty, loading and "no results" states, and the selected state of a building.
- Accessible: WCAG AA contrast, visible focus rings, labels on all icon buttons.
```

## Appendix B: colour follow-up prompt (for v2)

Paste this into the same session so the tool keeps the layout and only changes colour.

```text
Keep the layout, spacing and components exactly as they are. Only add colour.

1. BAC blue #274A80 for structure and action:
   - Panel header: a blue band behind the logo and title, white text on it.
   - Active chip: solid blue fill with a white label and icon.
   - Primary buttons ("Directions") solid blue; focus rings blue.
   - Selected search result: a 3px blue bar on its left edge and a #E6ECF5 fill.

2. One accent colour per category. Use it on chip icons, the rounded icon tile in
   each search result, and the header of the place details sheet. Keep all text in
   navy #16233D so contrast stays AA.
     Academic and offices   #274A80  tint #E6ECF5
     Residences             #C8622A  tint #FBEBDD
     Health (Clinic)        #2D8BA0  tint #E0F1F4
     Food and money         #B07A1C  tint #FBF1DC   (Tuckshop, ATM)
     Outdoor                #5F7F35  tint #EEF2E2   (Chilling area, yards)
     Facilities             #5E6B78  tint #EBEEF1   (Toilets, Parking)
   Inactive chips: white clay surface with the icon in the category accent.

3. Magenta #C2185B is reserved for the walking route only. Do not use it anywhere
   else.

4. Map placeholder: keep it neutral, but tint it slightly cooler (#EEF0EC) so the
   panel and map are clearly separate.

5. Remove the floating toolbar at the bottom centre of the map (select, text, pen,
   comment icons); it is not part of the app.

6. Hide the distances in search results for now, or label every one "approx."

7. Apply the same accents in dark mode, lightened about 20% so they read on dark
   backgrounds.

Then show the mobile home screen, the place details sheet for "School Clinic", and
the directions screen from Main Gate to Chilling Area.
```
