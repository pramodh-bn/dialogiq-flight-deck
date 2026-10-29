import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ReactFlow, Background, Controls, MarkerType, Handle, Position,
  type Node, type Edge, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export const Route = createFileRoute("/flight-recorder")({
  head: () => ({
    meta: [
      { title: "Flight Recorder — DialogIQ" },
      { name: "description", content: "Explore the branching tree of your conversation simulation turn by turn." },
      { property: "og:title", content: "Flight Recorder — DialogIQ" },
      { property: "og:description", content: "Explore the branching tree of your conversation simulation turn by turn." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FlightRecorder,
});

type Kind = "breakthrough" | "deadend" | "neutral";
type Turn = {
  id: string; parent?: string; turn: number; kind: Kind; tag: "Open" | "Closed" | "Statement" | "Empathy";
  you: string; bob: string; alternatives: string[]; x: number; y: number;
};

const turns: Turn[] = [
  { id: "t1", turn: 1, kind: "neutral", tag: "Statement", x: 360, y: 0,
    you: "Thanks for coming in, Bob. I wanted to talk about Q3.",
    bob: "If this is about the deadlines, I already sent the update.",
    alternatives: ["“Before we dig in — how has this quarter felt for you?”"] },
  { id: "t2a", parent: "t1", turn: 2, kind: "deadend", tag: "Closed", x: 0, y: 160,
    you: "Did you know the deadlines were slipping?",
    bob: "Yes. Obviously. But it wasn't my fault.",
    alternatives: ["“What did you notice as the deadlines started slipping?”", "“Walk me through how the timeline unfolded.”"] },
  { id: "t3a", parent: "t2a", turn: 3, kind: "deadend", tag: "Closed", x: 0, y: 320,
    you: "Is there a reason you didn't flag it earlier?",
    bob: "I don't know. Are we done here?",
    alternatives: ["“It sounds like flagging it didn't feel safe — what would have made it easier?”"] },
  { id: "t2b", parent: "t1", turn: 2, kind: "neutral", tag: "Open", x: 360, y: 160,
    you: "What's been getting in the way lately?",
    bob: "Honestly? Design kept changing specs and I was left holding the bag.",
    alternatives: ["Add empathy: “That sounds really frustrating.”"] },
  { id: "t3b", parent: "t2b", turn: 3, kind: "breakthrough", tag: "Empathy", x: 260, y: 320,
    you: "That sounds really frustrating. How could I support you better?",
    bob: "…Thanks. I stopped asking for help because it never came. Maybe a weekly sync with design?",
    alternatives: ["“What would a good weekly sync look like for you?”"] },
  { id: "t4b", parent: "t3b", turn: 4, kind: "breakthrough", tag: "Open", x: 260, y: 480,
    you: "What would a good first step look like from your side?",
    bob: "I can draft the spec freeze checklist by Friday.",
    alternatives: ["Close with commitment: “Let's both own that — I'll set up the sync.”"] },
  { id: "t3c", parent: "t2b", turn: 3, kind: "deadend", tag: "Closed", x: 560, y: 320,
    you: "So you're blaming the design team?",
    bob: "See, this is why I don't bring stuff up.",
    alternatives: ["“Help me understand what happened between you and design.”"] },
];

const palette: Record<Kind, { ring: string; dot: string; label: string; stroke: string }> = {
  breakthrough: { ring: "border-success/60 bg-success/10", dot: "bg-success", label: "Breakthrough", stroke: "var(--color-success)" },
  deadend: { ring: "border-destructive/60 bg-destructive/10", dot: "bg-destructive", label: "Dead-end", stroke: "var(--color-destructive)" },
  neutral: { ring: "border-primary/60 bg-primary/10", dot: "bg-primary", label: "Neutral", stroke: "var(--color-primary)" },
};

type TurnNodeData = { t: Turn; selected: boolean };

function TurnNode({ data }: NodeProps<Node<TurnNodeData>>) {
  const { t, selected } = data;
  const p = palette[t.kind];
  return (
    <div className={`w-56 cursor-pointer rounded-xl border-2 p-3 backdrop-blur transition-all hover:-translate-y-0.5 ${p.ring} ${selected ? "ring-2 ring-accent glow" : ""}`}>
      <Handle type="target" position={Position.Top} className="!border-0 !bg-muted-foreground" />
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-mono text-muted-foreground">TURN {t.turn}</span>
        <span className="flex items-center gap-1 text-foreground"><span className={`h-2 w-2 rounded-full ${p.dot}`} />{p.label}</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-medium text-foreground">“{t.you}”</p>
      <Handle type="source" position={Position.Bottom} className="!border-0 !bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { turn: TurnNode };

function FlightRecorder() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const selected = turns.find((t) => t.id === selectedId) ?? null;

  const nodes: Node<TurnNodeData>[] = useMemo(() => turns.map((t) => ({
    id: t.id, type: "turn", position: { x: t.x, y: t.y }, data: { t, selected: t.id === selectedId },
  })), [selectedId]);

  const edges: Edge[] = useMemo(() => turns.filter((t) => t.parent).map((t) => ({
    id: `${t.parent}-${t.id}`, source: t.parent!, target: t.id, type: "smoothstep",
    animated: t.kind === "breakthrough",
    style: { stroke: palette[t.kind].stroke, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: palette[t.kind].stroke },
  })), []);

  const total = turns.length;
  const breakthroughs = turns.filter((t) => t.kind === "breakthrough").length;
  const score = Math.round((breakthroughs / total) * 7 * 2);

  return (
    <div className="flex h-screen flex-col bg-background bg-ambient">
      <header className="border-b border-border bg-background/70 backdrop-blur-xl">
        <div className="flex items-center gap-4 px-6 py-3">
          <Link to="/" className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">← Dashboard</Link>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Flight Recorder</p>
            <h1 className="font-semibold">Bob: Defensive Team Member</h1>
          </div>
          <Link to="/arena" className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow">Fly again</Link>
        </div>
        <div className="grid gap-3 px-6 pb-4 sm:grid-cols-3">
          <Stat label="Total turns" value={`${total}`} sub="across 3 branches" />
          <Stat label="Breakthrough score" value={`${Math.min(score, 7)}/7`} sub={`${breakthroughs} breakthrough turns`} accent />
          <div className="bento p-3">
            <p className="text-[11px] text-muted-foreground">Blind spots identified</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {["Yes/no openers", "Blame framing", "Skipping empathy"].map((b) => (
                <span key={b} className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning ring-1 ring-warning/30">{b}</span>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView colorMode="dark"
          nodesDraggable={false} nodesConnectable={false}
          onNodeClick={(_, n) => setSelectedId(n.id)} onPaneClick={() => setSelectedId(null)}
          minZoom={0.3} maxZoom={2} proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Background gap={24} color="var(--color-border)" />
          <Controls showInteractive={false} />
        </ReactFlow>

        <div className="pointer-events-none absolute left-4 top-4 flex gap-3 rounded-lg border border-border bg-card/80 px-3 py-2 text-[11px] backdrop-blur">
          {(Object.keys(palette) as Kind[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${palette[k].dot}`} />{palette[k].label}</span>
          ))}
        </div>

        <aside className={`absolute right-0 top-0 h-full w-full max-w-sm border-l border-border bg-card/95 backdrop-blur-xl transition-transform duration-300 ${selected ? "translate-x-0" : "translate-x-full"}`}>
          {selected && (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border p-4">
                <div>
                  <p className="font-mono text-[10px] text-muted-foreground">TURN {selected.turn}</p>
                  <p className="flex items-center gap-1.5 font-semibold"><span className={`h-2 w-2 rounded-full ${palette[selected.kind].dot}`} />{palette[selected.kind].label}</p>
                </div>
                <button onClick={() => setSelectedId(null)} aria-label="Close" className="rounded-md px-2 text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <div className="flex-1 space-y-5 overflow-y-auto p-4">
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Transcript</h3>
                  <div className="space-y-2">
                    <div className="ml-6 rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground"><span className="block text-[10px] opacity-70">You</span>{selected.you}</div>
                    <div className="mr-6 rounded-2xl bg-secondary/70 px-3 py-2 text-sm"><span className="block text-[10px] text-muted-foreground">Bob</span>{selected.bob}</div>
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Pedagogical tag</h3>
                  <span className={`rounded-full px-2.5 py-1 text-xs ring-1 ${selected.tag === "Closed" ? "bg-warning/10 text-warning ring-warning/30" : selected.tag === "Statement" ? "bg-secondary text-secondary-foreground ring-border" : "bg-success/10 text-success ring-success/30"}`}>
                    {selected.tag === "Statement" ? "Statement" : `${selected.tag} ${selected.tag === "Empathy" ? "marker" : "question"}`}
                  </span>
                </section>
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">AI-suggested alternatives</h3>
                  <ul className="space-y-2">
                    {selected.alternatives.map((a) => (
                      <li key={a} className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm">{a}</li>
                    ))}
                  </ul>
                </section>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-border p-4">
                <button onClick={() => navigate({ to: "/arena" })} className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-accent/50 hover:text-accent">Branch from here</button>
                <button onClick={() => navigate({ to: "/arena" })} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-primary-foreground glow">Rewind to this node</button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="bento p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${accent ? "text-success" : ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
