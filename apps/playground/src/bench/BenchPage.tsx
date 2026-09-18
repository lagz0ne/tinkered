import { Loader2, Play } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { buildLibs, type LibResult, measure, N } from "./runners.ts";

function fmtUs(v: number): string {
  if (v >= 100) return `${Math.round(v)}`;
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

const isTinker = (r: LibResult) => r.name.includes("tinker");

/** One timing cell: a label, the value, a badge with its gap vs the column's fastest, and a bar. */
function Metric({
  label,
  value,
  best,
  tinker,
}: {
  label: string;
  value: number;
  best: number;
  tinker: boolean;
}): ReactElement {
  const ratio = value / best;
  const fastest = ratio <= 1.02;
  const pct = Math.max(3, (value / (best * 4)) * 100); // bar scale: 4× the fastest fills the track
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">
          {fmtUs(value)} µs
          <span
            className={cn(
              "ml-1.5 rounded px-1 py-px font-semibold",
              fastest ? "bg-emerald-100 text-emerald-700" : "bg-muted text-foreground/70",
            )}
          >
            {fastest ? "fastest" : `${ratio.toFixed(1)}× slower`}
          </span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out",
            tinker ? "bg-primary" : fastest ? "bg-emerald-500" : "bg-zinc-400",
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function ResultRow({
  r,
  bestUpdate,
  bestMount,
}: {
  r: LibResult;
  bestUpdate: number;
  bestMount: number;
}): ReactElement {
  const tinker = isTinker(r);
  const ideal = r.metrics.rerenders <= 1;
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-b px-4 py-3 last:border-0 md:grid-cols-[1fr_auto_1.4fr_1.4fr] md:items-center",
        tinker && "bg-primary/5",
      )}
    >
      <span className={cn("text-sm", tinker ? "font-semibold" : "font-medium")}>{r.name}</span>
      <span
        className={cn(
          "justify-self-end rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
          ideal ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
        )}
        title="components re-rendered by one update"
      >
        {r.metrics.rerenders}× re-render
      </span>
      <div className="col-span-2 md:col-span-1">
        <Metric label="update" value={r.metrics.updateUs} best={bestUpdate} tinker={tinker} />
      </div>
      <div className="col-span-2 md:col-span-1">
        <Metric label="mount" value={r.metrics.mountUs} best={bestMount} tinker={tinker} />
      </div>
    </div>
  );
}

/** How much faster (or slower) tinker's update is than another library, in plain words. */
function gapWords(other: number, tinker: number): string {
  const k = other / tinker;
  if (k >= 1.05) return `${k.toFixed(1)}× faster than`;
  if (k <= 0.95) return `${(1 / k).toFixed(1)}× slower than`;
  return "about the same as";
}

/** The plain-language takeaway a reader should leave with. */
function Takeaway({ results }: { results: LibResult[] }): ReactElement | null {
  const tinker = results.find(isTinker);
  const naive = results.find((r) => !r.fine);
  if (!tinker) return null;
  const others = results.filter((r) => r !== tinker);
  return (
    <div className="mt-6 rounded-xl border bg-muted/30 p-4 text-sm leading-relaxed">
      <p>
        <b>Re-render work.</b> One update re-renders <b>{tinker.metrics.rerenders} component</b>{" "}
        with @tinker/react
        {naive && (
          <>
            {" "}
            — <b>{naive.name}</b> re-renders all <b>{naive.metrics.rerenders}</b>, that's{" "}
            <b>{naive.metrics.rerenders}× the work</b> for the same change
          </>
        )}
        .
      </p>
      <p className="mt-2">
        <b>Update speed.</b> @tinker/react applies one change in{" "}
        <b>{fmtUs(tinker.metrics.updateUs)} µs</b>:
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {others.map((o) => (
          <li
            key={o.name}
            className="rounded-full border bg-background px-2.5 py-0.5 text-xs tabular-nums"
          >
            {gapWords(o.metrics.updateUs, tinker.metrics.updateUs)} <b>{o.name}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultsTable({ results }: { results: LibResult[] }): ReactElement {
  const sorted = [...results].sort((a, b) => a.metrics.updateUs - b.metrics.updateUs);
  const bestUpdate = sorted[0]?.metrics.updateUs ?? 1;
  const bestMount = Math.min(...results.map((r) => r.metrics.mountUs));
  return (
    <>
      <Takeaway results={results} />
      <div className="mt-4 overflow-hidden rounded-xl border">
        <div className="hidden grid-cols-[1fr_auto_1.4fr_1.4fr] items-center gap-x-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Library · fastest update first</span>
          <span className="text-right">per update</span>
          <span>update (lower is better)</span>
          <span>mount (lower is better)</span>
        </div>
        {sorted.map((r) => (
          <ResultRow key={r.name} r={r} bestUpdate={bestUpdate} bestMount={bestMount} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        "N× slower" is relative to the fastest library in that column. Bars are on a shared scale.
      </p>
    </>
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
    try {
      const libs = buildLibs();
      // Warmup pass (discarded): tier up React + every lib's path so the first measured library
      // isn't penalised for the cold JIT that all the others then benefit from.
      setProgress("Warming up…");
      await new Promise((r) => setTimeout(r, 0));
      for (const lib of libs) await measure(lib);

      const collected: LibResult[] = [];
      for (const lib of libs) {
        setProgress(`Measuring ${lib.name}…`);
        await new Promise((r) => setTimeout(r, 0));
        collected.push({ name: lib.name, fine: lib.fine, metrics: await measure(lib) });
        setResults([...collected]);
      }
      setProgress("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const label = running ? "Running…" : results ? "Run again" : "Run benchmark";

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Store benchmark</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {N} components, each subscribed to <b>one</b> slice. We update a single slice and count
            how many components re-render (<b>1 is ideal</b>), plus update and mount time — the{" "}
            <b>median</b> of many runs. Real React, in <b>your</b> browser: numbers are relative and
            move with CPU load, not the CI benchmark.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="animate-spin" /> : <Play />}
            {label}
          </Button>
          {running && <span className="text-sm text-muted-foreground">{progress}</span>}
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {results ? (
          <ResultsTable results={results} />
        ) : (
          !running && (
            <p className="mt-8 text-sm text-muted-foreground">
              Click <b>Run benchmark</b> to measure @tinker/react against Zustand, Jotai, Legend
              State v2 &amp; v3, Preact Signals, and a naive React Context baseline.
            </p>
          )
        )}
      </div>
    </div>
  );
}
