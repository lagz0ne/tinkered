import { capsule, tag } from "@tinkered/core";

export declare namespace Exits {
  /** Where a page keeps its exits: `localStorage`, or a thing with the same two methods. */
  type Store = Pick<Storage, "getItem" | "setItem">;
}

/**
 * The file the reached exits go to. `tinker check` names it in `TINKER_EXITS` for the tests it
 * runs; outside a check there is none, and the capsule writes nothing.
 */
const file = tag<string>({ label: "tinker.exits.file" });

/**
 * A page has no file: its exits go to this store, under the key `tinker.exits`, as a JSON object
 * of `label<tab>exit` to how many times it was reached. Devtools reads the same key.
 */
const store = tag<Exits.Store>({ label: "tinker.exits.store" });

/** The one key of a store. Each browser key of Tinker starts with `tinker.`. */
const key = "tinker.exits";

/** The exits a store has not got yet. The first one of a task asks for the write. */
const waiting = new WeakMap<Exits.Store, string[]>();

/** One write for every exit that waited: a run never waits for the store. */
function flush(to: Exits.Store) {
  const counts: Record<string, number> = JSON.parse(to.getItem(key) ?? "{}");
  for (const line of waiting.get(to) ?? []) counts[line] = (counts[line] ?? 0) + 1;

  waiting.delete(to);
  to.setItem(key, JSON.stringify(counts));
}

function keep(to: Exits.Store, line: string) {
  const lines = waiting.get(to);
  if (lines) return void lines.push(line);

  waiting.set(to, [line]);
  queueMicrotask(() => flush(to));
}

/** `node:fs` by name at the first write, so a page that passes no `file` never loads it. */
function append(to: string, line: string) {
  process.getBuiltinModule("node:fs").appendFileSync(to, `${line}\n`);
}

/**
 * Core marks a refusal with a symbol it does not export, so its description is the one sign a
 * capsule has. This look goes when Core says a run's exit itself.
 */
function isRefusal(value: object) {
  return Object.getOwnPropertySymbols(value).some(({ description }) => description === "refused");
}

/** A run's exit, in the words `tinker check` reads from the types: a `kind`, `refused`, `value`. */
function exitOf(value: unknown) {
  if (typeof value !== "object" || value === null) return "value";
  if (isRefusal(value)) return "refused";
  return "kind" in value && typeof value.kind === "string" ? value.kind : "value";
}

/**
 * Put this first in a test scope's `capsules`. A server test passes
 * `{ file: process.env.TINKER_EXITS }`; a page passes `{ store: localStorage }`. It keeps the exit
 * of each operation run, and `tinker check` then names each declared exit that no test reached.
 * A run that throws reaches no exit.
 */
export const exits = capsule({
  label: "tinker.exits",
  config: { file: file.optional, store: store.optional },
  hooks: {
    run(event) {
      const { file: to, store: page } = event.config;
      const label = "label" in event.op ? event.op.label : undefined;
      if (!label || (!to.present && !page.present)) return event.next();

      const say = (value: unknown) => {
        const line = `${label}\t${exitOf(value)}`;
        if (to.present) append(to.value, line);
        if (page.present) keep(page.value, line);
        return value;
      };
      const out = event.next();
      return out instanceof Promise ? out.then(say) : say(out);
    },
  },
});
