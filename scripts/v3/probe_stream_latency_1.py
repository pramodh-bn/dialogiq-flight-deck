"""Bounded streaming latency probe. Prints timings only, never keys or env values."""

import json
import pathlib
import sys
import time

from openai import OpenAI

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

BASETEN = ("https://inference.baseten.co/v1", "BASETEN_API_KEY")
FIREWORKS = ("https://api.fireworks.ai/inference/v1", "FIREWORKS_API_KEY")
CASES = [
    (
        "baseten muse-spark-open-1026 default",
        BASETEN,
        "meta-models/muse-spark-open-1026",
        None,
    ),
    (
        "baseten muse-spark-open-1026 low",
        BASETEN,
        "meta-models/muse-spark-open-1026",
        "low",
    ),
    (
        "fireworks muse-spark-open low",
        FIREWORKS,
        "accounts/fireworks/models/muse-spark-open",
        "low",
    ),
    (
        "baseten DeepSeek-V4.1-Flash-Fast",
        BASETEN,
        "deepseek-ai/DeepSeek-V4.1-Flash-Fast",
        None,
    ),
    (
        "fireworks glm-5p3-fast",
        FIREWORKS,
        "accounts/fireworks/routers/glm-5p3-fast",
        None,
    ),
    (
        "fireworks gpt-oss-120b low",
        FIREWORKS,
        "accounts/fireworks/models/gpt-oss-120b",
        "low",
    ),
]
RUNS = 3
results = []
for label, (base, keyname), model, effort in CASES:
    client = OpenAI(base_url=base, api_key=env[keyname], max_retries=0, timeout=60)
    for run in range(RUNS):
        kwargs = {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": USER},
            ],
            "max_tokens": 200,
            "temperature": 0.7,
            "stream": True,
        }
        if effort:
            kwargs["reasoning_effort"] = effort
        start = time.perf_counter()
        first = None
        sentence = None
        text = ""
        error = None
        try:
            for chunk in client.chat.completions.create(**kwargs):
                if not chunk.choices:
                    continue
                piece = chunk.choices[0].delta.content or ""
                if piece and first is None:
                    first = time.perf_counter() - start
                text += piece
                if sentence is None and any(p in text for p in ".?!"):
                    sentence = time.perf_counter() - start
        except Exception as e:  # noqa: BLE001
            error = f"{type(e).__name__}: {str(e)[:160]}"
        total = time.perf_counter() - start
        row = {
            "case": label,
            "run": run + 1,
            "first_content_s": round(first, 2) if first else None,
            "first_sentence_s": round(sentence, 2) if sentence else None,
            "total_s": round(total, 2),
            "chars": len(text),
            "error": error,
        }
        results.append(row)
        print(json.dumps(row), flush=True)
        if run == 0:
            print("   sample:", text[:160].replace("\n", " "), flush=True)
pathlib.Path(sys.argv[2]).write_text(json.dumps(results, indent=1), encoding="utf-8")
