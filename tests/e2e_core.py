"""Interaction, selection, route and navigation part of the end-to-end tests for the pathfinder in a real browser (Chromium via Playwright).

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

    print("\ncamera")
    r0 = stats()["renders"]
    box = pg.locator("#map").bounding_box(); cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 120, cy + 60, steps=12); pg.mouse.up(); settle(300)
    s = stats(); ok(s["renders"] == r0, f"panning moves the drawn map without redrawing it (redraws {r0} -> {s['renders']})")
    z0 = view()["zoom"]; pg.mouse.move(cx, cy)
    zs = []
    for _ in range(3): pg.mouse.wheel(0, -240); pg.wait_for_timeout(40); zs.append(view()["zoom"])
    settle(600); z1 = view()["zoom"]
    ok(z1 > z0 * 1.5 and all(b >= a for a, b in zip([z0] + zs, zs + [z1])), f"wheel zoom eases in steadily ({z0:.2f} -> {z1:.2f}, no reversals)")
    for _ in range(40): pg.mouse.wheel(0, -800)
    settle(900); ok(view()["zoom"] <= 40.0001, f"zoom is limited (max 40 px/m, got {view()['zoom']:.1f})")
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx - 5000, cy - 5000, steps=10); pg.mouse.up(); settle(300)
    g = J("""(()=>{const r=document.querySelector('.cm-root').getBoundingClientRect(); return pathfinder.map.screenToGround(r.left+r.width/2, r.top+r.height/2, 0)})()""")
    ok(-40 < g["x"] < 200 and -60 < g["y"] < 225, f"dragging 7 km away stops at the campus edge (view centre at {g['x']:.0f}, {g['y']:.0f} m; campus spans 0..158 x -21..185)")
    pg.click("#bReset"); settle(1200)
    ok(view()["detailed"] and "tilt" not in stats(), "Reset shows the whole campus on the detailed drawings")
    for mode in ("follow", "third", "iso"):
        pg.select_option("#camView", mode); settle(800)
        ok(view()["detailed"] and pg.locator(".cm-imgs img").count() == 2 and pg.locator(".cm-root").count() == 1, f"{mode} camera keeps the drawings as the only map")
    ok(pg.locator("#explode, #cutaway, #camView option[value=top]").count() == 0 and pg.locator("svg image").count() == 0, "no control or element brings back the old vector map")
    pg.click("#bRotR"); settle(700); ok(abs(view()["rotation"] - 30) < 0.5 and view()["detailed"], f"turn right: the drawings turn 30° (got {view()['rotation']:.0f}°)")
    pg.click("#bNorth"); settle(700); ok(abs(view()["rotation"]) < 0.5, "the compass turns the map back to the drawing's view")
    pg.click("#bReset"); settle(1200)

    print("\nselection")
    feats = J("""(()=>{const m=pathfinder.map; return m.features().filter(f=>f.kind==='building').map(f=>({name:f.name, top:(f.height_m||3)}))})()""")
    hits, total, wrong = 0, 0, []
    for f in feats:
        J(f"pathfinder.map.focus({json.dumps(f['name'])}, {{zoom: 14, instant: true}})"); settle(250)
        c = J(f"""(()=>{{const m=pathfinder.map, ft=m.features().find(x=>x.name==={json.dumps(f['name'])}), r=document.querySelector('.cm-root').getBoundingClientRect(); const s=m.groundToScreen(ft.centre[0],ft.centre[1],{f['top']}/3.2); return {{x:r.left+s.x, y:r.top+s.y}}}})()""")
        pg.mouse.click(c["x"], c["y"]); settle(150); total += 1
        name = pg.inner_text("#cardName") if pg.is_visible("#card") else None
        if name == f["name"]: hits += 1
        else: wrong.append((f["name"], name))
        pg.keyboard.press("Escape")
    ok(hits == total, f"tapping each building's roof selects that building: {hits}/{total}" + (f" wrong: {wrong[:4]}" if wrong else ""))
    pg.click("#bReset"); settle(1200)
    J("(()=>{const p=pathfinder.nav().places.find(p=>p.kind==='entrance'); pathfinder.map.animateTo({ground:[p.x,p.y], scale:10}, 0)})()"); settle(400)
    door = J("""(()=>{const p=pathfinder.nav().places.find(p=>p.kind==='entrance'); const s=pathfinder.map.groundToScreen(p.x,p.y,0), r=document.querySelector('#map').getBoundingClientRect(); return {x:r.left+s.x,y:r.top+s.y,name:p.name}})()""")
    pg.mouse.click(door["x"], door["y"]); settle(300)
    ok(pg.is_visible("#card") and pg.inner_text("#cardName") == door["name"], f"tapping an entrance marker selects the entrance ({door['name'][:40]}…)")
    pg.click("#cardGo"); settle(900)
    ok("Route found" in pg.inner_text("#msg") and not pg.is_visible("#card"), "Navigate here sets the destination and calculates a route")
    pg.click("#bReset"); settle(1200)
    pg.mouse.click(box["x"] + box["width"] * 0.62, box["y"] + box["height"] * 0.55); settle(300)
    ok(pg.is_visible("#card"), f"tapping the ground opens a card: {pg.inner_text('#cardName')} / {pg.inner_text('#cardInfo')[:50]}")
    pg.keyboard.press("Escape"); ok(not pg.is_visible("#card"), "Esc closes the card")

    print("\nroutes")
    pg.click("#clear")
    pg.fill("#q", "Block A"); settle(200); pg.press("#q", "Enter"); settle(1200)
    n_opts = pg.locator("#routeOpts button").count()
    ok(n_opts == 2, f"an alternative route is offered ({n_opts} options)")
    if n_opts == 2:
        pg.locator("#routeOpts button").nth(1).click(); settle(300)
        ok(J("pathfinder.state.route === pathfinder.state.routes[1]"), "choosing the alternative makes it the active route")
    pg.fill("#q", "Hostel 1"); settle(200); pg.press("#q", "Enter"); settle(1000)
    ok(J("pathfinder.state.route && pathfinder.state.route.to") == "Hostel 1", "changing the destination recalculates")
    pg.click("#clear"); settle(200)
    left = J("document.querySelectorAll('.cm-over polyline').length")
    ok(left == 0, f"Clear route removes every route graphic ({left} left)")
    pg.check("#strict"); settle(200); pg.fill("#q", "Hostel 1"); settle(200); pg.press("#q", "Enter"); settle(700)
    ok("No route" in pg.inner_text("#msg") and pg.is_disabled("#startNav"), "unreachable destination gives a clear message: " + pg.inner_text("#msg")[:70])
    pg.uncheck("#strict"); settle(500)

    print("\nnavigation")
    pg.click("#clear"); pg.fill("#q", "Block D"); settle(200); pg.press("#q", "Enter"); settle(900)
    pg.click("#startNav"); settle(400)
    ok(pg.is_visible("#modeBar") and J("pathfinder.state.follow"), "Start navigation switches to navigation mode and follows the marker")
    walk = J("""async()=>{const S=pathfinder.state, r=S.route, sl=ms=>new Promise(x=>setTimeout(x,ms)), out=[]; let early=false;
      for(let d=0; d<=r.length; d+=2){ let i=1; while(i<r.cum.length-1&&r.cum[i]<d) i++; const a=r.points[i-1], b=r.points[i], t=(d-r.cum[i-1])/((r.cum[i]-r.cum[i-1])||1);
        if(a.level===b.level){S.player.x=a.x+(b.x-a.x)*t;S.player.y=a.y+(b.y-a.y)*t;S.player.level=a.level}
        await sl(40); if(d<r.length-6&&S.arrived) early=true; out.push(+document.getElementById('prog').value);}
      await sl(300); return {early, arrived:S.arrived, mono: out.every((v,i)=>!i||v>=out[i-1]-0.5), last: out[out.length-1]}}""")
    ok(walk["mono"] and walk["arrived"] and not walk["early"], f"progress rises as the marker walks the route, arrival only at the end ({walk})")
    ok("arrived" in " ".join(pg.locator(".toast").all_inner_texts()).lower(), "arrival notification shown")
    pg.fill("#q", "Hostel 3"); settle(200); pg.press("#q", "Enter"); settle(900); pg.click("#startNav"); settle(300)
    J("""(()=>{const S=pathfinder.state,r=S.route,n=pathfinder.nav(),m=r.points[Math.floor(r.points.length/2)]; for(const [dx,dy] of [[0,12],[12,0],[-12,0],[0,-12]]) if(n.walkable(m.x+dx,m.y+dy,0)){S.player.x=m.x+dx;S.player.y=m.y+dy;return}})()""")
    settle(1400)
    ok(pg.is_visible("#offRoute"), "leaving the route offers a recalculation")
    pg.click("#reroute"); settle(1000)
    ok(not pg.is_visible("#offRoute") and J("pathfinder.state.route.from") == "My marker", "Recalculate plans a new route from the marker")
    pg.click("#stopNav"); settle(300)
    ok(not pg.is_visible("#modeBar") and not J("pathfinder.state.navigating"), "Stop returns to exploring")
    J("pathfinder.state.player.x=80; pathfinder.state.player.y=74; pathfinder.state.player.level=0")
    pg.select_option("#camView", "third"); settle(800)
    pg.mouse.click(cx, cy); pg.keyboard.press("Escape")
    h0 = J("pathfinder.state.player.heading")
    pg.keyboard.down("d"); pg.wait_for_timeout(500); pg.keyboard.up("d"); settle(400)
    h = J("pathfinder.state.player.heading") * 180 / math.pi
    face = J("(()=>{const m=pathfinder.map,P=pathfinder.state.player,a=m.groundToScreen(P.x,P.y,P.level),b=m.groundToScreen(P.x+Math.cos(P.heading),P.y+Math.sin(P.heading),P.level);return Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI})()")
    ok(abs(h - h0 * 180 / math.pi) > 30 and view()["detailed"] and abs(face + 90) < 10, f"third-person: D turns the marker ({abs(h - h0*180/math.pi):.0f}°) and the map turns so it faces up the screen ({face:.0f}°)")
    a0 = J("[pathfinder.state.player.x, pathfinder.state.player.y]")
    pg.keyboard.down("w"); pg.wait_for_timeout(400); pg.keyboard.up("w")
    a1 = J("[pathfinder.state.player.x, pathfinder.state.player.y]"); hh = J("pathfinder.state.player.heading")
    mv = (a1[0] - a0[0], a1[1] - a0[1]); L = math.hypot(*mv)
    ok(L > 1 and (mv[0] * math.cos(hh) + mv[1] * math.sin(hh)) / L > 0.95, f"third-person: W walks forward along the heading ({L:.1f} m)")
    pg.select_option("#camView", "iso"); settle(600)
    # walk at a building from just outside its entrance, with whichever key points at it
    key = J("""(()=>{const n=pathfinder.nav(), p=n.place('building:Block k'), a=p.anchors[0], m=pathfinder.map; const S=pathfinder.state; S.player.x=a.x; S.player.y=a.y; S.player.level=0;
       const to=[p.x-a.x,p.y-a.y], L=Math.hypot(...to); let best=null, bd=-2;
       for(const [k,v] of [['w',[0,-1]],['s',[0,1]],['a',[-1,0]],['d',[1,0]]]){const g=m.screenDirToGround(v[0],v[1]); const d=(g[0]*to[0]+g[1]*to[1])/L; if(d>bd){bd=d;best=k}} return best})()""")
    pg.mouse.click(cx, cy); pg.keyboard.press("Escape")
    pg.keyboard.down(key); pg.wait_for_timeout(1500); pg.keyboard.up(key)
    ok(J("pathfinder.nav().walkable(pathfinder.state.player.x, pathfinder.state.player.y, 0)") and J("!pathfinder.nav().buildingAt(pathfinder.state.player.x, pathfinder.state.player.y)"), f"walking straight at Block k from its entrance stops at the wall (key {key})")

    ok(not errors, "no script errors" + (": " + "; ".join(errors[:3]) if errors else ""))
    browser.close()

print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)
