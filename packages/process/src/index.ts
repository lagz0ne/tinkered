import { createScope, isError as isCoreError, operation, tag } from "@tinker/core";
import type { Operation, Scope, Tag } from "@tinker/core";
import { isError, raise } from "./errors.ts";
import type { Errors } from "./errors.ts";

export declare namespace Process {
  /** Where a run writes. Bound as the `io` tag; a test binds a collector, `main` binds the process. */
  export type Io = {
    readonly write: (s: string) => void;
    readonly error: (s: string) => void;
  };
  /** A command: an operation that answers an exit code. What it needs (argv, env, io) it declares. */
  export type Command = Operation.Handle<number | Promise<number>, void>;
  /** What routing answers for one command and its args: the operation plus anything its root
   * needs beyond the process tags. A flag that must be a tag is bound here, before any scope. */
  export type Entry = {
    readonly op: Command;
    readonly options?: Scope.Options;
  };
  /** One routed command. `entry` runs only after routing, so `help` loads nothing. */
  export type Route = {
    readonly name: string;
    readonly description?: string;
    readonly entry: (rest: readonly string[]) => Entry | PromiseLike<Entry>;
  };
  /** A lazy operation: a dynamic `import` in practice, run once per route. */
  export type Load<T, I> = () => Operation.Handle<T, I> | PromiseLike<Operation.Handle<T, I>>;
  /** How a command over a plain operation reads argv and writes its value: `input` hands raw
   * argv to the operation's own parse; `respond` maps the value to text (default: one JSON line). */
  export type Sugar<T> = {
    readonly input?: (argv: readonly string[]) => unknown;
    readonly respond?: (value: Awaited<T>) => string;
    readonly description?: string;
    readonly options?: Scope.Options;
  };
  /** A binary: its name, version, and routes. */
  export type Shell = {
    readonly name: string;
    readonly version: string;
    readonly commands: readonly Route[];
  };
  /** What a run answers: the exit code and the collected streams. */
  export type Result = {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
  };
}

/** The arguments after the command name, bound once per run. */
export const argv: Tag.Handle<readonly string[]> = tag({ label: "process.argv" });
/** The process environment, bound once per run. */
export const env: Tag.Handle<Readonly<Record<string, string | undefined>>> = tag({
  label: "process.env",
});
/** The run's writers. No `signal` tag: every operation has `ctx.signal`, and a run turns its
 * abort into a forced close of the root. */
export const io: Tag.Handle<Process.Io> = tag({ label: "process.io" });

/** The one place a root exists for a command: build it from the entry's options plus the
 * process tags, run the operation, close, answer the code. An abort force-closes the root, so
 * every `ctx.signal` below fires; the operation decides what that means by returning (a server:
 * 0) or by letting the cancellation throw (a one-shot: 130). A parse failure is a usage error. */
export async function execute(
  entry: Process.Entry,
  rest: readonly string[],
  out: Process.Io,
  opts?: { readonly signal?: AbortSignal; readonly usage?: string },
): Promise<number> {
  const signal = opts?.signal;
  /** Read through a call, never a narrowed constant: the signal may abort mid-run. */
  const cancelled = (): boolean => signal?.aborted === true;
  if (cancelled()) return 130;
  const scope = rootFor(entry, rest, out);
  const stop = (): void => void scope.close();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await scope.ready;
    return await scope.run(entry.op);
  } catch (error: unknown) {
    return readFailure(error, out, cancelled(), opts?.usage);
  } finally {
    signal?.removeEventListener("abort", stop);
    await scope.close({ graceful: !cancelled() });
  }
}

/** One root for one command: the entry's own options plus the three process tags. */
function rootFor(entry: Process.Entry, rest: readonly string[], out: Process.Io): Scope.Handle {
  return createScope({
    ...entry.options,
    tags: [argv(rest), env(readEnv()), io(out), entry.options?.tags],
  });
}

/** What a failed run answers: a cancelled run is 130, a parse failure is a usage error (2),
 * anything else prints and is 1. */
function readFailure(
  error: unknown,
  out: Process.Io,
  cancelled: boolean,
  usage: string | undefined,
): number {
  if (cancelled) return 130;
  if (isCoreError(error, "DataValidationFailed")) {
    if (usage !== undefined) out.error(usage);
    return 2;
  }
  out.error(printError(error));
  return 1;
}

/** A command over a plain operation: one subflow with the argv parsed by the operation's own
 * `input`, its value written through `respond`, exit 0; one `command` log line. Keeps ADR 0042:
 * a command is an operation. A loader runs once, on first selection — never for `help`. */
export function command<T, I>(
  name: string,
  source: Operation.Handle<T, I> | Process.Load<T, I>,
  sugar: Process.Sugar<T> = {},
): Process.Route {
  let loaded: Promise<Operation.Handle<T, I>> | undefined;
  /** Memoized on success only: a rejected load is not cached, so the next run retries it. */
  const load = (): Promise<Operation.Handle<T, I>> => {
    loaded ??= Promise.resolve(typeof source === "function" ? source() : source).catch(
      (error: unknown) => {
        loaded = undefined;
        throw error;
      },
    );
    return loaded;
  };
  return {
    name,
    description: sugar.description,
    entry: async () => ({ op: readCommand(name, await load(), sugar), options: sugar.options }),
  };
}

function readCommand<T, I>(
  name: string,
  target: Operation.Handle<T, I>,
  sugar: Process.Sugar<T>,
): Process.Command {
  return operation({
    label: name,
    depends: { argv: argv.required, io: io.required, op: target },
    run: async ({ argv: args, io: out, op: flow }, ctx) => {
      const started = ctx.clock.currentTimeMillis();
      const value = (await (sugar.input === undefined
        ? (flow as { run(): T }).run()
        : flow.run({ rawInput: sugar.input(args) }))) as Awaited<T>;
      const text = sugar.respond === undefined ? readJsonLine(value) : sugar.respond(value);
      if (text !== undefined) out.write(text);
      ctx.log("command", { command: name, code: 0, ms: ctx.clock.currentTimeMillis() - started });
      return 0;
    },
  });
}

/** Route by plain lookup, answer help and version without a root, then execute. The seam a
 * test uses: pass a collecting `io`, read the `Result`; nothing touches the process. */
export async function run(
  shell: Process.Shell,
  args: readonly string[],
  given?: Partial<Process.Io>,
  signal?: AbortSignal,
): Promise<Process.Result> {
  let stdout = "";
  let stderr = "";
  const out: Process.Io = {
    write: (s) => {
      stdout += s;
      given?.write?.(s);
    },
    error: (s) => {
      stderr += s;
      given?.error?.(s);
    },
  };
  const done = (code: number): Process.Result => ({ code, stdout, stderr });
  const usage = usageOf(shell);
  const [name, ...rest] = args;
  if (name === undefined || name === "help" || name === "--help") {
    out.write(usage);
    return done(0);
  }
  if (name === "--version") {
    out.write(`${shell.version}\n`);
    return done(0);
  }
  const route = shell.commands.find((row) => row.name === name);
  if (route === undefined) {
    out.error(usage);
    return done(2);
  }
  let entry: Process.Entry;
  try {
    entry = await route.entry(rest);
  } catch (error: unknown) {
    out.error(printError(error));
    return done(1);
  }
  return done(await execute(entry, rest, out, { signal, usage }));
}

/** The usage text: the binary's name, then every route sorted by name with its description. */
export function usageOf(shell: Process.Shell): string {
  const rows = [...shell.commands]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((row) =>
      row.description === undefined ? `  ${row.name}` : `  ${row.name}  ${row.description}`,
    );
  return `usage: ${shell.name} <command>\n${rows.join("\n")}\n`;
}

/** The process pieces `main` needs, read off `globalThis` so the bundle keeps no `node:` import. */
type Proc = {
  argv: string[];
  env: Record<string, string | undefined>;
  exit(code: number): never;
  on(event: string, listener: () => void): unknown;
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
};

function readProc(): Proc | undefined {
  return (globalThis as { process?: Proc }).process;
}

function readEnv(): Readonly<Record<string, string | undefined>> {
  return readProc()?.env ?? {};
}

/** The process edge and the only side effect in this package: read argv, wire SIGINT and
 * SIGTERM to one abort, run, exit with the code. Never returns. */
export async function main(shell: Process.Shell, args?: readonly string[]): Promise<never> {
  const proc = readProc();
  if (proc === undefined)
    raise("NoProcess", { reason: "main needs a process to read argv and exit" });
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  proc.on("SIGINT", abort);
  proc.on("SIGTERM", abort);
  const result = await run(
    shell,
    args ?? proc.argv.slice(2),
    { write: (s) => void proc.stdout.write(s), error: (s) => void proc.stderr.write(s) },
    controller.signal,
  );
  return proc.exit(result.code);
}

function readJsonLine(value: unknown): string | undefined {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : `${text}\n`;
}

function printError(error: unknown): string {
  if (error instanceof Error) return `${error}\n`;
  const text = JSON.stringify(error);
  return `${text === undefined ? "unknown" : text}\n`;
}

export { isError };
export type { Errors };
