#!/usr/bin/env python3
"""Plays the whole story start to finish with an autopilot and writes a transcript + screenshots.
usage: playthrough.py OUTDIR [easy|normal|hard] [--fast]   (--fast uses the pause-menu skip for the walk-around)
The autopilot plays like a careful person: it walks, hides in a pot/hamper when Krampus is close, and
sprints only in the finale. It does know where things are, so treat its times as a best case."""
import sys, json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/box-run"); out.mkdir(parents=True, exist_ok=True)
diff = next((a for a in sys.argv[2:] if a in ("easy", "normal", "hard")), "normal")
fast = "--fast" in sys.argv
noshots = "--noshots" in sys.argv
AP = r"""
window.AP = (() => {
  const B = __box, fl = () => (B.P.y > 2.25 ? 1 : 0);
  const TR = (window.__trace = []);
  const step = () => {
    if (B.mode === 'explore') B.exploreTick(1/30, 1); else if (B.mode === 'play') {
      B.tick(1/30, 1);
      if (B.G && (TR.n = (TR.n || 0) + 1) % 15 === 0) { TR.push([+B.G.time.toFixed(1), +B.P.x.toFixed(1), +B.P.z.toFixed(1), fl(), B.P.crouch ? 'c' : (Math.hypot(B.P.vx, B.P.vz) > 4 ? 'R' : 'w'), B.G.hiding != null ? 'HID' : '', '|K', +B.K.x.toFixed(1), +B.K.z.toFixed(1), B.K.y > 2.25 ? 1 : 0, B.K.state, B.K.seeing ? 'SEES' : '', +B.G.alert.toFixed(2), 'd', +Math.hypot(B.K.x - B.P.x, B.K.z - B.P.z).toFixed(1)]); if (TR.length > 60) TR.shift(); }
    }
  };
  const keys = (run, on) => { B.key('KeyW', on); B.key('ShiftLeft', on && run); };
  // walk toward a point along the walk grid; stops when close, when cond() is true, or after maxT seconds
  function walk(x, z, f, o = {}) {
    const m0 = B.mode; let t = 0, rt = 0, route = null, wi = 1; const P = B.P;
    keys(o.run, true);
    while (t < (o.maxT || 90) && B.mode === m0) {
      if (o.cond && o.cond()) break;
      const d = Math.hypot(P.x - x, P.z - z) + (Math.abs(P.y - f * 4.5) > 0.3 ? 20 : 0);
      if (d < (o.near || 0.8)) break;
      if (rt <= 0 || !route) { route = B.route(P.x, P.z, fl(), x, z, f); wi = 1; rt = 0.6; }
      rt -= 1/30;
      let tgt = [x, z];
      if (route && route.length > 1) { while (wi < route.length - 1 && Math.hypot(route[wi][0] - P.x, route[wi][1] - P.z) < 0.5) wi++; tgt = route[Math.min(wi, route.length - 1)]; if (wi >= route.length - 1 && fl() === f) tgt = [x, z]; }
      if (P.x > 24.2 && P.x < 26.2 && P.z > 11.9 && P.z < 26.1 && P.y > 0.01 && P.y < 4.49) tgt = f === 1 ? [25.2, 10.9] : [25.2, 27.2];   // on the staircase: keep going to the end
      P.yaw = Math.atan2(tgt[0] - P.x, -(tgt[1] - P.z)); P.pitch = 0;
      if (o.run) P.crouch = false;
      if (B.mode === 'play' && !o.run && B.G.phase !== 'escape') P.crouch = B.G.traps.some((tr) => tr.on && tr.f === fl() && Math.hypot(tr.x - P.x, tr.z - P.z) < 2.2);   // duck under bell strings
      step(); t += 1/30;
    }
    keys(false, false);
    return { t: +t.toFixed(1), d: +Math.hypot(P.x - x, P.z - z).toFixed(1), mode: B.mode };
  }
  function wait(sec, cond) { let t = 0; const m0 = B.mode; while (t < sec && B.mode === m0 && !(cond && cond())) { step(); t += 1/30; } return +t.toFixed(1); }
  const kDist = () => (B.K && B.KV.visible && B.K.state !== 'wait' && Math.abs(B.K.y - B.P.y) < 1 ? Math.hypot(B.K.x - B.P.x, B.K.z - B.P.z) : 99);
  const chased = () => B.K && (B.K.state === 'chase' || B.K.state === 'rush');
  const danger = () => chased() || kDist() < 8 || (B.G && B.G.alert > 0.3 && kDist() < 16);
  function pickContainer(minFromK) {
    let best = -1, bs = -1e9; const f = fl();
    B.LV.containers.forEach((c, i) => { if (c.f !== f || i === B.G.broC) return; const d = Math.hypot(c.x - B.P.x, c.z - B.P.z), dk = Math.hypot(c.x - B.K.x, c.z - B.K.z); if (dk < minFromK) return; const sc = -d + Math.min(dk, 20) * 0.5; if (sc > bs) { bs = sc; best = i; } });
    return best;
  }
  function hideIn(ci, st, run) {
    const c = B.LV.containers[ci];
    walk(c.x, c.z, c.f, { near: 1.3, maxT: 14, run, cond: () => !run && chased() });
    if (!run && B.mode === 'play' && chased()) return false;   // he noticed on the way: let the chase logic take over
    if (B.mode !== 'play' || Math.hypot(c.x - B.P.x, c.z - B.P.z) > 1.5) return false;
    if (B.K.state === 'chase' && (B.K.seeing || B.K.sawT < 1.6)) return false;      // he is watching: climbing in would get you pulled out
    B.interact(); if (B.mode !== 'play' || B.G.hiding == null) return false;
    st.hides++;
    let t = 0; while (B.mode === 'play' && t < 80 && (t < 5 || kDist() < 13 || chased() || B.K.state === 'peer' || B.K.state === 'peerwalk' || B.K.state === 'search' || B.K.state === 'searchwalk')) { step(); t += 1/30; if (B.K.state === 'peer') st.peered = true; }
    st.hidSecs += t;
    if (B.mode === 'play' && B.G.hiding != null) B.interact();
    return true;
  }
  // hunt: go somewhere on foot (no running); when he is close, hide; when he is chasing, run, break line of sight, then hide
  function sneak(x, z, f, st, near) {
    let guard = 0;
    while (B.mode === 'play' && guard++ < 30) {
      B.P.crouch = false;
      const r = walk(x, z, f, { cond: danger, maxT: 150, near });
      if (B.mode !== 'play') return false;
      if (!danger()) { if (r.d < (near || 0.8) + 0.5 && Math.abs(B.P.y - f * 4.5) < 0.3) return true; continue; }
      st.scares++;
      if (chased()) {
        st.chases++;
        // run for a hiding place far from him (the other floor is best), get out of his sight, then climb in
        let tries = 0;
        while (B.mode === 'play' && chased() && tries++ < 12) {
          let best = -1, bs = -1e9;
          B.LV.containers.forEach((c, i) => {
            if (i === B.G.broC || (c.f === fl() && Math.hypot(c.x - B.P.x, c.z - B.P.z) < 5 && (B.K.seeing || B.K.sawT < 1.6))) return;   // he can see this one
            const other = c.f !== fl(), via = other ? [25.2, fl() ? 11.3 : 26.8] : [c.x, c.z];      // where we would run first
            const ax = via[0] - B.P.x, az = via[1] - B.P.z, kx = B.K.x - B.P.x, kz = B.K.z - B.P.z, sameK = Math.abs(B.K.y - B.P.y) < 1;
            const toward = sameK && (ax * kx + az * kz) / ((Math.hypot(ax, az) || 1) * (Math.hypot(kx, kz) || 1)) > 0.3;   // never run past him
            const dk = Math.hypot(c.x - B.K.x, c.z - B.K.z) + (c.f !== (B.K.y > 2.25 ? 1 : 0) ? 25 : 0), d = Math.hypot(c.x - B.P.x, c.z - B.P.z) + (other ? 25 : 0);
            const sc = Math.min(dk, 45) - d * 0.35 - (toward ? 40 : 0) + Math.random() * 4; if (sc > bs) { bs = sc; best = i; }
          });
          const c = B.LV.containers[best];
          walk(c.x, c.z, c.f, { run: true, near: 1.3, maxT: 30, cond: () => !chased() }); st.ran++;
          if (B.mode !== 'play') return false;
          if (Math.hypot(c.x - B.P.x, c.z - B.P.z) < 1.6 && !(B.K.seeing || B.K.sawT < 1.6)) { hideIn(best, st, true); break; }
        }
      } else {
        const ci = pickContainer(4);
        if (ci >= 0 && Math.hypot(B.LV.containers[ci].x - B.P.x, B.LV.containers[ci].z - B.P.z) < 18) hideIn(ci, st, false);
        else { B.P.crouch = true; wait(1.5); wait(10, () => chased() || !danger()); B.P.crouch = false; st.crouched++; }
      }
    }
    return B.mode === 'play';
  }
  return { walk, wait, sneak, kDist, fl };
})();
"""
log = []
def note(s): print(s); log.append(s)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 800, "height": 450})
    errs = []
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e} {e.stack}"))
    pg.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)
    pg.goto((root / "index.html").as_uri() + "?debug=1" + os.environ.get("BOXQ", "&q=low"))
    pg.wait_for_function("() => !!window.__box", timeout=120000); pg.wait_for_timeout(int(os.environ.get("BOXWAIT", "9000")))
    pg.evaluate(AP); pg.evaluate("() => { window.__hold = true; }")
    shots = 0
    def shot(name):
        global shots
        if noshots: return
        n0 = pg.evaluate("() => { window.__hold = false; return window.__frames || 0; }")
        pg.wait_for_function(f"() => (window.__frames || 0) >= {n0} + 2", timeout=120000)
        shots += 1; pg.screenshot(path=str(out / f"{shots:03d}_{name}.png")); pg.evaluate("() => { window.__hold = true; }")
    def flush(tag=""):
        for t, mode, k, text in pg.evaluate("() => __box.log()"): note(f"  [{t:7.1f} {mode:7s}] {k:8s} {text}")
    def scene(name, every=12.0, cap=240):
        t = 0; n = 0
        while pg.evaluate("() => __box.mode") == "cine" and t < cap:
            pg.evaluate("() => __box.sceneTime(1.5)"); t += 1.5
            if t % every < 1.5: shot(f"{name}_{int(t):03d}")
        flush(); note(f"== scene {name}: {t:.0f}s, now {pg.evaluate('() => __box.mode')}")
        return t
    pg.screenshot(path=str(out / "000_title.png"))
    pg.evaluate(f"() => {{ document.querySelector('[data-diff={diff}]').click(); document.getElementById('play').click(); }}")
    note(f"=== RUN on {diff} ===")
    t_open = scene("opening")
    # ---- walk-around with Leo ----
    shot("explore_start"); flush()
    tour = pg.evaluate("() => __box.LV.leoSpots.map(s => [s[0], s[1], s[2]])")
    order = [9, 0, 5, 6, 3, 2, 1, 7, 4, 8]
    ex = {"found": 0}
    def explore_state(): return pg.evaluate("() => { const e = __box.EX; return e ? { t: +e.t.toFixed(0), stage: e.stage, leo: e.leo.mode, hide: e.leo.hideIdx, hs: e.hs } : null; }")
    def find_leo():
        s = explore_state()
        if s and s["leo"] == "counting": pg.evaluate("() => AP.wait(14, () => __box.EX.leo.mode !== 'counting')"); s = explore_state()
        if s and s["leo"] == "hidden":
            shot("hide_and_seek")
            r = pg.evaluate("() => { const c = __box.LV.containers[__box.EX.leo.hideIdx]; const r = AP.walk(c.x, c.z, c.f, { near: 1.3, maxT: 60 }); __box.interact(); return r; }")
            ex["found"] += 1; note(f"  found Leo after {r['t']}s walk"); flush()
    if fast:
        pg.evaluate("() => AP.wait(20)"); find_leo()
        pg.evaluate("() => { document.getElementById('btnPause').click(); document.getElementById('skipAhead').click(); }")
        note("  (used the pause-menu skip)")
    for i in order:
        s = explore_state()
        if not s or s["stage"] != "explore": break
        f, x, z = tour[i]
        r = pg.evaluate(f"() => AP.walk({x}, {z}, {f}, {{ near: 2.0, maxT: 80, cond: () => __box.EX.leo.mode !== 'follow' || __box.EX.stage !== 'explore' }})")
        find_leo(); flush()
        if i in (0, 2, 4, 8): shot(f"explore_spot{i}")
        pg.evaluate("() => AP.wait(6, () => __box.EX.stage !== 'explore')")
    # keep wandering until Leo wants to go
    guard = 0
    while (explore_state() or {}).get("stage") == "explore" and guard < 60:
        guard += 1; f, x, z = tour[order[guard % len(order)]]
        pg.evaluate(f"() => AP.walk({x}, {z}, {f}, {{ near: 2.0, maxT: 40, cond: () => __box.EX.leo.mode !== 'follow' || __box.EX.stage !== 'explore' }})"); find_leo()
        if guard % 3 == 0: shot(f"explore_late{guard}")
        flush()
    s = explore_state(); note(f"== explore ended at t={s and s['t']}s stage={s and s['stage']} hide-and-seek found={ex['found']}")
    pg.evaluate("() => AP.wait(5)"); flush(); shot("return")
    r = pg.evaluate("() => AP.walk(41.0, 16.4, 1, { near: 1.2, maxT: 120 })"); note(f"  to balcony: {r}")
    scene("balcony", every=9)
    shot("after_balcony"); flush()
    r = pg.evaluate("() => AP.walk(25.2, 27.5, 0, { near: 1.0, maxT: 120 })"); note(f"  downstairs: {r}")
    scene("crash", every=4.5); scene("doors", every=9)
    # ---- the hunt ----
    shot("hunt_start"); flush()
    hunt = pg.evaluate("""() => {
      const B = __box, st = { scares: 0, chases: 0, hides: 0, hidSecs: 0, ran: 0, crouched: 0, peered: false, steps: [] };
      const fy = (f) => f;
      AP.wait(3);
      const todo = B.G.items.filter(i => i.kind === 'clue').sort((a, b) => a.f - b.f).concat(B.G.items.filter(i => i.kind === 'keys'));
      for (const it of todo) {
        if (B.mode !== 'play') break;
        const ok = AP.sneak(it.x, it.z, it.f, st, it.kind === 'keys' ? 1.2 : 0.6);
        st.steps.push([it.kind, +B.G.time.toFixed(0), ok && it.taken]);
      }
      if (B.mode === 'play') { const c = B.LV.containers[B.G.broC]; const ok = AP.sneak(c.x, c.z, c.f, st, 1.3); st.steps.push(['leo', +B.G.time.toFixed(0), ok]); }
      st.hidSecs = +st.hidSecs.toFixed(0); st.mode = B.mode; st.time = B.G ? +B.G.time.toFixed(0) : 0; st.clues = B.G.clues; st.keys = B.G.keys; st.reason = B.G.reason;
      return st;
    }""")
    note(f"== hunt: {hunt}"); flush(); shot("hunt_before_rescue")
    if hunt["mode"] == "play":
        esc = pg.evaluate("""() => {
          const B = __box; B.interact(); AP.wait(0.3);
          const fd = B.LV.doors.front, P = B.P; let t = 0, gap = 99, back = 0;
          while (B.mode === 'play' && t < 90) {
            const b = B.G.bro, lag = Math.hypot(b.x - P.x, b.z - P.z) + (Math.abs(b.y - P.y) > 1 ? 6 : 0);
            if (b.down) { AP.walk(b.x, b.z, b.y > 2.25 ? 1 : 0, { run: true, near: 1.2, maxT: 6 }); back++; t += 1; continue; }
            AP.walk(fd.x, fd.z - 0.4, 0, { run: true, near: 0.5, maxT: 0.5 }); t += 0.5;
            if (B.K.stun <= 0) gap = Math.min(gap, Math.hypot(B.K.x - P.x, B.K.z - P.z), Math.hypot(B.K.x - b.x, B.K.z - b.z));
          }
          return { mode: B.mode, t: +t.toFixed(1), gap: +gap.toFixed(1), back, reason: B.G.reason };
        }""")
        note(f"== escape: {esc}"); flush(); shot("escape_end")
        if esc["mode"] == "cine": scene("ending", every=6)
    shot("end_screen"); flush()
    note("end screen: " + pg.evaluate("() => __box.mode + ' | ' + document.getElementById('endTitle').textContent + ' | ' + document.getElementById('endText').textContent"))
    note(f"errors: {errs[:8]}")
    (out / "transcript.txt").write_text("\n".join(log))
    b.close()
