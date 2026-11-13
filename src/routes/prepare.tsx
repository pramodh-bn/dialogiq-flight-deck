import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  getBrief,
  listBriefs,
  researchBaseUrl,
  streamBrief,
  type Brief,
  type BriefRequest,
  type BriefSummary,
  type Fact,
  type Rejected,
  type ResearchEvent,
  type Source,
} from "@/lib/research";

export const Route = createFileRoute("/prepare")({
  head: () => ({
    meta: [
      { title: "Prepare — DialogIQ" },
      {
        name: "description",
        content:
          "Research a hard conversation before you have it. Every fact comes with its source and the exact words that support it.",
      },
    ],
  }),
  component: Prepare,
});

const EXAMPLES: { label: string; request: BriefRequest }[] = [
  {
    label: "Rent increase",
    request: {
      counterpart: "The letting agent who manages my flat in Leeds, England",
      situation:
        "The agent emailed to say my rent will go up by 12% from next month. I have rented the one-bedroom flat for three years on a rolling tenancy and always paid on time.",
      goal: "Agree a smaller increase, or more notice, without souring the relationship",
      constraints: "I do not want to move this year.",
    },
  },
  {
    label: "Late SaaS renewal price rise",
    request: {
      counterpart: "Our account manager at the vendor of our team's project-management software",
      situation:
        "Two weeks before our annual renewal the vendor told us the per-seat price rises 25%. We are a 40-person company in the United States and budget for the year is already set.",
      goal: "Keep this year's renewal at or near the current price",
      constraints: "Switching tools mid-year would be painful, and they probably know it.",
    },
  },
  {
    label: "Asking for a raise",
    request: {
      counterpart: "My engineering manager",
      situation:
        "I am a senior data engineer in Toronto with six years of experience. I have had no pay rise in two years while my scope grew to leading a team of four.",
      goal: "Ask for a pay rise in line with the market for my role",
      constraints: "I like the team and am not threatening to leave.",
    },
  },
];

const EMPTY: BriefRequest = { counterpart: "", situation: "", goal: "", constraints: "" };

const REASONS: Record<Rejected["reason"], string> = {
  quote_not_in_source: "The quoted words are not in the source",
  figure_not_in_quote: "A figure in the claim is not in the quoted words",
  unknown_source: "It pointed at a source that was not read",
  malformed: "The claim or quote was missing or too long",
};

type Finding = ({ verified: true } & Fact) | ({ verified: false } & Rejected);

interface LogLine {
  key: number;
  text: string;
  tone: "info" | "good" | "bad";
}

function describe(event: ResearchEvent): Omit<LogLine, "key"> | null {
  switch (event.event) {
    case "started":
      return null;
    case "step":
      if (event.data.stage === "search")
        return { text: `Searching the web: “${event.data.query}”`, tone: "info" };
      if (event.data.stage === "read")
        return { text: `Reading the sources for ${event.data.question_id}`, tone: "info" };
      return { text: event.data.message ?? event.data.stage, tone: "info" };
    case "plan":
      return {
        text: `Planned ${event.data.questions.length} research questions`,
        tone: "info",
      };
    case "sources":
      return {
        text: event.data.sources.length
          ? `Found ${event.data.sources.length} sources: ${event.data.sources.map((s) => s.id).join(", ")}`
          : "The search returned nothing readable",
        tone: event.data.sources.length ? "info" : "bad",
      };
    case "finding":
      return event.data.verified
        ? {
            text: `Kept ${event.data.id}: ${event.data.claim} [${event.data.source_id}]`,
            tone: "good",
          }
        : {
            text: `Rejected: ${event.data.claim} — ${REASONS[event.data.reason].toLowerCase()}`,
            tone: "bad",
          };
    case "brief":
      return { text: `Brief ready in ${event.data.run.seconds}s`, tone: "good" };
    case "error":
      return { text: event.data.message, tone: "bad" };
  }
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Prepare() {
  const [form, setForm] = useState<BriefRequest>(EMPTY);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<BriefSummary[]>([]);
  const abort = useRef<AbortController | null>(null);
  const lines = useRef(0);

  const refreshRecent = () => {
    if (researchBaseUrl) listBriefs().then(setRecent, () => undefined);
  };
  useEffect(refreshRecent, []);
  useEffect(() => () => abort.current?.abort(), []);

  const set = (key: keyof BriefRequest) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running) return;
    setRunning(true);
    setBrief(null);
    setError(null);
    setLog([]);
    const controller = new AbortController();
    abort.current = controller;
    let finished = false;
    try {
      await streamBrief(
        form,
        (item) => {
          const line = describe(item);
          if (line) setLog((current) => [...current, { key: lines.current++, ...line }]);
          if (item.event === "brief") {
            finished = true;
            setBrief(item.data);
          }
          if (item.event === "error") {
            finished = true;
            setError(item.data.message);
          }
        },
        controller.signal,
      );
      if (!finished) setError("The research run stopped before it finished.");
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error && !(failure instanceof TypeError)
            ? failure.message
            : "The research service could not be reached.",
        );
    } finally {
      setRunning(false);
      refreshRecent();
    }
  }

  async function open(id: number) {
    setError(null);
    setLog([]);
    try {
      const saved = await getBrief(id);
      setBrief(saved);
      setForm(saved.request);
    } catch {
      setError("That brief could not be loaded.");
    }
  }

  return (
    <div className="min-h-screen bg-ambient text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <Link to="/" className="text-lg font-bold tracking-tight">
            Dialog<span className="text-brand">IQ</span>
          </Link>
          <span className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent">
            PREPARE
          </span>
          <Link
            to="/"
            className="ml-auto text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Practice
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[22rem_1fr]">
        <section className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Know the facts before you talk</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Describe the conversation. The agent searches the public web and writes a brief in
              which every fact links to its source and shows the exact words it rests on. Anything
              it cannot back up is left out and listed as rejected.
            </p>
          </div>

          {!researchBaseUrl && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              This page needs the backend. Start it and set VITE_API_BASE_URL (see the README).
            </p>
          )}

          <form onSubmit={submit} className="bento space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Try:
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  disabled={running}
                  onClick={() => setForm(example.request)}
                  className="rounded-full border border-border px-2.5 py-1 transition-colors hover:border-brand hover:text-foreground disabled:opacity-50"
                >
                  {example.label}
                </button>
              ))}
            </div>
            <Field
              label="Who will you be talking to?"
              hint="Their role and organisation, not their name."
              value={form.counterpart}
              onChange={set("counterpart")}
              maxLength={200}
              disabled={running}
            />
            <Field
              label="What happened?"
              hint="Include the place, the figures and the dates you know."
              value={form.situation}
              onChange={set("situation")}
              maxLength={2000}
              rows={5}
              disabled={running}
            />
            <Field
              label="What do you want from the conversation?"
              value={form.goal}
              onChange={set("goal")}
              maxLength={500}
              rows={2}
              disabled={running}
            />
            <Field
              label="Anything that limits you? (optional)"
              value={form.constraints}
              onChange={set("constraints")}
              maxLength={1000}
              rows={2}
              disabled={running}
              optional
            />
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={running || !researchBaseUrl}
                className="glow rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
              >
                {running ? "Researching…" : "Research this conversation"}
              </button>
              {running && (
                <button
                  type="button"
                  onClick={() => abort.current?.abort()}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Stop
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              What you type is sent to a language model and turned into web searches. Leave out
              names and anything private. A run takes about a minute.
            </p>
          </form>

          {recent.length > 0 && (
            <div className="bento p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Earlier briefs
              </h2>
              <ul className="mt-2 space-y-1">
                {recent.slice(0, 6).map((item) => (
                  <li key={item.brief_id}>
                    <button
                      type="button"
                      disabled={running}
                      onClick={() => open(item.brief_id)}
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-50"
                    >
                      <span className="line-clamp-1">{item.goal}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.facts} {item.facts === 1 ? "fact" : "facts"} · {item.sources}{" "}
                        {item.sources === 1 ? "source" : "sources"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="min-w-0 space-y-4">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          {log.length > 0 && (
            <details className="bento p-4" open={!brief}>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What the agent did ({log.length} steps)
              </summary>
              <ol aria-live="polite" className="mt-3 space-y-1.5 font-mono text-xs">
                {log.map((line) => (
                  <li
                    key={line.key}
                    className={
                      line.tone === "good"
                        ? "text-success"
                        : line.tone === "bad"
                          ? "text-warning"
                          : "text-muted-foreground"
                    }
                  >
                    {line.tone === "good" ? "✓ " : line.tone === "bad" ? "✗ " : "· "}
                    {line.text}
                  </li>
                ))}
                {running && <li className="animate-pulse text-muted-foreground">· working…</li>}
              </ol>
            </details>
          )}

          {brief ? (
            <BriefView brief={brief} />
          ) : (
            !running &&
            log.length === 0 && (
              <div className="bento p-8 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">How a brief is made</p>
                <ol className="mt-3 list-decimal space-y-2 pl-5">
                  <li>The agent plans three to five questions that public sources can answer.</li>
                  <li>It searches the live web for each and reads the pages it finds.</li>
                  <li>
                    For each fact it must copy the supporting words from the page. Code, not the
                    model, then checks those words are really on the page and that every figure in
                    the fact is in them.
                  </li>
                  <li>Where nothing holds up it searches once more with a different query.</li>
                  <li>The advice may only rest on facts that passed the check.</li>
                </ol>
              </div>
            )
          )}
        </section>
      </main>
    </div>
  );
}

function Field(props: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  rows?: number;
  disabled: boolean;
  optional?: boolean;
}) {
  const shared = {
    value: props.value,
    maxLength: props.maxLength,
    disabled: props.disabled,
    required: !props.optional,
    className:
      "mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-brand disabled:opacity-60",
  };
  return (
    <label className="block text-sm font-medium">
      {props.label}
      {props.rows ? (
        <textarea
          {...shared}
          rows={props.rows}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <input {...shared} onChange={(event) => props.onChange(event.target.value)} />
      )}
      {props.hint && (
        <span className="mt-1 block text-xs font-normal text-muted-foreground">{props.hint}</span>
      )}
    </label>
  );
}

function Cite({ source }: { source: Source | undefined }) {
  if (!source) return null;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer noopener"
      title={source.title}
      className="ml-1 inline-flex items-center rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand no-underline transition-colors hover:bg-brand/20"
    >
      {source.id} · {host(source.url)}
    </a>
  );
}

function Card({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bento p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function BriefView({ brief }: { brief: Brief }) {
  const sources = new Map(brief.sources.map((source) => [source.id, source]));
  const facts = new Map(brief.facts.map((fact) => [fact.id, fact]));
  const cited = brief.sources.filter((source) => source.cited);
  const unused = brief.sources.filter((source) => !source.cited);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Facts that held up", brief.facts.length],
          ["Sources cited", cited.length],
          ["Claims rejected", brief.rejected.length],
          ["Pages read", brief.sources.length],
        ].map(([label, value]) => (
          <div key={label} className="bento p-3">
            <div className="text-2xl font-bold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {brief.facts.length === 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          Nothing the agent found could be backed by a source, so it has written no advice. Try
          adding the place, the product or the figures to your description.
        </p>
      )}

      {brief.talking_points.length > 0 && (
        <Card
          title="What to know going in"
          note="Each point rests only on the checked facts it cites."
        >
          <ul className="space-y-3">
            {brief.talking_points.map((point) => (
              <li key={point.text} className="text-sm leading-relaxed">
                {point.text}
                {point.facts.map((id) => (
                  <Cite key={id} source={sources.get(facts.get(id)?.source_id ?? "")} />
                ))}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {brief.facts.length > 0 && (
        <Card
          title="Facts and the words they rest on"
          note="The quote was found word for word on the linked page when it was fetched."
        >
          <ul className="space-y-4">
            {brief.facts.map((fact) => {
              const source = sources.get(fact.source_id);
              return (
                <li key={fact.id} className="text-sm">
                  <p>
                    <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                      {fact.id}
                    </span>
                    {fact.claim}
                    <Cite source={source} />
                  </p>
                  <blockquote className="mt-1.5 border-l-2 border-brand/50 pl-3 text-xs italic text-muted-foreground">
                    “{fact.quote}”
                    {source?.published_date && (
                      <span className="not-italic">
                        {" "}
                        — published {source.published_date.slice(0, 10)}
                      </span>
                    )}
                  </blockquote>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {brief.questions_to_ask.length > 0 && (
        <Card
          title="Questions to ask them"
          note="Research cannot tell you what the other person thinks. These are for finding out."
        >
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {brief.questions_to_ask.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </Card>
      )}

      {(brief.learner_said.length > 0 || brief.assumptions.length > 0) && (
        <Card title="Not checked" note="These came from you, not from a source.">
          {brief.learner_said.length > 0 && (
            <>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                You said
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {brief.learner_said.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {brief.assumptions.length > 0 && (
            <>
              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wider text-warning">
                Assumptions to test
              </h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {brief.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {brief.open_questions.length > 0 && (
        <Card title="Still unknown">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {brief.open_questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Sources">
        <ol className="space-y-2 text-sm">
          {cited.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </ol>
        {unused.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {unused.length} more pages were read but nothing from them was used
            </summary>
            <ol className="mt-2 space-y-2 text-sm">
              {unused.map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </ol>
          </details>
        )}
      </Card>

      {(brief.rejected.length > 0 || brief.dropped_points > 0) && (
        <details className="bento p-5">
          <summary className="cursor-pointer text-sm font-semibold">
            What was thrown out ({brief.rejected.length + brief.dropped_points})
          </summary>
          <p className="mt-1 text-xs text-muted-foreground">
            The model proposed these, and the check refused them. They are not in the brief.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {brief.rejected.map((item, index) => (
              <li key={index}>
                <span className="text-muted-foreground line-through">
                  {item.claim || "(empty)"}
                </span>
                <span className="block text-xs text-warning">
                  {REASONS[item.reason]}
                  {item.source_id ? ` (${item.source_id})` : ""}
                </span>
              </li>
            ))}
            {brief.dropped_points > 0 && (
              <li className="text-xs text-warning">
                {brief.dropped_points} piece{brief.dropped_points === 1 ? "" : "s"} of advice
                dropped for citing no checked fact or using a figure not found in one.
              </li>
            )}
          </ul>
        </details>
      )}

      <p className="font-mono text-[11px] text-muted-foreground">
        Brief #{brief.brief_id} · {brief.run.model} on {brief.run.llm_provider} ·{" "}
        {brief.run.llm_calls} model calls · {brief.run.search_calls} {brief.run.search_provider}{" "}
        searches · {brief.run.prompt_tokens + brief.run.completion_tokens} tokens ·{" "}
        {brief.run.seconds}s · {brief.created_at}
      </p>
    </div>
  );
}

function SourceRow({ source }: { source: Source }) {
  return (
    <li className="flex gap-2">
      <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground">{source.id}</span>
      <span className="min-w-0">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="break-words text-brand hover:underline"
        >
          {source.title}
        </a>
        <span className="block text-xs text-muted-foreground">
          {host(source.url)}
          {source.published_date ? ` · published ${source.published_date.slice(0, 10)}` : ""} ·
          fetched {source.retrieved_at.slice(0, 10)}
        </span>
      </span>
    </li>
  );
}
