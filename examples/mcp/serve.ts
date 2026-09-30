import { createScope, extension, tag, type Scope } from "@tinker/core";
import { searchMcp } from "./search.ts";
import { stdio, stopping, streams, type Stdio } from "./stdio.ts";

const requestStop = tag<() => void>({ label: "stdio.requestStop" });
const untilInputEnds = extension({
  label: "stdio.untilInputEnds",
  hooks: {
    start: async (event) => {
      await event.next();
      const stop = event.resolve(requestStop);
      const stopped = event.controller(stopping);
      event.defer(
        stopped.watch((value) => {
          if (value) stop();
        }),
      );
      if (stopped.get()) stop();
    },
  },
});

/** End on input EOF, transport close, or the caller's stop signal, after all cleanup. */
export async function runServer(
  io: Stdio.Streams,
  signal: AbortSignal,
  report: (error: unknown) => void = () => undefined,
): Promise<number> {
  const ended = new AbortController();
  const root = createScope({
    extensions: [untilInputEnds, stdio, searchMcp],
    tags: [streams(io), requestStop(() => ended.abort())],
    signal: AbortSignal.any([signal, ended.signal]),
  });
  let end: Scope.Result;
  try {
    await root.ready;
    await root.closed;
  } catch (error) {
    report(error);
    return 1;
  } finally {
    ended.abort();
    end = await root.closed;
  }
  let exitCode = 0;
  if (end.status === "failed") {
    report(end.error);
    exitCode = 1;
  }
  for (const error of end.teardownErrors ?? []) {
    report(error);
    exitCode = 1;
  }
  return exitCode;
}

if (import.meta.main) {
  const stop = new AbortController();
  const abort = (): void => stop.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    process.exitCode = await runServer(
      { input: process.stdin, output: process.stdout },
      stop.signal,
      (error) => process.stderr.write(`${String(error)}\n`),
    );
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
