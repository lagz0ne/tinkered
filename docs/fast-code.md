# Fast code

These rules come from the 2026-10-07 perf study.
A hot path is work each request pays: build, run, resolve, or close.
The examples show the changed lines; app names refer to their existing owners.
Evidence numbers point to the measured reports below.
App rules apply those findings; they are not new speed claims.

## Library rules

### F1: Keep hot functions small.

An inline budget is the bytecode V8 may spend on copied calls.
Node 24 limits a candidate to 460 bytes and a root to 920 bytes total.
Move rare work to a cold function; small size alone does not prove inlining.
`runOnce` stays a root at 502 bytes by design.

Evidence: [E1](#evidence).

Bad:

```ts
function read(row) {
  if (!row) {
    return ["missing", "row"].join(": ");
  }
  return row.value;
}
```

Good:

```ts
function missingRow() {
  return ["missing", "row"].join(": ");
}
function read(row) {
  return row ? row.value : missingRow();
}
```

### F2: Check inlining with default Maglev on.

Maglev is V8's first optimizing compiler.
It may copy calls into a candidate before TurboFan sees it.
The study priced OperationCtx at 117 + 69 = 186 bytes.

Evidence: [E1](#evidence).

Bad:

```bash
node --no-maglev --trace-turbo-inlining \
  scripts/fast-code-driver.mjs \
  packages/core/dist/index.mjs 200000
```

Good:

```bash
node --trace-turbo-inlining \
  scripts/fast-code-driver.mjs \
  packages/core/dist/index.mjs 200000
```

### F3: Use one shape for each object kind.

Set every field in the same order at birth.
Do not add fields later or mix literals and classes at one read site.
The study saw two maps, V8's object shapes, at 12 `layer` reads.

Evidence: [E1](#evidence).

Bad:

```ts
function row(value) {
  const out = { value };
  if (value > 0) out.ready = true;
  return out;
}
```

Good:

```ts
function row(value) {
  return { value, ready: value > 0 };
}
```

### F4: Use fixed keys or a Map on hot paths.

Megamorphic means one access sees too many object shapes to use a small fast path.
Per-call key sets in `deps[key] = value` cost 13.3% of cold scope builds.

Evidence: [E1](#evidence).

Bad:

```ts
const deps = {};
for (const [key, value] of entries) {
  deps[key] = value;
}
```

Good:

```ts
const deps = new Map();
for (const [key, value] of entries) {
  deps.set(key, value);
}
```

### F5: Read one kind field to tell cases apart.

Avoid a chain of shape tests when one field names the case.
The study saw four maps in `isData` and three in `isEdge`.
Keep the public brand contract when changing a shipped type.

Evidence: [E1](#evidence).

Bad:

```ts
function isData(dep) {
  return "value" in dep && "watch" in dep;
}
```

Good:

```ts
function isData(dep) {
  return dep.kind === "data";
}
```

### F6: Avoid needless per-call allocation.

Allocation means making a new value in memory.
Use shared methods or make closures, arrays, wrappers, and bound functions on first use.
Keep values that the public contract needs.
Sampled settle allocation fell from 401 to 200 bytes.

Evidence: [E2](#evidence).

Bad:

```ts
function counter() {
  let count = 0;
  return { next: () => ++count };
}
```

Good:

```ts
class Counter {
  count = 0;
  next() {
    return ++this.count;
  }
}
```

### F7: Finish sync work without promise hops.

A microtask turn is one spin of a repeating `queueMicrotask` marker while waiting for promise work.
When no step returns a promise, avoid `await`, `.then`, and `Promise.resolve`.
The study cut a sync resource close from nine turns to one.

Evidence: [E3](#evidence).

Bad:

```ts
async function double(value) {
  return await Promise.resolve(value * 2);
}
```

Good:

```ts
function double(value) {
  return value * 2;
}
```

### F8: Share one abort reason on hot paths.

An `abort()` with no reason makes a DOMException and captures a stack.
The study cut bytes made per session from 9,659 to 3,171.
Use Core's shared reason inside Core; the example shows the shape.

Evidence: [E3](#evidence).

Bad:

```ts
controller.abort();
```

Good:

```ts
const closedReason = { kind: "closed" };
function stop(controller) {
  controller.abort(closedReason);
}
```

### F9: Keep module context slots few.

A context slot is V8's numbered place for a module name used by a nested function.
Past slot 255, reads need wider bytecode operands.
The study found slot 329; today's Core bundle reaches 341.
Group cold settings only when their access cost is safe.

Evidence: [E1](#evidence).

Bad:

```ts
const retries = 3;
const timeout = 1000;
function settings() {
  return { retries, timeout };
}
```

Good:

```ts
const settings = { retries: 3, timeout: 1000 };
function readSettings() {
  return settings;
}
```

### F10: Make expensive helpers once.

Keep encoders, clients, settings reads, and regular expressions in a module or resource.
The telemetry queue made an encoder on every size read.
Server rendering also copied env for each page (E5).

Evidence: [E4](#evidence).

Bad:

```ts
function size(text) {
  return new TextEncoder().encode(text).length;
}
```

Good:

```ts
const encoder = new TextEncoder();
function size(text) {
  return encoder.encode(text).length;
}
```

### F11: Compute once and keep the result.

Keep a size, hash, or encoded text until its value changes.
Share a read among waiters when they need the same value.
One wake dropped from 2,000 database reads to one.
The queue sized each kept record once (E4).

Evidence: [E6](#evidence).

Bad:

```ts
function record(value) {
  return {
    text: JSON.stringify(value),
    size: size(JSON.stringify(value)),
  };
}
```

Good:

```ts
function record(value) {
  const text = JSON.stringify(value);
  return { text, size: size(text) };
}
```

### F12: Move side work off requests and close.

Give telemetry, logs, and mail to a resource owned by the process.
It must own errors and drain its queue at process shutdown.
In the study, every page waited on a telemetry POST.

Evidence: [E5](#evidence).

Bad:

```ts
async function page() {
  await telemetry.flush();
  return "Hello, world.";
}
```

Good:

```ts
function page() {
  telemetry.enqueue({ kind: "page" });
  return "Hello, world.";
}
```

### F13: Keep server libraries out of client chunks.

Put server code in `.server.ts` files.
Do not add a validator for records the browser just made itself.
Still check data from outside at the door.
The study found about 90 KB of zod in the entry chunk.

Evidence: [E7](#evidence).

Bad:

```ts
// src/page.tsx
import { database } from "./database";
const rows = database.read();
```

Good:

```ts
// src/database.server.ts
import { drizzle } from "drizzle-orm/pglite";
export const database = drizzle(client);
```

### F14: Do not add .then only to observe work.

Extra promise reactions can cut async error stacks.
The study's `track()` left one frame at depth 32.
Required result changes and lifetime tracking still need an owner.

Evidence: [E3](#evidence).

Bad:

```ts
const work = load();
work.then((value) => console.log(value));
return work;
```

Good:

```ts
async function loadAndReport() {
  const value = await load();
  report(value);
  return value;
}
```

## App rules

### A1: Keep run sync when it does no I/O.

I/O means waiting on files, the network, or a database.
Core settles a plain sync run with zero promises and zero microtasks.

Evidence: [E3](#evidence).

Bad:

```ts
const double = operation({
  label: "double",
  run: async () => 2 * 21,
});
```

Good:

```ts
const double = operation({
  label: "double",
  run: () => 2 * 21,
});
```

### A2: Declare operations, resources, and tags at module scope.

Reuse their identity across renders and requests.
The study found closures and contexts made per call; this app rule avoids repeating declarations.

Evidence: [E2](#evidence).

Bad:

```ts
function useSave() {
  const save = operation({
    label: "save",
    run: () => "saved",
  });
  return useResolve(save);
}
```

Good:

```ts
const save = operation({
  label: "save",
  run: () => "saved",
});
function useSave() {
  return useResolve(save);
}
```

### A3: Make expensive things once in a resource.

Core builds a resource once per owner.
The telemetry study found repeat encoder construction; the server study found repeat settings reads (E5).

Evidence: [E4](#evidence).

Bad:

```ts
const encode = operation({
  label: "encode",
  run: () => new TextEncoder().encode("hello"),
});
```

Good:

```ts
const encoder = resource({
  label: "encoder",
  factory: () => new TextEncoder(),
});
const encode = operation({
  label: "encode",
  depends: { encoder },
  run: ({ encoder }) => encoder.encode("hello"),
});
```

### A4: Use the same input shape on each call.

Parse raw input with the operation's schema at the door.
The study found wrong-map exits when one site read two shapes.
Parsing is the app rule drawn from that finding.

Evidence: [E1](#evidence).

Bad:

```ts
scope.run(save, { input: { name: "Ada" } });
scope.run(save, {
  input: { name: "Ada", active: true },
});
```

Good:

```ts
const save = operation({
  label: "save",
  input: z.object({
    name: z.string(),
    active: z.boolean().default(true),
  }),
  run: (_deps, ctx) => ctx.input,
});
scope.run(save, { rawInput: { name: "Ada" } });
```

### A5: Import server libraries only from server files.

Use `.server.ts` files for database code.
The bundle study found no drizzle or PGlite in client chunks; keep it that way.

Evidence: [E7](#evidence).

Bad:

```ts
// src/database.ts
import { PGlite } from "@electric-sql/pglite";
export const client = new PGlite();
```

Good:

```ts
// src/database.server.ts
import { PGlite } from "@electric-sql/pglite";
export const client = new PGlite();
```

### A6: Keep telemetry, mail, and logs off requests.

Enqueue work on a process-owned resource.
Keep errors and shutdown drain with that owner.
The server study found each page awaiting its telemetry send.

Evidence: [E5](#evidence).

Bad:

```ts
async function signup(account) {
  await mail.send(account.email);
  return account;
}
```

Good:

```ts
function signup(account) {
  mailQueue.enqueue(account.email);
  return account;
}
```

## Evidence

- **E1 — Core V8 report.**
  [Report](/home/paseo/perf/core-v8/REPORT.md).
  Findings 1–6: inlining, two layer shapes, varying keys, brands, and slots.
- **E2 — Core allocation report.**
  [Report](/home/paseo/perf/core-alloc/REPORT.md).
  Findings 2–3: lazy defer and no extra settle closures.
- **E3 — Async microtasks report.**
  [Report](/home/paseo/perf/deep/async-microtasks/REPORT.md).
  Findings 1, 3, 4, 6: sync close, error stacks, sync runs, shared abort reason.
- **E4 — Telemetry report.**
  [Report](/home/paseo/perf/telemetry/REPORT.md).
  Finding 1: encode and size a kept record once.
- **E5 — Start server report.**
  [Report](/home/paseo/perf/start-server/REPORT.md).
  One process telemetry root; no page waits for its send.
- **E6 — Sync fanout report.**
  [Report](/home/paseo/perf/deep/sync-fanout/REPORT.md).
  One database read shared by 2,000 waiters.
- **E7 — Browser bundle report.**
  [Report](/home/paseo/perf/bundle/REPORT.md).
  Findings 1 and 6: remove zod; keep database code off the client.

The reports are local study files, outside this repo.
The measurements describe their pinned trees and engines.
They do not prove every example is faster.

## Checks

A ratchet is a saved ceiling: a value may fall, but a rise needs a baseline edit in the same commit.
Review the code and baseline together.
No check fixes an existing violation.

```bash
node --test scripts/fast-code-parsers.test.mjs
node scripts/check-fast-code.mjs
node scripts/fast-code-breaks.mjs
pnpm validate
```

- **F9:** highest context slot in built Core and React.
  The parser follows V8's captured-name rules in `scripts/check-slots.mjs`.
  Core: 341; React: 25.
  Start ships source files, so it has no base bundle to count.
- **F1:** built bytecode bytes, per named hot function.
  Source maps find current names after minification.
  `runOnce`: 502; `settleRun`: 59; `OperationCtx`: 126.
  `buildHooklessResource`: 451; `resolveDep`: 223.
  `runHookChain`: 235; `invokeRunHooks`: 49; `stepRunHook`: 205.
  `runOnce` exceeds 460 on purpose: it remains its own root.
- **F1/F2:** completed OperationCtx → runOnce inline edge.
  A 200,000-call warm loop uses only `--trace-turbo-inlining`.
  Maglev stays on by default; no raised budget or native syntax.
  A missing edge fails.
- **F6:** function literals in each hot function's source.
  Counts defaults and instance field initializers for the constructor.
  Stops at a nested function: its inner work belongs to that function.
  Does not count arrays, objects, bound functions, or runtime allocations.
  Zero: `runOnce`, `settleRun`, `OperationCtx`, `resolveDep`, `invokeRunHooks`.
  Three: `buildHooklessResource`; two: `runHookChain`; one: `stepRunHook`.
- **F13:** zero client chunks mapping to zod, drizzle, or PGlite.
  The check builds start-min with hidden source maps.
  It reads mapped source paths in every built client JS chunk.
  No string search that a minifier can erase.
  Missing chunks or maps fail.

Baselines live in `scripts/fast-code-baseline.json`.
Node v24.21.0 and V8 13.6.233.17-node.53 pin the bytecode checks.
Only bytecode and inlining checks need an engine match.
Slots, function literals, and client checks still run on a new engine.
The two engine checks print this recovery command:

```bash
node scripts/check-fast-code.mjs --rebaseline-engine
```

It writes only Node, V8, and bytecode fields in the baseline.
It prints old → new for every hot function.
A bytecode rise above 460 fails before any write.
The existing over-460 runOnce root may stay or fall; it cannot rise.
The constructor must still inline with default Maglev.
The saved inline expectation must stay true.
Review and commit the baseline with the toolchain change.
The runner gives child jobs a shared 55-second limit.
Parser tests and all five checks run in `pnpm validate`.
The break script plants each rise in temp copies, sees exit 1, then sees the original pass.
It removes its temp files in `finally`.

## Tools for the other rules

- **Inlining:** `--trace-turbo-inlining` with default Maglev.
- **Shapes:** `--trace-deopt` shows wrong-map exits.
  `--log-ic` shows megamorphic accesses.
- **Allocation:** `--heap-prof` shows where memory is made.
- **Promise work:** `async_hooks` init counts promises, not turns.
  Count turns with a queued microtask marker, as E3 does.
- **Speed:** use the queue, never time code by hand.

```bash
benchctl ab --a "node a.mjs" --b "node b.mjs"
N=61 A=../tinkered-base bench/queued.sh
```
