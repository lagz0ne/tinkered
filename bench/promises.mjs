// Promise budget (ADR 0016): 0 on the synchronous lane, <=10 for a representative async toggle.
// Deterministic promise CENSUS via async_hooks (counts every promise incl. awaits) — no wall-clock.
import { createHook } from "node:async_hooks";

let promises = 0;
const hook = createHook({
  init(_id, type) {
    if (type === "PROMISE") promises++;
  },
});

const { createScope, data, operation, tag } = await import("../packages/core/src/index.ts");

const measure = (fn) => {
  promises = 0;
  hook.enable();
  fn();
  hook.disable();
  return promises;
};

// --- SYNC lane: data read/write/watch/flush + a fully-sync operation resolve ---
const sync = measure(() => {
  const scope = createScope();
  const n = data({ label: "n", initial: 0 });
  const c = scope.controller(n);
  c.set(1);
  c.get();
  const seen = [];
  c.watch((v) => seen.push(v));
  c.set(2); // write + flush to a watcher
  const sq = operation({ label: "sq", depends: { n }, run: ({ n }) => n * n });
  scope.controller(sq).run(); // sync run, no awaits
});

// --- ASYNC lane: a representative async toggle (async op writes a cell over one tick) ---
const asyncToggle = data({ label: "out", initial: "" });
const toggle = operation({
  label: "toggle",
  depends: { out: asyncToggle.controller },
  run: async ({ out }) => {
    out.set("a");
    await Promise.resolve();
    out.set("b");
  },
});
promises = 0;
hook.enable();
const scope = createScope();
await scope.controller(toggle).run();
hook.disable();
const asyncCount = promises;

// --- TAGGED lane: ONE tagged run of a sync op (always async: child session + close) ---
const zone = tag({ label: "zone", default: "base" });
const cfg = data({ label: "cfg", initial: 21 });
const ping = operation({ label: "ping", depends: { n: cfg }, run: ({ n }) => n + 1 });
const taggedScope = createScope();
// Await the run's OWN promise inside the hook window: awaiting through an extra
// async wrapper counts the wrapper's promise too (18, not the run's 17). The census
// is the run's own promises, so capture the promise first, then await it directly.
promises = 0;
hook.enable();
const taggedFlight = taggedScope.run(ping, { tags: [zone("us")] });
await taggedFlight;
hook.disable();
const taggedCount = promises;

console.log(`sync-lane promises:  ${sync}   (budget 0)`);
console.log(`async-toggle promises: ${asyncCount}   (budget <=10)`);
console.log(`METRIC promises_tagged=${taggedCount}`);

let fail = false;
if (sync !== 0) {
  console.error(`FAIL: sync lane allocated ${sync} promises, budget is 0`);
  fail = true;
}
if (asyncCount > 10) {
  console.error(`FAIL: async toggle allocated ${asyncCount} promises, budget is <=10`);
  fail = true;
}
if (taggedCount !== 17) {
  console.error(`FAIL: tagged run allocated ${taggedCount} promises, budget is exactly 17`);
  fail = true;
}
process.exit(fail ? 1 : 0);
