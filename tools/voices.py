#!/usr/bin/env python3
"""Generates the spoken lines (assets/sounds/v_*.mp3) from the dialogue in src/. Run after changing any line.
Uses Kokoro (kokoro-onnx, Apache-2.0) for natural voices.
Needs:  pip install kokoro-onnx soundfile numpy scipy ; ffmpeg ; and in --model DIR the two model files from
        https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 (kokoro-v1.0.onnx, voices-v1.0.bin)
usage: voices.py [--list] [--model DIR] [--redo]    (only missing lines are generated unless --redo)
Each line is stored under a hash of "WHO|text", the same hash src/game.js uses to find it."""
import re, sys, os, subprocess, wave
from pathlib import Path
root = Path(__file__).resolve().parent.parent
game = (root / 'src' / 'game.js').read_text(); level = (root / 'src' / 'level.js').read_text()
# who: (Kokoro voice, accent, speed, pitch shift). Leo has no child voice to use, so a young woman's voice is raised a little.
CAST = {'WHISPER': ('af_nicole', 'en-us', 0.9, 1.0), 'DAD': ('am_michael', 'en-us', 1.02, 1.0), 'MOM': ('af_heart', 'en-us', 1.0, 1.0), 'MARCUS': ('am_onyx', 'en-us', 0.97, 1.0),
        'MANAGER': ('bm_george', 'en-gb', 0.9, 0.97), 'DANA': ('af_sarah', 'en-us', 1.0, 1.0), 'PRIYA': ('af_nicole', 'en-us', 0.95, 1.0),
        'LEO': ('af_sky', 'en-us', 1.08, 1.14)}
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
    t = re.sub(r"\b([A-Z]{2,})\b", lambda m: m.group(1) if m.group(1) in ('OK', 'TV') else m.group(1).capitalize(), t)
    return re.sub(r"\s+", " ", t).strip(" ,")
if '--list' in sys.argv:
    for w, t in lines: print(h(w + '|' + t), w, '|', t, '=>', speakable(t))
    print(len(lines), 'lines'); sys.exit()
import numpy as np
from scipy import signal
from kokoro_onnx import Kokoro
mdir = Path(sys.argv[sys.argv.index('--model') + 1]) if '--model' in sys.argv else Path('.')
tts = Kokoro(str(mdir / 'kokoro-v1.0.onnx'), str(mdir / 'voices-v1.0.bin'))
out = root / 'assets' / 'sounds'; out.mkdir(parents=True, exist_ok=True); made = 0
if '--redo' in sys.argv:
    for f in out.glob('v_*.mp3'): f.unlink()
# a small, soft room: a few early reflections and a short tail, so lines sound spoken in the store rather than in a booth
rng = np.random.default_rng(7)
def room(a, sr, wet):
    n = int(sr * 0.45); ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (sr * 0.09)); ir[:int(sr * 0.012)] = 0
    for d, g in ((0.011, 0.5), (0.019, 0.35), (0.027, 0.25)): ir[int(sr * d)] += g * 3
    b, aa = signal.butter(2, 3800 / (sr / 2)); ir = signal.lfilter(b, aa, ir); ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
    return a + wet * signal.fftconvolve(a, ir)[:len(a)]
for who, text in lines:
    f = out / f"v_{h(who + '|' + text)}.mp3"; sp = speakable(text)
    if f.exists() or len(re.sub(r"[^a-zA-Z]", "", sp)) < 2: continue
    voice, lang, speed, pitch = CAST[who]
    hush = '(whisper)' in text or '(muttering)' in text or '(under his breath)' in text
    a, sr = tts.create(sp, voice=voice, speed=speed / pitch * (0.92 if hush else 1), lang=lang)
    a = np.asarray(a, dtype=np.float64)
    if pitch != 1.0: a = signal.resample(a, int(len(a) / pitch))     # spoken slower, then sped back up: same pace, higher voice
    if who == 'WHISPER':   # a real whisper: keep the shape of the speech, throw the voice (pitch) away
        f0, t0, Z = signal.stft(a, sr, nperseg=512); Z = np.abs(Z) * np.exp(2j * np.pi * rng.random(Z.shape)); _, a = signal.istft(Z, sr, nperseg=512)
        b2, a2 = signal.butter(2, [900 / (sr / 2), 7000 / (sr / 2)], 'band'); a = signal.lfilter(b2, a2, a)
    idx = np.where(np.abs(a) > 0.01)[0]
    if len(idx): a = a[max(0, idx[0] - 500): idx[-1] + 2400]
    a = np.concatenate([a, np.zeros(int(sr * 0.25))]); a = room(a, sr, 0.16)
    rms = np.sqrt(np.mean(a[np.abs(a) > 0.01] ** 2)) if np.any(np.abs(a) > 0.01) else 0.1
    a = np.tanh(a * (0.16 if not hush else 0.08) / (rms + 1e-9) * 1.1) * 0.95       # even loudness from line to line
    a[:240] *= np.linspace(0, 1, 240); a[-1600:] *= np.linspace(1, 0, 1600)
    import soundfile as sf; tmp = '/tmp/_v.wav'; sf.write(tmp, a.astype(np.float32), sr)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp, '-ac', '1', '-ar', '24000', '-b:a', '32k', str(f)], check=True); made += 1
keep = {f"v_{h(w + '|' + t)}.mp3" for w, t in lines}
for f in out.glob('v_*.mp3'):
    if f.name not in keep: f.unlink()
print(f"{len(lines)} lines, {made} generated, {sum(f.stat().st_size for f in out.glob('v_*.mp3')) // 1024} KB total")
