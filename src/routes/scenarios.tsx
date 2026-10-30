import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { scenarios, type Scenario } from "@/lib/scenarios";

export const Route = createFileRoute("/scenarios")({
  head: () => ({
    meta: [
      { title: "Scenario Hub — DialogIQ" },
      { name: "description", content: "Pick a hard conversation to practice and launch it in the Simulation Arena." },
      { property: "og:title", content: "Scenario Hub — DialogIQ" },
      { property: "og:description", content: "Pick a hard conversation to practice in the Simulation Arena." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Hub,
});

const diffStyle: Record<Scenario["difficulty"], string> = {
  Easy: "bg-success/10 text-success ring-success/30",
  Medium: "bg-warning/10 text-warning ring-warning/30",
  Hard: "bg-destructive/10 text-destructive ring-destructive/30",
};

function Hub() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function launch(id: string) {
    setLoading(id);
    setError("");
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: id }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { sessionId: string };
      navigate({ to: "/arena", search: { scenario: id, session: data.sessionId } });
    } catch {
      setError("Couldn't start that session. Please try again.");
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-background bg-ambient">
      <header className="border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">← Dashboard</Link>
          <span className="font-semibold">Scenario Hub</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Choose your sparring partner</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Practice Scenarios</h1>
        <p className="text-sm text-muted-foreground">{scenarios.length} scenarios · select one to enter the arena</p>
        {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {scenarios.map((s) => (
            <button key={s.id} onClick={() => launch(s.id)} disabled={loading !== null}
              className="bento group flex flex-col p-5 text-left transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[var(--shadow-glow)] disabled:opacity-60">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${diffStyle[s.difficulty]}`}>{s.difficulty}</span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {s.status === "Completed" ? "✓ Completed" : s.status}
                </span>
              </div>
              <h2 className="mt-3 font-semibold">{s.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{s.context}</p>

              <div className="mt-4 rounded-xl border border-border bg-secondary/40 p-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 font-bold text-primary ring-1 ring-primary/30">{s.persona.name[0]}</div>
                  <div>
                    <p className="text-sm font-semibold">{s.persona.name}</p>
                    <p className="text-xs text-muted-foreground">{s.persona.role}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs"><span className="text-accent">Hidden tension:</span> <span className="text-muted-foreground">{s.persona.tension}</span></p>
              </div>

              <div className="mt-4">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Best run</span>
                  <span className="font-mono">{s.best === null ? "Not attempted" : `${s.best}/7 nodes revealed`}</span>
                </div>
                <div className="mt-1.5 flex gap-1">
                  {Array.from({ length: 7 }).map((_, i) => (
                    <span key={i} className={`h-1.5 flex-1 rounded-full ${s.best !== null && i < s.best ? "bg-brand" : "bg-muted"}`} />
                  ))}
                </div>
              </div>

              <span className="mt-5 rounded-lg bg-primary px-3 py-2 text-center text-xs font-semibold text-primary-foreground transition-colors group-hover:bg-primary/85">
                {loading === s.id ? "Starting session…" : "Enter Arena →"}
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
