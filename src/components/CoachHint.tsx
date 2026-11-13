import type { Hint } from "@/lib/api";

const sourceLabel = (hint: Hint) => (hint.source === "meta" ? "AI coach" : "Basic hint");

// Two separate groups: why it works (plain) first, then what to say (highlighted).
function HintBody({ hint }: { hint: Hint }) {
  return (
    <div className="space-y-4 text-sm">
      <section
        aria-label="Why it works"
        data-testid="hint-why"
        className="space-y-1 border-l-4 border-muted-foreground/40 pl-3"
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Why this works
        </p>
        <p className="leading-relaxed">{hint.reason}</p>
      </section>
      <section
        aria-label="Now say this"
        className="space-y-3 rounded-lg bg-accent/10 p-3 ring-1 ring-accent/40"
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-accent">Now say this</p>
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">For example</p>
          <p className="rounded-md bg-background/60 px-3 py-2 text-base font-semibold">
            {hint.example}
          </p>
        </div>
        <div className="space-y-1" data-testid="hint-move">
          <p className="text-xs font-semibold text-muted-foreground">The move</p>
          <p className="font-semibold leading-snug">{hint.approach}</p>
        </div>
        <p className="text-xs italic text-muted-foreground">
          Put it in your own words, for your own situation.
        </p>
      </section>
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

// A hint is on its way. The old hint is hidden meanwhile so nobody reads it as
// the answer to the turn they just played.
function Loading() {
  return (
    <div
      data-testid="hint-loading"
      className="flex items-center gap-3 rounded-lg bg-accent/10 p-3 ring-1 ring-accent/40"
    >
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
      />
      <p className="text-sm font-semibold">Getting a hint…</p>
    </div>
  );
}

export function CoachHint({
  hints,
  pending,
  failure,
}: {
  // Saved hints at the current head, attempt 1 first.
  hints: Hint[];
  pending: boolean;
  failure: string | null;
}) {
  const current = hints.at(-1);
  const first = hints.length > 1 ? hints[0] : undefined;

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" className="space-y-3">
        {pending && <Loading />}
        {failure && <p className="text-sm text-warning">{failure}</p>}
        {current && !pending && (
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
      {first && !pending && (
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
    </div>
  );
}
