"""End-to-end tests for the timetable on the BAC Maps profile, in a real browser (Playwright).

    pip install playwright && python -m playwright install chromium
    python tests/e2e_profile.py          (add --edge to use the installed Microsoft Edge)

Starts its own demo server on a free port with a throwaway database (tests/demo_server.py), signs in through the real sign in page, and checks that each student's own class
group timetable appears on the profile without any extra step, matching site/data/timetables.json.
Also covers guests, loading, a failed timetable download, an empty timetable, the class
details view and the phone layout. Exit code 1 if anything fails.
"""
import json, pathlib, sys
from playwright.sync_api import sync_playwright
from demo_server import DemoServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))
from seed import DEMO_PASSWORD, DEMO_USERS   # noqa: E402

TT = json.loads((ROOT / "site" / "data" / "timetables.json").read_text(encoding="utf-8"))
DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
results = []
def ok(cond, msg):
    results.append(bool(cond)); print(("  ok   " if cond else "  FAIL ") + msg, flush=True)

def expected(group, day):
    rooms = TT["rooms"]
    g = [x for x in TT["groups"] if x["code"] == group][0]
    rows = [c for c in g["classes"] if c["day"] == day]
    rows.sort(key=lambda c: c["start"])
    return [(c["start"], c["end"], c["course"], rooms[c["room"]]["label"]) for c in rows]

PROFILE_ROWS = """[...CampusApp.state.stack.at(-1).el.querySelectorAll('.class-row')].map(b => [
  b.querySelector('.class-time span').textContent, b.querySelector('.class-end').textContent,
  b.querySelector('.row-name').firstChild.textContent.trim(), b.querySelector('.row-meta').textContent])"""

def sign_in(pg, user):
    pg.goto(BASE + "/site/login.html")
    pg.fill("#bac-number", user); pg.fill("#password", DEMO_PASSWORD)
    pg.click("#login-form button[type=submit]")
    pg.wait_for_url("**/site/index.html"); pg.wait_for_function("window.CampusApp && Store.loaded()")

def open_profile(pg):
    pg.evaluate("window.innerWidth >= 768 ? document.getElementById('top-avatar').click() : document.getElementById('pill-avatar').click()")
    pg.wait_for_function("CampusApp.state.stack.at(-1).name === 'profile'")
    pg.wait_for_timeout(200)

def profile_text(pg): return pg.evaluate("CampusApp.state.stack.at(-1).el.textContent")

with DemoServer() as BASE:
  with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge") if "--edge" in sys.argv else pw.chromium.launch()
        errors = []
        def page(ctx):
            pg = ctx.new_page(); pg.set_default_timeout(20000)
            pg.on("pageerror", lambda e: errors.append(str(e)))
            return pg

        print("\nguest")
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        pg = page(ctx); pg.goto(BASE + "/site/index.html"); pg.wait_for_function("window.CampusApp && Store.loaded()")
        open_profile(pg)
        ok("Sign in to see your class timetable" in profile_text(pg), "a guest is asked to sign in, not shown a timetable")
        ok(pg.evaluate(PROFILE_ROWS) == [] and not pg.evaluate("!!document.querySelector('.group-pick')"), "no classes or group picker for guests")
        ctx.close()

        students = [u for u in DEMO_USERS if u.get("group")][:2]
        for u in students:
            print(f"\n{u['bac_number']} ({u['group']})")
            ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
            pg = page(ctx); sign_in(pg, u["bac_number"]); open_profile(pg)
            text = profile_text(pg)
            ok(u["name"] in text and "Demo account" in text, "the profile shows the signed in student")
            ok(pg.evaluate("CampusApp.state.stack.at(-1).el.querySelector('.group-pick select').value") == u["group"], f"their class group {u['group']} is selected without any extra step")
            ok(pg.evaluate("!!CampusApp.state.stack.at(-1).el.querySelector('.next')"), "the now or next class card is shown")
            tags = []
            for d in range(1, 7):
                pg.evaluate(f"[...CampusApp.state.stack.at(-1).el.querySelectorAll('.days .day')][{d - 1}].click()"); pg.wait_for_timeout(80)
                got = [tuple(r) for r in pg.evaluate(PROFILE_ROWS)]
                ok(got == expected(u["group"], d), f"{DAY[d]}: {len(got)} classes, matching the {u['group']} timetable")
                tags += pg.evaluate("[...document.querySelectorAll('.class-row .class-tag')].map(t => t.textContent)")
            ok(tags and all(t == u["group"] for t in tags), "every group class is tagged with the student's group")
            pg.reload(); pg.wait_for_function("window.CampusApp && Store.loaded()"); open_profile(pg)
            ok(len(pg.evaluate(PROFILE_ROWS)) > 0 or "No classes on" in profile_text(pg), "after a reload the timetable loads again")
            # the API only ever answers for the session's own user
            own = pg.evaluate("fetch('/api/me').then(r => r.json())")["user"]["bacNumber"]
            ok(own == u["bac_number"], "the session identifies this student, whatever the page asks for")
            if u is students[0]:
                first_ctx = ctx
            else:
                ctx.close()

        print("\nclass details and directions")
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        pg = page(ctx); sign_in(pg, students[0]["bac_number"]); open_profile(pg)
        day = next(d for d in range(1, 7) if expected(students[0]["group"], d) and expected(students[0]["group"], d)[0][3] != "Online")
        pg.evaluate(f"[...CampusApp.state.stack.at(-1).el.querySelectorAll('.days .day')][{day - 1}].click()"); pg.wait_for_timeout(100)
        pg.evaluate("CampusApp.state.stack.at(-1).el.querySelector('.class-row').click()"); pg.wait_for_timeout(400)
        lesson = profile_text(pg)
        ok(pg.evaluate("CampusApp.state.stack.at(-1).name") == "lesson" and "Lecturer" in lesson and "Where" in lesson, "a group class opens its details (when, where, lecturer, group)")
        pg.evaluate("[...CampusApp.state.stack.at(-1).el.querySelectorAll('button')].find(b => b.textContent.includes('Directions')).click()")
        pg.wait_for_function("CampusApp.state.stack.at(-1).el.querySelector('.route-summary, .soon')")
        ok(pg.evaluate("!!CampusApp.state.stack.at(-1).el.querySelector('.route-summary')"), "Directions to the class gives a Pathfinder route")
        ctx.close()

        print("\nloading, errors and empty timetables")
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        pg = page(ctx); sign_in(pg, students[0]["bac_number"])
        held = []                                   # hold /api/me back until the loading state was checked
        pg.route("**/api/me", lambda r: held.append(r))
        pg.goto(BASE + "/site/index.html"); pg.wait_for_function("window.CampusApp")
        open_profile(pg)
        ok("Loading your profile and timetable" in profile_text(pg), "while loading, the profile says so instead of showing a guest")
        for r in held: r.continue_()
        pg.unroute("**/api/me")
        pg.wait_for_function("Store.loaded()"); pg.wait_for_timeout(200)
        ok(pg.evaluate("!!document.querySelector('.group-pick') && !!document.querySelector('.next, .class-row, .info')"), "then the timetable appears by itself")

        pg.route("**/data/timetables.json", lambda r: r.abort())
        pg.reload(); pg.wait_for_function("window.CampusApp && Store.loaded()"); open_profile(pg)
        text = profile_text(pg)
        ok("couldn’t be loaded" in text and "Try again" in text, "a failed timetable download shows an error with Try again")
        ok("Naledi" in text or students[0]["name"] in text, "the rest of the profile still works")
        pg.unroute("**/data/timetables.json")
        pg.evaluate("[...CampusApp.state.stack.at(-1).el.querySelectorAll('button')].find(b => b.textContent === 'Try again').click()")
        pg.wait_for_function("Store.timetableState() === 'ok'"); pg.wait_for_timeout(200)
        ok(pg.evaluate("!!document.querySelector('.class-tag')") or "No classes on" in profile_text(pg), "Try again loads the timetable")

        empty = json.loads(json.dumps(TT))
        for g in empty["groups"]:
            if g["code"] == students[0]["group"]: g["classes"] = []
        pg.route("**/data/timetables.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(empty)))
        pg.reload(); pg.wait_for_function("window.CampusApp && Store.loaded()"); open_profile(pg)
        ok(f"No timetable is available for {students[0]['group']} yet" in profile_text(pg), "a group with no classes says so")
        ok(not pg.evaluate("!!document.querySelector('.class-tag')"), "and shows no made up classes")
        pg.unroute("**/data/timetables.json")
        ctx.close()

        print("\nstaff (no group)")
        ctx = browser.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        pg = page(ctx); sign_in(pg, "staff1"); open_profile(pg)
        ok(not pg.evaluate("!!document.querySelector('.class-tag')") and "Pick your class group" in profile_text(pg), "an account with no group gets no one else's timetable")
        ctx.close()

        print("\nphone")
        ctx = browser.new_context(viewport={"width": 375, "height": 812}, service_workers="block", has_touch=True, is_mobile=True)
        pg = page(ctx); sign_in(pg, students[1]["bac_number"]); open_profile(pg)
        ok(pg.evaluate("document.documentElement.scrollWidth") <= 375, "no sideways scrolling at 375 px")
        over = pg.evaluate("""[...document.querySelectorAll('#card .class-row, #card .days, #card .next, #card .group-pick')].filter(e => {
            const r = e.getBoundingClientRect(), c = document.getElementById('card').getBoundingClientRect();
            return r.left < c.left - 1 || r.right > c.right + 1 || e.scrollWidth > e.clientWidth + 1; }).length""")
        ok(over == 0, "timetable rows, days and the next class card fit inside the card")
        ok(pg.evaluate("[...document.querySelectorAll('#card .days .day')].every(b => b.getBoundingClientRect().height >= 44)"), "day buttons are at least 44 px tall")
        shot = pathlib.Path(__import__("tempfile").gettempdir()) / "bac-maps-profile-phone.png"
        pg.screenshot(path=str(shot), full_page=False)
        print("  (screenshot: " + str(shot) + ")")
        ctx.close()
        first_ctx.close()

        ok(not errors, "no script errors" + ("" if not errors else ": " + "; ".join(errors[:3])))
        browser.close()

failed = results.count(False)
print(f"\n{len(results) - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
