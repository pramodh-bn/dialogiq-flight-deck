import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { DemoBadge } from "@/components/DemoBadge";
import { api, type PracticeSession, type Scenario } from "@/lib/api";
import {
  failureAction,
  failureMessage,
  scenariosQuery,
  sessionsQuery,
  storeSession,
  useActionKeys,
} from "@/lib/practice";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DialogIQ — Communication Flight Simulator" },
      {
        name: "description",
        content:
          "Practice hard conversations, track open-question competency, and review past simulations.",
      },
      { property: "og:title", content: "DialogIQ — Communication Flight Simulator" },
      {
        property: "og:description",
        content: "Practice hard conversations and track your conversational competency.",
      },
    ],
  }),
  component: Dashboard,
});

const tabs = ["Active Scenarios", "Skill Analytics", "Past Simulations"];

const TOTAL_NODES = 7;

// Each card reflects the scenario's latest real session, or nothing yet.
function toCard(s: Scenario, latest: PracticeSession | undefined) {
  const score = latest?.score ?? 0;
  const total = latest?.total_needs ?? TOTAL_NODES;
  const turns = latest?.metrics.turns ?? 0;
  return {
    id: s.id,
    name: s.title,
    ctx: s.description ?? "",
    initials: s.persona.initials,
    tags: s.persona.tags,
    score,
    total,
    progress: Math.round((score / total) * 100),
    last: !latest ? "Not started" : turns === 1 ? "1 turn" : `${turns} turns`,
    sessionId: latest?.id,
  };
}

const history = [
  {
    name: "Bob: Defensive Team Member",
    date: "Oct 29, 2026",
    branches: 12,
    score: "6/7",
    status: "Breakthrough",
  },
  {
    name: "Teenage Daughter: Homework Friction",
    date: "Oct 28, 2026",
    branches: 9,
    score: "4/7",
    status: "Dead-end",
  },
  {
    name: "Priya: Burnout Disclosure",
    date: "Oct 26, 2026",
    branches: 14,
    score: "5/7",
    status: "Breakthrough",
  },
  {
    name: "Vendor: Contract Pushback",
    date: "Oct 24, 2026",
    branches: 7,
    score: "3/7",
    status: "Dead-end",
  },
  {
    name: "Marcus: Promotion Denied",
    date: "Oct 22, 2026",
    branches: 11,
    score: "7/7",
    status: "Breakthrough",
  },
  {
    name: "Neighbor: Noise Complaint",
    date: "Oct 20, 2026",
    branches: 5,
    score: "2/7",
    status: "Stalled",
  },
];

const statusStyle: Record<string, string> = {
  Breakthrough: "bg-success/10 text-success ring-success/30",
  "Dead-end": "bg-warning/10 text-warning ring-warning/30",
  Stalled: "bg-destructive/10 text-destructive ring-destructive/30",
};

function Dashboard() {
  const [tab, setTab] = useState(tabs[0]);
  const client = useQueryClient();
  const navigate = useNavigate();
  const keys = useActionKeys();
  const [starting, setStarting] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { data, isPending, isError } = useQuery(scenariosQuery());
  const sessionLists = useQueries({
    queries: (data ?? []).map((s) => sessionsQuery(s.id)),
  });
  const scenarios = (data ?? []).map((s, i) => toCard(s, sessionLists[i]?.data?.[0]));

  async function startSession(scenarioId: number) {
    if (starting !== null) return;
    const action = `new:${scenarioId}`;
    setStarting(scenarioId);
    setStartError(null);
    try {
      const session = await api.createSession({ scenario_id: scenarioId }, keys.keyFor(action));
      keys.release(action);
      storeSession(client, session);
      void client.invalidateQueries({ queryKey: ["sessions", scenarioId] });
      await navigate({ to: "/arena", search: { sessionId: session.id } });
    } catch (error) {
      if (failureAction(error) !== "retry") keys.release(action);
      setStartError(failureMessage(error));
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="min-h-screen bg-background bg-ambient">
      <header className="sticky top-0 z-20 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand font-extrabold text-primary-foreground glow">
              D
            </div>
            <span className="text-lg font-bold tracking-tight">
              Dialog<span className="text-brand">IQ</span>
            </span>
            <span className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
              V2 ENGINE
            </span>
          </div>
          <nav className="mx-auto hidden gap-1 rounded-full border border-border bg-secondary/50 p-1 md:flex">
            {tabs.map((t) =>
              t === "Skill Analytics" ? (
                <Link
                  key={t}
                  to="/analytics"
                  className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all hover:text-foreground"
                >
                  {t}
                </Link>
              ) : (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${tab === t ? "bg-card text-foreground shadow ring-1 ring-border" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t}
                </button>
              ),
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow transition-transform hover:-translate-y-0.5">
              + New Scenario
            </button>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-sm font-semibold ring-2 ring-primary/40">
              PN
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">
            THURSDAY · CONVERSATION DECK
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Welcome back, Pramodh</h1>
          <p className="text-sm text-muted-foreground">{scenarios.length} active scenarios</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="bento p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Active Practice Scenarios</h2>
              <span className="text-xs text-muted-foreground">Sorted by recent</span>
            </div>
            {isPending && <p className="text-sm text-muted-foreground">Loading scenarios…</p>}
            {isError && (
              <p className="text-sm text-destructive">
                Couldn't load scenarios from the simulator.
              </p>
            )}
            {startError && <p className="mb-3 text-sm text-destructive">{startError}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              {scenarios.map((s) => (
                <article
                  key={s.id}
                  className="group rounded-xl border border-border bg-secondary/40 p-4 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:bg-secondary/70 hover:shadow-[var(--shadow-glow)]"
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 font-bold text-primary ring-1 ring-primary/30">
                      {s.initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{s.name}</h3>
                      <p className="truncate text-xs text-muted-foreground">{s.ctx}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[11px] text-success ring-1 ring-success/30">
                      {s.score}/{s.total} Breakthrough
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {s.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-md border border-accent/25 bg-accent/5 px-2 py-0.5 text-[11px] text-accent"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${s.progress}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                    <span>{s.progress}% mapped</span>
                    <span>{s.last}</span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => void startSession(s.id)}
                      disabled={starting !== null}
                      className="flex-1 rounded-lg border border-primary/40 px-3 py-2 text-center text-xs font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
                    >
                      {starting === s.id ? "Starting…" : "New Session"}
                    </button>
                    {s.sessionId ? (
                      <>
                        <Link
                          to="/arena"
                          search={{ sessionId: s.sessionId }}
                          className="flex-1 rounded-lg bg-primary px-3 py-2 text-center text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
                        >
                          Resume Practice
                        </Link>
                        <Link
                          to="/flight-recorder"
                          search={{ sessionId: s.sessionId }}
                          className="flex-1 rounded-lg border border-border px-3 py-2 text-center text-xs font-medium text-secondary-foreground transition-colors hover:border-accent/50 hover:text-accent"
                        >
                          View Branch Tree
                        </Link>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 cursor-not-allowed rounded-lg bg-primary/40 px-3 py-2 text-center text-xs font-semibold text-primary-foreground/70">
                          Resume Practice
                        </span>
                        <span className="flex-1 cursor-not-allowed rounded-lg border border-border px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                          View Branch Tree
                        </span>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="bento flex flex-col p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Conversational Competency</h2>
              <DemoBadge />
            </div>
            <p className="text-xs text-muted-foreground">Open-ended question ratio · today</p>
            <div className="relative mx-auto my-6 h-44 w-44">
              <svg viewBox="0 0 100 100" className="-rotate-90">
                <defs>
                  <linearGradient id="g" x1="0" x2="1">
                    <stop offset="0" stopColor="var(--primary)" />
                    <stop offset="1" stopColor="var(--accent)" />
                  </linearGradient>
                </defs>
                <circle cx="50" cy="50" r="42" fill="none" stroke="var(--muted)" strokeWidth="9" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="url(#g)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={`${0.78 * 263.9} 263.9`}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="text-4xl font-extrabold text-brand">78%</div>
                  <div className="text-xs text-muted-foreground">Open</div>
                </div>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[78%] bg-brand" />
            </div>
            <div className="mt-2 flex justify-between text-xs">
              <span className="text-accent">78% Open · 47 asked</span>
              <span className="text-muted-foreground">22% Closed · 13</span>
            </div>
            <div className="mt-5 rounded-xl border border-success/25 bg-success/5 p-3.5">
              <p className="text-sm font-semibold text-success">
                Great job avoiding conversational dead-ends today!
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                You're up 12 pts vs. last week. Try "What would help most?" over "Is that okay?" to
                push past 80%.
              </p>
            </div>
          </section>

          <section className="bento overflow-hidden lg:col-span-3">
            <div className="flex items-center justify-between p-5 pb-3">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Recent Conversation History</h2>
                <DemoBadge />
              </div>
              <button className="text-xs text-accent hover:underline">View all</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-y border-border bg-secondary/30">
                    <th className="px-5 py-3 font-medium">Scenario Name</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Branches Tried</th>
                    <th className="px-5 py-3 font-medium">Final Score</th>
                    <th className="px-5 py-3 text-right font-medium">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr
                      key={h.name + h.date}
                      className="border-b border-border/60 transition-colors last:border-0 hover:bg-secondary/40"
                    >
                      <td className="px-5 py-3.5 font-medium">{h.name}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{h.date}</td>
                      <td className="px-5 py-3.5 font-mono text-muted-foreground">{h.branches}</td>
                      <td className="px-5 py-3.5">
                        <span className="mr-2 font-mono">{h.score}</span>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ring-1 ${statusStyle[h.status]}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {h.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <button className="text-accent hover:underline">Review →</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
