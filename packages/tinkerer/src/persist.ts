import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { extension } from "@tinker/core";
import type { Scope } from "@tinker/core";
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

/** An extension that persists one frame's transcript to a JSONL file, one line per message.
 * On each session it seeds the `messages` cell from the file (resume), then appends every new
 * message as it lands. Watching on the session's own handle sees the turn's writes; a write
 * flows down, never up, so the extension reads exactly this session's transcript (ADR 0053). */
export function persist(config: {
  readonly frame: Pick<Tinkerer.Frame, "messages">;
  readonly file: string;
}): Scope.Extension {
  return extension({
    label: "tinkerer.persist",
    session: async (handle, next) => {
      const control = handle.controller(config.frame.messages);
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
