// Replay of the KeyStream model (statechart/core4/remote-part/KeyStream.tla):
// a plain key's stream that the server refuses, on the real code.
import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";

import { createScope, data, operation, remoteData, transport } from "@/main";

const { hook } = transport;

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const until = async (ok: () => boolean) => {
  for (let tries = 0; !ok(); tries++) {
    if (tries > 300) throw new Error("timed out");
    await new Promise((done) => setTimeout(done, 10));
  }
};

test("RefusedEndsAsking: a refused plain key does not open its stream again by itself", async () => {
  const count = data({ label: "count", initial: 0 });
  const board = remoteData({ count });
  let opens = 0;
  const guard = operation({
    label: "guard",
    input: hook.start,
    run: (_, { input }) => {
      opens++;
      return input.refuse({ why: "no" });
    },
  });
  const server = await createScope({
    capsules: [board({ serve: true, onStart: [guard] }), memory.server({ services: [board] })],
  }).ready;
  closers.push(() => server.close());

  // 0. The stream opens.  1. The server refuses it.
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), board({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());
  await until(() => tab.resolve(board.faults).get().count?.fault === "refused");
  const first = opens;
  // 2. The wait ends (no trigger came).
  await new Promise((done) => setTimeout(done, 400));

  // ADR 0140: Core never asks again by itself after a fault that is an answer.
  expect({ first, opens }).toEqual({ first, opens: first });
});
