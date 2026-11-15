#!/usr/bin/env python3
"""Build one self-contained index.html (works offline): bundles Three.js + src/render3.js with esbuild,
embeds assets/textures as data URIs, and inlines src/*.js.  Needs `npm install` once."""
import base64, subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "src"
subprocess.run(["npx", "esbuild", str(src / "render3.js"), "--bundle", "--minify", "--format=iife", "--target=es2020",
                "--outfile=" + str(root / "build" / "render3.bundle.js"), "--log-level=warning"], check=True, cwd=root)
tex = {f.stem: "data:image/jpeg;base64," + base64.b64encode(f.read_bytes()).decode() for f in sorted((root / "assets" / "textures").glob("*.jpg"))}
three = "window.BOX_TEX={" + ",".join(f'"{k}":"{v}"' for k, v in tex.items()) + "};\n" + (root / "build" / "render3.bundle.js").read_text()
html = (src / "index.src.html").read_text()
for tag, text in (("THREE", three), ("ENGINE", (src / "engine.js").read_text()), ("LEVEL", (src / "level.js").read_text()),
                  ("ACTORS", (src / "actors.js").read_text()), ("GAME", (src / "game.js").read_text())):
    assert f"/*@{tag}@*/" in html, tag
    html = html.replace(f"/*@{tag}@*/", text.replace("</script", "<\\/script"))
(root / "index.html").write_text(html)
print(f"wrote index.html ({len(html) // 1024} KB)")
