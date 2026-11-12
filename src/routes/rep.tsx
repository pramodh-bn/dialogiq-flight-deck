import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { api } from "@/lib/api";
import {
  createRepApi,
  type RepResponse,
  type Scorecard,
  type TurnLatency,
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
  type Recognizer,
} from "@/lib/voice/speech";
import { createVad, openMic, type Mic } from "@/lib/voice/vad";

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
    const speaker = speechSynthesisSupported() ? createBrowserSpeaker() : createSilentSpeaker();
    const controller = new RepController({
      api: repApi,
      speaker,
      now: () => performance.now(),
      newKey: () => crypto.randomUUID(),
      onChange: setSnapshot,
      bargeIn: headphones,
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
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
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
            <ScorecardView scorecard={snapshot.result.scorecard} timings={snapshot.timings} />
            <LatencyTable rows={snapshot.result.latency ?? []} />
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

function ScorecardView({ scorecard, timings }: { scorecard: Scorecard; timings: TurnTiming[] }) {
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
    </section>
  );
}

function ms(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString()} ms`;
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
        {seconds(TURN_GAP_MS)} wait that confirms you have finished.
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
