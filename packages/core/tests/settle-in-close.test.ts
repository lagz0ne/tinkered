import { expect, test } from "vite-plus/test";

import {
  capsule,
  createScope,
  data,
  operation,
  resource,
  tag,
  type Capsule,
  type Operation,
} from "@/index";

const got = data<number>({ label: "sink.got", initial: 0 });

const take = operation({
  label: "sink.take",
  depends: { got: got.controller },
  run: async ({ got: cell }) => {
    cell.update((n) => n + 1);
  },
});

const sink = capsule({ label: "sink", exports: { take, got } });

const inner = tag<Operation.Handle<Promise<void>, void>>({ label: "drain.inner" });

const sendOne = operation({
  label: "drain.sendOne",
  depends: { inner: inner.controller },
  run: async ({ inner: slot }) => (await slot.settle()).status,
});

/** The same send, but its `settle` comes after an await: the run is still live then. */
const sendLate = operation({
  label: "drain.sendLate",
  depends: { inner: inner.controller },
  run: async ({ inner: slot }) => {
    await Promise.resolve();
    return (await slot.settle()).status;
  },
});

const sender = tag<Operation.Handle<Promise<string>, void>>({ label: "drain.sender" });

const drainAll = operation({
  label: "drain.all",
  depends: { send: sender.controller },
  run: async ({ send }) => send.run(),
});

const stopping = resource({ label: "drain.stopping", factory: (_d, { closing }) => closing });

/** Each status the drain's `settle` answered. */
const status: string[] = [];

const pump = operation({
  label: "drain.pump",
  depends: { stopping, drainAll: drainAll.controller },
  run: async ({ stopping: closing, drainAll: all }, { clock, signal }) => {
    await clock.sleep(60_000, closing).then(
      () => true,
      () => false,
    );
    if (!signal.aborted) status.push(await all.run());
  },
});

const worker = capsule({
  label: "drain",
  config: { inner: inner.required, sender: sender.required },
  hooks: {
    async start({ next, run }) {
      await next();
      void run(pump, {}, { role: "handler", explain: "Drains at close" });
    },
  },
});

/** A run hook that changes nothing: a scope with it and one without must act the same (#81). */
const pass = capsule({ label: "pass", hooks: { run: (event) => event.next() } });

/** Close a scope gracefully while its pump waits, and say what the drain did. */
async function drained(withHook: boolean, send = sendOne) {
  status.length = 0;

  const scope = await createScope({
    capsules: [...(withHook ? [pass()] : []), sink(), worker({ inner: sink.take, sender: send })],
  }).ready;

  const view = scope.resolve(sink.got);
  let seen = 0;
  view.watch(() => {
    seen = view.get();
  });

  await scope.close({ graceful: true });
  return { seen, status: [...status] };
}

test("a graceful close lets a start-hook run settle its slot op, with a run hook", async () => {
  expect(await drained(true)).toEqual({ seen: 1, status: ["success"] });
});

test("a graceful close lets a start-hook run settle its slot op, with no run hook (#81)", async () => {
  expect(await drained(false)).toEqual({ seen: 1, status: ["success"] });
});

test("a live run's settle after an await passes in a graceful close, with a run hook", async () => {
  expect(await drained(true, sendLate)).toEqual({ seen: 1, status: ["success"] });
});

test("a live run's settle after an await passes in a graceful close, with no run hook", async () => {
  expect(await drained(false, sendLate)).toEqual({ seen: 1, status: ["success"] });
});

test("the settle window is bound to its scope: a closing scope refuses another scope's call", async () => {
  const plain = operation({ label: "far.plain", run: () => "ran" });
  let far: Capsule.Settle | undefined;
  let release = (): void => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  const keeper = capsule({
    label: "far.keeper",
    hooks: {
      async start({ next, settle }) {
        far = settle;
        return next();
      },
      async close({ next }) {
        await held;
        return next();
      },
    },
  });
  const probe = operation({
    label: "near.probe",
    run: async () => (await far?.(plain, {}, { role: "worker", explain: "Probe" }))?.status,
  });
  const ask = tag<Operation.Handle<Promise<string | undefined>, void>>({ label: "near.ask" });
  const outer = operation({
    label: "near.outer",
    depends: { ask: ask.controller },
    run: async ({ ask: slot }) => slot.settle(),
  });
  const asker = capsule({ label: "near", config: { ask: ask.required }, exports: { outer } });

  const closing = await createScope({ capsules: [keeper()] }).ready;
  const open = await createScope({ capsules: [asker({ ask: probe })] }).ready;
  const closed = closing.close({ graceful: true });

  const answer = await open.run(asker.outer);
  release();
  await closed;
  await open.close();

  expect(answer).toMatchObject({ status: "success", value: "failed" });
});
