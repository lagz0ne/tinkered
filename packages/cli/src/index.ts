import type { Many, Operation, Scope } from "@tinker/core";
import { createScope, extension, isError as isCoreError, readMany } from "@tinker/core";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

/** The CLI driver is an extension (ADR 0051): `cli(wiring)` installs the routing
 * rows, `scope.resolve(ext)` is `run(argv, io)`, and `runMain` is the root glue
 * over it. Commands are flat rows built by `command` — an operation run in a
 * session as an inline op, or an entry run by hand. */
export declare namespace Cli {
  /** Load the selected command's operation. A dynamic `import` in practice; an
   * eager handle is allowed. Memoized on the row: the first selection runs it,
   * later runs on the same table reuse the operation. */
  export type Load<T, I> = () => Operation.Handle<T, I> | PromiseLike<Operation.Handle<T, I>>;
  /** How a command reads argv and writes stdout. `input` hands raw argv to the
   * operation (its `parse` is the edge); `respond` writes the value. `I`
   * selects the overload (required `input` when the operation takes one). */
  export type Route<T> = {
    readonly input?: (argv: readonly string[]) => unknown;
    readonly respond?: (value: Awaited<T>) => string;
  };
  /** A server-style command: receives argv only. Anything else it needs comes
   * from its defining module's closure — the root that built the wiring. */
  export type Entry = (argv: readonly string[]) => void | PromiseLike<void>;
  /** One wiring row: an operation run in a session as an inline op, or an entry
   * run by hand. Usage lists the names (plus descriptions, when given); help
   * loads nothing either way. */
  export type Row =
    | {
        readonly name: string;
        readonly description?: string;
        readonly load: Load<unknown, unknown>;
        readonly route: {
          readonly input?: (argv: readonly string[]) => unknown;
          readonly respond?: (value: unknown) => string;
        };
      }
    | {
        readonly name: string;
        readonly description?: string;
        readonly entry: Entry;
      };
  /** What the binary is called, which version it answers, which rows it routes. */
  export type Wiring = {
    readonly name: string;
    readonly version: string;
    readonly commands: Many<Row>;
  };
  /** Where output goes. `signal` is the tests' stand-in for SIGINT/SIGTERM: abort
   * it and the scope force-closes, the command settles cancelled, code 130. */
  export type Io = {
    readonly stdout: (s: string) => void;
    readonly stderr: (s: string) => void;
    readonly signal?: AbortSignal;
  };
  /** The mapped outcome: an exit code plus the collected streams. */
  export type Result = {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
  };
  /** Run one command by argv and answer the mapped outcome. The root's scope
   * outlives the run — resolving the extension before `ready` is `NotResolved`. */
  export type Run = (argv: readonly string[], io?: Io) => Promise<Result>;
}

type OpRow = Extract<Cli.Row, { readonly load: Cli.Load<unknown, unknown> }>;

type EntryRow = Extract<Cli.Row, { readonly entry: Cli.Entry }>;

/** Memoize one row's loader: the first selection runs it, later runs reuse the
 * operation. A throw is not cached, so the next selection retries. */
function memo<T, I>(load: Cli.Load<T, I>): Cli.Load<T, I> {
  let settled: Promise<Operation.Handle<T, I>> | undefined;
  return () => {
    const running = settled ?? Promise.resolve(load());
    settled = running;
    running.then(undefined, () => {
      if (settled === running) settled = undefined;
    });
    return running;
  };
}

function commandRow(
  name: string,
  source: Operation.Handle<unknown, unknown> | Cli.Load<unknown, unknown>,
  opts?: Cli.Route<unknown> & { readonly description?: string },
): Cli.Row {
  const load = typeof source === "function" ? source : () => source;
  return {
    name,
    description: opts?.description,
    load: memo(load),
    route: {
      input: opts?.input,
      respond: opts?.respond as ((value: unknown) => string) | undefined,
    },
  };
}

function commandEntry(
  name: string,
  entry: Cli.Entry,
  opts?: { readonly description?: string },
): Cli.Row {
  return { name, description: opts?.description, entry };
}

/** Bind one wiring row: an operation (or its loader — a dynamic `import` in
 * practice, an eager handle is allowed) run in a session when selected, or an
 * entry run by hand. `input` is required when the operation takes one.
 * `command.entry` takes only a direct entry, so a one-parameter function is
 * unambiguous — never a loader. */
export const command: {
  <T>(
    name: string,
    source: Operation.Handle<T, void> | Cli.Load<T, void>,
    opts?: Cli.Route<T> & { readonly description?: string },
  ): Cli.Row;
  <T, I>(
    name: string,
    source: Operation.Handle<T, I> | Cli.Load<T, I>,
    opts: Cli.Route<T> & { readonly input: (argv: readonly string[]) => unknown } & {
      readonly description?: string;
    },
  ): Cli.Row;
  readonly entry: (
    name: string,
    entry: Cli.Entry,
    opts?: { readonly description?: string },
  ) => Cli.Row;
} = Object.assign(commandRow, { entry: commandEntry });

/** The CLI driver, an extension (ADR 0051): `start` resolves its hand once
 * (`await next()`, so a second extension's `start` work is visible), then
 * returns `run`. This `start` is the extension's ONE use of the scope: every
 * command opens a session from the captured root handle, and `io.signal`
 * force-closes that root — the old `wireSignal`, moved inside. The root
 * outlives a run; `runMain` (or the test) closes it. */
export function cli(wiring: Cli.Wiring): Scope.Extension<Cli.Run> {
  const table = readMany(wiring.commands);
  return extension<Cli.Run>({
    label: "cli",
    start: async (scope, _ctx, next) => {
      await next();
      return (argv, io) => answer(scope, wiring, table, argv, io);
    },
  });
}

/** Tell an entry row from an operation row: entries carry `entry`, operations
 * carry `load` — the `in` check is the discriminator, no cast. */
function isEntry(row: Cli.Row): row is EntryRow {
  return "entry" in row;
}

/** Map a command failure to its exit code. Shared by the log line (inside the
 * inline op, where `cancelled` comes from its ctx) and the exit site (in the
 * run, where it comes from `io.signal`) — one rule, two readers. */
function codeOf(error: unknown, cancelled: boolean): number {
  if (cancelled) return 130;
  if (isCoreError(error, "DataValidationFailed")) return 2;
  return 1;
}

const noop = (): void => undefined;

/** Track the abort-time close the scope already owns (close never throws, ADR 0027):
 * the abort listener keeps no awaiter, so attach the shared no-op and never leave an
 * unhandled rejection; the run still awaits the same close through its session. */
function ignoreRejection(promise: Promise<unknown>): void {
  promise.then(noop, noop);
}

/** Run a void-input subflow with no call object. The second cast in the package: a
 * void-input controller's overloaded `run` cannot shed its call shapes generically. */
function runVoid(flow: Scope.OperationController<unknown, unknown>): unknown {
  return (flow.run as () => unknown)();
}

/** Build the command run: the op as a subflow under the command span, the value
 * through `respond`, exactly one `cli command` log line. A failure logs its mapped
 * code then rethrows — the session settles, the run maps again with the same rule. */
function readRun(
  selected: OpRow,
  rest: readonly string[],
): (
  deps: { readonly op: Scope.OperationController<unknown, unknown> },
  ctx: Operation.Ctx<void>,
) => Promise<string | undefined> {
  return ({ op: flow }, ctx) => {
    const started = ctx.clock.currentTimeMillis();
    const span = ctx.obs.span;
    if (span) {
      span.attributes.command = selected.name;
      span.attributes.args = rest;
    }
    const input = selected.route.input;
    const respond = selected.route.respond;
    const answer = async (): Promise<string | undefined> => {
      let value: unknown;
      try {
        const ran = input === undefined ? runVoid(flow) : flow.run({ rawInput: input(rest) });
        value = await ran;
      } catch (error: unknown) {
        ctx.log("cli command", {
          command: selected.name,
          code: codeOf(error, ctx.signal.aborted || error === ctx.signal.reason),
          ms: ctx.clock.currentTimeMillis() - started,
        });
        throw error;
      }
      ctx.log("cli command", {
        command: selected.name,
        code: 0,
        ms: ctx.clock.currentTimeMillis() - started,
      });
      if (respond !== undefined) return respond(value);
      const text = JSON.stringify(value);
      return text === undefined ? undefined : `${text}\n`;
    };
    return answer();
  };
}

/** The process pieces `runMain` needs, read off `globalThis` so the bundle keeps
 * no `node:` import; the extension value never touches the process. */
type Proc = {
  argv: string[];
  exit(code: number): never;
  on(event: string, listener: () => void): unknown;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
};

type Collected = {
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
  readonly result: (code: number) => Cli.Result;
};

function collect(io: Cli.Io | undefined): Collected {
  let out = "";
  let err = "";
  const stdout = (s: string): void => {
    out += s;
    if (io) io.stdout(s);
  };
  const stderr = (s: string): void => {
    err += s;
    if (io) io.stderr(s);
  };
  return { stdout, stderr, result: (code) => ({ code, stdout: out, stderr: err }) };
}

function wireSignal(scope: Scope.Handle, signal: AbortSignal | undefined): () => void {
  const onAbort = (): void => {
    ignoreRejection(scope.close());
  };
  if (signal === undefined) return noop;
  if (signal.aborted) ignoreRejection(scope.close());
  else signal.addEventListener("abort", onAbort, { once: true });
  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}

function usageLine(row: Cli.Row): string {
  if (row.description !== undefined) return `  ${row.name}  ${row.description}`;
  return `  ${row.name}`;
}

function usageText(wiring: Cli.Wiring, table: readonly Cli.Row[]): string {
  const names = table.map(usageLine).sort();
  return [`${wiring.name} ${wiring.version}`, ...names].join("\n") + "\n";
}

function selectCommand(table: readonly Cli.Row[], head: string): Cli.Row {
  const found = table.find((cmd) => cmd.name === head);
  if (found === undefined)
    raise("UnknownCommand", { name: head, known: table.map((cmd) => cmd.name) });
  return found;
}

function answerHead(
  collected: Collected,
  wiring: Cli.Wiring,
  table: readonly Cli.Row[],
  head: string,
): number | undefined {
  if (head === "help") {
    collected.stdout(usageText(wiring, table));
    return 0;
  }
  if (head === "--version") {
    collected.stdout(`${wiring.version}\n`);
    return 0;
  }
  return undefined;
}

type Answer = { readonly code: number; readonly failed: unknown };

async function runEntry(
  signal: AbortSignal | undefined,
  selected: EntryRow,
  rest: readonly string[],
): Promise<Answer> {
  try {
    await selected.entry(rest);
  } catch (error: unknown) {
    if (signal?.aborted === true) return { code: 130, failed: undefined };
    return { code: 1, failed: error };
  }
  if (signal?.aborted === true) return { code: 130, failed: undefined };
  return { code: 0, failed: undefined };
}

function printError(error: unknown): string {
  if (error instanceof Error) return `${error}\n`;
  const text = JSON.stringify(error);
  return `${text === undefined ? "unknown" : text}\n`;
}

async function runOperation(
  scope: Scope.Handle,
  signal: AbortSignal | undefined,
  wiring: Cli.Wiring,
  selected: OpRow,
  rest: readonly string[],
): Promise<{ readonly code: number; readonly text: string | undefined; readonly failed: unknown }> {
  const none = { code: 0, text: undefined, failed: undefined };
  try {
    const loaded = await selected.load();
    const text = await scope.session((s) =>
      s.run({
        label: `${wiring.name} ${selected.name}`,
        depends: { op: loaded },
        run: readRun(selected, rest),
      }),
    );
    return { ...none, text };
  } catch (error: unknown) {
    if (signal?.aborted === true) return { ...none, code: 130 };
    if (isCoreError(error, "DataValidationFailed")) return { ...none, code: 2 };
    return { ...none, code: 1, failed: error };
  }
}

/** Run one command on the extension's scope: route the first argv word through the
 * wiring rows, map the outcome to streams and an exit code. Missing/`help` answers
 * usage (2/0); unknown answers usage to stderr (2); `--version` answers the version
 * (0); a row's loader runs only for the selected command. An operation command runs
 * in a session as an inline op (`<name> <command>` span, one `cli command` line):
 * success prints through `respond` (default JSON, nothing for `undefined`) and exits
 * 0, a parse failure prints usage and exits 2, anything else prints and exits 1, an
 * abort exits 130. An entry command receives argv only: 0, 1 on throw, 130 on abort. */
async function answer(
  scope: Scope.Handle,
  wiring: Cli.Wiring,
  table: readonly Cli.Row[],
  argv: readonly string[],
  io: Cli.Io | undefined,
): Promise<Cli.Result> {
  const collected = collect(io);
  const signal = io?.signal;
  const unhook = wireSignal(scope, signal);
  if (signal?.aborted === true) {
    unhook();
    return { code: 130, stdout: "", stderr: "" };
  }
  if (argv.length === 0) {
    collected.stdout(usageText(wiring, table));
    unhook();
    return collected.result(2);
  }
  const [head, ...rest] = argv;
  const headed = answerHead(collected, wiring, table, head);
  if (headed !== undefined) {
    unhook();
    return collected.result(headed);
  }
  const code = await answerSelected(collected, scope, signal, wiring, table, head, rest);
  unhook();
  return collected.result(code);
}

async function answerSelected(
  collected: Collected,
  scope: Scope.Handle,
  signal: AbortSignal | undefined,
  wiring: Cli.Wiring,
  table: readonly Cli.Row[],
  head: string,
  rest: readonly string[],
): Promise<number> {
  let selected: Cli.Row;
  try {
    selected = selectCommand(table, head);
  } catch (error: unknown) {
    if (!isError(error, "UnknownCommand")) throw error;
    collected.stderr(usageText(wiring, table));
    return 2;
  }
  if (isEntry(selected)) {
    const answered = await runEntry(signal, selected, rest);
    if (answered.failed !== undefined) collected.stderr(printError(answered.failed));
    return answered.code;
  }
  const outcome = await runOperation(scope, signal, wiring, selected, rest);
  if (outcome.text !== undefined) collected.stdout(outcome.text);
  if (outcome.code === 2) collected.stderr(usageText(wiring, table));
  if (outcome.failed !== undefined) collected.stderr(printError(outcome.failed));
  return outcome.code;
}

/** The real entrypoint: root glue over the extension value — install it, `ready`,
 * resolve `run`, wire SIGINT/SIGTERM to an abort the run turns into a forced close
 * (exit 130), then close graceful and `process.exit` with the run's code. Extra
 * scope options (tags, clock, sibling extensions) ride in `scope`. Never returns. */
export async function runMain(wiring: Cli.Wiring, scope?: Scope.Options): Promise<never> {
  const proc: Proc = globalThis.process;
  const ext = cli(wiring);
  const root = createScope({ ...scope, extensions: [scope?.extensions, ext] });
  await root.ready;
  const run = root.resolve(ext);
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  proc.on("SIGINT", abort);
  proc.on("SIGTERM", abort);
  const result = await run(proc.argv.slice(2), {
    stdout: (s) => {
      proc.stdout.write(s);
    },
    stderr: (s) => {
      proc.stderr.write(s);
    },
    signal: controller.signal,
  });
  await root.close({ graceful: true });
  proc.exit(result.code);
}
