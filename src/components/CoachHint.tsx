import type { Hint } from "@/lib/api";

const sourceLabel = (hint: Hint) => (hint.source === "meta" ? "AI coach" : "Basic hint");

function HintBody({ hint }: { hint: Hint }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">{hint.approach}</p>
      <p className="rounded-md bg-secondary/50 px-3 py-2 italic">{hint.example}</p>
      <p className="text-xs text-muted-foreground">{hint.reason}</p>
    </div>
  );
}

function SourceLabel({ hint }: { hint: Hint }) {
  return (
    <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-accent">
      {sourceLabel(hint)}
    </span>
  );
}

export function CoachHint({
  hints,
  earlier,
  earlierLabel,
  pending,
  failure,
}: {
  // Saved hints at the current head, attempt 1 first.
  hints: Hint[];
  // A hint from before this turn, shown only while its replacement is loading.
  earlier?: Hint | undefined;
  earlierLabel: string;
  pending: boolean;
  failure: string | null;
}) {
  const current = hints.at(-1);
  const first = hints.length > 1 ? hints[0] : undefined;

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" className="space-y-3">
        {pending && <p className="text-sm text-muted-foreground">Getting a hint…</p>}
        {failure && <p className="text-sm text-warning">{failure}</p>}
        {current && (
          <div className="space-y-2 rounded-lg p-3 ring-1 ring-accent/30">
            <SourceLabel hint={current} />
            <HintBody hint={current} />
          </div>
        )}
      </div>
      {!current && !pending && !failure && (
        <p className="text-sm text-muted-foreground">
          Stuck on what to say next? Ask for a hint at any point.
        </p>
      )}
      {first && (
        <details className="rounded-lg p-3 text-sm ring-1 ring-border">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            First approach
          </summary>
          <div className="mt-2 space-y-2">
            <SourceLabel hint={first} />
            <HintBody hint={first} />
          </div>
        </details>
      )}
      {!current && earlier && (
        <div className="space-y-2 rounded-lg p-3 opacity-70 ring-1 ring-border">
          <p className="text-xs font-semibold text-muted-foreground">{earlierLabel}</p>
          <SourceLabel hint={earlier} />
          <HintBody hint={earlier} />
        </div>
      )}
    </div>
  );
}
