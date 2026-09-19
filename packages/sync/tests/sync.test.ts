import { expect, test } from "vite-plus/test";
import { createScope, data } from "@tinker/core";
import {
  family,
  isError,
  isFamily,
  memoryPair,
  readSynced,
  source,
  subscribe,
  sync,
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

/** The source's counter: a fresh cell per test so versions never leak. */
function freshCounter() {
  return data({ label: "counter", initial: 0, meta: [synced({ key: "counter" })] });
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

/** Read one line per frame: the first line parsing to a snapshot wins. */
function untilSnapshot(text: string): Sync.Message | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data: ") === false) continue;
    const message = JSON.parse(trimmed.slice("data: ".length));
    if (typeof message === "object" && message !== null && message.type === "snapshot")
      return message;
  }
  return undefined;
}

test("after connect the registered counter reads the source value", () => {
  const counter = freshCounter();
  const origin = createScope({ tags: [sync(counter)] });
  origin.controller(counter).set(5);
  const guest = createScope({ tags: [sync(counter)] });
  const [near, far] = memoryPair();
  const done = source(origin).connect(near);
  const watching = reached(
    (listener: (next: number) => void) => guest.controller(counter).watch(listener),
    5,
  );
  const sub = subscribe(guest, far);
  return watching.then(() => {
    expect(guest.resolve(counter)).toBe(5);
    sub.close();
    near.close();
    return done.then(() =>
      Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
    );
  });
});

test("a source write fans out to two subscribed clients", () => {
  const counter = freshCounter();
  const origin = createScope({ tags: [sync(counter)] });
  const firstScope = createScope({ tags: [sync(counter)] });
  const secondScope = createScope({ tags: [sync(counter)] });
  const [near, far] = memoryPair();
  const [otherNear, otherFar] = memoryPair();
  const firstDone = source(origin).connect(near);
  const secondDone = source(origin).connect(otherNear);
  const firstSeen = inbox(near);
  const secondSeen = inbox(otherNear);
  const first = subscribe(firstScope, far);
  const second = subscribe(secondScope, otherFar);
  const registered = Promise.all([firstSeen.when(1), secondSeen.when(1)]);
  const firstWatch = reached(
    (listener: (next: number) => void) => firstScope.controller(counter).watch(listener),
    5,
  );
  const secondWatch = reached(
    (listener: (next: number) => void) => secondScope.controller(counter).watch(listener),
    5,
  );
  const settled = registered.then(() => {
    origin.controller(counter).set(5);
    return Promise.all([firstWatch, secondWatch]);
  });
  return settled.then(() => {
    expect(firstScope.resolve(counter)).toBe(5);
    expect(secondScope.resolve(counter)).toBe(5);
    first.close();
    second.close();
    near.close();
    otherNear.close();
    return Promise.all([firstDone, secondDone]).then(() =>
      Promise.all([
        origin.close({ graceful: true }),
        firstScope.close({ graceful: true }),
        secondScope.close({ graceful: true }),
      ]),
    );
  });
});

test("a client sees only what it registered", () => {
  const originTodos = family({ label: "todo", initial: "" });
  const guestTodos = family({ label: "todo", initial: "" });
  const origin = createScope({ tags: [sync(originTodos)] });
  const guest = createScope({ tags: [sync(guestTodos)] });
  guestTodos("7");
  const [near, far] = memoryPair();
  const done = source(origin).connect(near);
  const sub = subscribe(guest, far);
  origin.controller(originTodos("7")).set("seven");
  origin.controller(originTodos("9")).set("nine");
  const watching = reached(
    (listener: (next: string) => void) => guest.controller(guestTodos("7")).watch(listener),
    "seven",
  );
  return watching.then(() => {
    expect(guest.resolve(guestTodos("7"))).toBe("seven");
    expect(guestTodos.members()).not.toContain("9");
    sub.close();
    near.close();
    return done.then(() =>
      Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
    );
  });
});

test("a late registration arrives with the initial value, then a later write", () => {
  const originTodos = family({ label: "todo", initial: "" });
  const guestTodos = family({ label: "todo", initial: "" });
  const origin = createScope({ tags: [sync(originTodos)] });
  const guest = createScope({ tags: [sync(guestTodos)] });
  const [near, far] = memoryPair();
  const done = source(origin).connect(near);
  const sub = subscribe(guest, far);
  const member = guestTodos("3");
  origin.controller(originTodos("3")).set("later");
  const watching = reached(
    (listener: (next: string) => void) => guest.controller(member).watch(listener),
    "later",
  );
  return watching.then(() => {
    expect(guest.resolve(member)).toBe("later");
    sub.close();
    near.close();
    return done.then(() =>
      Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
    );
  });
});

test("a register for an unpublished key closes the transport", () => {
  const counter = freshCounter();
  const origin = createScope({ tags: [sync(counter)] });
  const [near, far] = memoryPair();
  const done = source(origin).connect(near);
  const parted = new Promise<void>((resolve) => {
    far.onClose(() => resolve());
  });
  return Promise.resolve()
    .then(() => {
      far.send({ type: "register", keys: ["nope"] });
      return parted;
    })
    .then(() => done.then(() => origin.close({ graceful: true })));
});

test("a snapshot sent to the source closes the transport", () => {
  const counter = freshCounter();
  const origin = createScope({ tags: [sync(counter)] });
  const [near, far] = memoryPair();
  const done = source(origin).connect(near);
  const parted = new Promise<void>((resolve) => {
    far.onClose(() => resolve());
  });
  return Promise.resolve()
    .then(() => {
      far.send({ type: "snapshot", key: "counter", version: 0, value: 0 });
      return parted;
    })
    .then(() => done.then(() => origin.close({ graceful: true })));
});

test("a snapshot the client parse refuses closes the client transport", () => {
  const serverCell = data({
    label: "loose-value",
    initial: 0,
    meta: [synced({ key: "clash" })],
  });
  const guestCell = data({
    label: "strict-value",
    initial: 0,
    parse: parseWhole,
    meta: [synced({ key: "clash" })],
  });
  const origin = createScope({ tags: [sync(serverCell)] });
  const guest = createScope({ tags: [sync(guestCell)] });
  const [near, far] = memoryPair();
  const done = source(origin).connect(near);
  const sub = subscribe(guest, far);
  const parted = new Promise<void>((resolve) => {
    near.onClose(() => resolve());
  });
  origin.controller(serverCell).set(1.5);
  return parted.then(() => {
    expect(guest.resolve(guestCell)).toBe(0);
    sub.close();
    return done.then(() =>
      Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
    );
  });
});

test("close detaches: a later source write never reaches the client", () => {
  const counter = freshCounter();
  const origin = createScope({ tags: [sync(counter)] });
  const guest = createScope({ tags: [sync(counter)] });
  const [near, far] = memoryPair();
  const done = source(origin).connect(near);
  const sub = subscribe(guest, far);
  const watching = reached(
    (listener: (next: number) => void) => guest.controller(counter).watch(listener),
    4,
  );
  origin.controller(counter).set(4);
  return watching
    .then(() => {
      sub.close();
      origin.controller(counter).set(5);
      const waited = new Promise<number>((resolve) => {
        queueMicrotask(() => resolve(guest.resolve(counter)));
      });
      return waited;
    })
    .then((got) => {
      expect(got).toBe(4);
      near.close();
      return done.then(() =>
        Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
      );
    });
});

test("a local write on a client cell stays local until the next snapshot", () => {
  const counter = freshCounter();
  const origin = createScope({ tags: [sync(counter)] });
  const guest = createScope({ tags: [sync(counter)] });
  const [near, far] = memoryPair();
  const done = source(origin).connect(near);
  const sub = subscribe(guest, far);
  const firstWatch = reached(
    (listener: (next: number) => void) => guest.controller(counter).watch(listener),
    1,
  );
  origin.controller(counter).set(1);
  return firstWatch
    .then(() => {
      guest.controller(counter).set(42);
      expect(origin.resolve(counter)).toBe(1);
      const watching = reached(
        (listener: (next: number) => void) => guest.controller(counter).watch(listener),
        2,
      );
      origin.controller(counter).set(2);
      return watching;
    })
    .then(() => {
      expect(guest.resolve(counter)).toBe(2);
      sub.close();
      near.close();
      return done.then(() =>
        Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
      );
    });
});

test("two registers leave two sync register spans with their counts", () => {
  const counter = freshCounter();
  const seen: { message: string; attributes: Record<string, unknown> }[] = [];
  const originTodos = family({ label: "todo-registers", initial: "" });
  const noting = createScope({
    tags: [sync(counter), sync(originTodos)],
    observe: {
      history: 10,
      log: (entry) => void seen.push({ message: entry.message, attributes: entry.attributes }),
    },
  });
  const guestTodos = family({ label: "todo-registers", initial: "" });
  const guest = createScope({ tags: [sync(counter), sync(guestTodos)] });
  const [near, far] = memoryPair();
  const inboxNear = inbox(near);
  const done = source(noting).connect(near);
  const sub = subscribe(guest, far);
  guestTodos("3");
  return inboxNear.when(2).then(() => {
    const tick = new Promise<void>((resolve) => {
      queueMicrotask(() => resolve());
    });
    return tick.then(() => {
      const spans = noting.spans().filter((span) => span.name === "sync register");
      expect(spans.length).toBe(2);
      const lines = seen.filter((entry) => entry.message === "sync register");
      expect(lines.length).toBe(2);
      expect(lines[0]?.attributes["count"]).toBe(1);
      expect(lines[1]?.attributes["count"]).toBe(1);
      sub.close();
      near.close();
      return done.then(() =>
        Promise.all([noting.close({ graceful: true }), guest.close({ graceful: true })]),
      );
    });
  });
});

test("the recipe registers by identity, then streams the snapshot down", async () => {
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
  ): Promise<string> {
    const next = await reader.read();
    if (next.done) return text;
    const grown = text + decoder.decode(next.value, { stream: true });
    if (untilSnapshot(grown) === undefined) return readUntil(reader, decoder, grown);
    return grown;
  }
  const streamed = await app.request("/sync?client=a");
  const reader = readerOf(streamed);
  const answer = await app.request("/sync?client=a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "register", keys: ["counter"] }),
  });
  expect(answer.status).toBe(200);
  const first = await readUntil(reader, new TextDecoder(), "");
  expect(untilSnapshot(first)).toEqual({
    type: "snapshot",
    key: "counter",
    version: 0,
    value: 0,
  });
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
