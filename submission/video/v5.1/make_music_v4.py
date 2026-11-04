"""Synthesize an original, punchy, upbeat background track (no samples, no copyright).

usage: python make_music_v4.py <seconds> <out.wav> <bpm> <drums_in> <drums_out> <resolve_at> [build_at ...]
v4: energy follows the story. Pad + plucks only before <drums_in> and after <drums_out>;
snare-roll builds end exactly at each build_at (plus drums_in); from <resolve_at> a held C chord
rings out to the end (no hard cut).
Bright pop/house feel: C - G - Am - F, four-on-the-floor kick, claps on 2 and 4,
off-beat open hats + 16th closed hats, side-chain "pumping" pad and bass, a
syncopated saw-ish lead hook every other 8 bars, snare-roll + noise-riser builds
into each 8-bar section. 2-bar pad-only intro, fade out at the end.
"""
import sys
import numpy as np
import soundfile as sf

SR = 44100
secs = float(sys.argv[1])
bpm = float(sys.argv[3])
DRUMS_IN, DRUMS_OUT, RESOLVE = (float(x) for x in sys.argv[4:7])
OFFSET = DRUMS_IN % (4 * 60.0 / bpm) - 4 * 60.0 / bpm  # bar grid anchored so a bar starts at DRUMS_IN
snap = lambda x: DRUMS_IN + round((x - DRUMS_IN) / (60.0 / bpm)) * (60.0 / bpm)
BUILDS = [DRUMS_IN] + [snap(float(x)) for x in sys.argv[7:]]
n = int(secs * SR)
beat = 60.0 / bpm
bar = 4 * beat
t_all = np.arange(n) / SR
rng = np.random.default_rng(23)
bus = {k: np.zeros((n, 2)) for k in ("drums", "music")}


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(name, sig, start, gain=1.0, pan=0.0):
    a = int(start * SR)
    if a >= n or a < 0:
        return
    b = min(n, a + len(sig))
    seg = sig[: b - a] * gain
    bus[name][a:b, 0] += seg * (1 - pan) / 2 * 2 ** 0.5
    bus[name][a:b, 1] += seg * (1 + pan) / 2 * 2 ** 0.5


def env_t(dur):
    return np.arange(int(dur * SR)) / SR


def saw(f, t, k=8):
    return sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, k + 1))


def kick():
    t = env_t(0.4)
    f = 48 + 110 * np.exp(-t / 0.025)
    click = np.exp(-t / 0.002) * 0.4
    return np.tanh(1.6 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16)) + click


def hp_noise(m, k):
    x = rng.standard_normal(m)
    return x - np.convolve(x, np.ones(k) / k, mode="same")


def clap():
    t = env_t(0.25)
    x = hp_noise(len(t), 10)
    env = sum(np.exp(-np.clip(t - d, 0, None) / 0.008) * (t >= d) for d in (0, 0.01, 0.02)) * 0.5 + np.exp(-t / 0.07) * (t >= 0.02)
    return x * env


def hat(open_=False):
    t = env_t(0.25 if open_ else 0.05)
    return hp_noise(len(t), 2) * np.exp(-t / (0.06 if open_ else 0.012))


def pluck(f, dur=0.3):
    t = env_t(dur)
    return saw(f, t, 6) * np.exp(-t / 0.09) * np.minimum(1, t / 0.003)


def lead(f, dur):
    t = env_t(dur)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.15)
    s = saw(f * vib, t, 7) * 0.6 + saw(f * 1.006 * vib, t, 7) * 0.4
    env = np.minimum(1, t / 0.01) * np.exp(-t / 0.5) * np.minimum(1, (dur - t) / 0.03)
    return s * env


def pad(notes, dur):
    t = env_t(dur)
    env = np.minimum(1, t / 0.2) * np.minimum(1, (dur - t) / 0.2)
    s = sum(saw(hz(m), t, 5) * 0.5 + saw(hz(m) * 1.004, t, 5) * 0.5 for m in notes)
    return env * s / len(notes)


def bass(f, dur):
    t = env_t(dur)
    s = np.sin(2 * np.pi * f * t) + 0.35 * saw(f, t, 4)
    return np.tanh(1.3 * s) * np.minimum(1, t / 0.004) * np.minimum(1, (dur - t) / 0.02)


def snare():
    t = env_t(0.15)
    return (hp_noise(len(t), 4) * 0.8 + np.sin(2 * np.pi * 190 * t) * 0.5) * np.exp(-t / 0.04)


prog = [  # bass root, pad voicing
    (36, [60, 64, 67, 72]),  # C
    (43, [59, 62, 67, 71]),  # G
    (45, [60, 64, 69, 72]),  # Am
    (41, [60, 65, 69, 72]),  # F
]
# 2-bar syncopated hook (in 8ths: midi or None)
hook = [76, None, 79, 76, None, 74, 72, None, 74, None, 76, None, 72, None, None, None]
arp = [0, 2, 1, 3, 2, 1, 3, 2]
bars = int(np.ceil((secs - OFFSET) / bar))
for i in range(bars):
    t0 = OFFSET + i * bar
    if t0 >= RESOLVE:
        break
    root, voicing = prog[i % 4]
    drums = DRUMS_IN <= t0 + 0.01 and t0 + bar <= DRUMS_OUT + 0.3
    soft = 1.0 if drums else 1.7
    add("music", pad(voicing, min(bar, RESOLVE - t0) + 0.05), t0, 0.07 * soft)
    for j in range(8):
        if t0 + j * beat / 2 < RESOLVE:
            add("music", pluck(hz(voicing[arp[j]] + 12)), t0 + j * beat / 2, 0.06 * soft, -0.4 if j % 2 else 0.4)
    if not drums:
        continue
    sec = int((t0 - DRUMS_IN) // (8 * bar))
    in_sec = int(round((t0 - DRUMS_IN) / bar)) % 8
    for k in range(8):
        if k % 2:
            add("music", bass(hz(root), beat / 2 * 0.9), t0 + k * beat / 2, 0.22)
    if sec % 2 == 1:
        half = in_sec % 2
        for j in range(8):
            m = hook[half * 8 + j]
            if m is not None:
                add("music", lead(hz(m), beat * 0.9), t0 + j * beat / 2, 0.07, 0.1)
    for k in range(4):
        add("drums", kick(), t0 + k * beat, 0.55)
        add("drums", hat(True), t0 + k * beat + beat / 2, 0.05, 0.3)
    for k in (1, 3):
        add("drums", clap(), t0 + k * beat, 0.16, -0.1)
    for k in range(16):
        add("drums", hat(), t0 + k * beat / 4, 0.03 if k % 2 else 0.018, -0.35)

# builds: a 2-beat snare roll + noise riser ending exactly at each build point
for b_at in BUILDS:
    st = b_at - 2 * beat
    for k in range(8):
        add("drums", snare(), st + k * beat / 4, 0.04 + 0.012 * k)
    m = int(2 * beat * SR)
    tr = np.arange(m) / m
    add("drums", hp_noise(m, 3) * tr ** 2, st, 0.05)

# resolve: one held C chord with a low root, ringing out to the end
dur = secs - RESOLVE
tt = env_t(dur)
ring = pad([48, 60, 64, 67, 72], dur) * np.exp(-tt / (dur * 1.5))
add("music", ring, RESOLVE, 0.15)
add("music", bass(hz(36), 1.2) * np.exp(-env_t(1.2) / 0.5), RESOLVE, 0.25)

# side-chain pump: duck the music bus on every beat after the intro
ph = ((t_all - OFFSET) % beat) / beat
pump = 1 - 0.45 * np.exp(-ph / 0.18)
pump[(t_all < DRUMS_IN) | (t_all >= DRUMS_OUT)] = 1
mix = bus["drums"] + bus["music"] * pump[:, None]
mix = np.tanh(mix * 1.2) / 1.2  # gentle glue saturation
fade = np.clip(np.minimum(t_all / 0.4, (secs - t_all) / 0.35), 0, 1)
mix *= fade[:, None]
mix /= np.abs(mix).max() / 0.89
sf.write(sys.argv[2], mix.astype(np.float32), SR)
print("wrote", sys.argv[2], f"{secs:.1f}s at {bpm:.0f} BPM")
