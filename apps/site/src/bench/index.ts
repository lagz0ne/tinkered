import { capsule } from "@tinkered/core";
import { lazy } from "react";

import { run, timer } from "./state";

/** The page loads the measured libraries, so it comes as its own chunk on first visit. */
export const BenchPage = lazy(() => import("./page").then((m) => ({ default: m.BenchPage })));

/**
 * The benchmark's capsule.
 * - config `timer`: a monotonic ms clock; the page's cmd passes `performance`.
 * - `run`: where the run is, and its report when done (read only).
 */
export const bench = capsule({
  label: "bench",
  config: { timer: timer.required },
  exports: { run },
});
