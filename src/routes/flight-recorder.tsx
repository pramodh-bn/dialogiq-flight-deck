import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/flight-recorder")({
  head: () => ({
    meta: [
      { title: "Flight Recorder — DialogIQ" },
      { name: "description", content: "Review the branching tree of your last conversation simulation." },
      { property: "og:title", content: "Flight Recorder — DialogIQ" },
      { property: "og:description", content: "Review the branching tree of your last conversation simulation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FlightRecorder,
});

const nodes = [
  { turn: 1, you: "Can we talk about the Q3 deadlines?", tone: "Closed", outcome: "Bob deflected" },
  { turn: 2, you: "What's been getting in the way lately?", tone: "Open", outcome: "Bob opened up about dependencies" },
  { turn: 3, you: "How could I support you better?", tone: "Open", outcome: "Breakthrough" },
];

function FlightRecorder() {
  return (
    <div className="min-h-screen bg-background bg-ambient">
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
        <p className="mt-6 font-mono text-xs uppercase tracking-widest text-accent">Flight Recorder</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Bob: Defensive Team Member</h1>
        <p className="text-sm text-muted-foreground">Your conversation path, turn by turn.</p>
        <ol className="mt-8 space-y-4 border-l border-border pl-6">
          {nodes.map((n) => (
            <li key={n.turn} className="bento relative p-4">
              <span className="absolute -left-[33px] top-5 h-3 w-3 rounded-full bg-accent glow" />
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-muted-foreground">TURN {n.turn}</span>
                <span className={`rounded-full px-2 py-0.5 ring-1 ${n.tone === "Open" ? "bg-success/10 text-success ring-success/30" : "bg-warning/10 text-warning ring-warning/30"}`}>{n.tone}</span>
              </div>
              <p className="mt-2 font-medium">"{n.you}"</p>
              <p className="mt-1 text-sm text-muted-foreground">→ {n.outcome}</p>
            </li>
          ))}
        </ol>
        <Link to="/arena" className="mt-8 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow">Fly again</Link>
      </main>
    </div>
  );
}
