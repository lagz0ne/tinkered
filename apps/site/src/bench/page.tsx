import { useData, useRun } from "@tinkered/react";

import { gapFloor, runBench, samples } from "./harness";
import { run } from "./state";
import type { Gap, Measure, Report, Row } from "./state";
import { N } from "./subjects";

// The benchmark page. It holds no state: the run op writes `bench.run`, the page draws it.

/** One measured column: the median, its spread, a bar on the column's scale, the comparison. */
function Column({ label, m }: { label: string; m: Measure }) {
  return (
    <div className={m.fastest ? "metric fastest" : "metric"}>
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {m.text} <small>µs ±{m.spread}%</small>
      </span>
      <span className="meter" aria-hidden="true">
        <span style={{ width: `${m.bar}%` }} />
      </span>
      <span className="metric-compare">{m.compare}</span>
    </div>
  );
}

function ResultRow({ row }: { row: Row }) {
  const kind = { control: "No-store control", fine: "Per-slice reads", naive: "One Context value" };
  return (
    <article className={row.tinker ? "result tinker" : "result"}>
      <header>
        <h3>{row.name}</h3>
        <span>{kind[row.kind]}</span>
        <span className={row.rerenders <= 1 ? "renders ideal" : "renders"}>
          {row.rerenders}× re-render
        </span>
      </header>
      <Column label="update" m={row.update} />
      <Column label="mount" m={row.mount} />
      <Column label={row.fanoutLabel} m={row.fanout} />
    </article>
  );
}

function Gaps({ gaps }: { gaps: Gap[] }) {
  return (
    <ul className="gaps">
      {gaps.map((g) => (
        <li key={g.name}>
          {g.words} <b>{g.name}</b>
        </li>
      ))}
    </ul>
  );
}

function Results({ report }: { report: Report }) {
  const t = report.takeaway;
  return (
    <>
      <section className="grid-row" aria-label="Measured library results">
        <h2>
          <span>02</span> Every library, same work
        </h2>
        <p className="note">
          Fastest update first. Lower is better. Fan-out is one write, {N} re-renders.
        </p>
        <div>
          {report.rows.map((row) => (
            <ResultRow key={row.name} row={row} />
          ))}
        </div>
      </section>
      {t && (
        <section className="grid-row" aria-label="@tinkered/react in context">
          <h2>
            <span>03</span> @tinkered/react, in context
          </h2>
          <div className="takeaway">
            <div>
              <h3>Re-renders</h3>
              <p className="big">{t.rerenders}</p>
              <p className="note">
                One update with @tinkered/react.
                {t.naive &&
                  ` ${t.naive.name} re-renders all ${t.naive.rerenders} for the same change.`}
              </p>
            </div>
            <div>
              <h3>Update</h3>
              <p className="big">
                {t.update.text} <small>µs ±{t.update.spread}%</small>
              </p>
              <Gaps gaps={t.update.gaps} />
            </div>
            <div>
              <h3>Fan-out</h3>
              <p className="big">
                {t.fanout.text} <small>µs ±{t.fanout.spread}%</small>
              </p>
              <Gaps gaps={t.fanout.gaps} />
            </div>
          </div>
        </section>
      )}
      <details className="method">
        <summary>How to read these numbers</summary>
        <p>
          Median of {samples.update} update, {samples.fanout} fan-out and {samples.mount} mount
          samples, taken in interleaved rounds; ± is half the interquartile range. "N× slower" is
          against the column's fastest, and only when the gap is at least {gapFloor}× and the two
          spreads do not overlap. The control row is plain per-component useState: the floor for one
          synchronous re-render.
        </p>
      </details>
    </>
  );
}

/** `/bench`: @tinkered/react against other stores, in this browser. */
export function BenchPage() {
  const state = useData(run);
  const start = useRun(runBench);
  const busy = state.kind === "running";

  return (
    <main className="bench">
      <header className="head">
        <p className="kicker">Bench</p>
        <h1>The cost of a change</h1>
        <p className="lede">
          One slice. {N} components. How much work does one update take, in your browser?
        </p>
      </header>
      <section className="grid-row">
        <h2>
          <span>01</span> The run
        </h2>
        <ol className="protocol">
          <li>
            <b>Update</b> One slice changes. Count the re-renders.{" "}
            <small>{samples.update} samples</small>
          </li>
          <li>
            <b>Mount</b> {N} components. Time the first render.{" "}
            <small>{samples.mount} samples</small>
          </li>
          <li>
            <b>Fan-out</b> One shared write. All {N} render. <small>{samples.fanout} samples</small>
          </li>
        </ol>
        <p className="libs">
          @tinkered/react, Zustand, Jotai, Legend State v2 and v3, Preact Signals, a naive React
          Context, and a plain useState control. Each in its own best setup.
        </p>
        <div className="actions">
          <button type="button" className="run" disabled={busy} onClick={() => start.run()}>
            {busy ? "Running…" : state.kind === "done" ? "Run again" : "Run benchmark"}
          </button>
          {state.kind === "running" && (
            <p role="status" className="step">
              {state.step}
            </p>
          )}
          {state.kind === "stopped" && (
            <p role="alert" className="stopped">
              Run stopped. {state.reason}
            </p>
          )}
        </div>
      </section>
      {state.kind === "done" && <Results report={state.report} />}
    </main>
  );
}
