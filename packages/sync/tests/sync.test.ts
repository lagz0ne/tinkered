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
import { boot } from "../../../examples/sync/hono.ts";

/** Parse raw input into text at the process edge. A named function, not a method pull. */
function parseText(raw: unknown): string {
  if (typeof raw !== "string") return String(raw);
  return raw;
}

/** The shared counter both drivers publish. */
const counter = data({ label: "counter", initial: 0, meta: [synced({ key: "counter" })] });

/** The shared todo family both drivers publish. */
const todos = family({ label: "todo", initial: "", parse: parseText });

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

/** Resolve when a watched cell reaches a value: the watcher settles the one
 * awaited promise per test once the arrival lands. */
function reached<T>(watch: (listener: (next: T) => void) => () => void, value: T): Promise<void> {
  return new Promise<void>((resolve) => {
    watch((next) => {
      if (next === value) resolve();
    });
  });
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
  const first: Sync.Message = { type: "snapshot", key: "counter", version: 1, value: 1 };
  const secondMessage: Sync.Message = { type: "snapshot", key: "counter", version: 2, value: 2 };
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
  left.send({ type: "snapshot", key: "counter", version: 9, value: 9 });
  right.send({ type: "snapshot", key: "counter", version: 10, value: 10 });
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
  left.send({ type: "snapshot", key: "counter", version: 3, value: 3 });
  return arrived.then(() => {
    expect(dropped).toBe(0);
  });
});

test("ready means the viewer holds its initial data set, no watch", () => {
  const src = source();
  const origin = createScope({ tags: [sync(counter)], extensions: [src] });
  origin.controller(counter).set(5);
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far);
    const guest = createScope({ tags: [sync(counter)], extensions: [sub] });
    return guest.ready.then(() => {
      expect(guest.resolve(counter)).toBe(5);
      guest.resolve(sub).close();
      return done.then(() =>
        Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
      );
    });
  });
});

test("resolve delivers the installed values: connect on the source, close on the viewer", () => {
  const src = source();
  const origin = createScope({ tags: [sync(counter)], extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far);
    const guest = createScope({ tags: [sync(counter)], extensions: [sub] });
    return guest.ready.then(() => {
      expect(typeof origin.resolve(src).connect).toBe("function");
      expect(typeof guest.resolve(sub).close).toBe("function");
      guest.resolve(sub).close();
      return done.then(() =>
        Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
      );
    });
  });
});

test("a source write fans out to two subscribed viewers", () => {
  const src = source();
  const origin = createScope({ tags: [sync(counter)], extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const [otherNear, otherFar] = memoryPair();
    const done = Promise.all([
      origin.resolve(src).connect(near),
      origin.resolve(src).connect(otherNear),
    ]);
    const firstSub = subscribe(far);
    const secondSub = subscribe(otherFar);
    const firstScope = createScope({ tags: [sync(counter)], extensions: [firstSub] });
    const secondScope = createScope({ tags: [sync(counter)], extensions: [secondSub] });
    return Promise.all([firstScope.ready, secondScope.ready]).then(() => {
      const firstWatch = reached(
        (listener: (next: number) => void) => firstScope.controller(counter).watch(listener),
        5,
      );
      const secondWatch = reached(
        (listener: (next: number) => void) => secondScope.controller(counter).watch(listener),
        5,
      );
      origin.controller(counter).set(5);
      return Promise.all([firstWatch, secondWatch]).then(() => {
        expect(firstScope.resolve(counter)).toBe(5);
        expect(secondScope.resolve(counter)).toBe(5);
        firstScope.resolve(firstSub).close();
        secondScope.resolve(secondSub).close();
        return done.then(() =>
          Promise.all([
            origin.close({ graceful: true }),
            firstScope.close({ graceful: true }),
            secondScope.close({ graceful: true }),
          ]),
        );
      });
    });
  });
});

test("a viewer sees only what it registered", () => {
  const originTodos = family({ label: "todo", initial: "" });
  const guestTodos = family({ label: "todo", initial: "" });
  guestTodos("7");
  const src = source();
  const origin = createScope({ tags: [sync(originTodos)], extensions: [src] });
  origin.controller(originTodos("7")).set("seven");
  origin.controller(originTodos("9")).set("nine");
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far);
    const guest = createScope({ tags: [sync(guestTodos)], extensions: [sub] });
    return guest.ready.then(() => {
      expect(guest.resolve(guestTodos("7"))).toBe("seven");
      expect(guestTodos.members()).not.toContain("9");
      guest.resolve(sub).close();
      return done.then(() =>
        Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
      );
    });
  });
});

test("a late member after ready gets its snapshot", () => {
  const originTodos = family({ label: "todo-late", initial: "" });
  const guestTodos = family({ label: "todo-late", initial: "" });
  const src = source();
  const origin = createScope({ tags: [sync(originTodos)], extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far);
    const guest = createScope({ tags: [sync(guestTodos)], extensions: [sub] });
    return guest.ready.then(() => {
      const member = guestTodos("3");
      const landed = reached(
        (listener: (next: string) => void) => guest.controller(member).watch(listener),
        "later",
      );
      origin.controller(originTodos("3")).set("later");
      return landed.then(() => {
        expect(guest.resolve(member)).toBe("later");
        guest.resolve(sub).close();
        return done.then(() =>
          Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
        );
      });
    });
  });
});

test("readiness spans the whole initial set", () => {
  const originTodos = family({ label: "todo", initial: "", parse: parseText });
  const guestTodos = family({ label: "todo", initial: "", parse: parseText });
  originTodos("7");
  guestTodos("7");
  const src = source();
  const origin = createScope({ tags: [sync(counter), sync(originTodos)], extensions: [src] });
  origin.controller(counter).set(5);
  origin.controller(originTodos("7")).set("seven");
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far);
    const guest = createScope({ tags: [sync(counter), sync(guestTodos)], extensions: [sub] });
    return guest.ready.then(() => {
      expect(guest.resolve(counter)).toBe(5);
      expect(guest.resolve(guestTodos("7"))).toBe("seven");
      guest.resolve(sub).close();
      return done.then(() =>
        Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
      );
    });
  });
});

test("the far side closing first rejects ready with SyncNotReady", () => {
  const src = source();
  const origin = createScope({ tags: [sync(counter)], extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    done.then(undefined, () => undefined);
    const sub = subscribe(far);
    const guest = createScope({ tags: [sync(counter)], extensions: [sub] });
    const checked = expect(guest.ready).rejects.toSatisfy((error: unknown) =>
      isError(error, "SyncNotReady"),
    );
    checked.then(undefined, () => undefined);
    near.close();
    return checked.then(() =>
      guest.close().then((result) => {
        expect(result.status).toBe("failed");
        return done.then(() => origin.close({ graceful: true }));
      }),
    );
  });
});

test("a forced close while waiting rejects ready and parts the source wire", () => {
  const src = source();
  const origin = createScope({ tags: [sync(counter)], extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const parted = new Promise<void>((resolve) => {
      near.onClose(() => resolve());
    });
    const sub = subscribe(far);
    const guest = createScope({ tags: [sync(counter)], extensions: [sub] });
    const closing = guest.close();
    return guest.ready.then(
      () => {
        expect.unreachable();
      },
      (error: unknown) => {
        if (!isError(error, "SyncNotReady")) throw error;
        expect(error.payload.missing).toEqual(["counter"]);
        return parted.then(() =>
          closing.then(() => done.then(() => origin.close({ graceful: true }))),
        );
      },
    );
  });
});

test("the source close hook parts the viewer wire on a graceful close", () => {
  const src = source();
  const origin = createScope({ tags: [sync(counter)], extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const parted = new Promise<void>((resolve) => {
      far.onClose(() => resolve());
    });
    const sub = subscribe(far);
    const guest = createScope({ tags: [sync(counter)], extensions: [sub] });
    return guest.ready.then(() =>
      origin.close({ graceful: true }).then((result) => {
        expect(result.status).toBe("success");
        return parted.then(() => done.then(() => guest.close({ graceful: true })));
      }),
    );
  });
});

test("an unpublished key on register closes the transport", () => {
  const src = source();
  const origin = createScope({ tags: [sync(counter)], extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const parted = new Promise<void>((resolve) => {
      far.onClose(() => resolve());
    });
    far.send({ type: "register", keys: ["nope"] });
    return parted.then(() => done.then(() => origin.close({ graceful: true })));
  });
});

test("the recipe registers by identity, then streams the snapshot down", async () => {
  const { scope, app } = boot();
  await scope.ready;
  function readerOf(streamed: Response): ReadableStreamDefaultReader<Uint8Array> {
    const body = streamed.body;
    if (body === null) throw new Error("body");
    return body.getReader();
  }
  function readUntil(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    text: string,
  ): Promise<string> {
    return reader.read().then((next) => {
      if (next.done) return text;
      const grown = text + decoder.decode(next.value, { stream: true });
      if (untilSnapshot(grown) === undefined) return readUntil(reader, decoder, grown);
      return Promise.resolve(grown);
    });
  }
  const streamed = await app.request("/sync?client=a");
  const reader = readerOf(streamed);
  const posted = await app.request("/sync?client=a", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "register", keys: ["counter"] }),
  });
  expect(posted.status).toBe(200);
  const first = await readUntil(reader, new TextDecoder(), "");
  expect(untilSnapshot(first)).toEqual({
    type: "snapshot",
    key: "counter",
    version: 0,
    value: 0,
  });
  return scope.close();
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

test("a viewer binding nothing is ready at once", () => {
  const sub = subscribe(memoryPair()[1]);
  const guest = createScope({ extensions: [sub] });
  return guest.ready.then(() => guest.close({ graceful: true }));
});
