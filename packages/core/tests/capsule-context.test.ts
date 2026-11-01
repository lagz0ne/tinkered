import { expect, test } from "vite-plus/test";

import {
  createScope,
  data,
  capsule,
  namespace,
  operation,
  originOf,
  resource,
  tag,
  type Capsule,
} from "@/index";

/** The meta every hook in this file loads with: these tests read the context, not the record. */
const meta = { role: "handler", explain: "Reads the hook's own context" } as const;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

for (const wait of ["before", "after"]) {
  test(`graceful close joins a root run hook waiting ${wait} next`, async () => {
    const gate = deferred();
    const events: string[] = [];
    const scope = createScope({
      capsules: [
        capsule({
          label: "wait",
          hooks: {
            run: async (event) => {
              if (wait === "before") await gate.promise;
              const value = event.next();
              if (wait === "after") await gate.promise;
              events.push("hook ended");
              return value;
            },
          },
        }),
      ],
    });
    const task = operation({ label: "task", run: () => events.push("body") });

    const running = Promise.resolve(scope.run(task)).then(
      () => ({ status: "success" }),
      () => ({ status: "failed" }),
    );
    const closing = scope.close({ graceful: true }).then((end) => {
      events.push("closed");
      return end;
    });
    gate.resolve();

    const [run, end] = await Promise.all([running, closing]);
    expect({ run: run.status, end: end.status, events }).toEqual({
      run: "success",
      end: "success",
      events: ["body", "hook ended", "closed"],
    });
  });
}

for (const wait of ["before", "after"]) {
  test(`forced close cancels a hook waiting ${wait} next without a late body`, async () => {
    const gate = deferred();
    const aborted = deferred();
    const events: string[] = [];
    const scope = createScope({
      capsules: [
        capsule({
          label: "wait",
          hooks: {
            run: async (event) => {
              event.signal.addEventListener("abort", aborted.resolve, { once: true });
              if (wait === "before") await gate.promise;
              const value = event.next();
              if (wait === "after") {
                await gate.promise;
                event.signal.throwIfAborted();
              }
              return value;
            },
          },
        }),
      ],
    });
    const task = operation({ label: "task", run: () => events.push("body") });

    const running = Promise.resolve(scope.settle(task));
    const closing = scope.close();
    await aborted.promise;
    gate.resolve();

    expect((await running).status).toBe("cancelled");
    expect((await closing).status).toBe("cancelled");
    expect(events).toEqual(wait === "before" ? [] : ["body"]);
  });
}

test("a hook load holds its resource through release and run cleanup", async () => {
  const gate = deferred();
  const events: string[] = [];
  const value = resource({
    label: "held",
    factory: (_deps, { defer }) => {
      const state = { live: true };
      defer(() => {
        state.live = false;
        events.push("released");
      });
      return state;
    },
  });
  const scope = createScope({
    capsules: [
      capsule({
        label: "hold",
        hooks: {
          run: async (event) => {
            const state = await event.load(value, meta);
            event.defer(() => {
              events.push(`defer:${state.live}`);
            });
            const result = event.next();
            await gate.promise;
            events.push(`hook:${state.live}`);

            return result;
          },
        },
      }),
    ],
  });
  scope.resolve(value);

  const running = Promise.resolve(scope.run(operation({ label: "task", run: () => 7 })));
  scope.release(value);
  gate.resolve();

  expect(await running).toBe(7);
  await scope.settled();
  expect(events).toEqual(["hook:true", "defer:true", "released"]);
  await scope.close();
});

test("run access follows the session owner and inherited or explicit namespace chain", async () => {
  const zone = tag({ label: "zone", default: "root" });
  const east = namespace({ tags: zone("east") });
  const west = namespace({ tags: zone("west") });
  const fallback = namespace();
  const count = data({ initial: 0 });
  const readZone = operation({ label: "read zone", depends: { zone }, run: ({ zone }) => zone });
  const seen: unknown[] = [];
  const scope = createScope({
    capsules: [
      capsule({
        label: "write",
        hooks: {
          run: (event) => {
            if (event.op === readZone) return event.next();
            seen.push(event.ns, event.run(readZone, {}, meta));
            event.load(count, meta).update((n) => n + 1);
            return event.next();
          },
        },
      }),
    ],
  });
  const session = scope.createSession({ ns: east });
  const task = operation({ label: "task", depends: { count }, run: ({ count }) => count });

  expect(session.run(task)).toBe(1);
  expect(session.run(task, { ns: [fallback, west] })).toBe(1);
  expect(await Promise.all(seen)).toEqual([[east], "east", [fallback, west], "west"]);

  expect(session.resolve(count, { ns: east })).toBe(1);
  expect(session.resolve(count, { ns: fallback })).toBe(1);
  expect(scope.resolve(count, { ns: east })).toBe(0);

  await scope.close();
});

test("tagged events use the actual child and fire each hook once", async () => {
  const zone = tag({ label: "zone", default: "root" });
  const cell = data({ initial: 0 });
  const readZone = operation({ label: "read zone", depends: { zone }, run: ({ zone }) => zone });
  const seen: Promise<string>[] = [];
  const scope = createScope({
    capsules: [
      capsule({
        label: "child",
        hooks: {
          session: async (event) => {
            seen.push(event.run(readZone, {}, meta).then((zone) => `session:${zone}`));
            event.defer(() => {
              seen.push(Promise.resolve("session cleanup"));
            });
            return event.next();
          },
          run: (event) => {
            if (event.op === readZone) return event.next();
            seen.push(event.run(readZone, {}, meta).then((zone) => `run:${zone}`));
            event.load(cell, meta).set(9);
            event.defer(() => {
              seen.push(Promise.resolve("run cleanup"));
            });
            return event.next();
          },
        },
      }),
    ],
  });
  const task = operation({ label: "task", depends: { cell }, run: ({ cell }) => cell });

  expect(await scope.run(task, { tags: zone("child") })).toBe(9);
  expect(scope.resolve(cell)).toBe(0);
  expect(await Promise.all(seen)).toEqual([
    "session:child",
    "run:child",
    "run cleanup",
    "session cleanup",
  ]);
  await scope.close();
});

test("write and resolve events bind access and cleanup to their owner", async () => {
  const zone = tag({ label: "zone", default: "root" });
  const east = namespace({ tags: zone("east") });
  const input = data({ initial: 0 });
  const readZone = operation({ label: "read zone", depends: { zone }, run: ({ zone }) => zone });
  const seen: Promise<string>[] = [];
  const scope = createScope({
    capsules: [
      capsule({
        label: "access",
        hooks: {
          write: (event) => {
            seen.push(event.run(readZone, {}, meta).then((zone) => `write:${zone}`));
            event.defer(() => {
              seen.push(Promise.resolve("write cleanup"));
            });
            event.next();
          },
          resolve: (event) => {
            seen.push(event.run(readZone, {}, meta).then((zone) => `resolve:${zone}`));
            event.defer(() => {
              seen.push(Promise.resolve("resolve cleanup"));
            });
            return event.next();
          },
        },
      }),
    ],
  });

  const session = scope.createSession();
  session.controller(input, { ns: east }).set(4);

  expect(session.resolve(input, { ns: east })).toBe(4);
  expect(scope.resolve(input, { ns: east })).toBe(0);
  await session.close({ graceful: true });

  expect(await Promise.all(seen)).toEqual(["write:east", "resolve:east", "write cleanup"]);
  await scope.close({ graceful: true });
  expect(await Promise.all(seen)).toEqual([
    "write:east",
    "resolve:east",
    "write cleanup",
    "resolve cleanup",
  ]);
});

test("a write event reads another cell through its controller", async () => {
  const written = data({ label: "written", initial: 1 });
  const other = data({ label: "other", initial: 7 });
  const seen: unknown[] = [];
  const scope = createScope({
    capsules: [
      capsule({
        label: "read other",
        hooks: {
          write: (event) => {
            seen.push(event.cell === written, event.load(other, meta).get());
            event.next();
          },
        },
      }),
    ],
  });
  await scope.ready;

  scope.controller(written).set(2);

  expect(seen).toEqual([true, 7]);
  expect(scope.resolve(written)).toBe(2);
  await scope.close();
});

test("start and close events share only their own root resource", async () => {
  const state = resource({ label: "state", factory: () => ({ count: 0 }) });
  const seen: number[] = [];
  const shared = capsule({
    label: "roots",
    hooks: {
      start: async (event) => {
        expect("scope" in event).toBe(false);
        (await event.load(state, meta)).count++;
        await event.next();
        return event.load(state, meta);
      },
      close: async (event) => {
        expect("scope" in event).toBe(false);
        seen.push((await event.load(state, meta)).count);
        return event.next();
      },
    },
  });
  const a = createScope({ capsules: [shared] });
  const b = createScope({ capsules: [shared] });
  await Promise.all([a.ready, b.ready]);

  a.resolve(shared).count = 2;
  await a.close();
  await b.close();

  expect(seen).toEqual([2, 1]);
});

test("hook-started actions share the active trace and run cleanup", async () => {
  const events: string[] = [];
  const child = operation({
    label: "child",
    run: (_deps, { defer }) => {
      defer(() => {
        events.push("child cleanup");
      });
      return 2;
    },
  });
  const outer = operation({ label: "outer", run: () => 3 });
  const second = operation({ label: "inline", run: () => 4 });
  const ran: Promise<number>[] = [];
  const scope = createScope({
    observe: { history: 10 },
    capsules: [
      capsule({
        label: "trace",
        hooks: {
          run: (event) => {
            if (event.op !== outer) return event.next();
            event.defer(() => {
              events.push("hook cleanup");
            });
            event.obs.event("hook");

            ran.push(event.run(child, {}, meta), event.run(second, {}, meta));
            const result = event.next();
            events.push("after body");

            return result;
          },
        },
      }),
    ],
  });

  expect(scope.run(outer)).toBe(3);
  expect(await Promise.all(ran)).toEqual([2, 4]);

  const spans = scope.spans();
  const parent = spans.find((span) => span.name === "outer");
  expect(parent?.events.map((entry) => entry.name)).toContain("hook");
  expect(spans.filter((span) => span.name !== "outer").map((span) => span.parentSpanId)).toEqual([
    parent?.spanId,
    parent?.spanId,
  ]);
  expect(events).toEqual(["child cleanup", "after body", "hook cleanup"]);

  await scope.close();
});

test("a dropped hook-started action keeps its failure on the owner", async () => {
  const cause = new Error("child failed");
  const child = operation({
    label: "child",
    run: async () => {
      throw cause;
    },
  });
  const outer = operation({ label: "outer", run: () => 3 });
  const scope = createScope({
    capsules: [
      capsule({
        label: "drop",
        hooks: {
          run: (event) => {
            if (event.op === outer) void event.run(child, {}, meta);
            return event.next();
          },
        },
      }),
    ],
  });

  expect(scope.run(outer)).toBe(3);
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
});

test("a hook can settle a child failure without failing its owner", async () => {
  const cause = new Error("child failed");
  const child = operation({
    label: "child",
    run: () => {
      throw cause;
    },
  });
  const outer = operation({ label: "outer", run: () => 3 });
  const settled: Promise<unknown>[] = [];
  const scope = createScope({
    capsules: [
      capsule({
        label: "settle",
        hooks: {
          run: (event) => {
            if (event.op === outer) settled.push(event.settle(child, {}, meta));
            return event.next();
          },
        },
      }),
    ],
  });

  expect(scope.run(outer)).toBe(3);
  expect(await Promise.all(settled)).toMatchObject([{ status: "failed", error: cause }]);
  expect(originOf(cause)?.path).toEqual(["child"]);
  expect((await scope.close({ graceful: true })).status).toBe("success");
});

test("an event union narrows its payload by kind", async () => {
  const events: string[] = [];
  const hook = (event: Capsule.Events[keyof Capsule.Events]): unknown => {
    if (event.kind === "run") events.push(event.op.label ?? "inline");
    if (event.kind === "resolve") events.push(event.target.label ?? "unnamed");
    return event.next();
  };
  const scope = createScope({
    capsules: [capsule({ label: "events", hooks: { run: hook, resolve: hook } })],
  });

  expect(scope.run(operation({ label: "task", run: () => 3 }))).toBe(3);
  expect(scope.resolve(data({ label: "cell", initial: 4 }))).toBe(4);
  expect(events).toEqual(["task", "cell"]);
  await scope.close();
});

test("saved controllers stay usable through a waiting hook and its graceful cleanup", async () => {
  const gate = deferred();
  const cell = data({ initial: 0 });
  const events: string[] = [];
  const child = operation({ label: "child", depends: { cell }, run: ({ cell }) => cell });
  const task = operation({ label: "task", run: () => 7 });
  const scope = createScope({
    capsules: [
      capsule({
        label: "continue",
        hooks: {
          run: async (event) => {
            if (event.op !== task) return event.next();
            const counter = event.load(cell, meta);
            const { run } = event;
            await gate.promise;

            const unwatch = counter.watch((value) => events.push(`watch:${value}`));
            event.defer(() => {
              unwatch();
              counter.update((value) => value + 1);
              events.push("unwatched");
            });

            counter.set(4);
            counter.update((value) => value + 1);
            events.push(`get:${counter.get()}`);
            events.push(`child:${await run(child, {}, meta)}`);

            return event.next();
          },
        },
      }),
    ],
  });

  const running = Promise.resolve(scope.run(task));
  const closing = scope.close({ graceful: true });
  gate.resolve();

  expect(await running).toBe(7);
  expect((await closing).status).toBe("success");
  expect(events).toEqual(["watch:4", "watch:5", "get:5", "child:5", "unwatched"]);
});

test("a saved operation settle returns cancellation when its waiting hook is forced closed", async () => {
  const gate = deferred();
  const aborted = deferred();
  const child = operation({ label: "child", run: () => 3 });
  const task = operation({ label: "task", run: () => 7 });
  const scope = createScope({
    capsules: [
      capsule({
        label: "settle after abort",
        hooks: {
          run: async (event) => {
            if (event.op !== task) return event.next();
            const { settle } = event;
            event.signal.addEventListener("abort", aborted.resolve, { once: true });
            await gate.promise;
            return settle(child, {}, meta);
          },
        },
      }),
    ],
  });

  const running = Promise.resolve(scope.run(task));
  const closing = scope.close();
  await aborted.promise;
  gate.resolve();

  expect(await running).toMatchObject({ status: "cancelled" });
  await closing;
});

test("a saved operation settle returns failed Disposed after its hook ends", async () => {
  const child = operation({ label: "child", run: () => 3 });
  const task = operation({ label: "task", run: () => 7 });
  const saved: Capsule.Settle[] = [];
  const scope = createScope({
    capsules: [
      capsule({
        label: "settle after hook",
        hooks: {
          run: (event) => {
            if (event.op !== task) return event.next();
            saved.push(event.settle);
            return event.next();
          },
        },
      }),
    ],
  });

  scope.run(task);

  const [settle] = saved;
  expect(await settle(child, {}, meta)).toMatchObject({
    status: "failed",
    kind: "error",
    error: { kind: "Disposed" },
  });
  await scope.close();
});

test("concurrent and repeated closes join the same root hook once", async () => {
  const gate = deferred();
  const state = resource({ label: "close state", factory: () => ({ closes: 0 }) });
  const seen: number[] = [];
  const shared = capsule({
    label: "close once",
    hooks: {
      start: async (event) => {
        await event.load(state, meta);
        await event.next();
      },
      close: async (event) => {
        seen.push(++(await event.load(state, meta)).closes);
        await gate.promise;
        return event.next();
      },
    },
  });
  const a = createScope({ capsules: [shared] });
  await a.ready;

  const closing = a.close({ graceful: true });
  const joined = a.close();
  gate.resolve();

  expect(await joined).toBe(await closing);
  const b = createScope({ capsules: [shared] });
  await b.ready;

  expect(await a.close()).toBe(await closing);
  expect(b.resolve(state).closes).toBe(0);
  await b.close();
  expect(seen).toEqual([1, 1]);
});

test("a hook that returns a substitute still joins its started body", async () => {
  const gate = deferred();
  const events: string[] = [];
  const scope = createScope({
    capsules: [
      capsule({
        label: "substitute",
        hooks: {
          run: (event) => {
            event.next();
            return "substitute";
          },
        },
      }),
    ],
  });
  const task = operation({
    label: "task",
    run: async (_deps, { defer }) => {
      defer(() => {
        events.push("cleanup");
      });
      await gate.promise;
      events.push("body");
      return "body";
    },
  });

  expect(scope.run(task)).toBe("substitute");
  const closing = scope.close({ graceful: true });
  gate.resolve();
  expect((await closing).status).toBe("success");
  expect(events).toEqual(["body", "cleanup"]);
});

test("resource contexts expose the namespace chain used by their dependencies", async () => {
  const zone = tag({ label: "zone", default: "default" });
  const east = namespace({ tags: zone("east") });
  const fallback = namespace();
  const scope = createScope({ ns: east });
  for (const target of ["scope", "namespace", "session"] as const) {
    const value = resource({
      label: target,
      target,
      depends: { zone },
      factory: ({ zone }, ctx) => ({ zone, ns: ctx.ns }),
    });
    const result = scope.resolve(value, { ns: [fallback, east] });
    expect(result).toEqual({
      zone: target === "scope" ? "default" : "east",
      ns: target === "scope" ? undefined : [fallback, east],
    });
  }

  await scope.close();
});

test("a hook can refuse raw input before its parser runs", async () => {
  const cause = new Error("bad input");
  const task = operation({
    label: "task",
    input: () => {
      throw cause;
    },
    run: () => "body",
  });
  const scope = createScope({
    capsules: [
      capsule({
        label: "refuse",
        hooks: {
          run: (event) => {
            event.defer(() => undefined);
            return "refused";
          },
        },
      }),
    ],
  });
  expect(scope.run(task, { rawInput: "invalid" })).toBe("refused");
  expect((await scope.close({ graceful: true })).status).toBe("success");
});

test("catching a body's panic in its hook does not erase the owned failure", async () => {
  const cause = new Error("body failed");
  const scope = createScope({
    capsules: [
      capsule({
        label: "catch",
        hooks: {
          run: (event) => {
            try {
              return event.next();
            } catch (error) {
              if (error !== cause) throw error;
              return "caught";
            }
          },
        },
      }),
    ],
  });
  const task = operation({
    label: "task",
    run: () => {
      throw cause;
    },
  });
  expect(scope.run(task)).toBe("caught");
  expect(await scope.close({ graceful: true })).toMatchObject({ status: "failed", error: cause });
});

test("an unreturned body keeps its span open and records its failure", async () => {
  const gate = deferred();
  const cause = new Error("body failed");
  const scope = createScope({
    observe: { history: 5 },
    capsules: [
      capsule({
        label: "substitute",
        hooks: {
          run: (event) => {
            event.next();
            return "substitute";
          },
        },
      }),
    ],
  });
  const task = operation({
    label: "task",
    run: async () => {
      await gate.promise;
      throw cause;
    },
  });

  expect(scope.run(task)).toBe("substitute");
  expect(scope.spans()).toHaveLength(0);

  gate.resolve();
  await scope.close({ graceful: true });
  expect(scope.spans()).toMatchObject([{ name: "task", status: "failed", error: cause }]);
  expect(originOf(cause)?.path).toEqual(["task"]);
});

test("a saved event raise keeps one run in the failure path after next", async () => {
  const scope = createScope({
    capsules: [
      capsule({
        label: "saved raise",
        hooks: {
          run: (event) => {
            const { raise } = event;
            event.next();
            raise("Denied", { reason: "after body" });
          },
        },
      }),
    ],
  });
  const task = operation({ label: "task", run: () => 3 });
  expect(scope.settle(task)).toMatchObject({
    status: "failed",
    kind: "error",
    origin: { path: ["task"] },
  });
  await scope.close();
});
