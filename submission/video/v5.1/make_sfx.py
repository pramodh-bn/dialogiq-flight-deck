"""Synthesize the v3 sound-effects track, aligned to the v3 timeline (original, no samples).

usage: python make_sfx.py <timeline-v3.json> <Presentation3.tsx> <out.wav> [--minimal]
--minimal: no transition whooshes, riser or beat/label pops (stats ticks + chime only)
- soft whoosh at each scene cut, riser into the demo title
- gentle pop on each kinetic-text beat and each demo label chip
- ticks while the stats counter climbs, a brighter pop when 6/6 lands
- warm chime on the closing logo
"""
import json, re, sys
import numpy as np
import soundfile as sf

SR = 44100
FPS = 30
timeline = json.load(open(sys.argv[1]))
tsx = open(sys.argv[2], encoding="utf-8").read()
total = sum(s["frames"] for s in timeline) / FPS
n = int((total + 1) * SR)
out = np.zeros((n, 2))
rng = np.random.default_rng(5)
MINIMAL = "--minimal" in sys.argv
# --stats a,b,c: counter runs scene frames a..b, 6/6 lands at c (v3 default 30,105,135)
STATS = next((tuple(int(v) for v in x.split("=")[1].split(",")) for x in sys.argv if x.startswith("--stats=")), (30, 105, 135))


def add(sig, t, gain, pan=0.0):
    a = int(t * SR)
    if a < 0 or a >= n:
        return
    b = min(n, a + len(sig))
    out[a:b, 0] += sig[: b - a] * gain * (1 - pan) / 2 * 2 ** 0.5
    out[a:b, 1] += sig[: b - a] * gain * (1 + pan) / 2 * 2 ** 0.5


def lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def whoosh(dur=0.55):
    m = int(dur * SR)
    t = np.arange(m) / SR
    x = rng.standard_normal(m)
    # sweep: blend from dark to bright noise and back
    dark, bright = lowpass(x, 40), x - lowpass(x, 6)
    mix = np.sin(np.pi * t / dur)
    env = np.sin(np.pi * t / dur) ** 2
    return env * (dark * (1 - mix) + 0.35 * bright * mix)


def riser(dur=1.6):
    m = int(dur * SR)
    t = np.arange(m) / SR
    f = 220 * (4 ** (t / dur))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR)
    noise = rng.standard_normal(m) - lowpass(rng.standard_normal(m), 8)
    env = (t / dur) ** 2
    return env * (0.5 * tone + 0.25 * noise)


def pop(f=880, dur=0.12):
    t = np.arange(int(dur * SR)) / SR
    fr = f * (1 + 0.6 * np.exp(-t / 0.01))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t / 0.03) * np.minimum(1, t / 0.002)


def tick():
    t = np.arange(int(0.03 * SR)) / SR
    return np.sin(2 * np.pi * 2400 * t) * np.exp(-t / 0.006)


def chime(dur=2.5):
    t = np.arange(int(dur * SR)) / SR
    s = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in ((523.25, 1, 0.9), (783.99, 0.6, 0.7), (1046.5, 0.35, 0.5)))
    return s * np.minimum(1, t / 0.005)


starts = {}
acc = 0
for s in timeline:
    starts[s["id"]] = acc
    acc += s["frames"]

for s in ([] if MINIMAL else timeline):
    t0 = starts[s["id"]] / FPS
    if s["id"] != "dtitle":
        add(whoosh(), t0 - 0.25, 0.22)
    if s["visual"] in ("hook", "reframe", "intro", "close"):
        for i, st in enumerate(s["starts"]):
            add(pop(660 + 110 * (i % 3)), t0 + st / FPS, 0.10, -0.2 if i % 2 else 0.2)

# riser into the demo title, then a pop on each title line
dt = starts["dtitle"] / FPS
if not MINIMAL:
    add(riser(), dt - 1.6, 0.12)
    add(pop(990), dt, 0.14)
    add(pop(1320), dt + 9 / FPS, 0.12)

# demo label chips
d0 = starts["demo"] / FPS
for m in ([] if MINIMAL else re.finditer(r"\{ t: ([\d.]+), d: [\d.]+, text:", tsx)):
    add(pop(740, 0.1), d0 + float(m.group(1)), 0.08)

# stats counter ticks (23 -> 52 over frames 30..105) and the 6/6 pop
s0 = starts["stats"]
a, b, c = STATS
for k in range(29):
    add(tick(), (s0 + a + k * (b - a) / 29) / FPS, 0.06, 0.15 * np.sin(k))
add(pop(1175, 0.18), (s0 + b) / FPS, 0.12)
add(pop(1568, 0.2), (s0 + c) / FPS, 0.14)

add(chime(), starts["tag"] / FPS + 0.1, 0.14)

out /= max(1.0, np.abs(out).max() / 0.9)
sf.write(sys.argv[3], out.astype(np.float32), SR)
print("wrote", sys.argv[3], f"{total:.1f}s")
