// Browser speech: recognition for the learner, synthesis for Bob. Both are
// behind small interfaces so the rep controller can be tested with stand-ins.

export type Speaker = {
  // Queue one sentence. The first sentence of a reply starts the audio.
  say(text: string): void;
  // No more sentences belong to this reply; onEnd fires when the queue drains.
  close(): void;
  // Stop now. onEnd fires with interrupted = true if audio was playing.
  cancel(): void;
  onStart: (() => void) | null;
  onEnd: ((interrupted: boolean) => void) | null;
};

type Engine = {
  // Speak one sentence and resolve when it ends.
  speak(text: string): Promise<void>;
  stop(): void;
};

// Queue logic shared by the real and the silent speaker.
export function createQueuedSpeaker(engine: Engine): Speaker {
  let queue: string[] = [];
  let playing = false;
  let closed = true;
  let generation = 0;

  const speaker: Speaker = {
    onStart: null,
    onEnd: null,
    say(text) {
      if (closed && !playing) {
        closed = false;
        queue = [];
      }
      queue.push(text);
      if (!playing) void run();
    },
    close() {
      closed = true;
    },
    cancel() {
      const wasPlaying = playing;
      generation += 1;
      queue = [];
      playing = false;
      closed = true;
      engine.stop();
      if (wasPlaying) speaker.onEnd?.(true);
    },
  };

  async function run() {
    const mine = generation;
    playing = true;
    speaker.onStart?.();
    for (;;) {
      const next = queue.shift();
      if (next !== undefined) {
        await engine.speak(next);
      } else if (closed) {
        break;
      } else {
        // The reply is still streaming: wait for the next sentence.
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      if (mine !== generation) return;
    }
    playing = false;
    speaker.onEnd?.(false);
  }

  return speaker;
}

export function speechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  return (
    voices.find(
      (v) => /male|david|mark|daniel|guy|george/i.test(v.name) && !/female/i.test(v.name),
    ) ??
    voices[0] ??
    null
  );
}

// Bob's voice through the browser's built-in speech synthesis.
export function createBrowserSpeaker(): Speaker {
  const synth = window.speechSynthesis;
  let settle: (() => void) | null = null;
  return createQueuedSpeaker({
    speak(text) {
      return new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = pickVoice();
        if (voice) utterance.voice = voice;
        utterance.lang = voice?.lang ?? "en-US";
        // Some browsers never fire `end`; do not let one sentence hang the rep.
        const guard = window.setTimeout(done, 4000 + text.length * 120);
        function done() {
          window.clearTimeout(guard);
          if (settle === done) settle = null;
          resolve();
        }
        settle = done;
        utterance.onend = done;
        utterance.onerror = done;
        synth.speak(utterance);
      });
    },
    stop() {
      synth.cancel();
      settle?.();
    },
  });
}

// When speech synthesis is unavailable Bob's reply is text only. Each sentence
// is held for a reading time so the rep still has a Bob segment to time.
export function createSilentSpeaker(msPerChar = 55): Speaker {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settle: (() => void) | null = null;
  return createQueuedSpeaker({
    speak(text) {
      return new Promise<void>((resolve) => {
        settle = resolve;
        timer = setTimeout(resolve, Math.max(400, text.length * msPerChar));
      });
    },
    stop() {
      if (timer) clearTimeout(timer);
      settle?.();
    },
  });
}

export type Recognizer = { start(): void; stop(): void };

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  abort(): void;
};

function recognitionConstructor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as Record<string, unknown>;
  return (scope["SpeechRecognition"] ?? scope["webkitSpeechRecognition"] ?? null) as
    (new () => Recognition) | null;
}

export function speechRecognitionSupported(): boolean {
  return recognitionConstructor() !== null;
}

// Continuous browser speech recognition. The browser vendor's service receives
// the audio; the rep screen says so before the first rep.
export function createRecognizer(handlers: {
  onFinal(text: string): void;
  onInterim(text: string): void;
  onError(code: string): void;
}): Recognizer | null {
  const Constructor = recognitionConstructor();
  if (!Constructor) return null;
  let wanted = false;
  let current: Recognition | null = null;

  function open() {
    const recognition = new Constructor!();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]!;
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          if (text) handlers.onFinal(text);
        } else {
          interim += `${text} `;
        }
      }
      handlers.onInterim(interim.trim());
    };
    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are routine; the session is reopened below.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") wanted = false;
      if (event.error !== "no-speech" && event.error !== "aborted") handlers.onError(event.error);
    };
    // Browsers end a continuous session after a while; reopen it while wanted.
    recognition.onend = () => {
      if (current !== recognition) return;
      current = null;
      if (wanted) open();
    };
    current = recognition;
    try {
      recognition.start();
    } catch {
      current = null;
    }
  }

  return {
    start() {
      if (wanted) return;
      wanted = true;
      open();
    },
    stop() {
      wanted = false;
      const closing = current;
      current = null;
      closing?.abort();
      handlers.onInterim("");
    },
  };
}
