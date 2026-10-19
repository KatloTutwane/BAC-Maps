"""
Campus Navigator: things a person decides, kept out of the code.

Edit this file when the campus data changes, then run:
    python pipeline/build.py
"""

# Storey count per building. Anything not listed is treated as 1 storey.
FLOORS = {
    "Main buildin": 2,
    "Hostel 1": 2,
    "Hostel 2": 2,
    "Hostel 3": 2,
}

# Two footprints in the source file were both called "Block f".
# The second one (by file order) is renamed to this.
DUPLICATE_RENAMES = {"Block f": ["Block f", "Block F2"]}

# Roads and walkways traced in Google Earth as two lines, one per edge.
# Each entry pairs the two edge lines into one surface.
#   kind   "road"    tarmac with a centre line
#          "walkway" a footpath at ground level
#          "bridge"  a raised walkway; level 1 = first floor height
# Names must match the KML exactly. Repeated names get " (2)" appended.
EDGE_PAIRS = [
    # name                         edge A                              edge B                               kind       level
    ("Main road to parking lot",   "Along the road to parking lot",    "Along road to parking lot",         "road",    0),
    ("Inner road to parking lot",  "Along road 2 to parking lot",      "Along road 2 to parking lot (2)",   "road",    0),
    ("Staff entrance road",        "Staff entrance",                   "Staff entrance 2",                  "road",    0),
    ("Walkway to Block A & B",     "Path to block A & B",              "Path to block A & B (2)",           "walkway", 0),
    ("Bridge to chilling area",    "Path to chilling area 1",          "Path to chilling area",             "bridge",  1),
    ("Bridge to chilling area 2",  "Path to chilling area 2",          "Path to chiling area 2",            "bridge",  1),
]

# Verified walks: lines in data/raw/walks/*.kml or *.kmz, walked or measured for real.
# Each becomes a footpath this wide that routes slightly prefer (cost x0.8 instead of x1),
# so a route follows it when it is about as short as any other way.
WALK_WIDTH_M = 2.0

# Walk files that hold more than walks. A placemark with several unnamed lines (Google Earth
# MultiGeometry) is read one line at a time and numbered "name", "name (2)", "name (3)" in file order.
#   boundary: lines that together trace the campus fence. They are joined end to end into one
#             outline (the build stops if they do not close). Untraced ground only counts as
#             walkable inside it. These lines are never used as walks.
#   names:    readable names for unnamed lines, taken from where each one starts and ends.
#             A walk that repeats an earlier walk point for point is skipped automatically.
WALK_FILES = {
    "paths.kmz": {
        # five straight lines (drawn with altitude, unlike the walks) joining into one loop around every building
        "boundary": ["paths (2)", "paths (3)", "paths (4)", "paths (5)", "paths (6)"],
        "names": {
            "paths":      "Main Gate to Block A, through the main building",
            "paths (7)":  "Main Gate to the main entrance stairs",
            "paths (8)":  "Fence 25 m east of the Main Gate to the main entrance stairs",
            "paths (9)":  "Main Gate to the staff entrance road",
            "paths (10)": "Main Gate to the School ATM",
            "paths (11)": "Main Gate to the parking lot, along the main road",
            "paths (12)": "Parking lot to the student entrance",
            "paths (13)": "Main Gate to the student entrance",
            "paths (14)": "Parking lot to the Main Gate, along the inner road",
        },
    },
}

# Buildings traced in Google Earth rather than in the original footprint file.
# A traced line is closed into an outline automatically.
#   subtract: footprints this one must not overlap (the overlap is cut away)
#   height_m: overrides floors x storey height, for small structures like a booth
KML_BUILDINGS = {
    "School Clinic": {"floors": 1, "subtract": ["Hostel 1"]},
    "Block A":       {"floors": 1},
    "Block B":       {"floors": 1},
    "Ladies Toilet": {"floors": 1},
    "Gents Toilet":  {"floors": 1},
    "Tuckshop":      {"floors": 1},
    "School ATM":    {"floors": 1, "height_m": 2.6},
    "Block K":            {"floors": 1},
    "Block K 2":          {"floors": 1},
    "Block *":            {"floors": 1},   # name not known yet
    "Lecturer's offices": {"floors": 1},
}

# Satellite footprints that were wrong and have been re-traced in Google Earth.
# They are left out of the map. Delete a line to bring a footprint back.
REPLACED_FOOTPRINTS = {
    # This outline was the grey roofed building, labelled wrongly. Re-traced as "Block *",
    # which covers 85% of it. Block A and Block B were traced separately.
    "Block A/B": "re-traced in Google Earth as Block *",
}

# What each traced area is, which sets its colour. Anything not listed is "area".
AREA_KINDS = {
    "Parking lot": "parking",
    "Parking lot 2 & recreational area": "parking",
    "Mitron's yard": "yard",
    "Recreational area": "yard",
    "Staff chilling area": "plaza",
    "Staff parking 1": "staff_parking",
    "Staff parking 2": "staff_parking",
    "Staff parking 3": "staff_parking",
    "Staff parking 4": "staff_parking",
    "Staff parking 5": "staff_parking",
}

# Areas that sit above the ground. The chilling area is on top of a large rock,
# reached only by bridges from the main building's first floor.
ELEVATED_AREAS = {
    "Chilling area": {"level": 1, "kind": "rock"},
}

# The building whose indoor corridor is computed from its footprint,
# and the traced line whose two ends mark where that corridor starts and stops.
INDOOR = {
    "building": "Main buildin",
    "endpoints_from": "Main buildin ground floor corridor",
    "first_floor_mirrors_ground": True,   # per the evacuation route sign
}

# Stairwells, placed as a fraction of the way along the indoor corridor.
# These are ESTIMATES read off the evacuation sign. Replace with real
# coordinates (metres) by setting "at": [x, y] instead of "fraction".
STAIRS = [
    {"name": "Stair well (Lecture Theatre)", "fraction": 0.42, "connects": [0, 1]},
    {"name": "Stair well (Reception)",       "fraction": 0.80, "connects": [0, 1]},
]

# Roof shape: rise per metre inward from the wall (0.62 is roughly 32 degrees),
# and the furthest a roof slope may run before it flattens into a ridge cap.
ROOF_SLOPE = 0.62
ROOF_MAX_RUN_M = 4.0
