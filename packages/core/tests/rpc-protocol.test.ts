import { createMemory, memory } from "@tinker/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { channel, createScope, operation, rpc, transport } from "@/main";
import type { Observe, Scope } from "@/main";

// The protocol's own steps, through the memory transport: meta and renew on the client, the
// route table, a service that throws, and each answer a text op gives.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

const api = rpc({
  echo: { input: z.object({ n: z.number() }), output: z.object({ n: z.number() }) },
  count: { mode: "stream", input: z.null(), output: z.number() },
});

const echo = operation({ label: "echo.here", input: api.echo.input, run: (_, { input }) => input });

const count = operation({
  label: "count.here",
  input: z.null(),
  depends: { out: channel.required },
  run: ({ out }) => {
    out.send(1);
  },
});

/** The server: each call's meta, in order; a call passes only with `token: fresh`. */
async function serverOf(logs: Observe.Log[] = []) {
  const asked: Array<Record<string, string>> = [];
  const gate = operation({
    label: "gate",
    input: transport.hook.start,
    run: (_, { input }) => {
      asked.push(input.meta);
      return input.meta.token === "fresh" ? undefined : input.refuse({ why: "stale" });
    },
  });
  const server = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [
      api({ implement: { echo, count }, onStart: [gate] }),
      memory.server({ services: [api] }),
    ],
  }).ready;
  closers.push(() => server.close());

  return { server, asked };
}

/** A client whose meta reads `token`, and whose renew sets it to `fresh` after a wait. */
async function clientOf(
  peer: Scope.Handle,
  { renews = true, fails = false }: { renews?: boolean; fails?: boolean } = {},
) {
  const state = { token: "old", renewals: [] as unknown[] };
  const meta = operation({ label: "meta", run: async () => ({ token: state.token }) });
  const renew = operation({
    label: "renew",
    input: z.object({ payload: z.unknown(), sent: z.record(z.string(), z.string()) }),
    run: async (_, { input }) => {
      state.renewals.push(input);
      await tick();
      if (fails) throw new Error("renew broke");
      if (renews) state.token = "fresh";
      return renews;
    },
  });
  const tab = await createScope({
    capsules: [
      memory.client({ peer, meta: meta as never, renew: renew as never }),
      api({ remote: memory.client }),
    ],
  }).ready;
  closers.push(() => tab.close());

  return { tab, state };
}

const faultOf = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => (api.fault.is(e) ? { fault: e.fault, payload: e.payload } : e),
  );

test("a refused call asks renew once, then sends again with the new meta", async () => {
  const { server, asked } = await serverOf();
  const { tab, state } = await clientOf(server);

  expect(await tab.run(api.echo, { input: { n: 1 } })).toEqual({ n: 1 });
  expect(asked.map((m) => m.token)).toEqual(["old", "fresh"]);
  expect(state.renewals).toEqual([{ payload: { why: "stale" }, sent: { token: "old" } }]);
});

test("a renew that says no, or throws, leaves the refusal as the answer", async () => {
  const { server, asked } = await serverOf();
  const no = await clientOf(server, { renews: false });
  const broke = await clientOf(server, { fails: true });

  expect(await faultOf(no.tab.run(api.echo, { input: { n: 1 } }))).toEqual({
    fault: "refused",
    payload: { why: "stale" },
  });
  expect(await faultOf(broke.tab.run(api.echo, { input: { n: 2 } }))).toEqual({
    fault: "refused",
    payload: { why: "stale" },
  });
  expect(asked.length).toBe(2); // no second send for either
  expect([no.state.renewals.length, broke.state.renewals.length]).toEqual([1, 1]);
});

test("with no renew, a refusal is the answer, sent once", async () => {
  const { server, asked } = await serverOf();
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), api({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  expect(await faultOf(tab.run(api.echo, { input: { n: 1 } }))).toMatchObject({
    fault: "refused",
  });
  expect(asked).toEqual([{}]);
});

test("calls refused at one time share one renew; a later refusal renews again", async () => {
  const { server } = await serverOf();
  const { tab, state } = await clientOf(server);

  const both = await Promise.all([
    tab.run(api.echo, { input: { n: 1 } }),
    tab.run(api.echo, { input: { n: 2 } }),
  ]);
  expect(both).toEqual([{ n: 1 }, { n: 2 }]);
  expect(state.renewals.length).toBe(1);

  state.token = "old";
  expect(await tab.run(api.echo, { input: { n: 3 } })).toEqual({ n: 3 });
  expect(state.renewals.length).toBe(2);
});

test("a second refusal after a renew is the answer: no third send", async () => {
  const asked: string[] = [];
  const never = operation({
    label: "never",
    input: transport.hook.start,
    run: (_, { input }) => (asked.push(input.meta.token ?? ""), input.refuse({ why: "no" })),
  });
  const server = await createScope({
    capsules: [
      api({ implement: { echo, count }, onStart: [never] }),
      memory.server({ services: [api] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const { tab, state } = await clientOf(server);

  expect(await faultOf(tab.run(api.echo, { input: { n: 1 } }))).toMatchObject({
    fault: "refused",
  });
  expect(asked).toEqual(["old", "fresh"]);
  expect(state.renewals.length).toBe(1);
});

test("a refused push on a watch starts a renew", async () => {
  const { server } = await serverOf();
  const { tab, state } = await clientOf(server);

  const failed = await (async () => {
    try {
      for await (const _ of await tab.run(api.count, { input: null })) break;
    } catch (error) {
      return error;
    }
  })();
  await tick(30);

  expect(api.fault.is(failed) && failed.fault).toBe("refused");
  expect(state.renewals).toEqual([{ payload: { why: "stale" }, sent: { token: "old" } }]);
});

test("an address no server has is the server's missing on a call", async () => {
  const other = rpc({ gone: { input: z.null(), output: z.null() } });
  const { server } = await serverOf();
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), other({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const failed = await tab.run(other.gone, { input: null }).catch((e: unknown) => e);
  expect(other.fault.is(failed) && [failed.fault, failed.from]).toEqual(["missing", "server"]);
});

test("a second memory transport reaches its own server: two pairs in one scope", async () => {
  const other = createMemory();
  const ghost = rpc({ gone: { input: z.null(), output: z.null() } });
  const server = await createScope({
    capsules: [api({ implement: { echo, count } }), other.server({ services: [api] })],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [
      other.client({ peer: server }),
      api({ remote: other.client }),
      ghost({ remote: other.client }),
    ],
  }).ready;
  closers.push(() => tab.close());

  expect(await tab.run(api.echo, { input: { n: 1 } })).toEqual({ n: 1 });
  const failed = await tab.run(ghost.gone, { input: null }).catch((e: unknown) => e);
  expect(ghost.fault.is(failed) && [failed.fault, failed.from]).toEqual(["missing", "server"]);
});

test("two client sets reach one memory server, as two sockets reach one URL", async () => {
  const signed = createMemory();
  const fresh = operation({ label: "fresh.meta", run: async () => ({ token: "fresh" }) });
  const { server } = await serverOf(); // the default memory server only
  const tab = await createScope({
    capsules: [
      signed.client({ peer: server, meta: fresh as never }),
      api({ remote: signed.client }),
    ],
  }).ready;
  closers.push(() => tab.close());

  expect(await tab.run(api.echo, { input: { n: 2 } })).toEqual({ n: 2 });
});

test("a peer with no memory server is link, sent: false: nothing ran", async () => {
  const bare = createScope({});
  closers.push(() => bare.close());
  const tab = await createScope({
    capsules: [memory.client({ peer: bare }), api({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const failed = await tab.run(api.echo, { input: { n: 1 } }).catch((e: unknown) => e);
  expect(api.fault.is(failed) && [failed.fault, failed.sent]).toEqual(["link", false]);
  const drain = async () => {
    for await (const n of await tab.run(api.count, { input: null })) void n;
  };
  const ended = await drain().catch((e: unknown) => e);
  expect(api.fault.is(ended) && [ended.fault, ended.sent]).toEqual(["link", false]);
});

test("a closed peer is link with sent: false: nothing ran", async () => {
  const { server } = await serverOf();
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), api({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());
  await server.close();

  const failed = await tab.run(api.echo, { input: { n: 1 } }).catch((e: unknown) => e);
  expect(api.fault.is(failed) && [failed.fault, failed.from, failed.sent]).toEqual([
    "link",
    "local",
    false,
  ]);
  const drain = async () => {
    for await (const n of await tab.run(api.count, { input: null })) void n;
  };
  const ended = await drain().catch((e: unknown) => e);
  expect(api.fault.is(ended) && [ended.fault, ended.sent]).toEqual(["link", false]);
});

test("a transport whose send throws is a bug: logged, failed on this side, never link", async () => {
  const logs: Observe.Log[] = [];
  // A peer that throws, as a backend with a bug: the transport throws.
  const bare = {
    createSession: () => ({
      resolve: () => {
        throw new Error("broken peer");
      },
    }),
  } as never;
  const tab = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [memory.client({ peer: bare }), api({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const failed = await tab.run(api.echo, { input: { n: 1 } }).catch((e: unknown) => e);
  expect(api.fault.is(failed) && [failed.fault, failed.from]).toEqual(["failed", "local"]);
  expect(logs.find((l) => l.message === "protocol service failed")?.attributes).toMatchObject({
    address: "echo",
    cause: expect.stringContaining("broken peer"), // shown, not hidden as offline
  });
});

/** A service whose answer and stream throw: a bug in it, not in rpc. */
const broken = (() => {
  const answer = operation({
    label: "broken.answer",
    input: transport.callInput,
    run: (): Promise<null> => Promise.reject(new Error("answer broke")),
  });
  const stream = operation({
    label: "broken.stream",
    input: transport.watchInput,
    run: (): Promise<boolean> => Promise.reject(new Error("stream broke")),
  });
  const quiet = operation({
    label: "quiet.answer",
    input: transport.callInput,
    run: async () => null,
  });
  return {
    broken: { label: "broken", addresses: ["b"], answer, stream } as transport.Service,
    quiet: { label: "quiet", addresses: ["q"], answer: quiet, stream } as transport.Service,
  };
})();

async function rawServer(services: readonly transport.Service[], strict = false) {
  const logs: Observe.Log[] = [];
  const server = await createScope({
    observe: { log: (entry) => void logs.push(entry) },
    capsules: [memory.server({ services, strict })],
  }).ready;
  closers.push(() => server.close());
  return { server, logs };
}

test("a service that throws answers failed, and logs its cause with the address", async () => {
  const { server, logs } = await rawServer([broken.broken]);

  const text = await server.run(memory.server.serve, {
    input: { address: "b", text: "null", meta: {} },
  });
  expect(JSON.parse(text!)).toEqual({ ok: false, kind: "failed", payload: {} });
  const line = logs.find((l) => l.message === "protocol service failed");
  expect(line?.attributes).toMatchObject({ address: "b", cause: "Error: answer broke" });
  expect(String(line?.attributes.stack)).toContain("answer broke");
});

test("serve: a text the codec cannot read is decode; an unknown address or a null answer is null", async () => {
  const { server } = await rawServer([broken.quiet]);
  const serve = (address: string, text: string) =>
    server.run(memory.server.serve, { input: { address, text, meta: {} } });

  expect(JSON.parse((await serve("q", "{"))!)).toEqual({
    ok: false,
    kind: "decode",
    payload: { side: "server" },
  });
  expect(await serve("nobody", "null")).toBeNull();
  expect(await serve("q", "null")).toBeNull();
});

test("serveStream: each end it can have, and what it pushes", async () => {
  const { server, logs } = await rawServer([broken.broken]);
  const open = async (address: string, text: string) => {
    const pushed: unknown[] = [];
    const more = await server.run(memory.server.serveStream, {
      input: { address, text, meta: {}, push: (t: string) => void pushed.push(JSON.parse(t)) },
    });
    return { more, pushed };
  };

  expect(await open("b", "{")).toEqual({
    more: true,
    pushed: [{ ok: false, kind: "decode", payload: { side: "server" } }],
  });
  expect(await open("nobody", "null")).toEqual({ more: false, pushed: [] });
  expect(await open("b", "null")).toEqual({
    more: true,
    pushed: [{ ok: false, kind: "failed", payload: {} }],
  });
  expect(logs.find((l) => l.message === "protocol service failed")?.attributes).toMatchObject({
    address: "b",
    cause: "Error: stream broke",
  });
});

test("two services with one address: the first wins with a warning, or strict fails start", async () => {
  const shadow = { ...broken.quiet, label: "shadow", addresses: ["q"] } as transport.Service;
  const { server, logs } = await rawServer([broken.quiet, shadow]);

  expect(
    await server.run(memory.server.serve, { input: { address: "q", text: "null", meta: {} } }),
  ).toBeNull();
  expect(logs.filter((l) => l.message === "protocol duplicate address")).toEqual([
    expect.objectContaining({
      level: 40,
      attributes: { capsule: "memory.server", address: "q", winner: "quiet", shadowed: "shadow" },
    }),
  ]);

  const strict = createScope({
    capsules: [memory.server({ services: [broken.quiet, shadow], strict: true })],
  });
  const failed = await strict.ready.then(
    () => null,
    (e: unknown) => e,
  );
  expect(failed).toMatchObject({
    kind: "DuplicateAddress",
    payload: { address: "q", services: ["quiet", "shadow"] },
  });
});

test("a watch whose value the codec cannot carry pushes encode, and sends nothing", async () => {
  const big = rpc({ ticks: { mode: "stream", input: z.unknown(), output: z.null() } });
  const sent: unknown[] = [];
  const spy = operation({
    label: "spy",
    input: transport.hook.start,
    run: (_, { input }) => void sent.push(input.key),
  });
  const server = await createScope({
    capsules: [
      big({ implement: { ticks: count as never }, onStart: [spy] }),
      memory.server({ services: [big] }),
    ],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), big({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const failed = await (async () => {
    try {
      for await (const _ of await tab.run(big.ticks, { input: 1n })) break;
    } catch (error) {
      return error;
    }
  })();
  expect(big.fault.is(failed) && failed.fault).toBe("encode");
  expect(sent).toEqual([]);
});
