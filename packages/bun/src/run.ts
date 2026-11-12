import type { Scope } from "@tinkered/core";

/**
 * What the host gives a command: its inputs, and the stop. A command picks its own exit codes;
 * a startup throw exits 78 for a config error, else 1, so a command just lets it throw.
 */
export type MainContext = {
  env: Readonly<Record<string, string | undefined>>;
  args: readonly string[];
  /** The folder the process runs in; the host reads it, so commands read no process global. */
  cwd: string;
  signal: AbortSignal;
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  exit: (code: number, reason?: unknown) => void;
};

/** The root close results, app first. A failed root exits 1, else its first teardown error. */
export type MainClosed = Promise<void | Scope.Result | readonly Scope.Result[]>;

/**
 * A command: it builds its root and answers it, or anything with its `closed`. A server command
 * puts `serve` in its root; the host opens no port of its own.
 */
export type Main = (ctx: MainContext) => MainStarted | Promise<MainStarted>;

/** What a command answers: its root, as `createScope` gives it, or its `ready` and `closed`. */
export type MainStarted = { readonly ready?: PromiseLike<unknown>; readonly closed: MainClosed };

/** POSIX exit codes for a stop by signal: 128 plus the signal's number. */
const signalCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;

/** A startup throw of these kinds is a config error: exit 78 (EX_CONFIG). */
const configKinds = ["MissingTag", "MissingConfig", "DataValidationFailed"];

/** The exit code for a startup throw: 78 for a config error or a bad URL, else 1. */
const startCode = (error: unknown) =>
  configKinds.includes(Object(error).kind) || Object(error).code === "ERR_INVALID_URL" ? 78 : 1;

/** The first failure in the root close results, app first: a failed root's error, else its first teardown error. */
const failureOf = (closed: Awaited<MainClosed>) =>
  [closed ?? []]
    .flat()
    .flatMap((end) => (end.status === "failed" ? [end.error] : (end.teardownErrors ?? [])))
    .at(0);

/**
 * Runs one command, and owns OS signals and the exit code (Effect's `runMain`, Go's `main`):
 * - a startup throw exits 78 for a config error (a missing tag or config key, a value that
 *   failed its schema, a bad URL), else 1;
 * - a failed root exits 1; a signal exits 128 + its number;
 * - SIGHUP (a closed terminal) stops it like SIGTERM, so `nohup` does not keep it alive;
 * - a stop during start ends with the stop's own code, and no second line.
 * A command that calls `exit` during start gets that code. The host waits for its root to close.
 */
export async function run(main: Main) {
  const stop = new AbortController();
  let code = 0;
  const exit = (next: number, reason?: unknown) => {
    const { kind, payload } = Object(reason);
    if (kind !== undefined) console.error(`tinker: ${kind} ${JSON.stringify(payload)}`);
    else if (reason !== undefined) console.error(reason);
    code ||= next;
    stop.abort(reason);
  };
  for (const [name, signalCode] of Object.entries(signalCodes)) {
    process.once(name, () => exit(signalCode));
  }

  const failed = (error: unknown) => {
    if (stop.signal.aborted && error === stop.signal.reason) return;
    exit(startCode(error), error);
  };
  const started = await Promise.resolve()
    .then(() =>
      main({
        env: process.env,
        args: process.argv.slice(2),
        cwd: process.cwd(),
        signal: stop.signal,
        stdout: process.stdout,
        stderr: process.stderr,
        exit,
      }),
    )
    .catch(failed);
  if (!started) return process.exit(code);
  // A start that failed was logged once already; its root's close says the same again.
  const ready = await Promise.resolve(started.ready).then(
    () => true,
    (error: unknown) => (failed(error), false),
  );
  const closed = await started.closed;
  const failure = ready ? failureOf(closed) : undefined;
  if (failure !== undefined) exit(1, failure);
  process.exit(code);
}
