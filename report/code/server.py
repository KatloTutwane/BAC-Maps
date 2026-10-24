"""
BAC Maps demo server: serves the site and a small JSON API over the
SQLite demo database. Python standard library only; nothing to install.

    python server/server.py            then open http://127.0.0.1:8765/site/
    python server/server.py --reset    rebuild campus.db from seed.py first
    python server/server.py --port 9000

It listens on 127.0.0.1 only, so it is reachable from this computer and
nowhere else. Demo accounts are in seed.py.

API (all JSON; the session is an HttpOnly cookie):
    POST   /api/login            { username, password } -> { user }
    POST   /api/logout
    GET    /api/me               -> { user } or 401
    PUT    /api/me/group         { group: "CSE3-2" | null } -> { user }
    GET    /api/classes          -> { classes: [...] }
    POST   /api/classes          { id?, title, placeId, days, start, end } -> { class }
    DELETE /api/classes/<id>
    GET    /api/saved            -> { saved: [placeId, ...] }
    PUT    /api/saved/<placeId>
    DELETE /api/saved/<placeId>
"""
import argparse
import json
import os
import posixpath
import re
import secrets
import sys
from http import cookies
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent        # the project folder
COOKIE = "cn_session"
SESSION_DAYS = 7
TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
PRIVATE = ("/server", "/.claude", "/.git", "/.venv", "/.idea", "/pipeline", "/data/raw", "/data/timetables", "/tools")   # never served as files
TIMETABLES = ROOT / "frontend" / "public" / "data" / "timetables.json"


def group_codes():
    """Class groups the website knows, from frontend/public/data/timetables.json."""
    try:
        return {g["code"] for g in json.loads(TIMETABLES.read_text(encoding="utf-8"))["groups"]}
    except (OSError, ValueError, KeyError):
        return set()


def is_private(path):
    """True for files the site must never serve, such as the database. The
    path is normalised first so "/site/../server/campus.db" or "/SERVER/..."
    can't slip past (Windows paths ignore case)."""
    clean = "/" + posixpath.normpath(unquote(path).replace("\\", "/")).lstrip("/").lower()
    return any(clean == p or clean.startswith(p + "/") for p in PRIVATE)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ---------------------------------------------------------- routing
    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            return self.api("GET", path)
        if path in ("", "/"):
            return self.redirect("/site/")
        if is_private(path):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/") or is_private(path):
            return self.send_error(404)
        return super().do_HEAD()

    def do_POST(self):
        self.api("POST", urlsplit(self.path).path)

    def do_PUT(self):
        self.api("PUT", urlsplit(self.path).path)

    def do_DELETE(self):
        self.api("DELETE", urlsplit(self.path).path)

    def end_headers(self):
        # Always revalidate, so an edited file shows on the next reload
        if "Cache-Control" not in self._headers_text():
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _headers_text(self):
        return b"".join(getattr(self, "_headers_buffer", [])).decode("latin-1", "replace")

    def log_message(self, fmt, *args):
        # log API calls and errors only; error lines pass a number first
        if not args or not isinstance(args[0], str) or "/api/" in args[0]:
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    # ---------------------------------------------------------- helpers
    def redirect(self, to):
        self.send_response(302)
        self.send_header("Location", to)
        self.end_headers()

    def send_json(self, status, data, extra_headers=()):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if "application/json" not in self.headers.get("Content-Type", ""):
            return None
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 64_000:
            return None
        try:
            return json.loads(self.rfile.read(length))
        except ValueError:
            return None

    def session_token(self):
        jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        return jar[COOKIE].value if COOKIE in jar else None

    def current_user(self, conn):
        token = self.session_token()
        if not token:
            return None
        return conn.execute(
            "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id"
            " WHERE sessions.token = ? AND sessions.created_at > datetime('now', ?)",
            (token, "-%d days" % SESSION_DAYS),
        ).fetchone()

    # ---------------------------------------------------------- API
    def api(self, method, path):
        conn = db.connect()
        try:
            with conn:
                self.route(conn, method, path)
        except Exception as err:          # keep the server up; report briefly
            sys.stderr.write("API error: %r\n" % err)
            self.send_json(500, {"error": "Something went wrong on the demo server."})
        finally:
            conn.close()

    def route(self, conn, method, path):
        parts = [unquote(p) for p in path[len("/api/"):].split("/") if p]
        name = parts[0] if parts else ""

        if (method, name) == ("POST", "login"):
            body = self.read_json() or {}
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", ""))
            row = conn.execute("SELECT * FROM users WHERE bac_number = ?", (username,)).fetchone()
            if not row or not db.check_password(password, row["password_salt"], row["password_hash"]):
                return self.send_json(401, {"error": "That number and password don't match a demo account."})
            token = secrets.token_urlsafe(32)
            conn.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, row["id"]))
            cookie = "%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d" % (COOKIE, token, SESSION_DAYS * 86400)
            return self.send_json(200, {"user": db.user_json(row)}, [("Set-Cookie", cookie)])

        if (method, name) == ("POST", "logout"):
            token = self.session_token()
            if token:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return self.send_json(200, {"ok": True}, [("Set-Cookie", "%s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" % COOKIE)])

        user = self.current_user(conn)
        if not user:
            return self.send_json(401, {"error": "Not signed in."})

        if (method, name) == ("GET", "me") and len(parts) == 1:
            return self.send_json(200, {"user": db.user_json(user)})

        if (method, name) == ("PUT", "me") and parts[1:] == ["group"]:
            group = (self.read_json() or {}).get("group")
            if group is not None and group not in group_codes():
                return self.send_json(400, {"error": "That class group doesn't exist."})
            conn.execute("UPDATE users SET group_code = ? WHERE id = ?", (group, user["id"]))
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
            return self.send_json(200, {"user": db.user_json(row)})

        if name == "classes":
            if method == "GET" and len(parts) == 1:
                rows = conn.execute("SELECT * FROM classes WHERE user_id = ? ORDER BY start", (user["id"],)).fetchall()
                return self.send_json(200, {"classes": [db.class_json(r) for r in rows]})
            if method == "POST" and len(parts) == 1:
                return self.save_class(conn, user)
            if method == "DELETE" and len(parts) == 2:
                conn.execute("DELETE FROM classes WHERE id = ? AND user_id = ?", (parts[1], user["id"]))
                return self.send_json(200, {"ok": True})

        if name == "saved":
            if method == "GET" and len(parts) == 1:
                rows = conn.execute("SELECT place_id FROM saved_places WHERE user_id = ? ORDER BY created_at DESC",
                                    (user["id"],)).fetchall()
                return self.send_json(200, {"saved": [r["place_id"] for r in rows]})
            if method in ("PUT", "DELETE") and len(parts) == 2 and 0 < len(parts[1]) <= 120:
                if method == "PUT":
                    conn.execute("INSERT OR IGNORE INTO saved_places (user_id, place_id) VALUES (?, ?)", (user["id"], parts[1]))
                else:
                    conn.execute("DELETE FROM saved_places WHERE user_id = ? AND place_id = ?", (user["id"], parts[1]))
                return self.send_json(200, {"ok": True})

        return self.send_json(404, {"error": "No such API route."})

    def save_class(self, conn, user):
        b = self.read_json() or {}
        title = str(b.get("title", "")).strip()
        place = str(b.get("placeId", "")).strip()
        days = b.get("days")
        start, end = str(b.get("start", "")), str(b.get("end", ""))
        if not (0 < len(title) <= 60 and 0 < len(place) <= 120):
            return self.send_json(400, {"error": "A class needs a name and a place."})
        if not (isinstance(days, list) and days and all(isinstance(d, int) and 0 <= d <= 6 for d in days)):
            return self.send_json(400, {"error": "Choose at least one day."})
        if not (TIME.match(start) and TIME.match(end) and end > start):
            return self.send_json(400, {"error": "The class has to end after it starts."})
        values = (title, place, ",".join(str(d) for d in sorted(set(days))), start, end)
        class_id = b.get("id")
        if class_id:
            cur = conn.execute("UPDATE classes SET title = ?, place_id = ?, days = ?, start = ?, end = ?"
                               " WHERE id = ? AND user_id = ?", values + (class_id, user["id"]))
            if cur.rowcount == 0:
                return self.send_json(404, {"error": "That class doesn't exist."})
        else:
            class_id = conn.execute("INSERT INTO classes (title, place_id, days, start, end, user_id)"
                                    " VALUES (?, ?, ?, ?, ?, ?)", values + (user["id"],)).lastrowid
        row = conn.execute("SELECT * FROM classes WHERE id = ?", (class_id,)).fetchone()
        return self.send_json(200, {"class": db.class_json(row)})


class Server(ThreadingHTTPServer):
    # On Windows, address reuse lets two servers share a port and the old one
    # keeps answering. Refuse to start instead, so the problem is visible.
    allow_reuse_address = os.name != "nt"


def main():
    parser = argparse.ArgumentParser(description="BAC Maps demo server")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reset", action="store_true", help="rebuild campus.db from seed.py")
    args = parser.parse_args()
    # Claim the port first: if another server is running, stop before touching
    # the database it is using (a --reset would otherwise wipe it).
    try:
        server = Server(("127.0.0.1", args.port), Handler)
    except OSError:
        sys.exit("Port %d is already in use. Stop whatever is using it, or use --port." % args.port)
    db.init(reset=args.reset)
    print("BAC Maps demo server: http://127.0.0.1:%d/site/  (Ctrl+C to stop)" % args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
