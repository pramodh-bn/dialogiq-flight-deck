"""Generate narration WAVs with Kokoro (local) and a scene timeline for Remotion.

usage: python make_voice.py <kokoro.onnx> <voices.bin> [narration.json] [voice_dir] [timeline.json]
Writes <voice_dir>/<scene>.wav and a timeline (scene frames + per-line start frames).
Defaults: narration.json, public/voice, src/timeline.json.
"""
import json, os, re, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

SR, FPS = 24000, 30
NARR = sys.argv[3] if len(sys.argv) > 3 else "narration.json"
VOICE_DIR = sys.argv[4] if len(sys.argv) > 4 else "public/voice"
TIMELINE = sys.argv[5] if len(sys.argv) > 5 else "src/timeline.json"
cfg = json.load(open(NARR, encoding="utf-8"))
k = Kokoro(sys.argv[1], sys.argv[2])
os.makedirs(VOICE_DIR, exist_ok=True)

PRON = cfg.get("pronounce", {})

def speak(text):
    """Speak text; words in PRON are spliced in as exact IPA phonemes."""
    hits = [w for w in PRON if w in text]
    if hits:
        pattern = "(" + "|".join(map(re.escape, hits)) + ")"
        pieces = [part.strip() for part in re.split(pattern, text) if part.strip()]
        phon = " ".join(PRON[p] if p in PRON else k.tokenizer.phonemize(p, "en-us") for p in pieces)
        audio, sr = k.create(phon, voice=cfg["voice"], speed=cfg.get("speed", 1.0), is_phonemes=True)
    else:
        audio, sr = k.create(text, voice=cfg["voice"], speed=cfg.get("speed", 1.0), lang="en-us")
    assert sr == SR
    return audio.astype(np.float32)

silence = lambda s: np.zeros(int(s * SR), np.float32)
timeline, problems = [], []
for sc in cfg["scenes"]:
    if "silent" in sc:  # visual-only beat
        audio, starts = silence(sc["silent"]), []
    elif "cues" in sc:  # place cues at fixed times inside the demo clip
        total = sc.get("length", 58.5)
        track = silence(total)
        cues = sc["cues"]
        starts = [round(c["at"] * FPS) for c in cues]
        for i, cue in enumerate(cues):
            a = speak(cue["text"])
            start = int(cue["at"] * SR)
            end_limit = cues[i + 1]["at"] if i + 1 < len(cues) else total
            dur = len(a) / SR
            if cue["at"] + dur > end_limit + 0.05:
                problems.append(f"{sc['id']} cue {i} '{cue['text'][:30]}' {dur:.2f}s overruns by {cue['at'] + dur - end_limit:.2f}s")
            if start + len(a) > len(track):
                track = np.concatenate([track, silence((start + len(a) - len(track)) / SR + 0.5)])
            track[start:start + len(a)] += a
        audio = track
    else:
        parts = [silence(sc.get("lead", 0.5))]
        starts = []
        gap = sc.get("gap", cfg.get("gap", 0.45))
        for line in sc["lines"]:
            starts.append(round(sum(len(p) for p in parts) / SR * FPS))
            parts += [speak(line), silence(gap)]
        parts.append(silence(sc.get("tail", 0.7)))
        audio = np.concatenate(parts)
    sf.write(f"{VOICE_DIR}/{sc['id']}.wav", audio, SR)
    secs = len(audio) / SR
    timeline.append({"id": sc["id"], "visual": sc["visual"], "frames": int(np.ceil(secs * FPS)), "starts": starts})
    print(f"{sc['id']:6s} {secs:6.1f}s")
json.dump(timeline, open(TIMELINE, "w"), indent=1)
print("TOTAL", round(sum(t["frames"] for t in timeline) / FPS, 1), "s")
print("\n".join(problems) or "no cue overruns")
