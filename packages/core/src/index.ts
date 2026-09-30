import { isError, raise } from "./errors.ts";
import { causesOf, closeOrigin, failureKind, originOf, raiseFrom, stampOrigin } from "./errors.ts";
import type { Origin, RunResult } from "./errors.ts";

export { originOf };
export type { Origin, RunResult };

const cell: unique symbol = Symbol("data");
const operationSym: unique symbol = Symbol("operation");
const borrowSym: unique symbol = Symbol("borrow");
const tagSym: unique symbol = Symbol("tag");
const edge: unique symbol = Symbol("edge");
const resourceSym: unique symbol = Symbol("resource");
const mayHookSym: unique symbol = Symbol("mayHook");
const extensionSym: unique symbol = Symbol("extension");
const presetSym: unique symbol = Symbol("preset");
const namespaceSym: unique symbol = Symbol("namespace");

/** A declared dependency edge: a mode (`controller`, `required`, `optional`, `all`) onto a target. */
export type Edge<K extends string, Target> = {
  readonly [edge]: true;
  readonly kind: K;
  readonly target: Target;
};

/** A list as authored (the `clsx` / ESLint flat-config shape): one item, nothing
 * (`null`/`undefined`/`false` — so `cond && item` reads as one), or a list of those to any depth.
 * Every list a config takes — `tags`, `presets`, `extensions`, a driver's rows — is one,
 * read once and flat where it lands (see {@link readMany}), so optional and grouped items need no
 * spread: `tags: [request(raw), audit && trace(true), shared]`. Only `false`, never `0`/`""`: a
 * `count && x` slip stays a type error. */
export type Many<T> = T | null | undefined | false | readonly Many<T>[];

export declare namespace Data {
  /** Validates raw input into a trusted value once, at the process edge: a function that returns
   * the value or throws, or any {@link Schema} (zod, valibot, arktype) passed as-is. */
  export type Parse<T> = ((raw: unknown) => T) | Schema<T>;

  /** The Standard Schema contract (`~standard`, version 1) every schema library speaks. Only the
   * sync result is admitted: an edge parses before it runs, so a promise result is refused. */
  export type Schema<T> = {
    readonly "~standard": {
      readonly version: 1;
      readonly vendor: string;
      readonly validate: (value: unknown) => SchemaResult<T> | Promise<SchemaResult<T>>;
    };
  };

  /** What a schema's `validate` answers: the value, or the issues that refused it. */
  export type SchemaResult<T> =
    | { readonly value: T; readonly issues?: undefined }
    | { readonly issues: readonly SchemaIssue[] };

  /** One reason a schema refused a value. */
  export type SchemaIssue = {
    readonly message: string;
    readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined;
  };

  /** A reactive value cell — the only reactive unit. */
  export type Cell<T> = {
    readonly [cell]: true;
    readonly label: string;
    readonly initial: T;
    readonly parse: Parse<T> | undefined;
    eq(a: T, b: T): boolean;
    /** Depend on this cell in write mode: delivered as a controller. */
    readonly controller: Edge<"controller", Cell<T>>;
  };
}

export declare namespace Tag {
  export type Presence<T> =
    | { readonly present: true; readonly value: T }
    | { readonly present: false };

  /** One value bound to a tag, seeded on a scope. `Handle<any>` is the callable-variance escape hatch. */
  export type Binding<T> = { readonly tag: Handle<any>; readonly value: T };

  /** Bindings as authored: a scope's `tags`, a session's `tags`, a call's `tags` — a {@link Many}
   * of bindings, read once and flat where it lands. */
  export type Bindings = Many<Binding<unknown>>;

  /** Ambient metadata read through the scope chain. Callable to bind a value. */
  export type Handle<T> = {
    readonly [tagSym]: true;
    readonly label: string;
    readonly hasDefault: boolean;
    readonly def: T | undefined;
    readonly parse: Data.Parse<T> | undefined;
    eq(a: T, b: T): boolean;
    readonly required: Edge<"required", Handle<T>>;
    readonly optional: Edge<"optional", Handle<T>>;
    readonly all: Edge<"all", Handle<T>>;
    (value: T): Binding<T>;
  };
}

/** A parallel storage bucket inside a layer (ADR 0059): minted by `namespace()`, carried on
 * an invocation (`ns`) or a scope/session (`createSession({ ns })`). A branded value, not a name —
 * two namespaces differ by identity, never by a string. Its `tags` are the namespace's own
 * bindings, read when a call resolves in it. */
export type Namespace = {
  readonly [namespaceSym]: true;
  readonly tags: readonly Tag.Binding<unknown>[];
};

/** A namespace as authored on an invocation or scope option: one key, or a read-through
 * fallback chain tried in order (ADR 0059 decision 3). Absent means today's single namespace. */
export type Ns = Namespace | readonly Namespace[];

export declare namespace Observe {
  /** What opened a span: resolving an operation or a resource, or a manual `ctx.obs.child`. */
  export type Kind = "operation" | "resource" | "manual";
  /** A point-in-time note attached to a span. */
  export type Event = {
    readonly name: string;
    readonly time: number;
    readonly attributes: Record<string, unknown>;
  };
  /** A driver-validated remote parent (ADR 0076). Ids are nonzero lowercase hex:
   * 32 digits for the trace, 16 for its parent. The scope copies the seed; child sessions
   * inherit it. Sampling defaults to true and does not switch local observation off. */
  export type Trace = {
    readonly traceId: string;
    readonly parentSpanId: string;
    readonly sampled?: boolean;
  };
  /** One unit of tracked work; nests by explicit `parentId` into a tree. Behavior-neutral. */
  export type Span = {
    readonly id: number;
    readonly parentId: number | undefined;
    /** W3C ids, set before the body runs; numeric ids still order the local tree. */
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId: string | undefined;
    readonly sampled: boolean;
    readonly name: string;
    readonly kind: Kind;
    readonly start: number;
    end: number | undefined;
    status: "ok" | "failed" | undefined;
    /** The cause for a failed operation, when the run supplied one. */
    error?: unknown;
    readonly attributes: Record<string, unknown>;
    readonly events: Event[];
  };
  /** Where a log line sits on pino's numeric scale — higher is more severe, so a sink filters
   * with a single `>=`. The four named rungs are `LEVELS` (`debug` 20, `info` 30, `warn` 40,
   * `error` 50); a value is a number, so an intermediate rung is legal without a new name. */
  export type Level = number;
  export type Log = {
    readonly time: number;
    readonly level: Level;
    readonly message: string;
    readonly attributes: Record<string, unknown>;
    readonly span: Span | undefined;
  };
  /** The ambient `log` capability on a ctx. The bare call logs at `info`; the four methods pick a
   * rung. Every method takes the same `(message, attributes?)`, so a swapped backend reads the
   * level off `Log.level` and colors or drops on it — `ctx.log("db query", { sql })` is unchanged. */
  export type Logger = {
    (message: string, attributes?: Record<string, unknown>): void;
    debug(message: string, attributes?: Record<string, unknown>): void;
    info(message: string, attributes?: Record<string, unknown>): void;
    warn(message: string, attributes?: Record<string, unknown>): void;
    error(message: string, attributes?: Record<string, unknown>): void;
  };
  /** Seeded on a scope; every switch is independent. Off (absent, or no `export`/`history`)
   * costs one boolean and allocates no spans. `clock` is injected for deterministic tests.
   * `level` is the drop threshold: a line below it never reaches `log` (default: keep all). */
  export type Config = {
    readonly clock?: () => number;
    readonly export?: (span: Span) => void;
    readonly history?: number;
    readonly log?: (entry: Log) => void;
    readonly level?: Level;
  };
  export type Ctx = {
    readonly span: Span | undefined;
    event(name: string, attributes?: Record<string, unknown>): void;
    child<T>(name: string, fn: (span: Span | undefined) => T): T;
  };
}

/** The four named rungs of `Observe.Level`, on pino's scale. Producer methods (`ctx.log.warn`)
 * and a sink share this one source: `if (entry.level >= LEVELS.warn) ...`. */
export const LEVELS = { debug: 20, info: 30, warn: 40, error: 50 } as const;

export declare namespace Clock {
  /** The ambient time source carried on every ctx (`ctx.clock`). Default is the system clock;
   * set once via `createScope({ clock })` and inherited by child sessions. Cancelling a wait is
   * explicit through `ctx.signal` (ADR 0034). */
  export type Handle = {
    /** Wall-clock time as whole milliseconds since the Unix epoch. */
    currentTimeMillis(): number;
    /** Wall-clock time as nanoseconds since the Unix epoch. */
    currentTimeNanos(): bigint;
    /** Resolve after `ms` milliseconds. If `signal` aborts first, reject with its reason — pass
     * `ctx.signal` to make the wait cancellable (a forced scope close aborts it). */
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
  };

  /** A controllable clock for tests: reads a virtual time that moves only when advanced by hand.
   * The mock-free seam for time-dependent code — no `Date` mock, no fake timers (ADR 0034). Pass
   * it to `createScope({ clock })`. */
  export type Test = Handle & {
    /** Wakes every `sleep` now due, earliest first. */
    advance(ms: number): void;
    /** Set virtual time to `ms` milliseconds since the epoch. */
    setTime(ms: number): void;
  };

  /** Seeds {@link makeTestClock}: the virtual time to start at (default `0`). */
  export type Options = { readonly now?: number };
}

export declare namespace Random {
  /** The ambient randomness source carried on every ctx (`ctx.random`). Default is the system
   * source; set once via `createScope({ random })` and inherited by child sessions. Both reads are
   * synchronous — no signal, no wait (ADR 0062). */
  export type Handle = {
    /** A float in `[0, 1)`, like `Math.random`. */
    next(): number;
    /** A v4-shaped unique id, like `crypto.randomUUID`. */
    uuid(): string;
  };

  /** Seeds {@link makeTestRandom}: the same seed replays the same `next` and `uuid` stream
   * (default `0`). */
  export type Options = { readonly seed?: number };
}

export declare namespace Operation {
  /** The receiver an operation body reads its own invocation through. `signal` aborts when the owning
   * scope/session closes (hand it to `fetch`/an SDK); `defer` runs one hook when the run settles. */
  export type Ctx<I> = {
    readonly label: string;
    readonly rawInput: unknown;
    readonly input: I;
    readonly raise: <K extends string, P extends object>(kind: K, payload: P) => never;
    readonly signal: AbortSignal;
    readonly defer: (fn: (end: Scope.End) => void | PromiseLike<void>) => void;
    readonly obs: Observe.Ctx;
    readonly log: Observe.Logger;
    readonly clock: Clock.Handle;
    readonly random: Random.Handle;
  };

  /** An operation: typed input, declared deps, runs on every call. Not reactive, not memoized. */
  export type Handle<T, I> = {
    readonly [operationSym]: true;
    readonly label: string;
    readonly input: Data.Parse<I> | undefined;
    readonly depends: Scope.Depends;
    run(deps: Record<string, unknown>, ctx: Ctx<I>): T;
    /** Depend on this operation: delivered as a callable controller. */
    readonly controller: Edge<"controller", Handle<T, I>>;
  };
}

export declare namespace Resource {
  /** The receiver a resource factory builds through: `defer` registers one end-hook (commit/roll
   * back/release when the owner settles or the resource is released); `signal` aborts on close. */
  export type Ctx = {
    readonly label: string;
    /** The namespace chain used for this build's dependencies; absent for the default bucket. */
    readonly ns: readonly Namespace[] | undefined;
    readonly raise: <K extends string, P extends object>(kind: K, payload: P) => never;
    readonly defer: (fn: (end: Scope.End) => void | PromiseLike<void>) => void;
    readonly signal: AbortSignal;
    readonly obs: Observe.Ctx;
    readonly log: Observe.Logger;
    readonly clock: Clock.Handle;
    readonly random: Random.Handle;
  };

  /** A reusable built instance. `target` picks the owner and bucket: `scope` = root default,
   * `namespace` = root per namespace, `session` = requesting layer per namespace. */
  export type Handle<T> = {
    readonly [resourceSym]: true;
    readonly label: string;
    readonly target: "scope" | "namespace" | "session";
    readonly depends: Scope.Depends;
    factory(deps: Record<string, unknown>, ctx: Ctx): T;
  };
}

export declare namespace Scope {
  /** What a resource delivers: an async factory is normalized to a plain `Promise<value>`,
   * so the extra shape of a returned thenable never leaks into the caller's type. */
  export type ResourceValue<T> = T extends PromiseLike<unknown> ? Promise<Awaited<T>> : T;

  /** A build-once handle onto one resource instance. */
  export type ResourceController<T> = {
    resolve(): ResourceValue<T>;
    get(): ResourceValue<T>;
  };

  /** A read/write handle onto one cell. `get` is the read. The watcher hands the value
   * before the write beside the next one, so a listener that reacts to "changed to a
   * different value" never keeps its own copy. A one-argument listener still type-checks. */
  export type DataController<T> = {
    get(): T;
    set(value: T): void;
    update(fn: (previous: T) => T): void;
    watch(listener: (next: T, prev: T) => void): () => void;
  };

  /** How a subflow call is supplied (ADR 0022, 0038): a pre-typed `input` (parse skipped), or a
   * raw `rawInput` (run through the operation's parse), plus per-call ambient tag bindings and
   * per-call namespace (ADR 0059). A call carrying `tags` or `signal` opens a child session for that run
   * (ADR 0038; a value when it ended in place, a promise when it must wait, ADR 0072). A defined
   * `input` wins; an `undefined` `input` counts as absent, so `rawInput` is parsed instead. */
  export type Invocation<I> = {
    readonly input?: I;
    readonly rawInput?: unknown;
    readonly tags?: Tag.Bindings;
    /** Own this call in a child session (ADR 0090). Abort stops its work through `ctx.signal`
     * and waits for cleanup. The exact reason is preserved; a different late error still fails.
     * Session resources and data writes belong to the child, as with a tagged call. */
    readonly signal?: AbortSignal;
    /** The storage bucket for this call (ADR 0059): one namespace or a read-through chain.
     * Absent resolves in the layer's ambient namespace (or the default bucket). */
    readonly ns?: Ns;
  };

  /** An invocation that carries an input — exactly one of `input` or `rawInput`, never both and
   * never an `undefined` input smuggled in beside a `rawInput`. */
  export type ProvideInput<I> =
    | {
        readonly input: I;
        readonly rawInput?: never;
        readonly tags?: Tag.Bindings;
        readonly signal?: AbortSignal;
        readonly ns?: Ns;
      }
    | {
        readonly input?: never;
        readonly rawInput: unknown;
        readonly tags?: Tag.Bindings;
        readonly signal?: AbortSignal;
        readonly ns?: Ns;
      };

  /** The `run` argument list for input `I`: a genuinely void input is callable with no
   * argument; anything else (including a `never`-typed parse) must supply `input` or `rawInput`.
   * `never` is excluded from the void case first — `[never] extends [void]` is otherwise true. */
  export type CallArgs<I> = [I] extends [never]
    ? [call: ProvideInput<I>]
    : [I] extends [void]
      ? [call?: Invocation<I>]
      : [call: ProvideInput<I>];

  /** A callable handle onto one operation — always a function, never a value (ADR 0022). A
   * void-input operation is called `run()`; an input-carrying one must supply `input` or
   * `rawInput`. A call carrying `tags` or `signal` opens a child session for the run (ADR 0038, 0090): it returns
   * the run's value when that session ended in place, a promise when it must wait (ADR 0072),
   * so it types as `T | Promise<Awaited<T>>`, like an untagged run whose body may be async. The
   * owned overload comes first so a call carrying `tags` or `signal` gets that type even though a plain
   * shape would also match. */
  export type OperationController<T, I> = {
    run(...call: OwnedCall<I>): T | Promise<Awaited<T>>;
    run(...call: CallArgs<I>): T;
    settle(...call: OwnedCall<I>): RunResult<Awaited<T>> | Promise<RunResult<Awaited<T>>>;
    settle(...call: CallArgs<I>): Settled<T>;
  };

  /** Async runs settle asynchronously; a sync run returns its Result directly. A `T` not known
   * to be either (`unknown`, `any`) may be both. Every branch is written in `Awaited<T>`, so on
   * a generic `T` the type is assignable to `RunResult<Awaited<T>> | Promise<RunResult<Awaited<T>>>`
   * with no cast. */
  export type Settled<T> = [T] extends [never]
    ? RunResult<never>
    : unknown extends T
      ? RunResult<Awaited<T>> | Promise<RunResult<Awaited<T>>>
      : T extends PromiseLike<unknown>
        ? Promise<RunResult<Awaited<T>>>
        : RunResult<Awaited<T>>;

  /** The tag bindings a call may carry. Present on a call, they open a child session bound
   * with them for that run (ADR 0038): the run's own tag reads, its subflows, and session-target
   * resources built for the flow see them through the layer chain. Scope-target resources are
   * unchanged. A call carrying `tags` returns the run's value when its session ended in place,
   * and a promise when the session must wait (ADR 0072). The authored shape is `Tag.Bindings`
   * minus a bare nothing: `tags: undefined` (or `false`) is an untagged call, not a tagged one. */
  export type Bindings = Exclude<Tag.Bindings, null | undefined | false>;

  /** A call that carries `tags` (ADR 0038): a child session for the run. It returns the run's
   * value when the session ended in place, a promise when it must wait (ADR 0072). For a void
   * input the call object
   * holds only `tags`; otherwise it holds the run's `input` (or `rawInput`) plus `tags`. */
  export type TaggedCall<I> = [I] extends [void]
    ? [call: { readonly tags: Bindings; readonly ns?: Ns; readonly signal?: AbortSignal }]
    : [call: ProvideInput<I> & { readonly tags: Bindings }];

  /** Tags or a signal give a call its own session, whose cleanup may be asynchronous. */
  export type OwnedCall<I> =
    | TaggedCall<I>
    | [
        call: ([I] extends [void] ? Invocation<I> : ProvideInput<I>) & {
          readonly signal: AbortSignal;
        },
      ];

  /** An inline operation: a config with the same deps + body shape as `operation()`, but no
   * identity — no label requirement, no parse, no preset (ADR 0037). The body's parameter is
   * passed in the call object, not closed over, so it lands on `ctx.input`/`ctx.rawInput`
   * and is visible to observation. */
  export type Inline<D extends Depends, R, I> = {
    readonly label?: string;
    readonly depends?: D;
    readonly run: (deps: SlotValues<D>, ctx: Operation.Ctx<I>) => R & AsyncBody<D>;
  };

  /** The call object an inline run takes (ADR 0037, 0038): the same invocation shape as a
   * declared run, minus `rawInput` (there is no parse). `I` is inferred from `call.input`;
   * with nothing to pass, omit the call and `I` is void. A call carrying `tags` or `signal` opens a
   * child session for the run (a value when it ended in place, a promise when it must wait). */
  export type InlineCall<I> = [I] extends [void]
    ? [call?: { readonly tags?: Bindings; readonly ns?: Ns; readonly signal?: AbortSignal }]
    : [
        call: {
          readonly input: I;
          readonly tags?: Bindings;
          readonly ns?: Ns;
          readonly signal?: AbortSignal;
        },
      ];

  /** An inline run carrying `tags` (ADR 0038): a value when its session ended in place, a promise
   * when it must wait (ADR 0072). */
  export type TaggedInlineCall<I> = [I] extends [void]
    ? [call: { readonly tags: Bindings; readonly ns?: Ns; readonly signal?: AbortSignal }]
    : [
        call: {
          readonly input: I;
          readonly tags: Bindings;
          readonly ns?: Ns;
          readonly signal?: AbortSignal;
        },
      ];

  /** An inline call with its own session, selected by tags or a signal. */
  export type OwnedInlineCall<I> =
    | TaggedInlineCall<I>
    | [
        call: { readonly signal: AbortSignal; readonly tags?: Bindings; readonly ns?: Ns } & ([
          I,
        ] extends [void]
          ? { readonly input?: I }
          : { readonly input: I }),
      ];

  /** The per-call namespace argument of `resolve`/`controller` (ADR 0059):
   * `scope.resolve(cell, { ns })`, `scope.controller(cell, { ns })`. */
  export type NsArg = { readonly ns: Ns };

  export type Dependency =
    | Data.Cell<unknown>
    | Operation.Handle<unknown, unknown>
    | Resource.Handle<unknown>
    | Tag.Handle<any>
    | Extension<unknown>
    | Edge<"controller", Data.Cell<unknown> | Operation.Handle<unknown, unknown>>
    | Edge<"required" | "optional" | "all", Tag.Handle<any>>;
  export type Depends = Readonly<Record<string, Dependency>>;

  /** Maps one declared dependency to the value delivered in `deps` — exact, no casts in userland.
   * A bare operation is a subflow (a callable controller); a bare resource is its built instance;
   * a bare extension is its settled start value (ADR 0051: what `scope.resolve(ext)` returns). */
  export type SlotValue<D> =
    D extends Edge<"controller", infer N>
      ? N extends Data.Cell<infer T>
        ? DataController<T>
        : N extends Operation.Handle<infer T, infer I>
          ? OperationController<T, I>
          : never
      : D extends Edge<"all", Tag.Handle<infer T>>
        ? T[]
        : D extends Edge<"optional", Tag.Handle<infer T>>
          ? Tag.Presence<T>
          : D extends Edge<"required", Tag.Handle<infer T>>
            ? T
            : D extends Tag.Handle<infer T>
              ? T
              : D extends Data.Cell<infer T>
                ? T
                : D extends Operation.Handle<infer T, infer I>
                  ? OperationController<T, I>
                  : D extends Resource.Handle<infer T>
                    ? Awaited<T>
                    : D extends Extension<infer T>
                      ? T
                      : never;
  export type SlotValues<D extends Depends> = { [K in keyof D]: SlotValue<D[K]> };

  /** True when a declared dependency is an async resource (its factory returns a promise, or it is
   * itself contagious). Async is a build detail the type system carries through the graph (ADR
   * 0044): a body over an async resource is an async body. */
  export type AsyncDeps<D extends Depends> = true extends {
    [K in keyof D]: D[K] extends Resource.Handle<infer T>
      ? T extends PromiseLike<unknown>
        ? true
        : false
      : false;
  }[keyof D]
    ? true
    : false;
  /** The return-type constraint a body over `D` must satisfy: a promise when `D` holds an async
   * resource (the call is awaited, so the type says so), anything otherwise. */
  export type AsyncBody<D extends Depends> =
    AsyncDeps<D> extends true ? PromiseLike<unknown> : unknown;

  /** A test-only substitution of a node's realization, seen by downstream consumers (ADR 0015). */
  export type Preset = {
    readonly [presetSym]: true;
    readonly node: unknown;
    readonly replacement: unknown;
  };

  /** Bound access to the hook's owner and effective namespace. Run hooks share their run's
   * trace, resource holds, cancellation, and defer lifetime. Other hooks defer to their session. */
  export type ExtensionCtx = Resource.Ctx &
    Pick<Handle, "resolve" | "controller" | "run" | "settle"> & {
      readonly ns: readonly Namespace[] | undefined;
    };

  /** Each hook keeps one object as its input. `kind` narrows the payload and `next` result. */
  export type ExtensionDetails = {
    start: { readonly kind: "start"; readonly scope: Handle; readonly next: () => Promise<void> };
    resolve: {
      readonly kind: "resolve";
      readonly target: Data.Cell<unknown> | Resource.Handle<unknown> | Tag.Handle<unknown>;
      readonly next: () => unknown;
    };
    run: {
      readonly kind: "run";
      readonly op: Operation.Handle<unknown, unknown> | Inline<Depends, unknown, unknown>;
      readonly call: Invocation<unknown> | undefined;
      readonly next: () => unknown;
    };
    write: {
      readonly kind: "write";
      readonly cell: Data.Cell<unknown>;
      readonly value: unknown;
      readonly next: () => void;
    };
    close: {
      readonly kind: "close";
      readonly options: CloseOptions;
      readonly next: () => Promise<Result>;
    };
    session: {
      readonly kind: "session";
      readonly handle: Handle;
      readonly next: () => Promise<Result>;
    };
  };
  export type ExtensionEvents = {
    [K in keyof ExtensionDetails]: ExtensionCtx & ExtensionDetails[K];
  };
  export type ExtensionEvent = ExtensionEvents[keyof ExtensionEvents];
  export type Hooks<T = unknown> = {
    start?(event: ExtensionEvents["start"]): T | PromiseLike<T>;
    resolve?(event: ExtensionEvents["resolve"]): unknown;
    run?(event: ExtensionEvents["run"]): unknown;
    write?(event: ExtensionEvents["write"]): void;
    close?(event: ExtensionEvents["close"]): Promise<Result>;
    session?(event: ExtensionEvents["session"]): Promise<Result>;
  };

  /** Middleware over the scope's verbs (ADR 0050): each hook is an onion layer with `next`. All
   * run and write hooks follow child sessions and dependencies. Resolve hooks wrap direct root
   * reads only; session, dependency, and event access bypass them. `session` (ADR 0051) is the
   * sixth hook: it wraps a session's whole life — registration order, first is outermost.
   * `next()` resolves with the session's close `Result` (whatever `closeLayer` produced; never
   * rejects, ADR 0027). Code before `await next()` runs right after the child layer exists,
   * before any work in it; code after runs after the close settled. `next()` is an observation
   * point, not a gate: the session runs and closes regardless of whether a hook calls it. Each
   * level's return is that level's result, like `close` (the onion may transform it). Root-only in v1: installed on
   * the root, applies to every session created under that root, including a session created under
   * a session. A hook that does not call `next()` is an observer only: the session's own close
   * still runs regardless (`next()` is the observation point, not a gate). Hooks must not throw:
   * a throw skips the remaining inner hooks and, if `next()` was never called, the hook's own
   * rejection stands in for the close `Result` — the session's close still ran, but the thrown
   * error is what the caller sees (record a span; do not branch on the error). */
  export type Extension<T = unknown> = {
    readonly [extensionSym]: true;
    readonly label: string;
    readonly hooks?: Hooks<T>;
  };

  export type Options = {
    tags?: Tag.Bindings;
    /** The ambient namespace (ADR 0059): every read and write inside resolves through it; a
     * child session inherits it; a per-call `ns` overrides it for one run. Absent = default. */
    ns?: Ns;
    observe?: Observe.Config;
    /** Join a remote trace; null starts fresh. Absent inherits the parent seed.
     * Copied at scope/session creation; ignored with observation off. */
    trace?: Observe.Trace | null;
    presets?: Many<Preset>;
    /** The ambient clock for this scope; child sessions inherit it. Default is the system clock. */
    clock?: Clock.Handle;
    /** The ambient randomness for this scope; child sessions inherit it. Default is the system source. */
    random?: Random.Handle;
    /** Middleware installed on the root scope only (ADR 0050); sessions inherit the resolved values. */
    extensions?: Many<Extension<unknown>>;
  };

  export type RootOptions = Options & {
    /** Ask the root to close gracefully once `ready` resolves, even if already aborted.
     * A failed start closes forcibly instead. This never aborts `ctx.signal` (ADR 0085). */
    readonly signal?: AbortSignal;
  };

  export type RootHandle = Handle & {
    /** Core's own close Result, after the close hooks finish. Pending while open; settles once
     * and never rejects. Only roots made with a stop signal have it (ADR 0085).
     * A hook that skips `next()` leaves it pending; a hook's throw is not part of the Result. */
    readonly closed: Promise<Result>;
  };

  /** How a scope settled: cleanly, by an inside-out failure, or as a cancellation. */
  export type Outcome =
    | { readonly status: "success" }
    | { readonly status: "failed"; readonly error?: unknown }
    | { readonly status: "cancelled" };

  /** Why a lifetime ended, delivered to `ctx.defer`. A layer settles with an {@link Outcome}; an
   * individually released resource ends `released` while its layer lives on. */
  export type End = Outcome | { readonly status: "released" };

  /** How to shut a scope down (ADR 0028) — a mode, NOT a wished outcome. Forced (the default) aborts
   * `ctx.signal` to stop in-flight work now; graceful lets it finish first. The outcome is a
   * consequence of the mode and what actually happened, read from the {@link Result}.
   * `withData` (ADR 0069) moves the scope's own data store into the `Result` as `data` instead of
   * freeing it. Like `graceful`, it is read from the first close call; a later call joins it. */
  export type CloseOptions = { readonly graceful?: boolean; readonly withData?: boolean };

  /** A closed scope's own data, handed over by `close({ withData: true })` (ADR 0069). `get` reads a
   * data cell the way a controller on that scope did, but only in the scope's own store: present
   * when the scope itself wrote the cell, absent for an inherited value. `ns` picks a namespaced
   * bucket (a family member) exactly as `controller(cell, { ns })` does; without it, the scope's
   * own `ns` applies. */
  export type FinalData = {
    get<T>(cell: Data.Cell<T>, ns?: NsArg): Tag.Presence<T>;
  };

  /** What `close()` resolves to — the ACTUAL settled state, never a thrown error (ADR 0027/0028).
   * `teardownErrors` (defer/cleanup throws, in execution order) may accompany any status. `data`
   * is present on every status only when the close asked `withData` (ADR 0069). */
  export type Result =
    | {
        readonly status: "success";
        readonly teardownErrors?: readonly unknown[];
        readonly data?: FinalData;
      }
    | {
        readonly status: "cancelled";
        readonly reason: unknown;
        readonly teardownErrors?: readonly unknown[];
        readonly data?: FinalData;
      }
    | {
        readonly status: "failed";
        readonly error: unknown;
        readonly origin?: Origin;
        readonly teardownErrors?: readonly unknown[];
        readonly data?: FinalData;
      };

  /** What `createScope()` returns: the one seam tests and callers touch. */
  export type Handle = {
    /** Give back control: a handle that delays and steers — data `get/set/update/watch`,
     * resource `resolve/get`, operation `run(call)`. */
    controller<T>(target: Data.Cell<T>, ns?: NsArg): DataController<T>;
    controller<T>(target: Resource.Handle<T>, ns?: NsArg): ResourceController<T>;
    controller<T, I>(target: Operation.Handle<T, I>, ns?: NsArg): OperationController<T, I>;
    /** Read the snapshot, in the form a `depends` slot delivers: a data cell reads its current
     * value (no subscription); a resource reads its built instance (builds once if needed — the
     * same build `depends` performs, so the one `resolve` that may do work); a tag reads the
     * nearest binding, else its default, else throws `MissingTag`. An operation has no snapshot:
     * it is not accepted (no overload), run it with `run` instead. */
    resolve<T>(cell: Data.Cell<T>, ns?: NsArg): T;
    resolve<T>(res: Resource.Handle<T>, ns?: NsArg): ResourceValue<T>;
    resolve<T>(tag: Tag.Handle<T>, ns?: NsArg): T;
    /** A tag edge reads exactly what that `depends` slot would deliver (ADR 0020/0036): `.all` →
     * every binding nearest-first, `.optional` → a presence, `.required` → the value or `MissingTag`.
     * The way a driver reads a whole routing table off the scope (core/t29). */
    resolve<T>(edge: Edge<"all", Tag.Handle<T>>, ns?: NsArg): T[];
    resolve<T>(edge: Edge<"optional", Tag.Handle<T>>, ns?: NsArg): Tag.Presence<T>;
    resolve<T>(edge: Edge<"required", Tag.Handle<T>>, ns?: NsArg): T;
    /** Read what an extension's `start` returned (ADR 0050): available once that extension's start
     * settled (`NotResolved` before, or when the extension is not installed on this scope). */
    resolve<T>(ext: Extension<T>): T;
    /** Run an operation now — the everyday call; `controller(op).run(call)` is the long form.
     * Same `CallArgs`/`Invocation` rules as before (ADR 0022). A call carrying `tags` or `signal` opens a
     * child session for the run (ADR 0038): the run's value when that session ended in place, a
     * promise when it must wait (ADR 0072). Also runs an inline operation config (ADR 0037) —
     * same call object, minus `rawInput` — through the same controller path, with one span named
     * `label ?? "inline"` and nothing cached in the layer. The owned overloads come first so a
     * call carrying `tags` or `signal` gets the `T | Promise` type even though a plain shape would also
     * match. */
    run<T, I>(op: Operation.Handle<T, I>, ...call: OwnedCall<I>): T | Promise<Awaited<T>>;
    run<T, I>(op: Operation.Handle<T, I>, ...call: CallArgs<I>): T;
    run<const D extends Depends = Record<string, never>, R = unknown, I = void>(
      inline: Inline<D, R, I>,
      ...call: OwnedInlineCall<I>
    ): R | Promise<Awaited<R>>;
    run<const D extends Depends = Record<string, never>, R = unknown, I = void>(
      inline: Inline<D, R, I>,
      ...call: InlineCall<I>
    ): R;
    /** Run without throwing: return a value, failure with its origin, or cancellation. */
    settle<T, I>(
      op: Operation.Handle<T, I>,
      ...call: OwnedCall<I>
    ): RunResult<Awaited<T>> | Promise<RunResult<Awaited<T>>>;
    settle<T, I>(op: Operation.Handle<T, I>, ...call: CallArgs<I>): Settled<T>;
    settle<const D extends Depends = Record<string, never>, R = unknown, I = void>(
      inline: Inline<D, R, I>,
      ...call: OwnedInlineCall<I>
    ): RunResult<Awaited<R>> | Promise<RunResult<Awaited<R>>>;
    settle<const D extends Depends = Record<string, never>, R = unknown, I = void>(
      inline: Inline<D, R, I>,
      ...call: InlineCall<I>
    ): Settled<R>;
    /** Open a child session: it inherits this scope's data and tags, and shadows on write. */
    createSession(options?: Options): Handle;
    /** Run `fn` in a fresh child session: normal return = success, a thrown error = failed(cause),
     * an external forced close while it runs = cancelled. The session auto-closes when `fn` settles;
     * the primary cause is thrown, hook errors aggregated (ADR 0017). */
    session<R>(fn: (scope: Handle) => R | PromiseLike<R>): Promise<R>;
    session<R>(options: Options, fn: (scope: Handle) => R | PromiseLike<R>): Promise<R>;
    /** Reset a node: a data cell reverts to its inherited/initial value and notifies
     * watchers; a resource runs its cleanup, drops its instance, and a re-resolve rebuilds
     * a fresh generation (a late build from the released generation never publishes). */
    release(target: Data.Cell<unknown> | Resource.Handle<unknown>): void;
    /** Unlink only the named bucket of a resource or cell at this layer. */
    releaseNs(target: Data.Cell<unknown> | Resource.Handle<unknown>, ns: Namespace): void;
    /** Register a userland teardown hook, run (LIFO) when this scope closes. */
    onClose(fn: () => void | PromiseLike<void>): void;
    /** The retained span history (bounded by `observe.history`; empty when observation is off). */
    spans(): readonly Observe.Span[];
    /** Resolve once all in-flight operation work owned by this scope has settled. */
    settled(): Promise<void>;
    /** Shut this scope down: close children first, join owned work, run outcome hooks then cleanup,
     * then seal. `opts.graceful` lets in-flight work finish; the default (forced) aborts it now
     * ({@link CloseOptions}, ADR 0028). Always resolves to a {@link Result} describing the actual
     * settled state + any teardown errors — never throws (0027). */
    close(opts?: CloseOptions): Promise<Result>;
    /** Wait for every extension's start. A failed start closes through the handle's close hooks
     * and rejects with the start error only after cleanup ends (ADR 0085). A close already under
     * way is joined. A scope with no extensions is ready at once. */
    readonly ready: Promise<void>;
  };
}

const isData = (n: unknown): n is Data.Cell<unknown> =>
  (n as { [cell]?: true } | null | undefined)?.[cell] === true;
const isOperation = (n: unknown): n is Operation.Handle<unknown, unknown> =>
  (n as { [operationSym]?: true } | null | undefined)?.[operationSym] === true;
const isResource = (n: unknown): n is Resource.Handle<unknown> =>
  (n as { [resourceSym]?: true } | null | undefined)?.[resourceSym] === true;
const isTag = (n: unknown): n is Tag.Handle<unknown> =>
  (n as { [tagSym]?: true } | null | undefined)?.[tagSym] === true;
const isEdge = (n: unknown): n is Edge<string, unknown> =>
  (n as { [edge]?: true } | null | undefined)?.[edge] === true;
const isExtension = (n: unknown): n is Scope.Extension<unknown> =>
  (n as { [extensionSym]?: true } | null | undefined)?.[extensionSym] === true;
const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  !!v &&
  (typeof v === "object" || typeof v === "function") &&
  typeof (v as { then?: unknown }).then === "function";

const edgeTo = <K extends string, N>(kind: K, target: N): Edge<K, N> => ({
  [edge]: true,
  kind,
  target,
});

export function extension<T = void>(config: {
  readonly label: string;
  readonly hooks?: Scope.Hooks<T>;
}): Scope.Extension<T> {
  return { ...config, [extensionSym]: true as const };
}

/** Run a parser on a raw value: a function's return, or a schema's validated value. A schema's
 * issues raise `SchemaRejected { issues }`; a schema that answers with a promise raises
 * `SchemaAsync { vendor }`, since every edge parses before it runs. */
export function parse<T>(parser: Data.Parse<T>, raw: unknown): T {
  if (typeof parser === "function") return parser(raw);
  const standard = parser["~standard"];
  const result = standard.validate(raw);
  if (result instanceof Promise) raise("SchemaAsync", { vendor: standard.vendor });
  if (result.issues) raise("SchemaRejected", { issues: result.issues });
  return result.value;
}

/** Admit a raw value through a parser once; parse failures become a registry error. */
function admit<T>(label: string, parser: Data.Parse<T> | undefined, raw: unknown): T {
  if (!parser) return raw as T;
  try {
    return parse(parser, raw);
  } catch (cause) {
    raise("DataValidationFailed", { label, cause });
  }
}

/** The shared, frozen empty list every no-item read returns — one per process, immutable so no
 * caller can reach past the `readonly` type and leak an item into every other empty read. */
const NO_ITEMS: readonly never[] = Object.freeze([]);

/** The "nothing" cases of an authored list — skipped wherever a {@link Many} is read. */
function isNothing(input: Many<unknown>): input is null | undefined | false {
  return input === undefined || input === null || input === false;
}

/** The default item discriminator for {@link readMany}: an item is whatever is not a list.
 * Named because `Array.isArray` alone does not narrow a `readonly` list. */
function isNotList<T>(value: T | readonly Many<T>[]): value is T {
  return !Array.isArray(value);
}

function pushMany<T>(
  out: T[],
  input: Many<T>,
  isItem: (value: T | readonly Many<T>[]) => value is T,
): void {
  if (isNothing(input)) return;
  if (isItem(input)) {
    out.push(input);
    return;
  }
  for (const item of input) pushMany(out, item, isItem);
}

/** Read a {@link Many} into a flat list, in authored order — nothing skipped, lists opened to
 * any depth. `isItem` tells an item from a list when the items are themselves arrays (a sync
 * row is a tuple); by default an item is whatever is not an array. The seam every config list
 * is read at, in core and in a driver alike. */
export function readMany<T>(
  input: Many<T>,
  isItem: (value: T | readonly Many<T>[]) => value is T = isNotList,
): readonly T[] {
  if (isNothing(input)) return NO_ITEMS;
  const out: T[] = [];
  pushMany(out, input, isItem);
  return out.length === 0 ? NO_ITEMS : out;
}

/** Declare a reactive value cell. `parse` validates the initial value once. */
export function data<T>(config: {
  label?: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Data.Cell<T> {
  const label = config.label ?? "anon";
  const base = {
    [cell]: true,
    label,
    initial: admit(label, config.parse, config.initial),
    parse: config.parse,
    eq: config.eq ?? Object.is,
  } as Data.Cell<T>;
  return Object.assign(base, { controller: edgeTo("controller", base) });
}

/** Declare an ambient tag. Call it to bind a value; read it via `.required`/`.optional`/`.all`. */
export function tag<T>(config: {
  label: string;
  default?: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
}): Tag.Handle<T> {
  const parser = config.parse;
  const label = config.label;
  const bind = (value: T): Tag.Binding<T> => ({
    tag: handle,
    value: admit(label, parser, value),
  });
  const handle = Object.assign(bind, {
    [tagSym]: true as const,
    label,
    hasDefault: "default" in config,
    def: config.default,
    parse: parser,
    eq: config.eq ?? Object.is,
  }) as Tag.Handle<T>;
  return Object.assign(handle, {
    required: edgeTo("required", handle),
    optional: edgeTo("optional", handle),
    all: edgeTo("all", handle),
  });
}

/** Mint a namespace: a branded parallel storage bucket (ADR 0059), exactly as `data`/`tag` mint
 * configured handles. It carries no string — two namespaces differ by identity. `opts.tags` are
 * the namespace's own bindings, read when a call resolves in it. */
export function namespace(options?: { readonly tags?: Tag.Bindings }): Namespace {
  return { [namespaceSym]: true as const, tags: readMany(options?.tags) };
}

const isNamespace = (n: unknown): n is Namespace =>
  (n as { [namespaceSym]?: true } | null | undefined)?.[namespaceSym] === true;

/** An internal, defined no-namespace chain. Unlike `undefined`, it survives default parameters
 * on the resolution path, so a scope-target resource cannot regain its owner's ambient namespace. */
const NO_NAMESPACE: readonly Namespace[] = Object.freeze([]);

/** Normalize an authored `ns` to a fallback chain (one key wraps into a one-element chain) and
 * reject anything that is not a namespace — a string or a foreign object is a loud error, not a
 * silent second key space (ADR 0059: callers pass the value around; they never name one). */
function nsChainOf(ns: Ns): readonly Namespace[] {
  const chain = Array.isArray(ns) ? ns : [ns];
  if (chain.length === 0)
    raise("InvalidDependency", { label: "ns", reason: "empty namespace chain" });
  for (const key of chain) {
    if (!isNamespace(key)) raise("InvalidDependency", { label: "ns", reason: "not a namespace" });
  }
  return chain as readonly Namespace[];
}

/** Declare an operation: a function with typed input that runs on every call. */
export function operation<
  const D extends Scope.Depends = Record<string, never>,
  R = unknown,
  I = void,
>(config: {
  label: string;
  input?: Data.Parse<I>;
  depends?: D;
  run: (deps: Scope.SlotValues<D>, ctx: Operation.Ctx<I>) => R & Scope.AsyncBody<D>;
}): Operation.Handle<R, I> {
  const base = {
    [operationSym]: true,
    label: config.label,
    input: config.input,
    depends: config.depends ?? {},
    run: config.run as Operation.Handle<R, I>["run"],
  } as Operation.Handle<R, I>;
  return Object.assign(base, {
    controller: edgeTo("controller", base),
    [borrowSym]: seesResource(base.depends),
  });
}

type BorrowFlag = { readonly [borrowSym]?: boolean };

/** Read the declaration-time flag: does this operation's `depends` name a resource? Ops without one
 * skip every per-dep resource check on the call path (ADR 0044 keeps `op`/`run` untouched). */
function seesResourceOf(target: Operation.Handle<unknown, unknown>): boolean {
  return (target as BorrowFlag)[borrowSym] === true;
}

/** True when an operation's deps name a resource, directly or behind an edge. */
function seesResource(depends: Scope.Depends): boolean {
  for (const key in depends) {
    const dep = depends[key];
    if (isResource(dep)) return true;
  }
  return false;
}

/** Declare a reusable resource: built once per owner, cleaned up when its owner closes. */
export function resource<
  const D extends Scope.Depends = Record<string, never>,
  T = unknown,
>(config: {
  label: string;
  target?: "scope" | "namespace" | "session";
  depends?: D;
  factory: (deps: Scope.SlotValues<D>, ctx: Resource.Ctx) => T & Scope.AsyncBody<D>;
}): Resource.Handle<T> {
  const depends: Scope.Depends = config.depends ?? {};
  const mayHook =
    config.factory.length >= 2 ||
    Object.values(depends).some(
      (dep) => isResource(dep) && (dep as HookFlag)[mayHookSym] !== false,
    );
  return {
    [resourceSym]: true,
    [mayHookSym]: mayHook,
    label: config.label,
    target: config.target ?? "scope",
    depends,
    factory: config.factory as Resource.Handle<T>["factory"],
  } as Resource.Handle<T>;
}

type HookFlag = { readonly [mayHookSym]?: boolean };

/** Test-only: substitute a node's realization for downstream consumers of a scope (ADR 0015).
 * A `data` value is validated through `parse`; an operation takes a replacement `run`; a resource
 * takes a replacement `factory` (built and torn down like the real one). Seed via
 * `createScope({ presets: [preset(node, ...)] })`. The replacement's `deps` are delivered
 * untyped (a `Record<string, unknown>`, like the real factory) — narrow at use. A `void`-returning
 * resource is the one shape whose async/sync parity the type cannot enforce; don't preset one async. */
export function preset<T>(node: Data.Cell<T>, value: T): Scope.Preset;
export function preset<T, I>(
  node: Operation.Handle<T, I>,
  run: (deps: Record<string, unknown>, ctx: Operation.Ctx<I>) => T,
): Scope.Preset;
export function preset<T>(
  node: Resource.Handle<T>,
  factory: (deps: Record<string, unknown>, ctx: Resource.Ctx) => T,
): Scope.Preset;
export function preset(node: unknown, replacement: unknown): Scope.Preset {
  return { [presetSym]: true, node, replacement } as Scope.Preset;
}

type Entry = { value: unknown };
/** A releasable node: a data cell or a resource. Release cascades from a node to its dependents. */
type Node = Data.Cell<unknown> | Resource.Handle<unknown>;
/** One default-bucket subscription: a wrapper so the same listener subscribed twice keeps two
 * identities. The single per-layer compare lives on the node record (`notified`). */
type Watcher = { fn: (next: unknown, prev: unknown) => void };

/** One namespaced subscription. Its complete chain and comparison value belong to this watcher:
 * chains with the same head can resolve differently through their later fallbacks. */
type NsWatcher = Watcher & {
  chain: readonly Namespace[];
  notified: unknown;
};

type NsWatchers = {
  all: Set<NsWatcher>;
  byKey: Map<Namespace, Set<NsWatcher>>;
};

/** The exact data entry a named resource read. */
type NsDataDependency = { source: NodeState; entry: Entry };

/** One named resource bucket. Default resource state stays directly on {@link NodeState}. */
class NsResourceState {
  readonly owner: Layer;
  readonly target: Resource.Handle<unknown>;
  readonly key: Namespace;
  resource: Entry | undefined = undefined;
  promise: Promise<unknown> | undefined = undefined;
  failed: { error: unknown; promise: Promise<unknown> } | undefined = undefined;
  build: Promise<unknown> | undefined = undefined;
  gen = 0;
  building = false;
  dataDependencies: Set<NsDataDependency> | undefined = undefined;
  resourceDependents: Set<NsResourceState> | undefined = undefined;
  resourceDependencies: Set<NsResourceState> | undefined = undefined;
  instance: ResourceInstance | undefined = undefined;
  constructor(owner: Layer, target: Resource.Handle<unknown>, key: Namespace) {
    this.owner = owner;
    this.target = target;
    this.key = key;
  }
}

type ResourceState = NodeState | NsResourceState;

type ResourceInstance = {
  owner: Layer;
  target: Resource.Handle<unknown>;
  hooks: ((end: Scope.End) => void | PromiseLike<void>)[];
  dependencies: Set<ResourceInstance> | undefined;
  borrowers: Set<Promise<unknown>> | undefined;
  dependents: number;
  building: boolean;
  end: Scope.End | undefined;
  failure: { status: "failed"; error: unknown } | undefined;
  finishing: boolean;
  remaining: number | undefined;
  completion: Promise<void> | undefined;
  complete: (() => void) | undefined;
};

/** A hook tagged with its exact instance (undefined for onClose), kept in registration order. */
type DeferEntry = {
  fn: (end: Scope.End) => void | PromiseLike<void>;
  instance: ResourceInstance | undefined;
};

/** All per-node state for one layer, colocated in a single record so a scope allocates ONE Map
 * (`Layer.nodes`) instead of a dozen parallel ones — one `Map.get(node)` fetches everything.
 * A CLASS (not `{}` grown field-by-field) so every record shares one V8 hidden class: compact
 * allocation and monomorphic field access on the hot paths. */
class NodeState {
  /** This layer's own data-cell shadow (copy-on-write). */
  cell: Entry | undefined = undefined;
  /** Memoized nearest cell up the chain, always valid once computed (a missing cell resolves to an
   * entry holding the cell's initial value); undefined means not computed yet. */
  eff: Entry | undefined = undefined;
  /** Built resource instance — the delivered VALUE, for sync and async builds alike (ADR 0044). */
  resource: Entry | undefined = undefined;
  /** The settled build promise of an async resource: the imperative verbs (`resolve`/`get`) hand
   * it back with a stable identity; a dependency slot gets the value instead. */
  promise: Promise<unknown> | undefined = undefined;
  /** A rejected async build, sticky until release: a slot throws its error, `resolve` returns
   * the same rejected promise. */
  failed: { error: unknown; promise: Promise<unknown> } | undefined = undefined;
  build: Promise<unknown> | undefined = undefined;
  /** Resource generation (bumped on invalidation to supersede a late build). */
  gen = 0;
  /** Build currently in progress (circular-resource guard). */
  building = false;
  /** The live build; its `borrowers` are the op promises a release waits on. */
  instance: ResourceInstance | undefined = undefined;
  /** Resources that depend on this node (for cascade release/close). */
  dependents: Set<Resource.Handle<unknown>> | undefined = undefined;
  /** Memoized controller: the public `controller` path always passes an undefined observation
   * span, so a controller for (layer, node) is stable — reuse it instead of reallocating closures. */
  controller: unknown = undefined;
  /** Watchers of this cell registered at this layer (a write visits only the changed cell's). */
  watchers: Set<Watcher> | undefined = undefined;
  /** Value the watchers at this layer were last called with; refreshed at registration so a new
   * watcher never inherits a stale comparison. */
  notified: unknown = undefined;
  /** Named resource buckets at this layer. Scope-target resources never use this map. */
  nsResources: Map<Namespace, NsResourceState> | undefined = undefined;
  /** Named cell buckets at this layer, keyed by namespace (ADR 0059): one `(layer, ns, unit)`
   * bucket per write. Absent until the first namespaced write at this layer. */
  nsCells: Map<Namespace, Entry> | undefined = undefined;
  /** Named resource states keyed by the exact data entry they read. */
  nsDataDependents: Map<Entry, Set<NsResourceState>> | undefined = undefined;
  /** Namespaced watchers at this layer. Each owns its full chain and last observed value because
   * two chains with the same write head can resolve through different fallback buckets. `byKey`
   * selects only chains containing a changed named bucket; `all` serves default and child flushes. */
  nsWatchers: NsWatchers | undefined = undefined;
}

/** Keep the first-write branch here: splitting it made V8 partly inline repeated warm reads. */
function nodeState(layer: Layer, key: object): NodeState {
  let state = layer.nodes.get(key);
  if (state === undefined) {
    materialize(layer);
    state = new NodeState();
    if (layer.nodes === NO_NODES) layer.nodes = new Map();
    layer.nodes.set(key, state);
  }
  return state;
}

/** Depth of factory/op execution in progress across all scopes. Non-zero means a user body is running
 * its synchronous prefix — work it starts may not be tracked in `pending` yet — so a close called now
 * must take the full (deferred) path, never the idle fast path. */
let buildDepth = 0;

/** Materialize this layer's AbortController on first `ctx.signal` read (kept in sync with the cheap
 * `aborted` flag). Most scopes never hand out a signal, so most never allocate one. */
function signalOf(layer: Layer): AbortSignal {
  materialize(layer);
  let ac = layer.abort;
  if (!ac) {
    ac = new AbortController();
    /** A session that ended in place is aborted with no reason minted yet: mint it here. */
    if (layer.aborted) ac.abort((layer.abortReason ??= new CancelReason()));
    layer.abort = ac;
  }
  return ac.signal;
}

/** The extension chains a root chose (ADR 0050, 0051): each is the filtered list of extensions
 * that declare that hook, or undefined when none does. One record per root, shared by every layer
 * under it, so a session reads its route from its parent instead of walking to the root. */
type ExtRoutes = {
  readonly runners: readonly Scope.Extension<unknown>[] | undefined;
  readonly writers: readonly Scope.Extension<unknown>[] | undefined;
  readonly sessions: readonly Scope.Extension<unknown>[] | undefined;
};
const NO_EXTS: ExtRoutes = { runners: undefined, writers: undefined, sessions: undefined };
/** A layer's node store, child set, owned-work set, defer list, and teardown errors start as these
 * shared empty ones, so an idle layer allocates none (performance rule 4). Never written: the first
 * write gives the layer its own ({@link nodeState}, {@link makeLayer}, {@link addWork},
 * {@link addDefer}, {@link addError}); every reader reads them as usual. */
const NO_NODES = new Map<object, NodeState>();
const NO_CHILDREN = new Set<Layer>();
const NO_WORK = new Set<Promise<unknown>>();
const NO_DEFERS: DeferEntry[] = [];
const NO_ERRORS: unknown[] = [];

/** One layer of the scope chain. A lazy frame is always a child, so promotion has a parent. */
type Layer = {
  children: Set<Layer>;
  /** Single node-keyed store: cells, effective-cache, resources, builds, generations, build-flag,
   * borrowers, dependents, and cached controllers all live in one {@link NodeState} per node. */
  nodes: Map<object, NodeState>;
  /** Named states linked to an ancestor's bucket, detached when this layer closes. */
  nsLinked?: Set<NsResourceState>;
  /** Lazily allocated: empty unless the scope was seeded with presets/tags. */
  presets: Map<unknown, unknown> | undefined;
  tags: LayerTags | undefined;
  pending: Set<Promise<unknown>>;
  defers: DeferEntry[];
  /** Live dependency holds owned by resource instances on this layer. */
  resourceHolds: number;
  /** Cancel state, decoupled from the signal so a forced close needn't dispatch abort events when no
   * factory ever asked for `ctx.signal`. `abort` (the real AbortController) is materialized lazily by
   * {@link signalOf} on first `ctx.signal` read, and kept in sync with `aborted`/`abortReason`. */
  aborted: boolean;
  abortReason: unknown;
  abort: AbortController | undefined;
  cancelled: boolean;
  swept: boolean;
  bodyEnd: Promise<Scope.Outcome> | undefined;
  failure: { cause: unknown } | undefined;
  /** Panics stuck to this layer before any recorded `failure`, in failure order; a `settle` that
   * receives one takes it back (ADR 0067). Absent until the first panic. A subflow under a run hook
   * sticks its panic twice (the hook's promise and the run's own); `recover` drops every copy. */
  panics?: unknown[];
  descendantFailure: { cause: unknown } | undefined;
  /** A tagged subflow reports its failed child session through its returned promise. In the
   * literal, so every layer shares one shape: a later add would give sessions a second map. */
  failureOwner: RunState | undefined;
  secondary: unknown[];
  body: Promise<unknown> | undefined;
  closed: boolean;
  closing: Promise<Scope.Result> | undefined;
  obs: Obs;
  trace: Observe.Trace | undefined;
  clock: Clock.Handle;
  random: Random.Handle;
  emptyCtx: Resource.Ctx | undefined;
  /** The ambient namespace chain of this layer (ADR 0059): set from the scope/session options,
   * inherited by child sessions, overridden per call through a view layer. Undefined = default. */
  ns: readonly Namespace[] | undefined;
  /** The root's extension routes, inherited by every layer under it ({@link ExtRoutes}). */
  exts: ExtRoutes;
} & ({ lazy?: false; parent: Layer | undefined } | { lazy: true; parent: Layer });

type ExtRec = { settled: boolean; value: unknown };
const EXTENSIONS = new WeakMap<Layer, Map<Scope.Extension<unknown>, ExtRec>>();

/** A session under the root's `session` hooks (ADR 0051, 0069), off the Layer record: registered
 * when the session is made, so `closeLayer` finds it with the one lookup it already made for the
 * `next()` settler. `settle` is a wrapped bare session's `next()` resolver: `closeLayer` settles it
 * when the layer's close resolves, so a session felled by its parent's cascade settles its hooks
 * like an explicit close; it is cleared at settle. `phase` holds the data for the hooks: `open`
 * until the close finishes, `held` while its data waits for the hooks to return (data cell and tag
 * reads still work), `done` once they returned. `moved` says the held store went into a `Result`
 * (`withData`). A never-closed layer's entry dies with the layer. */
type SessionHooks = {
  settle: ((ended: Scope.Result) => void) | undefined;
  phase: "open" | "held" | "done";
  moved: boolean;
};
const SESSION_HOOKS = new WeakMap<Layer, SessionHooks>();

/** Settle a wrapped bare session's `next()` with its close `Result`: attach once (the settler is
 * cleared), so repeat closes cost one lookup. `closeLayer` never rejects (ADR 0027) and a stored
 * resolver cannot throw, so the tap needs no rejection guard. */
function tapSessionHooks(
  hooks: SessionHooks | undefined,
  closing: Promise<Scope.Result>,
): Promise<Scope.Result> {
  if (hooks === undefined) return closing;
  const settle = hooks.settle;
  if (settle === undefined) return closing;
  hooks.settle = undefined;
  ignoreRejection(closing.then((ended) => settle(ended)));
  return closing;
}

/** Late use of a sealed scope fails loudly. */
function ensureOpen(layer: Layer): void {
  if (layer.closed && !hookCanRead(layer)) raise("Disposed", { reason: "scope is closed" });
}

/** THE bucket selector (ADR 0059): layers near→far; at each layer the ns chain in order, then
 * that layer's default bucket. ONE walk serves cells AND tags so the two cannot disagree on the
 * order (the spike's bug). CHAIN ORDER, decided: layers-first, namespaces-second within each
 * layer — the layer chain is the shadowing axis (a child's own write must beat anything it
 * inherits from a parent, exactly as an ns-absent write shadows), so a NEAR layer's default
 * write beats a FAR layer's named bucket; the ns chain only orders buckets within one layer.
 * The discriminator is locked by a test that fails under namespaces-first. */
function selectBucket<B>(
  layer: Layer,
  chain: readonly Namespace[],
  bucket: (layer: Layer, key: Namespace) => B | undefined,
  fallback: (layer: Layer) => B | undefined,
): B | undefined {
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    for (const key of chain) {
      const hit = bucket(cur, key);
      if (hit !== undefined) return hit;
    }
    const own = fallback(cur);
    if (own !== undefined) return own;
  }
  return undefined;
}

/** The nearest cell up the chain. The lookup is memoized where it pays: on a record this layer
 * already has, or on this layer when the cell sits two or more layers up (a deep chain stays
 * O(1) after its first read). A layer with no record whose nearest cell is at its parent reads
 * through: one map miss instead of a 17-field record it would drop at close (a tagged call's
 * child, a short session). A cell nobody wrote resolves to one entry holding the initial value,
 * memoized on the top layer, so every layer under it reads the same entry. An ancestor's memo is
 * as good as its cell: a new shadow clears the memo on its layer and below (invalidateEff). */
function effectiveEntry(
  layer: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[] | undefined = layer.ns,
): Entry {
  if (chain !== undefined) return effectiveEntryNs(layer, target, chain);
  const self = layer.nodes.get(target);
  if (self !== undefined) {
    const cached = self.eff;
    if (cached !== undefined) return cached;
    if (self.cell) return (self.eff = self.cell);
  }
  return walkEntry(layer, self, target);
}

/** A namespaced cell read through the one selector; never touches the default `eff` cache. */
function effectiveEntryNs(
  layer: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[],
): Entry {
  return (
    selectBucket(
      layer,
      chain,
      (cur, key) => cur.nodes.get(target)?.nsCells?.get(key),
      (cur) => cur.nodes.get(target)?.cell,
    ) ?? { value: target.initial }
  );
}

function readCell(
  layer: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[] | undefined = layer.ns,
): unknown {
  return effectiveEntry(layer, target, chain).value;
}

/** Creating a nearer shadow changes the effective cell for this layer and its descendants. */
function invalidateEff(layer: Layer, target: Data.Cell<unknown>): void {
  const s = layer.nodes.get(target);
  if (s) s.eff = undefined;
  for (const child of layer.children) invalidateEff(child, target);
}

function ownCell(
  layer: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[] | undefined,
): Entry {
  const s = nodeState(layer, target);
  if (!s.cell) {
    s.cell = { value: readCell(layer, target, chain) };
    invalidateEff(layer, target);
  }
  return s.cell;
}

/** Fire the changed cell's watchers on this layer, then on descendants that inherit it (a child that
 * shadows the cell, and everything under it, still sees its own value). One equality check against
 * the layer's last notified value, then every watcher runs in registration order. */
function flushCell(layer: Layer, target: Data.Cell<unknown>, key?: Namespace): void {
  flushOne(layer, target);
  flushNsWatchers(layer, target, key);
  for (const child of layer.children) {
    if (!child.nodes.get(target)?.cell) flushCell(child, target);
  }
}

/** Compare once against this layer's last notified value, then run every watcher in order,
 * handing each the value before the write beside the next one. The previous value travels
 * positionally — no pair allocated per notification — and costs a one-argument listener
 * nothing: an extra argument passed is an extra argument ignored. */
function flushOne(layer: Layer, target: Data.Cell<unknown>): void {
  const rec = layer.nodes.get(target);
  const ws = rec?.watchers;
  if (!ws?.size || !rec) return;
  const next = readCell(layer, target);
  const prev = rec.notified;
  if (!cellEq(target, prev, next)) notifyLayer(rec, ws, next, prev);
}

/** Run one layer's watchers in registration order against the value already read for the layer. */
function notifyLayer(rec: NodeState, ws: Set<Watcher>, next: unknown, prev: unknown): void {
  rec.notified = next;
  for (const w of ws) w.fn(next, prev);
}

function cellEq(target: Data.Cell<unknown>, a: unknown, b: unknown): boolean {
  return target.eq(a, b);
}

function writeCell<T>(
  layer: Layer,
  target: Data.Cell<T>,
  next: unknown,
  chain: readonly Namespace[] | undefined = layer.ns,
): void {
  if (chain !== undefined && chain.length !== 0) return writeCellNs(layer, target, chain, next);
  ensureOpen(layer);
  const value = admit(target.label, target.parse, next);
  if (cellEq(target, readCell(layer, target, chain), value)) return;
  ownCell(layer, target, chain).value = value;
  flushCell(layer, target);
}

/** A namespaced write lands at `(this layer, first key)` (ADR 0059 decision 3), seeded from the
 * current effective value (write-what-differs). The default bucket and its watchers are untouched;
 * namespaced watchers below this layer re-resolve their own chains. */
function writeCellNs(
  layer: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[],
  next: unknown,
): void {
  ensureOpen(layer);
  const value = admit(target.label, target.parse, next);
  const current = readCell(layer, target, chain);
  if (cellEq(target, current, value)) return;
  const [key] = chain;
  ownNsCell(layer, target, key, current).value = value;
  flushInheritedNsWatchers(layer, target, key);
}

function ownNsCell(layer: Layer, target: Data.Cell<unknown>, key: Namespace, seed: unknown): Entry {
  const rec = nodeState(layer, target);
  let bucket = rec.nsCells?.get(key);
  if (bucket === undefined) {
    bucket = { value: seed };
    (rec.nsCells ??= new Map()).set(key, bucket);
  }
  return bucket;
}

/** A named change reaches only watchers indexed under its key. Snapshot every affected layer
 * before firing: an earlier callback must not steal a descendant's inherited change. A default
 * cell shadow or an entry for this key blocks the change for its entire subtree; other named
 * shadows are checked per watcher chain. */
function flushInheritedNsWatchers(layer: Layer, target: Data.Cell<unknown>, key: Namespace): void {
  const pending: { fn: (n: unknown, p: unknown) => void; next: unknown; prev: unknown }[] = [];
  function collect(cur: Layer): void {
    const watchers = cur.nodes.get(target)?.nsWatchers?.byKey.get(key);
    if (watchers) pending.push(...(pendingNsWatchers(cur, target, watchers) ?? []));
    for (const child of cur.children) {
      if (!shadowsNamedChange(child, target, key)) collect(child);
    }
  }
  collect(layer);
  for (const p of pending) p.fn(p.next, p.prev);
}

function shadowsNamedChange(layer: Layer, target: Data.Cell<unknown>, key: Namespace): boolean {
  const rec = layer.nodes.get(target);
  return !!rec?.cell || !!rec?.nsCells?.has(key);
}

/** A named bucket change can affect only chains containing its key at this layer. A default
 * change or a flush inherited by a child re-resolves all chains. */
function flushNsWatchers(layer: Layer, target: Data.Cell<unknown>, key?: Namespace): void {
  const nsWatchers = layer.nodes.get(target)?.nsWatchers;
  if (!nsWatchers) return;
  const watchers = key === undefined ? nsWatchers.all : nsWatchers.byKey.get(key);
  if (!watchers?.size) return;
  const pending = pendingNsWatchers(layer, target, watchers);
  for (const p of pending ?? []) p.fn(p.next, p.prev);
}

/** Snapshot the changed watchers BEFORE any callback fires: read and record each watcher's new value
 * so a callback that writes this cell cannot change what a later watcher in this round observes. */
function pendingNsWatchers(
  layer: Layer,
  target: Data.Cell<unknown>,
  watchers: Set<NsWatcher>,
): { fn: (n: unknown, p: unknown) => void; next: unknown; prev: unknown }[] | undefined {
  let pending: { fn: (n: unknown, p: unknown) => void; next: unknown; prev: unknown }[] | undefined;
  for (const watcher of watchers) {
    const next = readCell(layer, target, watcher.chain);
    const prev = watcher.notified;
    if (cellEq(target, prev, next)) continue;
    watcher.notified = next;
    (pending ??= []).push({ fn: watcher.fn, next, prev });
  }
  return pending;
}

/** A layer's own tags: a flat list for a handful (one scan beats a map, and a tagged call brings
 * one or two), a map from tag to values for more. Readers take both; writers go through
 * {@link seedTags}. */
type LayerTags = Map<Tag.Handle<unknown>, unknown[]> | readonly Tag.Binding<unknown>[];

/** How many bindings stay a list before {@link seedTags} builds a map. */
const SMALL_TAGS = 8;

/** The binding of `target` nearest the top of a layer's own tags, list or map. */
function topTag(
  cur: Layer,
  target: Tag.Handle<unknown>,
): { present: true; value: unknown } | undefined {
  const tags = cur.tags;
  if (tags === undefined) return undefined;
  if (isTagList(tags)) {
    for (let i = tags.length - 1; i >= 0; i--) {
      const binding = tags[i];
      if (binding.tag === target) return { present: true, value: binding.value };
    }
    return undefined;
  }
  const list = tags.get(target);
  return list && list.length ? { present: true, value: list[list.length - 1] } : undefined;
}

function tagFind(
  layer: Layer,
  target: Tag.Handle<unknown>,
  chain: readonly Namespace[] | undefined = layer.ns,
): Tag.Presence<unknown> {
  if (chain !== undefined) return tagFindNs(layer, target, chain);
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const hit = topTag(cur, target);
    if (hit) return hit;
  }
  return target.hasDefault ? { present: true, value: target.def } : { present: false };
}

/** A namespaced tag read through the ONE selector (same walk as cells): the ns chain's own
 * bindings, then each layer's own bindings, nearest layer first — else the tag's default. */
function tagFindNs(
  layer: Layer,
  target: Tag.Handle<unknown>,
  chain: readonly Namespace[],
): Tag.Presence<unknown> {
  const hit = selectBucket(
    layer,
    chain,
    (cur, key) => (cur.parent === undefined ? nsTagBinding(key, target) : undefined),
    (cur) => topTag(cur, target),
  );
  if (hit) return hit;
  return target.hasDefault ? { present: true, value: target.def } : { present: false };
}

function nsTagBinding(
  key: Namespace,
  target: Tag.Handle<unknown>,
): Tag.Presence<unknown> | undefined {
  const bindings = key.tags;
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i] as Tag.Binding<unknown>;
    if (binding.tag === target) return { present: true, value: binding.value };
  }
  return undefined;
}

function tagAll(
  layer: Layer,
  target: Tag.Handle<unknown>,
  chain: readonly Namespace[] | undefined = layer.ns,
): unknown[] {
  if (chain !== undefined) return tagAllNs(layer, target, chain);
  const out: unknown[] = [];
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) appendLayerTags(out, cur, target);
  return out;
}

function appendNsTags(
  out: unknown[],
  chain: readonly Namespace[],
  target: Tag.Handle<unknown>,
): void {
  for (const key of chain) {
    const bindings = key.tags;
    for (let i = bindings.length - 1; i >= 0; i--) {
      const binding = bindings[i] as Tag.Binding<unknown>;
      if (binding.tag === target) out.push(binding.value);
    }
  }
}

/** A namespaced `.all` follows the same layers-first walk as cell selection. */
function tagAllNs(
  layer: Layer,
  target: Tag.Handle<unknown>,
  chain: readonly Namespace[],
): unknown[] {
  const out: unknown[] = [];
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    if (cur.parent === undefined) appendNsTags(out, chain, target);
    appendLayerTags(out, cur, target);
  }
  return out;
}

function tagRequired(
  layer: Layer,
  target: Tag.Handle<unknown>,
  chain: readonly Namespace[] | undefined = layer.ns,
): unknown {
  const found = tagFind(layer, target, chain);
  if (!found.present) raise("MissingTag", { label: target.label });
  return found.value;
}

function presetFor(layer: Layer, node: unknown): unknown {
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const p = cur.presets;
    if (p?.has(node)) return p.get(node);
  }
  return undefined;
}

function addWatcher(
  layer: Layer,
  target: Data.Cell<unknown>,
  rec: NodeState,
  fn: (next: unknown, prev: unknown) => void,
): () => void {
  ensureOpen(layer);
  refreshNotified(layer, target, rec);
  const w: Watcher = { fn };
  (rec.watchers ??= new Set()).add(w);
  return () => void rec.watchers?.delete(w);
}

/** Recompute this layer's last notified value when it went stale before a new watcher registers. */
function refreshNotified(layer: Layer, target: Data.Cell<unknown>, rec: NodeState): void {
  if (rec.watchers?.size) return;
  const next = readCell(layer, target);
  if (!cellEq(target, rec.notified, next)) rec.notified = next;
}

function writeWithHooks<T>(
  layer: Layer,
  target: Data.Cell<T>,
  value: T,
  chain: readonly Namespace[] | undefined = layer.ns,
): void {
  const writers = layer.exts.writers;
  if (writers === undefined) return writeCell(layer, target, value, chain);
  ensureOpen(layer);
  const at = (index: number): void => {
    if (index === writers.length) return writeCell(layer, target, value, chain);
    const ext = writers[index];
    const next = (): void => at(index + 1);
    ext.hooks!.write!(
      hookEvent({ kind: "write", cell: target, value, next }, layer, ext.label, chain),
    );
  };
  at(0);
}

/** One controller body keeps lazy reads and explicit namespace chains on the same write and
 * watch path. Only a default-chain controller on a full layer retains the effective-cell memo.
 * The memo and lazy cuts change lookup and allocation cost only, not the value read. */
function dataController<T>(
  layer: Layer,
  target: Data.Cell<T>,
  chain: readonly Namespace[] | undefined = layer.ns,
): Scope.DataController<T> {
  const rec = chain === undefined && !layer.lazy ? nodeState(layer, target) : undefined;
  const get = (): T => {
    const entry = rec?.eff;
    if (entry === undefined) return readCell(layer, target, chain) as T;
    return entry.value as T;
  };
  return {
    get,
    set: (value: T) => writeWithHooks(layer, target, value, chain),
    update: (fn: (previous: T) => T) => {
      ensureOpen(layer);
      writeWithHooks(layer, target, fn(get()), chain);
    },
    watch: (listener: (next: T, prev: T) => void) =>
      chain === undefined
        ? addWatcher(layer, target, rec ?? nodeState(layer, target), listener as Watcher["fn"])
        : addWatcherNs(layer, target, chain, listener as Watcher["fn"]),
  };
}

function addWatcherNs(
  layer: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[],
  fn: (next: unknown, prev: unknown) => void,
): () => void {
  ensureOpen(layer);
  const rec = nodeState(layer, target);
  const watcher: NsWatcher = { fn, chain, notified: readCell(layer, target, chain) };
  const nsWatchers = (rec.nsWatchers ??= { all: new Set(), byKey: new Map() });
  nsWatchers.all.add(watcher);
  const byKey = nsWatchers.byKey;
  for (const key of chain) {
    let watchers = byKey.get(key);
    if (!watchers) {
      watchers = new Set();
      byKey.set(key, watchers);
    }
    watchers.add(watcher);
  }
  return () => {
    nsWatchers.all.delete(watcher);
    for (const key of chain) {
      const watchers = byKey.get(key);
      watchers?.delete(watcher);
      if (watchers?.size === 0) byKey.delete(key);
    }
  };
}

function resolveControllerEdge(
  layer: Layer,
  target: unknown,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
): unknown {
  if (isData(target)) return dataController(layer, target, chain);
  if (isOperation(target)) return operationController(layer, target, parent, chain, caller);
  raise("InvalidDependency", { label: "edge", reason: "unknown controller target" });
}

function resolveEdge(
  layer: Layer,
  dep: Edge<string, unknown>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
): unknown {
  if (dep.kind === "controller")
    return resolveControllerEdge(layer, dep.target, parent, chain, caller);
  const target = dep.target as Tag.Handle<unknown>;
  if (dep.kind === "all") return tagAll(layer, target, chain);
  if (dep.kind === "optional") return tagFind(layer, target, chain);
  return tagRequired(layer, target, chain);
}

function resolveDep(
  layer: Layer,
  dep: Scope.Dependency,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
): unknown {
  if (isEdge(dep)) return resolveEdge(layer, dep, parent, chain, caller);
  if (isData(dep)) return readCell(layer, dep, chain);
  if (isTag(dep)) return tagRequired(layer, dep, chain);
  if (isOperation(dep)) return operationController(layer, dep, parent, chain, caller);
  if (isResource(dep)) return resourceSlot(layer, dep, parent, chain);
  if (isExtension(dep)) return resolveExtension(layer, dep);
  raise("InvalidDependency", { label: "unknown", reason: "unknown dependency" });
}

const noop = (() => {
  const fn = (): void => undefined;
  return Object.assign(fn, { debug: fn, info: fn, warn: fn, error: fn });
})();

/** Attach a rejection handler to a fire-and-forget close so an internally started close (from a
 * teardown hook) is never an unhandled rejection; the promise keeps its rejection for a later
 * external awaiter. */
function ignoreRejection(promise: Promise<unknown>): void {
  return void promise.catch(noop);
}

type Obs = {
  observing: boolean;
  clock: () => number;
  export: ((span: SpanImpl) => void) | undefined;
  historyMax: number;
  history: SpanImpl[];
  log: ((entry: Observe.Log) => void) | undefined;
  level: number;
  nextId: number;
};

const OFF_OBS: Observe.Ctx = {
  span: undefined,
  event: () => undefined,
  child: (_name, fn) => fn(undefined),
};

function nanosFromMillis(ms: number): bigint {
  const whole = Math.trunc(ms);
  return BigInt(whole) * 1_000_000n + BigInt(Math.round((ms - whole) * 1_000_000));
}

/** The one sanctioned real-clock read (ADR 0034). `scripts/check-ambient.mjs` skips the reads
 * inside a declaration tagged `@ambientSource`, and only there.
 *
 * @ambientSource */
const systemClock: Clock.Handle = {
  currentTimeMillis: () => Date.now(),
  currentTimeNanos: () =>
    nanosFromMillis(performance.timeOrigin) + nanosFromMillis(performance.now()),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      if (!signal) {
        setTimeout(resolve, ms);
        return;
      }
      let id: ReturnType<typeof setTimeout>;
      const onAbort = (): void => {
        clearTimeout(id);
        reject(signal.reason);
      };
      id = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    }),
};

/** Create a controllable clock for tests: virtual time starts at `now` (default `0`) and only
 * moves when you call `advance`/`setTime`. Pass it to `createScope({ clock })` (ADR 0034). */
export function makeTestClock(options?: Clock.Options): Clock.Test {
  let now = options?.now ?? 0;
  const waiters = new Set<{ at: number; wake: () => void }>();
  const drain = (): void => {
    for (const w of [...waiters].sort((a, b) => a.at - b.at)) {
      if (w.at <= now) {
        waiters.delete(w);
        w.wake();
      }
    }
  };
  return {
    currentTimeMillis: () => Math.trunc(now),
    currentTimeNanos: () => nanosFromMillis(now),
    sleep: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        if (ms <= 0) return resolve();
        const w = { at: now + ms, wake: resolve };
        waiters.add(w);
        if (signal) {
          const onAbort = (): void => {
            waiters.delete(w);
            reject(signal.reason);
          };
          w.wake = () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }),
    advance: (ms) => {
      now += ms;
      drain();
    },
    setTime: (ms) => {
      now = ms;
      drain();
    },
  };
}

/** The one sanctioned real-random read (ADR 0062). `scripts/check-ambient.mjs` skips the reads
 * inside a declaration tagged `@ambientSource`, and only there.
 *
 * @ambientSource */
const systemRandom = {
  source: { next: () => Math.random(), uuid: () => crypto.randomUUID() },
  seed: () => {
    const [a, b, c, d] = crypto.getRandomValues(new Int32Array(4));
    return { a: a!, b: b!, c: c!, d: d! || 1 };
  },
};

/** Create a seeded randomness source for tests: the same `seed` replays the same `next` and `uuid`
 * stream, drawn from one mulberry32 generator. Pass it to `createScope({ random })` (ADR 0062). */
export function makeTestRandom(options?: Random.Options): Random.Handle {
  let state = (options?.seed ?? 0) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uuid = (): string => {
    let out = "";
    for (let i = 0; i < 16; i++) {
      let byte = Math.trunc(next() * 256) & 0xff;
      if (i === 6) byte = (byte & 0x0f) | 0x40;
      if (i === 8) byte = (byte & 0x3f) | 0x80;
      out += byte.toString(16).padStart(2, "0");
      if (i === 3 || i === 5 || i === 7 || i === 9) out += "-";
    }
    return out;
  };
  const random = { next, uuid };
  SpanImpl.seedRandom(random, options?.seed ?? 0);
  return random;
}

const DEFAULT_OBS: Obs = {
  observing: false,
  clock: Date.now,
  export: undefined,
  historyMax: 0,
  history: [],
  log: undefined,
  level: 0,
  nextId: 1,
};

/** Span and log times read `observe.clock` if set, else the scope's ambient clock, so a test clock
 * freezes them too (ADR 0034). */
function makeObs(config: Observe.Config | undefined, clock: Clock.Handle): Obs {
  if (!config) return DEFAULT_OBS;
  const c = config;
  const historyMax = c.history ?? 0;
  return {
    observing: c.export !== undefined || historyMax > 0,
    clock: c.clock ?? (() => clock.currentTimeMillis()),
    export: c.export,
    historyMax,
    history: [],
    log: c.log,
    level: c.level ?? 0,
    nextId: 1,
  };
}

/** Keep the off check small enough to inline; id creation runs only behind it. */
function openSpan(
  obs: Obs,
  layer: Layer,
  parent: SpanImpl | undefined,
  name: string,
  kind: Observe.Kind,
): SpanImpl | undefined {
  if (!obs.observing) return undefined;
  return new SpanImpl(obs, layer, parent, name, kind);
}

/** Bits are drawn at open. Text is made only on read; children share the trace cache.
 * Parent bits are copied so a saved child does not retain its parent's events and attributes. */
class SpanImpl implements Observe.Span {
  declare readonly id: number;
  declare readonly parentId: number | undefined;
  declare readonly name: string;
  declare readonly kind: Observe.Kind;
  declare readonly start: number;
  declare readonly sampled: boolean;
  end: number | undefined = undefined;
  status: "ok" | "failed" | undefined = undefined;
  declare error?: unknown;
  private static system: ReturnType<typeof systemRandom.seed> | undefined;
  private static seeded = new WeakMap<Random.Handle, ReturnType<typeof systemRandom.seed>>();
  declare private trace:
    | { a: number; b: number; c: number; d: number; text: string | undefined }
    | undefined;
  declare private a: number;
  declare private b: number;
  declare private high: number;
  declare private low: number;
  declare private parentHigh: number;
  declare private parentLow: number;
  declare private text: string | undefined;
  declare private parentText: string | undefined;
  declare private attrs: Record<string, unknown> | undefined;
  declare private marks: Observe.Event[] | undefined;

  constructor(
    obs: Obs,
    layer: Layer,
    parent: SpanImpl | undefined,
    name: string,
    kind: Observe.Kind,
  ) {
    const random = SpanImpl.randomFor(layer.random);
    this.trace = SpanImpl.traceFor(layer, parent);
    if (this.trace === undefined) {
      this.a = SpanImpl.word(random);
      this.b = SpanImpl.word(random);
    } else {
      this.a = 0;
      this.b = 0;
    }
    this.high = SpanImpl.word(random);
    this.low = SpanImpl.word(random) || 1;
    if (parent === undefined) {
      this.parentHigh = 0;
      this.parentLow = 0;
      this.parentText = layer.trace?.parentSpanId;
      this.parentId = undefined;
      this.sampled = layer.trace?.sampled !== false;
    } else {
      this.parentHigh = parent.high;
      this.parentLow = parent.low;
      this.parentText = undefined;
      this.parentId = parent.id;
      this.sampled = parent.sampled;
    }
    this.id = obs.nextId++;
    this.name = name;
    this.kind = kind;
    this.start = obs.clock();
  }

  get traceId(): string {
    const trace = this.traceBits();
    return (trace.text ??= SpanImpl.hex(trace.a, trace.b) + SpanImpl.hex(trace.c, trace.d));
  }

  get spanId(): string {
    return (this.text ??= SpanImpl.hex(this.high, this.low));
  }

  get parentSpanId(): string | undefined {
    if (this.parentId === undefined) return this.parentText;
    return (this.parentText ??= SpanImpl.hex(this.parentHigh, this.parentLow));
  }

  get attributes(): Record<string, unknown> {
    return (this.attrs ??= {});
  }

  get events(): Observe.Event[] {
    return (this.marks ??= []);
  }

  toJSON(): Observe.Span {
    return {
      id: this.id,
      parentId: this.parentId,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      sampled: this.sampled,
      name: this.name,
      kind: this.kind,
      start: this.start,
      end: this.end,
      status: this.status,
      ...(this.error === undefined ? {} : { error: this.error }),
      attributes: this.attributes,
      events: this.events,
    };
  }

  /** Test handles keep a second stream outside their public shape (ADR 0009). */
  static seedRandom(random: Random.Handle, seed: number): void {
    const state = { a: seed | 0, b: 362436069, c: 521288629, d: 88675123 };
    for (let n = 0; n < 8; n++) SpanImpl.word(state);
    SpanImpl.seeded.set(random, state);
  }

  /** Marsaglia's xorshift128: four nonzero-together 32-bit words, never user draws. */
  private static word(state: ReturnType<typeof systemRandom.seed>): number {
    const t = state.a ^ (state.a << 11);
    state.a = state.b;
    state.b = state.c;
    state.c = state.d;
    return (state.d = state.d ^ (state.d >>> 19) ^ t ^ (t >>> 8));
  }

  private static randomFor(random: Random.Handle): ReturnType<typeof systemRandom.seed> {
    return (
      (random === systemRandom.source ? undefined : SpanImpl.seeded.get(random)) ??
      (SpanImpl.system ??= systemRandom.seed())
    );
  }

  private static traceFor(layer: Layer, parent: SpanImpl | undefined): SpanImpl["trace"] {
    if (parent !== undefined) return parent.traceBits();
    if (layer.trace !== undefined) return { a: 0, b: 0, c: 0, d: 0, text: layer.trace.traceId };
    return undefined;
  }

  /** A root's last two trace words also name its span. Unread childless roots need no record. */
  private traceBits(): NonNullable<SpanImpl["trace"]> {
    return (this.trace ??= {
      a: this.a,
      b: this.b,
      c: this.high,
      d: this.low,
      text: undefined,
    });
  }

  private static hex(high: number, low: number): string {
    return (high >>> 0).toString(16).padStart(8, "0") + (low >>> 0).toString(16).padStart(8, "0");
  }
}

function isolate(run: () => unknown): void {
  try {
    const result = run();
    if (isThenable(result)) ignoreRejection(Promise.resolve(result));
  } catch (error) {
    void error;
  }
}

function closeSpan(
  obs: Obs,
  span: SpanImpl | undefined,
  status: "ok" | "failed",
  error?: unknown,
): void {
  if (!span || span.end !== undefined) return;
  const end = obs.clock();
  span.end = end;
  span.status = status;
  if (status === "failed") span.error = error;
  if (obs.historyMax > 0) {
    obs.history.push(span);
    if (obs.history.length > obs.historyMax) obs.history.shift();
  }
  const sink = obs.export;
  if (sink) isolate(() => sink(span));
  logStep(obs, span, status, end);
}

function logStep(obs: Obs, span: SpanImpl, status: "ok" | "failed", end: number): void {
  const log = obs.log;
  if (span.kind !== "operation" || !log) return;
  const level = status === "ok" ? LEVELS.debug : LEVELS.error;
  if (level < obs.level) return;
  isolate(() =>
    log({
      time: end,
      level,
      message: span.name,
      attributes: { ms: end - span.start, outcome: status },
      span,
    }),
  );
}

function settleSpan(obs: Obs, span: SpanImpl, result: unknown): void {
  if (!(result instanceof Promise)) {
    closeSpan(obs, span, "ok");
    return;
  }
  ignoreRejection(
    result.then(
      () => closeSpan(obs, span, "ok"),
      () => closeSpan(obs, span, "failed"),
    ),
  );
}

function obsCtx(layer: Layer, span: SpanImpl | undefined): Observe.Ctx {
  if (!span) return OFF_OBS;
  const obs = layer.obs;
  return {
    span,
    event: (name, attributes) => {
      span.events.push({ name, time: obs.clock(), attributes: attributes ?? {} });
    },
    child: (name, fn) => {
      const child = openSpan(obs, layer, span, name, "manual");
      let result: unknown;
      try {
        result = fn(child);
      } catch (error) {
        closeSpan(obs, child, "failed");
        throw error;
      }
      if (child) settleSpan(obs, child, result);
      return result as ReturnType<typeof fn>;
    },
  };
}

function logFor(obs: Obs, span: SpanImpl | undefined, extension?: string): Observe.Logger {
  const sink = obs.log;
  if (!sink) return noop;
  const at = (level: number) => (message: string, attributes?: Record<string, unknown>) => {
    if (level < obs.level) return;
    isolate(() =>
      sink({
        time: obs.clock(),
        level,
        message,
        attributes: extension === undefined ? (attributes ?? {}) : { ...attributes, extension },
        span,
      }),
    );
  };
  const log = at(LEVELS.info) as Observe.Logger;
  for (const name in LEVELS) {
    log[name as keyof typeof LEVELS] = at(LEVELS[name as keyof typeof LEVELS]);
  }
  return log;
}

function recordUsed(
  obs: Obs,
  caller: SpanImpl | undefined,
  target: Resource.Handle<unknown>,
): void {
  if (caller) {
    caller.events.push({ name: "used", time: obs.clock(), attributes: { resource: target.label } });
  }
}

/** The caller a `settle` twin controller runs for: a failure it receives never fails the layer. */
const RECOVERED: unique symbol = Symbol("recovered");
/** Who receives a subflow's failure: the calling run's ctx, or `settle`. */
type RunState = OperationCtx<unknown> | typeof RECOVERED;

/** An operation's controller: `run` is an own field callers destructure; `settle` is built on its
 * first read and kept, so a controller made for one run pays nothing for it. */
class OperationControl<T, I> {
  /** `declare`: assigned once in the constructor, so the build emits no field that is written twice. */
  declare readonly run: (call?: Scope.Invocation<I>) => unknown;
  declare private layer: Layer;
  declare private target: Operation.Handle<T, I>;
  declare private parent: SpanImpl | undefined;
  declare private chain: readonly Namespace[] | undefined;
  declare private hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I>;
  /** Set on the first `settle` read only; `declare` keeps them off the constructor's shape. */
  declare private twin: OperationControl<T, I> | undefined;
  declare private settler: ((call?: Scope.Invocation<I>) => unknown) | undefined;
  constructor(
    run: (call?: Scope.Invocation<I>) => unknown,
    layer: Layer,
    target: Operation.Handle<T, I>,
    parent: SpanImpl | undefined,
    chain: readonly Namespace[] | undefined,
    hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I>,
  ) {
    this.run = run;
    this.layer = layer;
    this.target = target;
    this.parent = parent;
    this.chain = chain;
    this.hookTarget = hookTarget;
  }
  get settle(): (call?: Scope.Invocation<I>) => unknown {
    if (this.settler === undefined) {
      const layer = this.layer;
      const twin = OperationControl.recovered(this);
      this.settler = (call) => settleRun(layer, () => twin.run(call), call?.signal);
    }
    return this.settler;
  }
  /** The same controller with `settle`'s caller, built on first use and kept, so `run` itself
   * carries no receiver. */
  static recovered<U, J>(control: OperationControl<U, J>): OperationControl<U, J> {
    return (control.twin ??= operationController(
      control.layer,
      control.target,
      control.parent,
      control.chain,
      RECOVERED,
      control.hookTarget,
    ) as OperationControl<U, J>);
  }
}

/** Where a failed run's error goes: a `settle` receives it as a value; any other run sticks it. */
function runFailure(layer: Layer, caller: RunState | undefined): (error: unknown) => void {
  if (caller === RECOVERED) return noop;
  return (error) => stick(layer, error);
}

/** A panic sticks to the layer its run ran in, the moment the run fails (ADR 0067): a later
 * `try/catch` cannot undo it; only a `settle` that receives it can. A managed error is a value and
 * a cancel reason is a cancellation, so neither sticks. A layer already failing keeps its first
 * failure (ADR 0028), so a panic after that needs no record. */
function stick(layer: Layer, error: unknown): void {
  if (layer.failure !== undefined || isCancel(layer, error) || failureKind(error) === "error")
    return;
  materialize(layer);
  (layer.panics ??= []).push(error);
}

/** A layer's first real failure: a stuck panic, when there is one, came before any `failure`.
 * Indexed, not destructured: array destructuring runs the iterator protocol, which made this
 * hot check too big for V8 to inline into close. */
function failureOf(layer: Layer): { cause: unknown } | undefined {
  const panics = layer.panics;
  return panics === undefined ? layer.failure : { cause: panics[0] };
}

/** Track owned async work so `settled()`/`close` join it. `onReject` decides where a rejection
 * goes: the owner's primary failure (operations, current-generation builds) or the secondary
 * bucket (release/abandoned cleanups) which never changes the outcome (ADR 0017). */
function track(
  layer: Layer,
  result: unknown,
  onReject: (error: unknown) => void,
  onSettle?: (status: "ok" | "failed", error?: unknown) => void,
): void {
  if (!isThenable(result)) {
    onSettle?.("ok");
    return;
  }
  const tracked: Promise<unknown> = Promise.resolve(result).then(
    () => {
      layer.pending.delete(tracked);
      onSettle?.("ok");
    },
    (error: unknown) => {
      layer.pending.delete(tracked);
      onReject(error);
      onSettle?.("failed", error);
    },
  );
  addWork(layer, tracked);
}

/** Add owned work to a layer, giving it its own set on the first add ({@link NO_WORK}). */
function addWork(layer: Layer, work: Promise<unknown>): void {
  materialize(layer);
  if (layer.pending === NO_WORK) layer.pending = new Set();
  layer.pending.add(work);
}

/** Resource builds already own node state; scope and extension handles already have full layers. */
function addDefer(layer: Layer, entry: DeferEntry): void {
  if (layer.defers === NO_DEFERS) layer.defers = [];
  layer.defers.push(entry);
}

/** Every abort reason we mint carries this brand, so a rejection can be recognized as one of OUR
 * cancellations regardless of WHICH layer's abort produced it — a cancelled child rejects with its
 * own reason, and its awaiting parent must still read that as a clean cancel, not a failure (r11). */
const cancelBrand: unique symbol = Symbol("cancel");

/** A forced close's cancel reason. It reads like the web's `AbortError` — `name`, `message`, and
 * `String(reason)` → `"AbortError: …"` — so text built from it says why the work stopped. The brand
 * lets `isCancelReason` tell it from a foreign `AbortError`. It is an own field, not a prototype
 * getter: the getter-only instance made `close()` measurably slower (lifecycle +3%). Not an `Error`:
 * every forced close (each session close) mints one, and a stack capture there costs. */
class CancelReason {
  readonly [cancelBrand] = true;

  get name(): string {
    return "AbortError";
  }

  get message(): string {
    return "The scope closed before this work finished.";
  }

  toString(): string {
    return `${this.name}: ${this.message}`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

function isCancelReason(error: unknown): boolean {
  return typeof error === "object" && error !== null && cancelBrand in error;
}

/** A rejection caused by this cancellation (ADR 0026, 0090): the owner must be aborted and the
 * error must be its exact reason, or a Core cancel reason from an awaited descendant. A different
 * real error still fails, even if it arrives after abort. */
function isCancel(layer: Layer, error: unknown): boolean {
  return layer.aborted && (error === layer.abortReason || isCancelReason(error));
}

function endFor(layer: Layer, status: "ok" | "failed", error: unknown): Scope.End {
  if (status === "failed")
    return isCancel(layer, error) ? { status: "cancelled" } : { status: "failed", error };
  return layer.aborted ? { status: "cancelled" } : SUCCESS;
}

/** Layers whose teardown callbacks (cleanups/hooks) are executing right now, by depth. */
const teardownDepth = new Map<Layer, number>();

function enterTeardown(layer: Layer): void {
  teardownDepth.set(layer, (teardownDepth.get(layer) ?? 0) + 1);
}
function exitTeardown(layer: Layer): void {
  const next = (teardownDepth.get(layer) ?? 1) - 1;
  if (next <= 0) teardownDepth.delete(layer);
  else teardownDepth.set(layer, next);
}

/** True if closing `target` would join a layer that is mid-teardown — `target` is that layer or an
 * ancestor of it — so a re-entrant close from within a (descendant) teardown must not wait on itself.
 * A close of an unrelated scope from a cleanup is not re-entrant and gets its real closing promise. */
function closeWouldReenter(target: Layer): boolean {
  return teardownDepth.size !== 0 && reentersTeardown(target);
}

/** Run `defer` fns in reverse (LIFO) from index `from`, passing `end`, awaiting each before the next
 * so teardown order holds. Stays synchronous while the fns are; the first async one hands the rest to
 * a tracked continuation joined by close. Failures collect as secondary errors, surfaced via
 * `TeardownFailed`, never settling the owner's outcome (ADR 0017, 0026). Returns `undefined` when the
 * whole drain finished synchronously, else a promise that resolves when the async tail completes — so
 * a release chain can wait for a dependent owner's FULL cleanup before tearing down its base (lt2). */
function runDefers(
  layer: Layer,
  fns: ((end: Scope.End) => void | PromiseLike<void>)[],
  end: Scope.End,
  from: number = fns.length - 1,
): Promise<void> | undefined {
  for (let i = from; i >= 0; i--) {
    let pending: void | PromiseLike<void>;
    enterTeardown(layer);
    try {
      pending = fns[i](end);
    } catch (error) {
      addError(layer, error);
      continue;
    } finally {
      exitTeardown(layer);
    }
    if (!isThenable(pending)) continue;
    const rest = i - 1;
    const cont: Promise<void> = Promise.resolve(pending).then(
      () => {
        layer.pending.delete(cont);
        return runDefers(layer, fns, end, rest);
      },
      (error: unknown) => {
        layer.pending.delete(cont);
        addError(layer, error);
        return runDefers(layer, fns, end, rest);
      },
    );
    addWork(layer, cont);
    return cont;
  }
  return undefined;
}

/** An operation's parsed raw input (no parser means void input). A throwing parse is the edge
 * rejecting the value: `DataValidationFailed { label, cause }`, the same registry error a data or tag
 * parse raises — so a driver maps it (400) without knowing the parser. */
function parseInput<I>(
  target: Pick<Operation.Handle<unknown, I>, "label" | "input">,
  rawInput: unknown,
): I {
  if (!target.input) return undefined as I;
  return admit(target.label, target.input, rawInput);
}

/** Call the body now when every declared dep delivered, else after the parked builds settle
 * (ADR 0044) — the call is then a promise, which the body's type already promised. */
function runBody<T, I>(
  override: Operation.Handle<T, I>["run"] | undefined,
  target: Operation.Handle<T, I>,
  deps: Record<string, unknown>,
  ctx: Operation.Ctx<I>,
  pending: PendingSlot[] | undefined,
): T {
  if (pending === undefined) return override ? override(deps, ctx) : target.run(deps, ctx);
  return settleDeps(deps, pending).then(() =>
    override ? override(deps, ctx) : target.run(deps, ctx),
  ) as T;
}

class OperationCtx<I> implements Operation.Ctx<I> {
  declare private owner: Layer;
  private defers: ((end: Scope.End) => void | PromiseLike<void>)[] | undefined = undefined;
  declare readonly label: string;
  declare readonly rawInput: unknown;
  declare readonly input: I;
  private obsTools: Observe.Ctx | undefined;
  private logTools: Observe.Logger | undefined;
  declare readonly span: SpanImpl | undefined;
  declare readonly clock: Clock.Handle;
  declare readonly random: Random.Handle;
  constructor(
    owner: Layer,
    target: Pick<Operation.Handle<unknown, I>, "label" | "input">,
    call: Scope.Invocation<I> | undefined,
    span: SpanImpl | undefined,
  ) {
    this.owner = owner;
    this.label = target.label;
    /** The invocation's input pair, verbatim from the controller body: a defined `input` is used
     * as-is (raw = same), else `rawInput` — possibly undefined — is parsed. Computed here (once
     * per run either way) so the hot closure stays branch-budget-clean. */
    const given = call?.input;
    const rawInput = given !== undefined ? given : call?.rawInput;
    this.rawInput = rawInput;
    this.input = given !== undefined ? given : parseInput(target, rawInput);
    this.span = span;
    this.clock = owner.clock;
    this.random = owner.random;
  }
  /** These callbacks belong to this run. An async tail or teardown error grows the layer at
   * its own gate; a close during cleanup grows it through the active tagged stack. */
  readonly defer = (fn: (end: Scope.End) => void | PromiseLike<void>): void => {
    (this.defers ??= []).push(fn);
  };
  get obs(): Observe.Ctx {
    return (this.obsTools ??= obsCtx(this.owner, this.span));
  }
  get log(): Observe.Logger {
    return (this.logTools ??= logFor(this.owner.obs, this.span));
  }
  get raise(): Operation.Ctx<I>["raise"] {
    return (kind, payload) => raiseFrom(this, kind, payload);
  }
  /** A hook and its body register into one ordered defer list, even when the hook needed a
   * context before the body's input was parsed. Plain runs never call this. */
  static shareDefers(from: OperationCtx<unknown>, to: OperationCtx<unknown>): void {
    to.defers = from.defers ??= [];
  }
  static defersOf<J>(
    ctx: OperationCtx<J>,
  ): ((end: Scope.End) => void | PromiseLike<void>)[] | undefined {
    return ctx.defers;
  }
  get signal(): AbortSignal {
    return signalOf(this.owner);
  }
}

/** True when a call carries a namespace (ADR 0059): one optional `ns` read, no chain. A namespaced
 * call resolves through a view layer; anything else takes the untagged body inline below. */
function hasCallNs(call: Scope.Invocation<unknown> | undefined): boolean {
  return call?.ns !== undefined;
}

/** Tags or a signal give the call a child session (ADR 0038, 0090). Empty bindings alone
 * (`undefined`, `null`, `false`, or `[]`) leave the call on its existing owner. */
function hasCallSession<I>(
  call: Scope.Invocation<I> | undefined,
): call is Scope.Invocation<I> & ({ tags: Scope.Bindings } | { signal: AbortSignal }) {
  if (call?.signal !== undefined) return true;
  const tags = call?.tags;
  if (isNothing(tags)) return false;
  return isNotList(tags) || tags.length !== 0;
}

/** Run `target` in a child session bound with the call's tags or signal (ADR 0038, 0090) — sugar over
 * `session({ tags }, (s) => s.run(target, { input }))`. The value comes back as the body gave it
 * when the session ended in place, and through a promise when the session must wait (ADR 0072).
 * `parent` carries through so a subflow's span still nests under its caller. */
function runTagged<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  caller: RunState | undefined,
  call: Scope.Invocation<I>,
  inheritedChain: readonly Namespace[] | undefined,
): Awaited<T> | Promise<Awaited<T>> {
  const tags = call.tags;
  const chain = call.ns === undefined ? inheritedChain : nsChainOf(call.ns);
  const inner: Scope.Invocation<I> | undefined =
    call.input === undefined && call.rawInput === undefined ? undefined : stripTags(call);
  const nested = caller !== undefined;
  let tagged: Awaited<T> | Promise<Awaited<T>>;
  if (call.signal !== undefined || layer.exts.sessions !== undefined) {
    /** Hooks need a body the onion can call; cancellation needs an attached child owner. */
    tagged = runSessionWith(
      layer,
      { tags, ns: chain },
      runTaggedBody.bind(undefined, target, parent, inner, chain, nested),
      caller,
      call.signal,
    ) as Awaited<T> | Promise<Awaited<T>>;
  } else {
    tagged = runTaggedFrame(
      layer,
      target,
      parent,
      caller,
      tags as Scope.Bindings,
      chain,
      inner,
      nested,
    ) as Awaited<T> | Promise<Awaited<T>>;
  }
  if (caller) track(layer, tagged, runFailure(layer, caller));
  return tagged;
}

/** A frame grows in place, so controllers, contexts, and failure owners keep their identity. */
function materialize(layer: Layer): void {
  if (layer.lazy && !layer.closed) expandFrame(layer, layer.parent);
}

/** A tagged session before it owns anything. The prototype supplies only immutable defaults;
 * its services and bindings are retained from this call, never borrowed from a sibling. */
class TaggedFrame {
  declare parent: Layer;
  declare tags: LayerTags | undefined;
  declare ns: readonly Namespace[] | undefined;
  declare failureOwner: RunState | undefined;
  declare obs: Obs;
  declare trace: Observe.Trace | undefined;
  declare clock: Clock.Handle;
  declare random: Random.Handle;
  declare exts: ExtRoutes;
  declare previous: TaggedFrame | undefined;
  declare lazy: boolean;
  declare children: Set<Layer>;
  declare nodes: Map<object, NodeState>;
  declare presets: Map<unknown, unknown> | undefined;
  declare pending: Set<Promise<unknown>>;
  declare defers: DeferEntry[];
  declare resourceHolds: number;
  declare aborted: boolean;
  declare abortReason: unknown;
  declare abort: AbortController | undefined;
  declare cancelled: boolean;
  declare swept: boolean;
  declare bodyEnd: Promise<Scope.Outcome> | undefined;
  declare failure: { cause: unknown } | undefined;
  declare descendantFailure: { cause: unknown } | undefined;
  declare secondary: unknown[];
  declare body: Promise<unknown> | undefined;
  declare closed: boolean;
  declare closing: Promise<Scope.Result> | undefined;
  declare emptyCtx: Resource.Ctx | undefined;
  constructor(
    parent: Layer,
    tags: Scope.Bindings,
    ns: readonly Namespace[] | undefined,
    failureOwner: RunState | undefined,
    previous: TaggedFrame | undefined,
  ) {
    this.parent = parent;
    this.tags = seedTags(tags);
    this.ns = ns;
    this.failureOwner = failureOwner;
    this.obs = parent.obs;
    this.trace = parent.trace;
    this.clock = parent.clock;
    this.random = parent.random;
    this.exts = parent.exts;
    this.previous = previous;
    this.lazy = true;
  }
}

/** The untouched-frame shortcut saves allocation; the full idle path gives the same outcome. */
function endTaggedFrame(child: TaggedFrame | undefined, raw: unknown): unknown {
  if (child === undefined) return raw;
  if (child.lazy && !(raw instanceof Promise) && buildDepth === 0) {
    child.closed = true;
    child.aborted = true;
    child.closing = ENDED_CLEAN;
    child.tags = undefined;
    return raw;
  }
  materialize(child);
  return endSession(child, raw);
}

/** Only the synchronous prefix can be absent from the parent tree. Pending work promotes
 * before yielding; an explicit close promotes every active prefix before taking its snapshot. */
let activeTagged: TaggedFrame | undefined;

/** No session handle escapes this path. The first owned state attaches the frame to its parent;
 * otherwise ending only seals the context and drops the tag bindings (ADR 0071/0072). */
function runTaggedFrame<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  caller: RunState | undefined,
  tags: Scope.Bindings,
  chain: readonly Namespace[] | undefined,
  call: Scope.Invocation<I> | undefined,
  nested: boolean,
): unknown {
  let child: TaggedFrame | undefined;
  let raw: unknown;
  const previous = activeTagged;
  try {
    ensureOpen(layer);
    child = new TaggedFrame(layer, tags, chain, caller, previous);
    activeTagged = child;
    /** Growing a clean child here changes only cost; swept children need the parent's end state. */
    if (layer.swept) materialize(child);
    raw = adoptBody(runUntagged(child, target, parent, call, chain, undefined, nested));
  } catch (error) {
    raw = Promise.reject(error);
  } finally {
    /** Restore the live prefix so future closes do not walk every past tagged call. */
    activeTagged = previous;
    /** An escaped context must not retain the earlier frames through this link. */
    if (child) child.previous = undefined;
  }
  return endTaggedFrame(child, raw);
}

/** Run `target` in the call's namespace (ADR 0059). The real layer remains the owner of
 * lifecycle state and registries; the chain travels beside it through resolution. */
function runNsCall<I>(
  layer: Layer,
  target: Operation.Handle<unknown, I>,
  parent: SpanImpl | undefined,
  caller: RunState | undefined,
  call: Scope.Invocation<I> & { readonly ns: Ns },
): unknown {
  ensureOpen(layer);
  return runUntagged(layer, target, parent, stripNs(call), nsChainOf(call.ns), caller);
}

/** The ns-stripped call a namespaced run replays on its view layer: the same `input`/`rawInput`
 * selection the untagged path makes, minus `ns` (already honored by the view). */
function stripNs<I>(call: Scope.Invocation<I>): Scope.Invocation<I> | undefined {
  if (call.input !== undefined) return { input: call.input };
  if (call.rawInput !== undefined) return { rawInput: call.rawInput };
  return undefined;
}

/** The tag-stripped call a tagged run replays inside its child session (ADR 0038): the same
 * `input`/`rawInput` selection the untagged path makes, minus `tags` (already honored).
 * Only called when the call carries `input` or `rawInput` (see {@link runTagged}). */
function stripTags<I>(call: Scope.Invocation<I>): Scope.Invocation<I> {
  if (call.input !== undefined) return { input: call.input };
  return { rawInput: call.rawInput };
}

/** Release a run's borrows: the resource instances its deps held for the run's whole lifetime
 * (ADR 0026 Q2). */
function releaseBorrows(held: HeldBorrows | undefined): void {
  if (!held) return;
  for (const instance of held.list) removeBorrow(instance, held.done);
  held.settle();
}

/** End a run: drain its `defer`s in reverse order (ADR 0026), then release its borrows — after
 * the drain on the success and the throwing path alike, and after an async drain's tail. Plain
 * functions, so a sync run allocates nothing for its own end. */
function finishRun(
  layer: Layer,
  ctx: OperationCtx<unknown> | undefined,
  held: HeldBorrows | undefined,
  status: "ok" | "failed",
  error?: unknown,
): void {
  const fns = ctx ? OperationCtx.defersOf(ctx) : undefined;
  if (fns === undefined || fns.length === 0) {
    releaseBorrows(held);
    return;
  }
  const tail = runDefers(layer, fns, endFor(layer, status, error));
  if (tail) drainAsync(tail, () => releaseBorrows(held));
  else releaseBorrows(held);
}

/** How a controller replays a tagged or namespaced call: not at all, as a root run, or inside a
 * caller's run (a tagged subflow runs on its child session without its caller). */
type Replay = false | "root" | "nested";

/** A run whose failure leaves core: a `settle`, or a run with no caller around it. A nested replay
 * is inside its caller's run, so the caller's run ends the flight. */
function endsFlight(caller: RunState | undefined, replay: Replay): boolean {
  return caller === RECOVERED || (caller === undefined && replay !== "nested");
}

function finishAsyncRun<T>(
  layer: Layer,
  result: T,
  caller: RunState | undefined,
  replay: Replay,
  obs: Obs,
  span: SpanImpl | undefined,
  label: string,
  ctx: OperationCtx<unknown> | undefined,
  held: HeldBorrows | undefined,
): unknown {
  const onSettle = (status: "ok" | "failed", error?: unknown): void => {
    if (status === "failed") stampOrigin(error, label, span, ctx, endsFlight(caller, replay));
    if (span) closeSpan(obs, span, status, error);
    finishRun(layer, ctx, held, status, error);
  };
  const promise = Promise.resolve(result);
  track(layer, promise, runFailure(layer, caller), onSettle);
  return promise;
}

/** A controller's `run`: one small closure over the run's fixed facts that calls {@link runOnce}.
 * The closure is made once per controller; a replay ({@link runUntagged}) calls `runOnce` itself
 * and makes none. */
function executorFor<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  caller: RunState | undefined,
): (call?: Scope.Invocation<I>) => unknown {
  const sees = seesResourceOf(target);
  return (call?: Scope.Invocation<I>): unknown =>
    runOnce(layer, target, parent, chain, caller, false, sees, call);
}

/** The single entry every run takes — declared, subflow, and inline alike. A call carrying
 * `tags` or `signal` opens a child session for the run (ADR 0038, 0090; a value or a promise, ADR 0072); a call
 * carrying `ns` runs on a view of the layer (ADR 0059); anything else runs the body below. A plain
 * function: a controller's `run` is a one-line closure over it, and a replay on a fresh child layer
 * calls it directly, with no closure or context of its own. `sees` is the target's
 * declaration-time flag, read once per controller. The public overloads type the fork (rule 9). */
function runOnce<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  caller: RunState | undefined,
  replay: Replay,
  sees: boolean,
  call: Scope.Invocation<I> | undefined,
): unknown {
  if (hasCallSession(call)) return runTagged(layer, target, parent, caller, call, chain);
  if (hasCallNs(call))
    return runNsCall(
      layer,
      target,
      parent,
      caller,
      call as Scope.Invocation<I> & { readonly ns: Ns },
    );
  ensureOpen(layer);
  const obs = layer.obs;
  const span = openSpan(obs, layer, parent, target.label, "operation");
  const override = presetFor(layer, target) as Operation.Handle<T, I>["run"] | undefined;
  /** Hold a borrow across the op's WHOLE lifetime — body settle (or a throw) AND its own `defer`
   * drain — so a release waits for the op's cleanup (which may still touch the resource) before
   * tearing it down (ADR 0026 Q2). Taken before deps resolve (a dep's factory may release another
   * dep during resolution), released after the defer drain on BOTH the success and throwing paths.
   * A fully synchronous op runs and removes the borrow within `run()`, so a later release
   * sees no borrower and stays sync. */
  const held = takeBorrows(target);
  let ctx: OperationCtx<I> | undefined;
  let result: T;
  buildDepth++;
  try {
    ctx = new OperationCtx<I>(layer, target, call, span);
    const deps = sees
      ? readOpDeps(layer, target, span, held, chain, ctx)
      : buildPlainDeps(layer, target.depends, span, chain, ctx);
    result = runBody(override, target, deps, ctx, parked);
  } catch (error) {
    stampOrigin(error, target.label, span, ctx, endsFlight(caller, replay));
    if (caller !== RECOVERED) stick(layer, error);
    closeSpan(obs, span, "failed", error);
    finishRun(layer, ctx, held, "failed", error);
    throw error;
  } finally {
    buildDepth--;
  }
  if (!isThenable(result)) {
    if (span) closeSpan(obs, span, "ok");
    finishRun(layer, ctx, held, "ok");
    return result;
  }
  return finishAsyncRun(layer, result, caller, replay, obs, span, target.label, ctx, held);
}

function operationController<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
  hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I> = target,
): Scope.OperationController<T, I> {
  const execute = executorFor(layer, target, parent, chain, caller);
  const runners = layer.exts.runners;
  if (runners === undefined)
    return new OperationControl(
      execute,
      layer,
      target,
      parent,
      chain,
      hookTarget,
    ) as Scope.OperationController<T, I>;
  const run = (call?: Scope.Invocation<I>): unknown =>
    runHookCall(layer, target, parent, chain, caller, hookTarget, call);
  return new OperationControl(
    run,
    layer,
    target,
    parent,
    chain,
    hookTarget,
  ) as Scope.OperationController<T, I>;
}

/** Run `target` on the tagged call's session layer with the tag-stripped call (ADR 0038), through
 * {@link runOnce} directly: no controller and no closure. Its caller already applied run hooks
 * (ADR 0050); no public controller escapes. */
function runUntagged<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  call: Scope.Invocation<I> | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
  nested = false,
): T {
  return runOnce(
    layer,
    target,
    parent,
    chain,
    caller,
    nested ? "nested" : "root",
    seesResourceOf(target),
    call,
  ) as T;
}

function ownerOf(layer: Layer, target: Resource.Handle<unknown>): Layer {
  if (target.target === "session") return layer;
  let cur = layer;
  while (cur.parent) cur = cur.parent;
  return cur;
}

/** Per-dependency edge bookkeeping run when a dependency is realized (undefined for operations, which
 * form no release edges). */
type RegisterEdge = ((dep: Scope.Dependency) => void) | undefined;
type SelectedResource = (
  owner: Layer,
  target: Resource.Handle<unknown>,
  state: ResourceState,
) => void;

type PendingSlot = { key: string; build: Promise<unknown> };
/** The slots the last {@link buildDeps} parked, handed to its caller through this module slot —
 * read at once, before any other build can run (single-threaded, no await between). No per-call
 * allocation, no symbol lookup on the sync fast path; undefined when every declared dep delivered
 * synchronously. */
let parked: PendingSlot[] | undefined;

/** Build the `deps` object a factory/run reads. Every declared dependency is resolved EAGERLY here,
 * before the body runs (ADR 0026 for data, ADR 0044 for resources): a data snapshot, tag, subflow,
 * or controller is fixed at resolve time; a resource is built now — its value lands in the slot
 * when the build is sync or already settled, and a still-building async resource parks its build
 * under {@link PENDING} for the caller to await before the body. `registerEdge` records a
 * resource's dependency edge and is omitted for operations. */
function resolveSelectedDep(
  layer: Layer,
  dep: Scope.Dependency,
  span: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  selected: SelectedResource | undefined,
  caller?: RunState,
): unknown {
  return selected && isResource(dep)
    ? resourceSlot(layer, dep, span, chain, selected)
    : resolveDep(layer, dep, span, chain, caller);
}

function buildDeps(
  layer: Layer,
  depends: Scope.Depends,
  span: SpanImpl | undefined,
  registerEdge: RegisterEdge,
  chain: readonly Namespace[] | undefined = layer.ns,
  selected?: SelectedResource,
  caller?: RunState,
): Record<string, unknown> {
  const deps: Record<string, unknown> = {};
  let pending: PendingSlot[] | undefined;
  for (const key in depends) {
    const dep = depends[key];
    registerEdge?.(dep);
    const value =
      selected === undefined
        ? resolveDep(layer, dep, span, chain, caller)
        : resolveSelectedDep(layer, dep, span, chain, selected, caller);
    if (isThenable(value) && isResource(dep)) {
      (pending ??= []).push({ key, build: Promise.resolve(value) });
    }
    deps[key] = value;
  }
  parked = pending;
  return deps;
}

/** The `deps` object of a body whose `depends` name no resource: the plain eager loop, byte for
 * byte the pre-0044 hot path (`op`/`run` must not move), nothing parked. */
function buildPlainDeps(
  layer: Layer,
  depends: Scope.Depends,
  span: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
): Record<string, unknown> {
  const deps: Record<string, unknown> = {};
  for (const key in depends) deps[key] = resolveDep(layer, depends[key], span, chain, caller);
  parked = undefined;
  return deps;
}

/** An operation's deps: the parking loop when its `depends` name a resource (the declaration-time
 * flag, read once per controller), else the plain loop. Either way {@link parked} is set for the
 * caller to hand to {@link runBody}. */
function readOpDeps(
  layer: Layer,
  target: Operation.Handle<unknown, unknown>,
  span: SpanImpl | undefined,
  held: HeldBorrows | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
): Record<string, unknown> {
  return buildDeps(
    layer,
    target.depends,
    span,
    undefined,
    chain,
    held && ((owner, res, state) => addBorrow(instanceOf(owner, res, state), held)),
    caller,
  );
}

/** Await every parked build, then deliver the values into their slots. A rejected build rejects
 * here with its own error, so the call fails before the body runs (ADR 0044) — the same outcome a
 * throwing sync factory has today. */
function settleDeps(deps: Record<string, unknown>, pending: PendingSlot[]): Promise<void> {
  return Promise.all(pending.map((slot) => slot.build)).then((values) => {
    for (let i = 0; i < pending.length; i++) deps[pending[i].key] = values[i];
  });
}

function resolveResourceDeps(
  owner: Layer,
  target: Resource.Handle<unknown>,
  span: SpanImpl | undefined,
  superseded: () => boolean,
  chain: readonly Namespace[] | undefined,
  state: ResourceState,
  selected: SelectedResource | undefined,
): Record<string, unknown> {
  return buildDeps(
    owner,
    target.depends,
    span,
    (dep) => {
      const node = depNode(dep);
      /** Edges register before the factory runs (eager deps, ADR 0044); a build superseded while its
       * deps were still resolving records none, so a stale build never evicts its live replacement. */
      if (node && !superseded()) addDependent(owner, node, target, chain, state);
    },
    chain,
    selected,
  );
}

/** Only named builds need to link the exact resource bucket selected by a dependency. */
function resolveNamedResourceDeps(
  owner: Layer,
  target: Resource.Handle<unknown>,
  span: SpanImpl | undefined,
  superseded: () => boolean,
  chain: readonly Namespace[] | undefined,
  state: ResourceState,
  selected: SelectedResource | undefined,
): Record<string, unknown> {
  return resolveResourceDeps(
    owner,
    target,
    span,
    superseded,
    chain,
    state,
    (depOwner, depTarget, depState) => {
      if (!superseded() && state instanceof NsResourceState && depState instanceof NsResourceState)
        linkNsResourceDependent(depState, state);
      selected?.(depOwner, depTarget, depState);
    },
  );
}

class ResourceCtx implements Resource.Ctx {
  declare private owner: Layer;
  declare private instance: ResourceInstance;
  declare private isSettled: () => boolean;
  declare readonly label: string;
  private obsTools: Observe.Ctx | undefined;
  private logTools: Observe.Logger | undefined;
  declare readonly span: SpanImpl | undefined;
  declare readonly clock: Clock.Handle;
  declare readonly random: Random.Handle;
  readonly ns: readonly Namespace[] | undefined;
  constructor(
    instance: ResourceInstance,
    span: SpanImpl | undefined,
    isSettled: () => boolean,
    chain: readonly Namespace[] | undefined,
  ) {
    this.ns = chain?.length ? chain : undefined;
    this.owner = instance.owner;
    this.instance = instance;
    this.isSettled = isSettled;
    this.label = instance.target.label;
    this.span = span;
    this.clock = instance.owner.clock;
    this.random = instance.owner.random;
  }
  readonly defer = (fn: (end: Scope.End) => void | PromiseLike<void>): void => {
    if (this.isSettled()) raise("Disposed", { reason: "resource factory already finished" });
    this.instance.hooks.push(fn);
    addDefer(this.instance.owner, { fn, instance: this.instance });
  };
  get obs(): Observe.Ctx {
    return (this.obsTools ??= obsCtx(this.owner, this.span));
  }
  get log(): Observe.Logger {
    return (this.logTools ??= logFor(this.owner.obs, this.span));
  }
  get raise(): Resource.Ctx["raise"] {
    return (kind, payload) => raiseFrom(this, kind, payload);
  }
  get signal(): AbortSignal {
    return signalOf(this.owner);
  }
}

/** Build the ctx a resource factory receives. Only called when the factory declares a ctx param
 * (`factory.length >= 2`); otherwise a per-layer empty ctx (see {@link emptyCtxFor}) is passed, allocated at
 * most once per layer. `defer` closes over the build's `settled`/`superseded` so late registration
 * behaves correctly. */
function buildCtx(
  instance: ResourceInstance,
  span: SpanImpl | undefined,
  isSettled: () => boolean,
  chain: readonly Namespace[] | undefined,
): Resource.Ctx {
  return new ResourceCtx(instance, span, isSettled, chain);
}

/** The empty ctx has no label, so its `raise` leaves the stamp to the run the error reaches. */
const raiseUnstamped: Resource.Ctx["raise"] = (kind, payload) =>
  raiseFrom(undefined, kind, payload);

class EmptyCtx implements Resource.Ctx {
  readonly ns: readonly Namespace[] | undefined;
  readonly label = "";
  readonly obs = OFF_OBS;
  readonly log = noop;
  readonly clock: Clock.Handle;
  readonly random: Random.Handle;
  private owner: Layer;
  constructor(owner: Layer, chain?: readonly Namespace[]) {
    this.ns = chain;
    this.owner = owner;
    this.clock = owner.clock;
    this.random = owner.random;
  }
  readonly defer = (): void => {
    raise("Disposed", { reason: "resource factory declared no ctx" });
  };
  readonly raise = raiseUnstamped;
  get signal(): AbortSignal {
    return signalOf(this.owner);
  }
}

function emptyCtxFor(owner: Layer, chain: readonly Namespace[] | undefined): Resource.Ctx {
  return chain?.length ? new EmptyCtx(owner, chain) : (owner.emptyCtx ??= new EmptyCtx(owner));
}

/** Read what an extension's `start` returned: the root layer holds one record per installed
 * extension, so a session walks up (ADR 0050). Unsettled or not installed is `NotResolved`. */
function resolveExtension(layer: Layer, ext: Scope.Extension<unknown>): unknown {
  for (let current: Layer | undefined = layer; current !== undefined; current = current.parent) {
    const rec = EXTENSIONS.get(current)?.get(ext);
    if (rec !== undefined) {
      if (!rec.settled) raise("NotResolved", { label: ext.label });
      return rec.value;
    }
  }
  raise("NotResolved", { label: ext.label });
}

function instanceOf(
  owner: Layer,
  target: Resource.Handle<unknown>,
  state: ResourceState,
): ResourceInstance {
  let instance = state.instance;
  if (instance === undefined) {
    instance = {
      owner,
      target,
      hooks: [],
      dependencies: undefined,
      borrowers: undefined,
      dependents: 0,
      building: state.building,
      end: undefined,
      failure: undefined,
      finishing: false,
      remaining: undefined,
      completion: undefined,
      complete: undefined,
    };
    state.instance = instance;
  }
  return instance;
}

function hasPresetLayers(layer: Layer): boolean {
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) if (cur.presets) return true;
  return false;
}

function hasRetainedInstance(state: ResourceState): boolean {
  return !!state.instance?.hooks.length || !!state.instance?.dependencies?.size;
}

function needsHold(owner: Layer, target: Resource.Handle<unknown>, state: ResourceState): boolean {
  if (hasRetainedInstance(state)) return true;
  if (state.resource || state.failed) return false;
  return (target as HookFlag)[mayHookSym] !== false || hasPresetLayers(owner);
}

function holdDependency(dependent: ResourceInstance, dependency: ResourceInstance): void {
  if (dependent === dependency || dependent.dependencies?.has(dependency)) return;
  (dependent.dependencies ??= new Set()).add(dependency);
  dependent.owner.resourceHolds++;
  dependency.dependents++;
}

function unlinkInstance(instance: ResourceInstance, end: Scope.End): void {
  if (instance.end) return;
  instance.end = instance.failure ?? end;
  if (instance.building || instance.dependents || instance.borrowers?.size) {
    instance.completion = new Promise<void>((resolve) => (instance.complete = resolve));
    addWork(instance.owner, instance.completion);
  }
}

const readyToFinish: ResourceInstance[] = [];
let drainingReady = false;

function finishTracked(instance: ResourceInstance): void {
  const finished = finishInstance(instance);
  if (finished) ignoreRejection(finished);
}

function drainReady(): void {
  if (drainingReady) return;
  drainingReady = true;
  try {
    while (readyToFinish.length) finishTracked(readyToFinish.pop() as ResourceInstance);
  } finally {
    drainingReady = false;
  }
}

function completeInstance(instance: ResourceInstance): void {
  if (instance.dependencies)
    for (const dependency of instance.dependencies) {
      dependency.dependents--;
      instance.owner.resourceHolds--;
      readyToFinish.push(dependency);
    }
  instance.dependencies = undefined;
  if (instance.completion) instance.owner.pending.delete(instance.completion);
  instance.complete?.();
  drainReady();
}

function finishHook(
  instance: ResourceInstance,
  fn: DeferEntry["fn"],
  prior?: Promise<void>,
): Promise<void> | undefined {
  if (instance.finishing && instance.remaining === undefined) return instance.completion;
  if (!instance.finishing) {
    instance.finishing = true;
    instance.remaining = instance.hooks.length;
  }
  const run = (): Promise<void> | undefined => {
    const tail = runDefers(instance.owner, [fn], instance.end as Scope.End);
    const done = (): void => {
      instance.remaining = (instance.remaining as number) - 1;
      if (instance.remaining === 0) completeInstance(instance);
    };
    if (tail) return tail.then(done, done);
    done();
    return undefined;
  };
  if (!prior) return run();
  return prior.then(run, run);
}

/** Release extracts defers first; close owns its drain snapshot, so finish need not filter again. */
function finishInstance(
  instance: ResourceInstance,
  prior?: Promise<void>,
): Promise<void> | undefined {
  if (!instance.end || instance.finishing || isHeld(instance)) return instance.completion;
  instance.finishing = true;
  const { owner } = instance;
  const finish = (): Promise<void> | undefined => {
    const tail = runDefers(owner, instance.hooks, instance.end as Scope.End);
    if (tail)
      return tail.then(
        () => completeInstance(instance),
        () => completeInstance(instance),
      );
    completeInstance(instance);
    return undefined;
  };
  if (prior) {
    const queued = prior.then(finish, finish);
    addWork(owner, queued);
    queued.then(
      () => owner.pending.delete(queued),
      () => owner.pending.delete(queued),
    );
    return queued;
  }
  return finish();
}

function startBuildInstance(
  owner: Layer,
  target: Resource.Handle<unknown>,
  state: ResourceState,
  usesCtx: boolean,
): ResourceInstance | undefined {
  const instance = usesCtx ? instanceOf(owner, target, state) : state.instance;
  if (instance) instance.building = true;
  return instance;
}

function holdSelectedDependency(
  dependent: ResourceInstance | undefined,
  owner: Layer,
  target: Resource.Handle<unknown>,
  state: ResourceState,
  depOwner: Layer,
  depTarget: Resource.Handle<unknown>,
  depState: ResourceState,
): ResourceInstance | undefined {
  if (!needsHold(depOwner, depTarget, depState)) return dependent;
  const current = dependent ?? instanceOf(owner, target, state);
  holdDependency(current, instanceOf(depOwner, depTarget, depState));
  return current;
}

function settleResourceInstance(
  instance: ResourceInstance | undefined,
  status: "ok" | "failed",
  error?: unknown,
): void {
  if (!instance) return;
  if (status === "failed" && !instance.end) instance.failure = { status, error };
  instance.building = false;
  finishTracked(instance);
}

function publishSyncResource(
  rec: ResourceState,
  result: unknown,
  canPublish: () => boolean,
  instance: ResourceInstance | undefined,
  obs: Obs,
  span: SpanImpl | undefined,
): void {
  if (canPublish()) rec.resource = { value: result };
  settleResourceInstance(instance, "ok");
  closeSpan(obs, span, "ok");
}

function failResourceBuild(
  owner: Layer,
  target: Resource.Handle<unknown>,
  rec: ResourceState,
  gen: number,
  instance: ResourceInstance | undefined,
  error: unknown,
  obs: Obs,
  span: SpanImpl | undefined,
): never {
  if (rec.gen === gen) detachResourceDependencies(owner, target, rec);
  settleResourceInstance(instance, "failed", error);
  closeSpan(obs, span, "failed");
  throw error;
}

const NOOP_BUILD_SETTLED = (): void => undefined;

function buildHooklessResource<T>(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<T>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
  resolveDeps: typeof resolveResourceDeps,
): unknown {
  const gen = rec.gen;
  const superseded = (): boolean => rec.gen !== gen;
  const canPublish = (): boolean => !superseded() && !owner.closed;
  const obs = owner.obs;
  const span = openSpan(obs, caller, parent, target.label, "resource");
  rec.building = true;
  buildDepth++;
  try {
    const deps = resolveDeps(owner, target, span, superseded, chain, rec, undefined);
    const pending = parked;
    const ctx = emptyCtxFor(owner, chain);
    const fn = target.factory;
    const result =
      pending === undefined ? fn(deps, ctx) : settleDeps(deps, pending).then(() => fn(deps, ctx));
    if (!isThenable(result)) {
      if (canPublish()) rec.resource = { value: result };
      closeSpan(obs, span, "ok");
      return result;
    }
    return finishAsyncBuild(
      owner,
      rec,
      result,
      superseded,
      canPublish,
      NOOP_BUILD_SETTLED,
      obs,
      span,
    );
  } catch (error) {
    return failResourceBuild(owner, target, rec, gen, undefined, error, obs, span);
  } finally {
    buildDepth--;
    rec.building = false;
  }
}

function buildResource<T>(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<T>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
  resolveDeps: typeof resolveResourceDeps = resolveResourceDeps,
): unknown {
  if (rec.building) raise("CircularResource", { label: target.label });
  if (
    (target as HookFlag)[mayHookSym] === false &&
    rec.instance === undefined &&
    !hasPresetLayers(owner)
  )
    return buildHooklessResource(owner, caller, target, parent, chain, rec, resolveDeps);
  return buildTrackedResource(owner, caller, target, parent, chain, rec, resolveDeps);
}

function buildTrackedResource<T>(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<T>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
  resolveDeps: typeof resolveResourceDeps,
): unknown {
  let instance: ResourceInstance | undefined;
  const gen = rec.gen;
  const superseded = (): boolean => rec.gen !== gen;
  const canPublish = (): boolean => !superseded() && !owner.closed;
  const obs = owner.obs;
  const span = openSpan(obs, caller, parent, target.label, "resource");
  rec.building = true;
  let settled = false;
  buildDepth++;
  try {
    const override = presetFor(owner, target) as Resource.Handle<T>["factory"] | undefined;
    const fn = override ?? target.factory;
    instance = startBuildInstance(owner, target, rec, fn.length >= 2);
    const deps = resolveDeps(
      owner,
      target,
      span,
      superseded,
      chain,
      rec,
      (depOwner, depTarget, depState) => {
        instance = holdSelectedDependency(
          instance,
          owner,
          target,
          rec,
          depOwner,
          depTarget,
          depState,
        );
      },
    );
    const pending = parked;
    const ctx =
      fn.length >= 2
        ? buildCtx(instance as ResourceInstance, span, () => settled, chain)
        : emptyCtxFor(owner, chain);
    const result =
      pending === undefined ? fn(deps, ctx) : settleDeps(deps, pending).then(() => fn(deps, ctx));
    if (!isThenable(result)) {
      settled = true;
      publishSyncResource(rec, result, canPublish, instance, obs, span);
      return result;
    }
    return finishAsyncBuild(
      owner,
      rec,
      result,
      superseded,
      canPublish,
      (status, error) => {
        settled = true;
        settleResourceInstance(instance, status, error);
      },
      obs,
      span,
    );
  } catch (error) {
    settled = true;
    return failResourceBuild(owner, target, rec, gen, instance, error, obs, span);
  } finally {
    buildDepth--;
    rec.building = false;
  }
}

/** Wire up an async build: publish on success only if still current, and on rejection drop the
 * in-flight entry and (unless superseded by a replacement) cache the rejected build. A failed build is
 * sticky — a re-resolve returns the same rejection (not a fresh rebuild) until the resource is
 * released/closed, so `resolve()` stays promise-stable across a consumer's retry (e.g. React Suspense),
 * which would otherwise loop rebuilding. Its dependency edges are KEPT (not detached) while it stays
 * cached, so releasing/closing a dependency still cascades to the cached failure; release and close
 * clear `owner.resources` and detach the edges, so the sticky failure honors the normal lifetime. */
function finishAsyncBuild(
  owner: Layer,
  rec: ResourceState,
  result: PromiseLike<unknown>,
  superseded: () => boolean,
  canPublish: () => boolean,
  markSettled: (status: "ok" | "failed", error?: unknown) => void,
  obs: Obs,
  span: SpanImpl | undefined,
): Promise<unknown> {
  const build: Promise<unknown> = Promise.resolve(result).then(
    (value) => {
      markSettled("ok");
      if (rec.build === build) rec.build = undefined;
      if (canPublish()) {
        rec.resource = { value };
        rec.promise = build;
      }
      closeSpan(obs, span, "ok");
      return value;
    },
    (error: unknown) => {
      markSettled("failed", error);
      if (rec.build === build) rec.build = undefined;
      if (!superseded()) rec.failed = { error, promise: build };
      closeSpan(obs, span, "failed");
      throw error;
    },
  );
  if (!superseded()) rec.build = build;
  track(owner, build, (error) => {
    if (!superseded() && !isCancel(owner, error)) owner.failure ??= { cause: error };
  });
  return build;
}

function resourceController<T>(
  layer: Layer,
  target: Resource.Handle<T>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): Scope.ResourceController<T> {
  const owner = ownerOf(layer, target);
  /** An ns-blind controller holds the owner's node record directly. A named controller selects
   * on each read because an earlier key in a fallback chain may be built after controller creation. */
  const rec = nodeState(owner, target);
  const named = hasResourceNs(target, chain);
  return {
    resolve: () => {
      if (!named && rec.resource) {
        ensureOpen(layer);
        ensureOpen(owner);
        recordUsed(layer.obs, parent, target);
        return (rec.promise ?? rec.resource.value) as Scope.ResourceValue<T>;
      }
      const value = resourceSlot(layer, target, parent, chain);
      const state = named ? selectNsResource(owner, target, chain) : rec;
      return (state?.promise ?? value) as Scope.ResourceValue<T>;
    },
    get: () => {
      ensureOpen(layer);
      ensureOpen(owner);
      const state = named ? selectNsResource(owner, target, chain) : rec;
      if (state?.failed) return state.failed.promise as Scope.ResourceValue<T>;
      if (!state?.resource) raise("NotResolved", { label: target.label });
      return (state.promise ?? state.resource.value) as Scope.ResourceValue<T>;
    },
  };
}

function selectNsResource(
  owner: Layer,
  target: Resource.Handle<unknown>,
  chain: readonly Namespace[],
): NsResourceState | undefined {
  return selectBucket(
    owner,
    chain,
    (layer, key) => {
      const state = layer === owner ? layer.nodes.get(target)?.nsResources?.get(key) : undefined;
      return state && occupiedNsResource(state) ? state : undefined;
    },
    () => undefined,
  );
}

function occupiedNsResource(state: NsResourceState): boolean {
  return Boolean(state.resource || state.build || state.failed || state.building);
}

function ownNsResource(
  owner: Layer,
  target: Resource.Handle<unknown>,
  key: Namespace,
): NsResourceState {
  const rec = nodeState(owner, target);
  let state = rec.nsResources?.get(key);
  if (state === undefined) {
    state = new NsResourceState(owner, target, key);
    (rec.nsResources ??= new Map()).set(key, state);
  }
  return state;
}

function hasResourceNs(
  target: Resource.Handle<unknown>,
  chain: readonly Namespace[] | undefined,
): chain is readonly [Namespace, ...Namespace[]] {
  return target.target !== "scope" && chain !== undefined && chain.length > 0;
}

/** A resource in a `depends` slot (ADR 0044): the built VALUE for sync and async builds alike; a
 * still-building async resource returns its build promise, and a sticky async failure its rejected
 * one — {@link buildDeps} parks either for the caller to await before the body, so the call rejects
 * with the build's error and the body never runs. One record lookup, no controller allocation —
 * the dependency hot path. */
function resourceSlot(
  layer: Layer,
  target: Resource.Handle<unknown>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  selected?: SelectedResource,
): unknown {
  const owner = ownerOf(layer, target);
  const rec = nodeState(owner, target);
  ensureOpen(layer);
  ensureOpen(owner);
  recordUsed(layer.obs, parent, target);
  if (hasResourceNs(target, chain))
    return namedResourceSlot(owner, layer, target, parent, chain, selected);
  selected?.(owner, target, rec);
  if (rec.resource) return rec.resource.value;
  if (rec.failed) return rec.failed.promise;
  if (rec.build) return rec.build;
  const buildChain = target.target === "scope" ? NO_NAMESPACE : chain;
  return buildResource(owner, layer, target, parent, buildChain, rec);
}

function namedResourceSlot(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<unknown>,
  parent: SpanImpl | undefined,
  chain: readonly [Namespace, ...Namespace[]],
  selected?: SelectedResource,
): unknown {
  const [head] = chain;
  const state = selectNsResource(owner, target, chain) ?? ownNsResource(owner, target, head);
  selected?.(owner, target, state);
  return readResourceState(owner, caller, target, parent, chain, state);
}

function readResourceState(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<unknown>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  state: ResourceState,
): unknown {
  if (state.resource) return state.resource.value;
  if (state.failed) return state.failed.promise;
  if (state.build) return state.build;
  if (state.building) raise("CircularResource", { label: target.label });
  return buildResource(owner, caller, target, parent, chain, state, resolveNamedResourceDeps);
}

function addDependent(
  owner: Layer,
  node: Node,
  dependent: Resource.Handle<unknown>,
  chain: readonly Namespace[] | undefined,
  state: ResourceState,
): void {
  if (addNsDataDependent(owner, node, chain, state)) return;
  const s = nodeState(owner, node);
  (s.dependents ??= new Set()).add(dependent);
}

function addNsDataDependent(
  owner: Layer,
  node: Node,
  chain: readonly Namespace[] | undefined,
  dependent: ResourceState,
): boolean {
  if (!isData(node) || !(dependent instanceof NsResourceState) || chain === undefined) return false;
  const selected = selectNsDataEntry(owner, node, chain);
  if (selected === undefined) return false;
  linkNsDataDependent(selected, dependent);
  return true;
}

function linkNsResourceDependent(selected: NsResourceState, dependent: NsResourceState): void {
  (selected.resourceDependents ??= new Set()).add(dependent);
  (dependent.resourceDependencies ??= new Set()).add(selected);
  (dependent.owner.nsLinked ??= new Set()).add(dependent);
}

function linkNsDataDependent(selected: NsDataDependency, dependent: NsResourceState): void {
  const dependents =
    selected.source.nsDataDependents?.get(selected.entry) ?? new Set<NsResourceState>();
  if (dependents.has(dependent)) return;
  dependents.add(dependent);
  (selected.source.nsDataDependents ??= new Map()).set(selected.entry, dependents);
  (dependent.dataDependencies ??= new Set()).add(selected);
  (dependent.owner.nsLinked ??= new Set()).add(dependent);
}

function selectNsDataEntry(
  owner: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[],
): NsDataDependency | undefined {
  const selected = selectBucket<NsDataDependency | typeof DEFAULT_DATA_ENTRY>(
    owner,
    chain,
    (layer, key) => {
      const source = layer.nodes.get(target);
      const entry = source?.nsCells?.get(key);
      return source && entry ? { source, entry } : undefined;
    },
    (layer) => (layer.nodes.get(target)?.cell ? DEFAULT_DATA_ENTRY : undefined),
  );
  return selected === DEFAULT_DATA_ENTRY ? undefined : selected;
}

const DEFAULT_DATA_ENTRY = Symbol("default-data-entry");

function detachNsDependencies(state: NsResourceState): void {
  state.owner.nsLinked?.delete(state);
  for (const link of state.dataDependencies ?? [])
    link.source.nsDataDependents?.get(link.entry)?.delete(state);
  state.dataDependencies = undefined;
  detachNsResourceLinks(state);
}

function detachNsLinked(layer: Layer, linked: Set<NsResourceState>): void {
  for (const state of linked) detachNsDependencies(state);
  layer.nsLinked = undefined;
}

function detachNsResourceLinks(state: NsResourceState): void {
  for (const dependency of state.resourceDependencies ?? [])
    dependency.resourceDependents?.delete(state);
  for (const dependent of state.resourceDependents ?? [])
    dependent.resourceDependencies?.delete(state);
  state.resourceDependencies = undefined;
  state.resourceDependents = undefined;
}

function detachResourceDependencies(
  owner: Layer,
  dependent: Resource.Handle<unknown>,
  state: ResourceState,
): void {
  if (state instanceof NsResourceState) {
    detachNsDependencies(state);
    return;
  }
  detachDependent(owner, dependent);
}

function detachDependent(owner: Layer, dependent: Resource.Handle<unknown>): void {
  for (const s of owner.nodes.values()) {
    const set = s.dependents;
    if (set && set.delete(dependent) && set.size === 0) s.dependents = undefined;
  }
}

/** The releasable node a dependency reads through, if any — a bare data cell or its controller
 * edge, or a bare resource. Tags and operations (subflows) create no release edge. */
function depNode(dep: Scope.Dependency): Node | undefined {
  if (isData(dep)) return dep;
  if (isResource(dep)) return dep;
  if (isEdge(dep) && dep.kind === "controller" && isData(dep.target)) return dep.target;
  return undefined;
}

type HeldBorrows = { list: ResourceInstance[]; done: Promise<void>; settle: () => void };

function addBorrow(instance: ResourceInstance, held: HeldBorrows): void {
  if (held.list.includes(instance)) return;
  held.list.push(instance);
  (instance.borrowers ??= new Set()).add(held.done);
}

function takeBorrows(target: Operation.Handle<unknown, unknown>): HeldBorrows | undefined {
  if ((target as BorrowFlag)[borrowSym] !== true) return undefined;
  return createBorrows();
}

function removeBorrow(instance: ResourceInstance, work: Promise<unknown>): void {
  instance.borrowers?.delete(work);
  finishTracked(instance);
}

/** Seed a layer's tag map from the authored bindings: nothing (or only nothing, however
 * nested) leaves the map unallocated; otherwise every binding lands in authored order. */
function seedTags(input: Tag.Bindings): LayerTags | undefined {
  if (isNothing(input)) return undefined;
  if (isNotList(input)) return [input];
  const bindings = readBindings(input);
  if (bindings.length === 0) return undefined;
  if (bindings.length <= SMALL_TAGS) return bindings;
  const tags = new Map<Tag.Handle<unknown>, unknown[]>();
  for (const binding of bindings) {
    const list = tags.get(binding.tag) ?? [];
    list.push(binding.value);
    tags.set(binding.tag, list);
  }
  return tags;
}

/** The authored list as one flat list this layer retains; the caller keeps its own list. The
 * same reads as {@link readMany}: the list's own iterator, once, each item in order, nested lists
 * opened where they sit, and no method of the caller's object. The one difference is the list
 * built: the first binding becomes a one-item literal, so a tagged call's one binding never pays
 * the empty-list growth (17 slots on the first push into an empty list). */
function readBindings(
  list: readonly Many<Tag.Binding<unknown>>[],
): readonly Tag.Binding<unknown>[] {
  let out: Tag.Binding<unknown>[] | undefined;
  for (const item of list) {
    if (isNothing(item)) continue;
    if (out === undefined && isNotList(item)) out = [item];
    else pushMany((out ??= []), item, isNotList);
  }
  return out ?? NO_ITEMS;
}

type Seeded = { nodes: Map<object, NodeState>; presets: Map<unknown, unknown> | undefined };
/** A layer seeded with no preset: the shared empty store ({@link NO_NODES}), no preset map. */
const NO_PRESETS: Seeded = { nodes: NO_NODES, presets: undefined };

function seedPresets(seeds: Many<Scope.Preset>): Seeded {
  const list = readMany(seeds);
  if (list.length === 0) return NO_PRESETS;
  const nodes = new Map<object, NodeState>();
  return { nodes, presets: applyPresets(nodes, list) };
}

function makeRootLayer(options: Scope.Options | undefined): Layer {
  const clock = options?.clock ?? systemClock;
  const obs = makeObs(options?.observe, clock);
  return layerRecord(
    undefined,
    options,
    obs,
    clock,
    options?.random ?? systemRandom.source,
    NO_EXTS,
  );
}

/** The ambient namespace chain of a new layer: the options' `ns` (validated), else the parent's
 * — a child session inherits the parent's ambient namespace (ADR 0059 decision 5). */
function nsFor(
  parent: Layer | undefined,
  options: Scope.Options | undefined,
): readonly Namespace[] | undefined {
  if (options?.ns === NO_NAMESPACE) return NO_NAMESPACE;
  if (options?.ns !== undefined) return nsChainOf(options.ns);
  return parent?.ns;
}

/** Handles create these children from full layers; tagged frames use their own constructor.
 * Inherit the services, bindings, and any close already under way above the child. */
function makeLayer(parent: Layer, options?: Scope.Options): Layer {
  const layer = layerRecord(parent, options, parent.obs, parent.clock, parent.random, parent.exts);
  if (parent.children === NO_CHILDREN) parent.children = new Set();
  parent.children.add(layer);
  /** Born into a subtree already being collected by an active ancestor close: inherit `swept` so this
   * late child's real failure + teardown errors still push up to the collecting ancestor when it
   * finishes; inherit the abort if the ancestor close is FORCED (creation under a CLOSED scope is
   * blocked by `ensureOpen`, so a swept-but-open parent means an ancestor is mid-close). */
  if (parent.swept) layer.swept = true;
  if (parent.aborted) {
    layer.aborted = true;
    layer.abortReason = parent.abortReason;
  }
  return layer;
}

/** The one literal every layer starts from, so every layer shares one shape. The tag and preset
 * seeds are called only when the options carry them: a helper that never runs here stays out of
 * V8's inlining budget for the session start. */
function layerRecord(
  parent: Layer | undefined,
  options: Scope.Options | undefined,
  obs: Obs,
  clock: Clock.Handle,
  random: Random.Handle,
  exts: ExtRoutes,
): Layer {
  const tags = options?.tags === undefined ? undefined : seedTags(options.tags);
  const seeded = options?.presets === undefined ? NO_PRESETS : seedPresets(options.presets);
  return {
    parent,
    children: NO_CHILDREN,
    nodes: seeded.nodes,
    presets: seeded.presets,
    tags,
    pending: NO_WORK,
    defers: NO_DEFERS,
    resourceHolds: 0,
    aborted: false,
    abortReason: undefined,
    abort: undefined,
    cancelled: false,
    swept: false,
    bodyEnd: undefined,
    failure: undefined,
    descendantFailure: undefined,
    failureOwner: undefined,
    secondary: NO_ERRORS,
    body: undefined,
    closed: false,
    closing: undefined,
    obs,
    trace: obs.observing ? traceFor(parent, options?.trace) : undefined,
    clock,
    random,
    emptyCtx: undefined,
    ns: nsFor(parent, options),
    exts,
  };
}

/** Copy the driver's seed once; descendants share the owned copy. */
function traceFor(
  parent: Layer | undefined,
  trace: Observe.Trace | null | undefined,
): Observe.Trace | undefined {
  if (trace === null) return undefined;
  return trace === undefined ? parent?.trace : { ...trace };
}

/** Mark a layer's whole subtree `swept`, iteratively (no recursion — deep trees are safe). Run
 * SYNCHRONOUSLY at close-call time so a descendant that finishes and detaches before this close's async
 * body runs is still marked — then `finishLayer` pushes its real failure + teardown errors up to its
 * parent, and a collecting ancestor sees them at any depth. A layer's own close never marks itself, so
 * a unit that fails independently does not propagate. */
function markSwept(root: Layer): void {
  const stack: Layer[] = [...root.children];
  while (stack.length) {
    const layer = stack.pop() as Layer;
    layer.swept = true;
    for (const child of layer.children) stack.push(child);
  }
}

/** Abort a layer and its whole subtree (forced teardown), sharing the root's reason so `isCancel`
 * recognizes the cancel across the subtree and awaited work unblocks. Run inside the async close body
 * (not at call time) so it does not race ahead of the body's own settlement — a body that already
 * resolved is classified `success`, not flipped to `cancelled` by a later forced close. */
function markAborted(layer: Layer, reason: unknown): void {
  if (layer.aborted) return;
  layer.aborted = true;
  layer.abortReason = reason;
  /** Only fire the real signal if one was ever handed to a factory (else there are no listeners). */
  layer.abort?.abort(reason);
}

function abortSubtree(
  root: Layer,
  reason = root.aborted ? root.abortReason : new CancelReason(),
): void {
  markAborted(root, reason);
  const stack: Layer[] = [...root.children];
  while (stack.length) {
    const layer = stack.pop() as Layer;
    markAborted(layer, reason);
    for (const child of layer.children) stack.push(child);
  }
}

const SUCCESS: Scope.Outcome = { status: "success" };
/** A scope with no extensions is ready at once: one shared, already-resolved promise. */
const READY: Promise<void> = Promise.resolve();
const RELEASED: Scope.End = { status: "released" };

/** Drain a layer's `defer`s in reverse registration order (LIFO, ADR 0026), awaiting each before the
 * next, passing the settled `end`; teardown failures collect in `layer.secondary` in execution order
 * (→ `TeardownFailed`). The teardown guard spans the synchronous call so a callback that synchronously
 * re-enters `close()` is acked (Q3 no-hang). */
async function finishCloseInstance(entry: DeferEntry): Promise<void> {
  const instance = entry.instance as ResourceInstance;
  if (isHeld(instance)) {
    finishTracked(instance);
    return;
  }
  const finished = finishHook(instance, entry.fn);
  if (finished) await finished;
}

async function drainCloseEntry(layer: Layer, entry: DeferEntry, end: Scope.End): Promise<void> {
  if (entry.instance) return finishCloseInstance(entry);
  let pending: void | PromiseLike<void>;
  enterTeardown(layer);
  try {
    pending = entry.fn(end);
  } catch (cause) {
    addError(layer, cause);
    return;
  } finally {
    exitTeardown(layer);
  }
  try {
    await pending;
  } catch (cause) {
    addError(layer, cause);
  }
}

/** An empty drain still yields at its caller's await, without allocating an async task. */
function drainDefers(layer: Layer, entries: DeferEntry[], end: Scope.End): Promise<void> {
  return entries.length === 0 ? READY : drainEntries(layer, entries, end);
}

/** The reality-only settlement reducer (ADR 0028): a real failure wins — the body threw, an owned-work
 * op rejected, or a descendant really failed (bubbled into `layer.failure`/`descendantFailure`) — then
 * an interrupted body settles `cancelled`, else `success`. No wished outcome participates. Records the
 * winning real failure in `layer.failure` so it propagates to a collecting ancestor. A body that
 * rejects (whether it threw or surfaced a descendant failure it awaited) is a real body failure; we do
 * NOT distinguish an "own" throw from a "propagated" one (unknowable by value — rounds 7–9). */
function settleOutcome(layer: Layer, body: Scope.Outcome | undefined): Scope.Outcome {
  if (body?.status === "failed") {
    /** A body failure is the PRIMARY cause and outranks a caught/recorded owned-work failure, so it
     * OVERRIDES `layer.failure` (which `asPrimary` may already have set from the op) — otherwise a
     * collecting ancestor would push up the owned-work error while this layer reports the body error. */
    layer.failure = { cause: body.error };
    return body;
  }
  const owned = failureOf(layer) ?? layer.descendantFailure;
  if (owned) {
    layer.failure = owned;
    return { status: "failed", error: owned.cause };
  }
  if (layer.cancelled) return { status: "cancelled" };
  return SUCCESS;
}

/** Whether a scope has nothing to tear down, so `close` can settle synchronously (see {@link fastClose}):
 * no children, no in-flight owned work, no deferred cleanups, no teardown error already collected (an
 * operation's cleanup that threw at its own end must still reach `teardownErrors`), no running body, no
 * recorded failure, and no build in progress (whose not-yet-tracked work a synchronous close would miss). */
function canFastClose(layer: Layer): boolean {
  return (
    buildDepth === 0 &&
    layer.children.size === 0 &&
    layer.pending.size + layer.resourceHolds === 0 &&
    layer.defers.length + layer.secondary.length === 0 &&
    layer.body === undefined &&
    failureOf(layer) === undefined &&
    layer.descendantFailure === undefined &&
    !closeWouldReenter(layer)
  );
}

/** O(1) close for an idle scope: mark closed, settle by mode (forced rolls back to `cancelled`, which
 * with nothing to roll back is just the status), detach from the parent, and let GC drop the layer —
 * skipping the async teardown protocol, the abort event dispatch, and `nodes.clear()`. A close that
 * asked `withData`, or a session under `session` hooks, hands the store on through {@link keepData}. */
function fastClose(
  layer: Layer,
  force: boolean,
  hooks: SessionHooks | undefined,
  withData: boolean,
): Promise<Scope.Result> {
  layer.closed = true;
  const forced = force || layer.aborted;
  let settled: Scope.Outcome = SUCCESS;
  if (forced) {
    markAborted(layer, layer.aborted ? layer.abortReason : new CancelReason());
    layer.cancelled = true;
    settled = { status: "cancelled" };
  }
  if (layer.nsLinked) detachNsLinked(layer, layer.nsLinked);
  layer.parent?.children.delete(layer);
  const ended = buildResult(settled, layer, undefined);
  layer.closing = Promise.resolve(
    hooks === undefined && !withData ? ended : keepData(layer, ended, hooks, withData),
  );
  return layer.closing;
}

/** Whether a session whose body just ended clean can end in place — {@link canFastClose}'s idle
 * test for a session's own close, where the finished body no longer blocks it: no close already
 * in flight, no ancestor's close in flight (it marked this layer swept at call time and its
 * abort is queued; the body's end must be read against that abort, ADR 0026 Q5 — an aborted
 * live layer is always swept too), no signal handed out (a forced close would dispatch abort on
 * it), no build in progress, no child, no in-flight owned work, no defer, no teardown error, and
 * {@link ownsNothing}. "No build in progress" (`buildDepth`) means a tagged subflow called while
 * another run's body has not yet returned — before that body's first `await` — always comes back
 * as a promise; the same call after an `await` can come back as a value (ADR 0072's wait list). */
function canEndIdle(layer: Layer): boolean {
  return (
    layer.closing === undefined &&
    !layer.swept &&
    layer.abort === undefined &&
    buildDepth === 0 &&
    layer.children.size === 0 &&
    layer.pending.size + layer.resourceHolds === 0 &&
    layer.defers.length + layer.secondary.length === 0 &&
    ownsNothing(layer)
  );
}

/** The rest of the idle test: no recorded failure, no re-entrant teardown, and no record on the
 * layer that is {@link busyRecord}: a built resource instance (its release protocol must run)
 * or a watcher (a write between the body's return and the close must still reach it). */
function ownsNothing(layer: Layer): boolean {
  if (
    failureOf(layer) !== undefined ||
    layer.descendantFailure !== undefined ||
    closeWouldReenter(layer)
  )
    return false;
  /** A layer still on the shared empty store holds no record, so it holds no instance and no
   * watcher (Opus, fp2/opus-e50df39). */
  if (layer.nodes === NO_NODES) return true;
  for (const state of layer.nodes.values()) if (busyRecord(state)) return false;
  return true;
}

/** The marker a session that ended in place keeps in `closing`: the shape {@link buildResult}
 * gives a clean close, behind one shared resolved promise. Never handed out — {@link closeLayer}
 * answers a late `close()` on such a session with a fresh `Result`. */
const ENDED_CLEAN: Promise<Scope.Result> = Promise.resolve({
  status: "success",
  teardownErrors: undefined,
});

/** A second/later close (any mode) returns the in-flight close's Result — the mode of the FIRST call
 * wins (no graceful→forced escalation in v1; force-close from the start if a hang is a concern). This
 * also means a session's automatic self-close does not override an in-progress explicit graceful
 * close (ADR 0028). */
function closeLayer(layer: Layer, force: boolean, withData: boolean): Promise<Scope.Result> {
  materializeActiveFrames();
  /** Only a session under a root with `session` hooks has an entry, and its route says so: a
   * no-hook close never reads the table. */
  const hooks = layer.exts.sessions === undefined ? undefined : SESSION_HOOKS.get(layer);
  if (!layer.closing) {
    if (canFastClose(layer))
      return tapSessionHooks(hooks, fastClose(layer, force, hooks, withData));
    layer.closed = true;
    layer.closing = startClose(layer, force, hooks, withData);
  }
  /** A `close()` re-entered from within this layer's (or an ancestor's) own teardown is a request-only
   * acknowledgement: return an already-resolved best-effort `Result` so it never waits on itself (no
   * hang, no throw — ADR 0026 Q3, 0027/0028). The real settled `Result` is `layer.closing`. */
  if (closeWouldReenter(layer)) {
    return Promise.resolve(buildResult(bestEffort(layer), layer, undefined));
  }
  /** A session that ended in place holds the shared marker; a late `close()` on its handle gets
   * a `Result` of its own, as every other close does (a caller may change what it was given). */
  if (layer.closing === ENDED_CLEAN)
    return Promise.resolve({ status: "success", teardownErrors: undefined });
  return tapSessionHooks(hooks, layer.closing);
}

/** Never throws, whatever `settled` holds: a `close()` always resolves to a `Result` (ADR 0027). */
function buildResult(
  settled: Scope.Outcome,
  layer: Layer,
  teardownErrors: readonly unknown[] | undefined,
): Scope.Result {
  if (settled.status === "failed") return failedResult(settled.error, teardownErrors);
  if (settled.status === "cancelled") {
    return { status: "cancelled", reason: layer.abortReason, teardownErrors };
  }
  return { status: "success", teardownErrors };
}

/** Mark body cancellation and decide whether teardown rolls the subtree back (resources see
 * `cancelled`) rather than committing gracefully: the close is forced, an ancestor already aborted
 * it, or it is FAILING — a real failure
 * (body throw, or an already-recorded owned-work / descendant failure) rolls the subtree back even
 * under a graceful close (transaction-abort). */
function prepareTeardown(layer: Layer, forced: boolean, body: Scope.Outcome | undefined): boolean {
  const rollback =
    forced ||
    body?.status === "failed" ||
    (failureOf(layer) ?? layer.descendantFailure) !== undefined;
  /** A session settles cancelled iff its body was interrupted; a bodyless scope iff teardown rolls
   * back. A body that succeeded is never cancelled by its forced self-close. */
  if (body ? body.status === "cancelled" : rollback) layer.cancelled = true;
  return rollback;
}

function collectLayerInstances(layer: Layer): ResourceInstance[] {
  const instances: ResourceInstance[] = [];
  for (const state of layer.nodes.values()) {
    if (state.instance) instances.push(state.instance);
    if (state.nsResources)
      for (const bucket of state.nsResources.values()) {
        if (bucket.instance) instances.push(bucket.instance);
      }
  }
  return instances;
}

async function closeInstances(
  layer: Layer,
  settled: Scope.Outcome,
  instances: ResourceInstance[],
): Promise<void> {
  for (const instance of instances) unlinkInstance(instance, settled);
  await drainDefers(layer, [...layer.defers], settled);
  for (const instance of instances) {
    const finished = finishInstance(instance);
    if (finished) ignoreRejection(finished);
  }
  while (layer.pending.size) await Promise.all(layer.pending);
}

/** Run a layer's close (ADR 0028): sweep the subtree, classify the body, close children, join owned
 * work, settle by reality, drain defers, then re-settle (a late child failure can land during the
 * drain) and detach. Never throws — resolves to the `Result`. A layer already aborted by an ancestor's
 * FORCED close is itself being force-torn-down whatever its own close mode, so it rolls back. The sweep
 * is SYNCHRONOUS (at close-call time) so a child that finishes and detaches before this close's async
 * body runs is still marked `swept` and its failure/errors still collected. */
function startClose(
  layer: Layer,
  force: boolean,
  hooks: SessionHooks | undefined,
  withData: boolean,
): Promise<Scope.Result> {
  const forced = force || layer.aborted;
  markSwept(layer);
  const run = async (): Promise<Scope.Result> => {
    if (forced) abortSubtree(layer);
    /** Read the end recorded when the body settled, before its own close abort (Q5).
     * A bodyless layer gets its outcome from the close request. */
    const body = await (layer.bodyEnd ?? Promise.resolve(undefined));
    const rollback = prepareTeardown(layer, forced, body);
    /** An empty child list still yields here, keeping the close phase order. */
    await (layer.children.size === 0 ? READY : closeEach(layer, rollback));
    while (layer.pending.size) await Promise.all(layer.pending);
    const settled = settleOutcome(layer, body);
    const instances = collectLayerInstances(layer);
    if (instances.length) await closeInstances(layer, settled, instances);
    else await drainDefers(layer, layer.defers, settled);
    /** Re-settle once more: a late real failure (pushed up from a child whose cleanup was parked on a
     * gate) can land WHILE we await the defers; `settleOutcome` never downgrades a recorded failure, so
     * the result stays monotonic and a collecting ancestor still sees it. */
    const finalSettled = settleOutcome(layer, body);
    const keeps = hooks !== undefined || withData;
    const teardownErrors = finishLayer(layer, keeps);
    const ended = buildResult(finalSettled, layer, teardownErrors);
    return keeps ? keepData(layer, ended, hooks, withData) : ended;
  };
  return READY.then(run);
}

/** Detach the layer and clear all its state after teardown; returns the collected teardown errors
 * (in execution order) for `TeardownFailed`, or undefined if there were none. A layer swept by an
 * ancestor's close pushes its teardown errors + failure up to its parent as it detaches, so a
 * collecting ancestor gathers descendant results at any depth even when a descendant finished and
 * detached before the intervening scopes began their own close (F1 / grandchild). A layer that
 * `keeps` its data (ADR 0069) leaves its store, presets, and tags to {@link keepData}. */
function finishLayer(layer: Layer, keeps: boolean): unknown[] | undefined {
  const teardownErrors = layer.secondary.length ? [...layer.secondary] : undefined;
  if (layer.nsLinked) detachNsLinked(layer, layer.nsLinked);
  const parent = layer.parent;
  if (parent) {
    parent.children.delete(layer);
    if (layer.swept) propagateSweptOutcome(layer, parent);
  }
  layer.pending.clear();
  layer.children.clear();
  layer.defers.length = 0;
  layer.secondary.length = 0;
  if (keeps) return teardownErrors;
  if (layer.nodes.size !== 0) {
    for (const s of layer.nodes.values()) s.eff = undefined;
    layer.nodes.clear();
  }
  clearBindings(layer);
  return teardownErrors;
}

function settleSession(
  hasFailure: boolean,
  cause: unknown,
  teardownCauses: unknown[] | undefined,
): void {
  if (hasFailure) {
    if (teardownCauses) raise("TeardownFailed", { causes: [cause, ...teardownCauses] });
    throw cause;
  }
  if (teardownCauses) raise("TeardownFailed", { causes: teardownCauses });
}

/** Run `body` in a child session of `parent`, then close it (ADR 0038): the body receives the
 * child layer directly (no handle→layer registry). The public `session()` passes
 * `(child, handle) => fn(handle ?? handleFor(child))`; a tagged call under `session` hooks passes
 * its own runner (without hooks it runs the same life itself, see {@link runTagged}). When the
 * root installed `session` hooks (ADR 0051), the whole life runs inside their onion: `next()`
 * resolves with the close `Result`. No hooks means no wrapper — the life below, inline, after one
 * field read of the parent's route; it ends in {@link endSession}. */
function runSessionWith<R>(
  parent: Layer,
  options: Scope.Options | undefined,
  body: (child: Layer, handle?: Scope.Handle) => R | PromiseLike<R>,
  caller?: RunState,
  signal?: AbortSignal,
): R | Promise<R> {
  let child: Layer;
  /** What an async function would reject with, rejected: a closed parent, a bad `ns`, a preset
   * that fails its parse. The body's own throw is not here; {@link runBodyWith} keeps it. */
  try {
    signal?.throwIfAborted();
    const sessions = parent.exts.sessions;
    ensureOpen(parent);
    child = makeLayer(parent, options);
    child.failureOwner = caller;
    if (signal) {
      /** Seal writes now, then let the session join its body and cleanup before it detaches. */
      const abort = (): void => {
        child.closed = true;
        abortSubtree(child, signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      addDefer(child, {
        fn: () => signal.removeEventListener("abort", abort),
        instance: undefined,
      });
      if (signal.aborted) abort();
    }
    if (sessions !== undefined) {
      return runSessionWrapped(child, body, sessions);
    }
  } catch (error) {
    return Promise.reject(error) as Promise<R>;
  }
  return endSession(child, runBodyWith(child, body));
}

/** End a session whose body has started. A session's handle closes when its body ends, like a
 * database transaction callback (ADR 0071): a body that returned a plain value has settled, so
 * its end is read now, as the reaction in {@link settleSessionWith} would read it one tick later,
 * and when the session has nothing left to tear down it ends in place — no body promise, no
 * reaction, no async frame, and (ADR 0072) the value comes back as the body gave it. After that,
 * `onClose`, `resolve` and `run` on a handle the body leaked raise `Disposed`, and
 * `close({ withData: true })` on it gets no data (a `close` inside the body still keeps it).
 * Anything that must wait waits in {@link settleSessionWith}. `raw` is a native promise or a
 * plain value here; {@link adoptBody} adopted every other thenable. */
function endSession<R>(child: Layer, raw: R | Promise<R>): R | Promise<R> {
  if (!(raw instanceof Promise) && canEndIdle(child)) {
    endInPlace(child);
    /** ADR 0072: a session that ended in place has nothing to wait for, so the value comes back
     * as the body gave it. `session()` still wraps it; a tagged call hands it on. */
    return raw;
  }
  return settleSessionWith(child, raw instanceof Promise ? raw : Promise.resolve(raw));
}

/** End a session in place: the end state main's forced self-close reaches for a session with
 * nothing to tear down — closed, aborted (a later first read of `ctx.signal` gives an aborted
 * signal, ADR 0028; the reason is minted on that read), detached, its data freed (ADR 0069) —
 * with no close protocol behind it. */
function endInPlace(layer: Layer): void {
  layer.closed = true;
  layer.aborted = true;
  layer.closing = ENDED_CLEAN;
  finishLayer(layer, false);
}

/** The waiting half of a session's life: the body is a promise, or the session has something to
 * tear down. One reaction keeps the body's value and classifies its end the moment it settled
 * (an abort after that does not flip it, Q5). A body that ended clean on a session with nothing
 * left to tear down ends in place; anything else force-closes through the protocol. */
async function settleSessionWith<R>(child: Layer, started: Promise<R>): Promise<R> {
  child.body = started;
  let result: R | undefined;
  const ended = started.then(
    (value: R): Scope.Outcome => {
      result = value;
      return child.aborted ? { status: "cancelled" } : SUCCESS;
    },
    (cause: unknown): Scope.Outcome =>
      isCancel(child, cause) ? { status: "cancelled" } : { status: "failed", error: cause },
  );
  child.bodyEnd = ended;
  if ((await ended) === SUCCESS && canEndIdle(child)) {
    endInPlace(child);
    return result as R;
  }
  /** `close()` never throws (ADR 0027/0028); it resolves to the actual settled `Result`. A session is
   * promise-style, so map that Result back to resolve/reject: a real failure or cancellation rejects
   * (with the cause / abort reason), a clean run resolves the body value; teardown errors aggregate
   * into `TeardownFailed` either way. The self-close is FORCED — the body is done, so any still-running
   * owned work is aborted rather than awaited; the body's own outcome decides success/cancelled. */
  settleSessionEnded(await closeLayer(child, true, false));
  return result as R;
}

/** Map a session's close `Result` back to promise semantics: a real failure or cancellation rejects
 * (with the cause / abort reason), a clean run resolves the body value; teardown errors aggregate
 * into `TeardownFailed` either way (ADR 0017). */
function settleSessionEnded(ended: Scope.Result): void {
  const teardownCauses = ended.teardownErrors ? [...ended.teardownErrors] : undefined;
  if (ended.status === "failed") settleSession(true, ended.error, teardownCauses);
  else if (ended.status === "cancelled") settleSession(true, ended.reason, teardownCauses);
  else settleSession(false, undefined, teardownCauses);
}

function runSession<R>(
  parent: Layer,
  options: Scope.Options | undefined,
  fn: (scope: Scope.Handle) => R | PromiseLike<R>,
): Promise<R> {
  return Promise.resolve(
    runSessionWith(parent, options, (child, handle) => fn(handle ?? handleFor(child))),
  );
}

/** Start a session body, normalizing to a promise. `fn` is called synchronously
 * (no extra adoption microtask) so an already-settled value/promise settles `bodyEnd` before a
 * later abort, letting the body's OWN end reflect whether the BODY was interrupted (an aborted
 * body → cancelled) rather than a subsequent self-close abort. A sync throw becomes a rejection.
 * The public session body builds its own handle; a tagged replay needs none. */
function runBodyWith<R>(
  child: Layer,
  fn: (child: Layer, handle?: Scope.Handle) => R | PromiseLike<R>,
  handle?: Scope.Handle,
): R | Promise<R> {
  try {
    if (child.closed && child.aborted) throw child.abortReason;
    return adoptBody(fn(child, handle));
  } catch (error) {
    return Promise.reject(error) as Promise<R>;
  }
}

/** A body's value as the session will hold it: a native promise as is, any other thenable
 * adopted into one from ONE read of its `then` (made inside the caller's try, the way
 * `Promise.resolve` reads it once: a throwing getter rejects the body, a getter is not read a
 * second time, ADR 0029 §6), a plain value as it is. */
function adoptBody<R>(raw: R | PromiseLike<R>): R | Promise<R> {
  if (raw instanceof Promise && raw.constructor === Promise) return raw;
  const then =
    (typeof raw === "object" && raw !== null) || typeof raw === "function"
      ? (raw as { then?: unknown }).then
      : undefined;
  if (typeof then !== "function") return raw as R;
  return adoptThenable<R>(raw, then as ThenFn<R>);
}
/** A namespaced resolve keeps the real layer and passes the storage chain explicitly. */
function resolveNs(
  layer: Layer,
  target: unknown,
  chain: readonly Namespace[] | undefined,
): unknown {
  if (isData(target)) return readCell(layer, target, chain);
  if (isResource(target)) return resourceController(layer, target, undefined, chain).resolve();
  if (isEdge(target)) return resolveEdge(layer, target, undefined, chain);
  if (isExtension(target)) return resolveExtension(layer, target);
  return tagRequired(layer, target as Tag.Handle<unknown>, chain);
}

/** A namespaced controller is fresh so its explicit chain cannot leak through the layer cache. */
function controllerNs(
  layer: Layer,
  target: Data.Cell<unknown> | Resource.Handle<unknown> | Operation.Handle<unknown, unknown>,
  chain: readonly Namespace[],
): unknown {
  if (isData(target)) return dataController(layer, target, chain);
  if (isResource(target)) return resourceController(layer, target, undefined, chain);
  return operationController(layer, target, undefined, chain);
}

/** Run an inline config (ADR 0037): a throwaway `Operation.Handle` through the operation
 * controller path — one handle + one controller per call, nothing cached in the layer
 * (no `nodeState`/`controllerOf` residue). `input` lands on `ctx.input`/`ctx.rawInput`
 * unchanged (no parse); `tags` open the run's child session exactly as for a declared
 * operation (ADR 0038). Discrimination is the brand only. A module function, so a handle builds
 * no closure for it. */
function runInline<R, I>(
  layer: Layer,
  inline: Scope.Inline<Scope.Depends, R, I>,
  call: Scope.Invocation<I> | undefined,
  receiver?: RunState,
  chain: readonly Namespace[] | undefined = layer.ns,
  parent?: SpanImpl,
): R | Promise<Awaited<R>> {
  /** A throwaway `Operation.Handle` through the controller path — one handle + one controller
   * per call, nothing cached in the layer (no `nodeState`/`controllerOf` residue). The body's
   * `input` is replayed as the invocation's `input`, landing on `ctx.input`/`ctx.rawInput`
   * unchanged (no parse — ADR 0037); `tags` open the run's child session exactly as for a
   * declared operation (ADR 0038). Discrimination is the brand only. */
  const handle: Operation.Handle<R, I> = operation({
    label: inline.label ?? "inline",
    depends: inline.depends,
    run: inline.run,
  });
  /** The controller's public face is two overloads, but this entry already holds a broad
   * `Invocation<I>` — one untyped dispatch, no per-shape narrowing. The overloads still type
   * every userland call site; the seam cast below only widens this internal entry. */
  const dispatch = operationController(layer, handle, parent, chain, receiver, inline).run as (
    call?: Scope.Invocation<I>,
  ) => R | Promise<Awaited<R>>;
  return call === undefined ? dispatch() : dispatch(call);
}

function handleFor(layer: Layer): Scope.Handle {
  const settled = async (): Promise<void> => {
    while (layer.pending.size) await Promise.all(layer.pending);
  };
  /** A non-namespace second argument (such as a `forEach` index) is still a plain release. */
  const release = (target: Data.Cell<unknown> | Resource.Handle<unknown>, ns?: unknown): void => {
    if (isNamespace(ns)) releaseNamed(layer, target, ns);
    else releaseNode(layer, target);
  };
  const controllerOf = (
    target: Data.Cell<unknown> | Resource.Handle<unknown> | Operation.Handle<unknown, unknown>,
  ): unknown => {
    const s = nodeState(layer, target);
    if (s.controller) return s.controller;
    const ctl = isData(target)
      ? dataController(layer, target)
      : isResource(target)
        ? resourceController(layer, target, undefined, layer.ns)
        : operationController(layer, target, undefined, layer.ns);
    s.controller = ctl;
    return ctl;
  };
  const controller = (<T, I>(
    target: Data.Cell<T> | Resource.Handle<T> | Operation.Handle<T, I>,
    ns?: Scope.NsArg,
  ) => {
    ensureOpen(layer);
    if (ns?.ns !== undefined) return controllerNs(layer, target, nsChainOf(ns.ns));
    return controllerOf(target);
  }) as Scope.Handle["controller"];
  const resolve = (<T>(
    target:
      | Data.Cell<T>
      | Resource.Handle<T>
      | Tag.Handle<T>
      | Edge<string, Tag.Handle<T>>
      | Scope.Extension<unknown>,
    ns?: Scope.NsArg,
  ): unknown => {
    if (layer.closed) return resolveHeld(layer, target, ns);
    if (ns?.ns !== undefined) return resolveNs(layer, target, nsChainOf(ns.ns));
    if (isData(target)) return readCell(layer, target);
    if (isResource(target)) {
      return (controllerOf(target) as Scope.ResourceController<T>).resolve();
    }
    if (isEdge(target)) return resolveEdge(layer, target, undefined);
    if (isExtension(target)) return resolveExtension(layer, target);
    return tagRequired(layer, target as Tag.Handle<unknown>);
  }) as Scope.Handle["resolve"];
  const run = (<T, I>(op: unknown, call?: Scope.Invocation<I>): unknown => {
    ensureOpen(layer);
    if (!isOperation(op)) return runInline(layer, op as Scope.Inline<Scope.Depends, T, I>, call);
    return (controllerOf(op) as { run(call?: Scope.Invocation<I>): T }).run(call);
  }) as Scope.Handle["run"];
  /** `settle` runs through a twin controller whose caller is RECOVERED; `run` stays as it was. */
  const settle = ((op: unknown, call?: Scope.Invocation<unknown>) =>
    settleRun(
      layer,
      () => {
        ensureOpen(layer);
        if (!isOperation(op))
          return runInline(
            layer,
            op as Scope.Inline<Scope.Depends, unknown, unknown>,
            call,
            RECOVERED,
          );
        return OperationControl.recovered(
          controllerOf(op) as OperationControl<unknown, unknown>,
        ).run(call);
      },
      call?.signal,
    )) as Scope.Handle["settle"];
  return {
    controller,
    resolve,
    run,
    settle,
    createSession: (options?: Scope.Options) => {
      ensureOpen(layer);
      return handleFor(makeLayer(layer, options));
    },
    session: (<R>(
      a: Scope.Options | ((scope: Scope.Handle) => R | PromiseLike<R>),
      b?: (scope: Scope.Handle) => R | PromiseLike<R>,
    ) => {
      if (typeof a === "function") return runSession(layer, undefined, a);
      if (!b)
        raise("InvalidDependency", { label: "session", reason: "session(options, fn) needs fn" });
      return runSession(layer, a, b);
    }) as Scope.Handle["session"],
    release,
    releaseNs: release as Scope.Handle["releaseNs"],
    spans: () => layer.obs.history.slice(),
    onClose: (fn: () => void | PromiseLike<void>) => {
      ensureOpen(layer);
      addDefer(layer, { fn: () => fn(), instance: undefined });
    },
    settled,
    close: (opts?: Scope.CloseOptions) =>
      closeLayer(layer, !opts?.graceful, opts?.withData === true),
    ready: READY,
  };
}

/** Create a scope: the root of a layer chain that reads, controls, and runs cells, resources, tags, and operations. */
export function createScope(
  options: Scope.RootOptions & { readonly signal: AbortSignal },
): Scope.RootHandle;
export function createScope(options?: Scope.RootOptions): Scope.Handle;
export function createScope(options?: Scope.RootOptions): Scope.Handle {
  const layer = makeRootLayer(options);
  const plain = handleFor(layer);
  const exts = readMany(options?.extensions);
  if (exts.length === 0 && options?.signal === undefined) return plain;
  return extendHandle(layer, plain, exts, options?.signal);
}

/** A node to release and the layer that owns it. Release and invalidation sit at the END of this
 * file on purpose: every top-level name takes a module slot in the bundle, and a slot above 255
 * needs a wider bytecode on each use. Cold code goes last so the hot paths keep the cheap slots:
 * add new hot-path names above this block. `pnpm validate` checks it (`scripts/check-slots.mjs`). */
type Affected = { node: Node; owner: Layer };

function invalidateResource(owner: Layer, target: Resource.Handle<unknown>): void {
  const s = nodeState(owner, target);
  if (s.instance) {
    unlinkInstance(s.instance, RELEASED);
    s.instance = undefined;
  }
  s.gen += 1;
  s.resource = undefined;
  s.promise = undefined;
  s.failed = undefined;
  s.build = undefined;
  if (s.nsResources) {
    for (const state of s.nsResources.values()) {
      if (state.instance) unlinkInstance(state.instance, RELEASED);
      state.gen += 1;
      state.resource = undefined;
      state.promise = undefined;
      state.failed = undefined;
      state.build = undefined;
      detachNsDependencies(state);
    }
    s.nsResources = undefined;
  }
  detachDependent(owner, target);
  s.dependents = undefined;
}

/** Drop a cell's shadow (revert to inherited/initial) and edges without notifying watchers. */
function invalidateData(owner: Layer, target: Data.Cell<unknown>): void {
  const s = owner.nodes.get(target);
  if (s?.cell) {
    s.cell = undefined;
    invalidateEff(owner, target);
  }
  if (s) {
    s.nsCells = undefined;
    s.dependents = undefined;
    s.nsDataDependents = undefined;
  }
}

/** Whether a node's dependents can live below its owner: root-owned resources and data cells
 * are shared down the chain; a `session` resource is only used by its own layer. */
function spansDescendants(node: Node): boolean {
  return !isResource(node) || node.target !== "session";
}

/** Visit each (dependent resource, its owner) that depends on `node`. Root-owned nodes search
 * the owner's whole subtree (to reach session instances); a session node searches only its owner. */
function forEachDependent(
  nodeOwner: Layer,
  node: Node,
  visit: (target: Resource.Handle<unknown>, owner: Layer) => void,
): void {
  const deep = spansDescendants(node);
  const stack: Layer[] = [nodeOwner];
  while (stack.length) {
    const scope = stack.pop() as Layer;
    visitDependents(scope.nodes.get(node), scope, visit);
    if (deep) for (const child of scope.children) stack.push(child);
  }
}

function visitDependents(
  rec: NodeState | undefined,
  owner: Layer,
  visit: (target: Resource.Handle<unknown>, owner: Layer) => void,
): void {
  if (rec?.dependents) for (const target of rec.dependents) visit(target, owner);
}

/** Walk dependents from a node (iterative; keyed on node+owner so diamonds collapse while the same
 * handle in two sessions stays distinct) → every affected (node, owner), in release order. */
function collectAffected(target: Node, targetOwner: Layer): Affected[] {
  const seen = new Map<Node, Set<Layer>>();
  const order: Affected[] = [];
  const stack: Affected[] = [{ node: target, owner: targetOwner }];
  while (stack.length) {
    const item = stack.pop() as Affected;
    let owners = seen.get(item.node);
    if (!owners) {
      owners = new Set();
      seen.set(item.node, owners);
    }
    if (owners.has(item.owner)) continue;
    owners.add(item.owner);
    order.push(item);
    forEachDependent(item.owner, item.node, (t, owner) => stack.push({ node: t, owner }));
  }
  return order;
}

/** A released owner's affected resources and their OLD defers, extracted up front. */
type Released = {
  instances: Set<ResourceInstance>;
  hooks: DeferEntry[];
};

/** Release a node and cascade to its dependents across owners. Two phases so a throwing/closing/
 * rebuilding callback can never strand a dependent or sweep up a fresh value: first collect every
 * affected (node, owner), drop all their caches, and EXTRACT their old defers up front (keeps a
 * rebuild's fresh defer out of the drain — r10); then notify watchers and drain the pre-extracted
 * defers. Owners drain DESCENDANTS-FIRST (ledger invariant 6: children before parents), each chained
 * after the prior via `prev`, so a dependency — always at a same-or-ancestor owner — tears down after
 * its dependents (and after that owner's full, incl. async, drain); within an owner it is reverse-
 * registration order. Each owner's drain waits for in-flight OPERATIONS borrowing its resources
 * (ADR 0026 Q2). */
function releaseNode(layer: Layer, target: Node): void {
  ensureOpen(layer);
  const targetOwner = isResource(target) ? ownerOf(layer, target) : layer;
  ensureOpen(targetOwner);
  const affected = new Map<Layer, Released>();
  const order = collectAffected(target, targetOwner);
  if (isData(target)) {
    const rec = targetOwner.nodes.get(target);
    if (rec?.nsCells) {
      const seeds: NsResourceState[] = [];
      for (const entry of rec.nsCells.values()) seeds.push(...namedDataSeeds(rec, entry));
      collectNamedRelease(seeds, affected);
    }
  }
  const dataReleased = invalidateAffected(order, affected);
  drainRelease(affected, () => {
    if (dataReleased && isData(target)) flushCell(layer, target);
  });
}

function releaseNamed(layer: Layer, target: Node, ns: Namespace): void {
  ensureOpen(layer);
  const owner = isResource(target) ? ownerOf(layer, target) : layer;
  ensureOpen(owner);
  if (isData(target)) releaseNamedData(owner, target, ns);
  else if (target.target !== "scope") releaseNamedResource(owner, target, ns);
}

function releaseNamedData(owner: Layer, target: Data.Cell<unknown>, ns: Namespace): void {
  const rec = owner.nodes.get(target);
  if (!rec?.nsCells) return;
  const entry = rec.nsCells.get(ns);
  if (!entry) return;
  const affected = collectNamedRelease(namedDataSeeds(rec, entry), new Map());
  rec.nsCells.delete(ns);
  rec.nsDataDependents?.delete(entry);
  drainRelease(affected, () => flushInheritedNsWatchers(owner, target, ns));
}

function namedDataSeeds(rec: NodeState, entry: Entry): NsResourceState[] {
  return [...(rec.nsDataDependents?.get(entry) ?? [])];
}

function releaseNamedResource(owner: Layer, target: Resource.Handle<unknown>, ns: Namespace): void {
  const state = owner.nodes.get(target)?.nsResources?.get(ns);
  if (!state) return;
  const affected = collectNamedRelease([state], new Map());
  drainRelease(affected);
}

function drainRelease(affected: Map<Layer, Released>, notify?: () => void): void {
  for (const [owner, released] of affected) orderReleased(owner, released);
  try {
    notify?.();
  } finally {
    drainReleased(affected);
  }
}

function collectNamedRelease(
  pending: NsResourceState[],
  affected: Map<Layer, Released>,
): Map<Layer, Released> {
  while (pending.length) {
    const state = pending.pop()!;
    if (state.owner.closed || !isLiveNamedRelease(state)) continue;
    for (const dependent of state.resourceDependents ?? []) pending.push(dependent);
    const released = affected.get(state.owner) ?? {
      instances: new Set<ResourceInstance>(),
      hooks: [],
    };
    if (state.instance) released.instances.add(state.instance);
    affected.set(state.owner, released);
    unlinkNamedState(state);
  }
  return affected;
}

function isLiveNamedRelease(state: NsResourceState): boolean {
  return state.owner.nodes.get(state.target)?.nsResources?.get(state.key) === state;
}

function unlinkNamedState(state: NsResourceState): void {
  const instance = state.instance;
  state.owner.nodes.get(state.target)?.nsResources?.delete(state.key);
  detachNsDependencies(state);
  state.gen++;
  state.resource = undefined;
  state.promise = undefined;
  state.failed = undefined;
  state.build = undefined;
  if (instance) unlinkInstance(instance, RELEASED);
}

function isHeld(instance: ResourceInstance): boolean {
  return instance.dependents > 0 || instance.building || !!instance.borrowers?.size;
}

function drainReleasedOwner(
  entry: Released,
  previous: Promise<void> | undefined,
): Promise<void> | undefined {
  let prev = previous;
  const borrowed = [...entry.instances].flatMap((instance) => [...(instance.borrowers ?? [])]);
  const gate = borrowed.length ? Promise.allSettled(borrowed).then(() => undefined) : undefined;
  for (const hook of entry.hooks) {
    const instance = hook.instance as ResourceInstance;
    if (isHeld(instance)) continue;
    prev = finishHook(instance, hook.fn, gate ?? prev) ?? prev;
  }
  return drainHookless(entry.instances, gate ?? prev);
}

function drainHookless(
  instances: Set<ResourceInstance>,
  previous: Promise<void> | undefined,
): Promise<void> | undefined {
  let prev = previous;
  for (const instance of instances) {
    if (instance.hooks.length || isHeld(instance)) continue;
    prev = finishInstance(instance, prev) ?? prev;
  }
  return prev;
}

function drainReleased(affected: Map<Layer, Released>): void {
  let prev: Promise<void> | undefined;
  for (const [, entry] of byDepthDesc(affected)) prev = drainReleasedOwner(entry, prev);
}

/** Affected owners deepest-first (descendants before ancestors): a released dependency lives at a
 * same-or-ancestor owner of its dependents, so this order tears dependents down before dependencies. */
function byDepthDesc(affected: Map<Layer, Released>): [Layer, Released][] {
  return [...affected].sort(([ownerA], [ownerB]) => layerDepth(ownerB) - layerDepth(ownerA));
}

function layerDepth(layer: Layer): number {
  let depth = 0;
  for (let cur = layer.parent; cur; cur = cur.parent) depth++;
  return depth;
}

/** Drop every affected node's cache at its owner, then extract each affected owner's OLD defers (in
 * registration order) BEFORE any cleanup or watcher runs. Returns whether any data cell was reset (so
 * the caller flushes watchers). Extracting up front keeps a rebuild's fresh defer out of the drain. */
function collectReleasedInstances(
  owner: Layer,
  target: Resource.Handle<unknown>,
  affected: Map<Layer, Released>,
): void {
  const state = nodeState(owner, target);
  const entry = affected.get(owner) ?? { instances: new Set(), hooks: [] };
  if (state.instance) entry.instances.add(state.instance);
  if (state.nsResources)
    for (const bucket of state.nsResources.values()) {
      if (bucket.instance) entry.instances.add(bucket.instance);
    }
  affected.set(owner, entry);
  invalidateResource(owner, target);
}

function orderReleased(owner: Layer, entry: Released): void {
  for (const hook of owner.defers.toReversed()) {
    if (hook.instance && entry.instances.has(hook.instance)) entry.hooks.push(hook);
  }
  owner.defers = owner.defers.filter(
    (hook) => !hook.instance || !entry.instances.has(hook.instance),
  );
}

function invalidateAffected(order: Affected[], affected: Map<Layer, Released>): boolean {
  let dataReleased = false;
  for (const { node, owner } of order) {
    if (owner.closed) continue;
    if (isResource(node)) collectReleasedInstances(owner, node, affected);
    else {
      invalidateData(owner, node);
      dataReleased = true;
    }
  }
  return dataReleased;
}

/** Hand a closed layer's data on (ADR 0069). `withData` moves the store itself into the `Result`
 * as `data`: no copy, no filter. A session under `session` hooks keeps its store, presets, and tags
 * until the hooks return ({@link freeAfterHooks}); any other layer frees them now. */
function keepData(
  layer: Layer,
  ended: Scope.Result,
  hooks: SessionHooks | undefined,
  withData: boolean,
): Scope.Result {
  const kept = withData ? { ...ended, data: finalData(layer.nodes, layer.ns) } : ended;
  if (hooks?.phase === "open") {
    hooks.phase = "held";
    hooks.moved = withData;
  } else freeData(layer, withData);
  return kept;
}

/** Free a closed layer's data: its store, presets, and tags. The store is detached, not cleared;
 * a store `moved` into a `Result` keeps only what `data.get` reads ({@link keepCellsOnly}). */
function freeData(layer: Layer, moved: boolean): void {
  for (const s of layer.nodes.values()) {
    if (moved) keepCellsOnly(s);
    else s.eff = undefined;
  }
  layer.nodes = new Map();
  clearBindings(layer);
}

/** A session's hooks returned (ADR 0069): free the data they could still read, or, when the close
 * has not finished yet, leave it to {@link keepData}. */
function freeAfterHooks(layer: Layer, hooks: SessionHooks): void {
  if (hooks.phase === "held") freeData(layer, hooks.moved);
  hooks.phase = "done";
}

/** Strip a node moved into a `Result` down to its `cell` and `nsCells`, all `data.get` reads.
 * Everything else would pin the closed layer after close: the torn-down resource `instance` (its
 * `owner` layer and defer closures), `nsResources` and `nsDataDependents` (owner layers), the
 * memoized `controller` closure over the layer, `watchers` and `nsWatchers` (user closures),
 * `dependents`, the build state (`resource`, `promise`, `failed`, `build`), and the cached `eff`
 * and `notified` values (possibly a parent's). A default close's `nodes.clear()` drops it all. */
function keepCellsOnly(s: NodeState): void {
  s.eff = undefined;
  s.resource = undefined;
  s.promise = undefined;
  s.failed = undefined;
  s.build = undefined;
  s.instance = undefined;
  s.dependents = undefined;
  s.controller = undefined;
  s.watchers = undefined;
  s.notified = undefined;
  s.nsResources = undefined;
  s.nsDataDependents = undefined;
  s.nsWatchers = undefined;
}

/** A read on a closed scope (ADR 0069): while a session's data waits for its `session` hooks, a
 * data cell or a tag reads as it did before the close. Anything else throws `Disposed`. */
function resolveHeld(layer: Layer, target: unknown, ns: Scope.NsArg | undefined): unknown {
  if (SESSION_HOOKS.get(layer)?.phase !== "held" || isResource(target) || isExtension(target))
    raise("Disposed", { reason: "scope is closed" });
  return resolveNs(layer, target, ns?.ns === undefined ? layer.ns : nsChainOf(ns.ns));
}

/** The store a `withData` close moved into its `Result` (ADR 0069), read through {@link ownEntry}. */
function finalData(
  nodes: Map<object, NodeState>,
  own: readonly Namespace[] | undefined,
): Scope.FinalData {
  return {
    get: <T>(cell: Data.Cell<T>, ns?: Scope.NsArg): Tag.Presence<T> => {
      const entry = ownEntry(nodes.get(cell), ns?.ns === undefined ? own : nsChainOf(ns.ns));
      return entry === undefined ? { present: false } : { present: true, value: entry.value as T };
    },
  };
}

/** The entry a controller picks at one layer, as {@link selectBucket} does: the ns chain's buckets
 * in order, then the default bucket. */
function ownEntry(
  rec: NodeState | undefined,
  chain: readonly Namespace[] | undefined,
): Entry | undefined {
  if (rec === undefined) return undefined;
  for (const key of chain ?? NO_ITEMS) {
    const bucket = rec.nsCells?.get(key);
    if (bucket !== undefined) return bucket;
  }
  return rec.cell;
}

export { isError };
export type { Errors } from "./errors.ts";

/** A record that keeps a session's close on the full path: a built resource instance, default or
 * named, or a watcher, default or named. */
function busyRecord(state: NodeState): boolean {
  return (
    state.instance !== undefined ||
    state.nsResources !== undefined ||
    state.watchers !== undefined ||
    state.nsWatchers !== undefined
  );
}

type ThenFn<R> = (
  this: unknown,
  resolve: (value: R | PromiseLike<R>) => void,
  reject: (reason?: unknown) => void,
) => unknown;

/** Adopt a thenable that is not a native promise into one, from the one `then` already read:
 * called in a microtask with the new promise's resolving functions, as the resolve-thenable job
 * behind `Promise.resolve` would call it. `queueMicrotask` puts the call on the same job queue
 * that job would use, in the same order, with no promise of its own to make. */
function adoptThenable<R>(raw: unknown, then: ThenFn<R>): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    queueMicrotask(() => {
      try {
        then.call(raw, resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/** The slow half of {@link effectiveEntry}: walk the parents for a cell or a memo, then memoize
 * where it pays (see there). `self` is this layer's record, when it has one. */
function walkEntry(layer: Layer, self: NodeState | undefined, target: Data.Cell<unknown>): Entry {
  let hops = 0;
  let top = layer;
  for (let cur = layer.parent; cur; cur = cur.parent) {
    hops++;
    top = cur;
    const rec = cur.nodes.get(target);
    if (rec === undefined) continue;
    const found = rec.cell ?? rec.eff;
    if (found === undefined) continue;
    return memoEntry(layer, self, target, found, hops);
  }
  return freshEntry(layer, self, target, top, hops);
}

/** Memoize an entry where it pays (see {@link effectiveEntry}): on this layer's record when it
 * has one, on a fresh record when the entry sits two or more hops up, else nowhere.
 * The hop and lazy cuts change cache cost only; untouched frames keep reading through. */
function memoEntry(
  layer: Layer,
  self: NodeState | undefined,
  target: Data.Cell<unknown>,
  entry: Entry,
  hops: number,
): Entry {
  if (self !== undefined) self.eff = entry;
  else if (hops >= 2 && !layer.lazy) nodeState(layer, target).eff = entry;
  return entry;
}

/** No layer up the chain holds the cell: one entry with its initial value, memoized on the top
 * layer for everything under it, and on this layer when that pays. */
function freshEntry(
  layer: Layer,
  self: NodeState | undefined,
  target: Data.Cell<unknown>,
  top: Layer,
  hops: number,
): Entry {
  const fresh: Entry = { value: target.initial };
  nodeState(top, target).eff = fresh;
  return top === layer ? fresh : memoEntry(layer, self, target, fresh, hops);
}

/** Every value bound to `target` in a layer's own tags, top first, list or map. */
function appendLayerTags(out: unknown[], cur: Layer, target: Tag.Handle<unknown>): void {
  const tags = cur.tags;
  if (tags === undefined) return;
  if (isTagList(tags)) {
    for (let i = tags.length - 1; i >= 0; i--) if (tags[i].tag === target) out.push(tags[i].value);
    return;
  }
  const list = tags.get(target);
  if (list) for (let i = list.length - 1; i >= 0; i--) out.push(list[i]);
}

/** The list shape of {@link LayerTags}. `Array.isArray` alone does not narrow a `readonly` list
 * out of the union. */
function isTagList(tags: LayerTags): tags is readonly Tag.Binding<unknown>[] {
  return Array.isArray(tags);
}

/** Wrap a session's whole life in the extensions' `session` onion (ADR 0051): registration order,
 * first is outermost. `run` is the session's own life — run the body, force-close, keep the body's
 * value beside the close `Result` — so `next()` resolves with whatever `closeLayer` produced (never
 * rejects, ADR 0027). Code before `await next()` runs right after the child layer exists, before any
 * work in it; code after runs after the close settled. Each level reports the hook's own return as
 * its `ended` (the onion may transform it, like `close`); the body's `result` threads through from
 * the innermost `run`. A hook that skips `next()` observes only: the session's own life still runs
 * (`ensure`), only the skipping hook's `result` is the body's, not a substitute. A throwing hook
 * rejects the session with its error — hooks must not throw; when both the hook and the life fail,
 * the hook's error wins. The life runs at most once per session no matter how many hooks call
 * `next()` (`ensure` memo). */
function sessionThrough(
  sessions: readonly Scope.Extension<unknown>[],
  handle: Scope.Handle,
  owner: Layer,
  run: () => Promise<{ result: unknown; ended: Scope.Result }>,
): Promise<{ result: unknown; ended: Scope.Result }> {
  let life: Promise<{ result: unknown; ended: Scope.Result }> | undefined;
  const ensure = (): Promise<{ result: unknown; ended: Scope.Result }> => (life ??= run());
  const at = (index: number): Promise<{ result: unknown; ended: Scope.Result }> => {
    if (index >= sessions.length) return ensure();
    const ext = sessions[index];
    /** The inner life this hook observes: memoized so calling `next()` twice still runs the
     * session once, and so a hook that skips `next()` leaves `inner` unset for `ensure` below. */
    let inner: Promise<{ result: unknown; ended: Scope.Result }> | undefined;
    const next = (): Promise<Scope.Result> => (inner ??= at(index + 1)).then(({ ended }) => ended);
    let outcome: Promise<Scope.Result>;
    try {
      outcome = ext.hooks!.session!(hookEvent({ kind: "session", handle, next }, owner, ext.label));
    } catch (error) {
      const done = inner ?? ensure();
      ignoreRejection(done);
      return done.then(() => {
        throw error;
      });
    }
    return outcome.then(
      (ended) => (inner ?? ensure()).then(({ result }) => ({ result, ended })),
      (hookError: unknown) => {
        ignoreRejection(inner ?? ensure());
        throw hookError;
      },
    );
  };
  return at(0);
}

/** `settle`'s Result for what `run` threw or rejected with: a cancel reason on an aborted layer is
 * `cancelled`; anything else is `failed`. */
function failedRun(layer: Layer, error: unknown, signal?: AbortSignal): RunResult<never> {
  if (isCancel(layer, error) || (signal?.aborted && error === signal.reason))
    return { status: "cancelled", reason: error };
  recover(layer, error);
  closeOrigin(error);
  const origin = originOf(error);
  const result: RunResult<never> = { status: "failed", error, kind: failureKind(error) };
  if (origin) result.origin = origin;
  return result;
}

/** `run` that never throws: what `run` returns or resolves to is `success`, even under a forced
 * close (a program that catches SIGINT and exits 0 exits 0); what it throws goes to `failedRun`. */
function settleRun(
  layer: Layer,
  run: () => unknown,
  signal?: AbortSignal,
): RunResult<unknown> | Promise<RunResult<unknown>> {
  try {
    const result = run();
    if (!isThenable(result)) return { status: "success", value: result };
    return Promise.resolve(result).then(
      (value): RunResult<unknown> => ({ status: "success", value }),
      (error: unknown) => failedRun(layer, error, signal),
    );
  } catch (error) {
    return failedRun(layer, error, signal);
  }
}

/** `settle` received `error`: each stuck panic on its cause chain is recovered (Go's `recover`). */
function recover(layer: Layer, error: unknown): void {
  const panics = layer.panics;
  if (panics === undefined) return;
  const chain = causesOf(error);
  const left = panics.filter((panic) => !chain.includes(panic));
  layer.panics = left.length === 0 ? undefined : left;
}

/** Wrap the structural close in the extensions' `close` onion (ADR 0050): first registered is
 * outermost; extensions without a `close` hook are skipped when the chain is built. */
function closeThrough(
  layer: Layer,
  closers: readonly Scope.Extension<unknown>[],
): (opts?: Scope.CloseOptions) => Promise<Scope.Result> {
  let closing: Promise<Scope.Result> | undefined;
  return (options: Scope.CloseOptions = {}): Promise<Scope.Result> => {
    const close = (): Promise<Scope.Result> =>
      closeLayer(layer, !options.graceful, options.withData === true);
    if (closeWouldReenter(layer)) return close();
    if (closing !== undefined) return closing;
    if (layer.closing !== undefined) return close();
    const at = (index: number): Promise<Scope.Result> => {
      if (index >= closers.length) return close();
      const closer = closers[index];
      const next = (): Promise<Scope.Result> => at(index + 1);
      return closer.hooks!.close!(hookEvent({ kind: "close", options, next }, layer, closer.label));
    };
    return (closing = at(0));
  };
}

/** Run the extensions' `start` onion (ADR 0050): registration order, first is outermost. Each
 * start's returned value (awaited) is stored per extension; the records flip `settled` only when
 * that extension's start settled. A rejected start records the layer failure (so a later close
 * settles `failed`), closes through the current handle, and rejects `ready` with the same error
 * only after that close ends. A close already under way is joined without running hooks again. */
function runStartChain(
  layer: Layer,
  scope: Scope.Handle,
  exts: readonly Scope.Extension<unknown>[],
  lifetime: RootLifetime,
  done: () => void,
  failed: (error: unknown) => void,
): void {
  const at = async (index: number): Promise<void> => {
    if (index >= exts.length) return;
    const ext = exts[index];
    const next = (): Promise<void> => at(index + 1);
    if (!ext.hooks?.start) return next();
    const value = await ext.hooks.start(
      hookEvent({ kind: "start", scope, next }, layer, ext.label),
    );
    const rec = EXTENSIONS.get(layer)?.get(ext);
    if (rec !== undefined) {
      rec.value = value;
      rec.settled = true;
    }
  };
  ignoreRejection(
    at(0).then(done, async (error: unknown) => {
      layer.failure ??= { cause: error };
      try {
        await (lifetime.closing ?? layer.closing ?? scope.close());
      } finally {
        failed(error);
      }
    }),
  );
}

/** Run access uses the run's trace and borrow set. Other hooks own their cleanup at their
 * session; root start and close use the root. Reads bypass the root-only resolve onion. */
class ExtensionCtx implements Scope.ExtensionCtx {
  declare readonly label: string;
  declare readonly ns: readonly Namespace[] | undefined;
  declare private owner: Layer;
  declare private flight: HookRun | undefined;
  declare private resolver: Scope.Handle["resolve"] | undefined;
  declare private controllerFor: Scope.Handle["controller"] | undefined;
  declare private runner: Scope.Handle["run"] | undefined;
  declare private settler: Scope.Handle["settle"] | undefined;
  declare private cleanup: Resource.Ctx["defer"] | undefined;
  declare private raiser: Resource.Ctx["raise"] | undefined;
  declare private logTools: Observe.Logger | undefined;
  constructor(owner: Layer, label: string, chain = owner.ns, run?: HookRun) {
    this.owner = owner;
    this.label = label;
    this.ns = chain;
    this.flight = run;
  }
  get clock(): Clock.Handle {
    return this.owner.clock;
  }
  get random(): Random.Handle {
    return this.owner.random;
  }
  private get ctx(): OperationCtx<unknown> | undefined {
    return this.flight && hookCtx(this.flight);
  }
  private use<T>(fn: () => T): T {
    return this.flight ? withHookAccess(this.flight, fn) : fn();
  }
  get resolve(): Scope.Handle["resolve"] {
    return (this.resolver ??= ((target: Scope.Dependency, ns?: Scope.NsArg): unknown =>
      this.use(() => {
        const chain = ns === undefined ? this.ns : nsChainOf(ns.ns);
        if (this.owner.closed && !this.flight)
          return resolveHeld(this.owner, target, chain === undefined ? undefined : { ns: chain });
        if (isResource(target)) return this.resource(target, chain).resolve();
        return resolveNs(this.owner, target, chain);
      })) as Scope.Handle["resolve"]);
  }
  get controller(): Scope.Handle["controller"] {
    return (this.controllerFor ??= ((
      target: Data.Cell<unknown> | Resource.Handle<unknown> | Operation.Handle<unknown, unknown>,
      ns?: Scope.NsArg,
    ): unknown =>
      this.use(() => {
        ensureOpen(this.owner);
        const chain = ns === undefined ? this.ns : nsChainOf(ns.ns);
        if (isData(target)) return this.cell(target, chain);
        if (isResource(target)) return this.resource(target, chain);
        return this.operation(target, chain);
      })) as Scope.Handle["controller"]);
  }
  private cell(
    target: Data.Cell<unknown>,
    chain: readonly Namespace[] | undefined,
  ): Scope.DataController<unknown> {
    const controller = dataController(this.owner, target, chain);
    if (!this.flight) return controller;
    return {
      get: () => this.use(() => controller.get()),
      set: (value) => this.use(() => controller.set(value)),
      update: (fn) => this.use(() => controller.update(fn)),
      watch: (listener) => this.use(() => controller.watch(listener)),
    };
  }
  private resource(
    target: Resource.Handle<unknown>,
    chain: readonly Namespace[] | undefined,
  ): Scope.ResourceController<unknown> {
    const controller = resourceController(this.owner, target, this.flight?.span, chain);
    const run = this.flight;
    if (!run) return controller;
    const selected: SelectedResource = (owner, target, state) =>
      addBorrow(instanceOf(owner, target, state), (run.held ??= createBorrows()));
    const owner = ownerOf(this.owner, target);
    const state = (): ResourceState | undefined =>
      hasResourceNs(target, chain)
        ? selectNsResource(owner, target, chain)
        : owner.nodes.get(target);
    return {
      resolve: () =>
        this.use(() => {
          const value = resourceSlot(this.owner, target, this.flight?.span, chain, selected);
          return state()?.promise ?? value;
        }),
      get: () =>
        this.use(() => {
          const value = controller.get();
          const current = state();
          if (current) selected(owner, target, current);
          return value;
        }),
    };
  }
  private operation(
    target: Operation.Handle<unknown, unknown>,
    chain: readonly Namespace[] | undefined,
  ): unknown {
    const controller = operationController(
      this.owner,
      target,
      this.flight?.span,
      chain,
      this.ctx,
    ) as {
      run(call?: Scope.Invocation<unknown>): unknown;
      settle(call?: Scope.Invocation<unknown>): unknown;
    };
    if (!this.flight) return controller;
    return {
      run: (call?: Scope.Invocation<unknown>) => this.use(() => controller.run(call)),
      settle: (call?: Scope.Invocation<unknown>) => {
        try {
          return this.use(() => controller.settle(call));
        } catch (error) {
          return failedRun(this.owner, error);
        }
      },
    };
  }
  private invoke(
    op: Operation.Handle<unknown, unknown> | Scope.Inline<Scope.Depends, unknown, unknown>,
    call: Scope.Invocation<unknown> | undefined,
    caller: RunState | undefined,
  ): unknown {
    return this.use(() => {
      if (!isOperation(op))
        return runInline(this.owner, op, call, caller, this.ns, this.flight?.span);
      const controller = operationController(
        this.owner,
        op,
        this.flight?.span,
        this.ns,
        caller,
      ) as { run(call?: Scope.Invocation<unknown>): unknown };
      return controller.run(call);
    });
  }
  get run(): Scope.Handle["run"] {
    return (this.runner ??= ((
      op: Operation.Handle<unknown, unknown> | Scope.Inline<Scope.Depends, unknown, unknown>,
      call?: Scope.Invocation<unknown>,
    ): unknown => this.invoke(op, call, this.ctx)) as Scope.Handle["run"]);
  }
  get settle(): Scope.Handle["settle"] {
    return (this.settler ??= ((
      op: Operation.Handle<unknown, unknown> | Scope.Inline<Scope.Depends, unknown, unknown>,
      call?: Scope.Invocation<unknown>,
    ): unknown =>
      settleRun(
        this.owner,
        () => this.invoke(op, call, RECOVERED),
        call?.signal,
      )) as Scope.Handle["settle"]);
  }
  get defer(): Resource.Ctx["defer"] {
    return (
      this.ctx?.defer ??
      (this.cleanup ??= (fn) => addDefer(this.owner, { fn, instance: undefined }))
    );
  }
  get obs(): Observe.Ctx {
    return this.ctx?.obs ?? OFF_OBS;
  }
  get log(): Observe.Logger {
    return this.ctx?.log ?? (this.logTools ??= logFor(this.owner.obs, undefined, this.label));
  }
  get raise(): Resource.Ctx["raise"] {
    return (this.raiser ??= (kind, payload) => raiseFrom(this.ctx ?? this, kind, payload));
  }
  get signal(): AbortSignal {
    return signalOf(this.owner);
  }
}

/** A handle whose `createSession` wraps every child in the root's `session` chain (ADR 0051): the
 * direct `resolve` stays plain; run and write hooks follow the inherited routes.
 * Only built when hooks exist; the unwrapped path never enters. */
function withSessionCreate(
  plain: Scope.Handle,
  layer: Layer,
  sessions: readonly Scope.Extension<unknown>[],
): Scope.Handle {
  return {
    ...plain,
    createSession: (options?: Scope.Options) => wrapSession(layer, options, sessions),
  };
}

/** A bare session wrapped in the `session` chain: the onion starts NOW (before-code runs right after
 * the child layer exists, before any work in it); `next()` settles with the structural close's
 * `Result` however the session closes — through this handle's `close`, or felled by its parent's
 * close cascade (`closeLayer` settles the registered resolver via the side table). `close()` joins
 * the teardown first, then reports the chain's outcome (hook returns win, hook throws propagate,
 * like `close`). */
function wrapSession(
  parent: Layer,
  options: Scope.Options | undefined,
  sessions: readonly Scope.Extension<unknown>[],
): Scope.Handle {
  ensureOpen(parent);
  const child = makeLayer(parent, options);
  const plain = handleFor(child);
  let wrapped: Scope.Handle;
  let settleNext: (ended: Scope.Result) => void = noop as (ended: Scope.Result) => void;
  const nextPromise = new Promise<Scope.Result>((resolveNext) => {
    settleNext = resolveNext;
  });
  const hooks: SessionHooks = { settle: settleNext, phase: "open", moved: false };
  SESSION_HOOKS.set(child, hooks);
  const base = withSessionCreate(plain, child, sessions);
  const outcome = sessionThrough(sessions, base, child, () =>
    nextPromise.then((ended) => ({ result: undefined, ended })),
  ).finally(() => freeAfterHooks(child, hooks));
  ignoreRejection(outcome);
  wrapped = {
    ...base,
    close: (opts?: Scope.CloseOptions) =>
      closeLayer(child, !opts?.graceful, opts?.withData === true).then(() =>
        outcome.then(({ ended: chained }) => chained),
      ),
  };
  return wrapped;
}

/** Wrap a plain root handle with the extensions' plumbing (ADR 0050): store one
 * start-value record per installed extension, override `close` with the close chain, add `ready`,
 * then kick the start chain with the EXTENDED handle. Cold path only — plain scopes never enter. */
function extendHandle(
  layer: Layer,
  plain: Scope.Handle,
  exts: readonly Scope.Extension<unknown>[],
  signal: AbortSignal | undefined,
): Scope.Handle {
  const records = new Map<Scope.Extension<unknown>, ExtRec>();
  for (const ext of exts) records.set(ext, { settled: false, value: undefined });
  EXTENSIONS.set(layer, records);
  const closers = exts.filter((ext) => ext.hooks?.close !== undefined);
  const resolvers = exts.filter((ext) => ext.hooks?.resolve !== undefined);
  layer.exts = readExtRoutes(exts);
  const sessions = layer.exts.sessions;
  let settleReady: () => void = noop;
  let failReady: (error: unknown) => void = noop;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    settleReady = resolveReady;
    failReady = rejectReady;
  });
  ignoreRejection(ready);
  const lifetime: RootLifetime = {};
  const closed =
    signal === undefined
      ? undefined
      : new Promise<Scope.Result>((resolveClosed) => {
          lifetime.finish = resolveClosed;
        });
  const extended: Scope.Handle = {
    ...plain,
    ...(closed === undefined ? {} : { closed }),
    close: watchRootClose(
      layer,
      closers.length === 0 ? (options) => plain.close(options) : closeThrough(layer, closers),
      lifetime,
    ),
    ready,
  };
  if (resolvers.length > 0) extended.resolve = resolveThrough(layer, resolvers);
  if (sessions !== undefined)
    extended.createSession = (options?: Scope.Options) => wrapSession(layer, options, sessions);
  if (signal !== undefined) listenForStop(extended, signal, lifetime);
  runStartChain(layer, extended, exts, lifetime, settleReady, failReady);
  return extended;
}

function readExtRoutes(exts: readonly Scope.Extension<unknown>[]): ExtRoutes {
  const runners = exts.filter((ext) => ext.hooks?.run !== undefined);
  const writers = exts.filter((ext) => ext.hooks?.write !== undefined);
  const sessions = exts.filter((ext) => ext.hooks?.session !== undefined);
  return {
    runners: runners.length > 0 ? runners : undefined,
    writers: writers.length > 0 ? writers : undefined,
    sessions: sessions.length > 0 ? sessions : undefined,
  };
}

/** Only the extension path owns this state. The first close includes the hooks' after-work;
 * a start failure joins it, and a stop request never starts another close (ADR 0085). */
type RootLifetime = {
  closing?: Promise<Scope.Result>;
  finish?: (ended: Scope.Result) => void;
  unlisten?: () => void;
};

/** Hook returns and throws keep their existing meaning for `close()`. Only the real close's
 * Result reaches `closed`, after the first chain's after-work, even when a hook throws. */
function watchRootClose(
  layer: Layer,
  close: Scope.Handle["close"],
  lifetime: RootLifetime,
): Scope.Handle["close"] {
  return (options) => {
    lifetime.unlisten?.();
    if (lifetime.closing !== undefined) return close(options);
    return (lifetime.closing = (async () => {
      try {
        return await close(options);
      } finally {
        if (lifetime.finish !== undefined && layer.closing !== undefined)
          lifetime.finish(await layer.closing);
      }
    })());
  };
}

function listenForStop(scope: Scope.Handle, signal: AbortSignal, lifetime: RootLifetime): void {
  const stop = (): void => {
    ignoreRejection(
      scope.ready.then(() => {
        if (lifetime.closing === undefined) return scope.close({ graceful: true });
      }),
    );
  };
  lifetime.unlisten = () => {
    signal.removeEventListener("abort", stop);
    lifetime.unlisten = undefined;
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
}

/** The `resolve` onion (ADR 0050, core/t33): registration order, first is outermost. An
 * `Extension` target bypasses the chain — `resolve(ext)` reads the extension registry, not a
 * snapshot the chain wraps. Root handle only in v1: sessions keep the plain dispatch. */
function resolveThrough(
  layer: Layer,
  resolvers: readonly Scope.Extension<unknown>[],
): Scope.Handle["resolve"] {
  type OnionTarget = Data.Cell<unknown> | Resource.Handle<unknown> | Tag.Handle<unknown>;
  const at = (
    target: OnionTarget,
    index: number,
    chain: readonly Namespace[] | undefined,
  ): unknown => {
    if (index >= resolvers.length) {
      if (isData(target)) return readCell(layer, target, chain);
      if (isEdge(target)) return resolveEdge(layer, target, undefined, chain);
      if (isResource(target)) return resourceController(layer, target, undefined, chain).resolve();
      return tagRequired(layer, target, chain);
    }
    const next = (): unknown => at(target, index + 1, chain);
    const ext = resolvers[index];
    return ext.hooks!.resolve!(
      hookEvent({ kind: "resolve", target, next }, layer, ext.label, chain),
    );
  };
  const chained = (target: OnionTarget, ns?: Scope.NsArg): unknown => {
    ensureOpen(layer);
    if (isExtension(target)) return resolveExtension(layer, target);
    const chain = ns?.ns === undefined ? layer.ns : nsChainOf(ns.ns);
    return at(target, 0, chain);
  };
  return chained as Scope.Handle["resolve"];
}

/** Bound only for the session path, so ordinary tagged frames retain no body callback context. */
function runTaggedBody<T, I>(
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  call: Scope.Invocation<I> | undefined,
  chain: readonly Namespace[] | undefined,
  nested: boolean,
  child: Layer,
): T {
  return runUntagged(child, target, parent, call, chain, undefined, nested);
}

/** A session under a root that installed `session` hooks: the whole life inside their onion. Cold
 * path only — the hooks' handles are built eagerly here, never on the unwrapped path above. The
 * body receives the same handle the hooks do, so a session created under a session stays wrapped. */
async function runSessionWrapped<R>(
  child: Layer,
  body: (child: Layer, handle?: Scope.Handle) => R | PromiseLike<R>,
  sessions: readonly Scope.Extension<unknown>[],
): Promise<R> {
  const hooks: SessionHooks = { settle: undefined, phase: "open", moved: false };
  SESSION_HOOKS.set(child, hooks);
  const handle = withSessionCreate(handleFor(child), child, sessions);
  let wrapped: { result: unknown; ended: Scope.Result };
  try {
    wrapped = await sessionThrough(sessions, handle, child, async () => {
      const started = Promise.resolve(runBodyWith(child, body, handle));
      child.body = started;
      child.bodyEnd = started.then(
        (): Scope.Outcome => (child.aborted ? { status: "cancelled" } : SUCCESS),
        (cause: unknown): Scope.Outcome =>
          isCancel(child, cause) ? { status: "cancelled" } : { status: "failed", error: cause },
      );
      const result = await started.then(
        (value) => value,
        () => undefined,
      );
      /** The body is done, so force-close any owned work. Its own outcome decides cancellation;
       * the close Result decides resolve/reject in {@link settleSessionEnded} (ADR 0027/0028). */
      const ended = await closeLayer(child, true, false);
      return { result, ended };
    });
  } finally {
    freeAfterHooks(child, hooks);
  }
  settleSessionEnded(wrapped.ended);
  return wrapped.result as R;
}

/** Keep the preset loop out of the empty path so V8 can inline scope setup. */
function applyPresets(
  nodes: Map<object, NodeState>,
  seeds: readonly Scope.Preset[],
): Map<unknown, unknown> | undefined {
  let presets: Map<unknown, unknown> | undefined;
  for (const p of seeds) {
    const node = p.node;
    if (isData(node)) {
      const s = new NodeState();
      s.cell = { value: admit(node.label, node.parse, p.replacement) };
      nodes.set(node, s);
    } else (presets ??= new Map()).set(node, p.replacement);
  }
  return presets;
}

/** Release a run's borrow once its async defer drain ends. */
function drainAsync(tail: Promise<void>, release: () => void): void {
  ignoreRejection(tail.then(release, release));
}

/** The walk behind {@link closeWouldReenter}, its own function so its loop stays out of the
 * close dispatch's inlined size when no teardown is active. */
function reentersTeardown(target: Layer): boolean {
  for (const active of teardownDepth.keys()) {
    for (let cur: Layer | undefined = active; cur; cur = cur.parent) {
      if (cur === target) return true;
    }
  }
  return false;
}

/** Collect a teardown error on a layer, giving it its own list on the first one. */
function addError(layer: Layer, cause: unknown): void {
  materialize(layer);
  if (layer.secondary === NO_ERRORS) layer.secondary = [];
  layer.secondary.push(cause);
}

/** {@link drainDefers}'s work when there is any: each entry in reverse order, awaited in turn. */
async function drainEntries(layer: Layer, entries: DeferEntry[], end: Scope.End): Promise<void> {
  for (let i = entries.length - 1; i >= 0; i--) await drainCloseEntry(layer, entries[i], end);
}

/** Drive every currently-attached child to close (children first, awaited sequentially). The mode is
 * re-checked per child: once an EARLIER child's failure has been collected (pushed into this layer's
 * `descendantFailure` while we awaited it), the remaining children close FORCED so their resources roll
 * back too. Collection is NOT done here: each child's real failure + teardown errors flow up through
 * `finishLayer` (swept push), so a child that already finished and detached still reaches its ancestor.
 * Its caller reuses READY with no child, keeping the close phase order. */
async function closeEach(layer: Layer, force: boolean): Promise<void> {
  for (const child of Array.from(layer.children)) {
    await closeLayer(
      child,
      force || (failureOf(layer) ?? layer.descendantFailure) !== undefined,
      false,
    );
  }
}

/** Empty defaults stay inherited after promotion. Collection gates give each owner its own
 * storage before adding entries; scalar writes create own fields. Copying all defaults at once
 * added a property array and an ObjectAssign call to every grown frame. */
const FRAME_STATE = {
  children: NO_CHILDREN,
  nodes: NO_NODES,
  presets: undefined,
  pending: NO_WORK,
  defers: NO_DEFERS,
  resourceHolds: 0,
  aborted: false,
  abortReason: undefined,
  abort: undefined,
  cancelled: false,
  swept: false,
  bodyEnd: undefined,
  failure: undefined,
  descendantFailure: undefined,
  secondary: NO_ERRORS,
  body: undefined,
  closed: false,
  closing: undefined,
  emptyCtx: undefined,
};

Object.assign(TaggedFrame.prototype, FRAME_STATE);

/** Promotion retains identity and binds ancestors first, before a watcher, build, or pending
 * body becomes visible. A new child inherits any close already in flight (ADR 0028). */
function expandFrame(frame: Layer, parent: Layer): void {
  materialize(parent);
  frame.lazy = false;
  if (parent.children === NO_CHILDREN) parent.children = new Set();
  parent.children.add(frame);
  if (parent.swept) frame.swept = true;
  if (parent.aborted) {
    frame.aborted = true;
    frame.abortReason = parent.abortReason;
  }
}

/** A close can enter through a captured handle while a body is still synchronous. Register
 * these frames before the existing sweep and abort code sees the tree. */
function materializeActiveFrames(): void {
  for (let frame = activeTagged; frame; frame = frame.previous) materialize(frame);
}

/** A best-effort outcome for a re-entrant close ack before the layer has settled: whatever real state
 * is already known (a recorded failure, then an interrupted body), else success. */
function bestEffort(layer: Layer): Scope.Outcome {
  const failure = failureOf(layer);
  if (failure) return { status: "failed", error: failure.cause };
  return layer.cancelled ? { status: "cancelled" } : SUCCESS;
}

/** A failed close `Result`, with the error's origin when it has one. Its own function, so the
 * success path of {@link buildResult} stays as small as before. */
function failedResult(
  error: unknown,
  teardownErrors: readonly unknown[] | undefined,
): Scope.Result {
  const origin = originOf(error);
  return origin
    ? { status: "failed", error, origin, teardownErrors }
    : { status: "failed", error, teardownErrors };
}

function propagateSweptOutcome(layer: Layer, parent: Layer): void {
  for (const cause of layer.secondary) addError(parent, cause);
  /** A descendant's settled failure goes to a SEPARATE slot ranked BELOW the parent's OWN failure
   * (body/owned-work): a real owned-work failure must still beat a failure a child merely inherited
   * from the close request (a wished `failed` echoed back down and up). First descendant wins. */
  if (layer.failure && layer.failureOwner === undefined) parent.descendantFailure ??= layer.failure;
}

/** Free retained bindings; the empty-preset guard avoids an extra field on a grown frame. */
function clearBindings(layer: Layer): void {
  if (layer.presets !== undefined) layer.presets = undefined;
  layer.tags = undefined;
}

/** Hooked calls select their owner before starting the hook chain. An owned call therefore
 * passes the same child through session hooks, run hooks, and the body, once each. */
function runHookCall<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  inherited: readonly Namespace[] | undefined,
  caller: RunState | undefined,
  hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I>,
  call: Scope.Invocation<I> | undefined,
): unknown {
  ensureOpen(layer);
  const chain = call?.ns === undefined ? inherited : nsChainOf(call.ns);
  if (!hasCallSession(call))
    return runHookChain(layer, target, parent, chain, caller, hookTarget, call);
  const result = runSessionWith(
    layer,
    { tags: call.tags, ns: chain },
    (child) => runHookChain(child, target, parent, chain, undefined, hookTarget, call),
    caller,
    call.signal,
  );
  if (caller) track(layer, result, runFailure(layer, caller));
  return result;
}

/** Access belongs to this active run only. Graceful close seals public handles at once but
 * still lets an existing hook continue its body; forced close refuses a late continuation. */
type HookRun = {
  owner: Layer;
  ctx?: OperationCtx<unknown>;
  span: SpanImpl | undefined;
  label: string;
  call: Scope.Invocation<unknown> | undefined;
  held: HeldBorrows | undefined;
  active: boolean;
  caller: RunState | undefined;
  bodies?: Promise<unknown>[];
  failure?: { error: unknown };
};
let activeHookOwner: Layer | undefined;

function withHookAccess<T>(run: HookRun, fn: () => T): T {
  if (!run.active) raise("Disposed", { reason: "run is finished" });
  if (run.owner.aborted) throw run.owner.abortReason;
  const previous = activeHookOwner;
  activeHookOwner = run.owner;
  buildDepth++;
  try {
    return fn();
  } finally {
    buildDepth--;
    activeHookOwner = previous;
  }
}

function hookCanRead(layer: Layer): boolean {
  for (let owner = activeHookOwner; owner; owner = owner.parent) {
    if (owner === layer) return !layer.aborted;
  }
  return false;
}

function runHookChain<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  caller: RunState | undefined,
  hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I>,
  call: Scope.Invocation<I> | undefined,
): unknown {
  const span = openSpan(layer.obs, layer, parent, target.label, "operation");
  const run: HookRun = {
    owner: layer,
    span,
    label: target.label,
    call,
    held: undefined,
    active: true,
    caller,
  };
  const finish = (status: "ok" | "failed", error?: unknown): void => {
    finishHookRun(run, status, error);
  };
  let result: unknown;
  try {
    result = invokeRunHooks(run, target, hookTarget, call, chain);
  } catch (error) {
    failHookRun(run, error);
    finish("failed", error);
    throw error;
  }
  if (!isThenable(result)) {
    finish("ok");
    return result;
  }
  const promise = Promise.resolve(result);
  track(layer, promise, (error) => failHookRun(run, error), finish);
  return promise;
}

/** Hook tools can precede input parsing. Only `next()` admits the input; both contexts share
 * the same span and ordered cleanup list once a body starts. */
function hookCtx(run: HookRun): OperationCtx<unknown> {
  return (run.ctx ??= new OperationCtx(
    run.owner,
    { label: run.label, input: undefined },
    run.call,
    run.span,
  ));
}

function invokeRunHooks<T, I>(
  run: HookRun,
  target: Operation.Handle<T, I>,
  hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I>,
  call: Scope.Invocation<I> | undefined,
  chain: readonly Namespace[] | undefined,
): unknown {
  const runners = run.owner.exts.runners ?? [];
  const at = (index: number): unknown =>
    withHookAccess(run, () => {
      if (index === runners.length) return runHookBody(run, target, chain);
      const ext = runners[index];
      const op = hookTarget as
        | Operation.Handle<unknown, unknown>
        | Scope.Inline<Scope.Depends, unknown, unknown>;
      const next = (): unknown => at(index + 1);
      return ext.hooks!.run!(new RunEvent(run, ext.label, chain, op, call, next));
    });
  return at(0);
}

function runHookBody<T, I>(
  run: HookRun,
  target: Operation.Handle<T, I>,
  chain: readonly Namespace[] | undefined,
): unknown {
  try {
    const ctx = new OperationCtx(
      run.owner,
      target,
      run.call as Scope.Invocation<I> | undefined,
      run.span,
    );
    if (run.ctx) OperationCtx.shareDefers(run.ctx, ctx);
    run.ctx = ctx;
    run.held ??= takeBorrows(target);
    const deps = readOpDeps(run.owner, target, ctx.span, run.held, chain, ctx);
    const pending = parked;
    const override = presetFor(run.owner, target) as Operation.Handle<T, I>["run"] | undefined;
    const body = (): T =>
      withHookAccess(run, () => runBody(override, target, deps, ctx, undefined));
    const result = pending === undefined ? body() : settleDeps(deps, pending).then(body);
    if (isThenable(result)) {
      const promise = Promise.resolve(result);
      (run.bodies ??= []).push(promise);
      track(run.owner, promise, (error) => failHookRun(run, error));
      return promise;
    }
    return result;
  } catch (error) {
    failHookRun(run, error);
    throw error;
  }
}

function failHookRun(run: HookRun, error: unknown): void {
  if (run.failure !== undefined && run.failure.error === error) return;
  run.failure = { error };
  stampOrigin(error, run.label, run.span, run.ctx, endsFlight(run.caller, false));
  if (run.caller !== RECOVERED) stick(run.owner, error);
}

/** A hook may start `next()` then return a substitute. That body still owns its cleanup and
 * resource holds. Its tracked promise prevents close from dropping the unreturned work. */
function finishHookRun(run: HookRun, status: "ok" | "failed", error?: unknown): void {
  if (run.bodies !== undefined) {
    const pending = run.bodies;
    run.bodies = undefined;
    track(
      run.owner,
      Promise.allSettled(pending).then(() => finishHookRun(run, status, error)),
      noop,
    );
    return;
  }
  if (run.failure !== undefined) {
    status = "failed";
    error = run.failure.error;
  }
  closeSpan(run.owner.obs, run.span, status, error);
  const fns = run.ctx === undefined ? undefined : OperationCtx.defersOf(run.ctx);
  const done = (): void => {
    run.active = false;
    releaseBorrows(run.held);
  };
  const tail =
    fns === undefined ? undefined : runDefers(run.owner, fns, endFor(run.owner, status, error));
  if (tail) drainAsync(tail, done);
  else done();
}

function createBorrows(): HeldBorrows {
  const list: ResourceInstance[] = [];
  let settle: () => void = noop;
  const done = new Promise<void>((resolve) => (settle = resolve));
  return { list, done, settle };
}

function hookEvent<const D extends Scope.ExtensionDetails[keyof Scope.ExtensionDetails]>(
  detail: D,
  owner: Layer,
  label: string,
  chain: readonly Namespace[] | undefined = owner.ns,
): Scope.ExtensionCtx & D {
  return Object.assign(new ExtensionCtx(owner, label, chain), detail);
}

/** Run events use one object with direct field writes; the other hook kinds stay on the cold
 * event builder. Reading only the call and `next` does not make any access functions. */
class RunEvent extends ExtensionCtx {
  declare readonly kind: "run";
  declare readonly op: Scope.ExtensionDetails["run"]["op"];
  declare readonly call: Scope.Invocation<unknown> | undefined;
  declare readonly next: () => unknown;
  constructor(
    run: HookRun,
    label: string,
    chain: readonly Namespace[] | undefined,
    op: Scope.ExtensionDetails["run"]["op"],
    call: Scope.Invocation<unknown> | undefined,
    next: () => unknown,
  ) {
    super(run.owner, label, chain, run);
    this.kind = "run";
    this.op = op;
    this.call = call;
    this.next = next;
  }
}
