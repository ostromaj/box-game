#!/usr/bin/env python3
"""Inline src/*.js into one self-contained index.html (no libraries, works offline)."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "src"
html = (src / "index.src.html").read_text()
for tag, name in (("ENGINE", "engine.js"), ("LEVEL", "level.js"), ("GAME", "game.js")):
    html = html.replace(f"/*@{tag}@*/", (src / name).read_text())
(root / "index.html").write_text(html)
print(f"wrote index.html ({len(html) // 1024} KB)")
