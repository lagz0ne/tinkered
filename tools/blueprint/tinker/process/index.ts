import { createScope, isError as isCoreError, tag } from "@tinker/core";
import type { Operation, RunResult, Scope, Tag } from "@tinker/core";
import { isError, raise } from "./errors";
import type { Errors } from "./errors";

export declare namespace Process {
  /** Borrowed writers; callers choose whether to collect or stream their output. */
  export type Io = {
    readonly write: (text: string) => void;
    readonly error: (text: string) => void;
  };
  export type Command = Operation.Handle<number | Promise<number>, void>;
  export type Entry =
    | { readonly kind: "command"; readonly op: Command; readonly options?: Scope.Options }
    | { readonly kind: "service"; readonly options: Scope.Options };
  /** Loading supplies graph units and config only. Services start through extensions. */
  export type Route = {
    readonly name: string;
    readonly description?: string;
    readonly entry: (input: {
      readonly args: readonly string[];
      readonly signal?: AbortSignal;
    }) => Entry | PromiseLike<Entry>;
  };
  export type Shell = {
    readonly name: string;
    readonly version: string;
    readonly commands: readonly Route[];
  };
  export type RunOptions = {
    readonly shell: Shell;
    readonly args: readonly string[];
    readonly io: Io;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly signal?: AbortSignal;
    readonly options?: Scope.Options;
  };
  export type MainOptions = {
    readonly shell: Shell;
    readonly args?: readonly string[];
    readonly options?: Scope.Options;
  };
}

/** Arguments after the selected route name, bound once per run. */
export const argv: Tag.Handle<readonly string[]> = tag({ label: "process.argv" });

/** Environment values supplied by the caller; `run` never reads the host environment. */
export const env: Tag.Handle<Readonly<Record<string, string | undefined>>> = tag({
  label: "process.env",
});

export const io: Tag.Handle<Process.Io> = tag({ label: "process.io" });
/** Borrowed request to stop the root gracefully, including EOF during service start. */
export const stop: Tag.Handle<() => void> = tag({ label: "process.stop" });

/** Own one root from start through cleanup. Command aborts force-close that root so data
 * stays on its owner; a Core call signal would instead fork a child session. */
async function execute(entry: Process.Entry, input: Process.RunOptions): Promise<number> {
  const cancelled = (): boolean => input.signal?.aborted === true;
  if (cancelled()) return 130;
  const ended = new AbortController();
  const scope = createScope({
    ...input.options,
    ...entry.options,
    signal: ended.signal,
    tags: processBindings(entry, input, () => ended.abort()),
  });
  let stopping: Promise<Scope.Result> | undefined;
  const abort = (): void => {
    if (entry.kind === "command") stopping = scope.close();
    else ended.abort();
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  if (cancelled()) abort();
  let code = 0;
  try {
    await scope.ready;
    if (entry.kind === "command") {
      code = readResult(await scope.settle(entry.op), input);
    }
  } catch (error: unknown) {
    code = readFailure(error, input);
  } finally {
    if (entry.kind === "command") ended.abort();
  }
  const result = await scope.closed;
  await stopping;
  input.signal?.removeEventListener("abort", abort);
  return readClosed(result, code, input.io);
}

function processBindings(
  entry: Process.Entry,
  input: Process.RunOptions,
  requestStop: () => void,
): Tag.Bindings {
  return [
    argv(input.args),
    env(input.env ?? {}),
    io(input.io),
    stop(requestStop),
    input.options?.tags,
    entry.options?.tags,
  ];
}

function readClosed(result: Scope.Result, code: number, out: Process.Io): number {
  if (code === 0 && result.status === "failed") {
    out.error(printError(result.error));
    code = 1;
  }
  for (const error of result.teardownErrors ?? []) {
    out.error(printError(error));
    if (code === 0) code = 1;
  }
  return code;
}

function readResult(result: RunResult<number>, input: Process.RunOptions): number {
  if (result.status === "success") return result.value;
  if (result.status === "cancelled") return 130;
  return readFailure(result.error, input);
}

function readFailure(error: unknown, input: Process.RunOptions): number {
  if (input.signal?.aborted) return 130;
  if (isCoreError(error, "DataValidationFailed")) {
    input.io.error(usageOf(input.shell));
    return 2;
  }
  input.io.error(printError(error));
  return 1;
}

/** Race only the wait, not the load. Promise.race observes a loader's later rejection even
 * after cancellation has returned. Remove the listener on either outcome. */
async function loadEntry(
  route: Process.Route,
  args: readonly string[],
  signal: AbortSignal | undefined,
): Promise<Process.Entry | undefined> {
  let abort!: () => void;
  const cancelled = new Promise<undefined>((resolve) => {
    abort = () => resolve(undefined);
  });
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([route.entry({ args, signal }), cancelled]);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

/** Route without a root, then await the selected entry and its cleanup. Output stays with
 * the supplied writers; this function reads no host process facts. */
export async function run(input: Process.RunOptions): Promise<number> {
  const { shell, args, io: out, signal } = input;
  const cancelled = (): boolean => signal?.aborted === true;
  if (cancelled()) return 130;
  const [name, ...rest] = args;
  if ([undefined, "help", "--help"].includes(name)) {
    out.write(usageOf(shell));
    return 0;
  }
  if (name === "--version") {
    out.write(`${shell.version}\n`);
    return 0;
  }
  const route = shell.commands.find((row) => row.name === name);
  if (route === undefined) {
    out.error(usageOf(shell));
    return 2;
  }
  let entry: Process.Entry | undefined;
  try {
    entry = await loadEntry(route, rest, signal);
  } catch (error: unknown) {
    if (cancelled()) return 130;
    out.error(printError(error));
    return 1;
  }
  if (entry === undefined) return 130;
  return execute(entry, { ...input, args: rest });
}

export function usageOf(shell: Process.Shell): string {
  const rows = [...shell.commands]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((row) =>
      row.description === undefined ? `  ${row.name}` : `  ${row.name}  ${row.description}`,
    );
  return `usage: ${shell.name} <command>\n${rows.join("\n")}\n`;
}

/** Read the optional process without adding a Node import to the package. */
type Proc = {
  argv: string[];
  env: Record<string, string | undefined>;
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
};

/** The app sets `process.exitCode` from this result so pending stream writes can finish.
 * Both listeners leave after the first stop: a second OS signal uses its normal action. */
export async function main({ shell, args, options }: Process.MainOptions): Promise<number> {
  const proc = (globalThis as { process?: Proc }).process;
  if (proc === undefined) raise("NoProcess", { reason: "main needs a process to read argv" });
  const controller = new AbortController();
  const remove = (): void => {
    proc.removeListener("SIGINT", abort);
    proc.removeListener("SIGTERM", abort);
  };
  const abort = (): void => {
    remove();
    controller.abort();
  };
  proc.on("SIGINT", abort);
  proc.on("SIGTERM", abort);
  try {
    return await run({
      shell,
      args: args ?? proc.argv.slice(2),
      env: { ...proc.env },
      options,
      io: {
        write: (text) => void proc.stdout.write(text),
        error: (text) => void proc.stderr.write(text),
      },
      signal: controller.signal,
    });
  } finally {
    remove();
  }
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
