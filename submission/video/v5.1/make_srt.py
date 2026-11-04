"""Build an SRT from the narration script (exact wording) and the generated voice files.

usage: python make_srt.py <narration.json> <timeline.json> <voice_dir> <out.srt>
Each caption starts at its line's start frame; it ends where speech in the scene
WAV actually stops (last non-silent sample before the next line), so captions
match the audio instead of ASR guesses. TTS spellings are mapped back for display.
"""
import json, sys, textwrap
import numpy as np
import soundfile as sf

FPS = 30
DISPLAY = {"Base Ten": "Baseten", "twenty-three": "23", "fifty-two": "52", "seventy-eight": "78",
           "said, can we stop? Every": 'said, "Can we stop?" Every'}
narr = json.load(open(sys.argv[1], encoding="utf-8"))
tl = {s["id"]: s for s in json.load(open(sys.argv[2]))}
voice_dir, out_path = sys.argv[3], sys.argv[4]


def ts(sec):
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def speech_end(audio, sr, a, b):
    """Last loud sample in [a, b) seconds, plus a little hold."""
    seg = np.abs(audio[int(a * sr): int(b * sr)])
    if seg.ndim > 1:
        seg = seg.max(axis=1)
    loud = np.nonzero(seg > 0.02)[0]
    return a + (loud[-1] / sr if len(loud) else (b - a)) + 0.25


cues, t0 = [], 0.0
for sc in narr["scenes"]:
    s = tl[sc["id"]]
    dur = s["frames"] / FPS
    if "silent" in sc:
        t0 += dur
        continue
    audio, sr = sf.read(f"{voice_dir}/{sc['id']}.wav")
    texts = [c["text"] for c in sc["cues"]] if "cues" in sc else sc["lines"]
    starts = [st / FPS for st in s["starts"]]
    for i, text in enumerate(texts):
        a = starts[i]
        b = starts[i + 1] if i + 1 < len(starts) else dur
        e = min(speech_end(audio, sr, a, b), b - 0.05)
        for k, v in DISPLAY.items():
            text = text.replace(k, v)
        # At most 2 lines of 42 chars per cue: split a long line into several cues,
        # breaking after punctuation where possible, timed in proportion to characters.
        parts, cur = [], ""
        for w in text.split(" "):
            trial = (cur + " " + w).strip()
            if len(textwrap.wrap(trial, 42)) > 2:
                # back up to the last clause break inside cur, if there is one
                cut = max(cur.rfind(", "), cur.rfind(". "), cur.rfind("? "))
                if cut > len(cur) // 3:
                    parts.append(cur[: cut + 1])
                    cur = (cur[cut + 2:] + " " + w).strip()
                else:
                    parts.append(cur)
                    cur = w
            else:
                cur = trial
        parts.append(cur)
        total = sum(len(x) for x in parts)
        t = a
        for x in parts:
            d = (e - a) * len(x) / total
            cues.append((t0 + t, t0 + t + d, "\n".join(textwrap.wrap(x, 42))))
            t += d
    t0 += dur

with open(out_path, "w", encoding="utf-8") as f:
    for n, (a, b, text) in enumerate(cues, 1):
        f.write(f"{n}\n{ts(a)} --> {ts(b)}\n{text}\n\n")
print("wrote", out_path, len(cues), "captions, ends", ts(t0))
