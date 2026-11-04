"""Mix the rendered voice with original music/SFX and verify encoded delivery audio."""
import re
import subprocess
import sys
from pathlib import Path

ff = sys.argv[1]
base = Path(__file__).parent
out = base / "out"
video = out / "DialogIQ-presentation-v5.1-voice.mp4"
premix = out / "DialogIQ-presentation-v5.1-premix.wav"
final = out / "DialogIQ-presentation-v5.1-rebuild-fulltail.mp4"

subprocess.run([
    ff, "-v", "error", "-y", "-i", str(video),
    "-i", str(out / "sfx-v5.wav"), "-i", str(out / "music-v5.wav"),
    "-filter_complex",
    "[0:a]aresample=48000,highpass=f=80,acompressor=threshold=0.1:ratio=2.5:attack=10:release=200,asplit=2[voice][sc];"
    "[1:a]aresample=48000,volume=0.85[fx];"
    "[2:a]aresample=48000,volume=0.10[bed];"
    "[bed][sc]sidechaincompress=threshold=0.015:ratio=4:attack=30:release=450[ducked];"
    "[voice][fx][ducked]amix=inputs=3:normalize=0:duration=first[mix]",
    "-map", "[mix]", str(premix),
], check=True)

meter = subprocess.run([
    ff, "-hide_banner", "-i", str(premix), "-af", "ebur128", "-f", "null", "-"
], capture_output=True, text=True, check=True).stderr
match = re.findall(r"Summary:\s+Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS", meter)
if not match:
    raise RuntimeError("Unable to measure premix loudness")
gain = -13 - float(match[-1])
print(f"Premix: {match[-1]} LUFS; gain: {gain:+.2f} dB", flush=True)
subprocess.run([
    ff, "-v", "error", "-y", "-i", str(video), "-i", str(premix),
    "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    "-af", f"volume={gain}dB,alimiter=limit=0.74:level=disabled",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(final),
], check=True)
print(f"Wrote {final}", flush=True)
