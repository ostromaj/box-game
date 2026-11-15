#!/usr/bin/env python3
"""Render a character lineup + store views headlessly, to check how things look."""
import sys, json
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/prev'); out.mkdir(parents=True, exist_ok=True)
shots = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
src = ''.join((root / 'src' / f).read_text() for f in ['engine.js', 'level.js', 'actors.js'])
html = """<!DOCTYPE html><html><body style="margin:0;background:#000"><canvas id=c style="width:100vw;height:100vh;display:block"></canvas>
<script>""" + src + """
const R = new Renderer(document.getElementById('c'), {lights: 8, taps: 1});
const LV = buildLevel(); const ST = R.upload(LV.geo.array()); R.bakeShadows(ST, LV.bounds);
const BUF = new DynBuf();
const people = ['dad','mom','you','leo','dana','marcus','priya','manager'].map((id,i)=>({id, x: 27+i*1.0, y:0, z: 9.5, yaw: Math.PI, anim:'idle', seed:i, face:{}}));
window.render = (cam, opts) => {
  opts = opts || {};
  R.resize(1);
  const ppl = opts.people || people;
  BUF.reset();
  for (const a of ppl) { Object.assign(a, a.over||{}); ACT.drawPerson(BUF, a, opts.t||1); }
  if (opts.k) ACT.drawKrampus(BUF, opts.k, opts.t||1);
  const eye = cam.eye, la = cam.look;
  const yaw = Math.atan2(la[0]-eye[0], -(la[2]-eye[2])), pitch = Math.atan2(la[1]-eye[1], Math.hypot(la[0]-eye[0], la[2]-eye[2]));
  const vp = mul4(perspective(cam.fov||0.9, R.canvas.width/R.canvas.height, 0.05, 160), viewFPS(eye[0],eye[1],eye[2],yaw,pitch));
  const ls = LV.lights.map(l=>({...l, d: Math.hypot(l.x-eye[0], l.y-eye[1], l.z-eye[2])})).sort((a,b)=>a.d-b.d).slice(0,8);
  R.begin({vp, eye, zones: new Float32Array(16).fill(opts.dark?0.15:1), k:[0,-99,0,1], lights: ls, time: 1, expo: 1.3});
  R.draw(ST); R.drawDynamic(BUF.view());
};
window.ready = true;
</script></body></html>"""
(out / 'p.html').write_text(html)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_page(viewport={"width": 1000, "height": 620})
    errs = []; pg.on("pageerror", lambda e: errs.append(f"{e} {e.stack}")); pg.on("console", lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto((out / 'p.html').as_uri()); pg.wait_for_function("window.ready", timeout=120000)
    for i, s in enumerate(shots):
        pg.evaluate("(s) => render(s.cam, s.opts)", s); pg.wait_for_timeout(100)
        pg.screenshot(path=str(out / f"{i:02d}.png"))
    print("errors:", errs[:5])
    b.close()
