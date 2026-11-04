"""Build the v5 script from the frozen v4 record without changing demo cues."""
import json
from pathlib import Path

base = Path(__file__).parent
cfg = json.loads((base / "narration-v4.json").read_text(encoding="utf-8"))
cfg["gap"] = 0.23
scenes = {scene["id"]: scene for scene in cfg["scenes"]}

scenes["s1"].update(lead=0.25, lines=[
    "Hard conversations rarely get a second take.",
    "DialogIQ lets you practice one.",
], beats=[
    "Hard conversations deserve a *second take.*",
    "Meet *DialogIQ.*",
])
scenes["s2"].update(lines=[
    "Say it badly. Rewind. Try again.",
], beats=[
    "Say it badly. *Rewind.* Try again.",
])
scenes["s3"].update(lines=[
    "Built by Pramodh and a team of AI agents.",
    "Powered by Meta's Muse Spark Open.",
    "Now meet Bob.",
], beats=[
    "Built by *Pramodh* and AI agents",
    "Powered by *Muse Spark Open*",
    "Now meet *Bob.*",
])
scenes["dtitle"]["silent"] = 1.5
scenes["arch"].update(lines=[
    "Bob runs on Muse Spark Open through Baseten.",
    "Local rules track stance. A separate judge counts needs uncovered.",
    "Fireworks hosts the coach. It sees the conversation, never Bob's hidden needs.",
])
scenes["stats"].update(lines=[
    "Do these hints fit the moment?",
    "In a small test graded by agents: fifty-two usable hints out of seventy-eight. Before, twenty-three.",
    "In one stop-request case, all six hints respected Bob's request.",
])
scenes["close"].update(lines=[
    "Same moment. Different first move.",
    "That is the power of practice.",
], beats=[
    "Same moment. *Different first move.*",
    "The power of *practice.*",
])
scenes["tag"].update(tail=0.5, lines=[
    "DialogIQ. Practice the conversation before it matters.",
    "Find the project on GitHub. Link below.",
])

(base / "narration-v5.json").write_text(
    json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
