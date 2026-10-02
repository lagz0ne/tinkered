import { expect, test } from "vite-plus/test";
import { createScope, resource, tag } from "@tinker/core";
import { family, memoryPair, subscribe, type Sync } from "../../src/sync/index.ts";

function nextMessage(transport: Sync.Transport): Promise<Sync.Message> {
  return new Promise((resolve) => {
    const stop = transport.onMessage((message) => {
      stop();
      resolve(message);
    });
  });
}

test("a shared family keeps root values separate and receives new IDs after another root closes", async () => {
  const notes = family({ label: "notes", initial: "" });
  const wire = tag<Sync.Transport>({ label: "wire" });
  const link = resource({
    label: "link",
    target: "scope",
    depends: { wire },
    factory: ({ wire }) => wire,
  });
  const sub = subscribe(link, { cells: [[notes, "notes"]] });
  const [peerA, wireA] = memoryPair();
  const [peerB, wireB] = memoryPair();
  const stopA = new AbortController();
  const stopB = new AbortController();
  const rootA = createScope({ signal: stopA.signal, tags: wire(wireA), extensions: sub });
  const rootB = createScope({ signal: stopB.signal, tags: wire(wireB), extensions: sub });
  const closed: string[] = [];
  peerA.onClose(() => closed.push("A"));
  peerB.onClose(() => closed.push("B"));
  try {
    await Promise.all([rootA.ready, rootB.ready]);
    const learned = nextMessage(peerB);
    peerA.send({ type: "snapshot", key: "notes/7", version: 1, value: "A" });
    expect(await learned).toEqual({ type: "register", keys: ["notes/7"] });
    const seven = notes("7");
    expect([
      rootA.resolve(notes.cell, { ns: seven }),
      rootB.resolve(notes.cell, { ns: seven }),
    ]).toEqual(["A", ""]);

    stopA.abort();
    await rootA.closed;
    expect(closed).toEqual(["A"]);
    const registered = nextMessage(peerB);
    const nine = notes("9");
    expect(await registered).toEqual({ type: "register", keys: ["notes/9"] });
    const received = new Promise<string>((resolve) => {
      rootB.controller(notes.cell, { ns: nine }).watch(resolve);
    });
    peerB.send({ type: "snapshot", key: "notes/9", version: 1, value: "B" });
    expect(await received).toBe("B");
  } finally {
    stopA.abort();
    stopB.abort();
    await Promise.all([rootA.closed, rootB.closed]);
  }
});
