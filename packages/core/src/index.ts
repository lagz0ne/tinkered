import type { presetSym } from "./preset-symbol";
import { nextTraceWord, seededTraceRandom } from "./trace-random";
import { isError, raise } from "./errors";
import { causesOf, closeOrigin, failureKind, originOf, raiseFrom, stampOrigin } from "./errors";
import type { Origin, RunResult } from "./errors";

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
   * back/release when the owner settles or the resource is released); `signal` cancels work on
   * forced close, while `closing` ends resource-owned waits before graceful drain. */
  export type Ctx = {
    readonly label: string;
    /** The namespace chain used for this build's dependencies; absent for the default bucket. */
    readonly ns: readonly Namespace[] | undefined;
    readonly raise: <K extends string, P extends object>(kind: K, payload: P) => never;
    readonly defer: (fn: (end: Scope.End) => void | PromiseLike<void>) => void;
    readonly signal: AbortSignal;
    /** Aborts when this layer or an ancestor begins closing, before graceful work drains.
     * Created on first read; unlike `signal`, it also fires on a graceful close (ADR 0104). */
    readonly closing: AbortSignal;
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
      /** The root whose close this hook observes. */
      readonly scope: Handle;
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
    /** Observes the root's one close. Skipping `next` cannot skip cleanup; returns cannot
     * replace Core's Result, and throws become teardown errors (ADR 0085). */
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
   * level's return is that level's session result. Root-only in v1: installed on
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
   * `ctx.signal` to stop in-flight work now; graceful lets active calls finish their writes
   * and call cleanup before state is sealed. Both modes refuse new outside calls at once. The outcome is a
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
   * `teardownErrors` (cleanup throws in execution order, plus close-hook throws) may accompany any status. `data`
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
    /** Shut this scope down: close children, join owned calls and their cleanup, seal state,
     * then tear down resources. `opts.graceful` keeps state usable for active calls and their cleanup while
     * refusing new outside calls; the default (forced) seals writes and aborts work now
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
  } as Operation.Handle<R, I> & {
    controller: Operation.Handle<R, I>["controller"];
    [borrowSym]: boolean;
  };
  const controller = edgeTo("controller", base);
  const borrows = seesResource(base.depends);
  base.controller = controller;
  base[borrowSym] = borrows;
  return base;
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

type Entry = { value: unknown };
/** A releasable node: a data cell or a resource. Release cascades from a node to its dependents. */
type Node = Data.Cell<unknown> | Resource.Handle<unknown>;
/** One default-bucket subscription: a wrapper so the same listener subscribed twice keeps two
 * identities. The single per-layer compare lives on the node record (`prev`). */
type Watcher = { fn: (next: unknown, prev: unknown) => void };

/** One namespaced subscription. Its complete chain and comparison value belong to this watcher:
 * chains with the same head can resolve differently through their later fallbacks. */
type NsWatcher = Watcher & {
  ns: readonly Namespace[];
  prev: unknown;
};

type NsWatchers = {
  all: Set<NsWatcher>;
  keys: Map<Namespace, Set<NsWatcher>>;
};

/** The exact data entry a named resource read. */
type NsDataDependency = { source: NodeState; entry: Entry };

/** One named resource bucket. Default resource state stays directly on {@link NodeState}. */
class NsResourceState {
  readonly layer: Layer;
  readonly target: Resource.Handle<unknown>;
  readonly key: Namespace;
  built: Entry | undefined;
  ready: Promise<unknown> | undefined;
  failed: { error: unknown; ready: Promise<unknown> } | undefined = undefined;
  build: Promise<unknown> | undefined;
  gen = 0;
  busy = false;
  reads: Set<NsDataDependency> | undefined;
  users: Set<NsResourceState> | undefined;
  needs: Set<NsResourceState> | undefined;
  owned: ResourceInstance | undefined;
  constructor(owner: Layer, target: Resource.Handle<unknown>, key: Namespace) {
    this.layer = owner;
    this.target = target;
    this.key = key;
  }
}

type ResourceState = NodeState | NsResourceState;

type ResourceInstance = {
  layer: Layer;
  target: Resource.Handle<unknown>;
  hooks: ((end: Scope.End) => void | PromiseLike<void>)[];
  needs: Set<ResourceInstance> | undefined;
  pending: Set<Promise<unknown>> | undefined;
  users: number;
  busy: boolean;
  end: Scope.End | undefined;
  failed: { status: "failed"; error: unknown } | undefined;
  ending: boolean;
  left: number | undefined;
  done: Promise<void> | undefined;
  finish: (() => void) | undefined;
};

/** A hook tagged with its exact instance (undefined for onClose), kept in registration order. */
type DeferEntry = {
  fn: (end: Scope.End) => void | PromiseLike<void>;
  owned: ResourceInstance | undefined;
};

/** All per-node state for one layer, colocated in a single record so a scope allocates ONE Map
 * (`Layer.nodes`) instead of a dozen parallel ones — one `Map.get(node)` fetches everything.
 * A CLASS (not `{}` grown field-by-field) so every record shares one V8 hidden class: compact
 * allocation and monomorphic field access on the hot paths. */
class NodeState {
  /** This layer's own data-cell shadow (copy-on-write). */
  cell: Entry | undefined;
  /** Memoized nearest cell up the chain, always valid once computed (a missing cell resolves to an
   * entry holding the cell's initial value); undefined means not computed yet. */
  eff: Entry | undefined;
  /** Built resource instance — the delivered VALUE, for sync and async builds alike (ADR 0044). */
  built: Entry | undefined;
  /** The settled build promise of an async resource: the imperative verbs (`resolve`/`get`) hand
   * it back with a stable identity; a dependency slot gets the value instead. */
  ready: Promise<unknown> | undefined;
  /** A rejected async build, sticky until release: a slot throws its error, `resolve` returns
   * the same rejected promise. */
  failed: { error: unknown; ready: Promise<unknown> } | undefined = undefined;
  build: Promise<unknown> | undefined;
  /** Resource generation (bumped on invalidation to supersede a late build). */
  gen = 0;
  /** Build currently in progress (circular-resource guard). */
  busy = false;
  /** The live build; its `pending` are the op promises a release waits on. */
  owned: ResourceInstance | undefined;
  /** Resources that depend on this node (for cascade release/close). */
  users: Set<Resource.Handle<unknown>> | undefined;
  /** Memoized controller: the public `controller` path always passes an undefined observation
   * span, so a controller for (layer, node) is stable — reuse it instead of reallocating closures. */
  controller: unknown;
  /** Watchers of this cell registered at this layer (a write visits only the changed cell's). */
  watch: Set<Watcher> | undefined;
  /** Value the watchers at this layer were last called with; refreshed at registration so a new
   * watcher never inherits a stale comparison. */
  prev: unknown;
  /** Named resource buckets at this layer. Scope-target resources never use this map. */
  named: Map<Namespace, NsResourceState> | undefined;
  /** Named cell buckets at this layer, keyed by namespace (ADR 0059): one `(layer, ns, unit)`
   * bucket per write. Absent until the first namespaced write at this layer. */
  cells: Map<Namespace, Entry> | undefined;
  /** Named resource states keyed by the exact data entry they read. */
  readers: Map<Entry, Set<NsResourceState>> | undefined;
  /** Namespaced watchers at this layer. Each owns its full chain and last observed value because
   * two chains with the same write head can resolve through different fallback buckets. `keys`
   * selects only chains containing a changed named bucket; `all` serves default and child flushes. */
  nsWatch: NsWatchers | undefined;
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
    if (layer.aborted) ac.abort((layer.reason ??= new CancelReason()));
    layer.abort = ac;
  }
  return ac.signal;
}

/** The extension chains a root chose (ADR 0050, 0051): each is the filtered list of extensions
 * that declare that hook, or undefined when none does. One record per root, shared by every layer
 * under it, so a session reads its route from its parent instead of walking to the root. */
type ExtRoutes = {
  readonly runs: readonly Scope.Extension<unknown>[] | undefined;
  readonly writes: readonly Scope.Extension<unknown>[] | undefined;
  readonly session: readonly Scope.Extension<unknown>[] | undefined;
};

const NO_EXTS: ExtRoutes = { runs: undefined, writes: undefined, session: undefined };
/** A layer's node store, child set, owned-work set, defer list, and teardown errors start as these
 * shared empty ones, so an idle layer allocates none (performance rule 4). Never written: the first
 * write gives the layer its own ({@link nodeState}, {@link makeLayer}, {@link addWork},
 * {@link addDefer}, {@link addError}); every reader reads them as usual. */
const NO_NODES = new Map<object, NodeState>();
/** Children and pending work share an empty set; each write gate gives its owner a new set. */
const NO_CHILDREN = new Set<never>();
/** Cleanup and error lists share an empty array; each write gate gives its owner a new array. */
const NO_DEFERS: DeferEntry[] = [];

/** One layer of the scope chain. A lazy frame is always a child, so promotion has a parent. */
type Layer = {
  children: Set<Layer>;
  /** Single node-keyed store: cells, effective-cache, resources, builds, generations, build-flag,
   * borrows, dependents, and cached controllers all live in one {@link NodeState} per node. */
  nodes: Map<object, NodeState>;
  /** Named states linked to an ancestor's bucket, detached when this layer closes. */
  links?: Set<NsResourceState>;
  /** Lazily allocated: empty unless the scope was seeded with presets/tags. */
  presets: Map<unknown, unknown> | undefined;
  tags: LayerTags | undefined;
  pending: Set<Promise<unknown>>;
  hooks: DeferEntry[];
  /** Live dependency holds owned by resource instances on this layer. */
  holds: number;
  /** Cancel state, decoupled from the signal so a forced close needn't dispatch abort events when no
   * factory ever asked for `ctx.signal`. `abort` (the real AbortController) is materialized lazily by
   * {@link signalOf} on first `ctx.signal` read, and kept in sync with `aborted`/`reason`. */
  aborted: boolean;
  reason: unknown;
  abort: AbortController | undefined;
  cancelled: boolean;
  swept: boolean;
  bodyEnd: Promise<Scope.Outcome> | undefined;
  failed: { cause: unknown } | undefined;
  /** Panics stuck to this layer before any recorded `failed`, in failure order; a `settle` that
   * receives one takes it back (ADR 0067). Absent until the first panic. A subflow under a run hook
   * sticks its panic twice (the hook's promise and the run's own); `recover` drops every copy. */
  panics?: unknown[];
  childError: { cause: unknown } | undefined;
  /** A tagged subflow reports its failed child session through its returned promise. In the
   * literal, so every layer shares one shape: a later add would give sessions a second map. */
  caller: RunState | undefined;
  errors: unknown[];
  body: Promise<unknown> | undefined;
  closed: boolean;
  /** Created only by the first closing read, including the parent's linked signal. */
  closeAbort?: AbortController;
  stop?: AbortSignal;
  closing: Promise<Scope.Result> | undefined;
  obs: Obs;
  trace: Observe.Trace | undefined;
  clock: Clock.Handle;
  random: Random.Handle;
  ctx: Resource.Ctx | undefined;
  /** The ambient namespace chain of this layer (ADR 0059): set from the scope/session options,
   * inherited by child sessions, overridden per call through a view layer. Undefined = default. */
  ns: readonly Namespace[] | undefined;
  /** The root's extension routes, inherited by every layer under it ({@link ExtRoutes}). */
  exts: ExtRoutes;
} & ({ lazy?: false; up: Layer | undefined } | { lazy: true; up: Layer });

type ExtRec = { settled: boolean; value: unknown };
const EXTENSIONS = new WeakMap<Layer, Map<Scope.Extension<unknown>, ExtRec>>();

/** A session under the root's `session` hooks (ADR 0051, 0069), off the Layer record: registered
 * when the session is made, so `closeLayer` finds it with the one lookup it already made for the
 * `next()` settler. `settle` is a wrapped bare session's `next()` resolver: `closeLayer` settles it
 * when the layer's close resolves, so a session felled by its parent's cascade settles its hooks
 * like an explicit close; it is cleared at settle. `state` holds the data for the hooks: 0 (open)
 * until the close finishes, 1 (held) while its data waits for the hooks to return (data cell and tag
 * reads still work), 2 (done) once they returned. `moved` says the held store went into a `Result`
 * (`withData`). A never-closed layer's entry dies with the layer. */
type SessionHooks = {
  settle: ((ended: Scope.Result) => void) | undefined;
  state: 0 | 1 | 2;
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

/** A root refuses outside calls before its close hooks run. Running work keeps its helpers
 * until the drain ends, as with Go http.Server.Shutdown (ADR 0028, 0104). */
function ensureAccepting(layer: Layer): void {
  if (
    (layer.closed || layer.closing || (layer.swept && layer.up === undefined)) &&
    !hookCanRead(layer)
  )
    raise("Disposed", { reason: "scope is closed" });
}

/** Only call entry uses the body's or caller's live ownership. Release still uses
 * ensureAccepting without this access, so it cannot tear down helpers during a drain. */
function ensureRunning(layer: Layer, caller?: RunState): void {
  if (
    !layer.closed &&
    (layer.body !== undefined || (caller && caller !== RECOVERED && caller.live))
  )
    return;
  ensureAccepting(layer);
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
  for (let cur: Layer | undefined = layer; cur; cur = cur.up) {
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
      (cur, key) => cur.nodes.get(target)?.cells?.get(key),
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
  const ws = rec?.watch;
  if (!ws?.size || !rec) return;
  const next = readCell(layer, target);
  const prev = rec.prev;
  if (!cellEq(target, prev, next)) notifyLayer(rec, ws, next, prev);
}

/** Run one layer's watchers in registration order against the value already read for the layer. */
function notifyLayer(rec: NodeState, ws: Set<Watcher>, next: unknown, prev: unknown): void {
  rec.prev = next;
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
  let bucket = rec.cells?.get(key);
  if (bucket === undefined) {
    bucket = { value: seed };
    (rec.cells ??= new Map()).set(key, bucket);
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
    const watch = cur.nodes.get(target)?.nsWatch?.keys.get(key);
    if (watch) pending.push(...(pendingNsWatchers(cur, target, watch) ?? []));
    for (const child of cur.children) {
      if (!shadowsNamedChange(child, target, key)) collect(child);
    }
  }
  collect(layer);
  for (const p of pending) p.fn(p.next, p.prev);
}

function shadowsNamedChange(layer: Layer, target: Data.Cell<unknown>, key: Namespace): boolean {
  const rec = layer.nodes.get(target);
  return !!rec?.cell || !!rec?.cells?.has(key);
}

/** A named bucket change can affect only chains containing its key at this layer. A default
 * change or a flush inherited by a child re-resolves all chains. */
function flushNsWatchers(layer: Layer, target: Data.Cell<unknown>, key?: Namespace): void {
  const nsWatch = layer.nodes.get(target)?.nsWatch;
  if (!nsWatch) return;
  const watch = key === undefined ? nsWatch.all : nsWatch.keys.get(key);
  if (!watch?.size) return;
  const pending = pendingNsWatchers(layer, target, watch);
  for (const p of pending ?? []) p.fn(p.next, p.prev);
}

/** Snapshot the changed watchers BEFORE any callback fires: read and record each watcher's new value
 * so a callback that writes this cell cannot change what a later watcher in this round observes. */
function pendingNsWatchers(
  layer: Layer,
  target: Data.Cell<unknown>,
  watch: Set<NsWatcher>,
): { fn: (n: unknown, p: unknown) => void; next: unknown; prev: unknown }[] | undefined {
  let pending: { fn: (n: unknown, p: unknown) => void; next: unknown; prev: unknown }[] | undefined;
  for (const watcher of watch) {
    const next = readCell(layer, target, watcher.ns);
    const prev = watcher.prev;
    if (cellEq(target, prev, next)) continue;
    watcher.prev = next;
    (pending ??= []).push({ fn: watcher.fn, next, prev });
  }
  return pending;
}

/** A layer's own tags: one flat list in authored order (a tagged call brings one or two, and a
 * scan beats a map). Writers go through {@link seedTags}. */
type LayerTags = readonly Tag.Binding<unknown>[];

/** The binding of `target` nearest the top of a layer's own tags. */
function topTag(
  cur: Layer,
  target: Tag.Handle<unknown>,
): { present: true; value: unknown } | undefined {
  const tags = cur.tags;
  return tags === undefined ? undefined : findBinding(tags, target);
}

function tagFind(
  layer: Layer,
  target: Tag.Handle<unknown>,
  chain: readonly Namespace[] | undefined = layer.ns,
): Tag.Presence<unknown> {
  if (chain !== undefined) return tagFindNs(layer, target, chain);
  for (let cur: Layer | undefined = layer; cur; cur = cur.up) {
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
    (cur, key) => (cur.up === undefined ? findBinding(key.tags, target) : undefined),
    (cur) => topTag(cur, target),
  );
  if (hit) return hit;
  return target.hasDefault ? { present: true, value: target.def } : { present: false };
}

/** The binding of `target` nearest the end of `bindings`: a layer's own tags or a namespace's. */
function findBinding(
  bindings: readonly Tag.Binding<unknown>[],
  target: Tag.Handle<unknown>,
): { present: true; value: unknown } | undefined {
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i];
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
  for (let cur: Layer | undefined = layer; cur; cur = cur.up) appendLayerTags(out, cur, target);
  return out;
}

function appendNsTags(
  out: unknown[],
  chain: readonly Namespace[],
  target: Tag.Handle<unknown>,
): void {
  for (const key of chain) appendBindings(out, key.tags, target);
}

/** A namespaced `.all` follows the same layers-first walk as cell selection. */
function tagAllNs(
  layer: Layer,
  target: Tag.Handle<unknown>,
  chain: readonly Namespace[],
): unknown[] {
  const out: unknown[] = [];
  for (let cur: Layer | undefined = layer; cur; cur = cur.up) {
    if (cur.up === undefined) appendNsTags(out, chain, target);
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
  for (let cur: Layer | undefined = layer; cur; cur = cur.up) {
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
  (rec.watch ??= new Set()).add(w);
  return () => void rec.watch?.delete(w);
}

/** Recompute this layer's last notified value when it went stale before a new watcher registers. */
function refreshNotified(layer: Layer, target: Data.Cell<unknown>, rec: NodeState): void {
  if (rec.watch?.size) return;
  const next = readCell(layer, target);
  if (!cellEq(target, rec.prev, next)) rec.prev = next;
}

function writeWithHooks<T>(
  layer: Layer,
  target: Data.Cell<T>,
  value: T,
  chain: readonly Namespace[] | undefined = layer.ns,
): void {
  const writes = layer.exts.writes;
  if (writes === undefined) return writeCell(layer, target, value, chain);
  ensureOpen(layer);
  const at = (index: number): void => {
    if (index === writes.length) return writeCell(layer, target, value, chain);
    const ext = writes[index];
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
  const watcher: NsWatcher = { fn, ns: chain, prev: readCell(layer, target, chain) };
  const nsWatch = (rec.nsWatch ??= { all: new Set(), keys: new Map() });
  nsWatch.all.add(watcher);
  const keys = nsWatch.keys;
  for (const key of chain) {
    let watch = keys.get(key);
    if (!watch) {
      watch = new Set();
      keys.set(key, watch);
    }
    watch.add(watcher);
  }
  return () => {
    nsWatch.all.delete(watcher);
    for (const key of chain) {
      const watch = keys.get(key);
      watch?.delete(watcher);
      if (watch?.size === 0) keys.delete(key);
    }
  };
}

function resolveControllerEdge(
  layer: Layer,
  target: unknown,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
): unknown {
  if (isData(target)) return dataController(layer, target, chain);
  if (isOperation(target)) return operationController(layer, target, up, chain, caller);
  raise("InvalidDependency", { label: "edge", reason: "unknown controller target" });
}

function resolveEdge(
  layer: Layer,
  dep: Edge<string, unknown>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
): unknown {
  if (dep.kind === "controller") return resolveControllerEdge(layer, dep.target, up, chain, caller);
  const target = dep.target as Tag.Handle<unknown>;
  if (dep.kind === "all") return tagAll(layer, target, chain);
  if (dep.kind === "optional") return tagFind(layer, target, chain);
  return tagRequired(layer, target, chain);
}

function resolveDep(
  layer: Layer,
  dep: Scope.Dependency,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
): unknown {
  if (isEdge(dep)) return resolveEdge(layer, dep, up, chain, caller);
  if (isData(dep)) return readCell(layer, dep, chain);
  if (isTag(dep)) return tagRequired(layer, dep, chain);
  if (isOperation(dep)) return operationController(layer, dep, up, chain, caller);
  if (isResource(dep)) return resourceSlot(layer, dep, up, chain);
  if (isExtension(dep)) return resolveExtension(layer, dep);
  raise("InvalidDependency", { label: "unknown", reason: "unknown dependency" });
}

const noop = (() => {
  const fn = (() => undefined) as (() => undefined) & Observe.Logger;
  for (const key in LEVELS) fn[key as keyof typeof LEVELS] = fn;
  return fn;
})();

/** Attach a rejection handler to a fire-and-forget close so an internally started close (from a
 * teardown hook) is never an unhandled rejection; the promise keeps its rejection for a later
 * external awaiter. */
function ignoreRejection(ready: Promise<unknown>): void {
  return void ready.catch(noop);
}

type Obs = {
  on: boolean;
  clock: () => number;
  export: ((span: SpanImpl) => void) | undefined;
  limit: number;
  history: SpanImpl[];
  log: ((entry: Observe.Log) => void) | undefined;
  level: number;
  id: number;
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
      const onAbort = (): void => {
        clearTimeout(id);
        reject(signal!.reason);
      };
      const id = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

/** The one sanctioned real-random read (ADR 0062). `scripts/check-ambient.mjs` skips the reads
 * inside a declaration tagged `@ambientSource`, and only there.
 *
 * @ambientSource */
const systemRandom = {
  source: {
    next: () => Math.random(),
    // Browsers give `randomUUID` to secure pages only; plain http still has `getRandomValues`.
    uuid: () => {
      if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
      return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (+c / 4)))).toString(16),
      );
    },
  },
  seed: () => {
    const [a, b, c, d] = crypto.getRandomValues(new Int32Array(4));
    return { a: a!, b: b!, c: c!, d: d! || 1 };
  },
};

/** Span and log times read `observe.clock` if set, else the scope's ambient clock, so a test clock
 * freezes them too (ADR 0034). */
function makeObs(config: Observe.Config | undefined, clock: Clock.Handle): Obs {
  if (!config) return DEFAULT_OBS;
  const c = config;
  const limit = c.history ?? 0;
  return {
    on: c.export !== undefined || limit > 0,
    clock: c.clock ?? (() => clock.currentTimeMillis()),
    export: c.export,
    limit,
    history: [],
    log: c.log,
    level: c.level ?? 0,
    id: 1,
  };
}

/** Observation off: no span opens and no log line is written, so nothing reads its clock. */
const DEFAULT_OBS: Obs = makeObs({}, systemClock);

/** Keep the off check small enough to inline; id creation runs only behind it. */
function openSpan(
  obs: Obs,
  layer: Layer,
  up: SpanImpl | undefined,
  name: string,
  kind: Observe.Kind,
): SpanImpl | undefined {
  if (!obs.on) return undefined;
  return new SpanImpl(obs, layer, up, name, kind);
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
  end: number | undefined;
  status: "ok" | "failed" | undefined;
  declare error?: unknown;
  private static system: ReturnType<typeof systemRandom.seed> | undefined;
  declare private trace:
    | { a: number; b: number; c: number; d: number; text: string | undefined }
    | undefined;
  declare private a: number;
  declare private b: number;
  declare private high: number;
  declare private low: number;
  declare private hi: number;
  declare private lo: number;
  declare private text: string | undefined;
  declare private parentHex: string | undefined;
  declare private attrs: Record<string, unknown> | undefined;
  declare private marks: Observe.Event[] | undefined;

  constructor(obs: Obs, layer: Layer, up: SpanImpl | undefined, name: string, kind: Observe.Kind) {
    const random = SpanImpl.randomFor(layer.random);
    this.trace = SpanImpl.traceFor(layer, up);
    if (this.trace === undefined) {
      this.a = nextTraceWord(random);
      this.b = nextTraceWord(random);
    } else {
      this.a = 0;
      this.b = 0;
    }
    this.high = nextTraceWord(random);
    this.low = nextTraceWord(random) || 1;
    if (up === undefined) {
      this.hi = 0;
      this.lo = 0;
      this.parentHex = layer.trace?.parentSpanId;
      this.parentId = undefined;
      this.sampled = layer.trace?.sampled !== false;
    } else {
      this.hi = up.high;
      this.lo = up.low;
      this.parentHex = undefined;
      this.parentId = up.id;
      this.sampled = up.sampled;
    }
    this.id = obs.id++;
    this.name = name;
    this.kind = kind;
    this.start = obs.clock();
  }

  get traceId(): string {
    const trace = this.bits();
    return (trace.text ??= SpanImpl.hex(trace.a, trace.b) + SpanImpl.hex(trace.c, trace.d));
  }

  get spanId(): string {
    return (this.text ??= SpanImpl.hex(this.high, this.low));
  }

  get parentSpanId(): string | undefined {
    if (this.parentId === undefined) return this.parentHex;
    return (this.parentHex ??= SpanImpl.hex(this.hi, this.lo));
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

  private static randomFor(random: Random.Handle): ReturnType<typeof systemRandom.seed> {
    return (
      (random === systemRandom.source ? undefined : seededTraceRandom.get(random)) ??
      (SpanImpl.system ??= systemRandom.seed())
    );
  }

  private static traceFor(layer: Layer, up: SpanImpl | undefined): SpanImpl["trace"] {
    if (up !== undefined) return up.bits();
    if (layer.trace !== undefined) return { a: 0, b: 0, c: 0, d: 0, text: layer.trace.traceId };
    return undefined;
  }

  /** A root's last two trace words also name its span. Unread childless roots need no record. */
  private bits(): NonNullable<SpanImpl["trace"]> {
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
  if (obs.limit > 0) {
    obs.history.push(span);
    if (obs.history.length > obs.limit) obs.history.shift();
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

function logFor(obs: Obs, span: SpanImpl | undefined): Observe.Logger {
  const sink = obs.log;
  if (!sink) return noop;
  const min = obs.level;
  const at = (level: number) => (message: string, attributes?: Record<string, unknown>) => {
    if (level < min) return;
    isolate(() => sink({ time: obs.clock(), level, message, attributes: attributes ?? {}, span }));
  };
  return Object.assign(at(LEVELS.info), {
    debug: at(LEVELS.debug),
    info: at(LEVELS.info),
    warn: at(LEVELS.warn),
    error: at(LEVELS.error),
  });
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
const RECOVERED: unique symbol = Symbol();
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
      const twin = OperationControl.recover(this);
      this.settler = (call) => {
        const signal = call?.signal;
        try {
          return settledValue(layer, twin.run(call), signal);
        } catch (error) {
          return failedRun(layer, error, signal);
        }
      };
    }
    return this.settler;
  }
  /** The same controller with `settle`'s caller, built on first use and kept, so `run` itself
   * carries no receiver. */
  static recover<U, J>(control: OperationControl<U, J>): OperationControl<U, J> {
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
  if (layer.failed !== undefined || isCancel(layer, error) || failureKind(error) === "error")
    return;
  materialize(layer);
  (layer.panics ??= []).push(error);
}

/** A layer's first real failure: a stuck panic, when there is one, came before any `failed`.
 * Indexed, not destructured: array destructuring runs the iterator protocol, which made this
 * hot check too big for V8 to inline into close. */
function failureOf(layer: Layer): { cause: unknown } | undefined {
  const panics = layer.panics;
  return panics === undefined ? layer.failed : { cause: panics[0] };
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

/** Add owned work to a layer, giving it its own set on the first add ({@link NO_CHILDREN}). */
function addWork(layer: Layer, work: Promise<unknown>): void {
  materialize(layer);
  if (layer.pending === NO_CHILDREN) layer.pending = new Set();
  layer.pending.add(work);
}

/** Resource builds already own node state; scope and extension handles already have full layers. */
function addDefer(layer: Layer, entry: DeferEntry): void {
  if (layer.hooks === NO_DEFERS) layer.hooks = [];
  layer.hooks.push(entry);
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
    return "AbortError: The scope closed before this work finished.";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return this.toString();
  }
}

/** One reason for every close signal (`ctx.closing`): a no-reason `abort()` mints a
 * `DOMException` with a stack capture per close. Keep its web abort code for callers that
 * pass the closing signal to I/O and report that code. */
const CLOSING_REASON = Object.assign(new CancelReason(), { code: 20 });

function isCancelReason(error: unknown): boolean {
  return typeof error === "object" && error !== null && cancelBrand in error;
}

/** A rejection caused by this cancellation (ADR 0026, 0090): the owner must be aborted and the
 * error must be its exact reason, or a Core cancel reason from an awaited descendant. A different
 * real error still fails, even if it arrives after abort. */
function isCancel(layer: Layer, error: unknown): boolean {
  return layer.aborted && (error === layer.reason || isCancelReason(error));
}

function endFor(layer: Layer, status: "ok" | "failed", error: unknown): Scope.End {
  if (status === "failed")
    return isCancel(layer, error) ? { status: "cancelled" } : { status: "failed", error };
  return layer.aborted ? { status: "cancelled" } : SUCCESS;
}

/** Layers whose teardown callbacks (cleanups/hooks) are executing right now, innermost last. Each
 * push and pop wrap one synchronous call in try/finally, so they nest strictly. */
const tearing: Layer[] = [];

/** True if closing `target` would join a layer that is mid-teardown — `target` is that layer or an
 * ancestor of it — so a re-entrant close from within a (descendant) teardown must not wait on itself.
 * A close of an unrelated scope from a cleanup is not re-entrant and gets its real closing promise. */
function closeWouldReenter(target: Layer): boolean {
  return tearing.length !== 0 && reentersTeardown(target);
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
    tearing.push(layer);
    try {
      pending = fns[i](end);
    } catch (error) {
      addError(layer, error);
      continue;
    } finally {
      tearing.pop();
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
  return runParked(override, target, deps, ctx, pending);
}

/** The parked tail of {@link runBody}, out of line so its closure stays out of the hot inline budget. */
function runParked<T, I>(
  override: Operation.Handle<T, I>["run"] | undefined,
  target: Operation.Handle<T, I>,
  deps: Record<string, unknown>,
  ctx: Operation.Ctx<I>,
  pending: PendingSlot[],
): T {
  return settleDeps(deps, pending).then(() =>
    override ? override(deps, ctx) : target.run(deps, ctx),
  ) as T;
}

class OperationCtx<I> implements Operation.Ctx<I> {
  live = true;
  declare private layer: Layer;
  /** The run's `defer` fns, read when it finishes ({@link finishRun}, {@link finishHookRun}). */
  hooks: ((end: Scope.End) => void | PromiseLike<void>)[] | undefined;
  declare readonly label: string;
  declare readonly rawInput: unknown;
  declare readonly input: I;
  private tools: Observe.Ctx | undefined;
  private logs: Observe.Logger | undefined;
  declare readonly span: SpanImpl | undefined;
  declare readonly clock: Clock.Handle;
  declare readonly random: Random.Handle;
  constructor(
    owner: Layer,
    target: Pick<Operation.Handle<unknown, I>, "label" | "input">,
    call: Scope.Invocation<I> | undefined,
    span: SpanImpl | undefined,
  ) {
    this.layer = owner;
    this.label = target.label;
    /** The invocation's input pair, verbatim from the controller body: a defined `input` is used
     * as-is (raw = same), else `rawInput` — possibly undefined — is parsed. Computed here (once
     * per run either way) so the hot closure stays branch-budget-clean. */
    const given = call?.input;
    const rawInput = given !== undefined ? given : call?.rawInput;
    this.rawInput = rawInput;
    this.input =
      given !== undefined ? given : target.input ? parseInput(target, rawInput) : (undefined as I);
    this.span = span;
    this.clock = owner.clock;
    this.random = owner.random;
  }
  private deferFn: ((fn: (end: Scope.End) => void | PromiseLike<void>) => void) | undefined;
  /** These callbacks belong to this run. An async tail or teardown error grows the layer at
   * its own gate; a close during cleanup grows it through the active tagged stack. Built on the
   * first read and kept, so a run that never defers pays no closure. */
  get defer(): (fn: (end: Scope.End) => void | PromiseLike<void>) => void {
    return (this.deferFn ??= (fn) => {
      (this.hooks ??= []).push(fn);
    });
  }
  get obs(): Observe.Ctx {
    return (this.tools ??= obsCtx(this.layer, this.span));
  }
  get log(): Observe.Logger {
    return (this.logs ??= logFor(this.layer.obs, this.span));
  }
  get raise(): Operation.Ctx<I>["raise"] {
    return (kind, payload) => raiseFrom(this, kind, payload);
  }
  /** A hook and its body register into one ordered defer list, even when the hook needed a
   * context before the body's input was parsed. Plain runs never call this. */
  static share(from: OperationCtx<unknown>, to: OperationCtx<unknown>): void {
    to.hooks = from.hooks ??= [];
  }
  get signal(): AbortSignal {
    return signalOf(this.layer);
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
  up: SpanImpl | undefined,
  caller: RunState | undefined,
  call: Scope.Invocation<I>,
  inheritedChain: readonly Namespace[] | undefined,
): Awaited<T> | Promise<Awaited<T>> {
  const tags = call.tags;
  const chain = call.ns === undefined ? inheritedChain : nsChainOf(call.ns);
  const inner = stripNs(call);
  const nested = caller !== undefined;
  let tagged: Awaited<T> | Promise<Awaited<T>>;
  if (call.signal !== undefined || layer.exts.session !== undefined) {
    /** Hooks need a body the onion can call; cancellation needs an attached child owner. */
    tagged = runSessionWith(
      layer,
      { tags, ns: chain },
      runTaggedBody.bind(undefined, target, up, inner, chain, nested),
      caller,
      call.signal,
    ) as Awaited<T> | Promise<Awaited<T>>;
  } else {
    tagged = runTaggedFrame(
      layer,
      target,
      up,
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
  if (layer.lazy && !layer.closed) expandFrame(layer, layer.up);
}

/** A tagged session before it owns anything. The prototype supplies only immutable defaults;
 * its services and bindings are retained from this call, never borrowed from a sibling. */
class TaggedFrame {
  declare up: Layer;
  declare tags: LayerTags | undefined;
  declare ns: readonly Namespace[] | undefined;
  declare caller: RunState | undefined;
  declare obs: Obs;
  declare trace: Observe.Trace | undefined;
  declare clock: Clock.Handle;
  declare random: Random.Handle;
  declare exts: ExtRoutes;
  declare stack: TaggedFrame | undefined;
  declare lazy: boolean;
  declare children: Set<Layer>;
  declare nodes: Map<object, NodeState>;
  declare presets: Map<unknown, unknown> | undefined;
  declare pending: Set<Promise<unknown>>;
  declare hooks: DeferEntry[];
  declare holds: number;
  declare aborted: boolean;
  declare reason: unknown;
  declare abort: AbortController | undefined;
  declare cancelled: boolean;
  declare swept: boolean;
  declare bodyEnd: Promise<Scope.Outcome> | undefined;
  declare failed: { cause: unknown } | undefined;
  declare childError: { cause: unknown } | undefined;
  declare errors: unknown[];
  declare body: Promise<unknown> | undefined;
  declare closed: boolean;
  declare closing: Promise<Scope.Result> | undefined;
  declare ctx: Resource.Ctx | undefined;
  constructor(
    up: Layer,
    tags: Scope.Bindings,
    ns: readonly Namespace[] | undefined,
    caller: RunState | undefined,
    previous: TaggedFrame | undefined,
  ) {
    this.up = up;
    this.tags = seedTags(tags);
    this.ns = ns;
    this.caller = caller;
    this.obs = up.obs;
    this.trace = up.trace;
    this.clock = up.clock;
    this.random = up.random;
    this.exts = up.exts;
    this.stack = previous;
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
  up: SpanImpl | undefined,
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
    ensureRunning(layer, caller);
    child = new TaggedFrame(layer, tags, chain, caller, previous);
    activeTagged = child;
    /** Growing a clean child here changes only cost; swept children need the parent's end state. */
    if (layer.swept) materialize(child);
    raw = adoptBody(runUntagged(child, target, up, call, chain, undefined, nested));
  } catch (error) {
    raw = Promise.reject(error);
  } finally {
    /** Restore the live prefix so future closes do not walk every past tagged call. */
    activeTagged = previous;
    /** An escaped context must not retain the earlier frames through this link. */
    if (child) child.stack = undefined;
  }
  return endTaggedFrame(child, raw);
}

/** Run `target` in the call's namespace (ADR 0059). The real layer remains the owner of
 * lifecycle state and registries; the chain travels beside it through resolution. */
function runNsCall<I>(
  layer: Layer,
  target: Operation.Handle<unknown, I>,
  up: SpanImpl | undefined,
  caller: RunState | undefined,
  call: Scope.Invocation<I> & { readonly ns: Ns },
): unknown {
  ensureRunning(layer, caller);
  return runUntagged(layer, target, up, stripNs(call), nsChainOf(call.ns), caller);
}

/** The stripped call a namespaced or tagged run replays (ADR 0038): the same `input`/`rawInput`
 * selection the untagged path makes, minus `ns` and `tags` (already honored by the view layer or
 * the child session). */
function stripNs<I>(call: Scope.Invocation<I>): Scope.Invocation<I> | undefined {
  if (call.input !== undefined) return { input: call.input };
  if (call.rawInput !== undefined) return { rawInput: call.rawInput };
  return undefined;
}

/** Release a run's borrows: the resource instances its deps held for the run's whole lifetime
 * (ADR 0026 Q2). */
function releaseBorrows(held: HeldBorrows | undefined): void {
  if (!held) return;
  for (const owned of held.list) removeBorrow(owned, held.done);
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
  const fns = ctx?.hooks;
  if (fns === undefined || fns.length === 0) {
    if (ctx) ctx.live = false;
    releaseBorrows(held);
    return;
  }
  void thenDone(runDefers(layer, fns, endFor(layer, status, error)), (): void => {
    if (ctx) ctx.live = false;
    releaseBorrows(held);
  });
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
  const ready = Promise.resolve(result);
  track(layer, ready, runFailure(layer, caller), onSettle);
  return ready;
}

/** A controller's `run`: one small closure over the run's fixed facts that calls {@link runOnce}.
 * The closure is made once per controller; a replay ({@link runUntagged}) calls `runOnce` itself
 * and makes none. */
function executorFor<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  caller: RunState | undefined,
): (call?: Scope.Invocation<I>) => unknown {
  const sees = seesResourceOf(target);
  return (call?: Scope.Invocation<I>): unknown =>
    runOnce(layer, target, up, chain, caller, false, sees, call);
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
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  caller: RunState | undefined,
  replay: Replay,
  sees: boolean,
  call: Scope.Invocation<I> | undefined,
): unknown {
  if (call !== undefined) {
    if (hasCallSession(call)) return runTagged(layer, target, up, caller, call, chain);
    if (hasCallNs(call))
      return runNsCall(
        layer,
        target,
        up,
        caller,
        call as Scope.Invocation<I> & { readonly ns: Ns },
      );
  }
  ensureRunning(layer, caller);
  const obs = layer.obs;
  const span = openSpan(obs, layer, up, target.label, "operation");
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
    closeSpan(obs, span, "ok");
    finishRun(layer, ctx, held, "ok");
    return result;
  }
  return finishAsyncRun(layer, result, caller, replay, obs, span, target.label, ctx, held);
}

function operationController<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
  hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I> = target,
): Scope.OperationController<T, I> {
  const execute = executorFor(layer, target, up, chain, caller);
  const runs = layer.exts.runs;
  if (runs === undefined)
    return new OperationControl(
      execute,
      layer,
      target,
      up,
      chain,
      hookTarget,
    ) as Scope.OperationController<T, I>;
  const run = (call?: Scope.Invocation<I>): unknown =>
    runHookCall(layer, target, up, chain, caller, hookTarget, call);
  return new OperationControl(
    run,
    layer,
    target,
    up,
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
  up: SpanImpl | undefined,
  call: Scope.Invocation<I> | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  caller?: RunState,
  nested = false,
): T {
  return runOnce(
    layer,
    target,
    up,
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
  while (cur.up) cur = cur.up;
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
  declare private layer: Layer;
  declare private owned: ResourceInstance;
  declare private settled: () => boolean;
  declare readonly label: string;
  private tools: Observe.Ctx | undefined;
  private logs: Observe.Logger | undefined;
  declare readonly span: SpanImpl | undefined;
  declare readonly clock: Clock.Handle;
  declare readonly random: Random.Handle;
  readonly ns: readonly Namespace[] | undefined;
  constructor(
    owned: ResourceInstance,
    span: SpanImpl | undefined,
    settled: () => boolean,
    chain: readonly Namespace[] | undefined,
  ) {
    this.ns = chain?.length ? chain : undefined;
    this.layer = owned.layer;
    this.owned = owned;
    this.settled = settled;
    this.label = owned.target.label;
    this.span = span;
    this.clock = owned.layer.clock;
    this.random = owned.layer.random;
  }
  readonly defer = (fn: (end: Scope.End) => void | PromiseLike<void>): void => {
    if (this.settled()) raise("Disposed", { reason: "resource factory already finished" });
    this.owned.hooks.push(fn);
    addDefer(this.owned.layer, { fn, owned: this.owned });
  };
  get obs(): Observe.Ctx {
    return (this.tools ??= obsCtx(this.layer, this.span));
  }
  get log(): Observe.Logger {
    return (this.logs ??= logFor(this.layer.obs, this.span));
  }
  get raise(): Resource.Ctx["raise"] {
    return (kind, payload) => raiseFrom(this, kind, payload);
  }
  get closing(): AbortSignal {
    return closingOf(this.layer);
  }
  get signal(): AbortSignal {
    return signalOf(this.layer);
  }
}

/** Build the ctx a resource factory receives. Only called when the factory declares a ctx param
 * (`factory.length >= 2`); otherwise a per-layer empty ctx (see {@link emptyCtxFor}) is passed, allocated at
 * most once per layer. `defer` closes over the build's `settled`/`superseded` so late registration
 * behaves correctly. */
function buildCtx(
  owned: ResourceInstance,
  span: SpanImpl | undefined,
  settled: () => boolean,
  chain: readonly Namespace[] | undefined,
): Resource.Ctx {
  return new ResourceCtx(owned, span, settled, chain);
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
  private layer: Layer;
  constructor(owner: Layer, chain?: readonly Namespace[]) {
    this.ns = chain;
    this.layer = owner;
    this.clock = owner.clock;
    this.random = owner.random;
  }
  readonly defer = (): void => {
    raise("Disposed", { reason: "resource factory declared no ctx" });
  };
  readonly raise = raiseUnstamped;
  get closing(): AbortSignal {
    return closingOf(this.layer);
  }
  get signal(): AbortSignal {
    return signalOf(this.layer);
  }
}

function emptyCtxFor(owner: Layer, chain: readonly Namespace[] | undefined): Resource.Ctx {
  return chain?.length ? new EmptyCtx(owner, chain) : (owner.ctx ??= new EmptyCtx(owner));
}

/** Read what an extension's `start` returned: the root layer holds one record per installed
 * extension, so a session walks up (ADR 0050). Unsettled or not installed is `NotResolved`. */
function resolveExtension(layer: Layer, ext: Scope.Extension<unknown>): unknown {
  for (let current: Layer | undefined = layer; current !== undefined; current = current.up) {
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
  let owned = state.owned;
  if (owned === undefined) {
    owned = {
      layer: owner,
      target,
      hooks: [],
      needs: undefined,
      pending: undefined,
      users: 0,
      busy: state.busy,
      end: undefined,
      failed: undefined,
      ending: false,
      left: undefined,
      done: undefined,
      finish: undefined,
    };
    state.owned = owned;
  }
  return owned;
}

function hasPresetLayers(layer: Layer): boolean {
  for (let cur: Layer | undefined = layer; cur; cur = cur.up) if (cur.presets) return true;
  return false;
}

function hasRetainedInstance(state: ResourceState): boolean {
  return !!state.owned?.hooks.length || !!state.owned?.needs?.size;
}

function needsHold(owner: Layer, target: Resource.Handle<unknown>, state: ResourceState): boolean {
  if (hasRetainedInstance(state)) return true;
  if (state.built || state.failed) return false;
  return (target as HookFlag)[mayHookSym] !== false || hasPresetLayers(owner);
}

function holdDependency(dependent: ResourceInstance, dependency: ResourceInstance): void {
  if (dependent === dependency || dependent.needs?.has(dependency)) return;
  (dependent.needs ??= new Set()).add(dependency);
  dependent.layer.holds++;
  dependency.users++;
}

function unlinkInstance(owned: ResourceInstance, end: Scope.End): void {
  if (owned.end) return;
  owned.end = owned.failed ?? end;
  if (owned.busy || owned.users || owned.pending?.size) {
    owned.done = new Promise<void>((resolve) => (owned.finish = resolve));
    addWork(owned.layer, owned.done);
  }
}

const readyToFinish: ResourceInstance[] = [];
let drainingReady = false;

function finishTracked(owned: ResourceInstance): void {
  const finished = finishInstance(owned);
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

function completeInstance(owned: ResourceInstance): void {
  if (owned.needs)
    for (const dependency of owned.needs) {
      dependency.users--;
      owned.layer.holds--;
      readyToFinish.push(dependency);
    }
  owned.needs = undefined;
  if (owned.done) owned.layer.pending.delete(owned.done);
  owned.finish?.();
  drainReady();
}

function finishHook(
  owned: ResourceInstance,
  fn: DeferEntry["fn"],
  prev?: Promise<void>,
): Promise<void> | undefined {
  if (owned.ending && owned.left === undefined) return owned.done;
  if (!owned.ending) {
    owned.ending = true;
    owned.left = owned.hooks.length;
  }
  const run = (): Promise<void> | undefined =>
    thenDone(runDefers(owned.layer, [fn], owned.end as Scope.End), (): void => {
      owned.left = (owned.left as number) - 1;
      if (owned.left === 0) completeInstance(owned);
    });
  if (!prev) return run();
  return prev.then(run, run);
}

/** Release extracts defers first; close owns its drain snapshot, so finish need not filter again. */
function finishInstance(owned: ResourceInstance, prev?: Promise<void>): Promise<void> | undefined {
  if (!owned.end || owned.ending || isHeld(owned)) return owned.done;
  owned.ending = true;
  const { layer: owner } = owned;
  const finish = (): Promise<void> | undefined =>
    thenDone(runDefers(owner, owned.hooks, owned.end as Scope.End), () => completeInstance(owned));
  if (prev) {
    const queued = prev.then(finish, finish);
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
  const owned = usesCtx ? instanceOf(owner, target, state) : state.owned;
  if (owned) owned.busy = true;
  return owned;
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
  owned: ResourceInstance | undefined,
  status: "ok" | "failed",
  error?: unknown,
): void {
  if (!owned) return;
  if (status === "failed" && !owned.end) owned.failed = { status, error };
  owned.busy = false;
  finishTracked(owned);
}

function publishSyncResource(
  rec: ResourceState,
  result: unknown,
  canPublish: () => boolean,
  owned: ResourceInstance | undefined,
  obs: Obs,
  span: SpanImpl | undefined,
): void {
  if (canPublish()) rec.built = { value: result };
  settleResourceInstance(owned, "ok");
  closeSpan(obs, span, "ok");
}

function failResourceBuild(
  owner: Layer,
  target: Resource.Handle<unknown>,
  rec: ResourceState,
  gen: number,
  owned: ResourceInstance | undefined,
  error: unknown,
  obs: Obs,
  span: SpanImpl | undefined,
): never {
  if (rec.gen === gen) detachResourceDependencies(owner, target, rec);
  settleResourceInstance(owned, "failed", error);
  closeSpan(obs, span, "failed");
  throw error;
}

function buildHooklessResource<T>(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<T>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
  resolveDeps: typeof resolveResourceDeps,
): unknown {
  const gen = rec.gen;
  const superseded = (): boolean => rec.gen !== gen;
  const canPublish = (): boolean => !superseded() && !owner.closed;
  const obs = owner.obs;
  const span = openSpan(obs, caller, up, target.label, "resource");
  rec.busy = true;
  buildDepth++;
  try {
    const deps = resolveDeps(owner, target, span, superseded, chain, rec, undefined);
    const pending = parked;
    const ctx = emptyCtxFor(owner, chain);
    const fn = target.factory;
    const result =
      pending === undefined ? fn(deps, ctx) : settleDeps(deps, pending).then(() => fn(deps, ctx));
    if (!isThenable(result)) {
      if (canPublish()) rec.built = { value: result };
      closeSpan(obs, span, "ok");
      return result;
    }
    return finishAsyncBuild(owner, rec, result, superseded, canPublish, noop, obs, span);
  } catch (error) {
    return failResourceBuild(owner, target, rec, gen, undefined, error, obs, span);
  } finally {
    buildDepth--;
    rec.busy = false;
  }
}

function buildResource<T>(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<T>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
  resolveDeps: typeof resolveResourceDeps = resolveResourceDeps,
): unknown {
  if (rec.busy) raise("CircularResource", { label: target.label });
  if (
    (target as HookFlag)[mayHookSym] === false &&
    rec.owned === undefined &&
    !hasPresetLayers(owner)
  )
    return buildHooklessResource(owner, caller, target, up, chain, rec, resolveDeps);
  return buildTrackedResource(owner, caller, target, up, chain, rec, resolveDeps);
}

function buildTrackedResource<T>(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<T>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
  resolveDeps: typeof resolveResourceDeps,
): unknown {
  let owned: ResourceInstance | undefined;
  const gen = rec.gen;
  const superseded = (): boolean => rec.gen !== gen;
  const canPublish = (): boolean => !superseded() && !owner.closed;
  const obs = owner.obs;
  const span = openSpan(obs, caller, up, target.label, "resource");
  rec.busy = true;
  let settled = false;
  buildDepth++;
  try {
    const override = presetFor(owner, target) as Resource.Handle<T>["factory"] | undefined;
    const fn = override ?? target.factory;
    owned = startBuildInstance(owner, target, rec, fn.length >= 2);
    const deps = resolveDeps(
      owner,
      target,
      span,
      superseded,
      chain,
      rec,
      (depOwner, depTarget, depState) => {
        owned = holdSelectedDependency(owned, owner, target, rec, depOwner, depTarget, depState);
      },
    );
    const pending = parked;
    const ctx =
      fn.length >= 2
        ? buildCtx(owned as ResourceInstance, span, () => settled, chain)
        : emptyCtxFor(owner, chain);
    const result =
      pending === undefined ? fn(deps, ctx) : settleDeps(deps, pending).then(() => fn(deps, ctx));
    if (!isThenable(result)) {
      settled = true;
      publishSyncResource(rec, result, canPublish, owned, obs, span);
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
        settleResourceInstance(owned, status, error);
      },
      obs,
      span,
    );
  } catch (error) {
    settled = true;
    return failResourceBuild(owner, target, rec, gen, owned, error, obs, span);
  } finally {
    buildDepth--;
    rec.busy = false;
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
        rec.built = { value };
        rec.ready = build;
      }
      closeSpan(obs, span, "ok");
      return value;
    },
    (error: unknown) => {
      markSettled("failed", error);
      if (rec.build === build) rec.build = undefined;
      if (!superseded()) rec.failed = { error, ready: build };
      closeSpan(obs, span, "failed");
      throw error;
    },
  );
  if (!superseded()) rec.build = build;
  track(owner, build, (error) => {
    if (!superseded() && !isCancel(owner, error)) owner.failed ??= { cause: error };
  });
  return build;
}

function resourceController<T>(
  layer: Layer,
  target: Resource.Handle<T>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): Scope.ResourceController<T> {
  const owner = ownerOf(layer, target);
  /** An ns-blind controller holds the owner's node record directly. A named controller selects
   * on each read because an earlier key in a fallback chain may be built after controller creation. */
  const rec = nodeState(owner, target);
  const named = hasResourceNs(target, chain);
  return {
    resolve: () => {
      if (!named && rec.built) {
        ensureOpen(layer);
        ensureOpen(owner);
        recordUsed(layer.obs, up, target);
        return (rec.ready ?? rec.built.value) as Scope.ResourceValue<T>;
      }
      const value = resourceSlot(layer, target, up, chain);
      const state = named ? selectNsResource(owner, target, chain) : rec;
      return (state?.ready ?? value) as Scope.ResourceValue<T>;
    },
    get: () => {
      ensureOpen(layer);
      ensureOpen(owner);
      const state = named ? selectNsResource(owner, target, chain) : rec;
      if (state?.failed) return state.failed.ready as Scope.ResourceValue<T>;
      if (!state?.built) raise("NotResolved", { label: target.label });
      return (state.ready ?? state.built.value) as Scope.ResourceValue<T>;
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
      const state = layer === owner ? layer.nodes.get(target)?.named?.get(key) : undefined;
      return state && occupiedNsResource(state) ? state : undefined;
    },
    () => undefined,
  );
}

function occupiedNsResource(state: NsResourceState): boolean {
  return Boolean(state.built || state.build || state.failed || state.busy);
}

function ownNsResource(
  owner: Layer,
  target: Resource.Handle<unknown>,
  key: Namespace,
): NsResourceState {
  const rec = nodeState(owner, target);
  let state = rec.named?.get(key);
  if (state === undefined) {
    state = new NsResourceState(owner, target, key);
    (rec.named ??= new Map()).set(key, state);
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
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  selected?: SelectedResource,
): unknown {
  const owner = ownerOf(layer, target);
  const rec = nodeState(owner, target);
  ensureOpen(layer);
  ensureOpen(owner);
  recordUsed(layer.obs, up, target);
  if (hasResourceNs(target, chain))
    return namedResourceSlot(owner, layer, target, up, chain, selected);
  selected?.(owner, target, rec);
  if (rec.built) return rec.built.value;
  if (rec.failed) return rec.failed.ready;
  if (rec.build) return rec.build;
  const buildChain = target.target === "scope" ? NO_NAMESPACE : chain;
  return buildResource(owner, layer, target, up, buildChain, rec);
}

function namedResourceSlot(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<unknown>,
  up: SpanImpl | undefined,
  chain: readonly [Namespace, ...Namespace[]],
  selected?: SelectedResource,
): unknown {
  const [head] = chain;
  const state = selectNsResource(owner, target, chain) ?? ownNsResource(owner, target, head);
  selected?.(owner, target, state);
  return readResourceState(owner, caller, target, up, chain, state);
}

function readResourceState(
  owner: Layer,
  caller: Layer,
  target: Resource.Handle<unknown>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  state: ResourceState,
): unknown {
  if (state.built) return state.built.value;
  if (state.failed) return state.failed.ready;
  if (state.build) return state.build;
  if (state.busy) raise("CircularResource", { label: target.label });
  return buildResource(owner, caller, target, up, chain, state, resolveNamedResourceDeps);
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
  (s.users ??= new Set()).add(dependent);
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
  (selected.users ??= new Set()).add(dependent);
  (dependent.needs ??= new Set()).add(selected);
  (dependent.layer.links ??= new Set()).add(dependent);
}

function linkNsDataDependent(selected: NsDataDependency, dependent: NsResourceState): void {
  const users = selected.source.readers?.get(selected.entry) ?? new Set<NsResourceState>();
  if (users.has(dependent)) return;
  users.add(dependent);
  (selected.source.readers ??= new Map()).set(selected.entry, users);
  (dependent.reads ??= new Set()).add(selected);
  (dependent.layer.links ??= new Set()).add(dependent);
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
      const entry = source?.cells?.get(key);
      return source && entry ? { source, entry } : undefined;
    },
    (layer) => (layer.nodes.get(target)?.cell ? DEFAULT_DATA_ENTRY : undefined),
  );
  return selected === DEFAULT_DATA_ENTRY ? undefined : selected;
}

const DEFAULT_DATA_ENTRY = Symbol();

function detachNsDependencies(state: NsResourceState): void {
  state.layer.links?.delete(state);
  for (const link of state.reads ?? []) link.source.readers?.get(link.entry)?.delete(state);
  state.reads = undefined;
  detachNsResourceLinks(state);
}

function detachNsLinked(layer: Layer, linked: Set<NsResourceState>): void {
  for (const state of linked) detachNsDependencies(state);
  layer.links = undefined;
}

function detachNsResourceLinks(state: NsResourceState): void {
  for (const dependency of state.needs ?? []) dependency.users?.delete(state);
  for (const dependent of state.users ?? []) dependent.needs?.delete(state);
  state.needs = undefined;
  state.users = undefined;
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
    const set = s.users;
    if (set && set.delete(dependent) && set.size === 0) s.users = undefined;
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

function addBorrow(owned: ResourceInstance, held: HeldBorrows): void {
  if (held.list.includes(owned)) return;
  held.list.push(owned);
  (owned.pending ??= new Set()).add(held.done);
}

function takeBorrows(target: Operation.Handle<unknown, unknown>): HeldBorrows | undefined {
  if ((target as BorrowFlag)[borrowSym] !== true) return undefined;
  return createBorrows();
}

function removeBorrow(owned: ResourceInstance, work: Promise<unknown>): void {
  owned.pending?.delete(work);
  finishTracked(owned);
}

/** Seed a layer's tag list from the authored bindings: nothing (or only nothing, however
 * nested) leaves the list unallocated; otherwise every binding lands in authored order. */
function seedTags(input: Tag.Bindings): LayerTags | undefined {
  if (isNothing(input)) return undefined;
  if (isNotList(input)) return [input];
  const bindings = readBindings(input);
  if (bindings.length === 0) return undefined;
  return bindings;
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
  up: Layer | undefined,
  options: Scope.Options | undefined,
): readonly Namespace[] | undefined {
  if (options?.ns === NO_NAMESPACE) return NO_NAMESPACE;
  if (options?.ns !== undefined) return nsChainOf(options.ns);
  return up?.ns;
}

/** Handles create these children from full layers; tagged frames use their own constructor.
 * Inherit the services, bindings, and any close already under way above the child. */
function makeLayer(up: Layer, options?: Scope.Options): Layer {
  const layer = layerRecord(up, options, up.obs, up.clock, up.random, up.exts);
  if (up.children === NO_CHILDREN) up.children = new Set();
  up.children.add(layer);
  /** Born into a subtree already being collected by an active ancestor close: inherit `swept` so this
   * late child's real failure + teardown errors still push up to the collecting ancestor when it
   * finishes; inherit the abort if the ancestor close is FORCED (creation under a CLOSED scope is
   * blocked by `ensureOpen`, so a swept-but-open parent means an ancestor is mid-close). */
  if (up.swept) layer.swept = true;
  if (up.aborted) {
    layer.aborted = true;
    layer.reason = up.reason;
  }
  return layer;
}

/** The one literal every layer starts from, so every layer shares one shape. The tag and preset
 * seeds are called only when the options carry them: a helper that never runs here stays out of
 * V8's inlining budget for the session start. */
function layerRecord(
  up: Layer | undefined,
  options: Scope.Options | undefined,
  obs: Obs,
  clock: Clock.Handle,
  random: Random.Handle,
  exts: ExtRoutes,
): Layer {
  const tags = options?.tags === undefined ? undefined : seedTags(options.tags);
  const seeded = options?.presets === undefined ? NO_PRESETS : seedPresets(options.presets);
  return {
    up,
    children: NO_CHILDREN,
    nodes: seeded.nodes,
    presets: seeded.presets,
    tags,
    pending: NO_CHILDREN,
    hooks: NO_DEFERS,
    holds: 0,
    aborted: false,
    reason: undefined,
    abort: undefined,
    cancelled: false,
    swept: false,
    bodyEnd: undefined,
    failed: undefined,
    childError: undefined,
    caller: undefined,
    errors: NO_DEFERS,
    body: undefined,
    closed: false,
    closing: undefined,
    obs,
    trace: obs.on ? traceFor(up, options?.trace) : undefined,
    clock,
    random,
    ctx: undefined,
    ns: nsFor(up, options),
    exts,
  };
}

/** Copy the driver's seed once; descendants share the owned copy. */
function traceFor(
  up: Layer | undefined,
  trace: Observe.Trace | null | undefined,
): Observe.Trace | undefined {
  if (trace === null) return undefined;
  return trace === undefined ? up?.trace : { ...trace };
}

/** Mark a layer's whole subtree `swept`, iteratively (no recursion — deep trees are safe). Run
 * SYNCHRONOUSLY at close-call time so a descendant that finishes and detaches before this close's async
 * body runs is still marked — then `finishLayer` pushes its real failure + teardown errors up to its
 * parent, and a collecting ancestor sees them at any depth. Root close hooks also mark their
 * root, so sessions born before structural close inherit the collection. An independent session's
 * own close does not mark itself, so its failure does not propagate. */
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
  if (layer.closing) layer.closed = true;
  layer.reason = reason;
  /** Only fire the real signal if one was ever handed to a factory (else there are no listeners). */
  layer.abort?.abort(reason);
}

function abortSubtree(root: Layer, reason = root.reason ?? new CancelReason()): void {
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
 * next, passing the settled `end`; teardown failures collect in `layer.errors` in execution order
 * (→ `TeardownFailed`). The teardown guard spans the synchronous call so a callback that synchronously
 * re-enters `close()` is acked (Q3 no-hang). */
async function finishCloseInstance(entry: DeferEntry): Promise<void> {
  const owned = entry.owned as ResourceInstance;
  if (isHeld(owned)) {
    finishTracked(owned);
    return;
  }
  const finished = finishHook(owned, entry.fn);
  if (finished) await finished;
}

async function drainCloseEntry(layer: Layer, entry: DeferEntry, end: Scope.End): Promise<void> {
  if (entry.owned) return finishCloseInstance(entry);
  let pending: void | PromiseLike<void>;
  tearing.push(layer);
  try {
    pending = entry.fn(end);
  } catch (cause) {
    addError(layer, cause);
    return;
  } finally {
    tearing.pop();
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
 * op rejected, or a descendant really failed (bubbled into `layer.failed`/`childError`) — then
 * an interrupted body settles `cancelled`, else `success`. No wished outcome participates. Records the
 * winning real failure in `layer.failed` so it propagates to a collecting ancestor. A body that
 * rejects (whether it threw or surfaced a descendant failure it awaited) is a real body failure; we do
 * NOT distinguish an "own" throw from a "propagated" one (unknowable by value — rounds 7–9). */
function settleOutcome(layer: Layer, body: Scope.Outcome | undefined): Scope.Outcome {
  if (body?.status === "failed") {
    /** A body failure is the PRIMARY cause and outranks a caught/recorded owned-work failure, so it
     * OVERRIDES `layer.failed` (which `asPrimary` may already have set from the op) — otherwise a
     * collecting ancestor would push up the owned-work error while this layer reports the body error. */
    layer.failed = { cause: body.error };
    return body;
  }
  const owned = failureOf(layer) ?? layer.childError;
  if (owned) {
    layer.failed = owned;
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
  return layer.bodyEnd === undefined && isIdle(layer);
}

/** The idle test {@link canFastClose} and {@link canEndIdle} share: no build in progress, no
 * child, no owned work or hold, no defer, no teardown error, no recorded failure, and no
 * re-entrant teardown. */
function isIdle(layer: Layer): boolean {
  return (
    buildDepth === 0 &&
    layer.children.size === 0 &&
    layer.pending.size + layer.holds === 0 &&
    layer.hooks.length + layer.errors.length === 0 &&
    failureOf(layer) === undefined &&
    layer.childError === undefined &&
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
    markAborted(layer, layer.reason ?? new CancelReason());
    layer.cancelled = true;
    settled = { status: "cancelled" };
  }
  detachLayer(layer);
  const ended = buildResult(settled, layer, undefined);
  layer.closing = Promise.resolve(
    hooks || withData ? keepData(layer, ended, hooks, withData) : ended,
  );
  beginClosing(layer);
  return layer.closing;
}

/** Whether a session whose body just ended clean can end in place — {@link canFastClose}'s idle
 * test for a session's own close, where the finished body no longer blocks it: no close already
 * in flight, no ancestor's close in flight (it marked this layer swept at call time and its
 * abort is queued; the body's end must be read against that abort, ADR 0026 Q5 — an aborted
 * live layer is always swept too), no signal handed out (a forced close would dispatch abort on
 * it), {@link isIdle} (no build in progress, no child, no in-flight owned work, no defer, no
 * teardown error, no recorded failure, no re-entrant teardown), and {@link ownsNothing}. "No build
 * in progress" (`buildDepth`) means a tagged subflow called while another run's body has not yet
 * returned — before that body's first `await` — always comes back as a promise; the same call
 * after an `await` can come back as a value (ADR 0072's wait list). */
function canEndIdle(layer: Layer): boolean {
  return (
    layer.closing === undefined &&
    !layer.swept &&
    layer.abort === undefined &&
    isIdle(layer) &&
    ownsNothing(layer)
  );
}

/** The rest of a session's idle test, after {@link isIdle}: no record on the layer that is
 * {@link busyRecord}: a built resource instance (its release protocol must run) or a watcher (a
 * write between the body's return and the close must still reach it). */
function ownsNothing(layer: Layer): boolean {
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
  const hooks = layer.exts.session && SESSION_HOOKS.get(layer);
  if (!layer.closing) {
    if (canFastClose(layer))
      return tapSessionHooks(hooks, fastClose(layer, force, hooks, withData));
    /** Graceful drain retains state; call entry checks `closing` instead. */
    layer.closed = force || layer.aborted;
    layer.closing = startClose(layer, force, hooks, withData);
    layer.closeAbort?.abort(CLOSING_REASON);
  }
  /** A `close()` re-entered from within this layer's (or an ancestor's) own teardown is a request-only
   * acknowledgement: return an already-resolved best-effort `Result` so it never waits on itself (no
   * hang, no throw — ADR 0026 Q3, 0027/0028). The real settled `Result` is `layer.closing`.
   * A session that ended in place holds the shared marker; a late `close()` on its handle gets a
   * clean `Result` of its own the same way (it recorded no failure and was not cancelled). */
  if (layer.closing === ENDED_CLEAN || closeWouldReenter(layer))
    return Promise.resolve(buildResult(bestEffort(layer), layer, undefined));
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
    return { status: "cancelled", reason: layer.reason, teardownErrors };
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
    forced || body?.status === "failed" || (failureOf(layer) ?? layer.childError) !== undefined;
  /** A session settles cancelled iff its body was interrupted; a bodyless scope iff teardown rolls
   * back. A body that succeeded is never cancelled by its forced self-close. */
  if (body ? body.status === "cancelled" : rollback) layer.cancelled = true;
  return rollback;
}

function collectLayerInstances(layer: Layer): ResourceInstance[] {
  const built: ResourceInstance[] = [];
  for (const state of layer.nodes.values()) {
    if (state.owned) built.push(state.owned);
    if (state.named)
      for (const bucket of state.named.values()) {
        if (bucket.owned) built.push(bucket.owned);
      }
  }
  return built;
}

async function closeInstances(
  layer: Layer,
  settled: Scope.Outcome,
  built: ResourceInstance[],
): Promise<void> {
  for (const owned of built) unlinkInstance(owned, settled);
  await drainDefers(layer, [...layer.hooks], settled);
  for (const owned of built) {
    const finished = finishInstance(owned);
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
  /** Sync first: with no body to read, no child, and no owned work, nothing below waits unless a
   * defer returns a promise, so the whole teardown runs in this one job and the close settles on
   * the next tick (perf probe; the async `run` keeps every other case). */
  const first = (): Scope.Result | Promise<Scope.Result> => {
    if (forced) abortSubtree(layer);
    if (layer.bodyEnd !== undefined || layer.children.size !== 0 || layer.pending.size !== 0)
      return run();
    prepareTeardown(layer, forced, undefined);
    layer.closed = true;
    const settled = settleOutcome(layer, undefined);
    const built = collectLayerInstances(layer);
    const wait = built.length
      ? closeInstancesSync(layer, settled, built)
      : drainDefersSync(layer, layer.hooks, settled);
    return wait ? wait.then(tail) : tail();
  };
  const tail = (): Scope.Result | Promise<Scope.Result> => {
    const finalSettled = settleOutcome(layer, undefined);
    const keeps = hooks !== undefined || withData;
    const teardownErrors = finishLayer(layer, keeps);
    const ended = buildResult(finalSettled, layer, teardownErrors);
    return keeps ? keepData(layer, ended, hooks, withData) : ended;
  };
  const run = async (): Promise<Scope.Result> => {
    /** Read the end recorded when the body settled, before its own close abort (Q5).
     * A bodyless layer gets its outcome from the close request. */
    const body = await layer.bodyEnd;
    const rollback = prepareTeardown(layer, forced, body);
    /** An empty child list still yields here, keeping the close phase order. */
    await (layer.children.size === 0 ? READY : closeEach(layer, rollback));
    while (layer.pending.size) await Promise.all(layer.pending);
    layer.closed = true;
    const settled = settleOutcome(layer, body);
    const built = collectLayerInstances(layer);
    if (built.length) await closeInstances(layer, settled, built);
    else await drainDefers(layer, layer.hooks, settled);
    /** Re-settle once more: a late real failure (pushed up from a child whose cleanup was parked on a
     * gate) can land WHILE we await the defers; `settleOutcome` never downgrades a recorded failure, so
     * the result stays monotonic and a collecting ancestor still sees it. */
    const finalSettled = settleOutcome(layer, body);
    const keeps = hooks !== undefined || withData;
    const teardownErrors = finishLayer(layer, keeps);
    const ended = buildResult(finalSettled, layer, teardownErrors);
    return keeps ? keepData(layer, ended, hooks, withData) : ended;
  };
  return READY.then(first);
}

/** {@link closeInstances} without a yield when no step waits; a promise only when one does. */
function closeInstancesSync(
  layer: Layer,
  settled: Scope.Outcome,
  built: ResourceInstance[],
): Promise<void> | undefined {
  for (const owned of built) unlinkInstance(owned, settled);
  const wait = drainDefersSync(layer, [...layer.hooks], settled);
  return wait ? wait.then(() => finishBuilt(layer, built)) : finishBuilt(layer, built);
}

function finishBuilt(layer: Layer, built: ResourceInstance[]): Promise<void> | undefined {
  for (const owned of built) {
    const finished = finishInstance(owned);
    if (finished) ignoreRejection(finished);
  }
  return layer.pending.size ? joinPending(layer) : undefined;
}

async function joinPending(layer: Layer): Promise<void> {
  while (layer.pending.size) await Promise.all(layer.pending);
}

/** {@link drainEntries} in this job until an entry returns a promise; the rest waits on it. */
function drainDefersSync(
  layer: Layer,
  entries: DeferEntry[],
  end: Scope.End,
): Promise<void> | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const pending = drainEntrySync(layer, entries[i], end);
    if (pending) return drainRest(layer, entries, i, pending, end);
  }
  return undefined;
}

async function drainRest(
  layer: Layer,
  entries: DeferEntry[],
  i: number,
  pending: Promise<void>,
  end: Scope.End,
): Promise<void> {
  await pending;
  for (let j = i - 1; j >= 0; j--) await drainCloseEntry(layer, entries[j], end);
}

/** One {@link drainCloseEntry} step: `undefined` when it finished in this job. */
function drainEntrySync(
  layer: Layer,
  entry: DeferEntry,
  end: Scope.End,
): Promise<void> | undefined {
  if (entry.owned) {
    const owned = entry.owned as ResourceInstance;
    if (isHeld(owned)) {
      finishTracked(owned);
      return undefined;
    }
    return finishHook(owned, entry.fn);
  }
  let pending: void | PromiseLike<void>;
  tearing.push(layer);
  try {
    pending = entry.fn(end);
  } catch (cause) {
    addError(layer, cause);
    return undefined;
  } finally {
    tearing.pop();
  }
  if (!isThenable(pending)) return undefined;
  return Promise.resolve(pending).then(undefined, (cause: unknown) => addError(layer, cause));
}

/** Detach the layer and clear all its state after teardown; returns the collected teardown errors
 * (in execution order) for `TeardownFailed`, or undefined if there were none. A layer swept by an
 * ancestor's close pushes its teardown errors + failure up to its parent as it detaches, so a
 * collecting ancestor gathers descendant results at any depth even when a descendant finished and
 * detached before the intervening scopes began their own close (F1 / grandchild). A layer that
 * `keeps` its data (ADR 0069) leaves its store, presets, and tags to {@link keepData}. */
function finishLayer(layer: Layer, keeps: boolean): unknown[] | undefined {
  const teardownErrors = layer.errors.length ? [...layer.errors] : undefined;
  const up = detachLayer(layer);
  if (up && layer.swept) propagateSweptOutcome(layer, up);
  layer.pending.clear();
  layer.children.clear();
  layer.hooks.length = 0;
  layer.errors.length = 0;
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
  if (teardownCauses)
    raise("TeardownFailed", { causes: hasFailure ? [cause, ...teardownCauses] : teardownCauses });
  if (hasFailure) throw cause;
}

/** Run `body` in a child session of `parent`, then close it (ADR 0038): the body receives the
 * child layer directly (no handle→layer registry). The public `session()` passes
 * `(child, handle) => fn(handle ?? handleFor(child))`; a tagged call under `session` hooks passes
 * its own runner (without hooks it runs the same life itself, see {@link runTagged}). When the
 * root installed `session` hooks (ADR 0051), the whole life runs inside their onion: `next()`
 * resolves with the close `Result`. No hooks means no wrapper — the life below, inline, after one
 * field read of the parent's route; it ends in {@link endSession}. */
function runSessionWith<R>(
  up: Layer,
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
    const session = up.exts.session;
    ensureRunning(up, caller);
    child = makeLayer(up, options);
    child.caller = caller;
    if (signal) {
      /** Seal writes now, then let the session join its body and cleanup before it detaches. */
      const abort = (): void => {
        child.closed = true;
        abortSubtree(child, signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      addDefer(child, {
        fn: () => signal.removeEventListener("abort", abort),
        owned: undefined,
      });
      if (signal.aborted) abort();
    }
    if (session !== undefined) {
      return runSessionWrapped(child, body, session);
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
  layer.closeAbort?.abort(CLOSING_REASON);
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
      child.body = undefined;
      result = value;
      return child.aborted ? { status: "cancelled" } : SUCCESS;
    },
    (cause: unknown): Scope.Outcome => {
      child.body = undefined;
      return isCancel(child, cause) ? { status: "cancelled" } : { status: "failed", error: cause };
    },
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
  up: Layer,
  options: Scope.Options | undefined,
  fn: (scope: Scope.Handle) => R | PromiseLike<R>,
): Promise<R> {
  return Promise.resolve(
    runSessionWith(up, options, (child, handle) => fn(handle ?? handleFor(child))),
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
    if (child.closed && child.aborted) throw child.reason;
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
  up?: SpanImpl,
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
  const dispatch = operationController(layer, handle, up, chain, receiver, inline).run as (
    call?: Scope.Invocation<I>,
  ) => R | Promise<Awaited<R>>;
  return dispatch(call);
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
    ensureRunning(layer);
    if (!isOperation(op)) return runInline(layer, op as Scope.Inline<Scope.Depends, T, I>, call);
    return (controllerOf(op) as { run(call?: Scope.Invocation<I>): T }).run(call);
  }) as Scope.Handle["run"];
  /** `settle` runs through a twin controller whose caller is RECOVERED; `run` stays as it was. */
  const settle = ((op: unknown, call?: Scope.Invocation<unknown>) => {
    const signal = call?.signal;
    try {
      ensureRunning(layer);
      return settledValue(
        layer,
        isOperation(op)
          ? OperationControl.recover(controllerOf(op) as OperationControl<unknown, unknown>).run(
              call,
            )
          : runInline(layer, op as Scope.Inline<Scope.Depends, unknown, unknown>, call, RECOVERED),
        signal,
      );
    } catch (error) {
      return failedRun(layer, error, signal);
    }
  }) as Scope.Handle["settle"];
  return {
    controller,
    resolve,
    run,
    settle,
    createSession: (options?: Scope.Options) => {
      ensureAccepting(layer);
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
      addDefer(layer, { fn: () => fn(), owned: undefined });
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
type Affected = { node: Node; layer: Layer };

function invalidateResource(owner: Layer, target: Resource.Handle<unknown>): void {
  const s = nodeState(owner, target);
  if (s.owned) {
    unlinkInstance(s.owned, RELEASED);
    s.owned = undefined;
  }
  s.gen += 1;
  clearBuild(s);
  if (s.named) {
    for (const state of s.named.values()) {
      if (state.owned) unlinkInstance(state.owned, RELEASED);
      state.gen += 1;
      clearBuild(state);
      detachNsDependencies(state);
    }
    s.named = undefined;
  }
  detachDependent(owner, target);
  s.users = undefined;
}

/** Release and retained close data drop the same build references. */
function clearBuild(state: ResourceState): void {
  state.built = state.ready = state.failed = state.build = undefined;
}

/** Drop a cell's shadow (revert to inherited/initial) and edges without notifying watchers. */
function invalidateData(owner: Layer, target: Data.Cell<unknown>): void {
  const s = owner.nodes.get(target);
  if (s?.cell) {
    s.cell = undefined;
    invalidateEff(owner, target);
  }
  if (s) {
    s.cells = undefined;
    s.users = undefined;
    s.readers = undefined;
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
  if (rec?.users) for (const target of rec.users) visit(target, owner);
}

/** Walk dependents from a node (iterative; keyed on node+owner so diamonds collapse while the same
 * handle in two sessions stays distinct) → every affected (node, owner), in release order. */
function collectAffected(target: Node, targetOwner: Layer): Affected[] {
  const seen = new Map<Node, Set<Layer>>();
  const order: Affected[] = [];
  const stack: Affected[] = [{ node: target, layer: targetOwner }];
  while (stack.length) {
    const item = stack.pop() as Affected;
    let owners = seen.get(item.node);
    if (!owners) {
      owners = new Set();
      seen.set(item.node, owners);
    }
    if (owners.has(item.layer)) continue;
    owners.add(item.layer);
    order.push(item);
    forEachDependent(item.layer, item.node, (t, owner) => stack.push({ node: t, layer: owner }));
  }
  return order;
}

/** A released owner's affected resources and their OLD defers, extracted up front. */
type Released = {
  built: Set<ResourceInstance>;
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
  ensureAccepting(layer);
  const targetOwner = isResource(target) ? ownerOf(layer, target) : layer;
  ensureAccepting(targetOwner);
  const affected = new Map<Layer, Released>();
  const order = collectAffected(target, targetOwner);
  if (isData(target)) {
    const rec = targetOwner.nodes.get(target);
    if (rec?.cells) {
      const seeds: NsResourceState[] = [];
      for (const entry of rec.cells.values()) seeds.push(...namedDataSeeds(rec, entry));
      collectNamedRelease(seeds, affected);
    }
  }
  const dataReleased = invalidateAffected(order, affected);
  drainRelease(affected, () => {
    if (dataReleased && isData(target)) flushCell(layer, target);
  });
}

function releaseNamed(layer: Layer, target: Node, ns: Namespace): void {
  ensureAccepting(layer);
  const owner = isResource(target) ? ownerOf(layer, target) : layer;
  ensureAccepting(owner);
  if (isData(target)) releaseNamedData(owner, target, ns);
  else if (target.target !== "scope") releaseNamedResource(owner, target, ns);
}

function releaseNamedData(owner: Layer, target: Data.Cell<unknown>, ns: Namespace): void {
  const rec = owner.nodes.get(target);
  if (!rec?.cells) return;
  const entry = rec.cells.get(ns);
  if (!entry) return;
  const affected = collectNamedRelease(namedDataSeeds(rec, entry), new Map());
  rec.cells.delete(ns);
  rec.readers?.delete(entry);
  drainRelease(affected, () => flushInheritedNsWatchers(owner, target, ns));
}

function namedDataSeeds(rec: NodeState, entry: Entry): NsResourceState[] {
  return [...(rec.readers?.get(entry) ?? [])];
}

function releaseNamedResource(owner: Layer, target: Resource.Handle<unknown>, ns: Namespace): void {
  const state = owner.nodes.get(target)?.named?.get(ns);
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
    if (!isLiveNamedRelease(state)) continue;
    for (const dependent of state.users ?? []) pending.push(dependent);
    const released = affected.get(state.layer) ?? {
      built: new Set<ResourceInstance>(),
      hooks: [],
    };
    if (state.owned) released.built.add(state.owned);
    affected.set(state.layer, released);
    unlinkNamedState(state);
  }
  return affected;
}

function isLiveNamedRelease(state: NsResourceState): boolean {
  return (
    !state.layer.closed &&
    !state.layer.closing &&
    state.layer.nodes.get(state.target)?.named?.get(state.key) === state
  );
}

function unlinkNamedState(state: NsResourceState): void {
  const owned = state.owned;
  state.layer.nodes.get(state.target)?.named?.delete(state.key);
  detachNsDependencies(state);
  state.gen++;
  clearBuild(state);
  if (owned) unlinkInstance(owned, RELEASED);
}

function isHeld(owned: ResourceInstance): boolean {
  return owned.users > 0 || owned.busy || !!owned.pending?.size;
}

function drainReleasedOwner(
  entry: Released,
  previous: Promise<void> | undefined,
): Promise<void> | undefined {
  let prev = previous;
  const borrowed = [...entry.built].flatMap((owned) => [...(owned.pending ?? [])]);
  const gate = borrowed.length ? Promise.allSettled(borrowed).then(() => undefined) : undefined;
  for (const hook of entry.hooks) {
    const owned = hook.owned as ResourceInstance;
    if (isHeld(owned)) continue;
    prev = finishHook(owned, hook.fn, gate ?? prev) ?? prev;
  }
  return drainHookless(entry.built, gate ?? prev);
}

function drainHookless(
  built: Set<ResourceInstance>,
  previous: Promise<void> | undefined,
): Promise<void> | undefined {
  let prev = previous;
  for (const owned of built) {
    if (owned.hooks.length || isHeld(owned)) continue;
    prev = finishInstance(owned, prev) ?? prev;
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
  for (let cur = layer.up; cur; cur = cur.up) depth++;
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
  const entry = affected.get(owner) ?? { built: new Set(), hooks: [] };
  if (state.owned) entry.built.add(state.owned);
  if (state.named)
    for (const bucket of state.named.values()) {
      if (bucket.owned) entry.built.add(bucket.owned);
    }
  affected.set(owner, entry);
  invalidateResource(owner, target);
}

function orderReleased(owner: Layer, entry: Released): void {
  for (const hook of owner.hooks.toReversed()) {
    if (hook.owned && entry.built.has(hook.owned)) entry.hooks.push(hook);
  }
  owner.hooks = owner.hooks.filter((hook) => !hook.owned || !entry.built.has(hook.owned));
}

function invalidateAffected(order: Affected[], affected: Map<Layer, Released>): boolean {
  let dataReleased = false;
  for (const { node, layer: owner } of order) {
    if (owner.closed || owner.closing) continue;
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
  if (hooks?.state === 0) {
    hooks.state = 1;
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
  if (hooks.state === 1) freeData(layer, hooks.moved);
  hooks.state = 2;
}

/** Strip a node moved into a `Result` down to its `cell` and `cells`, all `data.get` reads.
 * Everything else would pin the closed layer after close: the torn-down resource `owned` (its
 * `layer` and defer closures), `named` and `readers` (owner layers), the
 * memoized `controller` closure over the layer, `watch` and `nsWatch` (user closures),
 * `users`, the build state (`built`, `ready`, `failed`, `build`), and the cached `eff`
 * and `prev` values (possibly a parent's). A default close's `nodes.clear()` drops it all. */
function keepCellsOnly(s: NodeState): void {
  clearBuild(s);
  s.eff =
    s.owned =
    s.users =
    s.controller =
    s.watch =
    s.prev =
    s.named =
    s.readers =
    s.nsWatch =
      undefined;
}

/** A read on a closed scope (ADR 0069): while a session's data waits for its `session` hooks, a
 * data cell or a tag reads as it did before the close. Anything else throws `Disposed`. */
function resolveHeld(layer: Layer, target: unknown, ns: Scope.NsArg | undefined): unknown {
  if (SESSION_HOOKS.get(layer)?.state !== 1 || isResource(target) || isExtension(target))
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
    const bucket = rec.cells?.get(key);
    if (bucket !== undefined) return bucket;
  }
  return rec.cell;
}

export { isError };
export type { Errors } from "./errors";

/** A record that keeps a session's close on the full path: a built resource instance, default or
 * named, or a watcher, default or named. */
function busyRecord(state: NodeState): boolean {
  return (
    state.owned !== undefined ||
    state.named !== undefined ||
    state.watch !== undefined ||
    state.nsWatch !== undefined
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
  for (let cur = layer.up; cur; cur = cur.up) {
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

/** Every value bound to `target` in a layer's own tags, top first. */
function appendLayerTags(out: unknown[], cur: Layer, target: Tag.Handle<unknown>): void {
  if (cur.tags !== undefined) appendBindings(out, cur.tags, target);
}

/** Every value bound to `target` in `bindings`, last first. */
function appendBindings(
  out: unknown[],
  tags: readonly Tag.Binding<unknown>[],
  target: Tag.Handle<unknown>,
): void {
  for (let i = tags.length - 1; i >= 0; i--) if (tags[i].tag === target) out.push(tags[i].value);
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
  session: readonly Scope.Extension<unknown>[],
  handle: Scope.Handle,
  owner: Layer,
  run: () => Promise<{ result: unknown; ended: Scope.Result }>,
): Promise<{ result: unknown; ended: Scope.Result }> {
  let life: Promise<{ result: unknown; ended: Scope.Result }> | undefined;
  const ensure = (): Promise<{ result: unknown; ended: Scope.Result }> => (life ??= run());
  const at = (index: number): Promise<{ result: unknown; ended: Scope.Result }> => {
    if (index >= session.length) return ensure();
    const ext = session[index];
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
    return settledValue(layer, run(), signal);
  } catch (error) {
    return failedRun(layer, error, signal);
  }
}

/** `settleRun` once the run returned: a value is `success`; a promise settles to one. */
function settledValue(
  layer: Layer,
  result: unknown,
  signal?: AbortSignal,
): RunResult<unknown> | Promise<RunResult<unknown>> {
  if (!isThenable(result)) return { status: "success", value: result };
  return Promise.resolve(result).then(
    (value): RunResult<unknown> => ({ status: "success", value }),
    (error: unknown) => failedRun(layer, error, signal),
  );
}

/** `settle` received `error`: each stuck panic on its cause chain is recovered (Go's `recover`). */
function recover(layer: Layer, error: unknown): void {
  const panics = layer.panics;
  if (panics === undefined) return;
  const chain = causesOf(error);
  const left = panics.filter((panic) => !chain.includes(panic));
  layer.panics = left.length === 0 ? undefined : left;
}

/** Compose ancestor controllers without recursion. Unread layers keep no signal state. */
function closingOf(layer: Layer): AbortSignal {
  materialize(layer);
  if (layer.stop) return layer.stop;
  const signals: AbortSignal[] = [];
  for (let owner: Layer | undefined = layer; owner !== undefined; owner = owner.up) {
    signals.push((owner.closeAbort ??= new AbortController()).signal);
  }
  if (layer.closed || layer.closing || layer.swept) layer.closeAbort!.abort(CLOSING_REASON);
  return (layer.stop = AbortSignal.any(signals));
}

/** Both close paths detach before publishing their outcome to a collecting parent. */
function detachLayer(layer: Layer): Layer | undefined {
  if (layer.links) detachNsLinked(layer, layer.links);
  const up = layer.up;
  up?.children.delete(layer);
  return up;
}

function beginClosing(layer: Layer): void {
  layer.closeAbort?.abort(CLOSING_REASON);
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
      layer.failed ??= { cause: error };
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
  declare private layer: Layer;
  declare private flight: HookRun | undefined;
  declare private resolver: Scope.Handle["resolve"] | undefined;
  declare private control: Scope.Handle["controller"] | undefined;
  declare private runner: Scope.Handle["run"] | undefined;
  declare private settles: Scope.Handle["settle"] | undefined;
  declare private clean: Resource.Ctx["defer"] | undefined;
  declare private raiser: Resource.Ctx["raise"] | undefined;
  declare private logs: Observe.Logger | undefined;
  constructor(owner: Layer, label: string, chain = owner.ns, run?: HookRun) {
    this.layer = owner;
    this.label = label;
    this.ns = chain;
    this.flight = run;
  }
  get clock(): Clock.Handle {
    return this.layer.clock;
  }
  get random(): Random.Handle {
    return this.layer.random;
  }
  private get ctx(): OperationCtx<unknown> | undefined {
    return this.flight === undefined ? undefined : hookCtx(this.flight);
  }
  private use<T>(fn: () => T): T {
    return this.flight === undefined ? fn() : withHookAccess(this.flight, fn);
  }
  get resolve(): Scope.Handle["resolve"] {
    return (this.resolver ??= ((target: Scope.Dependency, ns?: Scope.NsArg): unknown =>
      this.use(() => {
        const chain = ns === undefined ? this.ns : nsChainOf(ns.ns);
        if (this.layer.closed && this.flight === undefined)
          return resolveHeld(this.layer, target, chain === undefined ? undefined : { ns: chain });
        if (isResource(target)) return this.resource(target, chain).resolve();
        return resolveNs(this.layer, target, chain);
      })) as Scope.Handle["resolve"]);
  }
  get controller(): Scope.Handle["controller"] {
    return (this.control ??= ((
      target: Data.Cell<unknown> | Resource.Handle<unknown> | Operation.Handle<unknown, unknown>,
      ns?: Scope.NsArg,
    ): unknown =>
      this.use(() => {
        ensureOpen(this.layer);
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
    const controller = dataController(this.layer, target, chain);
    if (this.flight === undefined) return controller;
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
    const controller = resourceController(this.layer, target, this.flight?.span, chain);
    const run = this.flight;
    if (run === undefined) return controller;
    const selected: SelectedResource = (owner, target, state) =>
      addBorrow(instanceOf(owner, target, state), (run.held ??= createBorrows()));
    const owner = ownerOf(this.layer, target);
    const state = (): ResourceState | undefined =>
      hasResourceNs(target, chain)
        ? selectNsResource(owner, target, chain)
        : owner.nodes.get(target);
    return {
      resolve: () =>
        this.use(() => {
          const value = resourceSlot(this.layer, target, this.flight?.span, chain, selected);
          return state()?.ready ?? value;
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
      this.layer,
      target,
      this.flight?.span,
      chain,
      this.ctx,
    ) as {
      run(call?: Scope.Invocation<unknown>): unknown;
      settle(call?: Scope.Invocation<unknown>): unknown;
    };
    if (this.flight === undefined) return controller;
    return {
      run: (call?: Scope.Invocation<unknown>) => this.use(() => controller.run(call)),
      settle: (call?: Scope.Invocation<unknown>) => {
        try {
          return this.use(() => controller.settle(call));
        } catch (error) {
          return failedRun(this.layer, error);
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
        return runInline(this.layer, op, call, caller, this.ns, this.flight?.span);
      const controller = operationController(
        this.layer,
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
    return (this.settles ??= ((
      op: Operation.Handle<unknown, unknown> | Scope.Inline<Scope.Depends, unknown, unknown>,
      call?: Scope.Invocation<unknown>,
    ): unknown =>
      settleRun(
        this.layer,
        () => this.invoke(op, call, RECOVERED),
        call?.signal,
      )) as Scope.Handle["settle"]);
  }
  get defer(): Resource.Ctx["defer"] {
    return (
      this.ctx?.defer ?? (this.clean ??= (fn) => addDefer(this.layer, { fn, owned: undefined }))
    );
  }
  get obs(): Observe.Ctx {
    return this.ctx?.obs ?? OFF_OBS;
  }
  get log(): Observe.Logger {
    const ctx = this.ctx;
    if (ctx) return ctx.log;
    const sink = this.layer.obs.log;
    return sink ? (this.logs ??= this.logFor(sink)) : noop;
  }
  /** Keep the sink wrapper's captured state off the run logger's path. */
  private logFor(sink: NonNullable<Obs["log"]>): Observe.Logger {
    const obs = this.layer.obs;
    const label = this.label;
    return logFor(
      {
        ...obs,
        log: (line) => sink({ ...line, attributes: { ...line.attributes, extension: label } }),
      },
      undefined,
    );
  }
  get raise(): Resource.Ctx["raise"] {
    return (this.raiser ??= (kind, payload) => raiseFrom(this.ctx ?? this, kind, payload));
  }
  get closing(): AbortSignal {
    return closingOf(this.layer);
  }
  get signal(): AbortSignal {
    return signalOf(this.layer);
  }
}

/** A handle whose `createSession` wraps every child in the root's `session` chain (ADR 0051): the
 * direct `resolve` stays plain; run and write hooks follow the inherited routes.
 * Only built when hooks exist; the unwrapped path never enters. */
function withSessionCreate(
  plain: Scope.Handle,
  layer: Layer,
  session: readonly Scope.Extension<unknown>[],
): Scope.Handle {
  return {
    ...plain,
    createSession: (options?: Scope.Options) => wrapSession(layer, options, session),
  };
}

/** A bare session wrapped in the `session` chain: the onion starts NOW (before-code runs right after
 * the child layer exists, before any work in it); `next()` settles with the structural close's
 * `Result` however the session closes — through this handle's `close`, or felled by its parent's
 * close cascade (`closeLayer` settles the registered resolver via the side table). `close()` joins
 * the teardown first, then reports the chain's outcome (hook returns win, hook throws propagate,
 * unlike root close hooks, whose returns cannot replace Core's outcome). */
function wrapSession(
  up: Layer,
  options: Scope.Options | undefined,
  session: readonly Scope.Extension<unknown>[],
): Scope.Handle {
  ensureAccepting(up);
  const child = makeLayer(up, options);
  const plain = handleFor(child);
  let settleNext: (ended: Scope.Result) => void = noop as (ended: Scope.Result) => void;
  const nextPromise = new Promise<Scope.Result>((resolveNext) => {
    settleNext = resolveNext;
  });
  const hooks: SessionHooks = { settle: settleNext, state: 0, moved: false };
  SESSION_HOOKS.set(child, hooks);
  const base = withSessionCreate(plain, child, session);
  const outcome = sessionThrough(session, base, child, () =>
    nextPromise.then((ended) => ({ result: undefined, ended })),
  ).finally(() => freeAfterHooks(child, hooks));
  ignoreRejection(outcome);
  return {
    ...base,
    close: (opts?: Scope.CloseOptions) =>
      closeLayer(child, !opts?.graceful, opts?.withData === true).then(() =>
        outcome.then(({ ended: chained }) => chained),
      ),
  };
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
  const session = layer.exts.session;
  let settleReady: () => void = noop;
  let failReady: (error: unknown) => void = noop;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    settleReady = resolveReady;
    failReady = rejectReady;
  });
  ignoreRejection(ready);
  const lifetime: RootLifetime = {};
  const extended: Scope.Handle & { closed?: Promise<Scope.Result> } = {
    ...(session === undefined ? plain : withSessionCreate(plain, layer, session)),
    ready,
  };
  if (signal)
    extended.closed = new Promise<Scope.Result>((resolveClosed) => {
      lifetime.finish = resolveClosed;
    });
  extended.close = watchRootClose(layer, extended, closers, lifetime);
  if (resolvers.length > 0) extended.resolve = resolveThrough(layer, resolvers);
  if (signal) listenForStop(extended, signal, lifetime);
  runStartChain(layer, extended, exts, lifetime, settleReady, failReady);
  return extended;
}

function readExtRoutes(exts: readonly Scope.Extension<unknown>[]): ExtRoutes {
  const runs = exts.filter((ext) => ext.hooks?.run !== undefined);
  const writes = exts.filter((ext) => ext.hooks?.write !== undefined);
  const session = exts.filter((ext) => ext.hooks?.session !== undefined);
  return {
    runs: runs.length > 0 ? runs : undefined,
    writes: writes.length > 0 ? writes : undefined,
    session: session.length > 0 ? session : undefined,
  };
}

/** Only the extension path owns this state. The first close includes the hooks' after-work;
 * a start failure joins it, and a stop request never starts another close (ADR 0085). */
type RootLifetime = {
  closing?: Promise<Scope.Result>;
  finish?: (ended: Scope.Result) => void;
  detach?: () => void;
};

/** Retain the first close before callbacks. Hooks keep onion order but cannot skip cleanup
 * or replace Core's Result; their throws become teardown errors (ADR 0085). */
function watchRootClose(
  layer: Layer,
  scope: Scope.Handle & { readonly closed?: Promise<Scope.Result> },
  closers: readonly Scope.Extension<unknown>[],
  lifetime: RootLifetime,
): Scope.Handle["close"] {
  return (options = {}) => {
    lifetime.detach?.();
    const close = (): Promise<Scope.Result> =>
      closeLayer(layer, !options.graceful, options.withData === true);
    if (closeWouldReenter(layer)) {
      const ended = close();
      lifetime.closing ??= layer.closing!.then((result) => {
        lifetime.finish?.(result);
        return result;
      });
      return ended;
    }
    if (lifetime.closing) return lifetime.closing;
    lifetime.closing =
      scope.closed ??
      new Promise<Scope.Result>((resolve) => {
        lifetime.finish = resolve;
      });
    layer.swept = true;
    markSwept(layer);
    beginClosing(layer);
    const at = (index: number): Promise<Scope.Result> => {
      if (index >= closers.length) return close();
      const closer = closers[index];
      let pending: Promise<Scope.Result> | undefined;
      const next = (): Promise<Scope.Result> => (pending ??= at(index + 1));
      return (async () => {
        try {
          await closer.hooks!.close!(
            hookEvent({ kind: "close", scope, options, next }, layer, closer.label),
          );
        } catch (error) {
          addError(layer, error);
        }
        return next();
      })();
    };
    ignoreRejection(
      at(0).then((ended) => {
        lifetime.finish!(
          layer.errors.length
            ? { ...ended, teardownErrors: [...(ended.teardownErrors ?? []), ...layer.errors] }
            : ended,
        );
        layer.errors.length = 0;
      }),
    );
    return lifetime.closing;
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
  lifetime.detach = () => {
    signal.removeEventListener("abort", stop);
    lifetime.detach = undefined;
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
    if (index >= resolvers.length) return resolveNs(layer, target, chain);
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
  up: SpanImpl | undefined,
  call: Scope.Invocation<I> | undefined,
  chain: readonly Namespace[] | undefined,
  nested: boolean,
  child: Layer,
): T {
  return runUntagged(child, target, up, call, chain, undefined, nested);
}

/** A session under a root that installed `session` hooks: the whole life inside their onion. Cold
 * path only — the hooks' handles are built eagerly here, never on the unwrapped path above. The
 * body receives the same handle the hooks do, so a session created under a session stays wrapped. */
async function runSessionWrapped<R>(
  child: Layer,
  body: (child: Layer, handle?: Scope.Handle) => R | PromiseLike<R>,
  session: readonly Scope.Extension<unknown>[],
): Promise<R> {
  const hooks: SessionHooks = { settle: undefined, state: 0, moved: false };
  SESSION_HOOKS.set(child, hooks);
  const handle = withSessionCreate(handleFor(child), child, session);
  let wrapped: { result: unknown; ended: Scope.Result };
  try {
    wrapped = await sessionThrough(session, handle, child, async () => {
      const started = Promise.resolve(runBodyWith(child, body, handle));
      child.body = started;
      child.bodyEnd = started.then(
        (): Scope.Outcome => {
          child.body = undefined;
          return child.aborted ? { status: "cancelled" } : SUCCESS;
        },
        (cause: unknown): Scope.Outcome => {
          child.body = undefined;
          return isCancel(child, cause)
            ? { status: "cancelled" }
            : { status: "failed", error: cause };
        },
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

/** Call `done` after a defer drain: now when it stayed synchronous, else after its tail. */
function thenDone(tail: Promise<void> | undefined, done: () => void): Promise<void> | undefined {
  if (!tail) {
    done();
    return undefined;
  }
  const after = tail.then(done, done);
  ignoreRejection(after);
  return after;
}

/** The walk behind {@link closeWouldReenter}, its own function so its loop stays out of the
 * close dispatch's inlined size when no teardown is active. */
function reentersTeardown(target: Layer): boolean {
  for (const live of tearing) {
    for (let cur: Layer | undefined = live; cur; cur = cur.up) {
      if (cur === target) return true;
    }
  }
  return false;
}

/** Collect a teardown error on a layer, giving it its own list on the first one. */
function addError(layer: Layer, cause: unknown): void {
  materialize(layer);
  if (layer.errors === NO_DEFERS) layer.errors = [];
  layer.errors.push(cause);
}

/** {@link drainDefers}'s work when there is any: each entry in reverse order, awaited in turn. */
async function drainEntries(layer: Layer, entries: DeferEntry[], end: Scope.End): Promise<void> {
  for (let i = entries.length - 1; i >= 0; i--) await drainCloseEntry(layer, entries[i], end);
}

/** Drive every currently-attached child to close (children first, awaited sequentially). The mode is
 * re-checked per child: once an EARLIER child's failure has been collected (pushed into this layer's
 * `childError` while we awaited it), the remaining children close FORCED so their resources roll
 * back too. Collection is NOT done here: each child's real failure + teardown errors flow up through
 * `finishLayer` (swept push), so a child that already finished and detached still reaches its ancestor.
 * Its caller reuses READY with no child, keeping the close phase order. */
async function closeEach(layer: Layer, force: boolean): Promise<void> {
  for (const child of Array.from(layer.children)) {
    await closeLayer(child, force || (failureOf(layer) ?? layer.childError) !== undefined, false);
  }
}

/** Empty defaults stay inherited after promotion. Collection gates give each owner its own
 * storage before adding entries; scalar writes create own fields. Copying all defaults at once
 * added a property array and an ObjectAssign call to every grown frame. */
const FRAME_STATE = {
  children: NO_CHILDREN,
  nodes: NO_NODES,
  presets: undefined,
  pending: NO_CHILDREN,
  hooks: NO_DEFERS,
  holds: 0,
  aborted: false,
  reason: undefined,
  abort: undefined,
  cancelled: false,
  swept: false,
  bodyEnd: undefined,
  failed: undefined,
  childError: undefined,
  errors: NO_DEFERS,
  body: undefined,
  closed: false,
  closing: undefined,
  ctx: undefined,
};

Object.assign(TaggedFrame.prototype, FRAME_STATE);

/** Promotion retains identity and binds ancestors first, before a watcher, build, or pending
 * body becomes visible. A new child inherits any close already in flight (ADR 0028). */
function expandFrame(frame: Layer, up: Layer): void {
  materialize(up);
  frame.lazy = false;
  if (up.children === NO_CHILDREN) up.children = new Set();
  up.children.add(frame);
  if (up.swept) frame.swept = true;
  if (up.aborted) {
    frame.aborted = true;
    frame.reason = up.reason;
  }
}

/** A close can enter through a captured handle while a body is still synchronous. Register
 * these frames before the existing sweep and abort code sees the tree. */
function materializeActiveFrames(): void {
  for (let frame = activeTagged; frame; frame = frame.stack) materialize(frame);
}

/** A best-effort outcome for a re-entrant close ack before the layer has settled: whatever real state
 * is already known (a recorded failure, then an interrupted body), else success. */
function bestEffort(layer: Layer): Scope.Outcome {
  const failed = failureOf(layer);
  if (failed) return { status: "failed", error: failed.cause };
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

function propagateSweptOutcome(layer: Layer, up: Layer): void {
  for (const cause of layer.errors) addError(up, cause);
  /** A descendant's settled failure goes to a SEPARATE slot ranked BELOW the parent's OWN failure
   * (body/owned-work): a real owned-work failure must still beat a failure a child merely inherited
   * from the close request (a wished `failed` echoed back down and up). First descendant wins. */
  if (layer.failed && layer.caller === undefined) up.childError ??= layer.failed;
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
  up: SpanImpl | undefined,
  inherited: readonly Namespace[] | undefined,
  caller: RunState | undefined,
  hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I>,
  call: Scope.Invocation<I> | undefined,
): unknown {
  ensureRunning(layer, caller);
  const chain = call?.ns === undefined ? inherited : nsChainOf(call.ns);
  if (!hasCallSession(call))
    return runHookChain(layer, target, up, chain, caller, hookTarget, call);
  const result = runSessionWith(
    layer,
    { tags: call.tags, ns: chain },
    (child) => runHookChain(child, target, up, chain, undefined, hookTarget, call),
    caller,
    call.signal,
  );
  if (caller) track(layer, result, runFailure(layer, caller));
  return result;
}

/** Access belongs to this active run only. Graceful close seals public handles at once but
 * still lets an existing hook continue its body; forced close refuses a late continuation. */
type HookRun = {
  layer: Layer;
  ctx?: OperationCtx<unknown>;
  span: SpanImpl | undefined;
  label: string;
  call: Scope.Invocation<unknown> | undefined;
  held: HeldBorrows | undefined;
  live: boolean;
  caller: RunState | undefined;
  work?: Promise<unknown>[];
  failed?: { error: unknown };
};

let activeHookOwner: Layer | undefined;

function withHookAccess<T>(run: HookRun, fn: () => T): T {
  if (!run.live) raise("Disposed", { reason: "run is finished" });
  if (run.layer.aborted) throw run.layer.reason;
  const previous = activeHookOwner;
  activeHookOwner = run.layer;
  buildDepth++;
  try {
    return fn();
  } finally {
    buildDepth--;
    activeHookOwner = previous;
  }
}

function hookCanRead(layer: Layer): boolean {
  for (let owner = activeHookOwner; owner; owner = owner.up) {
    if (owner === layer) return !layer.aborted;
  }
  return false;
}

function runHookChain<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  up: SpanImpl | undefined,
  chain: readonly Namespace[] | undefined,
  caller: RunState | undefined,
  hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I>,
  call: Scope.Invocation<I> | undefined,
): unknown {
  const span = openSpan(layer.obs, layer, up, target.label, "operation");
  const run: HookRun = {
    layer: layer,
    span,
    label: target.label,
    call,
    held: undefined,
    live: true,
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
  const ready = Promise.resolve(result);
  track(layer, ready, (error) => failHookRun(run, error), finish);
  return ready;
}

/** Hook tools can precede input parsing. Only `next()` admits the input; both contexts share
 * the same span and ordered cleanup list once a body starts. */
function hookCtx(run: HookRun): OperationCtx<unknown> {
  return (run.ctx ??= new OperationCtx(
    run.layer,
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
  return stepRunHook(run, target, hookTarget, call, chain, run.layer.exts.runs ?? [], 0);
}

/** Enter a hook's access window, as {@link withHookAccess} does, without a thunk. */
function enterHookAccess(run: HookRun): typeof activeHookOwner {
  if (!run.live) raise("Disposed", { reason: "run is finished" });
  if (run.layer.aborted) throw run.layer.reason;
  const previous = activeHookOwner;
  activeHookOwner = run.layer;
  buildDepth++;
  return previous;
}

function exitHookAccess(previous: typeof activeHookOwner): void {
  buildDepth--;
  activeHookOwner = previous;
}

function stepRunHook<T, I>(
  run: HookRun,
  target: Operation.Handle<T, I>,
  hookTarget: Operation.Handle<T, I> | Scope.Inline<Scope.Depends, T, I>,
  call: Scope.Invocation<I> | undefined,
  chain: readonly Namespace[] | undefined,
  runs: NonNullable<ExtRoutes["runs"]>,
  index: number,
): unknown {
  const previous = enterHookAccess(run);
  try {
    if (index === runs.length) return runHookBody(run, target, chain);
    const ext = runs[index];
    const op = hookTarget as
      | Operation.Handle<unknown, unknown>
      | Scope.Inline<Scope.Depends, unknown, unknown>;
    const next = (): unknown => stepRunHook(run, target, hookTarget, call, chain, runs, index + 1);
    return ext.hooks!.run!(new RunEvent(run, ext.label, chain, op, call, next));
  } finally {
    exitHookAccess(previous);
  }
}

function runHookBody<T, I>(
  run: HookRun,
  target: Operation.Handle<T, I>,
  chain: readonly Namespace[] | undefined,
): unknown {
  try {
    const ctx = new OperationCtx(
      run.layer,
      target,
      run.call as Scope.Invocation<I> | undefined,
      run.span,
    );
    if (run.ctx) OperationCtx.share(run.ctx, ctx);
    run.ctx = ctx;
    run.held ??= takeBorrows(target);
    const deps = readOpDeps(run.layer, target, ctx.span, run.held, chain, ctx);
    const pending = parked;
    const override = presetFor(run.layer, target) as Operation.Handle<T, I>["run"] | undefined;
    let result: unknown;
    if (pending === undefined) {
      const previous = enterHookAccess(run);
      try {
        result = runBody(override, target, deps, ctx, undefined);
      } finally {
        exitHookAccess(previous);
      }
    } else {
      result = settleDeps(deps, pending).then(() =>
        withHookAccess(run, () => runBody(override, target, deps, ctx, undefined)),
      );
    }
    if (isThenable(result)) {
      const ready = Promise.resolve(result);
      (run.work ??= []).push(ready);
      track(run.layer, ready, (error) => failHookRun(run, error));
      return ready;
    }
    return result;
  } catch (error) {
    failHookRun(run, error);
    throw error;
  }
}

function failHookRun(run: HookRun, error: unknown): void {
  if (run.failed !== undefined && run.failed.error === error) return;
  run.failed = { error };
  stampOrigin(error, run.label, run.span, run.ctx, endsFlight(run.caller, false));
  if (run.caller !== RECOVERED) stick(run.layer, error);
}

/** A hook may start `next()` then return a substitute. That body still owns its cleanup and
 * resource holds. Its tracked promise prevents close from dropping the unreturned work. */
function finishHookRun(run: HookRun, status: "ok" | "failed", error?: unknown): void {
  if (run.work !== undefined) {
    const pending = run.work;
    run.work = undefined;
    track(
      run.layer,
      Promise.allSettled(pending).then(() => finishHookRun(run, status, error)),
      noop,
    );
    return;
  }
  if (run.failed !== undefined) {
    status = "failed";
    error = run.failed.error;
  }
  closeSpan(run.layer.obs, run.span, status, error);
  const fns = run.ctx?.hooks;
  const done = (): void => {
    run.live = false;
    if (run.ctx) run.ctx.live = false;
    releaseBorrows(run.held);
  };
  void thenDone(
    fns === undefined ? undefined : runDefers(run.layer, fns, endFor(run.layer, status, error)),
    done,
  );
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
    super(run.layer, label, chain, run);
    this.kind = "run";
    this.op = op;
    this.call = call;
    this.next = next;
  }
}
