#!/usr/bin/env python3
"""Headless gameplay checks for the Krampus game (Playwright + Chrome)."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/box-sim"); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1000, "height": 620})
    errs = []
    pg.on("pageerror", lambda e: errs.append(f"{e} {e.stack}"))
    pg.goto((root / "index.html").as_uri() + "?debug=1" + __import__("os").environ.get("BOXQ", "")); pg.wait_for_timeout(2000)
    r = pg.evaluate("""() => {
      const B = __box, L = B.LV, o = {};
      o.containers = L.containers.map(c => +B.reachable(c.f, c.x, c.z).toFixed(2));
      o.clues = L.clueSpots.map(([f,x,z]) => +B.reachable(f,x,z).toFixed(2));
      o.keys = L.keySpots.map(([f,x,z]) => +B.reachable(f,x,z).toFixed(2));
      o.traps = L.trapSpots.map(([f,x,z]) => +B.reachable(f,x,z).toFixed(2));
      o.pathUp = B.path(32,2,0, 6,34,1); o.pathClear = B.path(32,2,0, 58,36,1);
      // 1) stand in the open: he should find and catch you
      B.start('normal'); B.setP(33, 0, 26, 0, 0, false);
      let n = 0; while (B.mode === 'play' && n < 30*400) { B.tick(1/30, 30); n += 30; }
      o.r1 = { mode: B.mode, secs: n/30, why: B.G.reason, kstate: B.K.state };
      // 2) hide in a ground-floor pot the whole time: he should not find you
      B.start('normal'); const c = L.containers.findIndex(c => c.f === 0);
      B.setP(L.containers[c].x + 0.8, 0, L.containers[c].z, 0, 0, false); B.interact();
      n = 0; let maxA = 0; const st = {};
      while (B.mode === 'play' && n < 30*240) { B.tick(1/30, 30); n += 30; maxA = Math.max(maxA, B.G.alert); st[B.K.state] = (st[B.K.state]||0)+1; }
      o.r2 = { mode: B.mode, hiding: B.G.hiding, maxA, st, dark: Array.from(B.ZT).filter(v => v < 0.5).length };
      B.interact(); o.r2.out = B.G.hiding;
      // 3) clues, keys, rescue, escape
      B.start('normal'); B.tick(1/30, 30*30);
      for (const it of B.G.items) { B.setP(it.x, it.f ? L.F1 : 0, it.z, 0, 0, true); B.tick(1/30, 2); }
      o.r3 = { clues: B.G.clues, keys: B.G.keys, dark: Array.from(B.ZT).filter(v => v < 0.5).length, traps: B.G.traps.filter(t => t.on).length, mode: B.mode };
      return o;
    }""")
    for k, v in r.items(): print(k, v)
    # rescue + run
    pg.evaluate("""() => { const B = __box, c = B.LV.containers[B.G.broC];
      B.K.state = 'patrol'; B.K.path = null; B.K.x = 60; B.K.z = 4; B.K.y = 0; B.G.alert = 0;
      B.setP(c.x + 0.9, c.y, c.z, -1.57, -0.2, false); B.tick(1/30, 1); }""")
    pg.wait_for_timeout(300); pg.screenshot(path=str(out / "a_pot.png"))
    print("escape", pg.evaluate("""() => { const B = __box; B.interact(); B.tick(1/30, 20); return { phase: B.G.phase, bro: B.G.bro.state, k: B.K.state, mode: B.mode }; }"""))
    pg.wait_for_timeout(300); pg.screenshot(path=str(out / "b_alarm.png"))
    print("chase", pg.evaluate("""() => { const B = __box; B.setP(25.2, 4.5, 9, 0, 0, false); B.tick(1/30, 60);
      const b = B.G.bro; const r = { broDist: Math.hypot(b.x - B.P.x, b.z - B.P.z).toFixed(1) };
      B.setP(40, 0, 8, 0, 0, false); B.K.x = 44; B.K.z = 20; B.K.y = 0; B.K.stun = 0; B.K.repath = 0; B.tick(1/30, 45);
      r.kDist = Math.hypot(B.K.x - B.P.x, B.K.z - B.P.z).toFixed(1); r.kstate = B.K.state; r.mode = B.mode; return r; }"""))
    pg.evaluate("() => { __box.P.yaw = 3.3; __box.P.pitch = 0.1; }")
    pg.wait_for_timeout(300); pg.screenshot(path=str(out / "c_krampus.png"))
    print("win", pg.evaluate("""() => { const B = __box; B.K.x = 5; B.K.z = 35; B.setP(32, 0, 2.5, 0, 0, false); B.G.bro.x = 32; B.G.bro.z = 4; B.G.bro.y = 0; B.tick(1/30, 3); return B.mode + ' / ' + document.getElementById('cardWhere').textContent; }"""))
    pg.wait_for_timeout(300); pg.screenshot(path=str(out / "d_win.png"))
    # mood shots: dark zones, a trap, the door, hiding
    pg.evaluate("""() => { const B = __box; B.start('normal'); B.tick(1/30, 30*30); B.killLights(8); B.tick(1/30, 60);
      const t = B.G.traps.find(t => t.on); B.K.state='look'; B.K.t=99; B.K.look=0; B.K.x = 50; B.K.z = 20; B.K.y = t.f ? 4.5 : 0;
      B.setP(t.x + (t.ax === 'x' ? 0 : 3), t.f ? 4.5 : 0, t.z + (t.ax === 'x' ? 3 : 0), t.ax === 'x' ? 0 : -1.57, -0.1, false); B.tick(1/30, 1); }""")
    pg.wait_for_timeout(300); pg.screenshot(path=str(out / "e_trap.png"))
    pg.evaluate("() => { const B = __box; B.setP(32, 0, 5, 0, 0.05, false); B.tick(1/30, 1); }")
    pg.wait_for_timeout(300); pg.screenshot(path=str(out / "f_door.png"))
    pg.evaluate("() => { const B = __box; B.K.x = 33; B.K.z = 14; B.K.y = 0; B.K.yaw = 3.14; B.setP(33, 0, 19.5, 0, 0.25, true); B.G.alert = 0; }")
    pg.wait_for_timeout(250); pg.screenshot(path=str(out / "g_close.png"))
    print("errors:", errs[:5])
    b.close()
