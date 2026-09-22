import { Info, Loader2, Play } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button.tsx";
import { isError } from "@/errors.ts";
import { cn } from "@/lib/utils.ts";
import {
  buildLibs,
  DISCARD_ROUNDS,
  endUpdates,
  FANOUT_SAMPLES,
  finish,
  type LibResult,
  MOUNT_SAMPLES,
  N,
  prepare,
  sampleFanout,
  sampleMount,
  sampleUpdate,
  type Sampler,
  type Stat,
  UPDATE_SAMPLES,
} from "./runners.ts";

function fmtUs(v: number): string {
  if (v >= 100) return `${Math.round(v)}`;
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/** Relative half-width of the interquartile range, as a percentage of the median. */
const spreadPct = (s: Stat): number => Math.round(((s.q3 - s.q1) / 2 / s.median) * 100);

/** Interleaved medians drift 3–8% between clicks of "Run again"; anything under this is noise. */
const GAP_FLOOR = 1.1;
/** `a` is reported faster than `b` only if the gap beats the floor AND their IQRs do not overlap. */
const faster = (a: Stat, b: Stat): boolean => b.median / a.median >= GAP_FLOOR && a.q3 < b.q1;
/** A claimed ratio is rounded DOWN so the headline never overstates. */
const floor1 = (k: number): string => (Math.floor(k * 10) / 10).toFixed(1);

const isTinker = (r: LibResult) => r.name.includes("tinker");

/** One timing cell: label, median ± IQR, a badge relative to the column's fastest, and a bar. */
function Metric({ label, stat, best }: { label: string; stat: Stat; best: Stat }): ReactElement {
  const isFastest = !faster(best, stat);
  const pct = Math.max(3, (stat.median / (best.median * 4)) * 100);
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="shrink-0 whitespace-nowrap">{label}</span>
        <span className="tabular-nums">
          {fmtUs(stat.median)} µs
          <span className="ml-1 text-muted-foreground/70">±{spreadPct(stat)}%</span>
          <span
            className={cn(
              "ml-1.5 rounded px-1 py-px font-semibold whitespace-nowrap",
              isFastest ? "bg-emerald-100 text-emerald-700" : "bg-muted text-foreground/70",
            )}
          >
            {isFastest ? "≈ fastest" : `${floor1(stat.median / best.median)}× slower`}
          </span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out",
            isFastest ? "bg-emerald-500" : "bg-zinc-400",
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

/** The naive baseline's re-render pill gets a one-sentence "why" next to it. SVG elements have no
 * `title` prop in React's types (a real SVG tooltip needs a child `<title>` element instead), so
 * the tooltip text lives on a wrapping `span`. */
function WhyNaive(): ReactElement {
  return (
    <span
      className="inline-flex shrink-0"
      title="One context value object — every consumer re-renders on any change; the fine-grained libraries subscribe per slice."
    >
      <Info className="size-3.5 text-muted-foreground" aria-label="why" />
    </span>
  );
}

function ResultRow({
  r,
  bestUpdate,
  bestMount,
  bestFanout,
}: {
  r: LibResult;
  bestUpdate: Stat;
  bestMount: Stat;
  bestFanout: Stat;
}): ReactElement {
  const tinker = isTinker(r);
  const ideal = r.metrics.rerenders <= 1;
  const fanoutLabel = r.fanoutNote ? `fan-out (${r.fanoutNote})` : "fan-out";
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-b px-4 py-3 last:border-0 md:grid-cols-[1fr_auto_1.4fr_1.4fr_1.4fr] md:items-center",
        tinker && "bg-primary/5",
        r.control && "text-muted-foreground",
      )}
    >
      <span className={cn("text-sm", tinker ? "font-semibold" : "font-medium")}>{r.name}</span>
      <div className="flex items-center justify-self-end gap-1">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
            ideal ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
          )}
          title="components re-rendered by one update"
        >
          {r.metrics.rerenders}× re-render
        </span>
        {!r.fine && <WhyNaive />}
      </div>
      <div className="col-span-2 md:col-span-1">
        <Metric label="update" stat={r.metrics.update} best={bestUpdate} />
      </div>
      <div className="col-span-2 md:col-span-1">
        <Metric label="mount" stat={r.metrics.mount} best={bestMount} />
      </div>
      <div className="col-span-2 md:col-span-1">
        <Metric label={fanoutLabel} stat={r.metrics.fanout} best={bestFanout} />
      </div>
    </div>
  );
}

/** tinker's update gap vs another library, in words — and only when the data supports a claim. */
function gapWords(other: Stat, tinker: Stat): string {
  if (faster(tinker, other)) return `${floor1(other.median / tinker.median)}× faster than`;
  if (faster(other, tinker)) return `${floor1(tinker.median / other.median)}× slower than`;
  return "about the same as";
}

/** One row of "Nx faster/slower than X" badges against tinker, for a single metric. */
function GapBadges({
  tinker,
  others,
  metric,
}: {
  tinker: Stat;
  others: LibResult[];
  metric: (r: LibResult) => Stat;
}): ReactElement {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {others.map((o) => (
        <li
          key={o.name}
          className="rounded-full border bg-background px-2.5 py-0.5 text-xs tabular-nums"
        >
          {gapWords(metric(o), tinker)} <b>{o.name}</b>
        </li>
      ))}
    </ul>
  );
}

/** The plain-language takeaway a reader should leave with. */
function Takeaway({ results }: { results: LibResult[] }): ReactElement | null {
  const tinker = results.find(isTinker);
  const naive = results.find((r) => !r.fine);
  if (!tinker) return null;
  const others = results.filter((r) => r !== tinker && !r.control);
  return (
    <div className="mt-6 rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed">
      <p>
        <b>Re-render count.</b> One update re-renders <b>{tinker.metrics.rerenders} component</b>{" "}
        with @tinker/react
        {naive && (
          <>
            {" "}
            — <b>{naive.name}</b> re-renders all <b>{naive.metrics.rerenders}</b>, that's{" "}
            <b>{naive.metrics.rerenders}× the component renders</b> for the same change
          </>
        )}
        .
      </p>
      <p className="mt-2">
        <b>Update speed.</b> @tinker/react applies one change in{" "}
        <b>{fmtUs(tinker.metrics.update.median)} µs</b> (±{spreadPct(tinker.metrics.update)}%):
      </p>
      <GapBadges tinker={tinker.metrics.update} others={others} metric={(r) => r.metrics.update} />
      <p className="mt-2">
        <b>Fan-out.</b> One write that all {N} components read applies in{" "}
        <b>{fmtUs(tinker.metrics.fanout.median)} µs</b> (±{spreadPct(tinker.metrics.fanout)}%):
      </p>
      <GapBadges tinker={tinker.metrics.fanout} others={others} metric={(r) => r.metrics.fanout} />
    </div>
  );
}

const byMedian = (key: "update" | "mount" | "fanout") => (a: LibResult, b: LibResult) =>
  a.metrics[key].median - b.metrics[key].median;

function ResultsTable({ results }: { results: LibResult[] }): ReactElement {
  const sorted = [...results].sort(byMedian("update"));
  const [fastest] = sorted;
  const [quickestMount] = [...results].sort(byMedian("mount"));
  const [quickestFanout] = [...results].sort(byMedian("fanout"));
  const bestUpdate = fastest.metrics.update;
  const bestMount = quickestMount.metrics.mount;
  const bestFanout = quickestFanout.metrics.fanout;
  return (
    <>
      <Takeaway results={results} />
      <div className="mt-4 overflow-hidden rounded-xl border">
        <div className="hidden grid-cols-[1fr_auto_1.4fr_1.4fr_1.4fr] items-center gap-x-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Library · fastest update first</span>
          <span className="text-right">per update</span>
          <span>update (lower is better)</span>
          <span>mount (lower is better)</span>
          <span>fan-out · 1 write → 50 re-renders</span>
        </div>
        {sorted.map((r) => (
          <ResultRow
            key={r.name}
            r={r}
            bestUpdate={bestUpdate}
            bestMount={bestMount}
            bestFanout={bestFanout}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Median of {UPDATE_SAMPLES} update, {FANOUT_SAMPLES} fan-out, and {MOUNT_SAMPLES} mount
        samples, taken in interleaved rounds; ± is half the interquartile range. "N× slower" is
        against the fastest in that column and is only claimed when the gap is ≥{GAP_FLOOR}×{" "}
        <i>and</i> the two spreads don't overlap. The <i>control</i> row is plain per-component
        useState — the floor for one synchronous re-render; every library's number is its overhead
        above that.
      </p>
    </>
  );
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

/** Interleaved rounds with a rotating start, so no library always runs first in a round. */
async function runRounds(
  samplers: Sampler[],
  rounds: number,
  take: (s: Sampler) => number,
  into: (s: Sampler) => number[],
  onRound: (r: number, total: number) => void,
): Promise<void> {
  const total = rounds + DISCARD_ROUNDS;
  const n = samplers.length;
  for (let r = 0; r < total; r++) {
    for (let j = 0; j < n; j++) {
      const s = samplers[(r + j) % n];
      const v = take(s);
      if (r >= DISCARD_ROUNDS) into(s).push(v);
    }
    onRound(r + 1, total);
    await nextTick();
  }
}

function BenchNotice({ error }: { error: string | null }): ReactElement {
  if (error) return <p className="mt-3 text-sm text-destructive">{error}</p>;
  return (
    <p className="mt-8 text-sm text-muted-foreground">
      Click <b>Run benchmark</b> to measure @tinker/react against Zustand, Jotai, Legend State v2
      &amp; v3, Preact Signals, a naive React Context baseline, and a plain useState control.
    </p>
  );
}

export function BenchPage(): ReactElement {
  const [results, setResults] = useState<LibResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    const samplers: Sampler[] = [];
    try {
      setProgress("Preparing…");
      await nextTick();
      for (const lib of buildLibs()) samplers.push(prepare(lib));
      await runRounds(
        samplers,
        UPDATE_SAMPLES,
        sampleUpdate,
        (s) => s.updates,
        (r, t) => setProgress(`Update rounds ${r}/${t}…`),
      );
      await runRounds(
        samplers,
        FANOUT_SAMPLES,
        sampleFanout,
        (s) => s.fanouts,
        (r, t) => setProgress(`Fan-out rounds ${r}/${t}…`),
      );
      samplers.forEach(endUpdates);
      await runRounds(
        samplers,
        MOUNT_SAMPLES,
        sampleMount,
        (s) => s.mounts,
        (r, t) => setProgress(`Mount rounds ${r}/${t}…`),
      );
      setResults(samplers.map(finish));
      setProgress("");
    } catch (err) {
      if (!isError(err, "HarnessInvariant")) throw err;
      setError(`${err.payload.library}: ${err.payload.reason}`);
    } finally {
      samplers.forEach(endUpdates);
      setRunning(false);
    }
  };

  const label = running ? "Running…" : results ? "Run again" : "Run benchmark";

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Store benchmark</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {N} components, each subscribed to <b>one</b> slice. We update a single slice and count
            how many components re-render (<b>1 is ideal</b>), plus update and mount time — the{" "}
            <b>median</b> of many interleaved rounds. Real React, in <b>your</b> browser: numbers
            are relative and move with CPU load, not the CI benchmark. Every library runs its
            source-audited best configuration.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            {label}
          </Button>
          {running && <span className="text-sm text-muted-foreground">{progress}</span>}
        </div>

        {results ? <ResultsTable results={results} /> : !running && <BenchNotice error={error} />}
      </div>
    </div>
  );
}
