import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { CoachHint } from "@/components/CoachHint";
import { api, ApiError, type Resistance, type Whisper } from "@/lib/api";
import {
  applyTurn,
  branchChain,
  failureAction,
  failureMessage,
  isStalled,
  refreshSession,
  scenarioQuery,
  sessionQuery,
  storeSession,
  treeQuery,
  useActionKeys,
  useCoach,
} from "@/lib/practice";

type ArenaSearch = { sessionId?: number | undefined; scenarioId?: number | undefined };

function positiveId(value: unknown): number | undefined {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export const Route = createFileRoute("/arena")({
  // Explicit undefined: the router keeps the raw value of any key left out here.
  validateSearch: (search: Record<string, unknown>): ArenaSearch => ({
    sessionId: positiveId(search["sessionId"]),
    scenarioId: positiveId(search["scenarioId"]),
  }),
  // Only the Hub starts a run, so there is nothing to show without a session.
  beforeLoad: ({ search }) => {
    if (!search.sessionId) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Simulation Arena — DialogIQ" },
      {
        name: "description",
        content: "Practice a hard conversation live with an AI persona and real-time coaching.",
      },
      { property: "og:title", content: "Simulation Arena — DialogIQ" },
      {
        property: "og:description",
        content: "Practice a hard conversation live with an AI persona and real-time coaching.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Arena,
});

type Msg = { from: "persona" | "you"; text: string };

const RESISTANCE: Record<Resistance, { value: number; label: string }> = {
  guarded: { value: 90, label: "Guarded" },
  warming: { value: 55, label: "Warming" },
  open: { value: 20, label: "Open" },
};

function Arena() {
  const { sessionId, scenarioId } = Route.useSearch();
  if (!sessionId) return null;
  // Keyed so that switching sessions cannot carry over a draft, reply or whisper.
  return <ArenaSession key={sessionId} sessionId={sessionId} scenarioId={scenarioId} />;
}

function ArenaSession({
  sessionId,
  scenarioId,
}: {
  sessionId: number;
  scenarioId: number | undefined;
}) {
  const client = useQueryClient();
  const session = useQuery(sessionQuery(sessionId));
  const tree = useQuery(treeQuery(sessionId));
  const scenario = useQuery({
    ...scenarioQuery(session.data?.scenario_id ?? 0),
    enabled: session.data !== undefined,
  });
  const keys = useActionKeys();
  const sending = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const [typing, setTyping] = useState<{ nodeId: number; text: string; shown: number } | null>(
    null,
  );
  const [input, setInput] = useState("");
  const [mic, setMic] = useState(false);
  const [notes, setNotes] = useState<Whisper[]>([]);
  const feed = useRef<HTMLDivElement>(null);

  const typingNodeId = typing?.nodeId;
  useEffect(() => {
    if (typingNodeId === undefined) return;
    const id = setInterval(() => {
      setTyping((t) => (!t || t.shown + 2 >= t.text.length ? null : { ...t, shown: t.shown + 2 }));
    }, 25);
    return () => clearInterval(id);
  }, [typingNodeId]);

  // The two reads can straddle a change made elsewhere; never render a mix of them.
  const sessionRevision = session.data?.revision;
  const treeRevision = tree.data?.revision;
  const fetching = session.isFetching || tree.isFetching;
  useEffect(() => {
    if (sessionRevision === undefined || treeRevision === undefined) return;
    if (sessionRevision !== treeRevision && !fetching && !sending.current) {
      void refreshSession(client, sessionId);
    }
  }, [client, fetching, sessionId, sessionRevision, treeRevision]);

  const chain = useMemo(() => {
    if (!tree.data) return [];
    const branch = tree.data.branches.find((b) => b.id === tree.data.active_branch_id);
    return branchChain(tree.data.nodes, branch?.head_node_id ?? null);
  }, [tree.data]);

  const persona = scenario.data?.persona;
  const msgs: Msg[] = useMemo(() => {
    const opening: Msg[] = persona ? [{ from: "persona", text: persona.opening_message }] : [];
    const turns = chain.flatMap((n): Msg[] => [
      { from: "you", text: n.user_text },
      {
        from: "persona",
        text:
          n.id === typing?.nodeId
            ? n.character_text.slice(0, typing.shown) + "▍"
            : n.character_text,
      },
    ]);
    return [...opening, ...turns];
  }, [chain, persona, typing]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [msgs, pending]);

  const busy = pending !== null || typing !== null;
  const ready = session.data !== undefined && tree.data !== undefined && persona !== undefined;

  // Coach requests bind to a position both reads agree on, never a mix of the two.
  const headId = chain.at(-1)?.id ?? null;
  const coachPosition = useMemo(() => {
    if (!session.data || !tree.data) return null;
    const { active_branch_id: branchId, active_head_node_id, revision } = session.data;
    if (revision !== tree.data.revision || branchId !== tree.data.active_branch_id) return null;
    if (active_head_node_id !== headId) return null;
    return { branchId, headId, revision };
  }, [headId, session.data, tree.data]);
  const coach = useCoach({
    sessionId,
    position: coachPosition,
    stalled: isStalled(chain),
    hold: pending !== null,
  });

  async function send() {
    const text = input.trim();
    if (!text || busy || sending.current || !session.data) return;
    sending.current = true;
    const action = `turn:${text}`;
    setInput("");
    setPending(text);
    setNotes([]);
    try {
      const res = await api.sendTurn(
        {
          session_id: sessionId,
          branch_id: session.data.active_branch_id,
          parent_node_id: session.data.active_head_node_id,
          expected_revision: session.data.revision,
          user_message: text,
        },
        keys.keyFor(action),
      );
      keys.release(action);
      storeSession(client, res.session);
      client.setQueryData(["tree", sessionId], (prev: typeof tree.data) =>
        prev ? applyTurn(prev, res) : prev,
      );
      setTyping({ nodeId: res.turn_id, text: res.character_response, shown: 0 });
      void refreshSession(client, sessionId);
    } catch (error) {
      // The outcome may be unknown, so restore the draft and read the truth back. A
      // resend of the same text keeps its key, which replays a turn that did commit.
      if (failureAction(error) !== "retry") keys.release(action);
      setInput(text);
      setNotes([{ kind: "warn", text: failureMessage(error) }]);
      void refreshSession(client, sessionId);
    } finally {
      sending.current = false;
      setPending(null);
    }
  }

  if (session.error || tree.error) {
    const missing = session.error instanceof ApiError && session.error.status === 404;
    return (
      <ArenaMessage
        title={missing ? "Session not found" : "Couldn't reach the simulator"}
        detail={
          missing
            ? "This session no longer exists. Start a new one from the dashboard."
            : "Check that the simulator is running, then try again."
        }
      >
        {!missing && (
          <button
            onClick={() => void refreshSession(client, sessionId)}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow"
          >
            Try again
          </button>
        )}
      </ArenaMessage>
    );
  }

  if (scenarioId && session.data && session.data.scenario_id !== scenarioId) {
    return (
      <ArenaMessage
        title="This link points at a different scenario"
        detail="The session belongs to another scenario, so it was not opened here."
      >
        <Link
          to="/arena"
          search={{ sessionId }}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow"
        >
          Open the session
        </Link>
      </ArenaMessage>
    );
  }

  if (scenario.error) {
    return (
      <ArenaMessage
        title="Couldn't load this scenario"
        detail="The persona details are unavailable, so the session was not opened."
      />
    );
  }

  const metrics = session.data?.metrics;
  const asked = metrics ? metrics.open_questions + metrics.closed_questions : 0;
  const openPct = metrics ? Math.round(metrics.open_question_ratio * 100) : 0;
  const empathy = metrics?.turns ? Math.round((metrics.empathy_turns / metrics.turns) * 100) : 0;
  const resistance = RESISTANCE[session.data?.resistance ?? "guarded"];
  const score = session.data?.score ?? 0;
  const total = session.data?.total_needs ?? 7;

  const turnFeedback: Whisper[] = chain.at(-1)?.coaching.whispers ?? [];
  const earlierHint = coach.pending ? coach.earlier : undefined;
  const earlierTurn = chain.find((n) => n.id === earlierHint?.head_node_id)?.turn_number;

  return (
    <div className="flex h-screen flex-col bg-background bg-ambient">
      <header className="border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="flex items-center gap-4 px-6 py-3">
          <Link
            to="/"
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Dashboard
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
              Simulation Arena · Live
            </p>
            <h1 className="truncate font-semibold">{scenario.data?.title ?? "Loading session…"}</h1>
          </div>
          <Link
            to="/flight-recorder"
            search={{ sessionId }}
            className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow transition-transform hover:-translate-y-0.5"
          >
            End Simulation &amp; View Flight Tree
          </Link>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1fr_360px]">
        <section className="bento flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border p-4">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-secondary text-lg font-bold ring-2 ring-accent/40">
              {persona?.initials ?? "…"}
            </div>
            <div>
              <p className="font-semibold">
                {persona?.name ?? "Loading…"}{" "}
                {persona && (
                  <span className="font-normal text-muted-foreground">· {persona.role}</span>
                )}
              </p>
              <div className="mt-1 flex gap-1.5">
                {(persona?.tags ?? []).map((t) => (
                  <span
                    key={t}
                    className="rounded-md border border-border bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Wave active={busy || mic} />
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {busy ? `${persona?.name ?? "Persona"} speaking` : mic ? "Listening" : "Idle"}
              </span>
            </div>
          </div>

          {persona && (
            <p className="border-b border-border bg-secondary/30 px-4 py-2 text-xs text-muted-foreground">
              <span className="font-semibold text-secondary-foreground">Your situation: </span>
              {persona.public_context}
            </p>
          )}

          <div ref={feed} className="flex-1 space-y-4 overflow-y-auto p-5">
            {!ready && <p className="text-sm text-muted-foreground">Loading session…</p>}
            {msgs.map((m, i) => (
              <Bubble key={i} m={m} />
            ))}
            {pending !== null && (
              <>
                <Bubble m={{ from: "you", text: pending }} />
                <Bubble m={{ from: "persona", text: "▍" }} />
              </>
            )}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <button
                onClick={() => setMic((v) => !v)}
                aria-label="Toggle microphone"
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-colors ${mic ? "border-accent bg-accent/15 text-accent" : "border-border text-muted-foreground hover:text-foreground"}`}
              >
                🎙
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={1}
                maxLength={4000}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={`Respond to ${persona?.name ?? "the persona"}…`}
                className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-primary/60"
              />
              <button
                disabled={!coachPosition || pending !== null || coach.pending || coach.exhausted}
                onClick={coach.requestHelp}
                className={`h-10 shrink-0 rounded-lg border border-border px-3 text-secondary-foreground transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40 ${coach.exhausted ? "max-w-36 text-[11px] leading-tight" : "text-sm"}`}
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
              <button
                onClick={() => void send()}
                disabled={!input.trim() || busy || !ready}
                className="h-10 shrink-0 rounded-lg bg-brand px-4 text-sm font-semibold text-primary-foreground glow transition-opacity disabled:opacity-40"
              >
                Send Response
              </button>
            </div>
          </div>
        </section>

        <aside className="bento flex min-h-0 flex-col overflow-y-auto">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold">Conversation coach</h2>
          </div>
          <div className="space-y-3 border-b border-border p-4">
            <CoachHint
              hints={coach.hints}
              earlier={earlierHint?.hint}
              earlierLabel={earlierTurn ? `From turn ${earlierTurn}` : "From the opening"}
              pending={coach.pending}
              failure={coach.failure}
            />
            {turnFeedback.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Turn feedback</p>
                {turnFeedback.map((w, i) => (
                  <WhisperNote key={i} whisper={w} />
                ))}
              </div>
            )}
            {notes.map((w, i) => (
              <WhisperNote key={i} whisper={w} />
            ))}
          </div>
          <div className="space-y-4 p-4">
            <Meter
              label="Needs Uncovered"
              value={Math.round((score / total) * 100)}
              display={`${score}/${total}`}
              hint="Scored by the judge on this branch"
              tone="accent"
            />
            <Meter
              label="Open vs. Closed Ratio"
              value={openPct}
              hint={
                asked
                  ? `${metrics?.open_questions} open · ${metrics?.closed_questions} closed`
                  : "No questions yet"
              }
              tone="accent"
            />
            <Meter
              label="Empathy Index"
              value={empathy}
              hint={`${metrics?.empathy_turns ?? 0} empathy markers`}
              tone="primary"
            />
            <Meter
              label={`${persona?.name ?? "Persona"}'s Resistance`}
              value={resistance.value}
              display={resistance.label}
              hint="Lower is better"
              tone="warning"
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function ArenaMessage({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid h-screen place-items-center bg-background bg-ambient p-6">
      <div className="bento max-w-md space-y-3 p-6 text-center">
        <h1 className="font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{detail}</p>
        <div className="flex justify-center gap-2">
          {children}
          <Link
            to="/"
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function WhisperNote({ whisper }: { whisper: Whisper }) {
  return (
    <div
      className={`rounded-lg px-3 py-2 text-sm ring-1 ${
        whisper.kind === "warn"
          ? "bg-warning/10 text-warning ring-warning/30"
          : whisper.kind === "good"
            ? "bg-success/10 text-success ring-success/30"
            : "bg-secondary/50 text-secondary-foreground ring-border"
      }`}
    >
      {whisper.text}
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const you = m.from === "you";
  return (
    <div className={`flex ${you ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${you ? "bg-primary text-primary-foreground" : "bg-secondary/70 text-foreground"}`}
      >
        {m.text}
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  display,
  hint,
  tone,
}: {
  label: string;
  value: number;
  display?: string;
  hint: string;
  tone: "accent" | "primary" | "warning";
}) {
  const bar = tone === "accent" ? "bg-accent" : tone === "primary" ? "bg-primary" : "bg-warning";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">{display ?? `${value}%`}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${bar} transition-all duration-700`}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Wave({ active }: { active: boolean }) {
  return (
    <div className="flex h-6 items-center gap-0.5">
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className={`w-1 rounded-full bg-accent ${active ? "animate-pulse" : "opacity-30"}`}
          style={{
            height: active ? `${30 + ((i * 37) % 70)}%` : "20%",
            animationDelay: `${i * 80}ms`,
          }}
        />
      ))}
    </div>
  );
}
