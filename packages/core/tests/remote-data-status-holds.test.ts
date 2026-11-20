/**
 * A watch of `board.status(read)` holds the read's part, as a reader of the part does (ADR 0164):
 * a TanStack Query observer fetches its query. A `get()` of the status holds nothing.
 */
import { makeTestClock, memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, transport } from "@/main";
import type { Scope } from "@/main";

const { hook } = transport;

type Task = { project: string; id: string; title: string };

const Task = z.object({ project: z.string(), id: z.string(), title: z.string() });

const tasks = data({
  label: "holds.tasks",
  mode: "keyed",
  parse: Task,
  key: (t) => ({ project: t.project, id: t.id }),
});

const board = remoteData({ tasks });

const p1 = board.tasks.where({ project: "p1" });

const p2 = board.tasks.where({ project: "p2" });

/** The server's view of one test: each call's key and project, at its start and at its end.
 * The guard refuses every call for the `refused` project. */
const calls = { started: [] as string[], finishes: [] as string[], refused: "" };

const started = operation({
  label: "holds.started",
  input: hook.start,
  run: (_, { input }) => {
    const project = board.part(input)?.project;
    calls.started.push(`${input.key} ${project}`);
    if (project === calls.refused) return input.refuse({ project });
  },
});

const ended = operation({
  label: "holds.ended",
  input: hook.finish,
  run: (_, { input }) => void calls.finishes.push(`${input.key} ${board.part(input)?.project}`),
});

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  Object.assign(calls, { started: [], finishes: [], refused: "" });
});

/** A peer of `server` for a tab. While `link.down`, it is a closed scope, as a server that went
 * away. */
async function linkTo(server: Scope.Handle) {
  const gone = await createScope({ capsules: [] }).ready;
  await gone.close();
  const link = { down: false };
  const peer: Scope.Handle = {
    ...server,
    createSession: (options) => (link.down ? gone : server).createSession(options),
  };
  return { peer, link };
}

/** A server with p1/a and p2/b, and a tab on a test clock that reaches it through `link`. */
async function boot() {
  const server = await createScope({
    capsules: [
      board({ serve: true, onStart: [started], onFinish: [ended] }),
      memory.server({ services: [board] }),
    ],
  }).ready;
  closers.push(() => server.close());
  server.controller(tasks).set({ project: "p1", id: "a", title: "a" });
  server.controller(tasks).set({ project: "p2", id: "b", title: "b" });

  const { peer, link } = await linkTo(server);
  const clock = makeTestClock();
  const tab = await createScope({
    clock,
    capsules: [memory.client({ peer }), board({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());
  return { server, tab, clock, link };
}

/** A read for `expect.poll` that first moves the tab's clock 100 ms, so a back-off ends as it
 * would. */
const ticking = (clock: ReturnType<typeof makeTestClock>, read: () => boolean) => () => {
  clock.advance(100);
  return read();
};

test("a status watch alone asks for the part, and its leave drops it", async () => {
  const { tab, clock } = await boot();
  const state = tab.resolve(board.status(p1));

  const stop = state.watch(() => undefined);
  await expect.poll(ticking(clock, () => state.get()?.status === "ready")).toBe(true);
  const held = tab.resolve(p1).get();
  stop();
  await expect.poll(ticking(clock, () => calls.finishes.includes("tasks p1"))).toBe(true);

  expect(calls.started).toEqual(["tasks p1", "tasks.ask p1"]);
  expect(held).toEqual([{ project: "p1", id: "a", title: "a" }]);
  expect(tab.resolve(board.tasks).get()).toEqual([]);
});

test("a status watch and a value watch share one ask, and the part stays until both leave", async () => {
  const { tab, clock } = await boot();
  const state = tab.resolve(board.status(p1));
  const value = tab.resolve(p1);
  const stopState = state.watch(() => undefined);
  const stopValue = value.watch(() => undefined);
  await expect.poll(ticking(clock, () => value.get().length === 1)).toBe(true);

  stopValue();
  const kept = { state: state.get()?.status, value: value.get().length };
  stopState();
  await expect.poll(ticking(clock, () => calls.finishes.includes("tasks p1"))).toBe(true);

  expect(kept).toEqual({ state: "ready", value: 1 });
  expect(calls.started).toEqual(["tasks p1", "tasks.ask p1"]);
});

test("a refused part held by its status alone asks again only when invalidate names it", async () => {
  const { tab, clock } = await boot();
  calls.refused = "p2";
  const state = tab.resolve(board.status(p2));
  const opens = () => calls.started.filter((call) => call === "tasks p2").length;
  state.watch(() => undefined);
  await expect.poll(ticking(clock, () => state.get()?.status === "fault")).toBe(true);
  const first = opens();
  const fence = tab.resolve(p1);
  fence.watch(() => undefined);
  await expect.poll(ticking(clock, () => fence.get().length === 1)).toBe(true);
  const waited = opens();

  await tab.run(board.invalidate, { input: { tasks: { project: "p2" } } });
  await expect.poll(ticking(clock, () => opens() > first)).toBe(true);

  expect(state.get()).toMatchObject({ status: "fault", fault: { fault: "refused" } });
  expect(waited).toBe(first);
});

test("a status watch that moves from part A to part B drops A and asks for B", async () => {
  const { tab, clock } = await boot();
  const a = tab.resolve(board.status(p1));
  const stopA = a.watch(() => undefined);
  await expect.poll(ticking(clock, () => a.get()?.status === "ready")).toBe(true);

  stopA();
  const b = tab.resolve(board.status(p2));
  b.watch(() => undefined);
  await expect
    .poll(ticking(clock, () => b.get()?.status === "ready" && calls.finishes.includes("tasks p1")))
    .toBe(true);

  expect(calls.started).toContain("tasks.ask p2");
  expect(tab.resolve(board.tasks).get()).toEqual([{ project: "p2", id: "b", title: "b" }]);
});

test("a part held by its status alone shows a broken link, then asks again by itself", async () => {
  const { server, tab, clock, link } = await boot();
  const state = tab.resolve(board.status(p1));
  state.watch(() => undefined);
  await expect.poll(ticking(clock, () => state.get()?.status === "ready")).toBe(true);

  link.down = true;
  server.run(board.drop);
  await expect.poll(ticking(clock, () => state.get()?.status === "fault")).toBe(true);
  const broken = state.get();
  link.down = false;
  await expect.poll(ticking(clock, () => state.get()?.status === "ready")).toBe(true);

  expect(broken).toMatchObject({ status: "fault", fault: { fault: "link" } });
  expect(calls.started.filter((call) => call === "tasks.ask p1")).toHaveLength(2);
});

test("a status watch in a session holds the part, and its leave drops it", async () => {
  const { tab, clock } = await boot();
  const session = tab.createSession();
  closers.push(() => session.close());
  const state = session.resolve(board.status(p1));

  const stop = state.watch(() => undefined);
  await expect.poll(ticking(clock, () => state.get()?.status === "ready")).toBe(true);
  stop();
  await expect.poll(ticking(clock, () => calls.finishes.includes("tasks p1"))).toBe(true);

  expect(calls.started).toEqual(["tasks p1", "tasks.ask p1"]);
});

test("a plain status watcher hears pending, then ready", async () => {
  const { tab, clock } = await boot();
  const state = tab.resolve(board.status(p1));
  const heard: (string | undefined)[] = [];

  state.watch((now) => heard.push(now?.status));
  await expect.poll(ticking(clock, () => state.get()?.status === "ready")).toBe(true);

  expect(heard).toEqual(["pending", "ready"]);
});

test("many parts held by their status and then left hold nothing on the server", async () => {
  const { server, tab, clock } = await boot();
  const projects = Array.from({ length: 20 }, (_, at) => `q${at}`);
  for (const project of projects) server.controller(tasks).set({ project, id: "x", title: "x" });
  const states = projects.map((project) =>
    tab.resolve(board.status(board.tasks.where({ project }))),
  );

  const stops = states.map((state) => state.watch(() => undefined));
  await expect
    .poll(ticking(clock, () => states.every((state) => state.get()?.status === "ready")))
    .toBe(true);
  for (const stop of stops) stop();
  await expect
    .poll(ticking(clock, () => projects.every((p) => calls.finishes.includes(`tasks ${p}`))))
    .toBe(true);

  expect(calls.started.filter((call) => call.startsWith("tasks q"))).toHaveLength(20);
  expect(tab.resolve(board.tasks).get()).toEqual([]);
});
