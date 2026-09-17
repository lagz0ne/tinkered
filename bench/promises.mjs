// Promise budget (ADR 0016): 0 on the synchronous lane, <=10 for a representative async toggle.
// Deterministic promise CENSUS via async_hooks (counts every promise incl. awaits) — no wall-clock.
import { createHook } from "node:async_hooks";

let promises = 0;
const hook = createHook({
  init(_id, type) {
    if (type === "PROMISE") promises++;
  },
});

const { createScope, data, operation } = await import("../packages/core/src/index.ts");

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

console.log(`sync-lane promises:  ${sync}   (budget 0)`);
console.log(`async-toggle promises: ${asyncCount}   (budget <=10)`);

let fail = false;
if (sync !== 0) {
  console.error(`FAIL: sync lane allocated ${sync} promises, budget is 0`);
  fail = true;
}
if (asyncCount > 10) {
  console.error(`FAIL: async toggle allocated ${asyncCount} promises, budget is <=10`);
  fail = true;
}
process.exit(fail ? 1 : 0);
