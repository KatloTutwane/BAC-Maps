"""
BAC Maps demo database: SQLite, Python standard library only.

Holds dummy accounts, their sessions, their class timetables and their saved
places. Everything in it is demo data from seed.py; it is not connected to
any BAC system. Delete campus.db (or run `python server/server.py --reset`)
to start again from the seed.
"""
import hashlib
import secrets
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).with_name("campus.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    bac_number    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('student', 'staff')),
    programme     TEXT,
    year          INTEGER,
    group_code    TEXT,              -- class group from site/data/timetables.json, e.g. "CSE3-2"
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    is_demo       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS classes (
    id       INTEGER PRIMARY KEY,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    place_id TEXT NOT NULL,          -- a place id from site/places.js, e.g. "Block D"
    days     TEXT NOT NULL,          -- comma separated, 0 Sunday ... 6 Saturday
    start    TEXT NOT NULL,          -- "HH:MM"
    end      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_places (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place_id   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, place_id)
);
"""

PBKDF2_ROUNDS = 200_000


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def hash_password(password, salt=None):
    """Return (salt_hex, hash_hex). Passwords are never stored in plain text."""
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return salt.hex(), digest.hex()


def check_password(password, salt_hex, hash_hex):
    _, digest = hash_password(password, bytes.fromhex(salt_hex))
    return secrets.compare_digest(digest, hash_hex)


def init(reset=False):
    """Create the database on first run and fill it from seed.py."""
    if reset and DB_PATH.exists():
        DB_PATH.unlink()
    conn = connect()
    with conn:
        conn.executescript(SCHEMA)
        # databases made before class groups existed
        import seed
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(users)")]
        if "group_code" not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN group_code TEXT")
            # their demo students would otherwise have no group, so no timetable
            seed.assign_groups(conn)
        # first run fills everything; later runs add demo accounts that were
        # added to seed.py since, without touching existing data
        seed.seed(conn, only_missing=True)
    conn.close()


def user_json(row):
    return {
        "bacNumber": row["bac_number"],
        "name": row["name"],
        "role": row["role"],
        "programme": row["programme"],
        "year": row["year"],
        "group": row["group_code"],
        "demo": bool(row["is_demo"]),
    }


def class_json(row):
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "placeId": row["place_id"],
        "days": [int(d) for d in row["days"].split(",") if d != ""],
        "start": row["start"],
        "end": row["end"],
    }
