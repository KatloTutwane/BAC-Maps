/* BAC Maps: place catalogue.
 *
 * Turns the map's features (MapAdapter.places()), the rooms of the Main
 * Building (MapAdapter.rooms()) and the gate and entrance positions
 * (NavAdapter.landmark()) into the places the UI shows: display names,
 * categories, floors, search and quick chips. No map calls here.
 *
 * Every place carries `navId`, the id of the same destination in the
 * Pathfinder engine ("building:Block D", "room:F1-lt", ...), or `point`
 * ({ x, y, level }) where the engine has a position but no place.
 */
(function (global) {
  "use strict";

  var CATEGORIES = [
    { key: "academic", label: "Academic and offices", icon: "cat-academic" },
    { key: "residence", label: "Residences", icon: "cat-residence" },
    { key: "health", label: "Health", icon: "cat-health" },
    { key: "food", label: "Food and money", icon: "cat-food" },
    { key: "outdoor", label: "Outdoor", icon: "cat-outdoor" },
    { key: "facility", label: "Facilities", icon: "cat-facility" }
  ];
  var CAT = {};
  CATEGORIES.forEach(function (c) { CAT[c.key] = c; });

  /* Spelling and case fixes for names as they appear in map_data.json.
     "Block k" is left alone: it may be a wrong label for another building
     (HANDOFF.md 2.3), and "Block K" already exists. */
  var DISPLAY = {
    "Main buildin": "Main Building",
    "Block f": "Block F",
    "Block g": "Block G",
    "Pc 1": "PC 1",
    "Maitron house": "Maitron House",
    "Ladies Toilet": "Ladies Toilets",
    "Gents Toilet": "Gents Toilets",
    "Lecturer's offices": "Lecturer's Offices",
    "Parking lot": "Parking Lot",
    "Parking lot 2 & recreational area": "Parking Lot 2 & Recreational Area",
    "Chilling area": "Chilling Area",
    "Staff chilling area": "Staff Chilling Area",
    "Recreational area": "Recreational Area",
    "Mitron's yard": "Mitron's Yard"
  };

  /* Left out until its real name is confirmed (HANDOFF.md 2.3). */
  var HIDDEN = { "Block *": true };

  /* Storey counts the team stated. Every other building is assumed to have
     one floor (README, "What is measured and what is estimated"). */
  var CONFIRMED_FLOORS = { "Main Building": true, "Hostel 1": true, "Hostel 2": true, "Hostel 3": true };

  /* Descriptions only where the team has written one down.
     Source: WEBSITE_HANDOFF.md, Appendix A. */
  var DESCRIPTIONS = {
    "Chilling Area": "On the rock, reached by bridge from the Main Building first floor."
  };

  /* Extra words people might type for a room, where its drawn label is short. */
  var ROOM_WORDS = { "LT": "lecture theatre", "WC M": "toilets gents men", "WC F": "toilets ladies women", "M toilets": "gents men", "W toilets": "ladies women" };

  /* Real places with no shape of their own on the map. Rooms the drawings
     don't show point to the building they are in; directions go to that
     building. Entrances take their position from the verified walks. */
  var EXTRAS = [
    { name: "Refectory", parent: "Main Building", category: "academic" },
    { name: "Tutorial Building", parent: "Main Building", category: "academic" },
    { name: "Administration", parent: "Main Building", category: "academic" },
    { name: "Main Gate", category: "facility" },
    { name: "Student Entrance", category: "facility" },
    { name: "Staff Entrance", category: "facility" }
  ];

  /* Ids the site used before the rooms were mapped; saved timetables and
     saved places may still hold them. */
  var OLD_IDS = { "extra:Lecture Theatre": "room:F1-lt", "extra:Reception": "room:F1-reception" };

  /* Extra words people might type, per category. */
  var ALIASES = {
    health: "doctor nurse medical",
    food: "food snacks shop money cash",
    facility: "bathroom restroom car",
    residence: "residence dorm",
    outdoor: "outside",
    academic: "office class"
  };

  /* Quick chips on the search view. */
  var CHIPS = [
    { label: "Clinic", category: "health", test: /clinic/i },
    { label: "Tuckshop", category: "food", test: /tuckshop/i },
    { label: "ATM", category: "food", test: /\batm\b/i },
    { label: "Toilets", category: "facility", test: /toilet|\bwc\b/i },
    { label: "Parking", category: "facility", test: /parking/i },
    { label: "Chilling area", category: "outdoor", test: /chilling/i }
  ];

  function displayName(raw) {
    if (DISPLAY[raw]) return DISPLAY[raw];
    var m = /^Staff parking (\d+)$/i.exec(raw);
    return m ? "Staff Parking " + m[1] : raw;
  }

  function categoryOf(name, kind) {
    if (/clinic/i.test(name)) return "health";
    if (/tuckshop|\batm\b|kitchen/i.test(name)) return "food";
    if (/^hostel|maitron/i.test(name)) return "residence";
    if (/toilet|\bwc\b|laundry|parking|entrance|gate/i.test(name)) return "facility";
    if (/chilling|recreational|yard/i.test(name) || /^(yard|plaza|raised_area)$/.test(kind)) return "outdoor";
    return "academic";
  }

  /* The engine's id for a map feature: see places in web/nav-engine.js. */
  function navIdOf(f) {
    if (f.kind === "building") return "building:" + f.name;
    if (f.kind === "raised_area") return "raised:" + f.name;
    return "area:" + f.name;
  }

  var collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  function byName(a, b) { return collator.compare(a.name, b.name); }

  /* Build the UI's place list.
     features: MapAdapter.places(); rooms: MapAdapter.rooms();
     landmark(name): NavAdapter.landmark; floorName(level): MapAdapter.floorName. */
  function build(features, rooms, landmark, floorName) {
    var list = [], index = {}, live = !!(rooms && rooms.length);
    features.forEach(function (f) {
      if (!f || !f.name || HIDDEN[f.name]) return;
      var name = displayName(f.name);
      var p = { id: f.name, name: name, mapName: f.name, kind: f.kind, category: categoryOf(name, f.kind), onMap: true };
      if (live) p.navId = navIdOf(f);
      if (f.kind === "building" && f.floors) { p.floors = f.floors; p.floorsAssumed = !CONFIRMED_FLOORS[name]; }
      if (f.kind === "raised_area" && f.level) { p.reachedFrom = f.level; p.level = f.level; }
      if (DESCRIPTIONS[name]) p.description = DESCRIPTIONS[name];
      list.push(p); index[name] = p;
    });
    (rooms || []).forEach(function (r) {
      var parent = index[displayName(r.building)];
      list.push({
        id: "room:" + r.id, name: r.name, mapName: r.name, kind: "room", roomType: r.type,
        category: r.type === "cafeteria" ? "food" : r.type === "toilet" ? "facility" : categoryOf(r.name, "room"), level: r.level, floorName: floorName ? floorName(r.level) : "",
        parent: parent ? parent.name : displayName(r.building), approx: r.approx,
        navId: "room:" + r.id, words: ROOM_WORDS[r.name] || "", onMap: true
      });
    });
    EXTRAS.forEach(function (e) {
      var parent = e.parent ? index[e.parent] : null;
      var point = !e.parent && landmark ? landmark(e.name) : null;
      list.push({
        id: "extra:" + e.name, name: e.name, category: e.category,
        kind: e.parent ? "room" : "entrance",
        parent: e.parent || null,
        mapName: parent ? parent.mapName : null,
        navId: parent ? parent.navId : null,
        roomUnmapped: !!parent,
        point: point,
        onMap: !!(parent || point)
      });
    });
    return list.sort(byName);
  }

  function normalise(s) {
    return String(s || "").toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/\s+/g, " ").trim();
  }

  /* Every word typed must appear somewhere; names that start with the
     query come first. "first floor lab" finds the labs upstairs. */
  function search(list, query) {
    var q = normalise(query);
    if (!q) return [];
    var words = q.split(" ");
    return list.filter(function (p) {
      var hay = normalise([p.name, CAT[p.category].label, p.parent, p.floorName, p.roomType, p.words, ALIASES[p.category]].join(" "));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    }).sort(function (a, b) {
      var sa = normalise(a.name).indexOf(q) === 0 ? 0 : 1, sb = normalise(b.name).indexOf(q) === 0 ? 0 : 1;
      return sa - sb || byName(a, b);
    });
  }

  function forChip(list, chip) {
    return list.filter(function (p) { return chip.test.test(p.name); });
  }

  global.Places = {
    CATEGORIES: CATEGORIES,
    CHIPS: CHIPS,
    category: function (key) { return CAT[key]; },
    build: build,
    search: search,
    forChip: forChip,
    canonicalId: function (id) { return OLD_IDS[id] || id; }
  };
})(window);
