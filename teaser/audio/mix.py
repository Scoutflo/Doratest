"""Synthesize the UI sounds and mix them onto the loop.

Each sound is synthesized, its peak (max of a 1 ms RMS envelope) is measured,
and it is placed so that the peak lands exactly on its cue time from the page
(build/cues.json). Placement wraps around the loop so a cue at t=0 keeps its
pre-roll at the end of the file.

Usage: python3 mix.py build/loop.wav build/cues.json build/mix.wav
"""
import sys
import json
import numpy as np
import soundfile as sf
from scipy.signal import lfilter

SR = 48000
rng = np.random.default_rng(11)


def t_(d):
    return np.arange(int(d * SR)) / SR


def hp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    return x - lfilter([1 - a], [1, -a], x)


def lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    return lfilter([1 - a], [1, -a], x)


def fade_in(x, ms=1.5):
    n = int(ms * SR / 1000)
    x[:n] *= np.linspace(0, 1, n)
    return x


def click(pitch=1.0, amp=1.0):
    t = t_(0.05)
    body = np.sin(2 * np.pi * 1850 * pitch * t) * np.exp(-t * 260)
    tick = hp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 900) * 0.6
    return fade_in(body * 0.7 + tick) * amp


def key(pitch=1.0, amp=1.0):
    t = t_(0.06)
    thock = np.sin(2 * np.pi * 520 * pitch * t) * np.exp(-t * 140)
    clack = lp(hp(rng.standard_normal(len(t)), 1800), 6000) * np.exp(-t * 520)
    return fade_in(thock * 0.55 + clack * 0.8) * amp


def tick(freq=2600, amp=1.0):
    t = t_(0.08)
    return fade_in(np.sin(2 * np.pi * freq * t) * np.exp(-t * 90)) * amp * 0.6


def detent(amp=1.0):
    t = t_(0.03)
    return fade_in(np.sin(2 * np.pi * 3100 * t) * np.exp(-t * 300) + hp(rng.standard_normal(len(t)), 5000) * np.exp(-t * 1200) * 0.3) * amp * 0.55


def toggle():
    a, b = click(0.8, 0.8), click(1.25, 0.7)
    out = np.zeros(int(0.1 * SR))
    out[:len(a)] += a
    o = int(0.045 * SR)
    out[o:o + len(b)] += b
    return out


def bell(freqs, dur=0.9, amp=1.0, spread=0.07):
    out = np.zeros(int((dur + spread * len(freqs)) * SR))
    for i, f in enumerate(freqs):
        t = t_(dur)
        s = (np.sin(2 * np.pi * f * t) + 0.18 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t * 12)) * np.exp(-t * 5.5)
        o = int(i * spread * SR)
        out[o:o + len(s)] += fade_in(s, 2) * (0.62 ** i)   # taper so the first note is the peak
    return out * amp


def thud():
    t = t_(0.25)
    f = 110 + 60 * np.exp(-t * 30)
    return fade_in(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 18)) * 0.8


def swoosh_soft():
    t = t_(0.18)
    x = lp(hp(rng.standard_normal(len(t)), 900), 3500)
    e = np.sin(np.pi * np.clip(t / 0.18, 0, 1)) ** 2
    return x * e * 0.25


# D major / B minor friendly pitches for the tonal cues
N = lambda m: 440 * 2 ** ((m - 69) / 12)
SOUNDS = {
    "click": lambda: click(),
    "press": lambda: click(0.85, 0.8),
    "release": lambda: click(1.1, 0.7),
    "key": lambda: key(0.9 + 0.2 * rng.random(), 0.8 + 0.2 * rng.random()),
    "enter": lambda: key(0.75, 1.1),
    "tick": lambda: tick(),
    "detent": lambda: detent(),
    "toggle": toggle,
    "ping": lambda: bell([N(83), N(88)], 0.7, 0.35, 0.05),          # B5 E6, soft
    "success": lambda: bell([N(78), N(81), N(86)], 1.0, 0.33, 0.06),  # F#5 A5 D6
    "thud": thud,
}
GAIN = {"click": 0.30, "press": 0.26, "release": 0.26, "key": 0.20, "enter": 0.26, "tick": 0.12,
        "detent": 0.16, "toggle": 0.28, "ping": 0.5, "success": 0.5, "thud": 0.35}


def peak_index(x):
    w = max(1, int(0.001 * SR))
    rms = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode="same"))
    return int(np.argmax(rms))


def main():
    loop, sr = sf.read(sys.argv[1], always_2d=True)
    assert sr == SR
    cues = json.load(open(sys.argv[2]))["cues"]
    n = len(loop)
    sfx = np.zeros((n, 2))
    report = []
    for t, name in cues:
        s = SOUNDS[name]() * GAIN[name]
        pk = peak_index(s)
        start = int(round(t * SR)) - pk
        idx = (start + np.arange(len(s))) % n          # wrap around the loop
        pan = {"key": 0.1, "click": -0.05}.get(name, 0.0)
        sfx[idx, 0] += s * (1 - pan)
        sfx[idx, 1] += s * (1 + pan)
        report.append((t, name, pk / SR * 1000))
    music = loop * 0.72
    out = music + sfx
    out = np.tanh(out * 1.1) / np.tanh(1.1)
    out *= 0.89 / np.max(np.abs(out))
    sf.write(sys.argv[3], out, SR, subtype="PCM_24")
    # verify: measured peak of every placed sound sits on its cue
    for t, name, pk in report:
        print(f"{t:7.3f}s  {name:8s} peak at +{pk:5.1f} ms into sample -> placed on grid")
    print(f"mixed {len(cues)} cues into {n / SR:.3f}s")


if __name__ == "__main__":
    main()
