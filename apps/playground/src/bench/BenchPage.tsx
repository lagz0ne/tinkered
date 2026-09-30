import {
  ArrowUpRight,
  Info,
  Layers3,
  Loader2,
  Network,
  Play,
  RotateCw,
  ScanLine,
} from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
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
import "./benchmark.css";

function fmtUs(v: number): string {
  if (v >= 100) return `${Math.round(v)}`;
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

const spreadPct = (s: Stat): number => Math.round(((s.q3 - s.q1) / 2 / s.median) * 100);

/** Interleaved medians drift 3–8% between clicks of "Run again"; anything under this is noise. */
const GAP_FLOOR = 1.1;
const faster = (a: Stat, b: Stat): boolean => b.median / a.median >= GAP_FLOOR && a.q3 < b.q1;
/** A claimed ratio is rounded DOWN so the headline never overstates. */
const floor1 = (k: number): string => (Math.floor(k * 10) / 10).toFixed(1);

const isTinker = (r: LibResult) => r.name.includes("tinker");

function Metric({
  label,
  stat,
  best,
  ceiling,
}: {
  label: string;
  stat: Stat;
  best: Stat;
  ceiling: number;
}): ReactElement {
  const isFastest = !faster(best, stat);
  const pct = (stat.median / ceiling) * 100;
  return (
    <div className={cn("bench-metric", isFastest && "bench-metric-fastest")}>
      <div className="bench-metric-label">{label}</div>
      <div className="bench-metric-value">
        <span>
          {fmtUs(stat.median)} <small>µs</small>
        </span>
        <span className="bench-spread">±{spreadPct(stat)}%</span>
      </div>
      <div className="bench-meter" aria-hidden="true">
        <div className="bench-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="bench-comparison">
        {isFastest ? "≈ fastest" : `${floor1(stat.median / best.median)}× slower`}
      </span>
    </div>
  );
}

/** The baseline uses a single Context value, so every consumer observes every change. */
function WhyNaive(): ReactElement {
  return (
    <span
      className="bench-naive-note"
      title="One context value object — every consumer re-renders on any change; the fine-grained libraries subscribe per slice."
    >
      <Info className="size-3.5" aria-label="why" />
    </span>
  );
}

function ResultRow({
  r,
  bestUpdate,
  bestMount,
  bestFanout,
  maxUpdate,
  maxMount,
  maxFanout,
}: {
  r: LibResult;
  bestUpdate: Stat;
  bestMount: Stat;
  bestFanout: Stat;
  maxUpdate: number;
  maxMount: number;
  maxFanout: number;
}): ReactElement {
  const tinker = isTinker(r);
  const ideal = r.metrics.rerenders <= 1;
  const fanoutLabel = r.fanoutNote ? `fan-out (${r.fanoutNote})` : "fan-out";
  return (
    <article className={cn("bench-result", tinker && "bench-result-tinker")}>
      <div className="bench-library">
        <h3>{r.name}</h3>
        <span>
          {r.control
            ? "No-store control"
            : r.fine
              ? "Per-slice subscription"
              : "Shared Context value"}
        </span>
      </div>
      <div className="bench-render-count">
        <span
          className={cn("bench-render-value", ideal && "bench-render-ideal")}
          title="components re-rendered by one update"
        >
          {r.metrics.rerenders}× <span>re-render</span>
        </span>
        {!r.fine && <WhyNaive />}
      </div>
      <Metric label="update" stat={r.metrics.update} best={bestUpdate} ceiling={maxUpdate} />
      <Metric label="mount" stat={r.metrics.mount} best={bestMount} ceiling={maxMount} />
      <Metric label={fanoutLabel} stat={r.metrics.fanout} best={bestFanout} ceiling={maxFanout} />
    </article>
  );
}

function gapWords(other: Stat, tinker: Stat): string {
  if (faster(tinker, other)) return `${floor1(other.median / tinker.median)}× faster than`;
  if (faster(other, tinker)) return `${floor1(tinker.median / other.median)}× slower than`;
  return "about the same as";
}

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
    <ul className="bench-gap-list">
      {others.map((o) => (
        <li key={o.name}>
          <span>{gapWords(metric(o), tinker)}</span>
          <b>{o.name}</b>
        </li>
      ))}
    </ul>
  );
}

function Takeaway({ results }: { results: LibResult[] }): ReactElement | null {
  const tinker = results.find(isTinker);
  const naive = results.find((r) => !r.fine);
  if (!tinker) return null;
  const others = results.filter((r) => r !== tinker && !r.control);
  return (
    <section className="bench-takeaway" aria-label="Tinker results in context">
      <div className="bench-section-heading">
        <span className="bench-eyebrow">Reading the results</span>
        <h2>@tinker/react, in context.</h2>
      </div>
      <div className="bench-takeaway-grid">
        <article className="bench-takeaway-item">
          <span className="bench-eyebrow">01 / Re-render count</span>
          <p className="bench-takeaway-number">
            {tinker.metrics.rerenders}
            <small> component</small>
          </p>
          <p>
            One update with @tinker/react.
            {naive && (
              <>
                {" "}
                <b>{naive.name}</b> re-renders all <b>{naive.metrics.rerenders}</b> —{" "}
                <b>{naive.metrics.rerenders}× the component renders</b> for the same change.
              </>
            )}
          </p>
        </article>
        <article className="bench-takeaway-item">
          <span className="bench-eyebrow">02 / Update speed</span>
          <p className="bench-takeaway-number">
            {fmtUs(tinker.metrics.update.median)}
            <small> µs</small>
          </p>
          <p>One changed slice. ±{spreadPct(tinker.metrics.update)}% spread.</p>
          <GapBadges
            tinker={tinker.metrics.update}
            others={others}
            metric={(r) => r.metrics.update}
          />
        </article>
        <article className="bench-takeaway-item">
          <span className="bench-eyebrow">03 / Fan-out</span>
          <p className="bench-takeaway-number">
            {fmtUs(tinker.metrics.fanout.median)}
            <small> µs</small>
          </p>
          <p>
            One write, all {N} components. ±{spreadPct(tinker.metrics.fanout)}% spread.
          </p>
          <GapBadges
            tinker={tinker.metrics.fanout}
            others={others}
            metric={(r) => r.metrics.fanout}
          />
        </article>
      </div>
    </section>
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
  const maxUpdate = Math.max(...results.map((r) => r.metrics.update.median));
  const maxMount = Math.max(...results.map((r) => r.metrics.mount.median));
  const maxFanout = Math.max(...results.map((r) => r.metrics.fanout.median));
  return (
    <>
      <section className="bench-results" aria-label="Measured library results">
        <div className="bench-results-heading">
          <div>
            <span className="bench-eyebrow">
              Measurements / <span className="bench-unit">µs</span>
            </span>
            <h2>Every library. Same work.</h2>
          </div>
          <span className="bench-results-order">
            Fastest update first <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </span>
        </div>
        <div className="bench-table">
          <div className="bench-table-heading" aria-hidden="true">
            <span>Library</span>
            <span>Per update</span>
            <span>
              Update <small>↓ better</small>
            </span>
            <span>
              Mount <small>↓ better</small>
            </span>
            <span>
              Fan-out <small>↓ better</small>
            </span>
          </div>
          {sorted.map((r) => (
            <ResultRow
              key={r.name}
              r={r}
              bestUpdate={bestUpdate}
              bestMount={bestMount}
              bestFanout={bestFanout}
              maxUpdate={maxUpdate}
              maxMount={maxMount}
              maxFanout={maxFanout}
            />
          ))}
        </div>
        <p className="bench-result-note">
          Lower times are better. Each column shares a scale; its longest bar is the slowest median.
          Fan-out is one write → {N} re-renders.
        </p>
      </section>
      <Takeaway results={results} />
      <details className="bench-method-note">
        <summary>
          <Info aria-hidden="true" className="size-4" /> How to read these numbers <span>+</span>
        </summary>
        <p>
          Median of {UPDATE_SAMPLES} update, {FANOUT_SAMPLES} fan-out, and {MOUNT_SAMPLES} mount
          samples, taken in interleaved rounds; ± is half the interquartile range. “N× slower” is
          against the fastest in that column and is only claimed when the gap is ≥{GAP_FLOOR}×{" "}
          <i>and</i> the two spreads don’t overlap. The <i>control</i> row is plain per-component
          useState — the floor for one synchronous re-render; every library’s number includes its
          overhead above that.
        </p>
      </details>
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
  if (error)
    return (
      <div className="bench-notice bench-error" role="alert">
        <Info aria-hidden="true" className="size-5" />
        <div>
          <h2>Run stopped.</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  return (
    <div className="bench-notice">
      <ScanLine aria-hidden="true" className="size-6" />
      <div>
        <h2>Ready when you are.</h2>
        <p>
          Run benchmark to compare @tinker/react, Zustand, Jotai, Legend State v2 &amp; v3, Preact
          Signals, a naive React Context baseline, and a plain useState control.
        </p>
      </div>
      <span className="bench-notice-tag">Awaiting a run</span>
    </div>
  );
}

function BenchProtocol(): ReactElement {
  return (
    <div className="bench-protocol" aria-label="Benchmark workloads">
      <div className="bench-protocol-item">
        <ScanLine aria-hidden="true" />
        <div>
          <span>01 / Update</span>
          <p>
            One slice changes.
            <br />
            Count the re-renders.
          </p>
        </div>
        <span className="bench-protocol-samples">
          {UPDATE_SAMPLES}
          <small> samples</small>
        </span>
      </div>
      <div className="bench-protocol-item">
        <Layers3 aria-hidden="true" />
        <div>
          <span>02 / Mount</span>
          <p>
            {N} components.
            <br />
            Measure the first render.
          </p>
        </div>
        <span className="bench-protocol-samples">
          {MOUNT_SAMPLES}
          <small> samples</small>
        </span>
      </div>
      <div className="bench-protocol-item">
        <Network aria-hidden="true" />
        <div>
          <span>03 / Fan-out</span>
          <p>
            One shared write.
            <br />
            All {N} components render.
          </p>
        </div>
        <span className="bench-protocol-samples">
          {FANOUT_SAMPLES}
          <small> samples</small>
        </span>
      </div>
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
    <div className="bench-page">
      <div className="bench-content">
        <header className="bench-header">
          <div className="bench-intro">
            <span className="bench-eyebrow">
              <span className="bench-status-light" /> Store benchmark / React
            </span>
            <h1>
              The cost of
              <br />
              <em>a change.</em>
            </h1>
            <p>One slice. {N} components. How much work does one update really take?</p>
          </div>
          <div className="bench-specimen">
            <div className="bench-specimen-heading">
              <span>Test specimen</span>
              <span>{N} / components</span>
            </div>
            <div className="bench-specimen-stage" aria-hidden="true">
              <div className="bench-specimen-grid">
                {Array.from({ length: N }, (_, i) => (
                  <span key={i} className={i === 22 ? "bench-specimen-cell-active" : undefined} />
                ))}
              </div>
            </div>
            <p>
              One slice per component<span>{N} independent reads</span>
            </p>
          </div>
        </header>

        <BenchProtocol />

        <div className="bench-run-bar">
          <button className="bench-run-button" type="button" onClick={run} disabled={running}>
            {running ? (
              <Loader2 aria-hidden="true" className="bench-running-icon" />
            ) : results ? (
              <RotateCw aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            <span>{label}</span>
            <ArrowUpRight aria-hidden="true" className="bench-run-arrow" />
          </button>
          <p>
            Real React. Your browser.<span>Times vary with your device and CPU load.</span>
          </p>
          <span className="bench-run-footnote">
            Median of interleaved rounds<small>Source-audited library setups</small>
          </span>
        </div>

        {running && (
          <div className="bench-progress" role="status" aria-live="polite">
            <div>
              <span className="bench-eyebrow">Measurement in progress</span>
              <span>{progress}</span>
            </div>
            <progress aria-label={progress} />
            <p>Libraries take turns each round. Warm-up samples are discarded.</p>
          </div>
        )}
        {results ? <ResultsTable results={results} /> : !running && <BenchNotice error={error} />}
        <footer className="bench-footer">
          <span>Measure. Compare. Repeat.</span>
          <span>Results belong to this browser, not the CI benchmark.</span>
        </footer>
      </div>
    </div>
  );
}
