#!/usr/bin/env python3
"""Headless check of the story: plays each cutscene, screenshots every few seconds, reports errors.
usage: scenes.py OUTDIR [scene ...]   (scenes: opening balcony crash doors ending)"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/box-scenes")
out.mkdir(parents=True, exist_ok=True)
names = sys.argv[2:] or ["opening", "balcony", "crash", "doors", "ending"]
STEP = 2.5

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 960, "height": 540})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e} {e.stack}"))
    pg.goto((root / "index.html").as_uri() + "?debug=1")
    pg.wait_for_timeout(3000)
    if not pg.evaluate("() => !!window.__box"):
        print("errors:", errs[:20]); b.close(); sys.exit(1)
    print("stats", pg.evaluate("() => __box.stats()"))
    for name in names:
        pg.evaluate(f"() => __box.scene('{name}')")
        t = 0
        while pg.evaluate("() => __box.mode") == "cine" and t < 200:
            pg.wait_for_timeout(150)
            sub = pg.evaluate("() => document.getElementById('sub').innerText.replace(/\\n/g,': ')")
            pg.screenshot(path=str(out / f"{name}_{int(t*10):04d}.png"))
            print(f"{name} t={t:5.1f} | {sub[:80]}")
            pg.evaluate(f"() => __box.sceneTime({STEP})")
            t += STEP
        print(name, "ended at", t, "mode", pg.evaluate("() => __box.mode"))
    print("errors:", errs[:20])
    b.close()
