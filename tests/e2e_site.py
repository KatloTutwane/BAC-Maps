"""End-to-end tests for BAC Maps (site/) on the finished map and Pathfinder, in a real browser
(Chromium or Edge via Playwright).

    pip install playwright && python -m playwright install chromium
    python tests/e2e_site.py            (add --edge to use the installed Microsoft Edge instead)

Builds nothing: run `npm run build` in frontend/ first. Starts its own demo server on a free
port with a throwaway database (tests/demo_server.py). The browser is not given location, so
directions start at the Main Gate. Exit code 1 if anything fails.
"""
import sys
from playwright.sync_api import sync_playwright
from demo_server import DemoServer
results = []
def ok(cond, msg):
    results.append(bool(cond)); print(("  ok   " if cond else "  FAIL ") + msg, flush=True)

TOP = "CampusApp.state.stack[CampusApp.state.stack.length-1]"
def view(pg): return pg.evaluate(TOP + ".name")
def click_in_view(pg, selector): pg.evaluate("s => " + TOP + ".el.querySelector(s).click()", selector)
def click_button(pg, text):
    pg.evaluate("t => [..." + TOP + ".el.querySelectorAll('button')].find(b => b.textContent.includes(t)).click()", text)
def wait_route(pg):
    pg.wait_for_function(TOP + ".el.querySelector('.route-summary, .soon')", timeout=20000)
def top_search(pg, q):
    pg.fill("#top-search-input", q); pg.wait_for_timeout(150)
def lines(pg): return pg.evaluate("document.querySelectorAll('#campus-map polyline').length")
VISIBLE = """() => {   // share of the drawn route on screen and not under the card, top bar or pill
  const m = document.getElementById('campus-map').getBoundingClientRect();
  const block = ['card', 'topbar'].concat(CampusApp.state.expanded ? [] : ['pill']).map(id => document.getElementById(id))
    .filter(e => getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().height > 0).map(e => e.getBoundingClientRect());
  let n = 0, seen = 0;
  for (const pl of document.querySelectorAll('#campus-map .cm-root > svg polyline')) {
    const len = pl.getTotalLength(), ctm = pl.getScreenCTM();
    for (let d = 0; d <= len; d += len / 60) {
      const p = pl.getPointAtLength(d).matrixTransform(ctm); n++;
      if (p.x >= m.left && p.x <= m.right && p.y >= m.top && p.y <= m.bottom && !block.some(r => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom)) seen++;
    }
  }
  return n ? seen / n : 0;
}"""

with DemoServer() as BASE, sync_playwright() as pw:
    URL = BASE + "/site/index.html"
    browser = pw.chromium.launch(channel="msedge") if "--edge" in sys.argv else pw.chromium.launch()
    pg = browser.new_context(viewport={"width": 1280, "height": 800}, service_workers="block").new_page(); pg.set_default_timeout(20000)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_function("() => !!window.CampusApp && [...document.querySelectorAll('#campus-map img')].some(i => i.naturalWidth > 0)"); pg.wait_for_timeout(800)
    J = pg.evaluate

    print("\nmap")
    ok(J("MapAdapter.isLive()"), "the campus map mounts in the BAC Maps page")
    pg.wait_for_function("[...document.querySelectorAll('#campus-map img')].some(i => i.naturalWidth > 0)")
    ok(J("document.querySelector('#campus-map img').src.endsWith('/web/renders/upper_floor.webp')"), "the campus drawing loads from web/renders/")
    ok(J("!document.querySelector('.map-placeholder')"), "no placeholder over the real map")
    ok(J("CampusApp.state.places.filter(p => p.id.startsWith('room:')).length") == 40, "all 40 Main Building rooms are places")
    ok(J("!!NavAdapter.landmark('Main Gate')"), "Main Gate has a position from the verified walks")

    print("\nsearch")
    top_search(pg, "first floor lab")
    n = J("document.querySelectorAll('.view[data-view=\"search\"] [data-place^=\"room:F1-lab\"]').length")
    ok(n == 6, f"'first floor lab' finds the six first-floor labs ({n})")
    top_search(pg, "lecture theatre")
    ok(J("!!document.querySelector('.view[data-view=\"search\"] [data-place=\"room:F1-lt\"]')"), "'lecture theatre' finds LT")

    print("\ndirections")
    top_search(pg, "lab 14")
    pg.click('.view[data-view="search"] [data-place="room:F1-lab-14"]'); pg.wait_for_timeout(400)
    ok(view(pg) == "place", "a result opens its details")
    click_button(pg, "Directions"); wait_route(pg)
    summary = J(TOP + ".el.querySelector('.route-summary')?.textContent || ''")
    steps = J("[..." + TOP + ".el.querySelectorAll('.step-text')].map(s => s.textContent)")
    ok("m" in summary and "min" in summary, f"Pathfinder's route has a distance and time ({summary})")
    ok(any("stairs" in s for s in steps) and steps[-1].startswith("Arrive at Lab 14"), "steps climb the stairs and arrive at Lab 14")
    ok(lines(pg) > 0, "the route is drawn on the map")
    pg.wait_for_timeout(700)
    v = J(VISIBLE)
    ok(v >= 0.9, f"the route is placed beside or below the open panel, not behind it ({v:.0%} visible)")
    ok(J(TOP + ".el.querySelector('.trip-from .trip-value').textContent") == "Main Gate", "without location the start is the Main Gate")
    if J(TOP + ".el.querySelectorAll('.route-options .chip').length") == 2:
        first = J(TOP + ".el.querySelector('.route-dist').textContent")
        click_in_view(pg, ".route-options .chip:nth-child(2)"); pg.wait_for_timeout(200)
        ok(J(TOP + ".el.querySelector('.route-dist').textContent") != first, "the alternative route shows its own length")
        click_in_view(pg, ".route-options .chip:nth-child(1)"); pg.wait_for_timeout(200)

    print("\nmap controls")
    w0 = J("document.querySelector('#campus-map svg').viewBox.baseVal.width")
    pg.click("#zoom-in"); pg.wait_for_timeout(900)
    w1 = J("document.querySelector('#campus-map svg').viewBox.baseVal.width")
    ok(w1 < w0 * 0.9, f"zoom in zooms the map ({w0:.0f} -> {w1:.0f} m across)")
    pg.click("#zoom-out"); pg.wait_for_timeout(900)
    ok(J("document.querySelector('#campus-map svg').viewBox.baseVal.width") > w1 * 1.2, "zoom out zooms back out")
    click_in_view(pg, ".step:nth-child(1), .steps li:nth-child(2) .step"); pg.wait_for_timeout(700)
    ok(J("!!document.querySelector('#campus-map .cm-over circle')"), "tapping a step pins it on the map")

    print("\nwalk and clear")
    click_button(pg, "Walk it"); pg.wait_for_timeout(600)
    pos = lambda: J("document.querySelector('[data-sprite=\"walk\"]')?.style.transform || ''")
    a = pos(); pg.wait_for_timeout(800); b = pos()
    ok(a and b and a != b, "Walk it moves a marker along the route")
    click_button(pg, "Stop walk"); pg.wait_for_timeout(100)
    ok(not J("!!document.querySelector('[data-sprite=\"walk\"]')"), "Stop walk removes the marker")
    click_button(pg, "Clear route"); pg.wait_for_timeout(200)
    ok(lines(pg) == 0, "Clear route removes the route from the map")
    click_in_view(pg, ".soon .link-btn"); wait_route(pg)
    ok(lines(pg) > 0, "Show the route again brings it back")

    print("\nchanging start and destination")
    click_in_view(pg, ".trip-from"); pg.wait_for_timeout(400)
    ok(view(pg) == "pick" and J(TOP + ".el.querySelector('.row-name').textContent") == "Your location", "From opens a picker led by Your location")
    pg.fill("#pick-input", "hostel 1"); pg.wait_for_timeout(150)
    click_in_view(pg, '[data-place="Hostel 1"]'); wait_route(pg)
    ok(J(TOP + ".el.querySelector('.trip-from .trip-value').textContent") == "Hostel 1", "the start changes to Hostel 1")
    click_in_view(pg, ".trip-to"); pg.wait_for_timeout(400)
    pg.fill("#pick-input", "chilling area"); pg.wait_for_timeout(150)
    click_in_view(pg, '[data-place="Chilling area"]'); wait_route(pg)
    steps = J("[..." + TOP + ".el.querySelectorAll('.step-text')].map(s => s.textContent)")
    ok(any("Bridge to chilling area" in s for s in steps), "the Chilling Area is reached over the bridge from the first floor")
    click_in_view(pg, ".back"); pg.wait_for_timeout(500)
    ok(lines(pg) == 0, "leaving Directions clears the route")

    print("\nplaces Pathfinder cannot reach")
    top_search(pg, "office 3")
    pg.click('.view[data-view="search"] [data-place="room:F1-office-3"]'); pg.wait_for_timeout(1500)
    ok("no door" in J(TOP + ".el.textContent"), "Office 3 says it has no door on the map yet")
    click_button(pg, "Directions"); wait_route(pg)
    ok("No route found" in J(TOP + ".el.textContent") and lines(pg) == 0, "and Directions says so instead of drawing a line")

    print("\nfloors and taps")
    pg.click('[data-floor="0"]'); pg.wait_for_timeout(1500)
    ok(J("getComputedStyle(document.querySelectorAll('#campus-map .cm-img')[1]).opacity") == "1", "Ground shows the ground-floor cutaway drawing")
    pg.click('[data-floor="all"]'); pg.wait_for_timeout(400)
    J("CampusApp.collapse()"); pg.wait_for_timeout(300)
    box = J("""(() => { for (const g of document.querySelectorAll('#campus-map g.cm-solid[data-cm-id]')) {
        const r = g.getBoundingClientRect(); if (r.width < 20 || r.width > 200) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2, h = document.elementFromPoint(x, y);
        if (h && g.contains(h)) return [x, y]; } return null; })()""")
    if box:
        pg.mouse.click(box[0], box[1]); pg.wait_for_timeout(700)
    ok(box and view(pg) == "place" and J("CampusApp.state.expanded"), "tapping a building on the map opens its details")

    print("\nphone")
    pg.set_viewport_size({"width": 375, "height": 812}); pg.reload(); pg.wait_for_timeout(1500)
    ok(J("document.documentElement.scrollWidth") <= 375, "no sideways scrolling at 375 px")
    pg.click("#pill-search"); pg.wait_for_timeout(400)
    pg.fill("#search-input", "clinic"); pg.wait_for_timeout(150)
    pg.click('[data-place="School Clinic"]'); pg.wait_for_timeout(400)
    click_button(pg, "Directions"); wait_route(pg)
    ok(lines(pg) > 0, "directions work on a phone")
    pg.wait_for_timeout(700)
    v = J(VISIBLE)
    ok(v >= 0.9, f"on a phone the route sits above the card ({v:.0%} visible)")
    J("CampusApp.collapse()"); pg.wait_for_timeout(300); pg.click("#pill-search"); pg.wait_for_timeout(400)
    ok(view(pg) == "directions" and lines(pg) > 0, "reopening from the pill brings the route back")
    small = J("[...document.querySelectorAll('#card button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).length")
    ok(small == 0, f"every visible button in the card is at least 44 px tall ({small} smaller)")

    ok(not errors, "no script errors" + ("" if not errors else ": " + "; ".join(errors[:3])))
    browser.close()

failed = results.count(False)
print(f"\n{len(results) - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
