import { expect, expectTypeOf, test } from "vite-plus/test";

import { capsule, createScope, data, isStarting, operation, type Scope } from "@/index";

/** What the store holds once `start` opens it. */
const opened = data<string>({ initial: "none" });

/** Async, so its type says what a call during start returns: a promise. */
const read = operation({
  label: "read",
  depends: { opened },
  run: async ({ opened }) => opened,
});

/** Sync: after start, its run answers sync again. */
const readNow = operation({
  label: "readNow",
  depends: { opened },
  run: ({ opened }) => opened,
});

/** The test opens the store by hand: start waits on this. */
let gate = Promise.withResolvers<void>();

const store = capsule({
  label: "store",
  exports: { read, readNow },
  hooks: {
    async start({ next, load }) {
      await next();
      await gate.promise;
      load(opened, { role: "state", explain: "Opens the store" }).set("open");
    },
  },
});

const broken = capsule({
  label: "broken",
  exports: { read },
  hooks: {
    async start() {
      throw new Error("start failed");
    },
  },
});

test("run before ready waits for start", async () => {
  gate = Promise.withResolvers();
  await using app = createScope({ capsules: [store] });

  const early = app.run(read);
  gate.resolve();

  expect(await early).toBe("open");
});

test("settle and session wait for start", async () => {
  gate = Promise.withResolvers();
  await using app = createScope({ capsules: [store] });

  const settled = app.settle(read);
  const inSession = app.session((scope) => scope.run(read));
  gate.resolve();

  expect(await settled).toMatchObject({ status: "success", value: "open" });
  expect(await inSession).toBe("open");
});

test("sessions made during start wait, at any depth", async () => {
  gate = Promise.withResolvers();
  await using app = createScope({ capsules: [store] });
  await using session = app.createSession();
  await using inner = session.createSession();

  const early = inner.run(read);
  gate.resolve();

  expect(await early).toBe("open");
});

test("an operation's controller waits for start", async () => {
  gate = Promise.withResolvers();
  await using app = createScope({ capsules: [store] });

  const control = app.controller(read);
  const early = control.run();
  gate.resolve();

  expect(await early).toBe("open");
  expect(await control.run()).toBe("open");
});

test("ready gives the started handle: a sync op answers sync", async () => {
  gate = Promise.withResolvers();
  await using app = createScope({ capsules: [store] });
  gate.resolve();
  const live = await app.ready;

  expect(live.run(readNow)).toBe("open");
});

test("a session made on the starting handle starts with it", async () => {
  gate = Promise.withResolvers();
  await using app = createScope({ capsules: [store] });
  await using session = app.createSession();

  expect(isStarting(session)).toBe(true);
  const early = session.run(read);
  gate.resolve();
  const live = await session.ready;

  expect(await early).toBe("open");
  expect(isStarting(live)).toBe(false);
  expect(live.run(readNow)).toBe("open");
});

test("a session's ready rejects when start fails", async () => {
  await using app = createScope({ capsules: [broken] });

  await expect(app.createSession().ready).rejects.toThrow("start failed");
});

test("capsules that may be unset type as either handle", () => {
  const pick = (on: boolean): Scope.RootOptions["capsules"] => (on ? [store] : undefined);

  expectTypeOf(createScope({ capsules: pick(true) })).toEqualTypeOf<
    Scope.Handle | Scope.Starting
  >();
  expectTypeOf(createScope({ capsules: [store] })).toEqualTypeOf<Scope.Starting>();
  expectTypeOf(createScope()).toEqualTypeOf<Scope.Handle>();
});

test("the starting handle stays a promise after start", async () => {
  gate = Promise.withResolvers();
  await using app = createScope({ capsules: [store] });
  gate.resolve();
  await app.ready;

  const later = app.run(readNow);
  expect(later).toBeInstanceOf(Promise);
  expect(await later).toBe("open");
});

test("a sync throw after start is a rejection on the starting handle", async () => {
  const fails = operation({
    label: "fails",
    run: (): number => {
      throw new Error("sync fail");
    },
  });
  await using app = createScope({ capsules: [capsule({ label: "c", exports: { fails } })] });
  await app.ready;

  await expect(app.run(fails)).rejects.toThrow("sync fail");
});

test("after a failed start, a waiting run meets the closed scope", async () => {
  await using app = createScope({ capsules: [broken] });

  const early = app.run(read);
  const settled = app.settle(read);

  await expect(early).rejects.toThrow("Disposed");
  expect(await settled).toMatchObject({ status: "failed" });
  await expect(app.ready).rejects.toThrow("start failed");
});

test("a close during start: a waiting run meets the closed scope", async () => {
  gate = Promise.withResolvers();
  const app = createScope({ capsules: [store] });

  const early = app.run(read);
  const settled = app.settle(read);
  const closing = app.close();
  gate.resolve();

  await expect(early).rejects.toThrow("Disposed");
  expect((await settled).status).not.toBe("success");
  await closing;
});

test("await using closes the scope at the end of the block", async () => {
  let outside: ReturnType<typeof createScope> | undefined;
  {
    await using app = createScope();
    outside = app;
  }

  expect(() => outside?.run(readNow)).toThrow("Disposed");
});
