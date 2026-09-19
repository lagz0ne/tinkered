import { createScope, data } from "@tinker/core";
import {
  family,
  memoryPair,
  readSynced,
  sync,
  syncClient,
  syncServer,
  synced,
} from "../src/index.ts";

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
 * synced meta plus a todo family, both bound on the server and the client
 * scopes; the server snapshots the truth down, the client writes one set up,
 * and the tour ends once the applied value lands back on the client cell.
 * Answers the bound labels, the member key, the snapshot key, plus the final
 * client value. */
export function tour(): Promise<string> {
  const scope = createScope({ tags: [sync(counter), sync(todo)] });
  const bound = scope.resolve(sync.all);
  const names = bound.map((unit) => unit.label).join(",");
  const member = todo("7");
  const key = readSynced(member).key;
  const [left, right] = memoryPair();
  const server = syncServer(scope);
  const done = server.connect(left);
  const guest = createScope({ tags: [sync(counter), sync(todo)] });
  const client = syncClient(guest, right);
  const settled = new Promise<string>((resolve) => {
    guest.controller(counter).watch((next) => {
      if (next !== 1) return;
      resolve(`${names}:${key}:${key}:${next}`);
    });
  });
  const waited = Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => {
      guest.controller(counter).set(1);
      return settled;
    });
  return waited.then((answer) => {
    client.close();
    return done.then(() =>
      Promise.all([scope.close({ graceful: true }), guest.close({ graceful: true })]).then(
        () => answer,
      ),
    );
  });
}
