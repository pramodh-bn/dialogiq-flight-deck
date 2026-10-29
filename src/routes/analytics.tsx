import { createFileRoute, Link } from "@tanstack/react-router";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Skill Analytics — DialogIQ" },
      { name: "description", content: "Track your communication mastery over time: open questions, empathy, and de-escalation." },
      { property: "og:title", content: "Skill Analytics — DialogIQ" },
      { property: "og:description", content: "Track your communication mastery over time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Analytics,
});

const days = Array.from({ length: 30 }, (_, i) => {
  const open = Math.round(52 + i * 0.9 + Math.sin(i * 1.3) * 5);
  return {
    day: `Oct ${i + 1}`,
    open,
    closed: 100 - open,
    deesc: Math.round(40 + i * 1.2 + Math.cos(i * 0.9) * 6),
  };
});

const metrics = [
  { label: "Overall Competency", value: "74%", delta: "+6% this week", good: true },
  { label: "Avg Open-Question Ratio", value: "78%", delta: "Target > 75% ✓", good: true },
  { label: "Empathy & De-escalation", value: "68", delta: "+4 pts this week", good: true },
  { label: "Simulations Completed", value: "42", delta: "9 this week", good: true },
];

const blindSpots = [
  { title: "Closed questions under timeline pressure", detail: "When challenged on deadlines, 64% of your follow-ups become yes/no questions.", freq: "Seen in 11 sims", severity: "High" },
  { title: "Interrupting defensive personas too early", detail: "You respond within 1 turn of pushback instead of letting the persona finish venting.", freq: "Seen in 8 sims", severity: "Medium" },
  { title: "Solutioning before validating", detail: "Proposing fixes before naming the other person's emotion drops trust by ~20%.", freq: "Seen in 6 sims", severity: "Medium" },
  { title: "Blame-framed summaries", detail: "Phrases like “So you're saying it's their fault” trigger dead-end loops.", freq: "Seen in 4 sims", severity: "Low" },
];

const modules = [
  { title: "Deadline Pressure Drill", persona: "Bob · Defensive", focus: "Open questions under stress", mins: 8 },
  { title: "Let Them Vent", persona: "Priya · Emotional", focus: "Strategic silence", mins: 6 },
  { title: "Validate First", persona: "Teenage Daughter · Sarcastic", focus: "Emotion labeling", mins: 7 },
  { title: "Neutral Reframing", persona: "Vendor · Assertive", focus: "Blame-free summaries", mins: 10 },
  { title: "Curiosity Ladder", persona: "Marcus · Disappointed", focus: "Follow-up depth", mins: 9 },
  { title: "Boundary with Warmth", persona: "Neighbor · Irritated", focus: "Firm + kind language", mins: 6 },
];

const sev: Record<string, string> = {
  High: "bg-destructive/10 text-destructive ring-destructive/30",
  Medium: "bg-warning/10 text-warning ring-warning/30",
  Low: "bg-secondary text-secondary-foreground ring-border",
};

const tooltipStyle = { background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };

function Analytics() {
  return (
    <div className="min-h-screen bg-background bg-ambient">
      <header className="sticky top-0 z-20 border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand font-extrabold text-primary-foreground glow">D</div>
            <span className="text-lg font-bold tracking-tight">Dialog<span className="text-brand">IQ</span></span>
          </Link>
          <nav className="mx-auto hidden gap-1 rounded-full border border-border bg-secondary/50 p-1 md:flex">
            <Link to="/" className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">Active Scenarios</Link>
            <span className="rounded-full bg-card px-4 py-1.5 text-sm font-medium shadow ring-1 ring-border">Skill Analytics</span>
            <Link to="/flight-recorder" className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">Past Simulations</Link>
          </nav>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-sm font-semibold ring-2 ring-primary/40">PN</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Last 30 days</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Skill Analytics</h1>
          <p className="text-sm text-muted-foreground">Your communication mastery, measured across every simulation.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="bento p-5 transition-transform hover:-translate-y-0.5">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className="mt-1 text-3xl font-bold">{m.value}</p>
              <p className="mt-1 text-xs text-success">{m.delta}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="bento p-5">
            <h2 className="font-semibold">Open vs. Closed Questions</h2>
            <p className="mb-4 text-xs text-muted-foreground">Share of questions asked per day</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={days}>
                  <defs>
                    <linearGradient id="gOpen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gClosed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-chart-4)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-chart-4)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} interval={6} tickLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit="%" tickLine={false} domain={[0, 100]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <ReferenceLine y={75} stroke="var(--color-success)" strokeDasharray="4 4" label={{ value: "Target 75%", fill: "var(--color-success)", fontSize: 10, position: "insideTopLeft" }} />
                  <Area type="monotone" dataKey="open" name="Open" stroke="var(--color-chart-2)" strokeWidth={2} fill="url(#gOpen)" />
                  <Area type="monotone" dataKey="closed" name="Closed" stroke="var(--color-chart-4)" strokeWidth={2} fill="url(#gClosed)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="bento p-5">
            <h2 className="font-semibold">De-escalation Success Rate</h2>
            <p className="mb-4 text-xs text-muted-foreground">Simulations where persona resistance dropped below 30%</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={days}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} interval={6} tickLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit="%" tickLine={false} domain={[0, 100]} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="deesc" name="De-escalation" stroke="var(--color-chart-1)" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section>
          <h2 className="mb-3 font-semibold">Behavioral Blind Spots</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {blindSpots.map((b) => (
              <div key={b.title} className="bento p-5 transition-colors hover:border-warning/40">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium">{b.title}</h3>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 ${sev[b.severity]}`}>{b.severity}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{b.detail}</p>
                <p className="mt-3 font-mono text-[11px] text-accent">{b.freq}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-1 font-semibold">Recommended Training Modules</h2>
          <p className="mb-3 text-xs text-muted-foreground">Generated from your weakest patterns</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <div key={m.title} className="bento group flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40">
                <p className="font-mono text-[10px] uppercase tracking-widest text-accent">{m.focus}</p>
                <h3 className="mt-1 font-semibold">{m.title}</h3>
                <p className="text-sm text-muted-foreground">{m.persona} · {m.mins} min</p>
                <Link to="/arena" className="mt-4 rounded-lg bg-primary px-3 py-2 text-center text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/85">Start Drill</Link>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
