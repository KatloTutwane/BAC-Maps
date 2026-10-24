"""
Build frontend/public/data/timetables.json from the class timetables in data/timetables/.

    python tools/build_timetables.py

Each source file is one group's timetable as exported from primetimetable.com
(timetable_<GROUP>.json). The output is one tidy file the website reads
directly, so picking a group works for guests, on a static host and offline.

Rooms: the timetables use room codes such as "MC-Lab 1/017". ROOMS below says
which map place each room is in (a place id from site/places.js) and how to
show it. A room missing from ROOMS stops the build, so nothing is guessed.
"""
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "timetables"
OUT = ROOT / "frontend" / "public" / "data" / "timetables.json"   # npm run build copies it into site/

# Room code -> (label shown in the app, map place id or None for no place).
# Confirmed by the team on 21 October 2026.
ROOMS = {
    "MC-PC1/D001":    ("Room D001, PC 1", "Pc 1"),
    "MC-B001-3 (PC)": ("Rooms B001 to B003, Block B", "Block B"),
    "MC-Lab 1/017":   ("Lab 1 (room 017), Main Building", "Main buildin"),
    "MC-Lab 2/018":   ("Lab 2 (room 018), Main Building", "Main buildin"),
    "#Online":        ("Online", None),
}

# Course abbreviations from the timetables. Add full names here when the team
# confirms them; until then the app shows the abbreviation.
COURSES = {}

DAYS = {"Sunday": 0, "Monday": 1, "Tuesday": 2, "Wednesday": 3, "Thursday": 4, "Friday": 5, "Saturday": 6}


def programme_label(raw):
    # "BAC SCIS - CSE Yr 3" -> "CSE Year 3"
    name = raw.split(" - ", 1)[-1]
    return name.replace(" Yr ", " Year ")


def main():
    files = sorted(SRC.glob("timetable_*.json"))
    if not files:
        sys.exit("No timetable_*.json files in %s" % SRC)
    groups, unknown_rooms, terms, sources = [], set(), set(), set()
    for f in files:
        t = json.loads(f.read_text(encoding="utf-8"))
        terms.add(t.get("term", ""))
        sources.add(t.get("source", ""))
        classes = []
        for e in t["entries"]:
            if e["room"] not in ROOMS:
                unknown_rooms.add(e["room"])
                continue
            shared = e.get("groups") or ([e["group"]] if e.get("group") and e["group"] != t["group"] else [])
            classes.append({
                "day": DAYS[e["day"]],
                "start": e["start"],
                "end": e["end"],
                "course": e["course"],
                "room": e["room"],
                "lecturer": e.get("lecturer", ""),
                "with": [programme_label("x - " + g) for g in shared],   # shared with these groups
            })
        classes.sort(key=lambda c: (c["day"], c["start"]))
        groups.append({"code": t["group"], "programme": programme_label(t["programme"]), "classes": classes})

    if unknown_rooms:
        sys.exit("Rooms not in ROOMS, add them first: " + ", ".join(sorted(unknown_rooms)))

    out = {
        "term": " / ".join(sorted(x for x in terms if x)),
        "source": " / ".join(sorted(x for x in sources if x)),
        "built": date.today().isoformat(),
        "rooms": {code: {"label": label, "placeId": place} for code, (label, place) in ROOMS.items()},
        "courses": COURSES,
        "groups": sorted(groups, key=lambda g: g["code"]),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    n = sum(len(g["classes"]) for g in groups)
    print("Wrote %s: %d groups, %d classes" % (OUT.relative_to(ROOT), len(groups), n))


if __name__ == "__main__":
    main()
