// Voice activity detection from microphone loudness. The decision logic is a
// plain function of (level, time) so it can be tested without a microphone.

export type VadConfig = {
  // RMS level (0..1) that counts as voice when silent, and the lower level
  // that keeps a started segment going.
  startLevel: number;
  keepLevel: number;
  // Voice must persist this long before a segment starts.
  startMs: number;
  // Silence must persist this long before a segment ends.
  endMs: number;
};

// Recorded with the rep screen as the v3-r1 client thresholds.
export const VAD_DEFAULTS: VadConfig = {
  startLevel: 0.02,
  keepLevel: 0.012,
  startMs: 120,
  endMs: 600,
};

export type Vad = {
  // Feed one loudness sample taken at time tMs.
  push(level: number, tMs: number): void;
  readonly speaking: boolean;
  // Close an open segment, for example when the rep ends.
  stop(tMs: number): void;
};

// onStart receives the time the voice first rose; onEnd the time it was last heard.
export function createVad(
  onStart: (tMs: number) => void,
  onEnd: (tMs: number) => void,
  config: VadConfig = VAD_DEFAULTS,
): Vad {
  let speaking = false;
  let riseAt: number | null = null;
  let lastVoiceAt = 0;

  return {
    get speaking() {
      return speaking;
    },
    push(level, tMs) {
      if (!speaking) {
        if (level < config.startLevel) {
          riseAt = null;
          return;
        }
        riseAt ??= tMs;
        lastVoiceAt = tMs;
        if (tMs - riseAt >= config.startMs) {
          speaking = true;
          onStart(riseAt);
          riseAt = null;
        }
        return;
      }
      if (level >= config.keepLevel) {
        lastVoiceAt = tMs;
      } else if (tMs - lastVoiceAt >= config.endMs) {
        speaking = false;
        onEnd(lastVoiceAt);
      }
    },
    stop(tMs) {
      riseAt = null;
      if (!speaking) return;
      speaking = false;
      onEnd(Math.min(tMs, lastVoiceAt));
    },
  };
}

export function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

export type Mic = { stop(): void };

// Opens the microphone and reports its loudness about fifty times a second.
// The audio stays in the browser; nothing here records or uploads it.
export async function openMic(onLevel: (level: number) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  // setInterval, not requestAnimationFrame: frames stop when the tab is hidden.
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    onLevel(rms(samples));
  }, 20);
  return {
    stop() {
      window.clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}
