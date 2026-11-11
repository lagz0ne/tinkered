import { data, tag } from "@tinker/core";

// The bench page's state: what the run is doing, and what it found. Only the run writes them.

/** One measured column for one library, ready to draw. */
export type Measure = {
  /** Median, in µs, as shown. */
  text: string;
  /** Half the interquartile range, in % of the median. */
  spread: number;
  /** The bar's length: the median against the column's slowest, in %. */
  bar: number;
  /** "≈ fastest", or "N× slower" against the column's fastest. */
  compare: string;
  fastest: boolean;
};

export type Row = {
  name: string;
  kind: "control" | "fine" | "naive";
  tinker: boolean;
  rerenders: number;
  fanoutLabel: string;
  update: Measure;
  mount: Measure;
  fanout: Measure;
};

/** @tinker/react against each other store: "1.4× faster than", "about the same as". */
export type Gap = { words: string; name: string };

export type Takeaway = {
  rerenders: number;
  naive: { name: string; rerenders: number } | null;
  update: { text: string; spread: number; gaps: Gap[] };
  fanout: { text: string; spread: number; gaps: Gap[] };
};

export type Report = { rows: Row[]; takeaway: Takeaway | null };

export type Run =
  | { kind: "idle" }
  | { kind: "running"; step: string }
  | { kind: "done"; report: Report }
  | { kind: "stopped"; reason: string };

export const run = data<Run>({ label: "bench.run", initial: { kind: "idle" } });

/** The bench's clock: a monotonic ms timer (`performance` in the page). The cmd fills it. */
export const timer = tag<{ now(): number }>({ label: "bench.timer" });
