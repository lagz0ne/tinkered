import { createScope, isError as isCoreError, tag } from "@tinker/core";
import type { Operation, RunResult, Scope, Tag } from "@tinker/core";
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
  /** A lazy operation: a dynamic `import` in practice. The route's `entry` awaits it on first
   * selection — never for `help` — memoizes the success, and retries after a rejection. */
  export type Load<T, I> = () => Operation.Handle<T, I> | PromiseLike<Operation.Handle<T, I>>;
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
    return readResult(await scope.settle(entry.op), out, cancelled(), opts?.usage);
  } catch (error: unknown) {
    /** Only a failed start or a closed root lands here: `settle` itself never throws. */
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

/** What a settled run answers: its own code, 130 when cancelled (by the signal, or by a forced
 * close from inside the root), else what its failure answers. A panic and a managed error answer
 * the same: the process is the last place to recover. */
function readResult(
  result: RunResult<number>,
  out: Process.Io,
  cancelled: boolean,
  usage: string | undefined,
): number {
  if (result.status === "success") return result.value;
  if (result.status === "cancelled") return 130;
  return readFailure(result.error, out, cancelled, usage);
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

/** A `-` is stdin, a plain word; any other word that starts with `-` is a flag. */
function isFlag(word: string): boolean {
  return word.startsWith("-") && word !== "-";
}

/** The plain words of `argv`, in order. A `--name` is a flag; a flag named in `values` takes
 * the next word as its value; `--name=value` is one word; `--` ends the flags. `-` is plain;
 * a value flag at the end with no next word takes nothing. */
export function positionals(
  argv: readonly string[],
  opts?: { readonly values?: readonly string[] },
): string[] {
  const values = opts?.values ?? [];
  const words: string[] = [];
  let flags = true;
  for (let at = 0; at < argv.length; at += 1) {
    const word = argv[at];
    if (!flags) {
      words.push(word);
      continue;
    }
    if (word === "--") {
      flags = false;
      continue;
    }
    if (!isFlag(word)) {
      words.push(word);
      continue;
    }
    if (values.includes(word)) at += 1;
  }
  return words;
}

/** One value as a JSON line: `undefined` stays `undefined`, so a void value prints nothing.
 * An author who wants the old default output writes `out.write(jsonLine(value))` — through
 * the same guard the sugar used to apply invisibly. */
export function jsonLine(value: unknown): string | undefined {
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
