import { createScope, data } from "@tinker/core";
import { family, memoryPair, readSynced, source, subscribe, sync, synced } from "@tinker/sync";

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
 * synced meta plus a todo family, both bound on the source and the viewer
 * scopes; the viewer registers the counter at connect, the source answers
 * with its snapshot, and the tour ends once the value lands on the viewer
 * cell. Answers the bound labels, the member key, the snapshot key, plus
 * the final viewer value. */
export function tour(): Promise<string> {
  const scope = createScope({ tags: [sync(counter), sync(todo)] });
  const bound = scope.resolve(sync.all);
  const names = bound.map((unit) => unit.label).join(",");
  const member = todo("7");
  const key = readSynced(member).key;
  const [left, right] = memoryPair();
  const done = source(scope).connect(left);
  const guest = createScope({ tags: [sync(counter), sync(todo)] });
  const viewing = subscribe(guest, right);
  const settled = new Promise<string>((resolve) => {
    guest.controller(counter).watch((next) => {
      if (next !== 1) return;
      resolve(`${names}:${key}:${key}:${next}`);
    });
  });
  scope.controller(counter).set(1);
  return settled.then((answer) => {
    viewing.close();
    return done.then(() =>
      Promise.all([scope.close({ graceful: true }), guest.close({ graceful: true })]).then(
        () => answer,
      ),
    );
  });
}
