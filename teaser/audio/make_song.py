"""Synthesize an original, royalty-free 120 BPM track for the teaser.

The arrangement is a 10-bar phrase (40 beats at 96 BPM = 25 s) that is rendered three
times back to back, so the middle cycle carries the previous cycle's release
tails and the loop seam is sample-continuous. analyze.py then finds the beat
grid in this file exactly as it would in any third-party song.

Harmony follows the story: Bm7 (alert) -> Gmaj7 -> Em7 -> A -> Bm7 -> Gmaj7
-> Em7 -> A -> Gmaj7 -> Dmaj9 (resolved, lands under the success toast),
then back to Bm7.

Usage: python3 make_song.py out.wav
"""
import sys
import numpy as np
import soundfile as sf

SR = 48000
BPM = 96.0
BEAT = 60.0 / BPM
CYCLES = 3
rng = np.random.default_rng(7)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env_adsr(n, a, d, s, r, hold):
    """Sample-domain ADSR. hold = seconds before release starts."""
    t = np.arange(n) / SR
    e = np.where(t < a, t / max(a, 1e-6),
                 np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-6), s))
    rel = np.clip((t - hold) / max(r, 1e-6), 0, 1)
    return e * (1 - rel) ** 2


def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR)
    from scipy.signal import lfilter
    return lfilter([1 - a], [1, -a], x)


def add(buf, start_s, sig):
    j = int(round(start_s * SR))
    lo, hi = max(j, 0), min(j + len(sig), len(buf))
    if hi > lo:
        buf[lo:hi] += sig[lo - j:hi - j]


def kick():
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    f = 44 + 90 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 7.5) * 0.95 + np.sin(ph * 2) * np.exp(-t * 40) * 0.08


def hat(open_=False):
    n = int((0.16 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = x - onepole_lp(x, 7000)
    return x * np.exp(-t * (18 if open_ else 70)) * 0.11


def rim():
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    x = rng.standard_normal(n)
    x = onepole_lp(x - onepole_lp(x, 1200), 5000)
    tone = np.sin(2 * np.pi * 820 * t) * np.exp(-t * 60)
    return (x * np.exp(-t * 38) * 0.5 + tone * 0.25) * 0.32


def epiano(freq, dur, vel):
    n = int((dur + 0.9) * SR)
    t = np.arange(n) / SR
    mod = np.sin(2 * np.pi * freq * t) * 1.4 * np.exp(-t * 3)
    car = np.sin(2 * np.pi * freq * t + mod)
    car += 0.25 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 5)
    return car * env_adsr(n, 0.004, 0.6, 0.45, 0.7, dur) * vel


def pad(freq, dur, vel):
    n = int((dur + 1.2) * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for det in (-0.09, 0.0, 0.08):
        f = freq * 2 ** (det / 12)
        ph = (f * t + rng.random()) % 1.0
        x += 2 * ph - 1
    x = onepole_lp(onepole_lp(x, 1400), 1800)
    return x * env_adsr(n, 0.35, 0.4, 0.8, 1.0, dur) * vel / 3


def bass(freq, dur, vel):
    n = int((dur + 0.15) * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.18 * np.sin(4 * np.pi * freq * t)
    return np.tanh(1.6 * x) * env_adsr(n, 0.006, 0.12, 0.7, 0.08, dur) * vel


def pluck(freq, vel):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 3 * freq * t) * np.exp(-t * 20)
    return x * np.exp(-t * 9) * vel


# Chords: (root midi for bass, voicing midi notes)
CHORDS = [
    (47, [62, 66, 69, 73]),   # Bm7(add9-ish): D F# A C#
    (43, [62, 66, 67, 71]),   # Gmaj7: D F# G B
    (40, [59, 62, 66, 67]),   # Em7(9): B D F# G
    (45, [61, 64, 69, 71]),   # A(add9): C# E A B
    (47, [62, 66, 69, 73]),   # Bm7
    (43, [62, 67, 71, 74]),   # Gmaj7 up
    (40, [59, 62, 66, 67]),   # Em7
    (45, [61, 64, 69, 71]),   # A(add9)
    (43, [62, 66, 67, 71]),   # Gmaj7
    (38, [61, 64, 66, 69]),   # Dmaj9: C# E F# A
]
BARS = len(CHORDS)
CYCLE = BARS * 4 * BEAT
N = int(round(CYCLE * CYCLES * SR))
ARP = [0, 2, 1, 3, 2, 1, 3, 0]


def build():
    drums = np.zeros(N)
    keys = np.zeros(N)
    pads = np.zeros(N)
    bas = np.zeros(N)
    arp = np.zeros(N)
    K, R = kick(), rim()
    for c in range(CYCLES):
        base = c * CYCLE
        for bar, (root, voic) in enumerate(CHORDS):
            b0 = base + bar * 4 * BEAT
            for beat in range(4):
                tb = b0 + beat * BEAT
                add(drums, tb, K * (1.0 if beat == 0 else 0.85))
                add(drums, tb + BEAT / 2, hat(open_=(beat == 3 and bar % 2 == 1)))
                add(drums, tb + BEAT * 0.75, hat() * 0.45)
                if beat in (1, 3):
                    add(drums, tb, R)
                # bass: offbeat 8ths, root / octave
                add(bas, tb + BEAT / 2, bass(midi(root + (12 if beat == 2 else 0)), BEAT * 0.42, 0.34))
            # chords: epiano stab on 1 and the "and" of 2, pad sustained
            for pos, v in ((0, 0.16), (1.5, 0.11), (3.0, 0.08)):
                for i, nn in enumerate(voic):
                    add(keys, b0 + pos * BEAT + i * 0.006, epiano(midi(nn), BEAT * 0.8, v))
            for nn in voic[:3]:
                add(pads, b0, pad(midi(nn - 12), 4 * BEAT - 0.2, 0.07))
            # 16th arp from the topology through the typing, sparse otherwise
            if 2 <= bar <= 7:
                for s in range(16):
                    if s % 4 == 2 or s in (5, 11, 15):
                        nn = voic[ARP[s % 8]] + 12
                        add(arp, b0 + s * BEAT / 4, pluck(midi(nn), 0.05 if s % 4 else 0.04))
    # sidechain duck (pads/keys) against the kick, periodic so it loops
    t = np.arange(N) / SR
    ph = (t % BEAT) / BEAT
    duck = 1 - 0.45 * np.exp(-ph * 9)
    mix = drums * 0.9 + bas * 0.8 + (keys + pads) * duck + arp * duck
    # stereo: tiny width on keys/arp via Haas
    d = int(0.011 * SR)
    L = mix + np.roll(arp * duck, d) * 0.3
    Rr = mix + np.roll(keys * duck, d) * 0.15
    st = np.stack([L, Rr], 1)
    st = np.tanh(st * 1.15) / np.tanh(1.15)
    st /= np.max(np.abs(st)) / 0.89
    return st


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "song.wav"
    sf.write(out, build(), SR, subtype="PCM_24")
    print(f"wrote {out}: {CYCLES} x {CYCLE:.3f}s @ {BPM} BPM")
