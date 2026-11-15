#!/usr/bin/env python3
"""Generates the spoken lines (assets/sounds/v_*.mp3) from the dialogue in src/. Run after changing any line.
Needs:  pip install piper-tts numpy scipy ; python3 -m piper.download_voices en_US-libritts_r-medium ; ffmpeg
usage: voices.py [--list] [--model DIR]     (only missing lines are generated; delete assets/sounds/v_* to redo all)
Each line is stored under a hash of "WHO|text", the same hash src/game.js uses to find it."""
import re, sys, os, subprocess, wave
from pathlib import Path
root = Path(__file__).resolve().parent.parent
game = (root / 'src' / 'game.js').read_text(); level = (root / 'src' / 'level.js').read_text()
CAST = {'DAD': (113, 1.0, 1.0), 'MARCUS': (137, 1.05, 1.0), 'MANAGER': (6, 1.12, 0.97), 'MOM': (96, 1.0, 1.0), 'DANA': (11, 1.0, 1.0), 'PRIYA': (25, 1.05, 1.0), 'LEO': (54, 1.0, 1.17)}   # speaker, pace, pitch
STR = r"'((?:[^'\\]|\\.)*)'"
lines = []
def add(who, text):
    text = text.replace("\\'", "'")
    if who in CAST and text and not text.endswith(' ') and (who, text) not in lines: lines.append((who, text))
for m in re.finditer(r"say\('([A-Z]+)',\s*" + STR, game): add(m.group(1), m.group(2))
for m in re.finditer(r"\['([A-Z]+)',\s*" + STR + r"\]", game): add(m.group(1), m.group(2))
for m in re.finditer(r"\b(manager|dana|priya|marcus): \[([^\]]*)\]", game):
    for t in re.finditer(STR, m.group(2)): add(m.group(1).upper(), t.group(1))
for m in re.finditer(r"leoSay\('\w+',[^\n]*?" + STR + r"(?:, [\d.]+)?\);", game): add('LEO', m.group(1))
for m in re.finditer(r"\[[01], [\d.]+, [\d.]+, [\d.]+, " + STR + r"\]", level): add('LEO', m.group(1))
# lines chosen by a condition (the patterns above only see the first string)
for m in re.finditer(r"say\('([A-Z]+)',\s*[^'\n]*\?[^\n]*", game):
    for t in re.finditer(STR, m.group(0)[len("say('" + m.group(1) + "',"):].split(', 2.')[0].split(', 3')[0]): 
        if len(t.group(1)) > 3: add(m.group(1), t.group(1))
add('LEO', 'Psst! I’m in the pot! Over here!'); add('LEO', 'Psst! I’m in the hamper! Over here!')
def h(s):
    v = 5381
    for ch in s: v = ((v * 33) ^ ord(ch)) & 0xFFFFFFFF
    return format(v, '08x')
def speakable(t):
    t = re.sub(r"\([^)]*\)", " ", t).replace('—', ', ').replace('…', '... ').replace('’', "'").replace('“', '').replace('”', '')
    t = re.sub(r"\b([A-Z]{3,})\b", lambda m: m.group(1).capitalize(), t)
    return re.sub(r"\s+", " ", t).strip(" ,")
if '--list' in sys.argv:
    for w, t in lines: print(h(w + '|' + t), w, '|', t, '=>', speakable(t))
    print(len(lines), 'lines'); sys.exit()
import numpy as np
from scipy import signal
from piper import PiperVoice
from piper.config import SynthesisConfig
mdir = Path(sys.argv[sys.argv.index('--model') + 1]) if '--model' in sys.argv else Path('.')
voice = PiperVoice.load(str(mdir / 'en_US-libritts_r-medium.onnx')); SR = 22050
out = root / 'assets' / 'sounds'; out.mkdir(parents=True, exist_ok=True); made = 0
for who, text in lines:
    f = out / f"v_{h(who + '|' + text)}.mp3"; sp = speakable(text)
    if f.exists() or len(re.sub(r"[^a-zA-Z]", "", sp)) < 2: continue
    spk, pace, pitch = CAST[who]
    whisper = '(whisper)' in text or '(muttering)' in text or '(under his breath)' in text
    a = np.concatenate([c.audio_float_array for c in voice.synthesize(sp, SynthesisConfig(speaker_id=spk, length_scale=pace * pitch, noise_scale=0.6))])
    if pitch != 1.0: a = signal.resample(a, int(len(a) / pitch))          # spoken slower, then sped back up: same length, higher voice
    idx = np.where(np.abs(a) > 0.015)[0]
    if len(idx): a = a[max(0, idx[0] - 600): idx[-1] + 2200]
    a = a / (np.max(np.abs(a)) + 1e-9) * (0.55 if whisper else 0.9)
    a[:300] *= np.linspace(0, 1, 300); a[-1500:] *= np.linspace(1, 0, 1500)
    tmp = '/tmp/_v.wav'; w = wave.open(tmp, 'w'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((a * 32767).astype(np.int16).tobytes()); w.close()
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '22050', '-b:a', '24k', str(f)], check=True); made += 1
keep = {f"v_{h(w + '|' + t)}.mp3" for w, t in lines}
for f in out.glob('v_*.mp3'):
    if f.name not in keep: f.unlink()
print(f"{len(lines)} lines, {made} generated, {sum(f.stat().st_size for f in out.glob('v_*.mp3')) // 1024} KB total")
