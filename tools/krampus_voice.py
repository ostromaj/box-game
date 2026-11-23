#!/usr/bin/env python3
"""Krampus's spoken lines -> assets/sounds/k_*.mp3 (and hear.mp3). A deep Kokoro voice, slowed, pitched down an
octave and a bit, layered with a lower copy, given gravel and a cavernous reverb.
Needs the same setup as voices.py.  usage: krampus_voice.py --model DIR"""
import sys, subprocess, numpy as np, soundfile as sf
from pathlib import Path
from scipy import signal
from kokoro_onnx import Kokoro
root = Path(__file__).resolve().parent.parent
mdir = Path(sys.argv[sys.argv.index('--model') + 1]) if '--model' in sys.argv else Path('.')
SLOW = {'hear': 0.66, 'k_comeout': 0.74}   # these two smear when pitched down, so they are spoken slower first
LINES = {'hear': 'I can hear you.', 'k_find': "I'm going to find you.", 'k_comeout': 'Come out... come out... wherever you are.',
         'k_smell': 'I can smell you, little one.', 'k_brother': 'Your brother is waiting for you.',
         'k_laugh': 'Heh. heh. heh heh heh heh.'}   # the low chuckle while he stares into your hiding place
ONLY = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
tts = Kokoro(str(mdir / 'kokoro-v1.0.onnx'), str(mdir / 'voices-v1.0.bin'))
def stretch(x, f, win=1024, hop=256):   # overlap-add time stretch (keeps pitch)
    out = np.zeros(int(len(x) * f) + win); w = np.hanning(win); pos = 0.0; o = 0
    while int(pos) + win < len(x) and o + win < len(out): out[o:o + win] += x[int(pos):int(pos) + win] * w; pos += hop / f; o += hop
    return out / (win / (2 * hop))
rng = np.random.default_rng(11)
for key, text in LINES.items():
    if ONLY and key not in ONLY: continue
    a, sr = tts.create(text, voice='am_onyx', speed=SLOW.get(key, 0.86), lang='en-us'); a = np.asarray(a, dtype=np.float64)
    idx = np.where(np.abs(a) > 0.01)[0]; a = a[max(0, idx[0] - 300): idx[-1] + 600]
    pd = 0.72 if key in SLOW else 0.66; low = signal.resample(a, int(len(a) / pd))   # down 6-7 semitones, and slower
    sub = stretch(signal.resample(low, int(len(low) / 0.72)), 0.72)[:len(low)]      # a second voice under it
    mix = np.zeros(len(low) + int(sr * 1.8)); mix[:len(low)] += low; mix[:len(sub)] += sub * (0.38 if key in SLOW else 0.55)
    t = np.arange(len(mix)) / sr; mix *= 0.8 + 0.2 * signal.sawtooth(2 * np.pi * 37 * t, 0.5)   # gravel
    mix = np.tanh(mix * 3.0) * 0.8
    n = int(sr * 1.6); ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (sr * 0.38)); b, aa = signal.butter(2, 1500 / (sr / 2)); ir = signal.lfilter(b, aa, ir)
    wet = signal.fftconvolve(mix, ir)[:len(mix)]; wet /= np.max(np.abs(wet)) + 1e-9
    out = mix * 0.85 + wet * 0.38; b, aa = signal.butter(3, 3400 / (sr / 2)); out = signal.lfilter(b, aa, out); out = out / np.max(np.abs(out)) * 0.95
    sf.write('/tmp/_k.wav', out.astype(np.float32), sr)
    dst = root / 'assets' / 'sounds' / f'{key}.mp3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', '/tmp/_k.wav', '-ac', '1', '-ar', '22050', '-b:a', '40k', str(dst)], check=True)
    print(key, round(len(out) / sr, 2), 's', dst.stat().st_size // 1024, 'KB')
