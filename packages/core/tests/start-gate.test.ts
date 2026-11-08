import { expect, test } from "vite-plus/test";

import { capsule, createScope, data, operation } from "@/index";

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

test("after start, a sync op answers sync again", async () => {
  gate = Promise.withResolvers();
  await using app = createScope({ capsules: [store] });
  gate.resolve();
  await app.ready;

  expect(app.run(readNow)).toBe("open");
  expect(app.run).toBe(Object.getPrototypeOf(Object.getPrototypeOf(app)).run);
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
