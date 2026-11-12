import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { channel, createScope, operation, rpc, transport } from "@/main";
import type { Observe } from "@/main";

// What an rpc definition takes at start, the names it gives, and what a remote call logs.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const startOf = (capsules: never[]) =>
  createScope({ capsules }).ready.then(
    (scope) => (closers.push(() => scope.close()), null),
    (e: unknown) => e,
  );

const contracts = {
  echo: { input: z.object({ n: z.number() }), output: z.object({ n: z.number() }) },
  ticks: { mode: "stream" as const, input: z.null(), output: z.number() },
};

const echo = operation({
  label: "echo.here",
  input: contracts.echo.input,
  run: (_, { input }) => input,
});

const ticks = operation({
  label: "ticks.here",
  input: z.null(),
  depends: { out: channel.required },
  run: ({ out }) => out.send(1),
});

test("a definition takes one job: implement or remote, not both and not neither", async () => {
  const api = rpc(contracts, { label: "todo" });
  const both = { implement: { echo, ticks }, remote: memory.client };

  expect(await startOf([api(both as never) as never])).toMatchObject({
    kind: "MissingConfig",
    payload: { label: "todo", key: "implement | remote" },
  });
  expect(await startOf([api({} as never) as never])).toMatchObject({
    kind: "MissingConfig",
    payload: { label: "todo", key: "implement | remote" },
  });
});

test("implement names a run for every key", async () => {
  const api = rpc(contracts);

  expect(await startOf([api({ implement: { echo } } as never) as never])).toMatchObject({
    kind: "MissingConfig",
    payload: { label: "rpc", key: "implement.ticks" },
  });
  expect(
    await startOf([api({ implement: { echo, ticks: { run: null } } } as never) as never]),
  ).toMatchObject({ payload: { key: "implement.ticks" } });
  expect(await startOf([api({ implement: { echo, ticks } }) as never])).toBeNull();
});

test("a remote with no watch can call, but a stream key fails as remote.watch", async () => {
  const api = rpc(contracts);
  const server = await createScope({
    capsules: [api({ implement: { echo, ticks } }), memory.server({ services: [api] })],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [
      memory.client({ peer: server }),
      api({ remote: { call: memory.client.call } as never }),
    ],
  }).ready;
  closers.push(() => tab.close());

  expect(await tab.run(api.echo, { input: { n: 2 } })).toEqual({ n: 2 });
  const failed = await Promise.resolve()
    .then(() => tab.run(api.ticks, { input: null }))
    .catch((e: unknown) => e);
  expect(failed).toMatchObject({
    kind: "MissingConfig",
    payload: { label: "rpc", key: "remote.watch" },
  });
});

test("answer, stream and fault are the definition's own names, not keys", () => {
  for (const key of ["answer", "stream", "fault"]) {
    expect(() => rpc({ [key]: contracts.echo }), key).toThrow(`rpc: "${key}" is a reserved key`);
  }
  expect(() => rpc({ fault: contracts.echo }, { label: "todo" })).toThrow(
    'todo: "fault" is a reserved key',
  );
  expect(() => rpc({ answers: contracts.echo })).not.toThrow();
});

test("the definition's ops carry its label; keys keep their own", () => {
  const api = rpc(contracts, { label: "todo" });
  const plain = rpc(contracts);

  expect([api.answer.label, api.stream.label, api.receive.label]).toEqual([
    "todo.answer",
    "todo.stream",
    "todo.receive",
  ]);
  expect([plain.answer.label, plain.echo.label, plain.ticks.label]).toEqual([
    "rpc.answer",
    "echo",
    "ticks",
  ]);
  expect(api.addresses).toEqual(["echo", "ticks"]);
  expect(api.uploads).toEqual({});
});

test("a fault names its address and kind, and the trace when there is one", () => {
  const api = rpc(contracts);
  const other = rpc(contracts);

  const traced = api.fault.make("echo", "link", { a: 1 }, "abc");
  expect(traced.message).toBe("echo: link (trace abc)");
  expect(traced).toMatchObject({
    address: "echo",
    fault: "link",
    payload: { a: 1 },
    traceId: "abc",
  });
  expect(api.fault.make("echo", "failed", {}, undefined).message).toBe("echo: failed");
  // Who spoke (ADR 0141): the server, or this side; a local fault says if the call left.
  const said = (kind: Parameters<typeof api.fault.make>[1], payload: unknown) => {
    const f = api.fault.make("echo", kind, payload, undefined);
    return [f.from, f.sent];
  };
  expect(said("refused", {})).toEqual(["server", undefined]);
  expect(said("missing", {})).toEqual(["server", undefined]);
  expect(said("decode", { side: "server" })).toEqual(["server", undefined]);
  expect(said("encode", { side: "client" })).toEqual(["local", false]);
  expect(said("invalid", { side: "client" })).toEqual(["local", false]);
  expect(said("decode", { side: "client" })).toEqual(["local", true]);
  expect(said("link", { sent: false })).toEqual(["local", false]);
  expect(said("link", {})).toEqual(["local", true]);
  expect(api.fault.is(traced)).toBe(true);
  expect(other.fault.is(traced)).toBe(false);
  expect(api.fault.is(new Error("echo: link"))).toBe(false);
  expect(api.fault.is(null)).toBe(false);
});

test("a remote fault logs a warning with its address; a refusal does not", async () => {
  const api = rpc(contracts, { label: "todo" });
  const logs: Observe.Log[] = [];
  const server = await createScope({
    capsules: [
      api({
        implement: {
          echo: operation({
            label: "echo.fails",
            input: contracts.echo.input,
            run: (_, { input }): { n: number } => {
              if (input.n === 0) throw new Error("zero");
              return input;
            },
          }),
          ticks,
        },
        onStart: [
          operation({
            label: "gate",
            input: transport.hook.start,
            run: (_, { input }) =>
              Object(input.input).n === 9 ? input.refuse({ why: "nine" }) : undefined,
          }),
        ],
      }),
      memory.server({ services: [api] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [memory.client({ peer: server }), api({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const failed = await tab.run(api.echo, { input: { n: 0 } }).catch((e: unknown) => e);
  const refused = await tab.run(api.echo, { input: { n: 9 } }).catch((e: unknown) => e);

  expect([Object(failed).fault, Object(refused).fault]).toEqual(["failed", "refused"]);
  expect(Object(refused).payload).toEqual({ why: "nine" });
  expect(logs.filter((l) => l.message.endsWith("fault"))).toEqual([
    expect.objectContaining({
      message: "todo fault",
      level: 40,
      attributes: expect.objectContaining({ address: "echo", fault: "failed" }),
    }),
  ]);
});

test("a watch whose transport throws is a bug: failed on this side, never link; a fault passes as it is", async () => {
  const api = rpc(contracts);
  const call = operation({ label: "lost.call", run: async () => null });
  const gone = operation({
    label: "lost.watch",
    run: async (): Promise<void> => {
      throw new Error("TransportFailed");
    },
  });
  const logs: Observe.Log[] = [];
  const scope = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [api({ remote: { call, watch: gone } as never })],
  }).ready;
  closers.push(() => scope.close());

  const drain = async () => {
    for await (const n of await scope.run(api.ticks, { input: null })) void n;
  };
  const error = await drain().then(
    () => null,
    (e: unknown) => e,
  );
  expect(api.fault.is(error) && [error.fault, error.from, error.sent]).toEqual([
    "failed",
    "local",
    true, // a throw may come after the send
  ]);
  // The cause is in this side's log, not hidden as offline.
  expect(logs.find((l) => l.message.endsWith(" bug"))).toMatchObject({
    attributes: { address: "ticks", cause: "Error: TransportFailed" },
  });
  // A lost link is a value: the watch pushes it as its last reply, then ends.
  const unsent = operation({
    label: "unsent.watch",
    input: transport.watchInput,
    run: async (_, { input }): Promise<void> => {
      input.push({ ok: false, kind: "link", payload: { sent: false } });
    },
  });
  const tab = await createScope({
    capsules: [api({ remote: { call, watch: unsent } as never })],
  }).ready;
  closers.push(() => tab.close());
  const never = await (async () => {
    for await (const n of await tab.run(api.ticks, { input: null })) void n;
  })().catch((e: unknown) => e);
  expect(api.fault.is(never) && [never.fault, never.sent]).toEqual(["link", false]);

  const refusedWatch = operation({
    label: "refused.watch",
    run: async (): Promise<void> => {
      throw api.fault.make("ticks", "refused", { why: "no" }, undefined);
    },
  });
  const other = await createScope({
    capsules: [api({ remote: { call, watch: refusedWatch } as never })],
  }).ready;
  closers.push(() => other.close());
  const passed = await (async () => {
    for await (const n of await other.run(api.ticks, { input: null })) void n;
  })().then(
    () => null,
    (e: unknown) => e,
  );
  expect(api.fault.is(passed) && [passed.fault, passed.payload]).toEqual([
    "refused",
    { why: "no" },
  ]);
});
