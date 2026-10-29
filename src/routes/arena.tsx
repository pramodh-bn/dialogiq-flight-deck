import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { classifyTurn } from "@/lib/classify";

type ArenaSearch = { scenarioId?: number };

export const Route = createFileRoute("/arena")({
  validateSearch: (search: Record<string, unknown>): ArenaSearch => {
    const id = Number(search["scenarioId"]);
    return Number.isInteger(id) && id > 0 ? { scenarioId: id } : {};
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

type Msg = { from: "bob" | "you"; text: string };
type Whisper = { kind: "warn" | "good" | "tip"; text: string };

const DEFAULT_SCENARIO_ID = 1;
const UNREACHABLE: Whisper = { kind: "warn", text: "⚠️ Couldn't reach the simulator. Try again." };

const hints = [
  "Try: “What's been the hardest part of this quarter for you?”",
  "Name the emotion: “It sounds like you've felt stretched thin.”",
  "Invite ownership: “What would a good next step look like from your side?”",
];

function Arena() {
  const { scenarioId = DEFAULT_SCENARIO_ID } = Route.useSearch();
  const { data: scenarios } = useQuery({
    queryKey: ["scenarios"],
    queryFn: () => api.listScenarios(),
  });
  const scenario = scenarios?.find((s) => s.id === scenarioId);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      from: "bob",
      text: "You wanted to see me? If this is about the Q3 thing, I already sent the update.",
    },
  ]);
  const [streaming, setStreaming] = useState("");
  const [input, setInput] = useState("");
  const [mic, setMic] = useState(false);
  const [counts, setCounts] = useState({ open: 0, closed: 0, empathy: 0, turns: 0 });
  const [whispers, setWhispers] = useState<Whisper[]>([
    { kind: "tip", text: "Bob is avoidant. Lead with curiosity, not accusations." },
  ]);
  const [hintIdx, setHintIdx] = useState(0);
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [msgs, streaming]);

  useEffect(() => {
    let live = true;
    setSessionId(null);
    api.createSession({ scenario_id: scenarioId }).then(
      (s) => live && setSessionId(s.id),
      () => live && setWhispers((p) => [UNREACHABLE, ...p].slice(0, 6)),
    );
    return () => {
      live = false;
    };
  }, [scenarioId]);

  const busy = pending || streaming !== "";

  function streamBob(text: string) {
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setStreaming(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(id);
        setStreaming("");
        setPending(false);
        setMsgs((m) => [...m, { from: "bob", text }]);
      }
    }, 25);
  }

  async function send() {
    const t = input.trim();
    if (!t || busy || sessionId === null) return;
    setInput("");
    setPending(true);
    setMsgs((m) => [...m, { from: "you", text: t }]);
    const { open: isOpen, closed: isClosed, empathy: isEmp } = classifyTurn(t);
    setCounts((c) => ({
      open: c.open + (isOpen ? 1 : 0),
      closed: c.closed + (isClosed ? 1 : 0),
      empathy: c.empathy + (isEmp ? 1 : 0),
      turns: c.turns + 1,
    }));
    const w: Whisper[] = [];
    if (isClosed)
      w.push({
        kind: "warn",
        text: "⚠️ Closed question detected. Try rephrasing as an open invitation.",
      });
    if (isOpen) w.push({ kind: "good", text: "✓ Open question — Bob's resistance is dropping." });
    if (isEmp) w.push({ kind: "good", text: "✓ Empathy marker used. Trust +1." });
    if (!w.length)
      w.push({
        kind: "tip",
        text: "Statement detected. Follow up with a question to keep Bob talking.",
      });
    setWhispers((prev) => [...w, ...prev].slice(0, 6));
    try {
      const res = await api.sendTurn({ session_id: sessionId, user_message: t });
      streamBob(res.character_response);
    } catch {
      setPending(false);
      setWhispers((prev) => [UNREACHABLE, ...prev].slice(0, 6));
    }
  }

  const asked = counts.open + counts.closed;
  const openPct = asked ? Math.round((counts.open / asked) * 100) : 0;
  const empathy = counts.turns
    ? Math.min(100, Math.round((counts.empathy / counts.turns) * 100 + counts.open * 5))
    : 0;
  const resistance = Math.max(10, 90 - counts.open * 15 - counts.empathy * 12 + counts.closed * 8);

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
            <h1 className="truncate font-semibold">
              {scenario?.title ?? "Performance Review: Missed Q3 Deadlines"}
            </h1>
          </div>
          <Link
            to="/flight-recorder"
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
              B
            </div>
            <div>
              <p className="font-semibold">
                Bob{" "}
                <span className="font-normal text-muted-foreground">· Defensive Team Member</span>
              </p>
              <div className="mt-1 flex gap-1.5">
                {["Avoidant", "High Resistance"].map((t) => (
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
              <span className="font-mono text-[10px] text-muted-foreground">
                {busy ? "BOB SPEAKING" : mic ? "LISTENING" : "IDLE"}
              </span>
            </div>
          </div>

          <div ref={feed} className="flex-1 space-y-4 overflow-y-auto p-5">
            {msgs.map((m, i) => (
              <Bubble key={i} m={m} />
            ))}
            {busy && <Bubble m={{ from: "bob", text: streaming + "▍" }} />}
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Respond to Bob…"
                className="max-h-32 min-h-10 flex-1 resize-none rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-primary/60"
              />
              <button
                onClick={() => {
                  setWhispers((p) =>
                    [
                      { kind: "tip" as const, text: "💡 " + hints[hintIdx % hints.length] },
                      ...p,
                    ].slice(0, 6),
                  );
                  setHintIdx((h) => h + 1);
                }}
                className="h-10 shrink-0 rounded-lg border border-border px-3 text-sm text-secondary-foreground transition-colors hover:border-accent/50 hover:text-accent"
              >
                Get Hint
              </button>
              <button
                onClick={send}
                disabled={!input.trim() || busy || sessionId === null}
                className="h-10 shrink-0 rounded-lg bg-brand px-4 text-sm font-semibold text-primary-foreground glow transition-opacity disabled:opacity-40"
              >
                Send Response
              </button>
            </div>
          </div>
        </section>

        <aside className="bento flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-border p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
              Live AI Coach
            </p>
            <h2 className="font-semibold">Whispers</h2>
          </div>
          <div className="space-y-4 p-4">
            <Meter
              label="Open vs. Closed Ratio"
              value={openPct}
              hint={`${counts.open} open · ${counts.closed} closed`}
              tone="accent"
            />
            <Meter
              label="Empathy Index"
              value={empathy}
              hint={`${counts.empathy} empathy markers`}
              tone="primary"
            />
            <Meter
              label="Bob's Resistance"
              value={resistance}
              hint="Lower is better"
              tone="warning"
            />
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto border-t border-border p-4">
            {whispers.map((w, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-sm ring-1 transition-all ${
                  w.kind === "warn"
                    ? "bg-warning/10 text-warning ring-warning/30"
                    : w.kind === "good"
                      ? "bg-success/10 text-success ring-success/30"
                      : "bg-secondary/50 text-secondary-foreground ring-border"
                }`}
              >
                {w.text}
              </div>
            ))}
          </div>
        </aside>
      </div>
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
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "accent" | "primary" | "warning";
}) {
  const bar = tone === "accent" ? "bg-accent" : tone === "primary" ? "bg-primary" : "bg-warning";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold">{value}%</span>
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
