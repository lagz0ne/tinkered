import { appendFileSync } from "node:fs";

import { capsule, tag } from "@tinkered/core";

/**
 * The file the reached exits go to. `tinker check` names it in `TINKER_EXITS` for the tests it
 * runs; outside a check there is none, and the capsule writes nothing.
 */
const file = tag<string | undefined>({ label: "tinker.exits.file" });

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
 * Put this first in a test scope's `capsules`: `exits({ file: process.env.TINKER_EXITS })`. It
 * writes the exit of each operation run, and `tinker check` then names each declared exit that no
 * test reached. A run that throws reaches no exit.
 */
export const exits = capsule({
  label: "tinker.exits",
  config: { file },
  hooks: {
    run(event) {
      const to = event.config.file;
      const label = "label" in event.op ? event.op.label : undefined;
      if (!to || !label) return event.next();

      const say = (value: unknown) => {
        appendFileSync(to, `${label}\t${exitOf(value)}\n`);
        return value;
      };
      const out = event.next();
      return out instanceof Promise ? out.then(say) : say(out);
    },
  },
});
