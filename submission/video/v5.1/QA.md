# v5.1 verification (Codex, 2026-11-04)

- Source demo copied byte for byte; SHA-256 matches `dialogiq-video/public/demo-v3.mp4`.
- Remotion rendered 3,652 frames. The final MP4 decodes end to end with FFmpeg exit code 0.
- Final duration 2:01.5, 1920×1080, 30 fps, H.264 video, AAC stereo audio.
- Encoded final audio measured −14.1 LUFS integrated and −2.3 dBTP with FFmpeg `ebur128=peak=true`. `silencedetect=noise=-35dB:d=0.4` reported no interval.
- SRT sidecar has 29 cues; each is at most two lines of at most 42 characters. Captions are not embedded in the MP4.
- Inspected frames decoded from the final MP4 at 0:40.6 (Guarded quote/meter), 1:04.4 (Warming quote/meter), 1:12.9 (complete final Bob reply), 1:24.9 (architecture), and 2:01.45 (full logo/CTA).
- The two pull quotes are exact excerpts of Bob's recorded replies. The original response text in the demo remains intact.
- Spoken proper names should be checked by a human listener. Diagnostic ASR hears “Promote” for Pramodh and “Bassetton” for Baseten; spelling on screen and in the SRT is correct.
- No live provider calls were made during this edit.
- The checked-in source was dependency-installed and an example frame rendered with local Edge; the full video was not rerendered from the checked-in copy.
