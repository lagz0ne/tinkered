import { createScope } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { makeTestClock } from "@tinker/core/testing";
import { afterAll, expect, test } from "vite-plus/test";

import { ocean } from "@/play";
import type { Frames } from "@/play/starter/state";
import { sea, tide } from "@/sea";
import { seaOps } from "@/sea/index.server";

import { listen, wsClient as tab, wsServer as server } from "./support/ws";

// The shared sea as the cmds install it, over a real socket: the server holds each room's
// waves; each tab runs the playground's ocean plus `tide({ room })`. Nothing else is added.

const backend = await createScope({
  capsules: [
    sea.board({ serve: true }),
    sea.api({ implement: seaOps }),
    server.server({ path: "/rpc", services: [sea.board, sea.api] }),
  ],
}).ready;

const { bun, url } = listen(backend, [server.server]);
const tabs: Scope.Handle[] = [];

/** Frames by hand: `pump` runs what is queued. */
const frameQueue = () => {
  const due = new Map<number, FrameRequestCallback>();
  let next = 1;
  const frames: Frames = {
    requestAnimationFrame: (cb) => (due.set(next, cb), next++),
    cancelAnimationFrame: (id) => void due.delete(id),
  };
  const pump = () => {
    const run = [...due.values()];
    due.clear();
    for (const cb of run) cb(0);
  };
  return { frames, pump };
};

/** A tab in `room`: the ocean on a 3×3 board, with its own frames and clock. */
const open = async (room: string) => {
  const queue = frameQueue();
  const clock = makeTestClock({ now: 1000 });
  const scope = await createScope({
    clock,
    capsules: [
      tab.client({ url: `${url}/rpc` }),
      sea.board({ read: tab.client }),
      sea.api({ remote: tab.client }),
      ocean({ cols: 3, rows: 3, frames: queue.frames }),
      tide({ room }),
    ],
  }).ready;
  tabs.push(scope);
  return { scope, clock, queue, waves: () => scope.resolve(ocean.waves).get() };
};

const until = async (ok: () => boolean) => {
  const end = Date.now() + 8000;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

afterAll(async () => {
  for (const scope of tabs) await scope.close();
  await bun.stop(true);
  await backend.close();
});

test("a press starts its wave in the pressing tab at once, before the room answers", async () => {
  const a = await open("quay");

  const told = a.scope.run(ocean.press, { input: { x: 1, y: 2 } });
  const started = a.waves().length;
  await Promise.resolve(told);

  expect(started).toBe(1);
});

test("a press lands in every tab of the room, once and in one hue, and nowhere else", async () => {
  const [a, b, other] = [await open("bay"), await open("bay"), await open("cove")];
  const echo = () => a.scope.resolve(sea.board.waves.where({ room: "bay" })).get();

  // The tide's hook answers the press with its call to the room, so the result is a promise.
  const dealt = await Promise.resolve(a.scope.run(ocean.press, { input: { x: 1, y: 2 } }));
  await until(() => b.waves().length === 1 && echo().length === 1);

  expect(dealt).toEqual({ hue: a.waves()[0]!.hue });
  expect(a.waves()).toHaveLength(1);
  expect(b.waves()[0]).toMatchObject({ x: 1, y: 2, hue: a.waves()[0]!.hue });
  expect(other.waves()).toEqual([]);
});

test("a press given as raw input reaches the room too; a bad one lands nowhere", async () => {
  const [a, b] = [await open("reef"), await open("reef")];

  await Promise.resolve(a.scope.run(ocean.press, { rawInput: { x: 2, y: 0 } }));
  await until(() => b.waves().length === 1);
  expect(b.waves()[0]).toMatchObject({ x: 2, y: 0, power: 1 });

  expect(() => a.scope.run(ocean.press, { rawInput: { x: "left" } })).toThrow();
  expect(a.waves()).toHaveLength(1);
});

test("the storm's presses go to the room as well", async () => {
  const [a, b] = [await open("gale"), await open("gale")];

  a.scope.run(ocean.setStorm, { input: true });
  a.clock.advance(1000);
  a.queue.pump();
  await until(() => b.waves().length === 1);

  expect(a.scope.resolve(ocean.storm).get().on).toBe(true);
  expect(b.scope.resolve(ocean.storm).get().on).toBe(false);
});

test("a busy room holds 64 waves at most, and drops a wave a few seconds after it began", async () => {
  const clock = makeTestClock({ now: 50_000 });
  const host = await createScope({
    clock,
    capsules: [sea.board({ serve: true }), sea.api({ implement: seaOps })],
  }).ready;
  const pressAt = (n: number) =>
    host.run(seaOps["wave.press"], { input: { room: "r", id: `w${n}`, x: n % 60, y: 0, hue: 7 } });

  for (let n = 0; n < 70; n++) pressAt(n);
  const full = host.resolve(sea.board.waves.where({ room: "r" })).get().length;
  clock.advance(5000);
  pressAt(70);

  expect(full).toBe(64);
  expect(host.resolve(sea.board.waves.where({ room: "r" })).get()).toHaveLength(1);
  await host.close();
});
