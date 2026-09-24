import { expect, test } from "vite-plus/test";
import { setImmediate } from "node:timers/promises";
import { createScope, data, type Observe } from "@tinker/core";
import {
  family,
  isError,
  isFamily,
  memoryPair,
  source,
  subscribe,
  type Sync,
} from "../src/index.ts";
import { boot } from "../../../examples/sync/hono.ts";

/** Parse raw input into text at the process edge. A named function, not a method pull. */
function parseText(raw: unknown): string {
  if (typeof raw !== "string") return String(raw);
  return raw;
}

/** The shared counter both drivers publish. */
const counter = data({ label: "counter", initial: 0 });

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

test("family memoizes a namespace per id and declares one cell", () => {
  const notes = family({ label: "note", initial: "" });
  const first = notes("a");
  const cell = notes.cell;
  expect(notes("a")).toBe(first);
  expect(notes("b")).not.toBe(first);
  notes("c");
  expect(notes.cell).toBe(cell);
  expect(notes.members()).toEqual(["a", "b", "c"]);
});

test("two members of one cell keep independent values", async () => {
  const scope = createScope();
  const first = todos("1");
  const second = todos("2");
  scope.controller(todos.cell, { ns: first }).set("one");
  scope.controller(todos.cell, { ns: second }).set("two");
  expect(scope.resolve(todos.cell, { ns: first })).toBe("one");
  expect(scope.resolve(todos.cell, { ns: second })).toBe("two");
  await scope.close({ graceful: true });
});

test("isFamily tells a family from a cell", () => {
  expect(isFamily(todos)).toBe(true);
  expect(isFamily(counter)).toBe(false);
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
  left.onMessage(() => {
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
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  origin.controller(counter).set(5);
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far, { cells: [[counter, "counter"]] });
    const guest = createScope({ extensions: [sub] });
    return guest.ready.then(() => {
      expect(guest.resolve(counter)).toBe(5);
      guest.resolve(sub).close();
      return done.then((end) => {
        expect(end.status).toBe("success");
        return Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]);
      });
    });
  });
});

test("a registration logs its key count and its observed step carries elapsed time", async () => {
  const lines: Observe.Log[] = [];
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({
    extensions: [src],
    observe: { history: 5, log: (entry) => lines.push(entry) },
  });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const received = new Promise<Sync.Message>((resolve) => {
    far.onMessage((message) => {
      if (message.type === "snapshot") resolve(message);
    });
  });
  far.send({ type: "register", keys: ["counter"] });
  expect(await received).toMatchObject({ type: "snapshot", key: "counter" });
  const register = lines.filter((line) => line.message === "sync keys");
  expect(register.map((line) => line.attributes)).toEqual([{ count: 1 }]);
  const step = lines.filter((line) => line.message === "sync register");
  expect(step.map((line) => line.attributes)).toEqual([{ outcome: "ok", ms: expect.any(Number) }]);
  far.close();
  await done;
  await origin.close({ graceful: true });
});

test("resolve delivers the installed values: connect on the source, close on the viewer", () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far, { cells: [[counter, "counter"]] });
    const guest = createScope({ extensions: [sub] });
    return guest.ready.then(() => {
      expect(typeof origin.resolve(src).connect).toBe("function");
      expect(typeof guest.resolve(sub).close).toBe("function");
      guest.resolve(sub).close();
      return done.then((end) => {
        expect(end.status).toBe("success");
        return Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]);
      });
    });
  });
});

test("a source write fans out to two subscribed viewers", () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const [otherNear, otherFar] = memoryPair();
    const done = Promise.all([
      origin.resolve(src).connect(near),
      origin.resolve(src).connect(otherNear),
    ]);
    const firstSub = subscribe(far, { cells: [[counter, "counter"]] });
    const secondSub = subscribe(otherFar, { cells: [[counter, "counter"]] });
    const firstScope = createScope({ extensions: [firstSub] });
    const secondScope = createScope({ extensions: [secondSub] });
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

test("cells take nested lists and false: a row is a pair, a list of pairs is opened", () => {
  const flags = { todos: false };
  const src = source({ cells: [null, [[counter, "counter"]], flags.todos && [todos, "todo"]] });
  const origin = createScope({ extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far, { cells: [[[counter, "counter"]]] });
    const guest = createScope({ extensions: [sub] });
    return guest.ready.then(() => {
      const watch = reached(
        (listener: (next: number) => void) => guest.controller(counter).watch(listener),
        3,
      );
      origin.controller(counter).set(3);
      return watch.then(() => {
        expect(guest.resolve(counter)).toBe(3);
        guest.resolve(sub).close();
        return done.then(() =>
          Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
        );
      });
    });
  });
});

test("a viewer sees only what it registered", () => {
  const originTodos = family({ label: "todo", initial: "" });
  const guestTodos = family({ label: "todo", initial: "" });
  guestTodos("7");
  const src = source({ cells: [[originTodos, "todo"]] });
  const origin = createScope({ extensions: [src] });
  origin.controller(originTodos.cell, { ns: originTodos("7") }).set("seven");
  origin.controller(originTodos.cell, { ns: originTodos("9") }).set("nine");
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far, { cells: [[guestTodos, "todo"]] });
    const guest = createScope({ extensions: [sub] });
    return guest.ready.then(() => {
      expect(guest.resolve(guestTodos.cell, { ns: guestTodos("7") })).toBe("seven");
      expect(guestTodos.members()).not.toContain("9");
      guest.resolve(sub).close();
      return done.then(() =>
        Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
      );
    });
  });
});

test("two family members stay independent over the wire", async () => {
  const originTodos = family({ label: "two", initial: "" });
  const guestTodos = family({ label: "two", initial: "" });
  const src = source({ cells: [[originTodos, "two"]] });
  const origin = createScope({ extensions: [src] });
  origin.controller(originTodos.cell, { ns: originTodos("a") }).set("alpha");
  origin.controller(originTodos.cell, { ns: originTodos("b") }).set("beta");
  await origin.ready;
  const [near, far] = memoryPair();
  const sub = subscribe(far, { cells: [[guestTodos, "two"]] });
  guestTodos("a");
  guestTodos("b");
  const guest = createScope({ extensions: [sub] });
  const done = origin.resolve(src).connect(near);
  await guest.ready;
  expect(guest.resolve(guestTodos.cell, { ns: guestTodos("a") })).toBe("alpha");
  expect(guest.resolve(guestTodos.cell, { ns: guestTodos("b") })).toBe("beta");
  guest.resolve(sub).close();
  await done;
  await Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]);
});

test("a late member after ready gets its snapshot", () => {
  const originTodos = family({ label: "todo-late", initial: "" });
  const guestTodos = family({ label: "todo-late", initial: "" });
  const src = source({ cells: [[originTodos, "todo-late"]] });
  const origin = createScope({ extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const sub = subscribe(far, { cells: [[guestTodos, "todo-late"]] });
    const guest = createScope({ extensions: [sub] });
    return guest.ready.then(() => {
      const member = guestTodos("3");
      const landed = reached(
        (listener: (next: string) => void) =>
          guest.controller(guestTodos.cell, { ns: member }).watch(listener),
        "later",
      );
      origin.controller(originTodos.cell, { ns: originTodos("3") }).set("later");
      return landed.then(() => {
        expect(guest.resolve(guestTodos.cell, { ns: member })).toBe("later");
        guest.resolve(sub).close();
        return done.then(() =>
          Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]),
        );
      });
    });
  });
});

test("readiness spans the whole initial set", async () => {
  const staged = data({ label: "staged", initial: 0 });
  const stagedTodos = family({ label: "todo-t07-stage", initial: "", parse: parseText });
  stagedTodos("7");
  const [near, far] = memoryPair();
  const sub = subscribe(far, {
    cells: [
      [staged, "counter"],
      [stagedTodos, "todo-t07-stage"],
    ],
  });
  const guest = createScope({ extensions: [sub] });
  let finished = false;
  const outcome = guest.ready.then(() => {
    finished = true;
  });
  near.send({ type: "snapshot", key: "counter", version: 0, value: 5 });
  await setImmediate();
  expect(finished).toBe(false);
  near.send({ type: "snapshot", key: "todo-t07-stage/7", version: 0, value: "seven" });
  await outcome;
  expect(guest.resolve(staged)).toBe(5);
  expect(guest.resolve(stagedTodos.cell, { ns: stagedTodos("7") })).toBe("seven");
  guest.resolve(sub).close();
  await guest.close({ graceful: true });
});

test("the far side closing first rejects ready with SyncNotReady", async () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const sub = subscribe(far, { cells: [[counter, "counter"]] });
  const guest = createScope({ extensions: [sub] });
  const checked = guest.ready.then(
    () => {
      expect.unreachable();
    },
    (error: unknown) => {
      if (!isError(error, "SyncNotReady")) throw error;
      expect(error.payload.label).toBe("subscribe");
      expect(error.payload.missing).toEqual(["counter"]);
    },
  );
  near.close();
  await checked;
  const result = await guest.close();
  expect(result.status).toBe("failed");
  const end = await done;
  expect(end.status).toBe("success");
  await origin.close({ graceful: true });
});

test("a forced close while waiting rejects ready and parts the source wire", () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const parted = new Promise<void>((resolve) => {
      near.onClose(() => resolve());
    });
    const sub = subscribe(far, { cells: [[counter, "counter"]] });
    const guest = createScope({ extensions: [sub] });
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
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const parted = new Promise<void>((resolve) => {
      far.onClose(() => resolve());
    });
    const sub = subscribe(far, { cells: [[counter, "counter"]] });
    const guest = createScope({ extensions: [sub] });
    return guest.ready.then(() =>
      origin.close({ graceful: true }).then((result) => {
        expect(result.status).toBe("success");
        return parted.then(() =>
          done.then((end) => {
            expect(end.status).toBe("success");
            return guest.close({ graceful: true });
          }),
        );
      }),
    );
  });
});

test("an unpublished key on register closes the transport", () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  return origin.ready.then(() => {
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const parted = new Promise<void>((resolve) => {
      far.onClose(() => resolve());
    });
    far.send({ type: "register", keys: ["nope"] });
    return parted.then(() =>
      done.then((end) => {
        expect(end.status).toBe("success");
        return origin.close({ graceful: true });
      }),
    );
  });
});

test("a row for an unpublished key posted by a viewer still closes the transport", async () => {
  const watched = family({ label: "todo-t07-viewer", initial: "" });
  const held = family({ label: "todo-t07-held", initial: "" });
  const src = source({ cells: [[held, "todo-t07-held"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const parted = new Promise<void>((resolve) => {
    near.onClose(() => resolve());
  });
  const sub = subscribe(far, { cells: [[watched, "todo-t07-viewer"]] });
  const guest = createScope({ extensions: [sub] });
  await guest.ready;
  expect(guest.resolve(watched.cell, { ns: watched("7") })).toBe("");
  far.send({ type: "register", keys: ["todo-t07-viewer/7"] });
  await parted;
  const end = await done;
  expect(end.status).toBe("success");
  guest.resolve(sub).close();
  await Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]);
});

test.each([{ kind: "unpublished key" }, { kind: "parse rejects" }, { kind: "wrong direction" }])(
  "an initial $kind rejects ready with the missing keys",
  async ({ kind }: { kind: string }) => {
    const strict = data({
      label: "t07-strict",
      initial: 0,
      parse: (raw: unknown): number => {
        if (typeof raw !== "number") throw new Error("bad value");
        return raw;
      },
    });
    const [near, far] = memoryPair();
    const parted = new Promise<void>((resolve) => {
      near.onClose(() => resolve());
    });
    const sub = subscribe(far, {
      cells: [
        [counter, "counter"],
        [strict, "t07-strict"],
      ],
    });
    const guest = createScope({ extensions: [sub] });
    const checked = guest.ready.then(
      () => {
        expect.unreachable();
      },
      (error: unknown) => {
        if (!isError(error, "SyncNotReady")) throw error;
        expect(error.payload.label).toBe("subscribe");
        expect(error.payload.missing).toEqual(["t07-strict"]);
      },
    );
    near.send({ type: "snapshot", key: "counter", version: 0, value: 5 });
    if (kind === "unpublished key") {
      near.send({ type: "snapshot", key: "nope", version: 0, value: 0 });
    } else if (kind === "parse rejects") {
      near.send({ type: "snapshot", key: "t07-strict", version: 0, value: "not-a-number" });
    } else {
      near.send({ type: "register", keys: ["counter"] });
    }
    await checked;
    await parted;
    const result = await guest.close();
    expect(result.status).toBe("failed");
  },
);

test("after ready a bad snapshot closes the wire and drops later snapshots", async () => {
  const originTodos = family({ label: "todo-t07-after", initial: "" });
  const guestTodos = family({ label: "todo-t07-after", initial: "" });
  guestTodos("7");
  const src = source({ cells: [[originTodos, "todo-t07-after"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const sub = subscribe(far, { cells: [[guestTodos, "todo-t07-after"]] });
  const guest = createScope({ extensions: [sub] });
  await guest.ready;
  expect(guest.resolve(guestTodos.cell, { ns: guestTodos("7") })).toBe("");
  const parted = new Promise<void>((resolve) => {
    near.onClose(() => resolve());
  });
  near.send({ type: "snapshot", key: "nope", version: 0, value: 0 });
  near.send({ type: "snapshot", key: "todo-t07-after/7", version: 1, value: "new" });
  await parted;
  await setImmediate();
  expect(guest.resolve(guestTodos.cell, { ns: guestTodos("7") })).toBe("");
  guest.resolve(sub).close();
  await done;
  await Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]);
});

test("a source member the origin never held arrives with the source value", async () => {
  const originTodos = family({ label: "todo-t07-made", initial: "src-init" });
  const guestTodos = family({ label: "todo-t07-made", initial: "guest-init" });
  const memberId = "a/b";
  guestTodos(memberId);
  expect(originTodos.members()).toEqual([]);
  const src = source({ cells: [[originTodos, "todo-t07-made"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const sub = subscribe(far, { cells: [[guestTodos, "todo-t07-made"]] });
  const guest = createScope({ extensions: [sub] });
  await guest.ready;
  expect(guest.resolve(guestTodos.cell, { ns: guestTodos(memberId) })).toBe("src-init");
  expect(originTodos.members()).toEqual([memberId]);
  guest.resolve(sub).close();
  await done;
  await Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]);
});

test("two cells under one key reject startup with SyncConflict", async () => {
  const firstCell = data({ label: "t07-dup-a", initial: 0 });
  const secondCell = data({ label: "t07-dup-b", initial: 1 });
  const src = source({
    cells: [
      [firstCell, "t07-dup"],
      [secondCell, "t07-dup"],
    ],
  });
  const origin = createScope({ extensions: [src] });
  await origin.ready.then(
    () => {
      expect.unreachable();
    },
    (error: unknown) => {
      if (isError(error, "SyncNotReady")) throw error;
      if (!isError(error, "SyncConflict")) throw error;
      expect(error.payload.key).toBe("t07-dup");
    },
  );
  await origin.close();
});

test("binding the same cell twice stays ready with one registration key", async () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  origin.controller(counter).set(5);
  await origin.ready;
  const [near, far] = memoryPair();
  const seen: Sync.Message[] = [];
  near.onMessage((message) => {
    seen.push(message);
  });
  const done = origin.resolve(src).connect(near);
  const sub = subscribe(far, { cells: [[counter, "counter"]] });
  const guest = createScope({ extensions: [sub] });
  await guest.ready;
  expect(guest.resolve(counter)).toBe(5);
  const registers = seen.filter((message): boolean => message.type === "register");
  expect(registers).toEqual([{ type: "register", keys: ["counter"] }]);
  guest.resolve(sub).close();
  await done;
  await Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]);
});

test("a row names the key, not the cell label", async () => {
  const renamed = data({ label: "renamed-cell", initial: 0 });
  const watched = data({ label: "watched-cell", initial: 0 });
  const src = source({ cells: [[renamed, "shared"]] });
  const origin = createScope({ extensions: [src] });
  origin.controller(renamed).set(4);
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const sub = subscribe(far, { cells: [[watched, "shared"]] });
  const guest = createScope({ extensions: [sub] });
  await guest.ready;
  expect(guest.resolve(watched)).toBe(4);
  guest.resolve(sub).close();
  await done;
  await Promise.all([origin.close({ graceful: true }), guest.close({ graceful: true })]);
});

test("connect resolves success when the transport closes", async () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  near.close();
  const end = await done;
  expect(end.status).toBe("success");
  far.close();
  await origin.close({ graceful: true });
});

test("connect resolves cancelled on a forced root close", async () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const ended = await origin.close();
  expect(ended.status).toBe("cancelled");
  const end = await done;
  expect(end.status).toBe("cancelled");
  far.close();
});

test("the recipe registers by identity, then streams the snapshot down", async () => {
  const { scope, app } = await boot();
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
    heard.push(id);
    expect(notes.members()).toContain(id);
  });
  notes("a");
  notes("a");
  notes("b");
  stop();
  notes("c");
  expect(heard).toEqual(["a", "b"]);
});

test("a source sends changes only for keys registered by that viewer", async () => {
  const other = data({ label: "other", initial: 0 });
  const src = source({
    cells: [
      [counter, "counter"],
      [other, "other"],
    ],
  });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const seen: Sync.Message[] = [];
  far.onMessage((message) => seen.push(message));
  far.send({ type: "register", keys: ["counter"] });
  await setImmediate();
  origin.controller(other).set(3);
  await setImmediate();
  expect(seen).toEqual([{ type: "snapshot", key: "counter", version: 0, value: 0 }]);
  far.close();
  await done;
  await origin.close({ graceful: true });
});

test("closing the viewer scope parts the source wire", async () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const sub = subscribe(far, { cells: [[counter, "counter"]] });
  const guest = createScope({ extensions: [sub] });
  await guest.ready;
  await guest.close({ graceful: true });
  expect((await done).status).toBe("success");
  await origin.close({ graceful: true });
});

test("a closed viewer sends nothing when a member arrives later", async () => {
  const notes = family({ label: "note-closed", initial: "" });
  const [, far] = memoryPair();
  const sent: Sync.Message[] = [];
  let closed = false;
  const transport: Sync.Transport = {
    send: (message) => {
      sent.push(message);
      far.send(message);
    },
    onMessage: (listener) => far.onMessage(listener),
    onClose: (listener) =>
      far.onClose(() => {
        if (!closed) listener();
      }),
    close: () => {
      closed = true;
      far.close();
    },
  };
  const sub = subscribe(transport, { cells: [[notes, "notes"]] });
  const guest = createScope({ extensions: [sub] });
  await guest.ready;
  await guest.close({ graceful: true });
  notes("late");
  await setImmediate();
  expect(sent).toEqual([{ type: "register", keys: [] }]);
});

test("a viewer closes after a wrong-direction message arrives after ready", async () => {
  const [near, far] = memoryPair();
  const sub = subscribe(far, { cells: [[counter, "counter"]] });
  const guest = createScope({ extensions: [sub] });
  near.send({ type: "snapshot", key: "counter", version: 0, value: 1 });
  await guest.ready;
  const parted = new Promise<void>((resolve) => near.onClose(resolve));
  near.send({ type: "register", keys: ["counter"] });
  await parted;
  await guest.close({ graceful: true });
});

test("a source rejects a snapshot without starting a registration", async () => {
  const lines: Observe.Log[] = [];
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({
    extensions: [src],
    observe: { history: 5, log: (entry) => lines.push(entry) },
  });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const parted = new Promise<void>((resolve) => far.onClose(resolve));
  far.send({ type: "snapshot", key: "counter", version: 0, value: 9 });
  await parted;
  expect((await done).status).toBe("success");
  expect(lines.filter((line) => line.message === "sync register")).toEqual([]);
  await origin.close({ graceful: true });
});

test.each(["/a", "notes/"])(
  "a source closes on a family key with a missing label or id: %s",
  async (key) => {
    const notes = family({ label: "note-key", initial: "" });
    const src = source({ cells: [[notes, "notes"]] });
    const origin = createScope({ extensions: [src] });
    await origin.ready;
    const [near, far] = memoryPair();
    const done = origin.resolve(src).connect(near);
    const parted = new Promise<void>((resolve) => far.onClose(resolve));
    far.send({ type: "register", keys: [key] });
    await parted;
    expect((await done).status).toBe("success");
    await origin.close({ graceful: true });
  },
);

test("a source closes the wire if its transport cannot send a snapshot", async () => {
  const src = source({ cells: [[counter, "counter"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const broken: Sync.Transport = {
    send: () => {
      throw new Error("send failed");
    },
    onMessage: (listener) => near.onMessage(listener),
    onClose: (listener) => near.onClose(listener),
    close: () => near.close(),
  };
  const done = origin.resolve(src).connect(broken);
  const parted = new Promise<void>((resolve) => far.onClose(resolve));
  far.send({ type: "register", keys: ["counter"] });
  await parted;
  expect((await done).status).toBe("success");
  await origin.close({ graceful: true });
});

test("a one-letter family label can register a member", async () => {
  const notes = family({ label: "n", initial: "new" });
  const src = source({ cells: [[notes, "n"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const received = new Promise<Sync.Message>((resolve) => far.onMessage(resolve));
  far.send({ type: "register", keys: ["n/a"] });
  expect(await received).toEqual({ type: "snapshot", key: "n/a", version: 0, value: "new" });
  far.close();
  await done;
  await origin.close({ graceful: true });
});

test("an empty family label cannot register a member", async () => {
  const notes = family({ label: "empty", initial: "new" });
  const src = source({ cells: [[notes, ""]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const parted = new Promise<void>((resolve) => far.onClose(resolve));
  far.send({ type: "register", keys: ["/a"] });
  await parted;
  expect(notes.members()).toEqual([]);
  await done;
  await origin.close({ graceful: true });
});

test("a source keeps a member's version when it changes before registration", async () => {
  const notes = family({ label: "note-version", initial: "" });
  const src = source({ cells: [[notes, "notes"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  origin.controller(notes.cell, { ns: notes("a") }).set("first");
  origin.controller(notes.cell, { ns: notes("a") }).set("second");
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const received = new Promise<Sync.Message>((resolve) => far.onMessage(resolve));
  far.send({ type: "register", keys: ["notes/a"] });
  expect(await received).toEqual({
    type: "snapshot",
    key: "notes/a",
    version: 2,
    value: "second",
  });
  far.close();
  await done;
  await origin.close({ graceful: true });
});

test("a source keeps versions of members held before startup", async () => {
  const notes = family({ label: "note-early", initial: "" });
  const member = notes("a");
  const src = source({ cells: [[notes, "notes"]] });
  const origin = createScope({ extensions: [src] });
  await origin.ready;
  origin.controller(notes.cell, { ns: member }).set("first");
  const [near, far] = memoryPair();
  const done = origin.resolve(src).connect(near);
  const received = new Promise<Sync.Message>((resolve) => far.onMessage(resolve));
  far.send({ type: "register", keys: ["notes/a"] });
  expect(await received).toEqual({ type: "snapshot", key: "notes/a", version: 1, value: "first" });
  far.close();
  await done;
  await origin.close({ graceful: true });
});

test("a viewer binding nothing is ready at once", () => {
  const sub = subscribe(memoryPair()[1], { cells: [] });
  const guest = createScope({ extensions: [sub] });
  return guest.ready.then(() => guest.close({ graceful: true }));
});
