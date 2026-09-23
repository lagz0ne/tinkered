import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { extension } from "@tinker/core";
import type { Namespace, Scope } from "@tinker/core";
import type { Tinkerer } from "./index.ts";

/** Read a JSONL transcript file into messages: one message per non-empty line. A missing file
 * reads as an empty transcript. The file is our own, written by {@link persist}. */
export function restore(file: string): readonly Tinkerer.Message[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Tinkerer.Message);
}

/** Persist one coder's transcript in a JSONL file. Set `ns` when several coders share a
 * frame and a session; each coder needs its own file. Without `ns`, use the session's ambient
 * namespace. Watching on the session's handle sees that session's writes (ADR 0053). */
export function persist(config: {
  readonly frame: Pick<Tinkerer.Frame, "messages">;
  readonly file: string;
  readonly ns?: Namespace;
}): Scope.Extension {
  return extension({
    label: "tinkerer.persist",
    session: async (handle, next) => {
      const control =
        config.ns === undefined
          ? handle.controller(config.frame.messages)
          : handle.controller(config.frame.messages, { ns: config.ns });
      const seeded = restore(config.file);
      if (seeded.length > 0) control.set(seeded);
      let written = seeded.length;
      const stop = control.watch((list) => {
        for (const message of list.slice(written)) {
          appendFileSync(config.file, `${JSON.stringify(message)}\n`);
        }
        written = list.length;
      });
      const ended = await next();
      stop();
      return ended;
    },
  });
}
