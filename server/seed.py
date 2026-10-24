"""
Dummy data for the BAC Maps demo database.

The people, numbers and passwords are made up so the profile and sign in can
be shown before BAC approves the product. The class groups and their
timetables are real (data/timetables/, built into site/data/timetables.json). Every account is flagged is_demo and the site labels it
"Demo account".

Demo sign in, for testing and for markers:
    student or staff number: any number below (demo1 to demo5, staff1)
    password:                DEMO_PASSWORD

Place ids must match site/places.js: a feature name from map_data.json
("Block D", "Lecturer's offices"), "room:" plus a room id from
web/interiors.json ("room:F1-lt", the Lecture Theatre), or "extra:" plus a
place the drawings don't show ("extra:Tutorial Building").
"""
from db import hash_password

DEMO_PASSWORD = "campus2026"

# Days: 1 Monday ... 6 Saturday
# Students are given a real class group from site/data/timetables.json (CSE
# Year 3, Semester 1 2026/27), so My day shows that group's real timetable.
# Their own extra classes start empty.
DEMO_USERS = [
    {
        "bac_number": "demo1", "name": "Kagiso Demo", "role": "student",
        "programme": "CSE Year 3", "year": 3, "group": "CSE3-1",
        "classes": [],
        "saved": ["School Clinic", "Tuckshop", "Chilling area"],
    },
    {
        "bac_number": "demo2", "name": "Naledi Demo", "role": "student",
        "programme": "CSE Year 3", "year": 3, "group": "CSE3-2",
        "classes": [],
        "saved": ["Pc 1", "School ATM"],
    },
    {
        "bac_number": "demo3", "name": "Thabo Demo", "role": "student",
        "programme": "CSE Year 3", "year": 3, "group": "CSE3-3",
        "classes": [],
        "saved": ["Hostel 2"],
    },
    {
        "bac_number": "demo4", "name": "Lesego Demo", "role": "student",
        "programme": "CSE Year 3", "year": 3, "group": "CSE3-4",
        "classes": [],
        "saved": ["Block B", "Tuckshop"],
    },
    {
        "bac_number": "demo5", "name": "Boitumelo Demo", "role": "student",
        "programme": "CSE Year 3", "year": 3, "group": "CSE3-5",
        "classes": [],
        "saved": ["Main buildin", "School Clinic"],
    },
    {
        "bac_number": "staff1", "name": "Mpho Demo", "role": "staff",
        "programme": None, "year": None, "group": None,
        "classes": [],
        "saved": ["Staff parking 1", "Lecturer's offices"],
    },
]


def assign_groups(conn):
    """For a database made before class groups: give each existing demo
    student its group, programme and year from DEMO_USERS. Only accounts
    without a group are touched, so a group someone picked is kept."""
    for u in DEMO_USERS:
        if u["group"]:
            conn.execute(
                "UPDATE users SET group_code = ?, programme = ?, year = ?"
                " WHERE lower(bac_number) = ? AND is_demo = 1 AND group_code IS NULL",
                (u["group"], u["programme"], u["year"], u["bac_number"].lower()),
            )


def seed(conn, only_missing=False):
    """Insert the demo accounts. With only_missing, add just the accounts the
    database doesn't have yet, leaving existing ones and their data alone."""
    have = {r[0].lower() for r in conn.execute("SELECT bac_number FROM users")} if only_missing else set()
    for u in DEMO_USERS:
        if u["bac_number"].lower() in have:
            continue
        salt, digest = hash_password(DEMO_PASSWORD)
        cur = conn.execute(
            "INSERT INTO users (bac_number, name, role, programme, year, group_code, password_salt, password_hash, is_demo)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
            (u["bac_number"], u["name"], u["role"], u["programme"], u["year"], u["group"], salt, digest),
        )
        user_id = cur.lastrowid
        for title, place, days, start, end in u["classes"]:
            conn.execute(
                "INSERT INTO classes (user_id, title, place_id, days, start, end) VALUES (?, ?, ?, ?, ?, ?)",
                (user_id, title, place, ",".join(str(d) for d in days), start, end),
            )
        for place in u["saved"]:
            conn.execute("INSERT INTO saved_places (user_id, place_id) VALUES (?, ?)", (user_id, place))
