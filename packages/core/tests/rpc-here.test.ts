import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { bytes, channel, createScope, operation, rpc, transport } from "@/main";
import type { Observe, RpcBody } from "@/main";

// A key run where it is implemented (as tRPC createCaller), and the serve ops called directly.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const api = rpc({
  echo: { input: z.object({ n: z.number() }), output: z.object({ n: z.number() }) },
  ticks: { mode: "stream", input: z.object({ to: z.number() }), output: z.number() },
  forever: { mode: "stream", input: z.null(), output: z.number() },
});

const echo = operation({
  label: "echo.here",
  input: api.echo.input,
  run: (_, { input }): { n: number } => {
    if (input.n < 0) throw new Error("negative");
    return input;
  },
});

const ticks = operation({
  label: "ticks.here",
  input: api.ticks.input,
  depends: { out: channel.required },
  run: ({ out }, { input }) => {
    if (input.to < 0) throw new Error("negative");
    for (let n = 1; n <= input.to; n++) out.send(n, { "x-n": String(n) });
  },
});

let left = 0;

const forever = operation({
  label: "forever.here",
  input: z.null(),
  depends: { out: channel.required },
  run: async ({ out }) => {
    for (let n = 0; !out.closed.aborted; n++) {
      out.send(n);
      await new Promise((r) => setTimeout(r, 2));
    }
    left++;
  },
});

/** Refuses a call whose input names 9. */
const gate = operation({
  label: "gate",
  input: transport.hook.start,
  run: (_, { input }) =>
    Object(input.input).n === 9 || Object(input.input).to === 9
      ? input.refuse({ why: "nine" })
      : undefined,
});

async function here() {
  const spans: Observe.Span[] = [];
  const scope = await createScope({
    observe: { export: (s) => void spans.push(s) },
    capsules: [api({ implement: { echo, ticks, forever }, onStart: [gate] })],
  }).ready;
  closers.push(() => scope.close());
  return { scope, spans };
}

const caught = (p: () => unknown) =>
  Promise.resolve()
    .then(p)
    .then(
      () => null,
      (e: unknown) => (api.fault.is(e) ? { fault: e.fault, payload: e.payload } : e),
    );

test("a reply key runs here, through the hooks; a refusal throws refused", async () => {
  const { scope } = await here();

  expect(await scope.run(api.echo, { input: { n: 2 } })).toEqual({ n: 2 });
  expect(await caught(() => scope.run(api.echo, { input: { n: 9 } }))).toEqual({
    fault: "refused",
    payload: { why: "nine" },
  });
  // A throw here is the op's own error, as a direct call gives it.
  expect(await caught(() => scope.run(api.echo, { input: { n: -1 } }))).toMatchObject({
    message: "negative",
  });
});

test("a stream key runs here: each send is read in turn, with its meta", async () => {
  const { scope } = await here();

  /** The stream as rpc gives it: `meta` is the meta of the value just read. */
  const values = (await scope.run(api.ticks, { input: { to: 3 } })) as AsyncIterable<number> & {
    readonly meta?: Record<string, string>;
  };
  const seen: Array<[unknown, unknown]> = [];
  for await (const n of values) seen.push([n, values.meta?.["x-n"]]);

  expect(seen).toEqual([
    [1, "1"],
    [2, "2"],
    [3, "3"],
  ]);
});

test("a stream key here: a refusal throws refused, a throw is failed", async () => {
  const { scope } = await here();
  const drain = async (to: number) => {
    for await (const _ of await scope.run(api.ticks, { input: { to } })) void _;
  };

  expect(await caught(() => drain(9))).toEqual({ fault: "refused", payload: { why: "nine" } });
  expect(await caught(() => drain(-1))).toMatchObject({ message: "negative" });
});

test("stop leaves a stream from outside the loop; the op sees its channel close", async () => {
  const { scope } = await here();
  left = 0;

  const values = await scope.run(api.forever, { input: null });
  const seen: number[] = [];
  for await (const n of values) {
    seen.push(n as number);
    if (seen.length === 2) {
      (values as unknown as { stop(r: unknown): void }).stop(new Error("enough"));
    }
  }
  await new Promise((r) => setTimeout(r, 20));

  expect(seen).toEqual([0, 1]);
  expect(left).toBe(1);
});

test("a failed key here marks its span with the failed event and logs the cause", async () => {
  const logs: Observe.Log[] = [];
  const events: string[] = [];
  const scope = await createScope({
    observe: {
      export: (s) =>
        void events.push(...s.events.map((e) => `${e.name} ${JSON.stringify(e.attributes)}`)),
      log: (entry) => void logs.push(entry),
    },
    capsules: [api({ implement: { echo, ticks, forever } })],
  }).ready;
  closers.push(() => scope.close());

  const reply = await scope.run(api.answer, {
    input: { address: "echo", value: { n: -1 }, meta: {} },
  });
  expect(reply).toEqual({ ok: false, kind: "failed", payload: {} });
  expect(events).toContain('rpc.failed {"address":"echo"}');
  const line = logs.find((l) => l.message === "rpc call failed");
  expect(line?.attributes).toMatchObject({ address: "echo", cause: "Error: negative" });
  expect(String(line?.attributes.stack)).toContain("negative");
});

test("answer: null for an address it lacks or a stream key; stream: false for a reply key", async () => {
  const { scope } = await here();
  const pushed: unknown[] = [];
  const push = (r: unknown) => void pushed.push(r);

  expect(await scope.run(api.answer, { input: { address: "nope", value: null, meta: {} } })).toBe(
    null,
  );
  expect(
    await scope.run(api.answer, { input: { address: "ticks", value: { to: 1 }, meta: {} } }),
  ).toBe(null);
  expect(
    await scope.run(api.stream, { input: { address: "nope", value: null, meta: {}, push } }),
  ).toBe(false);
  expect(
    await scope.run(api.stream, { input: { address: "echo", value: { n: 1 }, meta: {}, push } }),
  ).toBe(false);
  expect(pushed).toEqual([]);
});

test("stream: each push as a reply; a bad input, a refusal or a throw is one push", async () => {
  const { scope } = await here();
  const open = async (value: unknown) => {
    const pushed: unknown[] = [];
    const more = await scope.run(api.stream, {
      input: { address: "ticks", value, meta: {}, push: (r) => void pushed.push(r) },
    });
    return { more, pushed };
  };

  expect(await open({ to: 2 })).toEqual({
    more: true,
    pushed: [
      { ok: true, value: 1, meta: { "x-n": "1" } },
      { ok: true, value: 2, meta: { "x-n": "2" } },
    ],
  });
  expect(await open({ to: "x" })).toEqual({
    more: true,
    pushed: [{ ok: false, kind: "invalid", payload: {} }],
  });
  expect(await open({ to: 9 })).toEqual({
    more: true,
    pushed: [{ ok: false, kind: "refused", payload: { why: "nine" } }],
  });
  expect(await open({ to: -1 })).toEqual({
    more: true,
    pushed: [{ ok: false, kind: "failed", payload: {} }],
  });
});

test("a scope that reads a definition remotely serves none of it", async () => {
  const scope = await createScope({
    capsules: [
      api({ remote: { call: operation({ label: "c", run: async () => null }) } as never }),
    ],
  }).ready;
  closers.push(() => scope.close());

  expect(await scope.run(api.answer, { input: { address: "echo", value: null, meta: {} } })).toBe(
    null,
  );
  expect(
    await scope.run(api.stream, {
      input: { address: "ticks", value: null, meta: {}, push: () => {} },
    }),
  ).toBe(false);
});

test("receive: a process span for one push, linked to its sender", async () => {
  const { scope, spans } = await here();
  const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

  const traceId = scope.run(api.receive, { input: { key: "ticks", meta: { traceparent } } });
  scope.run(api.receive, { input: { key: "echo" } });

  const [linked, plain] = spans.filter((s) => s.name === "rpc.receive");
  expect(traceId).toBe(linked!.traceId);
  expect(linked!.attributes).toMatchObject({
    "messaging.operation.type": "process",
    "messaging.destination.name": "ticks",
  });
  expect(linked!.events.map((e) => [e.name, e.attributes])).toEqual([["link", { traceparent }]]);
  expect(plain!.events).toEqual([]);
});

test("a bytes field's type is read without its parameters and in lower case", async () => {
  const files = rpc({
    put: {
      input: z.object({ file: bytes(z.custom<RpcBody>(), { max: 64, types: ["text/plain"] }) }),
      output: z.string(),
    },
  });
  const sent: unknown[] = [];
  const call = operation({
    label: "spy.call",
    input: transport.callInput,
    run: async (_, { input }) => (sent.push(input.body?.type), { ok: true as const, value: "ok" }),
  });
  const scope = await createScope({ capsules: [files({ remote: { call } as never })] }).ready;
  closers.push(() => scope.close());

  await scope.run(files.put, {
    input: { file: new Blob(["a"], { type: "Text/Plain ; charset=x" }) },
  });
  await scope.run(files.put, { input: { file: new Blob(["a"], { type: "text/plain" }) } });

  // Bun's Blob adds `;charset=utf-8` to a `text/plain` type; Node's keeps it as given.
  const plainText = expect.stringMatching(/^text\/plain(;charset=utf-8)?$/);
  expect(sent).toEqual([plainText, plainText]);
});
