import { namespace, operation } from "@tinker/core";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { run as runCell, timer } from "./state";
import type { Gap, Measure, Report } from "./state";
import { N, subjects } from "./subjects";
import type { Lib } from "./subjects";

// The measurement. Samples are taken in interleaved rounds with a rotating start, so each library
// sees the same machine state. Each sample times a batch well above the timer's ~100 µs clamp;
// the page shows the median and the interquartile range. `flushSync` is load-bearing: a sync
// commit runs passive effects at once, so a library that subscribes in `useEffect` is subscribed
// before the first timed update.

export const samples = { update: 31, fanout: 31, mount: 21 } as const;
const batches = { update: 800, fanout: 320, mount: 32 } as const;
/** The first rounds of each phase are thrown away. */
const discard = 2;
/** A gap under this is noise: medians drift 3-8% between runs. */
export const gapFloor = 1.1;
/** A sample shorter than this, in ms, grows its batch. */
const minSample = 2;

/** A library's sampling state, kept across rounds. */
export type Sampler = {
  lib: Lib;
  rerenders: number;
  live: Root | null;
  k: number;
  update: number[];
  fanout: number[];
  mount: number[];
};

type Stat = { median: number; q1: number; q3: number };

/**
 * Where a timed mount runs: it makes no span. A span for each mount put the cost of the page's
 * own telemetry inside the timed batch, the same for every library, so each mount row read
 * about two times slower than the library is.
 */
const timed = namespace({ observe: false });

/** Mounts one tree inside `flushSync`, so it is fully subscribed when this returns. */
export const mount = operation({
  label: "bench.mount",
  input: (raw) => raw as Lib,
  run: (_deps, { input: lib }): Root => {
    const root = createRoot(document.createElement("div"));
    flushSync(() => root.render(lib.App()));
    return root;
  },
});

/** The exact re-render count of one update, warm-up, and a live tree for update samples. */
export const prepare = operation({
  label: "bench.prepare",
  input: (raw) => raw as Lib,
  depends: { mount: mount.controller },
  run: ({ mount }, { input: lib, raise }): Sampler => {
    const first = mount.run({ input: lib });
    lib.reset();
    flushSync(() => lib.update(0, -1));
    const rerenders = lib.renders();
    first.unmount();
    if (rerenders < 1) {
      raise("HarnessInvariant", {
        library: lib.name,
        reason: "an update did not render inside flushSync",
      });
    }

    for (let w = 0; w < batches.mount; w++) mount.run({ input: lib }).unmount();
    const s: Sampler = {
      lib,
      rerenders,
      live: mount.run({ input: lib }),
      k: 1,
      update: [],
      fanout: [],
      mount: [],
    };
    for (let w = 0; w < batches.update; w++) flushSync(() => lib.update(++s.k % N, s.k));
    return s;
  },
});

/** One timed batch of `count` mounts, in ms. Its roots are released outside the timed work. */
export const mountBatch = operation({
  label: "bench.batch.mount",
  input: (raw) => raw as { lib: Lib; count: number },
  depends: { mount: mount.controller, timer: timer.required },
  run: ({ mount, timer }, { input: { lib, count } }) => {
    const roots: Root[] = [];
    try {
      const t0 = timer.now();
      for (let i = 0; i < count; i++) roots.push(mount.run({ input: lib, ns: timed }));
      return timer.now() - t0;
    } finally {
      for (const root of roots) root.unmount();
    }
  },
});

/** One timed batch of `count` writes, in ms. It checks that each write rendered in time. */
export const writeBatch = operation({
  label: "bench.batch.write",
  input: (raw) => raw as { s: Sampler; count: number; fan: boolean },
  depends: { timer: timer.required },
  run: ({ timer }, { input: { s, count, fan }, raise }) => {
    const { lib } = s;
    lib.reset();
    const t0 = timer.now();
    for (let i = 0; i < count; i++) {
      flushSync(() => (fan ? lib.updateShared(++s.k) : lib.update(++s.k % N, s.k)));
    }
    const elapsed = timer.now() - t0;

    const want = fan ? count * N : count;
    if (lib.renders() < want) {
      raise("HarnessInvariant", {
        library: lib.name,
        reason: `${lib.renders()} renders for ${count} writes, expected ${want}`,
      });
    }
    return elapsed;
  },
});

/** One sample of a phase for one library: ms per write (or per mount). A batch doubles until
 * the time clears the timer floor; every batch counts in the average. */
export const sample = operation({
  label: "bench.sample",
  input: (raw) => raw as { s: Sampler; phase: "update" | "fanout" | "mount" },
  depends: { mountBatch: mountBatch.controller, writeBatch: writeBatch.controller },
  run: ({ mountBatch, writeBatch }, { input: { s, phase }, raise }) => {
    let elapsed = 0;
    let done = 0;
    for (let count = batches[phase], attempt = 0; attempt < 8; attempt++, count *= 2) {
      elapsed +=
        phase === "mount"
          ? mountBatch.run({ input: { lib: s.lib, count } })
          : writeBatch.run({ input: { s, count, fan: phase === "fanout" } });
      done += count;
      if (elapsed >= minSample) return elapsed / done;
    }
    return raise("HarnessInvariant", {
      library: s.lib.name,
      reason: "the timer stayed too coarse after larger batches; retry with this tab visible",
    });
  },
});

type Phase = "update" | "fanout" | "mount";

/** A phase's samples, in ms, as µs quartiles. */
export const quartiles = operation({
  label: "bench.quartiles",
  input: (raw) => raw as number[],
  run: (_deps, { input }): Stat => {
    const us = input.map((ms) => ms * 1000).sort((a, b) => a - b);
    const [q1, median, q3] = [0.25, 0.5, 0.75].map((p) => {
      const at = (us.length - 1) * p;
      const lo = us[Math.floor(at)] ?? 0;
      return lo + ((us[Math.ceil(at)] ?? 0) - lo) * (at - Math.floor(at));
    });
    return { median: median!, q1: q1!, q3: q3! };
  },
});

/** "a is faster than b": the gap clears the floor and the spreads do not overlap. */
export const faster = operation({
  label: "bench.faster",
  input: (raw) => raw as { a: Stat; b: Stat },
  run: (_deps, { input: { a, b } }) => b.median / a.median >= gapFloor && a.q3 < b.q1,
});

/** How a median is shown: µs to 3 figures, the spread in %, and a ratio rounded DOWN. */
export const shown = operation({
  label: "bench.shown",
  input: (raw) => raw as { stat: Stat; than?: Stat },
  run: (_deps, { input: { stat, than } }) => ({
    text:
      stat.median >= 100
        ? `${Math.round(stat.median)}`
        : stat.median >= 10
          ? stat.median.toFixed(1)
          : stat.median.toFixed(2),
    spread: Math.round(((stat.q3 - stat.q1) / 2 / stat.median) * 100),
    ratio: than ? (Math.floor((stat.median / than.median) * 10) / 10).toFixed(1) : "",
  }),
});

/** One library's column: its median against the column's fastest and slowest. */
export const column = operation({
  label: "bench.column",
  input: (raw) => raw as { stat: Stat; best: Stat; max: number },
  depends: { faster: faster.controller, shown: shown.controller },
  run: ({ faster, shown }, { input: { stat, best, max } }): Measure => {
    const slower = faster.run({ input: { a: best, b: stat } });
    const { text, spread, ratio } = shown.run({ input: { stat, than: best } });
    return {
      text,
      spread,
      bar: (stat.median / max) * 100,
      fastest: !slower,
      compare: slower ? `${ratio}× slower` : "≈ fastest",
    };
  },
});

/** @tinker/react against one other library, in words. */
export const gap = operation({
  label: "bench.gap",
  input: (raw) => raw as { tinker: Stat; other: Stat; name: string },
  depends: { faster: faster.controller, shown: shown.controller },
  run: ({ faster, shown }, { input: { tinker, other, name } }): Gap => {
    if (faster.run({ input: { a: tinker, b: other } })) {
      return {
        name,
        words: `${shown.run({ input: { stat: other, than: tinker } }).ratio}× faster than`,
      };
    }
    if (faster.run({ input: { a: other, b: tinker } })) {
      return {
        name,
        words: `${shown.run({ input: { stat: tinker, than: other } }).ratio}× slower than`,
      };
    }
    return { name, words: "about the same as" };
  },
});

/** The page's numbers from the samples: rows by update speed, and @tinker/react in context. */
export const report = operation({
  label: "bench.report",
  input: (raw) => raw as Sampler[],
  depends: {
    quartiles: quartiles.controller,
    column: column.controller,
    gap: gap.controller,
    shown: shown.controller,
  },
  run: ({ quartiles, column, gap, shown }, { input: samplers }): Report => {
    const phases = ["update", "fanout", "mount"] as const;
    const results = samplers.map((s) => ({
      lib: s.lib,
      rerenders: s.rerenders,
      stats: Object.fromEntries(
        phases.map((phase) => [phase, quartiles.run({ input: s[phase] })]),
      ) as Record<Phase, Stat>,
    }));
    const edges = Object.fromEntries(
      phases.map((phase) => [
        phase,
        {
          best: results.toSorted((a, b) => a.stats[phase].median - b.stats[phase].median)[0]!.stats[
            phase
          ],
          max: Math.max(...results.map((r) => r.stats[phase].median)),
        },
      ]),
    ) as Record<Phase, { best: Stat; max: number }>;

    const rows = results
      .toSorted((a, b) => a.stats.update.median - b.stats.update.median)
      .map((r) => ({
        name: r.lib.name,
        kind: r.lib.control
          ? ("control" as const)
          : r.lib.fine
            ? ("fine" as const)
            : ("naive" as const),
        tinker: r.lib.name.includes("tinker"),
        rerenders: r.rerenders,
        fanoutLabel: r.lib.fanoutNote ? `fan-out (${r.lib.fanoutNote})` : "fan-out",
        ...(Object.fromEntries(
          phases.map((phase) => [
            phase,
            column.run({ input: { stat: r.stats[phase], ...edges[phase] } }),
          ]),
        ) as Record<Phase, Measure>),
      }));

    const tinker = results.find((r) => r.lib.name.includes("tinker"));
    if (!tinker) return { rows, takeaway: null };
    const naive = results.find((r) => !r.lib.fine);
    const others = results.filter((r) => r !== tinker && !r.lib.control);
    const [update, fanout] = (["update", "fanout"] as const).map((phase) => {
      const { text, spread } = shown.run({ input: { stat: tinker.stats[phase] } });
      const gaps = others.map((o) =>
        gap.run({
          input: { tinker: tinker.stats[phase], other: o.stats[phase], name: o.lib.name },
        }),
      );
      return { text, spread, gaps };
    });
    return {
      rows,
      takeaway: {
        rerenders: tinker.rerenders,
        naive: naive ? { name: naive.lib.name, rerenders: naive.rerenders } : null,
        update: update!,
        fanout: fanout!,
      },
    };
  },
});

/** One phase: interleaved rounds with a rotating start, so no library always goes first. The
 * first rounds are thrown away; the cell shows the round. */
export const rounds = operation({
  label: "bench.rounds",
  input: (raw) => raw as { samplers: Sampler[]; phase: Phase },
  depends: { state: runCell.controller, sample: sample.controller },
  run: async ({ state, sample }, { input: { samplers, phase }, clock, signal }) => {
    const total = samples[phase] + discard;
    for (let r = 0; r < total; r++) {
      for (let j = 0; j < samplers.length; j++) {
        const s = samplers[(r + j) % samplers.length]!;
        const v = sample.run({ input: { s, phase } });
        if (r >= discard) s[phase].push(v);
      }

      state.set({ kind: "running", step: `${phase} rounds ${r + 1}/${total}…` });
      await clock.sleep(0, signal);
    }
  },
});

/** Unmounts every live tree, so the next phase starts from a clean page. */
export const release = operation({
  label: "bench.release",
  input: (raw) => raw as Sampler[],
  run: (_, { input }) => {
    for (const s of input) s.live = (s.live?.unmount(), null);
  },
});

/** The whole run: prepare each library, then each phase; a broken premise stops it with words. */
export const runBench = operation({
  label: "bench.run.do",
  depends: {
    subjects,
    state: runCell.controller,
    prepare: prepare.controller,
    rounds: rounds.controller,
    report: report.controller,
    release: release.controller,
  },
  run: async ({ subjects, state, prepare, rounds, report, release }, { clock, signal }) => {
    const samplers: Sampler[] = [];
    try {
      state.set({ kind: "running", step: "Preparing…" });
      await clock.sleep(0, signal);
      for (const lib of subjects) samplers.push(prepare.run({ input: lib }));

      await rounds.run({ input: { samplers, phase: "update" } });
      await rounds.run({ input: { samplers, phase: "fanout" } });
      release.run({ input: samplers });
      await rounds.run({ input: { samplers, phase: "mount" } });
      state.set({ kind: "done", report: report.run({ input: samplers }) });
    } catch (error) {
      const { kind, payload } = Object(error) as {
        kind?: string;
        payload?: { library: string; reason: string };
      };
      if (kind !== "HarnessInvariant" || !payload) throw error;
      state.set({ kind: "stopped", reason: `${payload.library}: ${payload.reason}` });
    } finally {
      release.run({ input: samplers });
    }
  },
});
