import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { data, extension, resource, tag } from "@tinker/core";
import type { Namespace, Resource, Scope, Tag } from "@tinker/core";
import type { Tinkerer } from "./index.ts";

export declare namespace Persistence {
  export type Handle = {
    readonly file: Tag.Handle<string>;
    /** Resolve before a direct read or update in a namespace that has not run yet.
     * Setup restores messages and owns one watch until the session closes. */
    readonly transcript: Resource.Handle<void>;
    readonly extension: Scope.Extension;
  };
}

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
  const { transcript } = declareTranscript(config);
  return extension({
    label: "tinkerer.persist",
    hooks: {
      session(event) {
        event.resolve(transcript, config.ns === undefined ? undefined : { ns: config.ns });
        return event.next();
      },
    },
  });
}

/** Declare one persistence graph. Namespace tags choose each file; a namespace without a
 * file does not save messages. Sessions, runs, and direct writes prepare their own transcript.
 * Reads do not prepare it: resolve `transcript` before a direct read or update in a namespace
 * that has not been prepared. A direct set still replaces the whole message list. */
export function persistence(config: {
  readonly frame: Pick<Tinkerer.Frame, "messages">;
}): Persistence.Handle {
  const { file, transcript, restoring } = declareTranscript(config);
  return {
    file,
    transcript,
    extension: extension({
      label: "tinkerer.persistence",
      hooks: {
        session(event) {
          event.resolve(transcript);
          return event.next();
        },
        run(event) {
          event.resolve(transcript);
          return event.next();
        },
        write(event) {
          if (event.cell === config.frame.messages && !event.resolve(restoring)) {
            event.resolve(transcript);
          }
          return event.next();
        },
      },
    }),
  };
}

function declareTranscript(config: {
  readonly frame: Pick<Tinkerer.Frame, "messages">;
  readonly file?: string;
}) {
  const file = tag<string>({ label: "tinkerer.persist.file" });
  const restoring = data({ label: "tinkerer.persist.restoring", initial: false });
  const transcript = resource({
    label: "tinkerer.persist.transcript",
    target: "session",
    depends: {
      messages: config.frame.messages.controller,
      file: file.optional,
      restoring: restoring.controller,
    },
    factory: ({ messages, file, restoring }, ctx) => {
      const path = file.present ? file.value : config.file;
      if (path === undefined) return;
      const seeded = restore(path);
      if (seeded.length > 0) {
        restoring.set(true);
        try {
          messages.set(seeded);
        } finally {
          restoring.set(false);
        }
      }
      let written = seeded.length;
      const stop = messages.watch((list) => {
        for (const message of list.slice(written)) {
          appendFileSync(path, `${JSON.stringify(message)}\n`);
        }
        written = list.length;
      });
      ctx.defer(stop);
    },
  });
  return { file, transcript, restoring };
}
