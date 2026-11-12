// One voice rep, from start to scorecard. It owns the rep clock, turn taking,
// the event log and the calls to /api/v3. The microphone, speech recognition
// and speech synthesis are passed in, so the logic runs in tests without them.

import { ApiError } from "@/lib/api/http";
import type { PracticeSession, TurnNode } from "@/lib/api/types";

import {
  RepStreamError,
  type RepApi,
  type RepCreated,
  type RepResponse,
  type TurnFacts,
  type VoiceEvent,
  type VoiceEventKind,
  type VoiceTurnRequest,
} from "./repApi";
import type { Speaker } from "./speech";

// Contract: Bob's audio is cut once the learner has spoken over it this long.
export const BARGE_IN_MS = 500;
// Quiet time after the learner's last word before their turn is sent.
export const TURN_GAP_MS = 700;
// Timing events are posted at least this often.
const FLUSH_EVERY_MS = 3000;
const BATCH_LIMIT = 200;

export type RepPhase =
  | "idle"
  | "starting"
  | "listening"
  | "bob_thinking"
  | "bob_speaking"
  | "turn_failed"
  | "finishing"
  | "finished"
  | "failed";

export type RepLine = {
  who: "bob" | "learner";
  text: string;
  facts?: TurnFacts;
  // True while Bob's reply is still arriving.
  partial?: boolean;
};

// How long one turn took, all in milliseconds since the rep started.
export type TurnTiming = {
  speech_end_ms: number;
  sent_ms: number;
  first_sentence_ms: number | null;
  audio_start_ms: number | null;
};

export type RepSnapshot = {
  phase: RepPhase;
  repNumber: number | null;
  durationLimitMs: number;
  elapsedMs: number;
  lines: RepLine[];
  learnerSpeaking: boolean;
  // Words heard that are not sent yet.
  pendingText: string;
  error: string | null;
  result: RepResponse | null;
  timings: TurnTiming[];
  // The practice session behind the rep and its saved turns, oldest first,
  // for the coach panel: stance, needs uncovered, turn feedback and hints.
  session: PracticeSession | null;
  chain: TurnNode[];
};

export type RepDeps = {
  api: RepApi;
  speaker: Speaker;
  // Monotonic milliseconds, for example performance.now.
  now: () => number;
  newKey: () => string;
  onChange: (snapshot: RepSnapshot) => void;
  // False when the learner uses loudspeakers: Bob's audio would be heard by
  // the microphone, so nothing the microphone hears while Bob speaks counts.
  bargeIn: boolean;
};

type BobSegment = {
  start: number;
  end: number | null;
  interrupted: boolean;
  nodeId: number | null;
};

type Flight = {
  request: VoiceTurnRequest;
  key: string;
  line: RepLine;
  timing: TurnTiming;
};

export class RepController {
  private phase: RepPhase = "idle";
  private rep: RepCreated | null = null;
  private startedAt = 0;
  private lines: RepLine[] = [];
  private error: string | null = null;
  private result: RepResponse | null = null;
  private timings: TurnTiming[] = [];
  private session: PracticeSession | null = null;
  private chain: TurnNode[] = [];

  private branchId = 0;
  private headNodeId: number | null = null;
  private revision = 0;

  private learnerSpeaking = false;
  private speechStart: number | null = null;
  private lastSpeechEnd = 0;
  private pending = "";
  private pendingStart: number | null = null;

  private bobPlaying = false;
  private bob: BobSegment | null = null;
  private openingPlaying = false;
  // Whether the current reply's audio has started, and the node waiting for it.
  private replyAudioSeen = false;
  private audioNodeId: number | null = null;
  private flight: Flight | null = null;
  private abort: AbortController | null = null;

  private seq = 0;
  private queue: VoiceEvent[] = [];
  private flushing: Promise<void> | null = null;
  private lastFlush = 0;

  constructor(private readonly deps: RepDeps) {
    deps.speaker.onStart = () => this.audioStarted();
    deps.speaker.onEnd = (interrupted) => this.audioEnded(interrupted);
  }

  snapshot(): RepSnapshot {
    return {
      phase: this.phase,
      repNumber: this.rep?.rep_number ?? null,
      durationLimitMs: this.rep?.duration_limit_ms ?? 180_000,
      elapsedMs: this.running() ? this.t() : (this.result?.duration_ms ?? 0),
      lines: this.lines.map((line) => ({ ...line })),
      learnerSpeaking: this.learnerSpeaking,
      pendingText: this.pending,
      error: this.error,
      result: this.result,
      timings: this.timings.map((timing) => ({ ...timing })),
      session: this.session,
      chain: this.chain,
    };
  }

  // True while Bob's audio plays; the screen uses it to pause recognition
  // when the learner is on loudspeakers.
  get bobAudioPlaying(): boolean {
    return this.bobPlaying;
  }

  async start(scenarioId: number): Promise<void> {
    if (this.phase !== "idle") return;
    this.setPhase("starting");
    try {
      this.rep = await this.deps.api.createRep(scenarioId, this.deps.newKey());
    } catch (error) {
      this.fail(describe(error, "The rep could not be started."));
      return;
    }
    const session = this.rep.session;
    this.session = session;
    this.chain = [];
    this.branchId = session.active_branch_id;
    this.headNodeId = session.active_head_node_id;
    this.revision = session.revision;
    this.startedAt = this.deps.now();
    this.lastFlush = 0;
    this.lines = [{ who: "bob", text: this.rep.opening_message }];
    // The opening line is not a saved turn, so it has no node and no timing
    // events: the contract's Bob events need a node_id.
    this.openingPlaying = true;
    this.setPhase("bob_speaking");
    this.deps.speaker.say(this.rep.opening_message);
    this.deps.speaker.close();
  }

  // Voice activity detection says the learner started speaking at tMs.
  speechStarted(tMs: number): void {
    if (!this.running() || this.learnerSpeaking) return;
    if (this.bobPlaying && !this.deps.bargeIn) return;
    this.learnerSpeaking = true;
    this.speechStart = tMs;
    this.pendingStart ??= tMs;
    this.record("learner_speech_start", tMs);
    this.emit();
  }

  speechEnded(tMs: number): void {
    if (!this.learnerSpeaking) return;
    this.learnerSpeaking = false;
    this.speechStart = null;
    this.lastSpeechEnd = tMs;
    this.record("learner_speech_end", tMs);
    this.emit();
  }

  // Speech recognition finished a piece of the learner's words.
  heard(text: string): void {
    const clean = text.trim();
    if (!this.running() || !clean) return;
    if (this.bobPlaying && !this.deps.bargeIn) return;
    this.pending = this.pending ? `${this.pending} ${clean}` : clean;
    this.emit();
  }

  // A typed turn, for browsers without speech recognition. The typing time
  // stands in for the speech segment.
  typed(text: string, typingStartedMs: number): void {
    const clean = text.trim();
    if (!this.running() || !clean || this.flight) return;
    if (this.bobPlaying) this.deps.speaker.cancel();
    const now = this.t();
    const start = Math.min(typingStartedMs, now);
    this.record("learner_speech_start", start);
    this.record("learner_speech_end", now);
    this.pending = clean;
    this.pendingStart = start;
    this.lastSpeechEnd = now;
    this.send();
  }

  // Call about twenty times a second while the rep runs.
  tick(): void {
    if (!this.running()) return;
    const now = this.t();
    if (now >= (this.rep?.duration_limit_ms ?? 0)) {
      void this.finish();
      return;
    }
    if (
      this.bobPlaying &&
      this.learnerSpeaking &&
      this.speechStart !== null &&
      now - this.speechStart >= BARGE_IN_MS
    ) {
      this.deps.speaker.cancel();
    }
    if (
      this.pending &&
      !this.learnerSpeaking &&
      !this.flight &&
      !this.bobPlaying &&
      this.phase !== "turn_failed" &&
      now - this.lastSpeechEnd >= TURN_GAP_MS
    ) {
      this.send();
    }
    if (now - this.lastFlush >= FLUSH_EVERY_MS) void this.flush();
    this.emit();
  }

  // Resend the turn whose reply was lost. The same key is used, so a reply
  // the server did save is replayed instead of generated twice.
  retry(): void {
    if (this.phase !== "turn_failed" || !this.flight) return;
    this.error = null;
    void this.run(this.flight);
  }

  async finish(): Promise<void> {
    if (!this.running() || !this.rep) return;
    const duration = Math.min(this.t(), this.rep.duration_limit_ms);
    this.setPhase("finishing");
    this.abort?.abort();
    if (this.learnerSpeaking) this.speechEnded(duration);
    this.deps.speaker.cancel();
    this.closeBob(duration);
    this.lines = this.lines.filter((line) => !line.partial);
    try {
      for (let attempt = 0; attempt < 5 && this.queue.length; attempt += 1) await this.flush();
      if (this.queue.length) throw new Error("events not saved");
      const { rep } = await this.deps.api.finish(this.rep.rep_id, duration, this.deps.newKey());
      this.result = rep;
      this.setPhase("finished");
    } catch (error) {
      this.fail(describe(error, "The rep ended but its scorecard could not be saved."));
    }
  }

  // True from the first second of the rep until it ends.
  get active(): boolean {
    return this.running();
  }

  // Milliseconds since the rep started; every event time uses this clock.
  clock(): number {
    return this.t();
  }

  private running(): boolean {
    return ["listening", "bob_thinking", "bob_speaking", "turn_failed"].includes(this.phase);
  }

  private t(): number {
    return Math.max(0, Math.round(this.deps.now() - this.startedAt));
  }

  private send(): void {
    const text = this.pending;
    const start = this.pendingStart ?? this.lastSpeechEnd;
    this.pending = "";
    this.pendingStart = null;
    const line: RepLine = { who: "learner", text };
    const flight: Flight = {
      line,
      key: this.deps.newKey(),
      request: {
        branch_id: this.branchId,
        parent_node_id: this.headNodeId,
        expected_revision: this.revision,
        user_message: text,
        speech_start_ms: Math.min(start, this.lastSpeechEnd),
        speech_end_ms: this.lastSpeechEnd,
      },
      timing: {
        speech_end_ms: this.lastSpeechEnd,
        sent_ms: this.t(),
        first_sentence_ms: null,
        audio_start_ms: null,
      },
    };
    this.lines.push(line);
    this.timings.push(flight.timing);
    void this.run(flight);
  }

  private async run(flight: Flight): Promise<void> {
    if (!this.rep) return;
    this.flight = flight;
    this.bob = null;
    this.replyAudioSeen = false;
    this.audioNodeId = null;
    this.abort = new AbortController();
    this.setPhase("bob_thinking");
    const reply: RepLine = { who: "bob", text: "", partial: true };
    try {
      const done = await this.deps.api.streamTurn(
        this.rep.rep_id,
        flight.request,
        flight.key,
        (_index, sentence) => {
          if (this.flight !== flight) return;
          flight.timing.first_sentence_ms ??= this.t();
          if (!reply.text) this.lines.push(reply);
          reply.text = reply.text ? `${reply.text} ${sentence}` : sentence;
          this.deps.speaker.say(sentence);
          this.emit();
        },
        this.abort.signal,
      );
      if (this.flight !== flight || !this.running()) return;
      this.deps.speaker.close();
      if (!reply.text) this.lines.push(reply);
      reply.text = done.node.character_text;
      reply.partial = false;
      flight.line.facts = done.turn;
      this.branchId = done.session.active_branch_id;
      this.headNodeId = done.node.id;
      this.revision = done.session.revision;
      this.session = done.session;
      this.chain = [...this.chain, done.node];
      this.flight = null;
      // The speaker callbacks set this.bob while the stream was awaited.
      const segment = this.bob as BobSegment | null;
      if (segment) {
        segment.nodeId = done.node.id;
        this.logBob();
      } else if (!this.replyAudioSeen) {
        // The audio has not started yet; it takes this node when it does.
        this.audioNodeId = done.node.id;
      }
      if (this.phase === "bob_thinking") this.setPhase("listening");
      else this.emit();
    } catch (error) {
      if (this.flight !== flight || !this.running()) return;
      // Nothing was saved: drop the partial reply and its audio.
      this.bob = null;
      this.deps.speaker.cancel();
      this.lines = this.lines.filter((line) => line !== reply);
      this.error = describe(error, "Bob's reply did not arrive.");
      this.setPhase("turn_failed");
    }
  }

  private audioStarted(): void {
    this.bobPlaying = true;
    if (this.openingPlaying) {
      this.emit();
      return;
    }
    const now = this.t();
    this.bob = { start: now, end: null, interrupted: false, nodeId: this.audioNodeId };
    this.audioNodeId = null;
    this.replyAudioSeen = true;
    if (this.flight) this.flight.timing.audio_start_ms ??= now;
    if (this.phase === "bob_thinking" || this.phase === "listening") this.setPhase("bob_speaking");
  }

  private audioEnded(interrupted: boolean): void {
    this.bobPlaying = false;
    const wasOpening = this.openingPlaying;
    this.openingPlaying = false;
    if (!this.running()) return;
    if (!wasOpening && this.bob) {
      this.bob.end = this.t();
      this.bob.interrupted = interrupted;
      this.logBob();
    }
    if (this.phase === "bob_speaking") this.setPhase(this.flight ? "bob_thinking" : "listening");
    else this.emit();
  }

  // Close Bob's segment at the end of the rep.
  private closeBob(tMs: number): void {
    if (this.bob && this.bob.end === null) this.bob.end = tMs;
    this.logBob();
  }

  // Bob's two events need the node id, which arrives with `done`, and the end
  // time, which arrives when the audio stops. Log them once both are known.
  private logBob(): void {
    const bob = this.bob;
    if (!bob || bob.nodeId === null || bob.end === null) return;
    this.record("bob_audio_start", bob.start, { node_id: bob.nodeId });
    this.record("bob_audio_end", bob.end, {
      node_id: bob.nodeId,
      ...(bob.interrupted ? { interrupted: true } : {}),
    });
    this.bob = null;
  }

  private record(kind: VoiceEventKind, tMs: number, extra: Partial<VoiceEvent> = {}): void {
    this.seq += 1;
    this.queue.push({ seq: this.seq, t_ms: Math.max(0, Math.round(tMs)), kind, ...extra });
  }

  // Post queued events. A failed batch stays queued; the server ignores a seq
  // it already holds, so sending it again is safe.
  private flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.rep || !this.queue.length) return Promise.resolve();
    this.lastFlush = this.t();
    const batch = this.queue.slice(0, BATCH_LIMIT);
    const repId = this.rep.rep_id;
    this.flushing = this.deps.api
      .postEvents(repId, batch, this.deps.newKey())
      .then(() => {
        this.queue = this.queue.filter((event) => event.seq > batch[batch.length - 1]!.seq);
      })
      .catch(() => {})
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  private fail(message: string): void {
    this.error = message;
    this.setPhase("failed");
  }

  private setPhase(phase: RepPhase): void {
    this.phase = phase;
    this.emit();
  }

  private emit(): void {
    this.deps.onChange(this.snapshot());
  }
}

function describe(error: unknown, fallback: string): string {
  if (error instanceof RepStreamError || error instanceof ApiError) {
    const code = error.code ?? "unknown";
    if (code === "persona_timeout") return "Bob took too long to answer.";
    if (code === "stale_revision")
      return "The conversation changed elsewhere. End this rep and start a new one.";
    return `${fallback} (${code})`;
  }
  return fallback;
}
