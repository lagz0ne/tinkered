/// <reference lib="es2024.promise" />
import { expect, test } from "vite-plus/test";
import {
  createScope,
  data,
  extension,
  isError,
  namespace,
  operation,
  resource,
  tag,
  type Scope,
} from "../src/index";

function gate() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const count = data({ initial: 0 });
const lifetime = resource({
  label: "lifetime",
  target: "session",
  factory: (_deps, ctx) => ({ closing: ctx.closing, signal: ctx.signal }),
});

const helper = operation({ label: "drain helper", run: () => 7 });
const helperZone = tag({ label: "drain helper zone", default: "home" });

for (const mode of ["root stop", "root close", "session close"]) {
  test(`a running call finishes its write during graceful ${mode}`, async () => {
    const finish = gate();
    const write = operation({
      label: "write",
      depends: { count: count.controller },
      run: async ({ count }) => {
        await finish.promise;
        count.set(1);
        return count.get();
      },
    });
    const stop = new AbortController();
    const root = createScope({ signal: stop.signal });
    await root.ready;
    const session = root.createSession();
    const signals = session.resolve(lifetime);
    const began = gate();
    signals.closing.addEventListener("abort", () => began.resolve(), { once: true });
    const running = session.settle(write);
    const closing =
      mode === "session close"
        ? session.close({ graceful: true, withData: true })
        : mode === "root close"
          ? root.close({ graceful: true })
          : root.closed;
    if (mode === "root stop") stop.abort();
    await began.promise;
    await expect.poll(() => session.settle({ run: () => 0 }).status).toBe("failed");
    expect(signals.signal.aborted).toBe(false);
    finish.resolve();
    expect(await running).toMatchObject({ status: "success", value: 1 });
    const ended = await closing;
    expect(ended.status).toBe("success");
    if (mode === "session close") {
      expect(ended.data?.get(count)).toEqual({ present: true, value: 1 });
      await root.close({ graceful: true });
    }
  });
}

test("a running call's async defer can write during graceful close", async () => {
  const finish = gate();
  const cleanup = gate();
  const entered = gate();
  const write = operation({
    label: "write",
    depends: { count: count.controller },
    run: async ({ count }, ctx) => {
      ctx.defer(async () => {
        entered.resolve();
        await cleanup.promise;
        count.set(2);
      });
      await finish.promise;
    },
  });
  const root = createScope();
  const session = root.createSession();
  const running = session.run(write);
  const closing = session.close({ graceful: true, withData: true });
  finish.resolve();
  await entered.promise;
  cleanup.resolve();
  await running;
  const ended = await closing;
  expect(ended.teardownErrors).toBeUndefined();
  expect(ended.data?.get(count)).toEqual({ present: true, value: 2 });
  await root.close();
});

test("graceful close refuses new calls through handles and saved controllers", async () => {
  const finish = gate();
  const work = operation({ label: "work", run: () => finish.promise });
  const root = createScope();
  const saved = root.controller(work);
  const running = root.run(work);
  const closing = root.close({ graceful: true });
  for (const result of [root.settle(work), saved.settle(), root.settle({ run: () => 1 })]) {
    const ended = await result;
    if (ended.status !== "failed" || !isError(ended.error, "Disposed")) throw ended;
  }
  try {
    root.createSession();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
  const error = await root
    .session(() => 1)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  if (!isError(error, "Disposed")) throw error;
  finish.resolve();
  await running;
  expect((await closing).status).toBe("success");
});

test("forced close aborts a running call without waiting for its write gate", async () => {
  const finish = gate();
  const write = operation({
    label: "write",
    depends: { count: count.controller },
    run: async ({ count }, ctx) => {
      await Promise.race([
        finish.promise,
        new Promise<never>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
        }),
      ]);
      count.set(1);
    },
  });
  const root = createScope();
  const running = root.settle(write);
  const closing = root.close({ withData: true });
  expect((await running).status).toBe("cancelled");
  const ended = await closing;
  expect(ended.status).toBe("cancelled");
  expect(ended.data?.get(count)).toEqual({ present: false });
  finish.resolve();
});

test("closed reports a real failure from a running call's write", async () => {
  const finish = gate();
  const cause = new Error("watch failed");
  const write = operation({
    label: "write",
    depends: { count: count.controller },
    run: async ({ count }) => {
      await finish.promise;
      count.set(1);
    },
  });
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal });
  await root.ready;
  const session = root.createSession();
  const signals = session.resolve(lifetime);
  const began = gate();
  signals.closing.addEventListener("abort", () => began.resolve(), { once: true });
  session.controller(count).watch(() => {
    throw cause;
  });
  const running = session.run(write);
  const rejected = expect(running).rejects.toBe(cause);
  stop.abort();
  await began.promise;
  await expect.poll(() => session.settle({ run: () => 0 }).status).toBe("failed");
  finish.resolve();
  await rejected;
  expect(await root.closed).toMatchObject({ status: "failed", error: cause });
});

test("closing refuses new calls before a waiting root close hook resumes", async () => {
  const finish = gate();
  const zone = tag({ label: "zone", default: "home" });
  const named = namespace();
  const work = operation({ label: "work", run: () => 1 });
  const root = createScope({
    extensions: [
      extension({
        label: "wait",
        hooks: {
          close: async (event) => {
            await finish.promise;
            return event.next();
          },
        },
      }),
    ],
  });
  await root.ready;
  const saved = root.controller(work);
  const closing = root.close({ graceful: true });
  for (const result of [
    root.settle(work),
    saved.settle(),
    saved.settle({ tags: [zone("away")] }),
    saved.settle({ ns: named }),
    saved.settle({ signal: new AbortController().signal }),
  ]) {
    const ended = await result;
    if (ended.status !== "failed" || !isError(ended.error, "Disposed")) throw ended;
  }
  finish.resolve();
  expect((await closing).status).toBe("success");
});

test("a first closing read during graceful root drain is already aborted", async () => {
  const finish = gate();
  const capture = resource({ label: "late closing", factory: (_deps, ctx) => ctx });
  const root = createScope();
  const ctx = root.resolve(capture);
  const running = root.run({ run: () => finish.promise });
  const closing = root.close({ graceful: true });
  const aborted = ctx.closing.aborted;
  finish.resolve();
  await running;
  await closing;
  expect(aborted).toBe(true);
});

test("graceful close refuses new calls before run hooks start", async () => {
  const finish = gate();
  const active = operation({ label: "active", run: () => finish.promise });
  const later = operation({ label: "later", run: () => 7 });
  const root = createScope({
    extensions: [extension({ label: "run hook", hooks: { run: (event) => event.next() } })],
  });
  await root.ready;
  const saved = root.controller(later);
  const running = root.run(active);
  const closing = root.close({ graceful: true });
  try {
    const ended = saved.settle();
    if (ended.status !== "failed" || !isError(ended.error, "Disposed")) throw ended;
  } finally {
    finish.resolve();
    await running;
    await closing;
  }
});

test("graceful close refuses new sessions through session hooks", async () => {
  const finish = gate();
  const root = createScope({
    extensions: [extension({ label: "session hook", hooks: { session: (event) => event.next() } })],
  });
  await root.ready;
  const running = root.run({ run: () => finish.promise });
  const closing = root.close({ graceful: true });
  try {
    root.createSession();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  } finally {
    finish.resolve();
    await running;
    await closing;
  }
});

test("a draining session refuses to release its parent's resource", async () => {
  const finish = gate();
  const owned = resource({ label: "parent owned", factory: () => 1 });
  const root = createScope();
  root.resolve(owned);
  const session = root.createSession();
  const running = session.run({ run: () => finish.promise });
  const closing = session.close({ graceful: true });
  try {
    session.release(owned);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  } finally {
    finish.resolve();
    await running;
    await closing;
    await root.close();
  }
});

for (const named of [false, true]) {
  test(`a parent release keeps a draining child's ${named ? "named" : "plain"} resource usable`, async () => {
    const finish = gate();
    const ns = namespace();
    const input = data({ initial: 0 });
    const owned = resource({
      label: "child owned",
      target: "session",
      depends: { input },
      factory: ({ input }) => input,
    });
    const root = createScope();
    const session = root.createSession();
    if (named) root.controller(input, { ns }).set(1);
    else root.controller(input).set(1);
    const held = session.controller(owned, named ? { ns } : undefined);
    held.resolve();
    const read = operation({
      label: "read after release",
      depends: { owned },
      run: async () => {
        await finish.promise;
        return held.get();
      },
    });
    const running = session.run(read, named ? { ns } : undefined);
    const closing = session.close({ graceful: true });
    if (named) root.releaseNs(input, ns);
    else root.release(input);
    finish.resolve();
    try {
      expect(await running).toBe(1);
      expect((await closing).status).toBe("success");
    } finally {
      await closing;
      await root.close();
    }
  });
}

for (const mode of ["root stop", "root close", "session close"]) {
  test(`a running call can run writing helpers during ${mode}`, async () => {
    const finish = gate();
    const save = operation({
      label: "save",
      depends: { count: count.controller },
      run: ({ count }) => {
        count.set(count.get() + 1);
        return Promise.resolve(count.get());
      },
    });
    const ns = namespace();
    const zone = tag({ label: "helper zone", default: "home" });
    const work = operation({
      label: "work with helpers",
      depends: { save },
      run: async ({ save }) => {
        await finish.promise;
        await save.run();
        await save.run({ ns });
        await save.run({ tags: [zone("away")] });
        return save.run({ signal: new AbortController().signal });
      },
    });
    const stop = new AbortController();
    const root = createScope({
      signal: stop.signal,
      extensions: [extension({ label: "helper hooks", hooks: { run: (event) => event.next() } })],
    });
    await root.ready;
    const session = root.createSession();
    const signals = session.resolve(lifetime);
    const running = session.settle(work);
    const closing =
      mode === "session close"
        ? session.close({ graceful: true })
        : mode === "root close"
          ? root.close({ graceful: true })
          : root.closed;
    if (mode === "root stop") stop.abort();
    await expect.poll(() => session.settle({ run: () => 0 }).status).toBe("failed");
    expect(signals.signal.aborted).toBe(false);
    finish.resolve();
    expect(await running).toMatchObject({ status: "success", value: 2 });
    const ended = await closing;
    if (ended.status === "failed") throw ended.error;
    expect(ended.status).toBe("success");
    await root.close();
  });

  test(`a running session body can run an operation during ${mode}`, async () => {
    const finish = gate();
    const entered = gate();
    const save = operation({
      label: "save from body",
      depends: { count: count.controller },
      run: ({ count }) => {
        count.set(7);
        return count.get();
      },
    });
    const stop = new AbortController();
    const root = createScope({ signal: stop.signal });
    await root.ready;
    let closeSession = () => root.close({ graceful: true });
    const body = root.session(async (s) => {
      s.resolve(lifetime);
      closeSession = () => s.close({ graceful: true });
      entered.resolve();
      await finish.promise;
      return s.run(save);
    });
    const result = body.then(
      (value) => ({ status: "success", value }),
      (error: unknown) => ({ status: "failed", error }),
    );
    await entered.promise;
    const closing =
      mode === "session close"
        ? closeSession()
        : mode === "root close"
          ? root.close({ graceful: true })
          : root.closed;
    if (mode === "root stop") stop.abort();
    if (mode !== "session close")
      await expect.poll(() => root.settle({ run: () => 0 }).status).toBe("failed");
    finish.resolve();
    expect(await result).toEqual({ status: "success", value: 7 });
    const ended = await closing;
    if (ended.status === "failed") throw ended.error;
    expect(ended.status).toBe("success");
    await root.close();
  });
}

test("forced parent close seals a child already draining gracefully", async () => {
  const finish = gate();
  const root = createScope();
  const session = root.createSession();
  const held = session.controller(count);
  let writeError: unknown;
  const running = session.settle({
    run: async (_deps, ctx) => {
      ctx.signal.addEventListener(
        "abort",
        () => {
          try {
            held.set(1);
          } catch (error) {
            writeError = error;
          }
          finish.resolve();
        },
        { once: true },
      );
      await finish.promise;
    },
  });
  const closing = session.close({ graceful: true, withData: true });
  await root.close();
  await running;
  if (!isError(writeError, "Disposed")) throw writeError;
  expect((await closing).data?.get(count)).toEqual({ present: false });
});

test("resource cleanup writes fail with Disposed after graceful drain", async () => {
  const owned = resource({
    label: "cleanup writer",
    depends: { count: count.controller },
    factory: ({ count }, ctx) => {
      ctx.defer(() => count.set(1));
      return 1;
    },
  });
  const root = createScope();
  root.resolve(owned);
  const ended = await root.close({ graceful: true });
  expect(ended.teardownErrors).toHaveLength(1);
  for (const error of ended.teardownErrors ?? []) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("graceful close seals a child already aborted by its parent", async () => {
  const finish = gate();
  const root = createScope();
  const session = root.createSession();
  const held = session.controller(count);
  let writeError: unknown;
  let childClosing: Promise<Scope.Result> | undefined;
  const running = session.settle({
    run: async (_deps, ctx) => {
      ctx.signal.addEventListener(
        "abort",
        () => {
          childClosing = session.close({ graceful: true });
          try {
            held.set(1);
          } catch (error) {
            writeError = error;
          }
          finish.resolve();
        },
        { once: true },
      );
      await finish.promise;
    },
  });
  await root.close();
  await running;
  await childClosing;
  if (!isError(writeError, "Disposed")) throw writeError;
});

for (const named of [false, true]) {
  test(`a child cannot release its draining parent's ${named ? "named" : "plain"} resource`, async () => {
    const finish = gate();
    const ns = namespace();
    const owned = resource({ label: "draining parent", factory: () => 1 });
    const root = createScope({
      extensions: [
        extension({
          label: "wait before close",
          hooks: {
            close: async (event) => {
              await finish.promise;
              return event.next();
            },
          },
        }),
      ],
    });
    await root.ready;
    root.controller(owned, named ? { ns } : undefined).resolve();
    const session = root.createSession();
    const closing = root.close({ graceful: true });
    try {
      if (named) session.releaseNs(owned, ns);
      else session.release(owned);
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "Disposed")) throw error;
    } finally {
      finish.resolve();
      await closing;
    }
  });
}

test("a draining session refuses a named release", async () => {
  const finish = gate();
  const ns = namespace();
  const owned = resource({ label: "named parent owned", factory: () => 1 });
  const root = createScope();
  const session = root.createSession();
  root.controller(owned, { ns }).resolve();
  const running = session.run({ run: () => finish.promise });
  const closing = session.close({ graceful: true });
  try {
    session.releaseNs(owned, ns);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  } finally {
    finish.resolve();
    await running;
    await closing;
    await root.close();
  }
});

for (const hooked of [false, true]) {
  for (const cleanup of [false, true]) {
    test(`a finished ${hooked ? "hooked" : "plain"} call ${cleanup ? "with cleanup" : "without cleanup"} cannot start helpers during another call's drain`, async () => {
      const finish = gate();
      const save = operation({ label: "saved helper", run: () => 1 });
      let saved = () => 0;
      const root = createScope({
        extensions: hooked
          ? [extension({ label: "saved helper hooks", hooks: { run: (event) => event.next() } })]
          : undefined,
      });
      await root.ready;
      await root.run({
        depends: { save },
        run: ({ save }, ctx) => {
          if (cleanup) ctx.defer(() => Promise.resolve());
          saved = () => save.run();
          return Promise.resolve();
        },
      });
      await root.settled();
      const running = root.run({ run: () => finish.promise });
      const closing = root.close({ graceful: true });
      try {
        saved();
        expect.unreachable();
      } catch (error) {
        if (!isError(error, "Disposed")) throw error;
      } finally {
        finish.resolve();
        await running;
        await closing;
      }
    });
  }
}

test("a held controller can write outside a call until graceful drain ends", async () => {
  const finish = gate();
  const root = createScope();
  const held = root.controller(count);
  const running = root.run({ run: () => finish.promise });
  const closing = root.close({ graceful: true, withData: true });
  held.set(9);
  finish.resolve();
  await running;
  expect((await closing).data?.get(count)).toEqual({ present: true, value: 9 });
  try {
    held.set(10);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("a running session body cannot release during graceful drain", async () => {
  const finish = gate();
  const root = createScope();
  let closeSession = () => root.close({ graceful: true });
  const body = root.session(async (s) => {
    s.controller(count).set(1);
    closeSession = () => s.close({ graceful: true });
    await finish.promise;
    try {
      s.release(count);
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "Disposed")) throw error;
    }
    return s.resolve(count);
  });
  const closing = closeSession();
  finish.resolve();
  expect(await body).toBe(1);
  await closing;
  await root.close();
});

test("a running call's cleanup can call a writing helper during graceful drain", async () => {
  const finish = gate();
  const cleanup = gate();
  const entered = gate();
  const save = operation({
    label: "cleanup helper",
    depends: { count: count.controller },
    run: ({ count }) => count.set(4),
  });
  const root = createScope();
  const running = root.run({
    depends: { save },
    run: async ({ save }, ctx) => {
      ctx.defer(async () => {
        entered.resolve();
        await cleanup.promise;
        save.run();
      });
      await finish.promise;
    },
  });
  const closing = root.close({ graceful: true, withData: true });
  finish.resolve();
  await entered.promise;
  cleanup.resolve();
  await running;
  expect((await closing).data?.get(count)).toEqual({ present: true, value: 4 });
});

test("a running call can use a tagged helper during graceful root close", async () => {
  const finish = Promise.withResolvers<void>();
  const outer = operation({
    label: "tagged helper caller",
    depends: { helper },
    run: async ({ helper }) => {
      await finish.promise;
      return helper.run({ tags: [helperZone("away")] });
    },
  });
  const root = createScope();
  const running = root.settle(outer);
  const closing = root.close({ graceful: true });
  finish.resolve();
  try {
    expect(await running).toMatchObject({ status: "success", value: 7 });
  } finally {
    await closing;
  }
});

test("a running session body can settle an operation during root stop", async () => {
  const finish = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<Scope.Handle>();
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal });
  await root.ready;
  const body = root.session(async (s) => {
    entered.resolve(s);
    await finish.promise;
    return s.settle(helper);
  });
  const session = await entered.promise;
  stop.abort();
  await expect
    .poll(() => {
      try {
        session.release(count);
        return false;
      } catch (error) {
        if (!isError(error, "Disposed")) throw error;
        return true;
      }
    })
    .toBe(true);
  finish.resolve();
  try {
    expect(await body).toMatchObject({ status: "success", value: 7 });
  } finally {
    await root.closed;
  }
});

for (const hooked of [false, true]) {
  for (const failed of [false, true]) {
    test(`a ${hooked ? "hooked" : "plain"} session handle refuses calls after its body ${failed ? "fails" : "returns"}`, async () => {
      const finish = Promise.withResolvers<void>();
      const bodyEnd = Promise.withResolvers<number>();
      const entered = Promise.withResolvers<Scope.Handle>();
      const cause = new Error("body failed");
      const root = createScope({
        extensions: hooked
          ? [extension({ label: "body handle hook", hooks: { session: (event) => event.next() } })]
          : undefined,
      });
      await root.ready;
      const body = root.session((s) => {
        entered.resolve(s);
        void s.run({ run: () => finish.promise });
        return bodyEnd.promise;
      });
      const result = body.then(
        (value) => ({ status: "success", value }),
        (error: unknown) => ({ status: "failed", error }),
      );
      const session = await entered.promise;
      const closing = root.close({ graceful: true });
      await expect
        .poll(() => {
          try {
            session.release(count);
            return false;
          } catch (error) {
            if (!isError(error, "Disposed")) throw error;
            return true;
          }
        })
        .toBe(true);
      if (failed) bodyEnd.reject(cause);
      else bodyEnd.resolve(1);
      await bodyEnd.promise.then(
        () => undefined,
        (error: unknown) => {
          if (error !== cause) throw error;
        },
      );
      try {
        session.run(helper);
        expect.unreachable();
      } catch (error) {
        if (!isError(error, "Disposed")) throw error;
      } finally {
        finish.resolve();
        await result;
        await closing;
      }
      const ended = await result;
      if ("error" in ended && ended.error !== cause) throw ended.error;
    });
  }
}

test("a running call cannot start a helper after a forced parent seals its child", async () => {
  const finish = Promise.withResolvers<void>();
  const sealed = Promise.withResolvers<void>();
  const outer = operation({
    label: "force sealed helper caller",
    depends: { helper },
    run: async ({ helper }, ctx) => {
      ctx.signal.addEventListener("abort", () => sealed.resolve(), { once: true });
      await finish.promise;
      try {
        helper.run();
        expect.unreachable();
      } catch (error) {
        if (!isError(error, "Disposed")) throw error;
      }
    },
  });
  const root = createScope();
  const session = root.createSession();
  const running = session.settle(outer);
  const closing = session.close({ graceful: true });
  const parentClosing = root.close();
  await sealed.promise;
  finish.resolve();
  try {
    expect(await running).toMatchObject({ status: "success" });
  } finally {
    await closing;
    await parentClosing;
  }
});
