import type { Operation, Resource, Scope, Tag } from "@tinker/core";
import { createScope, isError as isCoreError, tag } from "@tinker/core";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

/** The routing table and the entrypoint driver: commands are tag bindings on the
 * scope, `run` routes argv to the selected one, `runMain` adds the process. */
export declare namespace Cli {
  /** Load the selected command's operation. A dynamic `import` in practice; an
   * eager handle is allowed. Runs once per `run` — a process runs one command. */
  export type Load<T, I> = () => Operation.Handle<T, I> | PromiseLike<Operation.Handle<T, I>>;
  /** A resource that delivers the selected command's operation when the scope
   * builds it. A lazy module in the house shape: `resource({ label, factory:
   * () => import("./x.ts").then((m) => m.op) })` — built once per scope, so a
   * second `run` on the same scope does not re-import, and the build opens a
   * `resource` span named by the resource's label (the "lazy module is a resource"
   * half of ADR 0042; the value arrives through `scope.resolve`, ADR 0044). */
  export type Module<T, I> = Resource.Handle<
    Operation.Handle<T, I> | PromiseLike<Operation.Handle<T, I>>
  >;
  /** How a command reads argv and writes stdout. `input` hands raw argv to the
   * operation (its `parse` is the edge); `respond` writes the value. `I`
   * selects the overload (required `input` when the operation takes one). */
  export type Route<T> = {
    readonly input?: (argv: readonly string[]) => unknown;
    readonly respond?: (value: Awaited<T>) => string;
  };
  /** A server-style command: receives the scope itself (it is `main`), so it can
   * mount drivers and resolve resources. No session, no span. */
  export type Entry = (scope: Scope.Handle, argv: readonly string[]) => void | PromiseLike<void>;
  /** A resource that delivers an entry command when the scope builds it. */
  export type EntryModule = Resource.Handle<Entry | PromiseLike<Entry>>;
  /** One entry source: a loader function, or a resource that delivers the entry. */
  export type EntrySource = (() => Entry | PromiseLike<Entry>) | EntryModule;
  /** One row of the routing table: an operation run in a session as an inline op,
   * or an entry wired by hand. Each row carries one source: `load` (a function,
   * called once for the selected command) or `module` (a resource handle,
   * resolved through the scope `run` owns — cached per scope, observable
   * as a `resource` span). Usage lists the bound names; help loads nothing
   * either way. */
  export type Command =
    | {
        readonly name: string;
        readonly kind: "operation";
        readonly route: Route<unknown>;
        readonly source: Load<unknown, unknown> | Module<unknown, unknown>;
      }
    | {
        readonly name: string;
        readonly kind: "entry";
        readonly source: EntrySource;
      };
  /** What the binary is called, which version it answers, which scope it builds. */
  export type Options = {
    readonly name: string;
    readonly version: string;
    readonly scope?: Scope.Options;
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
}

/** The routing table: every bound command, read through `commands.all` from the
 * scope `run` creates. Usage lists the bound names; help loads nothing. */
export const commands: Tag.Handle<Cli.Command> = tag({ label: "cli.command" });

function commandOp<T>(
  name: string,
  load: Cli.Load<T, void>,
  route?: Cli.Route<T>,
): Tag.Binding<Cli.Command>;
function commandOp<T>(
  name: string,
  module: Cli.Module<T, void>,
  route?: Cli.Route<T>,
): Tag.Binding<Cli.Command>;
function commandOp<T, I>(
  name: string,
  load: Cli.Load<T, I>,
  route: Cli.Route<T> & { readonly input: (argv: readonly string[]) => unknown },
): Tag.Binding<Cli.Command>;
function commandOp<T, I>(
  name: string,
  module: Cli.Module<T, I>,
  route: Cli.Route<T> & { readonly input: (argv: readonly string[]) => unknown },
): Tag.Binding<Cli.Command>;
function commandOp<T, I>(
  name: string,
  source: Cli.Load<T, I> | Cli.Module<T, I>,
  route?: Cli.Route<T>,
): Tag.Binding<Cli.Command> {
  return commands({
    name,
    kind: "operation",
    source,
    route: {
      input: route?.input,
      respond: route?.respond as ((value: unknown) => string) | undefined,
    },
  });
}

function isOperationModule(
  source: Cli.Load<unknown, unknown> | Cli.Module<unknown, unknown>,
): source is Cli.Module<unknown, unknown> {
  return typeof source !== "function";
}

/** Read one operation source either way: a loader function is called, a resource
 * handle is resolved through the scope `run` owns (cached per scope, per the
 * resource's target). A loader is a function, a handle is an object — the
 * `typeof` check is the discriminator, no cast. */
async function readOperation(
  scope: Scope.Handle,
  source: Cli.Load<unknown, unknown> | Cli.Module<unknown, unknown>,
): Promise<Operation.Handle<unknown, unknown>> {
  if (isOperationModule(source)) return scope.resolve(source);
  return source();
}

/** Read one entry source either way: a loader function is called, a resource
 * handle is resolved through the scope `run` owns. */
async function readEntry(scope: Scope.Handle, source: Cli.EntrySource): Promise<Cli.Entry> {
  if (typeof source !== "function") return scope.resolve(source);
  return source();
}

function commandEntry(
  name: string,
  load: () => Cli.Entry | PromiseLike<Cli.Entry>,
): Tag.Binding<Cli.Command>;
function commandEntry(name: string, module: Cli.EntryModule): Tag.Binding<Cli.Command>;
function commandEntry(name: string, source: Cli.EntrySource): Tag.Binding<Cli.Command> {
  return commands({ name, kind: "entry", source });
}

/** Bind a command: an operation run in a session, lazily loaded when selected.
 * Pass a loader function (called once for the selected command) or a resource
 * that delivers the operation (resolved through the scope `run` owns — cached
 * per scope, observable as a `resource` span). `input` is required when the
 * operation takes one. */
export const command: {
  <T>(name: string, load: Cli.Load<T, void>, route?: Cli.Route<T>): Tag.Binding<Cli.Command>;
  <T>(name: string, module: Cli.Module<T, void>, route?: Cli.Route<T>): Tag.Binding<Cli.Command>;
  <T, I>(
    name: string,
    load: Cli.Load<T, I>,
    route: Cli.Route<T> & { readonly input: (argv: readonly string[]) => unknown },
  ): Tag.Binding<Cli.Command>;
  <T, I>(
    name: string,
    module: Cli.Module<T, I>,
    route: Cli.Route<T> & { readonly input: (argv: readonly string[]) => unknown },
  ): Tag.Binding<Cli.Command>;
  readonly entry: {
    (name: string, load: () => Cli.Entry | PromiseLike<Cli.Entry>): Tag.Binding<Cli.Command>;
    (name: string, module: Cli.EntryModule): Tag.Binding<Cli.Command>;
  };
} = Object.assign(commandOp, { entry: commandEntry });

/** Map a command failure to its exit code. Shared by the log line (inside the
 * inline op, where `cancelled` comes from its ctx) and the exit site (in `run`,
 * where it comes from `io.signal`) — one rule, two readers. */
function codeOf(error: unknown, cancelled: boolean): number {
  if (cancelled) return 130;
  if (isCoreError(error, "DataValidationFailed")) return 2;
  return 1;
}

const noop = (): void => undefined;

/** Track the abort-time close the scope already owns (close never throws, ADR 0027):
 * the abort listener keeps no awaiter, so attach the shared no-op and never leave an
 * unhandled rejection; `done` still awaits the same close. */
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
 * code then rethrows — the session settles, `run` maps again with the same rule. */
function readCommand(
  selected: Extract<Cli.Command, { readonly kind: "operation" }>,
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
 * no `node:` import; `run` never touches the process. */
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

function usageText(options: Cli.Options, table: readonly Cli.Command[]): string {
  const lines = table.map((cmd) => cmd.name).sort();
  return (
    [`${options.name} ${options.version}`, ...lines.map((name) => `  ${name}`)].join("\n") + "\n"
  );
}

function selectCommand(table: readonly Cli.Command[], head: string): Cli.Command {
  const found = table.find((cmd) => cmd.name === head);
  if (found === undefined)
    raise("UnknownCommand", { name: head, known: table.map((cmd) => cmd.name) });
  return found;
}

async function answerHead(
  collected: Collected,
  options: Cli.Options,
  table: readonly Cli.Command[],
  head: string,
): Promise<number | undefined> {
  if (head === "help") {
    collected.stdout(usageText(options, table));
    return 0;
  }
  if (head === "--version") {
    collected.stdout(`${options.version}\n`);
    return 0;
  }
  return undefined;
}

type Answer = { readonly code: number; readonly failed: unknown };

async function runEntry(
  scope: Scope.Handle,
  signal: AbortSignal | undefined,
  selected: Extract<Cli.Command, { readonly kind: "entry" }>,
  rest: readonly string[],
): Promise<Answer> {
  const entry = await readEntry(scope, selected.source);
  try {
    await entry(scope, rest);
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
  label: string,
  selected: Extract<Cli.Command, { readonly kind: "operation" }>,
  rest: readonly string[],
): Promise<{ readonly code: number; readonly text: string | undefined; readonly failed: unknown }> {
  const loaded = await readOperation(scope, selected.source);
  const none = { code: 0, text: undefined, failed: undefined };
  try {
    const text = await scope.session((s) =>
      s.run({
        label,
        depends: { op: loaded },
        run: readCommand(selected, rest),
      }),
    );
    return { ...none, text };
  } catch (error: unknown) {
    if (signal?.aborted === true) return { ...none, code: 130 };
    if (isCoreError(error, "DataValidationFailed")) return { ...none, code: 2 };
    return { ...none, code: 1, failed: error };
  }
}

/** Run one command: create the scope, route the first argv word through the bound table,
 * map the outcome to streams and an exit code, close the scope on every path.
 * Missing/`help` answers usage (2/0); unknown answers usage to stderr (2);
 * `--version` answers the version (0); the selected source (loader call or
 * resource resolve) runs only for the selected command. An operation command
 * runs in a session as an inline op (`<name> <command>` span, one `cli command`
 * line): success prints through
 * `respond` (default JSON, nothing for `undefined`) and exits 0, a parse failure
 * prints usage and exits 2, anything else prints and exits 1, an abort exits 130.
 * An entry command receives the scope directly: 0, 1 on throw, 130 on abort. */
export async function run(
  options: Cli.Options & { readonly argv: readonly string[]; readonly io?: Cli.Io },
): Promise<Cli.Result> {
  const collected = collect(options.io);
  const scope = createScope(options.scope);
  const signal = options.io?.signal;
  const unhook = wireSignal(scope, signal);
  if (signal?.aborted === true) {
    unhook();
    await scope.close({ graceful: true });
    return { code: 130, stdout: "", stderr: "" };
  }
  const finish = async (code: number): Promise<Cli.Result> => {
    unhook();
    await scope.close({ graceful: true });
    return collected.result(code);
  };
  const table = scope.resolve(commands.all);
  if (options.argv.length === 0) {
    collected.stdout(usageText(options, table));
    return finish(2);
  }
  const [head, ...rest] = options.argv;
  const headed = await answerHead(collected, options, table, head);
  if (headed !== undefined) return finish(headed);
  const code = await answerSelected(collected, scope, signal, options, table, head, rest);
  return finish(code);
}

async function answerSelected(
  collected: Collected,
  scope: Scope.Handle,
  signal: AbortSignal | undefined,
  options: Cli.Options,
  table: readonly Cli.Command[],
  head: string,
  rest: readonly string[],
): Promise<number> {
  let selected: Cli.Command;
  try {
    selected = selectCommand(table, head);
  } catch (error: unknown) {
    if (!isError(error, "UnknownCommand")) throw error;
    collected.stderr(usageText(options, table));
    return 2;
  }
  if (selected.kind === "entry") {
    const answered = await runEntry(scope, signal, selected, rest);
    if (answered.failed !== undefined) collected.stderr(printError(answered.failed));
    return answered.code;
  }
  const outcome = await runOperation(
    scope,
    signal,
    `${options.name} ${selected.name}`,
    selected,
    rest,
  );
  if (outcome.text !== undefined) collected.stdout(outcome.text);
  if (outcome.code === 2) collected.stderr(usageText(options, table));
  if (outcome.failed !== undefined) collected.stderr(printError(outcome.failed));
  return outcome.code;
}

/** The real entrypoint: `run` plus signals plus `process.exit`. Never returns:
 * SIGINT/SIGTERM abort the run (exit 130); otherwise it exits with `run`'s code. */
export async function runMain(options: Cli.Options): Promise<never> {
  const proc: Proc = globalThis.process;
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  proc.on("SIGINT", abort);
  proc.on("SIGTERM", abort);
  const result = await run({
    ...options,
    argv: proc.argv.slice(2),
    io: {
      stdout: (s) => {
        proc.stdout.write(s);
      },
      stderr: (s) => {
        proc.stderr.write(s);
      },
      signal: controller.signal,
    },
  });
  proc.exit(result.code);
}
