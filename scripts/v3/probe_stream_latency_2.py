"""Second bounded latency probe (max 12 calls). Prints timings and error messages only."""

import json
import pathlib
import sys
import time

from openai import APIStatusError, OpenAI

env = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")

SYSTEM = (
    "You are Bob, a guarded software engineer who missed his Q3 deadlines. You are "
    "in a one-to-one with your new manager. Reply in character, in one or two short "
    "spoken sentences. No stage directions."
)
USER = "Bob, what's been making delivery harder for you this quarter?"
MESSAGES = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": USER}]

BASETEN = ("https://inference.baseten.co/v1", "BASETEN_API_KEY")
FIREWORKS = ("https://api.fireworks.ai/inference/v1", "FIREWORKS_API_KEY")
calls = 0
results = []


def run(label, provider, model, stream=True, **extra):
    global calls
    if calls >= 12:
        print("cap reached; skipping", label)
        return None
    calls += 1
    base, keyname = provider
    client = OpenAI(base_url=base, api_key=env[keyname], max_retries=0, timeout=90)
    kwargs = dict(
        model=model, messages=MESSAGES, temperature=0.7, stream=stream, **extra
    )
    start = time.perf_counter()
    first_reason = first = sentence = None
    text = ""
    reason_chars = 0
    error = None
    try:
        resp = client.chat.completions.create(**kwargs)
        if stream:
            for chunk in resp:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                r = getattr(delta, "reasoning_content", None) or getattr(
                    delta, "reasoning", None
                )
                if r:
                    reason_chars += len(r)
                    if first_reason is None:
                        first_reason = time.perf_counter() - start
                piece = delta.content or ""
                if piece and first is None:
                    first = time.perf_counter() - start
                text += piece
                if sentence is None and any(p in text for p in ".?!"):
                    sentence = time.perf_counter() - start
        else:
            text = resp.choices[0].message.content or ""
    except APIStatusError as e:
        body = ""
        try:
            body = json.dumps(e.response.json())[:300]
        except Exception:  # noqa: BLE001
            body = e.response.text[:300]
        error = f"{e.status_code}: {body}"
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {str(e)[:200]}"
    total = time.perf_counter() - start
    r2 = lambda x: round(x, 2) if x is not None else None
    row = {
        "case": label,
        "first_reasoning_s": r2(first_reason),
        "first_content_s": r2(first),
        "first_sentence_s": r2(sentence),
        "total_s": r2(total),
        "chars": len(text),
        "reasoning_chars": reason_chars,
        "error": error,
    }
    results.append(row)
    print(json.dumps(row), flush=True)
    if text:
        print("   sample:", text[:140].replace("\n", " "), flush=True)
    return row


MUSE_B = "meta-models/muse-spark-open-1026"
a = run("baseten muse nonstream bare", BASETEN, MUSE_B, stream=False)
b = run("baseten muse stream bare", BASETEN, MUSE_B)
if b and not b["error"]:
    run("baseten muse stream bare", BASETEN, MUSE_B)
    run("baseten muse stream bare", BASETEN, MUSE_B)
    run("baseten muse stream max512", BASETEN, MUSE_B, max_tokens=512)
elif a and not a["error"]:
    run("baseten muse nonstream bare", BASETEN, MUSE_B, stream=False)
    run("baseten muse nonstream bare", BASETEN, MUSE_B, stream=False)
for _ in range(3):
    run(
        "fireworks muse-spark-open low 2048",
        FIREWORKS,
        "accounts/fireworks/models/muse-spark-open",
        max_tokens=2048,
        reasoning_effort="low",
    )
for _ in range(3):
    run(
        "fireworks glm-5p3-fast 2048",
        FIREWORKS,
        "accounts/fireworks/routers/glm-5p3-fast",
        max_tokens=2048,
    )
pathlib.Path(sys.argv[2]).write_text(json.dumps(results, indent=1), encoding="utf-8")
print("calls:", calls)
