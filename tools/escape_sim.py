#!/usr/bin/env python3
"""Autopilot the finale many times: rescue Leo, sprint the shortest route to the front doors."""
import sys, json
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
diff = sys.argv[1] if len(sys.argv) > 1 else 'normal'
trials = int(sys.argv[2]) if len(sys.argv) > 2 else 60
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 400, "height": 300})
    errs = []; pg.on("pageerror", lambda e: errs.append(f"{e} {e.stack}"))
    pg.goto((root / "index.html").as_uri() + "?debug=1" + __import__("os").environ.get("BOXQ", "&q=low")); pg.wait_for_function("() => !!window.__box", timeout=120000)
    r = pg.evaluate("""([diff, trials]) => {
      const B = __box, L = B.LV, res = [];
      for (let t = 0; t < trials; t++) {
        B.start(diff); B.tick(1/30, 30 * 40);            // grace + some hunting
        B.G.keys = true; B.G.alert = 0;
        if (B.K.state === 'chase') { B.K.state = 'patrol'; }
        const c = L.containers[B.G.broC];
        // stand next to the hamper/pot on the side facing the stairs
        const route0 = B.route(c.x, c.z, 1, 25.2, 10.5, 1);
        const [sx, sz] = route0 && route0.length > 1 ? route0[1] : [c.x + 1, c.z];
        const d0 = Math.hypot(sx - c.x, sz - c.z), px = c.x + (sx - c.x) / d0 * 1.0, pz = c.z + (sz - c.z) / d0 * 1.0;
        B.setP(px, 4.5, pz, 0, 0, false); B.tick(1/30, 1);
        const kd = Math.hypot(B.K.x - px, B.K.z - pz) + (Math.abs(B.K.y - 4.5) > 1 ? 10 : 0);
        B.interact();
        const kd2 = Math.hypot(B.K.x - B.P.x, B.K.z - B.P.z), ks = [+B.K.x.toFixed(1), +B.K.z.toFixed(1)];
        const fd = L.doors.front;
        let route = B.route(B.P.x, B.P.z, 1, fd.x, fd.z, 0), wi = 1, n = 0, out = 'timeout', gap = 99;
        B.key('ShiftLeft', true); B.key('KeyW', true);
        while (n < 30 * 60) {
          if (B.mode !== 'play') { out = B.mode === 'cine' ? 'win' : 'caught: ' + B.G.reason; break; }
          const P = B.P;
          while (wi < route.length - 1 && Math.hypot(route[wi][0] - P.x, route[wi][1] - P.z) < 0.6) wi++;
          const [tx, tz] = route[Math.min(wi, route.length - 1)];
          const tgt = wi >= route.length - 1 ? [fd.x, fd.z - 1.5] : [tx, tz];
          P.yaw = Math.atan2(tgt[0] - P.x, -(tgt[1] - P.z)); P.pitch = 0;
          B.tick(1/30, 1); n++;
          if (B.K.stun <= 0) gap = Math.min(gap, Math.hypot(B.K.x - B.G.bro.x, B.K.z - B.G.bro.z), Math.hypot(B.K.x - B.P.x, B.K.z - B.P.z));
        }
        B.key('ShiftLeft', false); B.key('KeyW', false);
        res.push({ gap: +gap.toFixed(1), out, secs: +(n / 30).toFixed(1), kStart: +kd2.toFixed(1), kAt: ks, from: [+px.toFixed(1), +pz.toFixed(1)], where: B.zoneName(c.x, c.z, 4.5) });
      }
      return res;
    }""", [diff, trials])
    wins = [x for x in r if x['out'] == 'win']
    print(f"{diff}: {len(wins)}/{len(r)} escaped; avg run {sum(x['secs'] for x in wins)/max(1,len(wins)):.1f}s")
    from collections import Counter
    print(Counter(x['out'] for x in r))
    g = sorted(x['gap'] for x in r if x['out'] == 'win') or [0]; print("closest he got (m): min", g[0], "median", g[len(g)//2], "max", g[-1], "| under 3m:", sum(1 for v in g if v < 3))
    print("losses:", [(x['kStart'], x['kAt'], x['from'], x['where'], x['secs']) for x in r if x['out'] != 'win'][:12])
    print("errors:", errs[:3])
    b.close()
