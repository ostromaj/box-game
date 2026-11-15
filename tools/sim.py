#!/usr/bin/env python3
"""Headless gameplay sim: run rounds with fast ticks and report what happens."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 800, "height": 500})
    errs = []
    pg.on("pageerror", lambda e: errs.append(f"{e} {e.stack}"))
    pg.goto((root / "index.html").as_uri())
    pg.wait_for_timeout(2000)
    r = pg.evaluate("""() => {
      const out = {};
      // path checks across floors
      const p1 = __box.astarTest(68,22,0, 50,30,1); out.pathUp = p1 ? p1.length : null;
      const p2 = __box.astarTest(68,22,0, 40,38,1); out.pathBreak = p2 ? p2.length : null;
      const p3 = __box.astarTest(68,22,0, 34,45,0); out.pathWarehouse = p3 ? p3.length : null;
      const p4 = __box.astarTest(68,22,0, 60,36,0); out.pathCoffee = p4 ? p4.length : null;
      // round 1: stand in the open in the atrium -> should be found
      __box.start('normal');
      __box.setP(32, 0, 10, 0, 0, false);
      const t0 = performance.now();
      __box.tick(1/30, 30*29);  // hide phase
      out.phaseAfterHide = __box.G.phase;
      let n = 0; while (__box.mode === 'play' && n < 30*150) { __box.tick(1/30, 30); n += 30; }
      out.r1 = { mode: __box.mode, secs: (n/30).toFixed(1), by: __box.G.caughtBy && __box.G.caughtBy.name, ms: Math.round(performance.now()-t0) };
      // round 2: crouch in the warehouse corner behind boxes
      __box.start('easy');
      __box.setP(29.2, 0, 47.2, 0, 0, true);
      __box.tick(1/30, 30*30);
      n = 0; let maxAlert = 0, states = {};
      while (__box.mode === 'play' && n < 30*130) { __box.tick(1/30, 15); n += 15; maxAlert = Math.max(maxAlert, __box.G.alert); for (const k of __box.G.seekers) states[k.state] = (states[k.state]||0)+1; }
      out.r2 = { mode: __box.mode, secs: (n/30).toFixed(1), maxAlert: maxAlert.toFixed(2), states, seekerPos: __box.G.seekers.map(k=>[k.x.toFixed(1),k.y.toFixed(1),k.z.toFixed(1),k.state]) };
      return out;
    }""")
    for k, v in r.items(): print(k, v)
    print("errors:", errs[:5])
    b.close()
