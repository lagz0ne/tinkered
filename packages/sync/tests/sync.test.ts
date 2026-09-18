import { expect, test } from "vite-plus/test";
import { createScope, data } from "@tinker/core";
import {
  family,
  isError,
  isFamily,
  memoryPair,
  readSynced,
  sync,
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
