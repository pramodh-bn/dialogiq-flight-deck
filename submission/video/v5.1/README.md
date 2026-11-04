# DialogIQ presentation v5.1

This is the accepted 2:01.5 DialogIQ video and its editable Remotion source.
The real app recording in `public/demo-v3.mp4` plays at its original speed;
Bob's replies are unchanged. The source includes the recorded voice WAVs,
photos, original synthesized music and sound effects, narration timings,
caption sidecar and final MP4. The dashboard's placeholder widgets are not
presented as measured user results.

## Watch or upload

- `out/DialogIQ-presentation-v5.1.mp4`: 1920×1080, 30 fps, H.264/AAC.
- `out/DialogIQ-presentation-v5.1.srt`: selectable caption sidecar (29 cues).

The MP4 SHA-256 is
`51ce59973cc72b53d28383b9cc1b7e921d9286f74d37748c17295c362593280d`.
Measured final audio is −14.1 LUFS and −2.3 dBTP. See `QA.md` for checks
and limits.

## Rebuild from included assets

Use Node 26.13.0, npm 11.20.0, FFmpeg, and Python 3.12. The checked-in voice,
music and effects WAVs make this path local and independent of a live model or
provider key. Run in this directory:

```powershell
npm ci --ignore-scripts
npm run render -- --browser-executable='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
py -3.12 mix_v5.py 'C:\path\to\ffmpeg.exe'
& 'C:\path\to\ffmpeg.exe' -v error -y -i out/DialogIQ-presentation-v5.1-rebuild-fulltail.mp4 -t 121.5 -c copy -movflags +faststart out/DialogIQ-presentation-v5.1-rebuild.mp4
```

The trimmed `-rebuild.mp4` file is the viewing-length output. Rebuilding leaves
the checked-in final untouched. The command above uses the Edge path on this
machine; change it to your local Chromium/Edge path.

The Python scripts and `narration-v4.json` are included for editing the spoken
script, voice, music and effects. Regenerating the voice requires the local
Kokoro ONNX model and voices file plus `kokoro-onnx`; those model weights are
not checked in. The cached voice files are sufficient to rebuild this cut.
The recorded demo itself is a real app capture with shortened waits labeled
on-screen; rebuilding the video does not rerun the app or incur paid calls.
