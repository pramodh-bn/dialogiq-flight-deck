"""Read-only model listing for the provider accounts. Prints ids only, never keys."""

import json
import pathlib
import sys
import urllib.request

env = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")


def get(url, key):
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {key}", "User-Agent": "model-list/1.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as e:  # noqa: BLE001
        return {"error": f"{type(e).__name__}: {str(e)[:200]}"}


targets = [
    ("fireworks", "https://api.fireworks.ai/inference/v1/models", "FIREWORKS_API_KEY"),
    ("baseten", "https://inference.baseten.co/v1/models", "BASETEN_API_KEY"),
]
if env.get("META_MODEL_API_BASE"):
    targets.append(
        (
            "meta",
            env["META_MODEL_API_BASE"].rstrip("/") + "/models",
            "META_MODEL_API_KEY",
        )
    )
for name, url, keyname in targets:
    if not env.get(keyname):
        print(name, "no key")
        continue
    data = get(url, env[keyname])
    if "error" in data:
        print(name, "ERROR", data["error"])
        continue
    items = data.get("data", data.get("models", []))
    print(f"== {name}: {len(items)} models")
    for m in items:
        extra = {
            k: m[k]
            for k in (
                "kind",
                "type",
                "supports_chat",
                "supports_image_input",
                "context_length",
            )
            if isinstance(m, dict) and k in m
        }
        print("  ", m.get("id") if isinstance(m, dict) else m, extra or "")
