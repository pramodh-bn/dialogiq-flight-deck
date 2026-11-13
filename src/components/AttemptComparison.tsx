import { useState } from "react";

import type { Tree } from "@/lib/api";
import { type AttemptSummary, compareAttempts } from "@/lib/compare";

function Column({ label, s }: { label: string; s: AttemptSummary }) {
  const rows: [string, string][] = [
    ["Turns", `${s.turns.length}`],
    ["Open / yes-no questions", `${s.openQuestions} / ${s.closedQuestions}`],
    ["Concerns acknowledged", `${s.acknowledgments}`],
    ["Pressure turns", `${s.pressureTurns}`],
    ["Bob's stance at the end", s.finalStance ?? "—"],
  ];
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <p className="text-sm font-semibold">{label}</p>
      {s.firstLine ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">You said</p>
          <p className="rounded bg-muted/30 p-2">{s.firstLine}</p>
          <p className="text-muted-foreground">Bob answered</p>
          <p className="rounded bg-muted/30 p-2">{s.firstReply}</p>
        </div>
      ) : (
        <p className="text-muted-foreground">No turns after the shared part.</p>
      )}
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="text-muted-foreground">New concerns Bob shared</p>
        {s.newlyRevealed.length === 0 ? (
          <p>None</p>
        ) : (
          <ul className="list-inside list-disc">
            {s.newlyRevealed.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Two attempts at the same moment, side by side. Needs at least two branches. */
export function AttemptComparison({
  tree,
  viewedBranchId,
}: {
  tree: Tree;
  viewedBranchId: number;
}) {
  const others = tree.branches.filter((b) => b.id !== viewedBranchId);
  const [otherId, setOtherId] = useState<number | null>(null);
  if (others.length === 0) return null;
  const chosen = others.find((b) => b.id === otherId) ?? others[0];
  if (!chosen) return null;
  const result = compareAttempts(tree, chosen.id, viewedBranchId);
  const number = (id: number) => tree.branches.findIndex((b) => b.id === id) + 1;
  return (
    <section className="space-y-2" aria-label="Compare attempts">
      <h3 className="text-xs font-semibold text-muted-foreground">Compare attempts</h3>
      {others.length > 1 && (
        <select
          aria-label="Compare with"
          value={chosen.id}
          onChange={(e) => setOtherId(Number(e.target.value))}
          className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs"
        >
          {others.map((b) => (
            <option key={b.id} value={b.id}>
              Attempt {number(b.id)}
            </option>
          ))}
        </select>
      )}
      {result && (
        <>
          <p className="text-xs text-muted-foreground">
            Same first {result.sharedTurns} {result.sharedTurns === 1 ? "turn" : "turns"}; they part
            after that.
          </p>
          <div className="grid gap-2">
            <Column label={`Attempt ${number(chosen.id)}`} s={result.a} />
            <Column label={`Attempt ${number(viewedBranchId)} (this one)`} s={result.b} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Bob is a simulation. A real person may react differently to the same words.
          </p>
        </>
      )}
    </section>
  );
}
