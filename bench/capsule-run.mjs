// A capsule hook's run and settle against scope.run and scope.settle (ADR 0121): the hook path
// makes no controller, so the two sides should cost the same per awaited call.
// The hook verbs answer a promise; the `-promise` modes wrap the scope verb the same way, so the
// two sides differ only in Core's own work.
//   node bench/capsule-run.mjs <mode> [count]
//   mode: scope-run, scope-run-promise, hook-run, scope-settle, scope-settle-promise, hook-settle
import { capsule, createScope, operation } from "../packages/core/dist/index.mjs";

const mode = process.argv[2] ?? "scope-run";
const count = Number(process.argv[3] ?? 200_000);
const op = operation({ label: "probe", run: () => 1 });
const meta = { role: "worker", explain: "Runs the probe" };

let total = 0;

const loops = {
  "scope-run": async (scope) => {
    for (let i = 0; i < count; i++) total += await scope.run(op);
  },
  "scope-run-promise": async (scope) => {
    for (let i = 0; i < count; i++) total += await Promise.resolve(scope.run(op));
  },
  "scope-settle-promise": async (scope) => {
    for (let i = 0; i < count; i++) total += (await Promise.resolve(scope.settle(op))).value;
  },
  "scope-settle": async (scope) => {
    for (let i = 0; i < count; i++) total += (await scope.settle(op)).value;
  },
  "hook-run": async (_scope, event) => {
    for (let i = 0; i < count; i++) total += await event.run(op, {}, meta);
  },
  "hook-settle": async (_scope, event) => {
    for (let i = 0; i < count; i++) total += (await event.settle(op, {}, meta)).value;
  },
};

let saved;

const probe = capsule({
  label: "probe",
  hooks: {
    start: (event) => {
      saved = event;
    },
  },
});

const scope = createScope({ capsules: [probe] });
await scope.ready;

await loops[mode](scope, saved);
await scope.close();
if (total !== count) throw new Error(`Expected ${count}, received ${total}`);
console.log(`completed ${mode}: ${total}`);
