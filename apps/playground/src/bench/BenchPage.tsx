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

/** A horizontal bar; lower value = shorter = better. */
function Bar({
  value,
  max,
  tinker,
}: {
  value: number;
  max: number;
  tinker: boolean;
}): ReactElement {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out",
            tinker ? "bg-primary" : "bg-zinc-400",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {fmtUs(value)} µs
      </span>
    </div>
  );
}

const COLS = "grid grid-cols-[1fr_auto_1.4fr_1.4fr] items-center gap-x-4";

function ResultRow({
  r,
  maxUpdate,
  maxMount,
}: {
  r: LibResult;
  maxUpdate: number;
  maxMount: number;
}) {
  const tinker = r.name.includes("tinker");
  const ideal = r.metrics.rerenders <= 1;
  return (
    <div className={cn(COLS, "border-b px-4 py-3 last:border-0", tinker && "bg-primary/5")}>
      <span className={cn("text-sm", tinker ? "font-semibold" : "font-medium")}>{r.name}</span>
      <span
        className={cn(
          "justify-self-end rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
          ideal ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
        )}
      >
        {r.metrics.rerenders}×
      </span>
      <Bar value={r.metrics.updateUs} max={maxUpdate} tinker={tinker} />
      <Bar value={r.metrics.mountUs} max={maxMount} tinker={tinker} />
    </div>
  );
}

function ResultsTable({ results }: { results: LibResult[] }): ReactElement {
  const maxUpdate = Math.max(1, ...results.map((r) => r.metrics.updateUs));
  const maxMount = Math.max(1, ...results.map((r) => r.metrics.mountUs));
  return (
    <div className="mt-8 overflow-hidden rounded-xl border">
      <div
        className={cn(
          COLS,
          "border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground",
        )}
      >
        <span>Library</span>
        <span className="text-right">re-renders</span>
        <span>update</span>
        <span>mount</span>
      </div>
      {results.map((r) => (
        <ResultRow key={r.name} r={r} maxUpdate={maxUpdate} maxMount={maxMount} />
      ))}
    </div>
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
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Store benchmark</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {N} components, each subscribed to <b>one</b> slice. We update a single slice and count
            how many components re-render (<b>1 is ideal</b>), plus update and mount time — the{" "}
            <b>median</b> of many runs. Real React, in <b>your</b> browser: numbers are relative and
            move with CPU load, not the CI benchmark.
          </p>
        </header>

        <div className="flex items-center gap-3">
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
