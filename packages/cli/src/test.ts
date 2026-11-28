import type { AsyncLocalStorage } from "node:async_hooks";

import { capsule, tag } from "@tinkered/core";

import { raise } from "./errors";
import { emptyOf, none } from "./mutant";
import type { Mutant } from "./mutant";

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

/** An env value; a page has no `process`, so it has none. */
function envOf(name: string) {
  return typeof process === "undefined" ? undefined : process.env[name];
}

/**
 * What `tinker pins` asks of this run (ADR 0173): `trace` is the file each fact goes to, and
 * `fault` the one mutant to put in. Both come from env values that only `tinker pins` sets.
 */
type Pins = { trace?: string; fault?: Mutant.Fault };

/** The last `TINKER_MUTANT` text and its fault: each run reads the env, few parse it. */
let parsed: { text: string; fault: Mutant.Fault } | undefined;

function faultOf(text: string): Mutant.Fault {
  if (parsed?.text !== text) parsed = { text, fault: JSON.parse(text) };
  return parsed.fault;
}

function pinsOf(): Pins | undefined {
  const trace = envOf("TINKER_TRACE");
  const mutant = envOf("TINKER_MUTANT");
  if (!trace && !mutant) return undefined;
  return { ...(trace ? { trace } : {}), ...(mutant ? { fault: faultOf(mutant) } : {}) };
}

/**
 * The label of the innermost operation running. Made at the first traced run, by name, so a
 * page build and a run with neither env value never load `node:async_hooks`.
 */
let where: AsyncLocalStorage<string> | undefined;

function placeOf() {
  where ??= new (process.getBuiltinModule("node:async_hooks").AsyncLocalStorage)();
  return where;
}

/** The trace lines each file has: a fact goes once to a file. */
const noted = new Set<string>();

function note(trace: string | undefined, line: string) {
  if (!trace || noted.has(`${trace}\n${line}`)) return;
  noted.add(`${trace}\n${line}`);
  append(trace, line);
}

/**
 * Enter `label`'s run: a call of it from the op around it is a fact, and a `fail` mutant of
 * that call throws here, before the run starts.
 */
function enter({ trace, fault }: Pins, label: string, next: () => unknown) {
  const place = placeOf();
  const caller = place.getStore();
  if (caller) note(trace, `call\t${caller}\t${label}`);
  if (fault?.kind === "fail" && fault.op === caller && fault.callee === label) {
    raise("Mutant", { op: caller, callee: label });
  }
  return place.run(label, next);
}

/** The exit a run reached, and the first answer of each exit as its sample. */
function trail(trace: string, label: string, exit: string, value: unknown) {
  note(trace, `exit\t${label}\t${exit}`);
  const key = `${trace}\nsample\t${label}\t${exit}`;
  if (noted.has(key)) return;

  noted.add(key);
  append(trace, `sample\t${label}\t${exit}\t${JSON.stringify(value) ?? "null"}`);
}

/** The answer a `swap` or an `empty` mutant gives where `label` reached its `from`. */
function answer({ trace, fault }: Pins, label: string, exit: string, value: unknown) {
  if (trace) trail(trace, label, exit, value);

  if (fault?.op !== label || !("from" in fault) || exit !== fault.from) return value;
  if (fault.kind === "swap") return structuredClone(fault.value);
  const twin = emptyOf(value);
  return twin === none ? value : twin;
}

/**
 * Put this first in a test scope's `capsules`. A server test passes
 * `{ file: process.env.TINKER_EXITS }`; a page passes `{ store: localStorage }`. It keeps the exit
 * of each operation run, and `tinker check` then names each declared exit that no test reached.
 * A run that throws reaches no exit.
 *
 * `tinker pins` sets `TINKER_TRACE` or `TINKER_MUTANT` (ADR 0173): the capsule then writes
 * each exit, write and call a run reaches, or puts in the one fault it names. With neither, it
 * does only the above.
 */
export const exits = capsule({
  label: "tinker.exits",
  config: { file: file.optional, store: store.optional },
  hooks: {
    run(event) {
      const { file: to, store: page } = event.config;
      const label = "label" in event.op ? event.op.label : undefined;
      const pins = pinsOf();
      if (!label || (!to.present && !page.present && !pins)) return event.next();

      const say = (value: unknown) => {
        const exit = exitOf(value);
        if (to.present) append(to.value, `${label}\t${exit}`);
        if (page.present) keep(page.value, `${label}\t${exit}`);
        return pins ? answer(pins, label, exit, value) : value;
      };
      const out = pins ? enter(pins, label, () => event.next()) : event.next();
      return out instanceof Promise ? out.then(say) : say(out);
    },
    write(event) {
      const pins = pinsOf();
      if (!pins) return event.next();

      const op = placeOf().getStore() ?? "-";
      const cell = event.cell.label;
      note(pins.trace, `write\t${op}\t${cell}`);
      const { fault } = pins;
      if (fault?.kind === "drop" && fault.op === op && fault.cell === cell) return;
      event.next();
    },
  },
});
