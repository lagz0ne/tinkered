import { resource, tag } from "@tinker/core";
import type { Harness } from "@tinker/harness";

export declare namespace Demo {
  type Options = { id: string; words: string[]; reply: string };
  type Calls = { approval: never; tool: never };
}

const options = tag<Partial<Demo.Options>>({ label: "demo.options" });

/** The nearest binding wins, just as with the live adapters' options. */
function merge(bindings: readonly Partial<Demo.Options>[]): Demo.Options {
  const merged: Demo.Options = { id: "demo", words: [], reply: "" };
  for (const binding of bindings.toReversed()) Object.assign(merged, binding);
  return merged;
}

/** No SDK is loaded: this backend replays the words selected by each namespace. */
const backend = resource({
  label: "demo.backend",
  target: "scope",
  factory: async (): Promise<Harness.Backend<Demo.Options, string, string, Demo.Calls>> => ({
    start: (script, hooks) => ({
      run: async (prompt) => {
        hooks.id(script.id);
        hooks.emit(prompt);
        for (const word of script.words) hooks.text(word);
        return script.reply;
      },
      close: () => undefined,
    }),
  }),
});

export const demo: Harness.Adapter<Demo.Options, string, string, Demo.Calls> = {
  label: "demo",
  options,
  merge,
  resource: backend,
};
