import { createScope, data } from "@tinker/core";
import { family, memoryPair, readSynced, sync, syncServer, synced } from "../src/index.ts";

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
 * synced meta plus a todo family, both bound on one scope; the server sends
 * one snapshot down per key, then one applied set moves the truth. Answers
 * the bound labels, the member key, the snapshot key, plus the acked version. */
export function tour(): Promise<string> {
  const scope = createScope({ tags: [sync(counter), sync(todo)] });
  const bound = scope.resolve(sync.all);
  const names = bound.map((unit) => unit.label).join(",");
  const member = todo("7");
  const key = readSynced(member).key;
  const [left, right] = memoryPair();
  const server = syncServer(scope);
  const done = server.connect(left);
  type Heard = { key: string; version: number };
  const heard: Heard[] = [];
  const settled = new Promise<string>((resolve) => {
    right.onMessage((message) => {
      if (message.type === "snapshot") heard.push({ key: message.key, version: message.version });
      if (message.type === "ack") {
        const first = heard[0];
        const answer =
          first === undefined
            ? `${names}:${key}:none:${message.version}`
            : `${names}:${key}:${first.key}:${message.version}`;
        right.close();
        resolve(answer);
      }
    });
  });
  const waited = Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => {
      right.send({ type: "set", id: 1, key: "counter", base: 0, value: 1 });
      return settled;
    });
  return waited.then((answer) =>
    done.then(() => scope.close({ graceful: true }).then(() => answer)),
  );
}
