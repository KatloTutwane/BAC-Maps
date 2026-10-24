# BAC Maps demo server

Serves the website and a small API over a local SQLite database of **dummy data**, so sign in and the profile can be shown before BAC approves the product. Python standard library only: nothing to install, nothing online.

## Run it

From the project folder:

```
python server/server.py
```

Then open http://127.0.0.1:8765/site/. Stop it with Ctrl+C.

| Option | |
|---|---|
| (no option) | Creates `campus.db` on first run. Later runs add any demo accounts added to `seed.py` since, without touching existing accounts or their data |
| `--reset` | Delete `campus.db` and rebuild it from `seed.py` (undoes every change made while testing). Only happens once the server has the port, so it never wipes the database of a server that is already running |
| `--port 9000` | Use another port. If the port is busy the server says so and stops |

The server listens on 127.0.0.1 only, so only this computer can reach it. It never serves `server/`, `.claude/`, `pipeline/`, `tools/`, `data/raw/` or `data/timetables/` as files, so the database can't be downloaded.

## Demo accounts

Six dummy accounts: five students, one per CSE Year 3 class group (demo1 CSE3-1 to demo5 CSE3-5), and one staff member, each with saved places. A student's My day shows their group's real timetable; they can change group in the profile. The timetable is only for signed in students: guests don't see it. Their numbers and the shared demo password are at the top of `seed.py`. Every account is flagged as demo, and the site shows a "Demo account" badge.

The people, numbers and passwords are made up; the class groups and timetables are real. Passwords are stored as salted PBKDF2 hashes, never in plain text.

## Files

| File | What it does |
|---|---|
| `server.py` | The web server and the API |
| `db.py` | Schema, connection and password hashing |
| `seed.py` | The dummy accounts, timetables and saved places |
| `campus.db` | The database, created on first run. Not committed (see `.gitignore`); delete it or use `--reset` to start again. A database made before class groups is upgraded on start: the column is added and each existing demo student gets their group, programme and year from `seed.py` (only where no group is set), so their timetable appears; their own classes and saved places are kept |

## API

All JSON. The session is an HttpOnly, SameSite=Strict cookie that lasts 7 days.

| | |
|---|---|
| `POST /api/login` | `{ username, password }` gives `{ user }` and sets the cookie; 401 if they don't match |
| `POST /api/logout` | Ends the session |
| `GET /api/me` | `{ user }` (including `group`), or 401 when signed out |
| `PUT /api/me/group` | `{ group }` sets the user's class group (a code from `site/data/timetables.json`, or null) |
| `GET /api/classes` | `{ classes: [...] }` for the signed in user |
| `POST /api/classes` | `{ id?, title, placeId, days, start, end }` creates or updates a class; gives `{ class }` |
| `DELETE /api/classes/<id>` | Deletes a class |
| `GET /api/saved` | `{ saved: [placeId, ...] }` |
| `PUT /api/saved/<placeId>` / `DELETE` | Saves or unsaves a place |

`placeId` is a place id from `site/places.js`: a feature name from the map data (`Block D`) or `extra:` plus a room in the Main Building (`extra:Lecture Theatre`). Days are 0 Sunday to 6 Saturday.

## Moving to a real backend

When BAC approves the product, replace the demo accounts with BAC sign in (Microsoft 365, or BAC numbers checked by BAC's systems) and keep the same API, so `site/store.js` and `site/login.js` barely change. The A* pathfinding service the team plans in Python can be added to this server as another `/api/` route.
