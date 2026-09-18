import { createScope, data } from "@tinker/core";
import { family, memoryPair, readSynced, sync, synced } from "../src/index.ts";

/** Parse raw input into text at the process edge. A named function, not a method pull. */
function parseText(raw: unknown): string {
  if (typeof raw !== "string") return String(raw);
  return raw;
}

/** The shared counter: one synced cell. */
const counter = data({ label: "counter", initial: 0, meta: [synced({ key: "counter" })] });

/** The shared todos: a cell with an id. */
const todo = family({ label: "todo", initial: "", parse: parseText });

/** One shared declaration, two processes, no wrapper: a counter cell with
 * synced meta plus a todo family, both bound on one scope, with one snapshot
 * carried over the in-memory pair. Answers the bound labels, the member key,
 * plus the key the far side received. */
export function tour(): Promise<string> {
  const scope = createScope({ tags: [sync(counter), sync(todo)] });
  const bound = scope.resolve(sync.all);
  const names = bound.map((unit) => unit.label).join(",");
  const member = todo("7");
  const key = readSynced(member).key;
  const [left, right] = memoryPair();
  const carried = new Promise<string>((resolve) => {
    right.onMessage((message) => {
      if (message.type === "snapshot") resolve(message.key);
    });
  });
  left.send({ type: "snapshot", key, version: 1, value: scope.resolve(member) });
  return carried.then((arrived) =>
    scope.close({ graceful: true }).then(() => `${names}:${key}:${arrived}`),
  );
}
