import type { Observe } from "@tinker/core";

/** Read a thrown value as plain fields a log line can carry: a registry error
 * gives its `kind` and `payload`, any `Error` its name, message, and stack,
 * anything else is printed as-is. */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error: String(error) };
  const fields: Record<string, unknown> = { error: error.message, name: error.name };
  if ("kind" in error) fields.kind = error.kind;
  if ("payload" in error) fields.payload = error.payload;
  if (error.stack !== undefined) fields.stack = error.stack;
  if (error.cause !== undefined) fields.cause = describeError(error.cause);
  return fields;
}

/** One JSON object per line for a `write` (stdout in `main.ts`): every log line
 * as `{ kind: "log", ... }`, and every failed span as `{ kind: "span", ... }` — an
 * ok span is a trace, and a trace is what a tracing backend is for. This is the
 * one place a logging or tracing backend swaps in: hand `createApp` another
 * `Observe.Config` and nothing else in the app changes. A `write` that throws
 * loses that one line; core isolates the sink. */
export function jsonLines(write: (line: string) => void): Observe.Config {
  return {
    log: (entry) => {
      write(
        JSON.stringify({
          kind: "log",
          time: entry.time,
          message: entry.message,
          span: entry.span?.id,
          ...entry.attributes,
        }),
      );
    },
    export: (span) => {
      if (span.status !== "failed") return;
      write(
        JSON.stringify({
          kind: "span",
          id: span.id,
          parent: span.parentId,
          name: span.name,
          unit: span.kind,
          start: span.start,
          end: span.end,
          status: span.status,
          ...span.attributes,
          events: span.events,
        }),
      );
    },
  };
}
