import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  type ReactFlowInstance,
  Background,
  Controls,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  api,
  type Coaching,
  type CreateBranchRequest,
  type PracticeSession,
  type SelectBranchRequest,
  type Tree,
  type TurnNode,
} from "@/lib/api";
import {
  blindSpots,
  branchChain,
  containingBranch,
  failureAction,
  failureMessage,
  reconcileAction,
  retainedActions,
  type RetainedAction,
  layoutTree,
  refreshSession,
  scenarioQuery,
  sessionQuery,
  storeSession,
  treeQuery,
} from "@/lib/practice";

type RecorderSearch = { sessionId?: number | undefined };

export const Route = createFileRoute("/flight-recorder")({
  validateSearch: (search: Record<string, unknown>): RecorderSearch => {
    const id = Number(search["sessionId"]);
    // Explicit undefined: the router keeps the raw value of any key left out here.
    return { sessionId: Number.isInteger(id) && id > 0 ? id : undefined };
  },
  head: () => ({
    meta: [
      { title: "Flight Recorder — DialogIQ" },
      {
        name: "description",
        content: "Explore the branching tree of your conversation simulation turn by turn.",
      },
      { property: "og:title", content: "Flight Recorder — DialogIQ" },
      {
        property: "og:description",
        content: "Explore the branching tree of your conversation simulation turn by turn.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FlightRecorder,
});

type Kind = Coaching["outcome"];

const palette: Record<Kind, { ring: string; dot: string; label: string; stroke: string }> = {
  breakthrough: {
    ring: "border-success/60 bg-success/10",
    dot: "bg-success",
    label: "Breakthrough",
    stroke: "var(--color-success)",
  },
  deadend: {
    ring: "border-destructive/60 bg-destructive/10",
    dot: "bg-destructive",
    label: "Dead-end",
    stroke: "var(--color-destructive)",
  },
  neutral: {
    ring: "border-primary/60 bg-primary/10",
    dot: "bg-primary",
    label: "Neutral",
    stroke: "var(--color-primary)",
  },
};

function tagFor({ empathy, question_type }: Coaching) {
  if (empathy) return "Empathy" as const;
  return question_type === "open"
    ? ("Open" as const)
    : question_type === "closed"
      ? ("Closed" as const)
      : ("Statement" as const);
}

type TurnNodeData = { t: TurnNode; selected: boolean; dimmed: boolean };

function TurnCard({ data }: NodeProps<Node<TurnNodeData>>) {
  const { t, selected, dimmed } = data;
  const p = palette[t.coaching.outcome];
  return (
    <div
      className={`w-56 cursor-pointer rounded-xl border-2 p-3 backdrop-blur transition-all hover:-translate-y-0.5 ${p.ring} ${selected ? "ring-2 ring-accent glow" : ""} ${dimmed ? "opacity-50" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="!border-0 !bg-muted-foreground" />
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-mono text-muted-foreground">TURN {t.turn_number}</span>
        <span className="flex items-center gap-1 text-foreground">
          <span className={`h-2 w-2 rounded-full ${p.dot}`} />
          {p.label}
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-medium text-foreground">“{t.user_text}”</p>
      <Handle type="source" position={Position.Bottom} className="!border-0 !bg-muted-foreground" />
    </div>
  );
}

function OpeningCard({ data }: NodeProps<Node<{ text: string }>>) {
  return (
    <div className="w-56 rounded-xl border-2 border-border bg-secondary/40 p-3">
      <span className="font-mono text-[10px] text-muted-foreground">OPENING</span>
      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">“{data.text}”</p>
      <Handle type="source" position={Position.Bottom} className="!border-0 !bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { turn: TurnCard, opening: OpeningCard };
const OPENING_ID = "opening";

function FlightRecorder() {
  const { sessionId } = Route.useSearch();
  if (!sessionId) {
    return (
      <RecorderMessage
        title="No session selected"
        detail="Open a scenario's branch tree from the dashboard."
      />
    );
  }
  return <Recorder key={sessionId} sessionId={sessionId} />;
}

type RecorderRequest =
  | ({ route: "rewind" } & CreateBranchRequest)
  | ({ route: "select" } & SelectBranchRequest);

// Matches max-w-sm on the drawer.
const DRAWER_WIDTH = 384;

function Recorder({ sessionId }: { sessionId: number }) {
  const client = useQueryClient();
  const session = useQuery(sessionQuery(sessionId));
  const tree = useQuery(treeQuery(sessionId));
  const scenario = useQuery({
    ...scenarioQuery(session.data?.scenario_id ?? 0),
    enabled: session.data !== undefined,
  });

  if (session.error || tree.error) {
    return (
      <RecorderMessage
        title="Couldn't load this session"
        detail="It may no longer exist, or the simulator may be offline."
      >
        <button
          onClick={() => void refreshSession(client, sessionId)}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow"
        >
          Try again
        </button>
      </RecorderMessage>
    );
  }
  if (scenario.error && !scenario.data) {
    return (
      <RecorderMessage
        title="Couldn't load this scenario"
        detail="Your recorded turns are safe. The scenario details are unavailable right now."
      >
        <button
          disabled={scenario.isFetching}
          onClick={() => void scenario.refetch()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow disabled:opacity-60"
        >
          {scenario.isFetching ? "Trying again…" : "Try again"}
        </button>
      </RecorderMessage>
    );
  }
  if (!session.data || !tree.data || !scenario.data) {
    return <RecorderMessage title="Loading session…" detail="Reading the recorded turns." />;
  }
  return (
    <RecorderView
      session={session.data}
      tree={tree.data}
      title={scenario.data.title}
      opening={scenario.data.persona.opening_message}
      personaName={scenario.data.persona.name}
    />
  );
}

function RecorderView({
  session,
  tree,
  title,
  opening,
  personaName,
}: {
  session: PracticeSession;
  tree: Tree;
  title: string;
  opening: string;
  personaName: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const canvas = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance | null>(null);
  const retained = useMemo(
    () => retainedActions<RecorderRequest>(`recorder:${session.id}`),
    [session.id],
  );
  const checkedRetained = useRef(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = tree.nodes.find((n) => n.id === selectedId) ?? null;
  const activeBranch = tree.branches.find((b) => b.id === tree.active_branch_id);
  const viewed = (selected && containingBranch(tree, selected.id)) ?? activeBranch;
  const chain = useMemo(
    () => branchChain(tree.nodes, viewed?.head_node_id ?? null),
    [tree.nodes, viewed?.head_node_id],
  );
  const onChain = useMemo(() => new Set(chain.map((n) => n.id)), [chain]);

  const nodes: Node[] = useMemo(() => {
    const positions = layoutTree(tree.nodes);
    const root: Node = {
      id: OPENING_ID,
      type: "opening",
      position: positions.get(null) ?? { x: 0, y: 0 },
      data: { text: opening },
    };
    const turns = tree.nodes.map((t): Node => ({
      id: String(t.id),
      type: "turn",
      position: positions.get(t.id) ?? { x: 0, y: 0 },
      data: { t, selected: t.id === selectedId, dimmed: !onChain.has(t.id) },
    }));
    return [root, ...turns];
  }, [tree.nodes, opening, selectedId, onChain]);

  const edges: Edge[] = useMemo(
    () =>
      tree.nodes.map((t) => {
        const stroke = palette[t.coaching.outcome].stroke;
        const source = t.parent_id === null ? OPENING_ID : String(t.parent_id);
        return {
          id: `${source}-${t.id}`,
          source,
          target: String(t.id),
          type: "smoothstep",
          animated: t.coaching.outcome === "breakthrough",
          style: { stroke, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        };
      }),
    [tree.nodes],
  );

  function perform(entry: RetainedAction<RecorderRequest>): Promise<PracticeSession> {
    const { route, ...body } = entry.request;
    return route === "rewind"
      ? api
          .createBranch(session.id, body as CreateBranchRequest, entry.key)
          .then((res) => res.session)
      : api.selectBranch(session.id, body as SelectBranchRequest, entry.key);
  }

  async function finish(next: PracticeSession) {
    storeSession(client, next);
    await refreshSession(client, session.id);
    await navigate({ to: "/arena", search: { sessionId: session.id } });
  }

  // Returns a message when the learner needs one. A branch that was created is finished as
  // normal, and one that was not can be requested again unchanged.
  async function reconcile(entry: RetainedAction<RecorderRequest>): Promise<string | null> {
    const outcome = await reconcileAction(
      entry,
      () => api.getSession(session.id).then((s) => s.revision),
      () => perform(entry),
    );
    if (outcome.kind === "recovered") {
      retained.settle(entry);
      await finish(outcome.result);
      return null;
    }
    if (outcome.kind === "state_changed") {
      retained.settle(entry);
      void refreshSession(client, session.id);
      return failureMessage(outcome.error);
    }
    void refreshSession(client, session.id);
    return "Couldn't confirm that action. Try again.";
  }

  // A reload can leave an action unresolved.
  useEffect(() => {
    if (checkedRetained.current) return;
    checkedRetained.current = true;
    const entry = retained.peek();
    if (!entry) return;
    setWorking(true);
    void reconcile(entry)
      .then(setNotice)
      .finally(() => setWorking(false));
    // reconcile only reads stable values, and this runs once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retained]);

  async function act(action: string, build: () => RecorderRequest) {
    if (working) return;
    setWorking(true);
    setNotice(null);
    const entry = retained.begin(action, build);
    try {
      const next = await perform(entry);
      retained.settle(entry);
      await finish(next);
    } catch (error) {
      if (failureAction(error) === "retry") {
        setNotice(await reconcile(entry));
      } else {
        retained.settle(entry);
        setNotice(failureMessage(error));
        void refreshSession(client, session.id);
      }
    } finally {
      setWorking(false);
    }
  }

  function rewindTo(target: number | null) {
    if (!viewed) return;
    const source = viewed.id;
    void act(`rewind:${source}:${target}`, () => ({
      route: "rewind",
      source_branch_id: source,
      rewind_to_node_id: target,
      expected_revision: tree.revision,
    }));
  }

  function resumeBranch() {
    if (!viewed) return;
    const branch = viewed.id;
    void act(`select:${branch}`, () => ({
      route: "select",
      branch_id: branch,
      expected_revision: tree.revision,
    }));
  }

  const spots = blindSpots(chain);
  const tag = selected ? tagFor(selected.coaching) : null;

  // The drawer opens over the canvas, so center the node in what is left. When the drawer
  // fills the canvas there is nothing left to center in, and closing it shows the node again.
  function centerBesideDrawer(id: string) {
    const width = canvas.current?.clientWidth ?? 0;
    const instance = flow.current;
    const drawer = Math.min(width, DRAWER_WIDTH);
    const space = width - drawer;
    if (!instance || space < 120) return;
    const zoom = instance.getZoom();
    const box = instance.getNodesBounds([id]);
    // A node wider than the space keeps its start in view.
    const onScreen = Math.max(space / 2, 16 + (box.width * zoom) / 2);
    instance.setCenter(
      box.x + box.width / 2 + (width / 2 - onScreen) / zoom,
      box.y + box.height / 2,
      { zoom, duration: 250 },
    );
  }

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
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
              Flight Recorder
            </p>
            <h1 className="font-semibold">{title}</h1>
          </div>
          <p className="hidden text-xs text-muted-foreground [@media(max-height:640px)]:block">
            {tree.nodes.length} turns · {viewed?.score ?? 0}/{viewed?.total_needs ?? 7}
          </p>
          <Link
            to="/arena"
            search={{ sessionId: session.id }}
            className="ml-auto rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground glow"
          >
            Fly again
          </Link>
        </div>
        <div className="grid gap-3 px-6 pb-4 sm:grid-cols-3 [@media(max-height:640px)]:hidden">
          <Stat
            label="Total turns"
            value={`${tree.nodes.length}`}
            sub={`across ${tree.branches.length} ${tree.branches.length === 1 ? "branch" : "branches"}`}
          />
          <Stat
            label="Breakthrough score"
            value={`${viewed?.score ?? 0}/${viewed?.total_needs ?? 7}`}
            sub={viewed?.id === tree.active_branch_id ? "active branch" : "selected branch"}
            accent
          />
          <div className="bento p-3">
            <p className="text-[11px] text-muted-foreground">Blind spots identified</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {spots.length === 0 && (
                <span className="text-[11px] text-muted-foreground">None on this branch</span>
              )}
              {spots.map((b) => (
                <span
                  key={b}
                  className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning ring-1 ring-warning/30"
                >
                  {b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div ref={canvas} className="relative min-h-0 flex-1 overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          colorMode="dark"
          nodesDraggable={false}
          nodesConnectable={false}
          onInit={(instance) => {
            flow.current = instance;
          }}
          onNodeClick={(_, n) => {
            const opening = n.id === OPENING_ID;
            setSelectedId(opening ? null : Number(n.id));
            if (!opening) centerBesideDrawer(n.id);
          }}
          onPaneClick={() => setSelectedId(null)}
          minZoom={0.1}
          maxZoom={2}
          panOnScroll
          zoomOnScroll={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: "transparent" }}
        >
          <Background gap={24} color="var(--color-border)" />
          <Controls showInteractive={false} />
        </ReactFlow>

        <div className="pointer-events-none absolute left-4 top-4 flex gap-3 rounded-lg border border-border bg-card/80 px-3 py-2 text-[11px] backdrop-blur">
          {(Object.keys(palette) as Kind[]).map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${palette[k].dot}`} />
              {palette[k].label}
            </span>
          ))}
        </div>

        {tree.nodes.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-sm text-muted-foreground">
            No turns recorded yet. Fly the session to fill in the tree.
          </p>
        )}

        <aside
          className={`absolute right-0 top-0 h-full w-full max-w-sm border-l border-border bg-card/95 backdrop-blur-xl transition-transform duration-300 ${selected ? "translate-x-0" : "translate-x-full"}`}
        >
          {selected && tag && (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border p-4">
                <div>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    TURN {selected.turn_number}
                  </p>
                  <p className="flex items-center gap-1.5 font-semibold">
                    <span
                      className={`h-2 w-2 rounded-full ${palette[selected.coaching.outcome].dot}`}
                    />
                    {palette[selected.coaching.outcome].label}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedId(null)}
                  aria-label="Close"
                  className="rounded-md px-2 text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 space-y-5 overflow-y-auto p-4">
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Transcript
                  </h3>
                  <div className="space-y-2">
                    <div className="ml-6 rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                      <span className="block text-[10px] opacity-70">You</span>
                      {selected.user_text}
                    </div>
                    <div className="mr-6 rounded-2xl bg-secondary/70 px-3 py-2 text-sm">
                      <span className="block text-[10px] text-muted-foreground">{personaName}</span>
                      {selected.character_text}
                    </div>
                  </div>
                </section>
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Pedagogical tag
                  </h3>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs ring-1 ${tag === "Closed" ? "bg-warning/10 text-warning ring-warning/30" : tag === "Statement" ? "bg-secondary text-secondary-foreground ring-border" : "bg-success/10 text-success ring-success/30"}`}
                  >
                    {tag === "Statement"
                      ? "Statement"
                      : `${tag} ${tag === "Empathy" ? "marker" : "question"}`}
                  </span>
                </section>
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Needs uncovered · {selected.score}/{selected.total_needs}
                  </h3>
                  {selected.revealed_needs.length === 0 && (
                    <p className="text-sm text-muted-foreground">None yet at this turn.</p>
                  )}
                  <ul className="space-y-2">
                    {selected.revealed_needs.map((need) => (
                      <li key={need.id} className="text-sm">
                        <span className="font-medium">{need.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {need.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Suggested alternatives
                  </h3>
                  <ul className="space-y-2">
                    {selected.coaching.alternatives.map((a) => (
                      <li
                        key={a}
                        className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-sm"
                      >
                        {a}
                      </li>
                    ))}
                  </ul>
                </section>
                {notice && (
                  <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning ring-1 ring-warning/30">
                    {notice}
                  </p>
                )}
              </div>
              <div className="space-y-2 border-t border-border p-4">
                {viewed && viewed.id !== tree.active_branch_id && (
                  <button
                    onClick={resumeBranch}
                    disabled={working}
                    className="w-full rounded-lg border border-accent/50 px-3 py-2 text-sm text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
                  >
                    Resume this branch
                  </button>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => rewindTo(selected.id)}
                    disabled={working}
                    className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-accent/50 hover:text-accent disabled:opacity-40"
                  >
                    Branch from here
                  </button>
                  <button
                    onClick={() => rewindTo(selected.parent_id)}
                    disabled={working}
                    className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-primary-foreground glow disabled:opacity-40"
                  >
                    Rewind to this node
                  </button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function RecorderMessage({
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

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="bento p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${accent ? "text-success" : ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}
