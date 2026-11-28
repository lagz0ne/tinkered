import { expect, test } from "vite-plus/test";

import { capsule, createScope, data, operation, resource, tag, type Operation } from "@/index";

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

const drainAll = operation({
  label: "drain.all",
  depends: { sendOne: sendOne.controller },
  run: async ({ sendOne: one }) => one.run(),
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
  config: { inner: inner.required },
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
async function drained(withHook: boolean) {
  status.length = 0;

  const scope = await createScope({
    capsules: [...(withHook ? [pass()] : []), sink(), worker({ inner: sink.take })],
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
