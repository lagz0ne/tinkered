import { createScope } from "@tinker/core";
import { stop } from "@tinker/process";
import { searchMcp } from "./search.ts";
import { stdio, streams, type Stdio } from "./stdio.ts";

/** End on input EOF, transport close, or the caller's stop signal, after all cleanup. */
export async function runServer(
  io: Stdio.Streams,
  signal: AbortSignal,
  report: (error: unknown) => void = () => undefined,
): Promise<number> {
  const ended = new AbortController();
  const root = createScope({
    extensions: [stdio, searchMcp],
    tags: [streams(io), stop(() => ended.abort())],
    signal: AbortSignal.any([signal, ended.signal]),
  });
  try {
    await root.ready;
  } catch (error) {
    report(error);
    await root.closed;
    return 1;
  }
  const end = await root.closed;
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
  const ended = new AbortController();
  const abort = (): void => ended.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    process.exitCode = await runServer(
      { input: process.stdin, output: process.stdout },
      ended.signal,
      (error) => process.stderr.write(`${String(error)}\n`),
    );
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
