import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { CoachHint } from "@/components/CoachHint";
import { api } from "@/lib/api";
import type { Resistance, Whisper } from "@/lib/api/types";
import { isStalled, stanceChange, useCoach, type StanceChange } from "@/lib/practice";
import {
  createRepApi,
  type RepResponse,
  type Scorecard,
  type TurnLatency,
  type WhisperLatency,
} from "@/lib/voice/repApi";
import {
  RepController,
  TURN_GAP_MS,
  type RepSnapshot,
  type TurnTiming,
} from "@/lib/voice/repController";
import {
  createBrowserSpeaker,
  createRecognizer,
  createSilentSpeaker,
  speechRecognitionSupported,
  speechSynthesisSupported,
  warmUpSpeech,
  type Recognizer,
} from "@/lib/voice/speech";
import { createVad, openMic, type Mic } from "@/lib/voice/vad";
import { WHISPER_WINDOW_MS, type Whisper as WhisperNote } from "@/lib/voice/whispers";

// Quiet time before Bob's first words, so the first sentence is not clipped.
const OPENING_DELAY_MS = 2000;

export const Route = createFileRoute("/rep")({
  head: () => ({
    meta: [
      { title: "Voice rep — DialogIQ" },
      {
        name: "description",
        content: "A three-minute spoken practice conversation with Bob, scored on how you spoke.",
      },
    ],
  }),
  component: RepScreen,
});

const baseUrl: unknown = import.meta.env["VITE_API_BASE_URL"];
const repApi = typeof baseUrl === "string" && baseUrl ? createRepApi(baseUrl) : null;

const PHASE_LABEL: Record<RepSnapshot["phase"], string> = {
  idle: "Ready",
  starting: "Starting…",
  listening: "Your turn. Bob is listening.",
  bob_thinking: "Bob is thinking…",
  bob_speaking: "Bob is speaking",
  turn_failed: "Bob's reply was lost",
  finishing: "Scoring…",
  finished: "Rep complete",
  failed: "The rep stopped",
};

type Rig = {
  controller: RepController;
  mic: Mic | null;
  recognizer: Recognizer | null;
  timer: number;
};

function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function RepScreen() {
  const queryClient = useQueryClient();
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: () => api.listScenarios() });
  const bob = scenarios.data?.find((scenario) => scenario.title.startsWith("Bob:"));
  const reps = useQuery({
    queryKey: ["v3-reps", bob?.id],
    queryFn: () => repApi!.list(bob!.id),
    enabled: !!repApi && !!bob,
  });

  const [snapshot, setSnapshot] = useState<RepSnapshot | null>(null);
  const [headphones, setHeadphones] = useState(false);
  const [support, setSupport] = useState<{ recognition: boolean; synthesis: boolean } | null>(null);
  const [micProblem, setMicProblem] = useState<string | null>(null);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [draft, setDraft] = useState("");
  const rig = useRef<Rig | null>(null);
  const typingStarted = useRef<number | null>(null);
  const transcriptEnd = useRef<HTMLDivElement | null>(null);

  // Speech support is only known in the browser, not while rendering on the server.
  useEffect(() => {
    setSupport({
      recognition: speechRecognitionSupported(),
      synthesis: speechSynthesisSupported(),
    });
  }, []);

  const teardown = useCallback(() => {
    const current = rig.current;
    if (!current) return;
    window.clearInterval(current.timer);
    current.mic?.stop();
    current.recognizer?.stop();
    rig.current = null;
    setInterim("");
    setLevel(0);
  }, []);

  useEffect(
    () => () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window)
        window.speechSynthesis.cancel();
      teardown();
    },
    [teardown],
  );

  const phase = snapshot?.phase ?? "idle";
  const ended = phase === "finished" || phase === "failed";

  useEffect(() => {
    if (!ended) return;
    teardown();
    void queryClient.invalidateQueries({ queryKey: ["v3-reps"] });
  }, [ended, teardown, queryClient]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView?.({ block: "end" });
  }, [snapshot?.lines.length, interim]);

  async function begin() {
    if (!repApi || !bob || rig.current) return;
    setMicProblem(null);
    setSnapshot(null);
    warmUpSpeech();
    const speaker = speechSynthesisSupported() ? createBrowserSpeaker() : createSilentSpeaker();
    const controller = new RepController({
      api: repApi,
      speaker,
      now: () => performance.now(),
      newKey: () => crypto.randomUUID(),
      onChange: setSnapshot,
      bargeIn: headphones,
      openingDelayMs: OPENING_DELAY_MS,
      beforeOpening: warmUpSpeech,
    });
    const vad = createVad(
      (tMs) => controller.speechStarted(tMs),
      (tMs) => controller.speechEnded(tMs),
    );
    // Ask for the microphone before the clock starts, so the permission
    // prompt does not use up the rep.
    let mic: Mic | null = null;
    let shown = 0;
    try {
      mic = await openMic((value) => {
        if (!controller.active) return;
        // On loudspeakers the microphone hears Bob, so it is ignored while he speaks.
        const muted = controller.bobAudioPlaying && !headphones;
        vad.push(muted ? 0 : value, controller.clock());
        const now = performance.now();
        if (now - shown > 100) {
          shown = now;
          setLevel(muted ? 0 : value);
        }
      });
    } catch {
      setMicProblem(
        "The microphone is not available, so this rep is typed. Check the browser's site permissions.",
      );
    }
    const recognizer = mic
      ? createRecognizer({
          onFinal: (text) => controller.heard(text),
          onInterim: setInterim,
          onError: (code) =>
            setMicProblem(`Speech recognition reported "${code}". You can type instead.`),
        })
      : null;
    const timer = window.setInterval(() => {
      controller.tick();
      if (!recognizer || !controller.active) return;
      if (controller.bobAudioPlaying && !headphones) recognizer.stop();
      else recognizer.start();
    }, 50);
    rig.current = { controller, mic, recognizer, timer };
    await controller.start(bob.id);
  }

  function sendTyped(event: FormEvent) {
    event.preventDefault();
    const controller = rig.current?.controller;
    if (!controller || !draft.trim()) return;
    controller.typed(draft, typingStarted.current ?? controller.clock());
    typingStarted.current = null;
    setDraft("");
  }

  const running = !!snapshot && !ended && phase !== "idle";
  const remaining = snapshot ? snapshot.durationLimitMs - snapshot.elapsedMs : 180_000;
  const busy = phase === "bob_thinking" || phase === "starting" || phase === "finishing";

  return (
    <div className="min-h-screen bg-background bg-ambient">
      <header className="border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <Link
            to="/"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Dashboard
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Voice rep</p>
            <h1 className="truncate font-semibold">
              {bob?.title ?? "Three minutes with Bob"}
              {snapshot?.repNumber ? ` · rep ${snapshot.repNumber}` : ""}
            </h1>
          </div>
          {running && (
            <button
              type="button"
              onClick={() => void rig.current?.controller.finish()}
              className="ml-auto rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-secondary"
            >
              End rep now
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        {!repApi && (
          <Notice title="The voice rep needs the backend">
            This build runs on demo data. Start the app with the backend (set VITE_API_BASE_URL) to
            practise by voice.
          </Notice>
        )}
        {repApi && scenarios.error && (
          <Notice title="Couldn't reach the backend">Check that it is running on port 8080.</Notice>
        )}

        {repApi && bob && !running && !ended && (
          <section className="bento space-y-4 p-6">
            <h2 className="text-xl font-semibold">Before you start</h2>
            <p className="max-w-2xl text-sm text-muted-foreground">{bob.persona.public_context}</p>
            <ul className="max-w-2xl list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>The rep lasts three minutes. Speak to Bob as you would in the room.</li>
              <li>
                Your audio is not sent to DialogIQ and is not stored. Speech recognition is done by
                your browser, so the browser vendor's service receives the audio. DialogIQ stores
                the transcript, the timing of each turn and the scores.
              </li>
              {support && !support.recognition && (
                <li className="text-warning">
                  This browser has no speech recognition, so you will type your turns. Chrome and
                  Edge support it.
                </li>
              )}
              {support && !support.synthesis && (
                <li className="text-warning">
                  This browser cannot speak, so Bob's replies are text only.
                </li>
              )}
            </ul>
            <label className="flex max-w-2xl cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={headphones}
                onChange={(event) => setHeadphones(event.target.checked)}
              />
              <span>
                <span className="font-medium">I am wearing headphones</span>
                <span className="block text-muted-foreground">
                  With headphones you can speak over Bob, and interruptions are counted. Without
                  them the microphone would hear Bob's voice, so it is ignored while he speaks.
                </span>
              </span>
            </label>
            <button
              type="button"
              onClick={() => void begin()}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground glow"
            >
              Start the rep
            </button>
          </section>
        )}

        {micProblem && <Notice title="Microphone">{micProblem}</Notice>}

        {snapshot && (running || ended) && (
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <section className="bento flex max-h-[62vh] min-h-[320px] flex-col overflow-hidden">
              <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
                {snapshot.lines.map((line, index) => (
                  <div key={index} className={line.who === "learner" ? "flex justify-end" : "flex"}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                        line.who === "learner"
                          ? "bg-primary/15 ring-1 ring-primary/30"
                          : "bg-secondary ring-1 ring-border"
                      }`}
                    >
                      <p className="mb-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {line.who === "learner" ? "You" : "Bob"}
                        {line.facts ? ` · ${describeTurn(line.facts)}` : ""}
                      </p>
                      {line.text}
                    </div>
                  </div>
                ))}
                {(snapshot.pendingText || interim) && (
                  <div className="flex justify-end">
                    <p className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm italic text-muted-foreground border border-dashed border-border">
                      {[snapshot.pendingText, interim].filter(Boolean).join(" ")}
                    </p>
                  </div>
                )}
                <div ref={transcriptEnd} />
              </div>
              {running && (
                <form onSubmit={sendTyped} className="flex gap-2 border-t border-border p-3">
                  <input
                    value={draft}
                    onChange={(event) => {
                      typingStarted.current ??= rig.current?.controller.clock() ?? null;
                      if (!event.target.value) typingStarted.current = null;
                      setDraft(event.target.value);
                    }}
                    placeholder="Or type your turn"
                    aria-label="Type your turn"
                    className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={busy || phase === "turn_failed" || !draft.trim()}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-40"
                  >
                    Send
                  </button>
                </form>
              )}
            </section>

            <aside className="space-y-4">
              <WhisperBanner whisper={snapshot.whisper} elapsedMs={snapshot.elapsedMs} />
              <div className="bento p-5 text-center">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {running ? "Time left" : "Rep length"}
                </p>
                <p className="mt-1 font-mono text-5xl font-semibold tabular-nums" role="timer">
                  {clockText(running ? remaining : snapshot.elapsedMs)}
                </p>
                <p className="mt-3 text-sm font-medium" role="status">
                  {PHASE_LABEL[phase]}
                </p>
                {running && (
                  <div className="mt-4">
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full rounded-full transition-[width] duration-100 ${
                          snapshot.learnerSpeaking ? "bg-success" : "bg-muted-foreground/50"
                        }`}
                        style={{ width: `${Math.min(100, Math.round(level * 600))}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {rig.current?.mic
                        ? snapshot.learnerSpeaking
                          ? "Hearing you"
                          : "Microphone on"
                        : "Microphone off"}
                    </p>
                  </div>
                )}
              </div>
              {snapshot.session && <RepCoach snapshot={snapshot} live={running} />}
              {snapshot.error && (
                <div className="bento space-y-3 p-4 text-sm">
                  <p className="text-destructive">{snapshot.error}</p>
                  {phase === "turn_failed" && (
                    <button
                      type="button"
                      onClick={() => rig.current?.controller.retry()}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground"
                    >
                      Ask Bob again
                    </button>
                  )}
                </div>
              )}
            </aside>
          </div>
        )}

        {phase === "finished" && snapshot?.result?.scorecard && (
          <>
            <ScorecardView
              scorecard={snapshot.result.scorecard}
              timings={snapshot.timings}
              judge={snapshot.result.judge}
            />
            <LatencyTable rows={snapshot.result.latency ?? []} />
            <WhisperLatencyCard latency={snapshot.result.whisper_latency} />
          </>
        )}

        {ended && (
          <button
            type="button"
            onClick={() => setSnapshot(null)}
            className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground glow"
          >
            Set up another rep
          </button>
        )}

        {!running && !!reps.data?.some((rep) => rep.scorecard) && <RepHistory reps={reps.data} />}
      </main>
    </div>
  );
}

const STANCE_LABEL: Record<Resistance, string> = {
  guarded: "Guarded",
  warming: "Warming",
  open: "Open",
};

const STANCE_CHANGE: Record<StanceChange, string> = {
  less_guarded: "Less guarded than the turn before.",
  more_guarded: "More guarded than the turn before.",
  unchanged: "Unchanged from the turn before.",
};

const WHISPER_STYLE: Record<Whisper["kind"], string> = {
  warn: "bg-warning/10 text-warning ring-warning/30",
  good: "bg-success/10 text-success ring-success/30",
  tip: "bg-secondary/50 text-secondary-foreground ring-border",
};

// The same coaching the typed arena shows, on the session behind the rep:
// Bob's stance, needs uncovered, feedback on the last turn and a next-move hint.
function RepCoach({ snapshot, live }: { snapshot: RepSnapshot; live: boolean }) {
  const session = snapshot.session!;
  const chain = snapshot.chain;
  const head = chain.at(-1);
  const waiting = snapshot.phase === "bob_thinking";
  const position = useMemo(
    () => ({
      branchId: session.active_branch_id,
      headId: head?.id ?? null,
      revision: session.revision,
    }),
    [session.active_branch_id, session.revision, head?.id],
  );
  const coach = useCoach({
    sessionId: session.id,
    position: live ? position : null,
    stalled: live && isStalled(chain),
    hold: waiting,
  });
  const progress = session.conversation_progress;
  const change = stanceChange(chain);
  const feedback = head?.coaching.whispers ?? [];

  return (
    <div className="bento space-y-4 p-4">
      <h2 className="text-sm font-semibold">Coach</h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Bob's stance</p>
          <p className="font-semibold">{STANCE_LABEL[progress?.stance ?? session.resistance]}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Needs uncovered</p>
          <p className="font-semibold tabular-nums">
            {session.score} of {session.total_needs}
          </p>
        </div>
      </div>
      {(change || progress?.explanation) && (
        <p className="text-xs text-muted-foreground">
          {change && <span className="text-foreground">{STANCE_CHANGE[change]} </span>}
          {progress?.explanation}
        </p>
      )}
      {feedback.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">Your last turn</p>
          {feedback.map((whisper, index) => (
            <div
              key={index}
              className={`rounded-lg px-3 py-2 text-sm ring-1 ${WHISPER_STYLE[whisper.kind]}`}
            >
              {whisper.text}
            </div>
          ))}
        </div>
      )}
      {live && (
        <>
          <CoachHint hints={coach.hints} pending={coach.pending} failure={coach.failure} />
          <button
            type="button"
            disabled={waiting || coach.pending || coach.exhausted}
            onClick={coach.requestHelp}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm font-semibold transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
          >
            {coach.exhausted
              ? "Two approaches saved for this turn"
              : coach.pending
                ? "Getting a hint…"
                : coach.canRetry
                  ? "Try again"
                  : coach.hints.length
                    ? "Try another approach"
                    : "Get a hint"}
          </button>
        </>
      )}
    </div>
  );
}

function describeTurn(facts: NonNullable<RepSnapshot["lines"][number]["facts"]>): string {
  if (facts.leading) return "leading question";
  if (facts.meaning) return "meaning question";
  if (facts.question_type === "open") return "open question";
  if (facts.question_type === "closed") return "closed question";
  return "statement";
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bento p-4 text-sm">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bento p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function ScorecardView({
  scorecard,
  timings,
  judge,
}: {
  scorecard: Scorecard;
  timings: TurnTiming[];
  judge: "semantic-r1" | "keywords" | undefined;
}) {
  const { talk, questions, pause_after_deflection: pause } = scorecard;
  const waits = timings
    .filter((timing) => timing.audio_start_ms !== null)
    .map((timing) => timing.audio_start_ms! - timing.speech_end_ms);
  const typicalWait = median(waits);
  return (
    <section className="space-y-3" aria-label="Scorecard">
      <h2 className="text-lg font-semibold">How you spoke</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Your share of the talking"
          value={talk.learner_ratio === null ? "—" : `${Math.round(talk.learner_ratio * 100)}%`}
          detail={`You ${seconds(talk.learner_ms)} · Bob ${seconds(talk.bob_ms)}`}
        />
        <Tile
          label="Open questions"
          value={String(questions.open)}
          detail={`${questions.meaning} about what matters to him · ${questions.closed} closed · ${questions.statements} statements`}
        />
        <Tile
          label="Waited after a deflection"
          value={`${pause.waited} of ${pause.deflections}`}
          detail={
            pause.median_gap_ms === null
              ? "Bob did not deflect, or the rep ended first."
              : `Typical gap ${seconds(pause.median_gap_ms)}; a wait is 2 s or more.`
          }
        />
        <Tile
          label="Interruptions"
          value={String(scorecard.interruptions)}
          detail="Times you spoke over Bob for half a second or more."
        />
      </div>
      {typicalWait !== null && (
        <p className="text-xs text-muted-foreground">
          Bob started answering a typical {seconds(typicalWait)} after you stopped speaking (
          {waits.length} {waits.length === 1 ? "turn" : "turns"}, slowest{" "}
          {seconds(Math.max(...waits))}
          ). Scored with {scorecard.ruleset}.
        </p>
      )}
      {judge && (
        <p className="text-xs text-muted-foreground" data-testid="judge">
          {judge === "semantic-r1"
            ? "Bob's needs were judged by meaning, from what he actually said."
            : "Bob's needs were judged by keyword rules: only an open question using the right words unlocks one."}
        </p>
      )}
    </section>
  );
}

function ms(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString()} ms`;
}

// The live coach whisper, shown for the length of its window, then gone.
function WhisperBanner({ whisper, elapsedMs }: { whisper: WhisperNote | null; elapsedMs: number }) {
  const visible = whisper !== null && elapsedMs - whisper.shownMs < WHISPER_WINDOW_MS;
  return (
    <div role="status" aria-live="polite" className="min-h-0">
      {visible && (
        <p
          data-testid="whisper"
          className="rounded-lg bg-accent/10 px-4 py-3 text-sm font-medium ring-1 ring-accent/40"
        >
          <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Coach
          </span>
          {whisper.text}
        </p>
      )}
    </div>
  );
}

function WhisperLatencyCard({ latency }: { latency: WhisperLatency | undefined }) {
  if (!latency || latency.shown === 0) return null;
  const share = Math.round((latency.within_limit / latency.shown) * 100);
  return (
    <section className="bento p-4 text-sm" aria-label="Whisper timing">
      <h2 className="mb-1 text-sm font-semibold">How fast the coach whispered</h2>
      <p className="text-xs text-muted-foreground">
        From the moment of the mistake to the whisper showing. The launch target is 90% within{" "}
        {seconds(latency.limit_ms)}.
      </p>
      <p className="mt-2 tabular-nums">
        {latency.within_limit} of {latency.shown} within {seconds(latency.limit_ms)} ({share}%) ·
        median {ms(latency.median_ms)} · slowest {ms(latency.max_ms)}
      </p>
    </section>
  );
}

function LatencyTable({ rows }: { rows: TurnLatency[] }) {
  if (!rows.length) return null;
  const columns = [
    (row: TurnLatency) => row.model_first_sentence_ms,
    (row: TurnLatency) => row.model_total_ms,
    (row: TurnLatency) => row.voice_round_trip_ms,
  ];
  const medians = columns.map((pick) =>
    median(rows.map(pick).filter((value): value is number => value !== null)),
  );
  return (
    <section className="bento overflow-x-auto p-4" aria-label="Response times">
      <h2 className="mb-1 text-sm font-semibold">How fast Bob answered</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Model times are measured on the server, from asking the model to its first full sentence and
        to its last. The round trip is from your last word to Bob's voice starting; it includes the{" "}
        {seconds(TURN_GAP_MS)} wait (longer after an unfinished sentence) that confirms you have
        finished.
      </p>
      <table className="w-full min-w-[460px] text-left text-sm tabular-nums">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">Turn</th>
            <th className="pb-2 font-medium">Model: first sentence</th>
            <th className="pb-2 font-medium">Model: whole reply</th>
            <th className="pb-2 font-medium">Your last word to Bob's voice</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.node_id} className="border-t border-border/50">
              <td className="py-1.5">{index + 1}</td>
              {columns.map((pick, column) => (
                <td key={column} className="py-1.5">
                  {ms(pick(row))}
                </td>
              ))}
            </tr>
          ))}
          <tr className="border-t border-border font-medium">
            <td className="py-1.5">Median</td>
            {medians.map((value, column) => (
              <td key={column} className="py-1.5">
                {ms(value === null ? null : Math.round(value))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function RepHistory({ reps }: { reps: RepResponse[] }) {
  const scored = reps.filter((rep) => rep.scorecard);
  return (
    <section className="bento overflow-x-auto p-4" aria-label="Earlier reps">
      <h2 className="mb-3 text-sm font-semibold">Your reps with Bob</h2>
      <table className="w-full min-w-[520px] text-left text-sm tabular-nums">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">Rep</th>
            <th className="pb-2 font-medium">Your share</th>
            <th className="pb-2 font-medium">Open</th>
            <th className="pb-2 font-medium">Meaning</th>
            <th className="pb-2 font-medium">Closed</th>
            <th className="pb-2 font-medium">Waited</th>
            <th className="pb-2 font-medium">Interruptions</th>
          </tr>
        </thead>
        <tbody>
          {scored.map((rep) => {
            const card = rep.scorecard!;
            return (
              <tr key={rep.rep_id} className="border-t border-border">
                <td className="py-2">{rep.rep_number}</td>
                <td>
                  {card.talk.learner_ratio === null
                    ? "—"
                    : `${Math.round(card.talk.learner_ratio * 100)}%`}
                </td>
                <td>{card.questions.open}</td>
                <td>{card.questions.meaning}</td>
                <td>{card.questions.closed}</td>
                <td>
                  {card.pause_after_deflection.waited} of {card.pause_after_deflection.deflections}
                </td>
                <td>{card.interruptions}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
