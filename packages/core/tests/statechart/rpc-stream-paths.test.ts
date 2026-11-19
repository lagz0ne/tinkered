// Replays of the rpc-stream model (statechart/core4/rpc-stream/RpcStream.tla):
// each test runs one model path, one step per action, on the real code.
import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { channel, createScope, operation, rpc } from "@/main";

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
