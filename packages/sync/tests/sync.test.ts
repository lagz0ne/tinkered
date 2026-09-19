import { expect, test } from "vite-plus/test";
import { createScope, data, isError as isCoreError } from "@tinker/core";
import {
  family,
  isError,
  isFamily,
  memoryPair,
  readSynced,
  sync,
  syncClient,
  syncServer,
  synced,
  type Sync,
} from "../src/index.ts";
import { recipe } from "../../../examples/sync/hono.ts";

/** Parse raw input into text at the process edge. A named function, not a method pull. */
function parseText(raw: unknown): string {
  if (typeof raw !== "string") return String(raw);
  return raw;
}

/** The shared counter both drivers would publish. */
const counter = data({ label: "counter", initial: 0, meta: [synced({ key: "counter" })] });

/** The shared todo family both drivers would publish. */
const todos = family({ label: "todo", initial: "", parse: parseText });

/** One counter snapshot at a version. */
function snapshot(version: number): Sync.Message {
  return { type: "snapshot", key: "counter", version, value: version };
}

test("family hands back the same cell for one id, in creation order", () => {
  const notes = family({ label: "note", initial: "" });
  const first = notes("a");
  expect(notes("a")).toBe(first);
  expect(notes("b")).not.toBe(first);
  notes("c");
  expect(notes.members()).toEqual(["a", "b", "c"]);
});

test("a member carries its synced key", () => {
  const member = todos("7");
  expect(readSynced(member).key).toBe("todo/7");
  expect(synced.read(member).present).toBe(true);
});

test("readSynced on a plain cell throws SyncUndeclared", () => {
  const plain = data({ label: "plain", initial: 0 });
  try {
    readSynced(plain);
    expect.unreachable();
  } catch (error: unknown) {
    if (!isError(error, "SyncUndeclared")) throw error;
    expect(error.payload.label).toBe("plain");
  }
});

test("a member reads and writes like an ordinary cell", () => {
  const scope = createScope();
  expect(scope.resolve(todos("1"))).toBe("");
  scope.controller(todos("1")).set("x");
  expect(scope.resolve(todos("1"))).toBe("x");
  return scope.close({ graceful: true });
});

test("sync binds cells and families whole on the scope", () => {
  const scope = createScope({ tags: [sync(counter), sync(todos)] });
  const bound = scope.resolve(sync.all);
  expect(bound).toContain(counter);
  expect(bound).toContain(todos);
  expect(isFamily(todos)).toBe(true);
  expect(isFamily(counter)).toBe(false);
  return scope.close({ graceful: true });
});

test("memoryPair delivers every send in order, never synchronously", () => {
  const [left, right] = memoryPair();
  const seen: Sync.Message[] = [];
  const first = snapshot(1);
  const secondMessage = snapshot(2);
  const second = new Promise<unknown>((resolve) => {
    right.onMessage((message) => {
      seen.push(message);
      if (seen.length === 2) resolve(message);
    });
  });
  left.send(first);
  left.send(secondMessage);
  expect(seen).toEqual([]);
  return second.then(() => {
    expect(seen).toEqual([first, secondMessage]);
  });
});

test("close reaches both sides once and drops later sends", () => {
  const [left, right] = memoryPair();
  let heard = 0;
  let leftClosed = 0;
  let rightClosed = 0;
  right.onMessage(() => {
    heard += 1;
  });
  const parted = new Promise<unknown>((resolve) => {
    left.onClose(() => {
      leftClosed += 1;
    });
    right.onClose(() => {
      rightClosed += 1;
      resolve(rightClosed);
    });
  });
  left.close();
  left.close();
  left.send(snapshot(9));
  right.send(snapshot(10));
  return parted.then(() => {
    expect(leftClosed).toBe(1);
    expect(rightClosed).toBe(1);
    expect(heard).toBe(0);
  });
});

test("an unsubscribed listener hears nothing more", () => {
  const [left, right] = memoryPair();
  let dropped = 0;
  const stop = right.onMessage(() => {
    dropped += 1;
  });
  stop();
  const arrived = new Promise<unknown>((resolve) => {
    right.onMessage(resolve);
  });
  left.send(snapshot(3));
  return arrived.then(() => {
    expect(dropped).toBe(0);
  });
});

/** The server's counter: a fresh cell per test so versions never leak. */
function freshCounter() {
  return data({ label: "counter", initial: 0, meta: [synced({ key: "counter" })] });
}

/** A fresh numbered cell family, one per test (members memoize module-wide). */
function freshTodos(tag: string) {
  return family({ label: tag, initial: "" });
}

/** Every message arriving on a transport, plus a promise for the Nth one:
 * the listener resolves it as soon as enough arrived — no poll, no sleep. */
function inbox(transport: Sync.Transport): {
  seen: Sync.Message[];
  when(count: number): Promise<Sync.Message[]>;
} {
  const seen: Sync.Message[] = [];
  const waiters: { count: number; resolve: (got: Sync.Message[]) => void }[] = [];
  transport.onMessage((message) => {
    seen.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter !== undefined && seen.length >= waiter.count) {
        waiters.splice(index, 1);
        waiter.resolve(seen);
      }
    }
  });
  function when(count: number): Promise<Sync.Message[]> {
    if (seen.length >= count) return Promise.resolve(seen);
    return new Promise<Sync.Message[]>((resolve) => {
      waiters.push({ count, resolve });
    });
  }
  return { seen, when };
}

/** Resolve when a watched cell reaches a value: the watcher settles the one
 * awaited promise per test once the arrival lands. */
function reached<T>(watch: (listener: (next: T) => void) => () => void, value: T): Promise<void> {
  return new Promise<void>((resolve) => {
    watch((next) => {
      if (next === value) resolve();
    });
  });
}

/** Reject with a parse edge: only whole numbers cross. */
function parseWhole(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) throw new Error("whole");
  return raw;
}

test("connect sends one snapshot per published cell and member, version zero", () => {
  const counter = freshCounter();
  const todos = freshTodos("todo-init");
  todos("7");
  const scope = createScope({ tags: [sync(counter), sync(todos)] });
  const server = syncServer(scope);
  const [left, right] = memoryPair();
  const box = inbox(right);
  const done = server.connect(left);
  const value = scope.resolve(counter);
  const memberValue = scope.resolve(todos("7"));
  return box.when(2).then(() => {
    expect(box.seen).toEqual([
      { type: "snapshot", key: "todo-init/7", version: 0, value: memberValue },
      { type: "snapshot", key: "counter", version: 0, value },
    ]);
    left.close();
    return done.then(() => scope.close({ graceful: true }));
  });
});

test("a set at the current version applies, acks, and fans out", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const server = syncServer(scope);
  const [first, firstFar] = memoryPair();
  const [second, secondFar] = memoryPair();
  const writer = inbox(firstFar);
  const other = inbox(secondFar);
  const firstDone = server.connect(first);
  const secondDone = server.connect(second);
  return writer
    .when(1)
    .then(() => {
      firstFar.send({ type: "set", id: 1, key: "counter", base: 0, value: 1 });
      return writer.when(3);
    })
    .then(() => {
      expect(scope.resolve(counter)).toBe(1);
      expect(writer.seen[1]).toEqual({
        type: "snapshot",
        key: "counter",
        version: 1,
        value: 1,
      });
      expect(writer.seen[2]).toEqual({ type: "ack", id: 1, key: "counter", version: 1 });
      return other.when(2);
    })
    .then(() => {
      expect(other.seen[1]).toEqual({
        type: "snapshot",
        key: "counter",
        version: 1,
        value: 1,
      });
      first.close();
      second.close();
      return Promise.all([firstDone, secondDone]).then(() => scope.close({ graceful: true }));
    });
});

test("a stale set rejects with the truth and leaves the cell", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const server = syncServer(scope);
  const [left, right] = memoryPair();
  const box = inbox(right);
  const done = server.connect(left);
  return box
    .when(1)
    .then(() => {
      scope.controller(counter).set(1);
      return box.when(2);
    })
    .then(() => {
      right.send({ type: "set", id: 2, key: "counter", base: 0, value: 41 });
      return box.when(3);
    })
    .then(() => {
      expect(box.seen[2]).toEqual({
        type: "reject",
        id: 2,
        key: "counter",
        version: 1,
        value: 1,
      });
      expect(scope.resolve(counter)).toBe(1);
      left.close();
      return done.then(() => scope.close({ graceful: true }));
    });
});

test("a set the parse refuses rejects with the truth and leaves the cell", () => {
  const strict = data({
    label: "strict",
    initial: 0,
    parse: parseWhole,
    meta: [synced({ key: "strict" })],
  });
  const scope = createScope({ tags: [sync(strict)] });
  const server = syncServer(scope);
  const [left, right] = memoryPair();
  const box = inbox(right);
  const done = server.connect(left);
  return box
    .when(1)
    .then(() => {
      right.send({ type: "set", id: 3, key: "strict", base: 0, value: 1.5 });
      return box.when(2);
    })
    .then(() => {
      expect(box.seen[1]).toEqual({
        type: "reject",
        id: 3,
        key: "strict",
        version: 0,
        value: 0,
      });
      expect(scope.resolve(strict)).toBe(0);
      left.close();
      return done.then(() => scope.close({ graceful: true }));
    });
});

test("a userland write on the server fans a fresh snapshot out to all", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const server = syncServer(scope);
  const [first, firstFar] = memoryPair();
  const [second, secondFar] = memoryPair();
  const one = inbox(firstFar);
  const two = inbox(secondFar);
  const firstDone = server.connect(first);
  const secondDone = server.connect(second);
  return one
    .when(1)
    .then(() => two.when(1))
    .then(() => {
      scope.controller(counter).set(5);
      return Promise.all([one.when(2), two.when(2)]);
    })
    .then(() => {
      expect(one.seen[1]).toEqual({ type: "snapshot", key: "counter", version: 1, value: 5 });
      expect(two.seen[1]).toEqual({ type: "snapshot", key: "counter", version: 1, value: 5 });
      first.close();
      second.close();
      return Promise.all([firstDone, secondDone]).then(() => scope.close({ graceful: true }));
    });
});

test("a set for a new family member creates it for late transports", () => {
  const todos = freshTodos("todo-grow");
  const scope = createScope({ tags: [sync(todos)] });
  const server = syncServer(scope);
  const [left, right] = memoryPair();
  const box = inbox(right);
  const done = server.connect(left);
  return box
    .when(0)
    .then(() => {
      right.send({ type: "set", id: 4, key: "todo-grow/9", base: 0, value: "nine" });
      return box.when(2);
    })
    .then(() => {
      expect(todos.members()).toContain("9");
      expect(scope.resolve(todos("9"))).toBe("nine");
      expect(box.seen[0]).toEqual({
        type: "snapshot",
        key: "todo-grow/9",
        version: 1,
        value: "nine",
      });
      expect(box.seen[1]).toEqual({ type: "ack", id: 4, key: "todo-grow/9", version: 1 });
      left.close();
      return done.then(() => {
        const [late, lateFar] = memoryPair();
        const lateBox = inbox(lateFar);
        const lateDone = server.connect(late);
        return lateBox.when(1).then(() => {
          expect(lateBox.seen).toEqual([
            { type: "snapshot", key: "todo-grow/9", version: 1, value: "nine" },
          ]);
          late.close();
          return lateDone.then(() => scope.close({ graceful: true }));
        });
      });
    });
});

test("two sets leave two spans, each with one sync set log line", () => {
  const counter = freshCounter();
  const noting = createScope({
    tags: [sync(counter)],
    observe: {
      history: 10,
      log: (entry) => void seen.push({ message: entry.message, attributes: entry.attributes }),
    },
  });
  const seen: { message: string; attributes: Record<string, unknown> }[] = [];
  const server = syncServer(noting);
  const [left, right] = memoryPair();
  const heard = inbox(right);
  const done = server.connect(left);
  return heard
    .when(1)
    .then(() => {
      right.send({ type: "set", id: 5, key: "counter", base: 0, value: 1 });
      return heard.when(3);
    })
    .then(() => {
      right.send({ type: "set", id: 6, key: "counter", base: 0, value: 2 });
      return heard.when(4);
    })
    .then(() => {
      const spans = noting.spans().filter((span) => span.name === "sync set counter");
      expect(spans.length).toBe(2);
      const lines = seen.filter((entry) => entry.message === "sync set");
      expect(lines.length).toBe(2);
      expect(lines[0].attributes["code"]).toBe("applied");
      expect(lines[1].attributes["code"]).toBe("stale");
      left.close();
      return done.then(() => noting.close({ graceful: true }));
    });
});

test("closing the client side ends the session and stops the fan-out", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const server = syncServer(scope);
  const [left, right] = memoryPair();
  const box = inbox(right);
  const done = server.connect(left);
  return box
    .when(1)
    .then(() => {
      right.close();
      return done;
    })
    .then(() => {
      scope.controller(counter).set(9);
      const waited = new Promise<Sync.Message[]>((resolve) => {
        queueMicrotask(() => resolve(box.seen));
      });
      return waited;
    })
    .then((got) => {
      expect(got.length).toBe(1);
      return scope.close({ graceful: true });
    });
});

test("a set for an unpublished key closes the transport", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const server = syncServer(scope);
  const [left, right] = memoryPair();
  const done = server.connect(left);
  const parted = new Promise<void>((resolve) => {
    right.onClose(() => resolve());
  });
  return Promise.resolve()
    .then(() => {
      right.send({ type: "set", id: 7, key: "nope", base: 0, value: 1 });
      return parted;
    })
    .then(() => done.then(() => scope.close({ graceful: true })));
});

test("after connect the client cell reads the server value", () => {
  const counter = freshCounter();
  const serverScope = createScope({ tags: [sync(counter)] });
  serverScope.controller(counter).set(5);
  const clientScope = createScope({ tags: [sync(counter)] });
  const [near, far] = memoryPair();
  const server = syncServer(serverScope);
  const done = server.connect(near);
  const client = syncClient(clientScope, far);
  const watch = (listener: (next: number) => void): (() => void) =>
    clientScope.controller(counter).watch(listener);
  return reached(watch, 5).then(() => {
    expect(clientScope.resolve(counter)).toBe(5);
    client.close();
    near.close();
    return done.then(() =>
      Promise.all([serverScope.close({ graceful: true }), clientScope.close({ graceful: true })]),
    );
  });
});

test("a client write reaches the server and a second client", () => {
  const counter = freshCounter();
  const serverScope = createScope({ tags: [sync(counter)] });
  const firstScope = createScope({ tags: [sync(counter)] });
  const secondScope = createScope({ tags: [sync(counter)] });
  const server = syncServer(serverScope);
  const [near, far] = memoryPair();
  const [otherNear, otherFar] = memoryPair();
  const firstDone = server.connect(near);
  const secondDone = server.connect(otherNear);
  const first = syncClient(firstScope, far);
  const second = syncClient(secondScope, otherFar);
  const watch = (listener: (next: number) => void): (() => void) =>
    secondScope.controller(counter).watch(listener);
  firstScope.controller(counter).set(1);
  return reached(watch, 1).then(() => {
    expect(serverScope.resolve(counter)).toBe(1);
    expect(secondScope.resolve(counter)).toBe(1);
    first.close();
    second.close();
    near.close();
    otherNear.close();
    return Promise.all([firstDone, secondDone]).then(() =>
      Promise.all([
        serverScope.close({ graceful: true }),
        firstScope.close({ graceful: true }),
        secondScope.close({ graceful: true }),
      ]),
    );
  });
});

test("a stale client write reverts to the first applied value", () => {
  const counter = freshCounter();
  const serverScope = createScope({ tags: [sync(counter)] });
  const firstScope = createScope({ tags: [sync(counter)] });
  const secondScope = createScope({ tags: [sync(counter)] });
  const server = syncServer(serverScope);
  const [near, far] = memoryPair();
  const [otherNear, otherFar] = memoryPair();
  const firstDone = server.connect(near);
  const secondDone = server.connect(otherNear);
  const first = syncClient(firstScope, far);
  const second = syncClient(secondScope, otherFar);
  const watch = (listener: (next: number) => void): (() => void) =>
    secondScope.controller(counter).watch(listener);
  firstScope.controller(counter).set(1);
  secondScope.controller(counter).set(2);
  return reached(watch, 1).then(() => {
    expect(serverScope.resolve(counter)).toBe(1);
    expect(firstScope.resolve(counter)).toBe(1);
    expect(secondScope.resolve(counter)).toBe(1);
    first.close();
    second.close();
    near.close();
    otherNear.close();
    return Promise.all([firstDone, secondDone]).then(() =>
      Promise.all([
        serverScope.close({ graceful: true }),
        firstScope.close({ graceful: true }),
        secondScope.close({ graceful: true }),
      ]),
    );
  });
});

test("a revert is never re-sent: two spans, one applied, one stale", () => {
  const counter = freshCounter();
  const noting = createScope({
    tags: [sync(counter)],
    observe: {
      history: 10,
      log: (entry) => void seen.push({ message: entry.message, attributes: entry.attributes }),
    },
  });
  const seen: { message: string; attributes: Record<string, unknown> }[] = [];
  const firstScope = createScope({ tags: [sync(counter)] });
  const secondScope = createScope({ tags: [sync(counter)] });
  const server = syncServer(noting);
  const [near, far] = memoryPair();
  const [otherNear, otherFar] = memoryPair();
  const firstDone = server.connect(near);
  const secondDone = server.connect(otherNear);
  const first = syncClient(firstScope, far);
  const second = syncClient(secondScope, otherFar);
  const watch = (listener: (next: number) => void): (() => void) =>
    secondScope.controller(counter).watch(listener);
  firstScope.controller(counter).set(1);
  secondScope.controller(counter).set(2);
  return reached(watch, 1).then(() => {
    const spans = noting.spans().filter((span) => span.name === "sync set counter");
    expect(spans.length).toBe(2);
    const lines = seen.filter((entry) => entry.message === "sync set");
    expect(lines.length).toBe(2);
    expect(lines[0].attributes["code"]).toBe("applied");
    expect(lines[1].attributes["code"]).toBe("stale");
    first.close();
    second.close();
    near.close();
    otherNear.close();
    return Promise.all([firstDone, secondDone]).then(() =>
      Promise.all([
        noting.close({ graceful: true }),
        firstScope.close({ graceful: true }),
        secondScope.close({ graceful: true }),
      ]),
    );
  });
});

test("an invalid client write throws to the writer and leaves the server", () => {
  const strict = data({
    label: "strict",
    initial: 0,
    parse: parseWhole,
    meta: [synced({ key: "strict" })],
  });
  const serverScope = createScope({ tags: [sync(strict)] });
  const clientScope = createScope({ tags: [sync(strict)] });
  const [near, far] = memoryPair();
  const server = syncServer(serverScope);
  const done = server.connect(near);
  const client = syncClient(clientScope, far);
  const watch = (listener: (next: number) => void): (() => void) =>
    clientScope.controller(strict).watch(listener);
  try {
    clientScope.controller(strict).set(1.5);
    expect.unreachable();
  } catch (error: unknown) {
    if (!isCoreError(error, "DataValidationFailed")) throw error;
  }
  expect(serverScope.resolve(strict)).toBe(0);
  clientScope.controller(strict).set(3);
  return reached(watch, 3).then(() => {
    expect(serverScope.resolve(strict)).toBe(3);
    expect(clientScope.resolve(strict)).toBe(3);
    client.close();
    near.close();
    return done.then(() =>
      Promise.all([serverScope.close({ graceful: true }), clientScope.close({ graceful: true })]),
    );
  });
});

test("a member written on the server appears on the client", () => {
  const todos = freshTodos("todo-down");
  const serverScope = createScope({ tags: [sync(todos)] });
  const clientScope = createScope({ tags: [sync(todos)] });
  const [near, far] = memoryPair();
  const server = syncServer(serverScope);
  const done = server.connect(near);
  const client = syncClient(clientScope, far);
  serverScope.controller(todos("9")).set("nine");
  const member = todos("9");
  const watch = (listener: (next: string) => void): (() => void) =>
    clientScope.controller(member).watch(listener);
  return reached(watch, "nine").then(() => {
    expect(clientScope.resolve(todos("9"))).toBe("nine");
    client.close();
    near.close();
    return done.then(() =>
      Promise.all([serverScope.close({ graceful: true }), clientScope.close({ graceful: true })]),
    );
  });
});

test("a member written on the client reaches the server cell", () => {
  const todos = freshTodos("todo-up");
  const serverScope = createScope({ tags: [sync(todos)] });
  const clientScope = createScope({ tags: [sync(todos)] });
  const [near, far] = memoryPair();
  const server = syncServer(serverScope);
  const done = server.connect(near);
  const client = syncClient(clientScope, far);
  const member = todos("3");
  const watch = (listener: (next: string) => void): (() => void) =>
    serverScope.controller(member).watch(listener);
  clientScope.controller(todos("3")).set("three");
  return reached(watch, "three").then(() => {
    expect(serverScope.resolve(todos("3"))).toBe("three");
    client.close();
    near.close();
    return done.then(() =>
      Promise.all([serverScope.close({ graceful: true }), clientScope.close({ graceful: true })]),
    );
  });
});

test("close detaches: a later server write never reaches the client", () => {
  const counter = freshCounter();
  const serverScope = createScope({ tags: [sync(counter)] });
  const clientScope = createScope({ tags: [sync(counter)] });
  const [near, far] = memoryPair();
  const server = syncServer(serverScope);
  const done = server.connect(near);
  const client = syncClient(clientScope, far);
  const watch = (listener: (next: number) => void): (() => void) =>
    clientScope.controller(counter).watch(listener);
  serverScope.controller(counter).set(4);
  return reached(watch, 4)
    .then(() => {
      client.close();
      serverScope.controller(counter).set(5);
      const waited = new Promise<number>((resolve) => {
        queueMicrotask(() => resolve(clientScope.resolve(counter)));
      });
      return waited;
    })
    .then((got) => {
      expect(got).toBe(4);
      near.close();
      return done.then(() =>
        Promise.all([serverScope.close({ graceful: true }), clientScope.close({ graceful: true })]),
      );
    });
});

test("a snapshot the client parse refuses closes the client transport", () => {
  const serverCell = data({
    label: "loose-value",
    initial: 0,
    meta: [synced({ key: "clash" })],
  });
  const clientCell = data({
    label: "strict-value",
    initial: 0,
    parse: parseWhole,
    meta: [synced({ key: "clash" })],
  });
  const serverScope = createScope({ tags: [sync(serverCell)] });
  const clientScope = createScope({ tags: [sync(clientCell)] });
  const [near, far] = memoryPair();
  const server = syncServer(serverScope);
  const done = server.connect(near);
  const client = syncClient(clientScope, far);
  const parted = new Promise<void>((resolve) => {
    near.onClose(() => resolve());
  });
  serverScope.controller(serverCell).set(1.5);
  return parted.then(() => {
    expect(clientScope.resolve(clientCell)).toBe(0);
    client.close();
    return done.then(() =>
      Promise.all([serverScope.close({ graceful: true }), clientScope.close({ graceful: true })]),
    );
  });
});

test("an ack for an unknown key closes the transport", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const [left, right] = memoryPair();
  const client = syncClient(scope, left);
  const parted = new Promise<void>((resolve) => {
    right.onClose(() => resolve());
  });
  return Promise.resolve()
    .then(() => {
      right.send({ type: "ack", id: 1, key: "nope", version: 3 });
      return parted;
    })
    .then(() => {
      client.close();
      return scope.close({ graceful: true });
    });
});

test("a reject for an unknown key closes the transport", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const [left, right] = memoryPair();
  const client = syncClient(scope, left);
  const parted = new Promise<void>((resolve) => {
    right.onClose(() => resolve());
  });
  return Promise.resolve()
    .then(() => {
      right.send({ type: "reject", id: 2, key: "nope", version: 0, value: 0 });
      return parted;
    })
    .then(() => {
      client.close();
      return scope.close({ graceful: true });
    });
});

test("a reject the client parse refuses closes the transport", () => {
  const strict = data({
    label: "strict-edge",
    initial: 0,
    parse: parseWhole,
    meta: [synced({ key: "edge" })],
  });
  const scope = createScope({ tags: [sync(strict)] });
  const [left, right] = memoryPair();
  const client = syncClient(scope, left);
  const parted = new Promise<void>((resolve) => {
    right.onClose(() => resolve());
  });
  return Promise.resolve()
    .then(() => {
      right.send({ type: "reject", id: 3, key: "edge", version: 0, value: 1.5 });
      return parted;
    })
    .then(() => {
      expect(scope.resolve(strict)).toBe(0);
      client.close();
      return scope.close({ graceful: true });
    });
});

test("a set arriving at the client closes the transport", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const [left, right] = memoryPair();
  const client = syncClient(scope, left);
  const parted = new Promise<void>((resolve) => {
    right.onClose(() => resolve());
  });
  return Promise.resolve()
    .then(() => {
      right.send({ type: "set", id: 4, key: "counter", base: 0, value: 1 });
      return parted;
    })
    .then(() => {
      client.close();
      return scope.close({ graceful: true });
    });
});

test("a far-side close detaches: a later local write sends nothing", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const [left, right] = memoryPair();
  const client = syncClient(scope, left);
  const box = inbox(right);
  const parted = new Promise<void>((resolve) => {
    left.onClose(() => resolve());
  });
  return Promise.resolve()
    .then(() => {
      right.close();
      return parted;
    })
    .then(() => {
      scope.controller(counter).set(7);
      const waited = new Promise<Sync.Message[]>((resolve) => {
        queueMicrotask(() => resolve(box.seen));
      });
      return waited;
    })
    .then((got) => {
      expect(got).toEqual([]);
      client.close();
      return scope.close({ graceful: true });
    });
});

test("an ack moves the version the next write carries", () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const [left, right] = memoryPair();
  const client = syncClient(scope, left);
  const box = inbox(right);
  return Promise.resolve()
    .then(() => {
      right.send({ type: "ack", id: 9, key: "counter", version: 3 });
    })
    .then(() => {
      scope.controller(counter).set(1);
      return box.when(1);
    })
    .then(() => {
      expect(box.seen).toEqual([{ type: "set", id: 1, key: "counter", base: 3, value: 1 }]);
      client.close();
      right.close();
      return scope.close({ graceful: true });
    });
});

/** Read one line per frame: the first line parsing to the named kind wins. */
function untilKind(text: string, kind: string): Sync.Message | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data: ") === false) continue;
    const message = JSON.parse(trimmed.slice("data: ".length));
    if (typeof message === "object" && message !== null && message.type === kind) return message;
  }
  return undefined;
}

test("the recipe streams the snapshot down and a post writes it up", async () => {
  const counter = freshCounter();
  const scope = createScope({ tags: [sync(counter)] });
  const app = recipe(scope);
  function readerOf(streamed: Response): ReadableStreamDefaultReader<Uint8Array> {
    const body = streamed.body;
    if (body === null) throw new Error("body");
    return body.getReader();
  }
  async function readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    text: string,
    kind: string,
  ): Promise<string> {
    const next = await reader.read();
    if (next.done) return text;
    const grown = text + decoder.decode(next.value, { stream: true });
    if (untilKind(grown, kind) === undefined) return readUntil(reader, decoder, grown, kind);
    return grown;
  }
  const streamed = await app.request("/sync?client=a");
  const reader = readerOf(streamed);
  const first = await readUntil(reader, new TextDecoder(), "", "snapshot");
  expect(untilKind(first, "snapshot")).toEqual({
    type: "snapshot",
    key: "counter",
    version: 0,
    value: 0,
  });
  const answer = await app.request("/sync?client=a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "set", id: 1, key: "counter", base: 0, value: 1 }),
  });
  expect(answer.status).toBe(200);
  const text = await readUntil(reader, new TextDecoder(), "", "ack");
  expect(untilKind(text, "ack")).toEqual({ type: "ack", id: 1, key: "counter", version: 1 });
  expect(scope.resolve(counter)).toBe(1);
  await scope.close();
});

test("onMember fires once per new member with the id, after it exists", () => {
  const notes = family({ label: "note-arrive", initial: "" });
  const heard: string[] = [];
  const stop = notes.onMember((id) => {
    heard.push(`${id}:${notes(id).label}`);
  });
  notes("a");
  notes("a");
  notes("b");
  stop();
  notes("c");
  expect(heard).toEqual(["a:note-arrive/a", "b:note-arrive/b"]);
});
