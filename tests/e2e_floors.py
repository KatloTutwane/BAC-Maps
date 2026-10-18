"""Browser tests for the multi-floor building: floor controls, rooms, cross-floor routes.

    python tests/e2e_floors.py
"""
import pathlib, sys
from playwright.sync_api import sync_playwright

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"
results = []
def ok(c, m): results.append(bool(c)); print(("  ok   " if c else "  FAIL ") + m, flush=True)

with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 800}); pg.set_default_timeout(30000)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto((WEB / "pathfinder.html").as_uri() + "?admin=1"); pg.wait_for_timeout(900)          # the editor and diagnostics are admin-only
    J = pg.evaluate; settle = lambda ms=600: pg.wait_for_timeout(ms)
    rooms_drawn = lambda: J("pathfinder.map.features().filter(f=>f.kind==='room').map(f=>f.level)")

    print("\nfloor controls")
    ok(pg.locator(".fl-row").count() == 2, "the floor list comes from the building data: " + " / ".join(pg.locator(".fl-name").all_inner_texts()))
    shown = lambda: J("[...document.querySelectorAll('.cm-img')].map(g=>g.style.opacity !== '0')")   # [campus drawing, ground cutaway]
    ok(set(rooms_drawn()) == {1} and len(rooms_drawn()) == 23 and shown() == [True, False], "all floors: the campus drawing, its 23 first-floor rooms tappable")
    pg.locator(".fl-row", has_text="First floor").locator("button[data-act=only]").click(); settle()
    ok(set(rooms_drawn()) == {1} and shown() == [True, False], "isolating the first floor keeps the campus drawing")
    pg.locator(".fl-row", has_text="Ground floor").locator("button[data-act=only]").click(); settle()
    lv = rooms_drawn(); ok(set(lv) == {0} and len(lv) == 17 and shown() == [True, True], "isolating the ground floor shows the cutaway drawing and its 17 rooms")
    pg.click("#flAll"); settle()
    pg.locator(".fl-row", has_text="Ground floor").locator("button[data-act=eye]").click(); settle()
    ok(set(rooms_drawn()) == {1} and shown() == [True, False], "hiding the ground floor leaves the first floor")
    pg.locator(".fl-row", has_text="First floor").locator("button[data-act=eye]").click(); settle()
    ok(set(rooms_drawn()) == {1} and pg.locator(".toast").count() > 0, "the last visible floor cannot be hidden")
    pg.click("#flAll"); settle()
    pg.locator(".fl-row", has_text="Ground floor").locator("button[data-act=focus]").click(); settle()
    ok(set(rooms_drawn()) == {0} and shown() == [True, True], "highlighting the ground floor shows its cutaway drawing")
    nav_before = J("window.__nav = pathfinder.nav(); 1")
    for _ in range(5):                                   # switching back and forth never brings back the vector map
        pg.click("#flAll"); settle(150); J("pathfinder.setFloorView({floor:0, hidden:[], focus:null})"); settle(150)
    pg.click("#flAll"); settle()
    ok(J("pathfinder.map.get().detailed") and pg.locator(".cm-root").count() == 1 and J("window.__nav === pathfinder.nav()"), "repeated floor switching keeps one map, the drawings and the same navigation data")

    print("\nsearch and selection")
    pg.fill("#q", "first floor lab"); settle(250)
    names = pg.locator("#dlist button").all_inner_texts()
    ok(len(names) == 6 and all("First floor" in n for n in names), f"searching 'first floor lab' finds the 6 first-floor labs")
    pg.fill("#q", "WC F"); settle(200); pg.press("#q", "Enter"); settle(1200)
    ok(J("pathfinder.state.route && pathfinder.state.route.to") == "WC F", "choosing a first-floor room plans the route")
    J("pathfinder.setFloorView({floor:1})"); settle()
    pos = J("""(()=>{const f=pathfinder.map.features().find(x=>x.kind==='room'&&x.name==='Lab 13'); const s=pathfinder.map.groundToScreen(f.centre[0],f.centre[1],1), r=document.getElementById('map').getBoundingClientRect(); return {x:r.left+s.x, y:r.top+s.y}})()""")
    J("pathfinder.map.animateTo({ground:[%s], z:7.2, scale:12}, 0)" % ",".join(map(str, J("pathfinder.map.features().find(x=>x.kind==='room'&&x.name==='Lab 13').centre"))))
    settle(400)
    pos = J("""(()=>{const f=pathfinder.map.features().find(x=>x.kind==='room'&&x.name==='Lab 13'); const s=pathfinder.map.groundToScreen(f.centre[0],f.centre[1],1), r=document.getElementById('map').getBoundingClientRect(); return {x:r.left+s.x, y:r.top+s.y}})()""")
    pg.mouse.click(pos["x"], pos["y"]); settle(300)
    ok(pg.is_visible("#card") and pg.inner_text("#cardName") == "Lab 13" and "First floor" in pg.inner_text("#cardInfo"), "tapping a room on the map opens its card: " + pg.inner_text("#cardInfo")[:60])
    ok(J("pathfinder.state.sel.place.id") == "room:F1-lab-13", "the tapped room is the same record as in search and the navigation graph")
    pg.click("#cardGo"); settle(1000)
    ok(J("pathfinder.state.route.to") == "Lab 13", "Navigate here routes to the room")

    print("\ncross-floor routes")
    J("pathfinder.setFloorView({floor:'all', hidden:[], focus:null})")
    pg.fill("#q", "Lab 8"); settle(200); pg.press("#q", "Enter"); settle(1000)
    J("pathfinder.state.start='room:F1-office-10'; document.getElementById('from').value='room:F1-office-10'"); pg.click("#find"); settle(1200)
    r = J("({f:pathfinder.state.route.floors, t:pathfinder.state.route.transitions.map(x=>x.name), v:pathfinder.state.route.validated})")
    ok(r["f"] == [1, 0] and len(r["t"]) == 1 and r["v"], f"Office 10 (first) to Lab 8 (ground): one staircase ({r['t'][0] if r['t'] else '-'}), wall-checked")
    hdr = pg.locator("#steps li.fl").all_inner_texts()
    ok([h.lower() for h in hdr] == ["first floor", "ground floor"], "directions are grouped by floor: " + " → ".join(hdr))
    J("pathfinder.setFloorView({floor:1})"); settle(400)
    ok(pg.is_visible("#floorHint") and "Ground floor" in pg.inner_text("#floorHint"), "with only the first floor shown, the page says the route continues downstairs")
    pg.click("#floorHintBtn"); settle(500)
    ok(J("pathfinder.state.fv.floor") == 0, "Show switches to the floor where the route continues")
    pg.click("#startNav"); settle(300); J("pathfinder.state.fv.floor=1; pathfinder.setFloorView({floor:1})"); settle(200)
    pg.click("#demo"); settle(200)
    seen = set()
    for _ in range(40):
        seen.add((J("pathfinder.state.player.level"), J("pathfinder.state.fv.floor")))
        if "Arrived" in pg.inner_text("#status"): break
        pg.wait_for_timeout(500)
    ok("Arrived" in pg.inner_text("#status") and all(pl == fl for pl, fl in seen), f"walking the route, the isolated floor follows the marker down the stairs ({sorted(seen)})")
    J("pathfinder.setFloorView({floor:'all'})")
    pg.fill("#q", "Office 3"); settle(200); pg.press("#q", "Enter"); settle(800)
    ok("no door" in pg.inner_text("#msg"), "a room with no door explains why there is no route: " + pg.inner_text("#msg")[:80])

    print("\ndiagnostics")
    pg.click("summary:has-text('Edit navigation data')"); pg.check("#showGraph"); settle(500)
    n = J("document.querySelectorAll('.cm-over polygon').length")
    ok(n > 40, f"diagnostics draw rooms, blocked space, ways and doors ({n} shapes)")
    pg.click("#checkAll")
    for _ in range(120):
        t = pg.inner_text("#checkOut")
        if t.startswith("Checked") and "routes in" in t: break
        pg.wait_for_timeout(500)
    ok("none cross a wall" in pg.inner_text("#checkOut"), pg.inner_text("#checkOut"))
    ok(not errors, "no script errors" + (": " + "; ".join(errors[:3]) if errors else ""))
    b.close()

print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)
