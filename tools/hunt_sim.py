#!/usr/bin/env python3
"""Plays the hunt many times with the autopilot from playthrough.py (walks, hides, runs when chased).
usage: hunt_sim.py [easy|normal|hard] [trials]"""
import sys, re, json, os
from pathlib import Path
from collections import Counter
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
diff = sys.argv[1] if len(sys.argv) > 1 else 'normal'; trials = int(sys.argv[2]) if len(sys.argv) > 2 else 10
AP = re.search(r'AP = r"""(.*?)"""', (root / 'tools' / 'playthrough.py').read_text(), re.S).group(1)
RUN = """(diff) => {
  const B = __box, st = { scares: 0, chases: 0, hides: 0, hidSecs: 0, ran: 0, crouched: 0, peered: false, steps: [] };
  B.start(diff); AP.wait(3);
  const todo = B.G.items.filter(i => i.kind === 'clue').sort((a, b) => a.f - b.f).concat(B.G.items.filter(i => i.kind === 'keys'));
  for (const it of todo) { if (B.mode !== 'play') break; AP.sneak(it.x, it.z, it.f, st, it.kind === 'keys' ? 1.2 : 0.6); }
  let out = 'caught';
  if (B.mode === 'play') { const c = B.LV.containers[B.G.broC]; AP.sneak(c.x, c.z, c.f, st, 1.3); }
  st.huntTime = B.G ? +B.G.time.toFixed(0) : 0; st.clues = B.G.clues; st.keys = B.G.keys;
  if (B.mode === 'play' && B.G.clues >= 0 && Math.hypot(B.LV.containers[B.G.broC].x - B.P.x, B.LV.containers[B.G.broC].z - B.P.z) < 1.6) {
    B.interact(); AP.wait(0.3);
    const fd = B.LV.doors.front, P = B.P; let t = 0;
    while (B.mode === 'play' && t < 90) {
      const b = B.G.bro;
      if (b.down && b.down > 0.8) { AP.walk(b.x, b.z, 0, { run: true, near: 1.2, maxT: 4 }); AP.wait(0.25); t += 0.5; continue; }
      AP.walk(fd.x, fd.z - 0.4, 0, { run: true, near: 0.5, maxT: 0.4 }); t += 0.4;
    }
    out = B.mode === 'cine' ? 'win' : B.mode === 'play' ? 'timeout' : 'caught in escape';
  } else if (B.mode === 'play') out = 'stuck';
  st.out = out; st.trace = window.__trace.slice(-36); window.__trace.length = 0; st.reason = B.G.reason; st.where = B.zoneName(B.P.x, B.P.z, B.P.y); st.total = +B.G.time.toFixed(0); st.sightings = B.G.sightings;
  return st;
}"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 400, "height": 300}); errs = []
    pg.on("pageerror", lambda e: errs.append(f"{e} {e.stack}"[:400]))
    pg.goto((root / "index.html").as_uri() + "?debug=1&q=low"); pg.wait_for_function("() => !!window.__box", timeout=120000)
    pg.evaluate(AP); pg.evaluate("() => { window.__hold = true; }")
    res = [pg.evaluate(RUN, diff) for _ in range(trials)]
    wins = [r for r in res if r['out'] == 'win']
    print(f"{diff}: {len(wins)}/{len(res)} won | avg win time {sum(r['total'] for r in wins)/max(1,len(wins)):.0f}s | outcomes {dict(Counter(r['out'] for r in res))}")
    print("avg per run: sightings %.1f, hides %.1f, secs hidden %.0f, stared at %d/%d" % (sum(r['sightings'] for r in res)/len(res), sum(r['hides'] for r in res)/len(res), sum(r['hidSecs'] for r in res)/len(res), sum(1 for r in res if r['peered']), len(res)))
    for r in res:
        if r['out'] != 'win' and os.environ.get('TRACE'):
            for row in r['trace']: print('     ', *row)
        if r['out'] != 'win': print("  lost:", r['out'], '|', r['reason'], '| at', r['total'], 's in', r['where'], '| clues', r['clues'], 'keys', r['keys'], '| chases', r['chases'], 'hides', r['hides'])
    print("errors:", errs[:3]); b.close()
