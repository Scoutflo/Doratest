"""Measure the beat grid of a song with numpy and cut a seamless 28-beat loop.

1. Onset envelope: log-magnitude spectral flux (full band + low band).
2. Tempo: autocorrelation of the envelope, then a fine period/phase search
   that maximises onset energy on the grid over the whole track.
3. Downbeat: of the four beat phases, the one with the most low-band
   (kick) energy plus harmonic change (chroma novelty).
4. Loop: 28 beats from the downbeat nearest --at; the audio that follows
   the cut is equal-power crossfaded into the head so the wrap is continuous
   (for a periodic source this is an exact no-op).

Usage: python3 analyze.py song.wav --at 14 --out-wav loop.wav --out-json grid.json
"""
import argparse
import json
import numpy as np
import soundfile as sf

HOP, NFFT = 256, 2048


def stft_mag(x, sr):
    win = np.hanning(NFFT)
    pad = np.pad(x, (NFFT // 2, NFFT // 2))
    n = 1 + (len(pad) - NFFT) // HOP
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(pad[idx] * win, axis=1)), np.fft.rfftfreq(NFFT, 1 / sr)


def flux(S, band=None, freqs=None):
    L = np.log1p(100 * S)
    if band is not None:
        L = L[:, (freqs >= band[0]) & (freqs < band[1])]
    d = np.maximum(np.diff(L, axis=0, prepend=L[:1]), 0).sum(1)
    d -= np.convolve(d, np.ones(16) / 16, mode="same")  # local mean removal
    return np.maximum(d, 0)


def chroma(S, freqs):
    C = np.zeros((S.shape[0], 12))
    ok = (freqs > 60) & (freqs < 4000)
    pc = (np.round(12 * np.log2(freqs[ok] / 440.0)) % 12).astype(int)
    for k in range(12):
        C[:, k] = S[:, ok][:, pc == k].sum(1)
    return C / (C.sum(1, keepdims=True) + 1e-9)


def grid_score(env, fps, period, phase):
    t = np.arange(phase, len(env) / fps, period)
    f = t * fps
    i = np.floor(f).astype(int)
    w = f - i
    ok = i + 1 < len(env)
    return float(np.sum(env[i[ok]] * (1 - w[ok]) + env[i[ok] + 1] * w[ok]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("song")
    ap.add_argument("--at", type=float, default=14.0, help="approx loop start (s)")
    ap.add_argument("--beats", type=int, default=28)
    ap.add_argument("--xfade", type=float, default=0.35)
    ap.add_argument("--fps", type=int, default=60, help="snap loop length to whole video frames")
    ap.add_argument("--out-wav", default="loop.wav")
    ap.add_argument("--out-json", default="grid.json")
    a = ap.parse_args()

    x, sr = sf.read(a.song, always_2d=True)
    mono = x.mean(1)
    S, freqs = stft_mag(mono, sr)
    fps = sr / HOP
    env = flux(S)
    env_lo = flux(S, (30, 150), freqs)
    env /= env.max()
    env_lo /= env_lo.max()

    # --- tempo by autocorrelation (60-180 BPM, mild prior at 120) ---
    e = env - env.mean()
    ac = np.correlate(e, e, "full")[len(e) - 1:]
    lags = np.arange(len(ac))
    bpm = 60 * fps / np.maximum(lags, 1)
    prior = np.exp(-0.5 * (np.log2(bpm / 120) / 0.6) ** 2)
    band = (bpm > 60) & (bpm < 180)
    L = int(lags[band][np.argmax((ac * prior)[band])])
    y0, y1, y2 = ac[L - 1], ac[L], ac[L + 1]
    L_ref = L + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)
    period0 = L_ref / fps

    # --- fine period + phase search over the whole track ---
    # the kick band anchors the phase so offbeat hats/bass can't win
    env_ph = 0.4 * env + env_lo
    best = (-1, period0, 0)
    for p in np.linspace(period0 * 0.995, period0 * 1.005, 201):
        for ph in np.linspace(0, p, 200, endpoint=False):
            s = grid_score(env_ph, fps, p, ph)
            if s > best[0]:
                best = (s, p, ph)
    _, period, phase = best
    # sub-sample phase refinement
    for step in (period / 400, period / 4000):
        cands = phase + step * np.arange(-10, 11)
        phase = cands[np.argmax([grid_score(env_ph, fps, period, c) for c in cands])]
    phase %= period

    # --- snap phase to measured waveform transients (flux leads by ~NFFT/2) ---
    def transient_offsets(ph):
        out = []
        for t in np.arange(ph, len(mono) / sr, period)[2:-2]:
            i0, i1 = int((t - 0.04) * sr), int((t + 0.04) * sr)
            seg = np.abs(mono[i0:i1])
            out.append((i0 + int(np.argmax(seg > 0.5 * seg.max()))) / sr - t)
        return np.array(out)
    phase = (phase + float(np.median(transient_offsets(phase)))) % period
    beats = np.arange(phase, len(mono) / sr - 1e-3, period)

    # --- downbeat: kick energy + chord-change novelty per beat phase ---
    C = chroma(S, freqs)
    def at(sig, t):
        i = np.clip(np.round(t * fps).astype(int), 0, len(sig) - 1)
        return sig[i]
    # harmonic change: chroma of the 2 beats before vs the 2 beats after
    def cwin(t0, t1):
        i0, i1 = max(0, int(t0 * fps)), max(1, int(t1 * fps))
        v = C[i0:i1].mean(0)
        return v / (np.linalg.norm(v) + 1e-9)
    nov_b = np.array([1 - cwin(t - 2 * period, t) @ cwin(t, t + 2 * period) for t in beats])
    lo_b = np.array([env_lo[max(0, int(t * fps) - 2): int(t * fps) + 4].max() for t in beats])
    ok = (beats > 2 * period) & (beats < beats[-1] - 2 * period)
    scores = [nov_b[m::4][ok[m::4]].mean() / nov_b[ok].mean()
              + 0.5 * lo_b[m::4].mean() / lo_b.mean() for m in range(4)]
    m = int(np.argmax(scores))
    downbeats = beats[m::4]

    # --- measured transient offsets (waveform peak near each beat) ---
    offs = transient_offsets(phase) * 1000

    # --- cut the loop ---
    start = float(downbeats[np.argmin(np.abs(downbeats - a.at))])
    measured_period = period
    length = round(a.beats * period * a.fps) / a.fps   # whole frames, so A/V wrap together
    period = length / a.beats                          # grid used downstream (drift < 1 ms)
    s0, n = int(round(start * sr)), int(round(length * sr))
    X = int(a.xfade * sr)
    seg = x[s0:s0 + n].copy()
    tail = x[s0 + n:s0 + n + X]
    if len(tail) == X:
        r = np.sin(0.5 * np.pi * np.linspace(0, 1, X))[:, None]
        seg[:X] = tail * np.cos(0.5 * np.pi * np.linspace(0, 1, X))[:, None] + seg[:X] * r
    sf.write(a.out_wav, seg, sr, subtype="PCM_24")

    rel = np.arange(a.beats) * period
    grid = {
        "source": a.song, "bpm": 60 / period, "period": period,
        "measured_bpm": 60 / measured_period, "frames": round(length * a.fps), "fps": a.fps,
        "loop_start": start, "loop_length": length, "beats_in_loop": len(rel),
        "beats": [round(float(b), 6) for b in rel],
        "downbeat_phase": m, "downbeat_scores": [round(s, 4) for s in scores],
        "transient_offset_ms": {"median": float(np.median(offs)), "mean": float(offs.mean()), "std": float(offs.std()),
                                "max_abs": float(np.abs(offs).max())},
    }
    json.dump(grid, open(a.out_json, "w"), indent=1)
    print(f"measured BPM {grid['measured_bpm']:.3f} -> grid BPM {grid['bpm']:.3f}  period {period*1000:.2f} ms  phase {phase*1000:.1f} ms")
    print(f"downbeat phase {m} scores {grid['downbeat_scores']}")
    print(f"loop {start:.4f}s + {length:.4f}s ({len(rel)} beats)")
    print(f"transient vs grid: median {np.median(offs):+.2f} ms, std {offs.std():.2f} ms")


if __name__ == "__main__":
    main()
