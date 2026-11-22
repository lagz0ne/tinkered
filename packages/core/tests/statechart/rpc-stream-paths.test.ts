// Replays of the rpc-stream model (statechart/core4/rpc-stream/RpcStream.tla):
// each test runs one model path, one step per action, on the real code.
import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { channel, createScope, operation, rpc, tag, transport } from "@/main";

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const api = rpc({ open: { mode: "stream", input: z.null(), output: z.number() } });

/** Sends 1, then waits until its channel closes. */
const open = operation({
  label: "open.here",
  input: z.null(),
  depends: { out: channel.required },
  run: async ({ out }) => {
    out.send(1);
    await new Promise<void>((left) => {
      out.closed.addEventListener("abort", () => left(), { once: true });
    });
  },
});

const what = (error: unknown) => (api.fault.is(error) ? error.fault : String(error));

test("OwnStopIsNotFailed path: a caller's own signal ends a remote stream as failed", async () => {
  const server = await createScope({
    capsules: [api({ implement: { open } }), memory.server({ services: [api] })],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), api({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());
  const stop = new AbortController();

  // 1. The call answers.
  const values = await tab.run(api.open, { input: null, signal: stop.signal });
  let got = "clean";
  try {
    for await (const _ of values) {
      // 2. The caller's signal aborts.
      stop.abort();
    }
    // 3. The loop reaches the end.
  } catch (error) {
    got = what(error);
  }

  // ADR 0133 d1: a stop by the call's own signal is a cancellation, not a bug.
  expect(got).not.toBe("failed");
});

test("a stream run here with a signal answers at once, and the signal ends it clean (ADR 0169)", async () => {
  const tab = await createScope({ capsules: [api({ implement: { open } })] }).ready;
  closers.push(() => tab.close());
  const stop = new AbortController();

  // 1. The call answers while the op still runs.
  const values = await tab.run(api.open, { input: null, signal: stop.signal });
  const seen: unknown[] = [];
  let got = "clean";
  try {
    for await (const n of values) {
      seen.push(n);
      // 2. The caller's signal aborts.
      stop.abort();
    }
    // 3. The loop reaches the end.
  } catch (error) {
    got = what(error);
  }

  // ADR 0133 d1: a stop by the call's own signal is a cancellation; ADR 0169: no child session.
  expect({ seen, got }).toEqual({ seen: [1], got: "clean" });
});

test("a stream with a signal that already aborted runs nothing (ADR 0090, ADR 0169)", async () => {
  const tab = await createScope({ capsules: [api({ implement: { open } })] }).ready;
  closers.push(() => tab.close());

  const seen: unknown[] = [];
  for await (const n of await tab.run(api.open, { input: null, signal: AbortSignal.abort() })) {
    seen.push(n);
  }

  expect(seen).toEqual([]);
});

test("a stream run here with tags answers at once, and its op reads the tags (ADR 0169 d3)", async () => {
  const who = tag<string>({ label: "who", default: "nobody" });
  const named = rpc({ open: { mode: "stream", input: z.null(), output: z.string() } });
  const open = operation({
    label: "named.here",
    input: z.null(),
    depends: { out: channel.required, who },
    run: async ({ out, who }) => {
      out.send(who);
      await new Promise<void>((left) => {
        out.closed.addEventListener("abort", () => left(), { once: true });
      });
    },
  });
  const tab = await createScope({ capsules: [named({ implement: { open } })] }).ready;
  closers.push(() => tab.close());

  const seen: unknown[] = [];
  for await (const name of await tab.run(named.open, { input: null, tags: [who("me")] })) {
    seen.push(name);
    break;
  }

  expect(seen).toEqual(["me"]);
});

test("a stream call's tags reach its lifecycle hooks, here and remote (ADR 0169 d3)", async () => {
  const who = tag<string>({ label: "who", default: "nobody" });
  const heard: string[] = [];
  const named = rpc({ open: { mode: "stream", input: z.null(), output: z.number() } });
  const onStart = operation({
    label: "named.start",
    input: transport.hook.start,
    depends: { who },
    run: ({ who }) => void heard.push(who),
  });
  const server = await createScope({
    capsules: [named({ implement: { open } }), memory.server({ services: [named] })],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [
      memory.client({ peer: server }),
      named({ remote: memory.client, onStart: [onStart] }),
    ],
  }).ready;
  closers.push(() => tab.close());
  const here = await createScope({ capsules: [named({ implement: { open }, onStart: [onStart] })] })
    .ready;
  closers.push(() => here.close());

  for (const scope of [tab, here]) {
    for await (const _ of await scope.run(named.open, { input: null, tags: [who("me")] })) break;
  }

  expect(heard).toEqual(["me", "me"]);
});
