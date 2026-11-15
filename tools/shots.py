#!/usr/bin/env python3
"""Headless check: load the game, report errors and stats, take screenshots."""
import sys, json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/box-shots")
out.mkdir(parents=True, exist_ok=True)
views = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1100, "height": 680})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e} {e.stack}"))
    pg.goto((root / "index.html").as_uri() + "?debug=1" + __import__("os").environ.get("BOXQ", ""))
    pg.wait_for_timeout(int(__import__("os").environ.get("BOXWAIT", "6000")))
    if not pg.evaluate("() => !!window.__box"):
        print("errors:", errs[:20]); b.close(); sys.exit(1)
    stats = pg.evaluate("() => __box.stats()")
    print("stats", stats)
    pg.screenshot(path=str(out / "00_title.png"))
    pg.evaluate("() => __box.start('normal')")
    import base64
    for f in (0, 1):
        d = pg.evaluate(f"() => __box.mapImg[{f}].toDataURL()")
        (out / f"map{f}.png").write_bytes(base64.b64decode(d.split(',')[1]))
    pg.wait_for_timeout(300)
    for i, v in enumerate(views):
        pg.evaluate(f"() => __box.setP({v[0]},{v[1]},{v[2]},{v[3]},{v[4] if len(v)>4 else 0},{str(v[5]).lower() if len(v)>5 else 'false'})")
        pg.wait_for_timeout(350)
        pg.screenshot(path=str(out / f"{i+1:02d}.png"))
    print("errors:", errs[:20])
    b.close()
