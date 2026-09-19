import { expect, test } from "vite-plus/test";
import { createScope, data } from "@tinker/core";
import {
  family,
  isError,
  isFamily,
  memoryPair,
  readSynced,
  sync,
  syncServer,
  synced,
  type Sync,
} from "../src/index.ts";

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
