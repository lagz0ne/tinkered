// Kept-heap-per-stop budget (ADR 0133): work stopped from outside keeps nothing on what outlives it.
// A "stop" = one stream its reader leaves, or one session that opens a project and closes.
// The tab root and one caller signal live through every stop, as a browser tab does.
// Runs on Node: there `AbortSignal.any` keeps a record per call on a long-lived source.
const { channel, createScope, data, operation, remoteData, rpc, tag } =
  await import("../packages/core/dist/index.mjs");

const { memory } = await import("../packages/core/dist/testing.mjs");

if (!globalThis.gc) {
  console.error("run with --expose-gc");
  process.exit(1);
}

/** A schema that takes any value: the budget is about lifetime, not parsing. */
const any = { "~standard": { version: 1, vendor: "bench", validate: (value) => ({ value }) } };

const open = operation({
  label: "open.here",
  input: any,
  depends: { out: channel.required },
  run: async ({ out }) => {
    out.send(1);
    await new Promise((left) => out.closed.addEventListener("abort", left, { once: true }));
  },
});

const api = rpc({ open: { mode: "stream", input: any, output: any } });

const tasks = data({ label: "tasks", initial: [], parse: any });
const board = remoteData({ tasks }, { config: { project: tag({ label: "project", parse: any }) } });
const fill = operation({ label: "fill", depends: { key: board.project }, run: ({ key }) => [key] });

const server = await createScope({
  capsules: [
    api({ implement: { open } }),
    board({ serve: true, fill: { tasks: fill } }),
    memory.server({ services: [api, board] }),
  ],
}).ready;

const tab = await createScope({
  capsules: [
    memory.client({ peer: server }),
    api({ remote: memory.client }),
    board({ read: memory.client }),
  ],
}).ready;

const long = new AbortController();
const turn = () => new Promise((next) => setImmediate(next));

const stops = {
  "a remote stream, left by break": async () => {
    for await (const _ of await tab.run(api.open, { input: null })) break;
  },
  "a remote stream under one long signal, left by break": async () => {
    for await (const _ of await tab.run(api.open, { input: null, signal: long.signal })) break;
  },
  "a session that opens a project, then closes": async () => {
    const session = tab.createSession({ tags: [board.project("p1")] });
    while (session.resolve(board.tasks).get().length === 0) await turn();
    await session.close();
  },
};

const heap = async () => {
  for (let i = 0; i < 4; i++) {
    globalThis.gc();
    await turn();
  }
  return process.memoryUsage().heapUsed;
};

// Weak tables and compiled code reach their size in the first 30,000 stops; a leak never does.
const WARM = 30000;
const N = 20000;
const BUDGET = 64;
let over = 0;

for (const [name, stop] of Object.entries(stops)) {
  for (let i = 0; i < WARM; i++) await stop();
  const before = await heap();
  for (let i = 0; i < N; i++) {
    await stop();
    // A weak table sized for every stop since the last collection is capacity, not kept work.
    if (i % 1000 === 999) globalThis.gc();
  }
  const kept = ((await heap()) - before) / N;

  if (kept > BUDGET) over++;
  console.log(`kept heap per stop: ${kept.toFixed(0)} B   ${name}   (budget <= ${BUDGET} B)`);
}

const end = await tab.close();
await server.close();

if (end.status === "failed") {
  over++;
  console.log(`the tab closed failed: ${String(end.error)}`);
}

process.exit(over === 0 ? 0 : 1);
