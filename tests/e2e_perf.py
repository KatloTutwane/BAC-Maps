"""Performance, memory and regression part of the end-to-end tests for the pathfinder in a real browser (Chromium via Playwright).

    pip install playwright && python -m playwright install chromium
    python tests/e2e.py

Covers interaction, selection, navigation, performance/memory and regressions.
Exit code 1 if anything fails.
"""
import math, pathlib, sys, json
from playwright.sync_api import sync_playwright

WEB = pathlib.Path(__file__).resolve().parent.parent / "web"
URL = (WEB / "pathfinder.html").as_uri()
results = []
def ok(cond, msg):
    results.append(bool(cond)); print(("  ok   " if cond else "  FAIL ") + msg, flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=["--enable-precise-memory-info"])
    pg = browser.new_page(viewport={"width": 1280, "height": 800}); pg.set_default_timeout(30000)
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(URL); pg.wait_for_timeout(900)
    J = pg.evaluate
    stats = lambda: J("pathfinder.map.stats()")
    view = lambda: J("pathfinder.map.get()")
    def settle(ms=700): pg.wait_for_timeout(ms)

    cx, cy = 900, 400
    print("\nperformance and memory")
    cdp = pg.context.new_cdp_session(pg)
    def heap():
        cdp.send("HeapProfiler.collectGarbage"); return J("performance.memory.usedJSHeapSize") / 1048576
    nav_id = J("window.__navRef = pathfinder.nav(); 1")
    ids = J("pathfinder.nav().places.filter(p=>p.reachable).map(p=>p.id)")
    def churn(n):
        J("""async(ids)=>{for(let i=0;i<ids.length;i++){ pathfinder.chooseDest({place:ids[i]}); await new Promise(r=>setTimeout(r,25)); pathfinder.openCard({kind:'place',place:pathfinder.nav().place(ids[i])}); document.getElementById('cardClose').click(); }}""", ids[:n])
        settle(600)
    ids = ids[:20]
    churn(len(ids)); h1 = heap(); d1 = J("document.getElementsByTagName('*').length"); ov1 = J("document.querySelectorAll('.cm-over *').length")
    churn(len(ids)); churn(len(ids)); h2 = heap(); d2 = J("document.getElementsByTagName('*').length"); ov2 = J("document.querySelectorAll('.cm-over *').length")
    ok(abs(d2 - d1) <= 30, f"DOM size stable over {2*len(ids)} more route changes ({d1} -> {d2} nodes)")
    ok(abs(ov2 - ov1) <= 30, f"route graphics replaced, not accumulated ({ov1} -> {ov2})")
    ok(h2 - h1 < 3, f"JS heap stable after GC ({h1:.1f} -> {h2:.1f} MB)")
    ok(J("window.__navRef === pathfinder.nav()"), "changing destinations never rebuilt the navigation model")
    t = J("""(()=>{const n=pathfinder.nav(), ids=n.places.map(p=>p.id); const a=performance.now(); for(let i=0;i<20;i++) n.findRoute({place:ids[i%ids.length]},{place:ids[(i*7+3)%ids.length]}); const first=performance.now()-a; const b=performance.now(); for(let i=0;i<20;i++) n.findRoute({place:ids[i%ids.length]},{place:ids[(i*7+3)%ids.length]}); return [first, performance.now()-b]})()""")
    ok(t[1] < t[0] / 5, f"repeat routes come from the cache ({t[0]:.0f} ms -> {t[1]:.1f} ms for 20)")
    times = []
    for i in range(3):
        times.append(J("""async()=>{const n=pathfinder.nav(); const t=performance.now(); for(let i=0;i<10;i++) await n.findRoutesAsync({x:60+i,y:80,level:0},{x:40,y:150-i,level:0},{alternatives:1}); return performance.now()-t}"""))
    ok(times[2] < times[0] * 1.5, f"repeated calculations do not slow down ({', '.join(f'{x:.0f}' for x in times)} ms per 10)")
    lag = J("""async()=>{const n=pathfinder.nav(); let worst=0, last=performance.now(), run=true; (function tick(){ const t=performance.now(); worst=Math.max(worst,t-last); last=t; if(run) requestAnimationFrame(tick)})();
      await n.findRoutesAsync({place:'building:Block A'},{place:'building:Pc 1'},{alternatives:1}); await n.findRoutesAsync({x:150,y:-15,level:0},{x:30,y:170,level:0},{alternatives:1}); run=false; return worst}""")
    ok(lag < 120, f"the page keeps drawing while routes are calculated (longest frame {lag:.0f} ms, headless)")
    J("pathfinder.setCam('follow', true)"); pg.click("#demo") if not pg.is_disabled("#demo") else None
    fr = J("""async()=>{const ts=[]; let last=performance.now(); await new Promise(res=>{let n=0;(function f(t){ts.push(t-last); last=t; if(++n<120) requestAnimationFrame(f); else res()})(performance.now())}); ts.sort((a,b)=>a-b); return {median:ts[60], p95:ts[114]}}""")
    ok(fr["median"] < 20, f"frame time while the marker walks with a following camera: median {fr['median']:.1f} ms, p95 {fr['p95']:.1f} ms (headless, software rendering)")
    r1 = stats()["renders"]; settle(1500); r2 = stats()["renders"]
    ok(r2 == r1, f"following the marker never redraws the map ({r1} -> {r2})")

    print("\nregressions")
    ok(not errors, "no script errors on the pathfinder page" + (": " + "; ".join(errors[:3]) if errors else ""))
    p2 = browser.new_page(); e2 = []
    p2.on("pageerror", lambda e: e2.append(str(e)))
    p2.on("console", lambda m: e2.append(m.text) if m.type == "error" else None)
    p2.add_init_script("window.__ev=[]; window.AndroidBridge={onMapEvent:function(m){window.__ev.push(JSON.parse(m))}}")
    drawn = lambda: p2.evaluate("[...document.querySelectorAll('.cm-img')].map(g=>g.style.opacity !== '0')")   # [campus drawing, ground cutaway]
    p2.goto((WEB / "index.html").as_uri()); p2.wait_for_timeout(500)
    ok(p2.locator(".cm-imgs img").count() == 2 and p2.locator("#rot, #cutaway, #labels").count() == 0, "index.html: shows the two drawings, with no rotate, cutaway or labels controls")
    p2.select_option("#floor", "0"); p2.wait_for_timeout(300)
    ok(drawn() == [True, True] and p2.evaluate("document.querySelectorAll('.cm-pick').length") > 0, "index.html: ground floor brings up the cutaway drawing")
    p2.select_option("#floor", "all"); p2.wait_for_timeout(300)
    p2.click("#demoRoute"); p2.wait_for_timeout(300)
    ok("Example route" in p2.inner_text("#routeInfo"), "index.html: example route still works")
    p2.select_option("#find", "Block D"); p2.wait_for_timeout(800)
    ok("Block D" in p2.inner_text("#selection") or p2.locator(".cm-selected").count() == 1, "index.html: Find still focuses a building")
    for q, want in (("", [True, False]), ("?floor=0", [True, True]), ("?floor=1", [True, False])):
        p2.goto((WEB / "embed.html").as_uri() + q); p2.wait_for_timeout(500)
        ok(p2.locator(".cm-imgs img").count() == 2 and drawn() == want, f"embed.html{q}: shows the drawings ({'ground-floor cutaway' if want[1] else 'campus drawing'})")
    ok(p2.evaluate("typeof campusMap.focus==='function' && typeof campusMap.drawRoute==='function' && typeof campusMap.rotateTo==='function'"), "embed.html: app bridge API intact, including rotateTo")
    p2.evaluate("window.postMessage(JSON.stringify({target:'campus-map', cmd:'select', args:['Block D']}), '*')"); p2.wait_for_timeout(300)
    ev = p2.evaluate("window.__ev")
    ok(any(e["type"] == "ready" and e["payload"]["features"] for e in ev) and any(e["type"] == "select" and (e["payload"] or {}).get("name") == "Block D" for e in ev), "embed.html: ready and select events reach the app bridge")
    ok(not e2, "no script errors on index.html or embed.html" + (": " + "; ".join(e2[:3]) if e2 else ""))
    tab = browser.new_context(viewport={"width": 820, "height": 1180}, has_touch=True, is_mobile=True).new_page(); e3 = []
    tab.on("pageerror", lambda e: e3.append(str(e)))
    tab.goto(URL); tab.wait_for_timeout(800)
    tab.fill("#q", "Hostel 1"); tab.wait_for_timeout(200); tab.locator("#dlist button").first.tap(); tab.wait_for_timeout(900)
    ok("Route found" in tab.inner_text("#msg") and tab.evaluate("document.documentElement.scrollWidth") <= 820 and not e3, "iPad portrait: route found by touch, no sideways scrolling, no errors")
    tab.screenshot(path=str(pathlib.Path("/tmp") / "ipad.png"))
    browser.close()

print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)
