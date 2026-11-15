#!/usr/bin/env python3
"""Headless check of the scares: hide in a pot/hamper, bring Krampus over to stare in, then the catch jumpscare.
usage: scares.py OUTDIR   (BOXQ='&q=low' for the phone preset)"""
import os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/box-scares"); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 960, "height": 540})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e} {e.stack}"))
    pg.goto((root / "index.html").as_uri() + "?debug=1" + os.environ.get("BOXQ", ""))
    pg.wait_for_function("() => !!window.__box", timeout=120000)
    pg.evaluate("() => __box.start('normal')")
    c = pg.evaluate("() => { for (let i = 0; i < 99; i++) { const c = __box.container(i); if (c && c.f === 1) return c; } }")
    print("container", c)
    pg.evaluate(f"() => __box.setP({c['x'] + 0.9}, {c['y']}, {c['z']}, 0, 0)")
    print("peer started:", pg.evaluate("() => __box.peer()"))
    for i, n in enumerate([20, 90, 200, 300]):
        pg.evaluate(f"() => __box.tickN({n})"); pg.wait_for_timeout(1200)
        print("state", pg.evaluate("() => [__box.kstate(), __box.mode, +__box.fear().toFixed(2), document.getElementById('msg').textContent]"))
        pg.screenshot(path=str(out / f"peer_{i}.png"))
    pg.evaluate("() => __box.tickN(500)"); pg.wait_for_timeout(600)
    print("after ~37s:", pg.evaluate("() => [__box.kstate(), __box.mode]"))
    pg.screenshot(path=str(out / "peer_left.png"))
    pg.evaluate("() => __box.scare()")
    for i in range(3):
        pg.wait_for_timeout(350); pg.screenshot(path=str(out / f"scare_{i}.png"))
    pg.wait_for_timeout(4000)
    print("end:", pg.evaluate("() => [__box.mode, document.getElementById('endTitle').textContent]"))
    print("errors:", errs[:10])
    b.close()
