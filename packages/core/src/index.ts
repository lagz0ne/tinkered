import { isError, raise } from "./errors.ts";

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
 * Every list a config takes — `tags`, `meta`, `presets`, `extensions`, a driver's rows — is one,
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
    /** Static metadata bindings, read off the handle (never affects resolution). */
    readonly meta: readonly Tag.Binding<unknown>[];
    /** Depend on this cell in write mode: delivered as a controller. */
    readonly controller: Edge<"controller", Cell<T>>;
  };
}

export declare namespace Tag {
  /** The result of reading a tag that may be absent. */
  export type Presence<T> =
    | { readonly present: true; readonly value: T }
    | { readonly present: false };

  /** One value bound to a tag, seeded on a scope. `Handle<any>` is the callable-variance escape hatch. */
  export type Binding<T> = { readonly tag: Handle<any>; readonly value: T };

  /** Bindings as authored: a unit's `meta`, a scope's `tags`, a call's `tags` — a {@link Many}
   * of bindings, read once and flat where it lands. */
  export type Bindings = Many<Binding<unknown>>;

  /** Any unit carrying static metadata bindings (data/operation/resource/tag). */
  export type Metaed = { readonly meta: readonly Binding<unknown>[] };

  /** Ambient metadata read through the scope chain. Callable to bind a value. */
  export type Handle<T> = {
    readonly [tagSym]: true;
    readonly label: string;
    readonly hasDefault: boolean;
    readonly def: T | undefined;
    readonly parse: Data.Parse<T> | undefined;
    eq(a: T, b: T): boolean;
    /** Static metadata bindings on the tag itself (a tag can be tagged). */
    readonly meta: readonly Binding<unknown>[];
    readonly required: Edge<"required", Handle<T>>;
    readonly optional: Edge<"optional", Handle<T>>;
    readonly all: Edge<"all", Handle<T>>;
    /** Read this tag's static value off a unit's `meta` (nearest binding, else default, else absent). */
    read(unit: Metaed): Presence<T>;
    (value: T): Binding<T>;
  };
}

/** A parallel storage bucket inside a layer (ADR 0059): minted by {@link namespace}, carried on
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
  /** One unit of tracked work; nests by explicit `parentId` into a tree. Behavior-neutral. */
  export type Span = {
    readonly id: number;
    readonly parentId: number | undefined;
    readonly name: string;
    readonly kind: Kind;
    readonly start: number;
    end: number | undefined;
    status: "ok" | "failed" | undefined;
    readonly attributes: Record<string, unknown>;
    readonly events: Event[];
  };
  /** Where a log line sits on pino's numeric scale — higher is more severe, so a sink filters
   * with a single `>=`. The four named rungs are `LEVELS` (`debug` 20, `info` 30, `warn` 40,
   * `error` 50); a value is a number, so an intermediate rung is legal without a new name. */
  export type Level = number;
  /** A log line, carrying the level it was written at and the span it was written under (if any). */
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
  /** The observation receiver on a ctx: the current span, plus manual span/event openers. */
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
    /** Move virtual time forward by `ms` milliseconds. */
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
    /** Static metadata bindings, read off the handle (never affects resolution). */
    readonly meta: readonly Tag.Binding<unknown>[];
    /** Depend on this operation: delivered as a callable controller. */
    readonly controller: Edge<"controller", Handle<T, I>>;
  };
}

export declare namespace Resource {
  /** The receiver a resource factory builds through: `defer` registers one end-hook (commit/roll
   * back/release when the owner settles or the resource is released); `signal` aborts on close. */
  export type Ctx = {
    readonly label: string;
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
    /** Static metadata bindings, read off the handle (never affects resolution). */
    readonly meta: readonly Tag.Binding<unknown>[];
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
   * per-call namespace (ADR 0059). A call carrying `tags` opens a child session for that run
   * (always async). A defined `input` wins; an `undefined` `input` counts as absent, so `rawInput`
   * is parsed instead. */
  export type Invocation<I> = {
    readonly input?: I;
    readonly rawInput?: unknown;
    readonly tags?: Tag.Bindings;
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
        readonly ns?: Ns;
      }
    | {
        readonly input?: never;
        readonly rawInput: unknown;
        readonly tags?: Tag.Bindings;
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
   * `rawInput`. A call carrying `tags` opens a child session for the run (ADR 0038) and is
   * always async: it returns `Promise<Awaited<T>>` even when the body is sync. The tagged
   * overload comes first so a call carrying `tags` types as a promise even though an untagged
   * shape would also match. */
  export type OperationController<T, I> = {
    run(...call: TaggedCall<I>): Promise<Awaited<T>>;
    run(...call: CallArgs<I>): T;
  };

  /** The tag bindings a call may carry. Present on a call, they open a child session bound
   * with them for that run (ADR 0038): the run's own tag reads, its subflows, and session-target
   * resources built for the flow see them through the layer chain. Scope-target resources are
   * unchanged. A call carrying `tags` always returns a promise — a session closes
   * asynchronously, so no sync fast path is offered. The authored shape is `Tag.Bindings` minus
   * a bare nothing: `tags: undefined` (or `false`) is an untagged call, not a tagged one. */
  export type Bindings = Exclude<Tag.Bindings, null | undefined | false>;

  /** A call that carries `tags`: always async (ADR 0038). For a void input the call object
   * holds only `tags`; otherwise it holds the run's `input` (or `rawInput`) plus `tags`. */
  export type TaggedCall<I> = [I] extends [void]
    ? [call: { readonly tags: Bindings; readonly ns?: Ns }]
    : [call: ProvideInput<I> & { readonly tags: Bindings }];

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
   * with nothing to pass, omit the call and `I` is void. A call carrying `tags` opens a
   * child session for the run and is always async. */
  export type InlineCall<I> = [I] extends [void]
    ? [call?: { readonly tags?: Bindings; readonly ns?: Ns }]
    : [call: { readonly input: I; readonly tags?: Bindings; readonly ns?: Ns }];

  /** An inline run carrying `tags`: always async (ADR 0038). */
  export type TaggedInlineCall<I> = [I] extends [void]
    ? [call: { readonly tags: Bindings; readonly ns?: Ns }]
    : [call: { readonly input: I; readonly tags: Bindings; readonly ns?: Ns }];

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

  /** Middleware over the scope's verbs (ADR 0050): each hook is an onion layer with `next`. All
   * hooks are wired; sessions keep the plain dispatch (the v1 limit). `session` (ADR 0051) is the
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
    start?(scope: Handle, ctx: Resource.Ctx, next: () => Promise<void>): T | PromiseLike<T>;
    resolve?(
      target: Data.Cell<unknown> | Resource.Handle<unknown> | Tag.Handle<unknown>,
      next: () => unknown,
    ): unknown;
    run?(
      op: Operation.Handle<unknown, unknown> | Inline<Depends, unknown, unknown>,
      call: Invocation<unknown> | undefined,
      next: () => unknown,
    ): unknown;
    write?(cell: Data.Cell<unknown>, value: unknown, next: () => void): void;
    close?(options: CloseOptions, next: () => Promise<Result>): Promise<Result>;
    session?(handle: Handle, next: () => Promise<Result>): Promise<Result>;
  };

  /** Values seeded on a scope at creation. */
  export type Options = {
    tags?: Tag.Bindings;
    /** The ambient namespace (ADR 0059): every read and write inside resolves through it; a
     * child session inherits it; a per-call `ns` overrides it for one run. Absent = default. */
    ns?: Ns;
    observe?: Observe.Config;
    presets?: Many<Preset>;
    /** The ambient clock for this scope; child sessions inherit it. Default is the system clock. */
    clock?: Clock.Handle;
    /** The ambient randomness for this scope; child sessions inherit it. Default is the system source. */
    random?: Random.Handle;
    /** Middleware installed on the root scope only (ADR 0050); sessions inherit the resolved values. */
    extensions?: Many<Extension<unknown>>;
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
   * consequence of the mode and what actually happened, read from the {@link Result}. */
  export type CloseOptions = { readonly graceful?: boolean };

  /** What `close()` resolves to — the ACTUAL settled state, never a thrown error (ADR 0027/0028).
   * `teardownErrors` (defer/cleanup throws, in execution order) may accompany any status. */
  export type Result =
    | { readonly status: "success"; readonly teardownErrors?: readonly unknown[] }
    | {
        readonly status: "cancelled";
        readonly reason: unknown;
        readonly teardownErrors?: readonly unknown[];
      }
    | {
        readonly status: "failed";
        readonly error: unknown;
        readonly teardownErrors?: readonly unknown[];
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
     * Same `CallArgs`/`Invocation` rules as before (ADR 0022). A call carrying `tags` opens a
     * child session for the run (ADR 0038) and is always async: it returns `Promise<Awaited<T>>`
     * even when the body is sync. Also runs an inline operation config (ADR 0037) — same call
     * object, minus `rawInput` — through the same controller path, with one span named
     * `label ?? "inline"` and nothing cached in the layer. The tagged overloads come first so a
     * call carrying `tags` types as a promise even though an untagged shape would also match. */
    run<T, I>(op: Operation.Handle<T, I>, ...call: TaggedCall<I>): Promise<Awaited<T>>;
    run<T, I>(op: Operation.Handle<T, I>, ...call: CallArgs<I>): T;
    run<const D extends Depends = Record<string, never>, R = unknown, I = void>(
      inline: Inline<D, R, I>,
      ...call: TaggedInlineCall<I>
    ): Promise<Awaited<R>>;
    run<const D extends Depends = Record<string, never>, R = unknown, I = void>(
      inline: Inline<D, R, I>,
      ...call: InlineCall<I>
    ): R;
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
    /** Settles when every installed extension's `start` chain settled (ADR 0050). A scope with no
     * extensions is ready at once (one shared, already-resolved promise). */
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

/** Declare an extension (stamps the private symbol; the config is the hooks + label). */
export function extension<T = void>(config: {
  readonly label: string;
  readonly start?: (
    scope: Scope.Handle,
    ctx: Resource.Ctx,
    next: () => Promise<void>,
  ) => T | PromiseLike<T>;
  readonly resolve?: (
    target: Data.Cell<unknown> | Resource.Handle<unknown> | Tag.Handle<unknown>,
    next: () => unknown,
  ) => unknown;
  readonly run?: (
    op: Operation.Handle<unknown, unknown> | Scope.Inline<Scope.Depends, unknown, unknown>,
    call: Scope.Invocation<unknown> | undefined,
    next: () => unknown,
  ) => unknown;
  readonly write?: (cell: Data.Cell<unknown>, value: unknown, next: () => void) => void;
  readonly close?: (
    options: Scope.CloseOptions,
    next: () => Promise<Scope.Result>,
  ) => Promise<Scope.Result>;
  readonly session?: (
    handle: Scope.Handle,
    next: () => Promise<Scope.Result>,
  ) => Promise<Scope.Result>;
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

/** Read a tag's static value off a unit's `meta`: the nearest matching binding, else the tag's
 * default, else absent. Static (no scope chain) — this is definition-time metadata. */
function metaFind<T>(unit: Tag.Metaed, target: Tag.Handle<T>): Tag.Presence<T> {
  for (let i = unit.meta.length - 1; i >= 0; i--) {
    const binding = unit.meta[i];
    if (binding.tag === target) return { present: true, value: binding.value as T };
  }
  return target.hasDefault ? { present: true, value: target.def as T } : { present: false };
}

/** Declare a reactive value cell. `parse` validates the initial value once. */

export function data<T>(config: {
  label?: string;
  initial: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
  meta?: Tag.Bindings;
}): Data.Cell<T> {
  const label = config.label ?? "anon";
  const base = {
    [cell]: true,
    label,
    initial: admit(label, config.parse, config.initial),
    parse: config.parse,
    eq: config.eq ?? Object.is,
    meta: readMany(config.meta),
  } as Data.Cell<T>;
  return Object.assign(base, { controller: edgeTo("controller", base) });
}

/** Declare an ambient tag. Call it to bind a value; read it via `.required`/`.optional`/`.all`. */
export function tag<T>(config: {
  label: string;
  default?: T;
  parse?: Data.Parse<T>;
  eq?: (a: T, b: T) => boolean;
  meta?: Tag.Bindings;
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
    meta: readMany(config.meta),
    read: (unit: Tag.Metaed): Tag.Presence<T> => metaFind(unit, handle),
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
  meta?: Tag.Bindings;
}): Operation.Handle<R, I> {
  const base = {
    [operationSym]: true,
    label: config.label,
    input: config.input,
    depends: config.depends ?? {},
    run: config.run as Operation.Handle<R, I>["run"],
    meta: readMany(config.meta),
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
  meta?: Tag.Bindings;
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
    meta: readMany(config.meta),
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
  /** In-flight async build. */
  build: Promise<unknown> | undefined = undefined;
  /** Resource generation (bumped on invalidation to supersede a late build). */
  gen = 0;
  /** Build currently in progress (circular-resource guard). */
  building = false;
  /** In-flight op promises borrowing this resource (release waits on them). */
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
   * two chains with the same write head can resolve through different fallback buckets. */
  nsWatchers: Set<NsWatcher> | undefined = undefined;
}

/** Get-or-create this layer's record for a node. */
function nodeState(layer: Layer, key: object): NodeState {
  let s = layer.nodes.get(key);
  if (s === undefined) {
    s = new NodeState();
    layer.nodes.set(key, s);
  }
  return s;
}

/** Depth of factory/op execution in progress across all scopes. Non-zero means a user body is running
 * its synchronous prefix — work it starts may not be tracked in `pending` yet — so a close called now
 * must take the full (deferred) path, never the idle fast path. */
let buildDepth = 0;

/** Materialize this layer's AbortController on first `ctx.signal` read (kept in sync with the cheap
 * `aborted` flag). Most scopes never hand out a signal, so most never allocate one. */
function signalOf(layer: Layer): AbortSignal {
  let ac = layer.abort;
  if (!ac) {
    ac = new AbortController();
    if (layer.aborted) ac.abort(layer.abortReason);
    layer.abort = ac;
  }
  return ac.signal;
}

/** One layer of the scope chain. A session is a child layer. */
type Layer = {
  parent: Layer | undefined;
  children: Set<Layer>;
  /** Single node-keyed store: cells, effective-cache, resources, builds, generations, build-flag,
   * borrowers, dependents, and cached controllers all live in one {@link NodeState} per node. */
  nodes: Map<object, NodeState>;
  /** Named states linked to an ancestor's bucket, detached when this layer closes. */
  nsLinked?: Set<NsResourceState>;
  /** Lazily allocated: empty unless the scope was seeded with presets/tags. */
  presets: Map<unknown, unknown> | undefined;
  tags: Map<Tag.Handle<unknown>, unknown[]> | undefined;
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
  descendantFailure: { cause: unknown } | undefined;
  secondary: unknown[];
  body: Promise<unknown> | undefined;
  closed: boolean;
  closing: Promise<Scope.Result> | undefined;
  obs: Obs;
  clock: Clock.Handle;
  random: Random.Handle;
  emptyCtx: Resource.Ctx | undefined;
  /** The ambient namespace chain of this layer (ADR 0059): set from the scope/session options,
   * inherited by child sessions, overridden per call through a view layer. Undefined = default. */
  ns: readonly Namespace[] | undefined;
};

type ExtRec = { settled: boolean; value: unknown };
const EXTENSIONS = new WeakMap<Layer, Map<Scope.Extension<unknown>, ExtRec>>();

/** Extension `session` chains, off the Layer record (ADR 0051, drivers/t01): the filtered list of
 * extensions that declare the hook, stored once per root layer by `extendHandle` — the same side-table
 * shape as `EXTENSIONS` (core/t33). No entry means no hook: session creation takes today's path. */
const SESSIONS = new WeakMap<Layer, readonly Scope.Extension<unknown>[]>();

/** Settlers for wrapped bare sessions' `next()` (ADR 0051, drivers/t01 R3): `wrapSession` registers
 * its `next()` resolver here; `closeLayer` settles it when the layer's close resolves — so a session
 * closed by its parent's cascade settles its hooks exactly like an explicit close. One lookup on the
 * cold close path, nothing on create; the entry is deleted at settle, and a never-closed layer's
 * entry dies with the layer (WeakMap). */
const SESSION_SETTLERS = new WeakMap<Layer, (ended: Scope.Result) => void>();

/** Settle a wrapped bare session's `next()` with its close `Result`: attach once (the entry is
 * deleted), so repeat closes cost one lookup. `closeLayer` never rejects (ADR 0027) and a stored
 * resolver cannot throw, so the tap needs no rejection guard. */
function tapSessionHooks(layer: Layer, closing: Promise<Scope.Result>): Promise<Scope.Result> {
  const settle = SESSION_SETTLERS.get(layer);
  if (settle === undefined) return closing;
  SESSION_SETTLERS.delete(layer);
  ignoreRejection(closing.then((ended) => settle(ended)));
  return closing;
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
  run: () => Promise<{ result: unknown; ended: Scope.Result }>,
): Promise<{ result: unknown; ended: Scope.Result }> {
  let life: Promise<{ result: unknown; ended: Scope.Result }> | undefined;
  const ensure = (): Promise<{ result: unknown; ended: Scope.Result }> => (life ??= run());
  const at = (index: number): Promise<{ result: unknown; ended: Scope.Result }> => {
    if (index >= sessions.length) return ensure();
    const { session: hook } = sessions[index] as {
      session?: (handle: Scope.Handle, next: () => Promise<Scope.Result>) => Promise<Scope.Result>;
    };
    if (hook === undefined) return at(index + 1);
    /** The inner life this hook observes: memoized so calling `next()` twice still runs the
     * session once, and so a hook that skips `next()` leaves `inner` unset for `ensure` below. */
    let inner: Promise<{ result: unknown; ended: Scope.Result }> | undefined;
    const next = (): Promise<Scope.Result> => (inner ??= at(index + 1)).then(({ ended }) => ended);
    let outcome: Promise<Scope.Result>;
    try {
      outcome = hook(handle, next);
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

/** Late use of a sealed scope fails loudly. */
function ensureOpen(layer: Layer): void {
  if (layer.closed) raise("Disposed", { reason: "scope is closed" });
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

/** The nearest cell up the chain (cached per layer); a missing cell resolves to an entry holding
 * the cell's initial value, so reads never check for absence. A namespaced read branches off
 * here (ns present only) and takes the shared selector uncached — the default path and its
 * cache are untouched. */
function effectiveEntry(
  layer: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[] | undefined = layer.ns,
): Entry {
  if (chain !== undefined) return effectiveEntryNs(layer, target, chain);
  const self = nodeState(layer, target);
  const cached = self.eff;
  if (cached !== undefined) return cached;
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const owned = cur.nodes.get(target)?.cell;
    if (owned) {
      self.eff = owned;
      return owned;
    }
  }
  const fresh: Entry = { value: target.initial };
  self.eff = fresh;
  return fresh;
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

/** Copy-on-write: get or create this layer's own shadow of a cell, seeded from the inherited value. */
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
function flushCell(layer: Layer, target: Data.Cell<unknown>): void {
  flushOne(layer, target);
  flushNsWatchers(layer, target);
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
 * namespaced watchers at this layer re-resolve their own chains (cross-layer inheritance is t03). */
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
  ownNsCell(layer, target, chain[0], current).value = value;
  flushNsWatchers(layer, target);
}

/** Get-or-create this layer's named bucket of a cell, seeded from the inherited value. */
function ownNsCell(layer: Layer, target: Data.Cell<unknown>, key: Namespace, seed: unknown): Entry {
  const rec = nodeState(layer, target);
  let bucket = rec.nsCells?.get(key);
  if (bucket === undefined) {
    bucket = { value: seed };
    (rec.nsCells ??= new Map()).set(key, bucket);
  }
  return bucket;
}

/** Re-resolve every namespaced watcher through its own full chain. A write to one bucket can
 * change any chain that falls through to it, while another chain with the same head may not change. */
function flushNsWatchers(layer: Layer, target: Data.Cell<unknown>): void {
  const watchers = layer.nodes.get(target)?.nsWatchers;
  if (watchers === undefined || watchers.size === 0) return;
  const pending = pendingNsWatchers(layer, target, watchers);
  if (pending) for (const p of pending) p.fn(p.next, p.prev);
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

/** The last value of a tag list (its nearest binding), or undefined for an absent/empty list. */
function topTag(list: unknown[] | undefined): { present: true; value: unknown } | undefined {
  return list && list.length ? { present: true, value: list[list.length - 1] } : undefined;
}

function tagFind(
  layer: Layer,
  target: Tag.Handle<unknown>,
  chain: readonly Namespace[] | undefined = layer.ns,
): Tag.Presence<unknown> {
  if (chain !== undefined) return tagFindNs(layer, target, chain);
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const hit = topTag(cur.tags?.get(target));
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
    (cur) => topTag(cur.tags?.get(target)),
  );
  if (hit) return hit;
  return target.hasDefault ? { present: true, value: target.def } : { present: false };
}

/** A namespace's nearest binding of one tag, or undefined. */
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
  for (let cur: Layer | undefined = layer; cur; cur = cur.parent) {
    const list = cur.tags?.get(target);
    if (list) for (let i = list.length - 1; i >= 0; i--) out.push(list[i]);
  }
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
    const list = cur.tags?.get(target);
    if (list) for (let i = list.length - 1; i >= 0; i--) out.push(list[i]);
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

/** The nearest preset replacement for an operation/resource node up the chain, or undefined. */
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

function dataController<T>(layer: Layer, target: Data.Cell<T>): Scope.DataController<T> {
  const rec = nodeState(layer, target);
  const get = (): T => {
    const entry = rec.eff;
    if (entry === undefined) return readCell(layer, target) as T;
    return entry.value as T;
  };
  return {
    get,
    set: (value: T) => writeCell(layer, target, value),
    update: (fn: (previous: T) => T) => {
      ensureOpen(layer);
      writeCell(layer, target, fn(get()));
    },
    watch: (listener: (next: T, prev: T) => void) =>
      addWatcher(layer, target, rec, listener as (next: unknown, prev: unknown) => void),
  };
}

/** The namespaced data controller (ADR 0059): reads, writes, and watches use one explicit chain.
 * Reads use the shared selector, writes land at `(this layer, first key)`, and each watcher keeps
 * its own full-chain comparison value (named-watch inheritance across layers is t03). */
function dataControllerNs<T>(
  layer: Layer,
  target: Data.Cell<T>,
  chain: readonly Namespace[],
): Scope.DataController<T> {
  const get = (): T => readCell(layer, target, chain) as T;
  return {
    get,
    set: (value: T) => writeCell(layer, target, value, chain),
    update: (fn: (previous: T) => T) => {
      ensureOpen(layer);
      writeCell(layer, target, fn(get()), chain);
    },
    watch: (listener: (next: T, prev: T) => void) =>
      addWatcherNs(layer, target, chain, listener as (next: unknown, prev: unknown) => void),
  };
}

/** Register one namespaced watcher with its own chain and current resolved comparison value. */
function addWatcherNs(
  layer: Layer,
  target: Data.Cell<unknown>,
  chain: readonly Namespace[],
  fn: (next: unknown, prev: unknown) => void,
): () => void {
  ensureOpen(layer);
  const rec = nodeState(layer, target);
  const watcher: NsWatcher = { fn, chain, notified: readCell(layer, target, chain) };
  (rec.nsWatchers ??= new Set()).add(watcher);
  return () => void rec.nsWatchers?.delete(watcher);
}

function resolveControllerEdge(
  layer: Layer,
  target: unknown,
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): unknown {
  if (isData(target))
    return chain !== undefined
      ? dataControllerNs(layer, target, chain)
      : dataController(layer, target);
  if (isOperation(target)) return operationController(layer, target, parent, chain);
  raise("InvalidDependency", { label: "edge", reason: "unknown controller target" });
}

function resolveEdge(
  layer: Layer,
  dep: Edge<string, unknown>,
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): unknown {
  if (dep.kind === "controller") return resolveControllerEdge(layer, dep.target, parent, chain);
  const target = dep.target as Tag.Handle<unknown>;
  if (dep.kind === "all") return tagAll(layer, target, chain);
  if (dep.kind === "optional") return tagFind(layer, target, chain);
  return tagRequired(layer, target, chain);
}

function resolveDep(
  layer: Layer,
  dep: Scope.Dependency,
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): unknown {
  if (isEdge(dep)) return resolveEdge(layer, dep, parent, chain);
  if (isData(dep)) return readCell(layer, dep, chain);
  if (isTag(dep)) return tagRequired(layer, dep, chain);
  if (isOperation(dep)) return operationController(layer, dep, parent, chain);
  if (isResource(dep)) return resourceSlot(layer, dep, parent, chain);
  if (isExtension(dep)) return resolveExtension(layer, dep);
  raise("InvalidDependency", { label: "unknown", reason: "unknown dependency" });
}

const noop = (): void => undefined;

/** Attach a rejection handler to a fire-and-forget close so an internally started close (from a
 * teardown hook) is never an unhandled rejection; the promise keeps its rejection for a later
 * external awaiter. */
function ignoreRejection(promise: Promise<unknown>): void {
  return void promise.catch(noop);
}

type Obs = {
  observing: boolean;
  clock: () => number;
  export: ((span: Observe.Span) => void) | undefined;
  historyMax: number;
  history: Observe.Span[];
  log: ((entry: Observe.Log) => void) | undefined;
  level: number;
  nextId: number;
};

const OFF_LOG_FN = (): void => undefined;
const OFF_LOG: Observe.Logger = Object.assign(OFF_LOG_FN, {
  debug: OFF_LOG_FN,
  info: OFF_LOG_FN,
  warn: OFF_LOG_FN,
  error: OFF_LOG_FN,
});
const OFF_OBS: Observe.Ctx = {
  span: undefined,
  event: () => undefined,
  child: (_name, fn) => fn(undefined),
};

function nanosFromMillis(ms: number): bigint {
  const whole = Math.trunc(ms);
  return BigInt(whole) * 1_000_000n + BigInt(Math.round((ms - whole) * 1_000_000));
}

const systemClock: Clock.Handle = {
  currentTimeMillis: () => Date.now(), // ambient-source
  currentTimeNanos: () =>
    nanosFromMillis(performance.timeOrigin) + nanosFromMillis(performance.now()), // ambient-source
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

const systemRandom: Random.Handle = {
  next: () => Math.random(), // ambient-source
  uuid: () => crypto.randomUUID(), // ambient-source
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
  return { next, uuid };
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

function openSpan(
  obs: Obs,
  parent: Observe.Span | undefined,
  name: string,
  kind: Observe.Kind,
): Observe.Span | undefined {
  if (!obs.observing) return undefined;
  return {
    id: obs.nextId++,
    parentId: parent?.id,
    name,
    kind,
    start: obs.clock(),
    end: undefined,
    status: undefined,
    attributes: {},
    events: [],
  };
}

function isolate(run: () => unknown): void {
  try {
    const result = run();
    if (isThenable(result)) ignoreRejection(Promise.resolve(result));
  } catch (error) {
    void error;
  }
}

function closeSpan(obs: Obs, span: Observe.Span | undefined, status: "ok" | "failed"): void {
  if (!span || span.end !== undefined) return;
  const end = obs.clock();
  span.end = end;
  span.status = status;
  if (obs.historyMax > 0) {
    obs.history.push(span);
    if (obs.history.length > obs.historyMax) obs.history.shift();
  }
  const sink = obs.export;
  if (sink) isolate(() => sink(span));
  logStep(obs, span, status, end);
}

function logStep(obs: Obs, span: Observe.Span, status: "ok" | "failed", end: number): void {
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

function settleSpan(obs: Obs, span: Observe.Span, result: unknown): void {
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

function obsCtx(obs: Obs, span: Observe.Span | undefined): Observe.Ctx {
  if (!span) return OFF_OBS;
  return {
    span,
    event: (name, attributes) => {
      span.events.push({ name, time: obs.clock(), attributes: attributes ?? {} });
    },
    child: (name, fn) => {
      const child = openSpan(obs, span, name, "manual");
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

function logFor(obs: Obs, span: Observe.Span | undefined): Observe.Logger {
  const sink = obs.log;
  if (!sink) return OFF_LOG;
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
  caller: Observe.Span | undefined,
  target: Resource.Handle<unknown>,
): void {
  if (caller) {
    caller.events.push({ name: "used", time: obs.clock(), attributes: { resource: target.label } });
  }
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
  layer.pending.add(tracked);
}

/** Every abort reason we mint carries this brand, so a rejection can be recognized as one of OUR
 * cancellations regardless of WHICH layer's abort produced it — a cancelled child rejects with its
 * own reason, and its awaiting parent must still read that as a clean cancel, not a failure (r11). */
const cancelBrand: unique symbol = Symbol("cancel");

function makeCancelReason(): { [cancelBrand]: true } {
  return { [cancelBrand]: true };
}

function isCancelReason(error: unknown): boolean {
  return typeof error === "object" && error !== null && cancelBrand in error;
}

/** A rejection caused by our own cancellation — a clean cancel, not a failure (ADR 0026). The layer
 * must be aborted AND the error must be a branded cancel reason (from this layer or a descendant it
 * awaited); a real error rejecting during close is unbranded and still counts as a failure. */
function isCancel(layer: Layer, error: unknown): boolean {
  return layer.aborted && isCancelReason(error);
}

const asPrimary =
  (layer: Layer) =>
  (error: unknown): void => {
    if (isCancel(layer, error)) return;
    layer.failure ??= { cause: error };
  };

/** The `defer` end for work that rejected: an abort-caused rejection is `cancelled`, else `failed`. */
function rejectEnd(layer: Layer, error: unknown): Scope.End {
  return isCancel(layer, error) ? { status: "cancelled" } : { status: "failed", error };
}

/** How an operation's run settled, for its `defer`: an abort-caused rejection (or a clean return
 * under an aborted signal) is `cancelled`; a real rejection is `failed`; else `success`. */
function endFor(layer: Layer, status: "ok" | "failed", error: unknown): Scope.End {
  if (status === "failed") return rejectEnd(layer, error);
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
  for (const active of teardownDepth.keys()) {
    for (let cur: Layer | undefined = active; cur; cur = cur.parent) {
      if (cur === target) return true;
    }
  }
  return false;
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
      layer.secondary.push(error);
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
        layer.secondary.push(error);
        return runDefers(layer, fns, end, rest);
      },
    );
    layer.pending.add(cont);
    return cont;
  }
  return undefined;
}

/** An operation's parsed raw input (no parser means void input). A throwing parse is the edge
 * rejecting the value: `DataValidationFailed { label, cause }`, the same registry error a data or tag
 * parse raises — so a driver maps it (400) without knowing the parser. */
function parseInput<I>(target: Operation.Handle<unknown, I>, rawInput: unknown): I {
  if (!target.input) return undefined as I;
  return admit(target.label, target.input, rawInput);
}

/** A preset replacement when seeded, else the declared run. */
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
  private owner: Layer;
  private defers: ((end: Scope.End) => void | PromiseLike<void>)[] | undefined = undefined;
  readonly label: string;
  readonly rawInput: unknown;
  readonly input: I;
  readonly obs: Observe.Ctx;
  readonly log: Observe.Logger;
  readonly clock: Clock.Handle;
  readonly random: Random.Handle;
  constructor(
    owner: Layer,
    target: Operation.Handle<unknown, I>,
    call: Scope.Invocation<I> | undefined,
    obs: Obs,
    span: Observe.Span | undefined,
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
    this.obs = obsCtx(obs, span);
    this.log = logFor(obs, span);
    this.clock = owner.clock;
    this.random = owner.random;
  }
  readonly defer = (fn: (end: Scope.End) => void | PromiseLike<void>): void => {
    (this.defers ??= []).push(fn);
  };
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

/** True when a call carries tag bindings (ADR 0038): one optional `tags` read, no chain.
 * A tagged call opens a child session for the run; anything else takes the untagged body
 * inline below. Nothing (`undefined`/`null`/`false`) and `tags: []` count as untagged (no session
 * for an empty binding list); a single binding or a non-empty list counts as tagged. */
function hasCallTags(call: Scope.Invocation<unknown> | undefined): boolean {
  const tags = call?.tags;
  if (isNothing(tags)) return false;
  return isNotList(tags) || tags.length !== 0;
}

/** Run `target` in a child session bound with the call's tags (ADR 0038) — sugar over
 * `session({ tags }, (s) => s.run(target, { input }))`. Always async: the session closes
 * asynchronously when the run settles, so even a sync body resolves through a promise.
 * `parent` carries through so a subflow's span still nests under its caller. */
function runTagged<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: Observe.Span | undefined,
  call: Scope.Invocation<I> & { readonly tags: Scope.Bindings },
  inheritedChain: readonly Namespace[] | undefined,
): Promise<Awaited<T>> {
  const tags = call.tags;
  const chain = call.ns === undefined ? inheritedChain : nsChainOf(call.ns);
  const inner: Scope.Invocation<I> | undefined =
    call.input === undefined && call.rawInput === undefined ? undefined : stripTags(call);
  return runSessionWith(layer, { tags, ns: chain }, (child) =>
    runUntagged(child, target, parent, inner, chain),
  ) as Promise<Awaited<T>>;
}

/** Run `target` in the call's namespace (ADR 0059). The real layer remains the owner of
 * lifecycle state and registries; the chain travels beside it through resolution. */
function runNsCall<I>(
  layer: Layer,
  target: Operation.Handle<unknown, I>,
  parent: Observe.Span | undefined,
  call: Scope.Invocation<I> & { readonly ns: Ns },
): unknown {
  ensureOpen(layer);
  return runUntagged(layer, target, parent, stripNs(call), nsChainOf(call.ns));
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

function operationController<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): Scope.OperationController<T, I> {
  /** The single entry every run takes — declared, subflow, and inline alike. A call carrying
   * `tags` opens a child session for the run (ADR 0038, always async); anything else runs the
   * untagged body inline below, which is main's, unchanged — one optional `call.tags` read, no
   * extra frame or call on the hot path. The implementation signature stays broad (one input
   * shape would mean no overload — rule 9); the two public overloads type the fork. */
  const sees = seesResourceOf(target);
  const run = (call?: Scope.Invocation<I>): unknown => {
    if (hasCallTags(call))
      return runTagged(
        layer,
        target,
        parent,
        call as Scope.Invocation<I> & {
          readonly tags: Scope.Bindings;
        },
        chain,
      );
    if (hasCallNs(call))
      return runNsCall(layer, target, parent, call as Scope.Invocation<I> & { readonly ns: Ns });
    ensureOpen(layer);
    const obs = layer.obs;
    const span = openSpan(obs, parent, target.label, "operation");
    const override = presetFor(layer, target) as Operation.Handle<T, I>["run"] | undefined;
    /** Hold a borrow across the op's WHOLE lifetime — body settle (or a throw) AND its own `defer`
     * drain — so a release waits for the op's cleanup (which may still touch the resource) before
     * tearing it down (ADR 0026 Q2). Taken before deps resolve (a dep's factory may release another
     * dep during resolution), released after the defer drain on BOTH the success and throwing paths.
     * A fully synchronous op runs and removes the borrow within `run()`, so a later release
     * sees no borrower and stays sync. */
    const held = takeBorrows(target);
    const releaseBorrow = (): void => {
      if (!held) return;
      for (const instance of held.list) removeBorrow(instance, held.done);
      held.settle();
    };
    let ctx: OperationCtx<I> | undefined;
    const finishDefers = (status: "ok" | "failed", error?: unknown): void => {
      const fns = ctx ? OperationCtx.defersOf(ctx) : undefined;
      if (fns === undefined || fns.length === 0) {
        releaseBorrow();
        return;
      }
      const tail = runDefers(layer, fns, endFor(layer, status, error));
      if (tail) ignoreRejection(tail.then(releaseBorrow, releaseBorrow));
      else releaseBorrow();
    };
    let result: T;
    buildDepth++;
    try {
      ctx = new OperationCtx<I>(layer, target, call, obs, span);
      const deps = sees
        ? readOpDeps(layer, target, span, held, chain)
        : buildPlainDeps(layer, target.depends, span, chain);
      result = runBody(override, target, deps, ctx, parked);
    } catch (error) {
      closeSpan(obs, span, "failed");
      finishDefers("failed", error);
      throw error;
    } finally {
      buildDepth--;
    }
    if (!isThenable(result)) {
      if (span) closeSpan(obs, span, "ok");
      finishDefers("ok");
    } else {
      track(layer, result, asPrimary(layer), (status, error) => {
        if (span) closeSpan(obs, span, status);
        finishDefers(status, error);
      });
    }
    return result;
  };
  return { run } as Scope.OperationController<T, I>;
}

/** Run `target` on the tagged call's session layer with the tag-stripped call (ADR 0038) — a
 * fresh controller per tagged run, so the hot closure above keeps its exact main shape for the
 * optimizer. Cold path only (one session create + close already dominates); the hot untagged
 * call never enters here. */
function runUntagged<T, I>(
  layer: Layer,
  target: Operation.Handle<T, I>,
  parent: Observe.Span | undefined,
  call: Scope.Invocation<I> | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): T {
  const untagged: { run(call?: Scope.Invocation<I>): T } = operationController(
    layer,
    target,
    parent,
    chain,
  ) as { run(call?: Scope.Invocation<I>): T };
  return untagged.run(call);
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

/** One still-building resource slot of a `deps` object: its key and the build to await. */
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
  span: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined,
  selected: SelectedResource | undefined,
): unknown {
  return selected && isResource(dep)
    ? resourceSlot(layer, dep, span, chain, selected)
    : resolveDep(layer, dep, span, chain);
}

function buildDeps(
  layer: Layer,
  depends: Scope.Depends,
  span: Observe.Span | undefined,
  registerEdge: RegisterEdge,
  chain: readonly Namespace[] | undefined = layer.ns,
  selected?: SelectedResource,
): Record<string, unknown> {
  const deps: Record<string, unknown> = {};
  let pending: PendingSlot[] | undefined;
  for (const key in depends) {
    const dep = depends[key];
    registerEdge?.(dep);
    const value =
      selected === undefined
        ? resolveDep(layer, dep, span, chain)
        : resolveSelectedDep(layer, dep, span, chain, selected);
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
  span: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): Record<string, unknown> {
  const deps: Record<string, unknown> = {};
  for (const key in depends) deps[key] = resolveDep(layer, depends[key], span, chain);
  parked = undefined;
  return deps;
}

/** An operation's deps: the parking loop when its `depends` name a resource (the declaration-time
 * flag, read once per controller), else the plain loop. Either way {@link parked} is set for the
 * caller to hand to {@link runBody}. */
function readOpDeps(
  layer: Layer,
  target: Operation.Handle<unknown, unknown>,
  span: Observe.Span | undefined,
  held: HeldBorrows | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): Record<string, unknown> {
  return buildDeps(
    layer,
    target.depends,
    span,
    undefined,
    chain,
    held && ((owner, res, state) => addBorrow(instanceOf(owner, res, state), held)),
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
  span: Observe.Span | undefined,
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
    state instanceof NsResourceState
      ? (depOwner, depTarget, depState) => {
          if (!superseded() && depState instanceof NsResourceState)
            linkNsResourceDependent(depState, state);
          selected?.(depOwner, depTarget, depState);
        }
      : selected,
  );
}

class ResourceCtx implements Resource.Ctx {
  private owner: Layer;
  private instance: ResourceInstance;
  private isSettled: () => boolean;
  readonly label: string;
  readonly obs: Observe.Ctx;
  readonly log: Observe.Logger;
  readonly clock: Clock.Handle;
  readonly random: Random.Handle;
  constructor(
    instance: ResourceInstance,
    obs: Obs,
    span: Observe.Span | undefined,
    isSettled: () => boolean,
  ) {
    this.owner = instance.owner;
    this.instance = instance;
    this.isSettled = isSettled;
    this.label = instance.target.label;
    this.obs = obsCtx(obs, span);
    this.log = logFor(obs, span);
    this.clock = instance.owner.clock;
    this.random = instance.owner.random;
  }
  readonly defer = (fn: (end: Scope.End) => void | PromiseLike<void>): void => {
    if (this.isSettled()) raise("Disposed", { reason: "resource factory already finished" });
    this.instance.hooks.push(fn);
    this.instance.owner.defers.push({ fn, instance: this.instance });
  };
  get signal(): AbortSignal {
    return signalOf(this.owner);
  }
}

/** Build the ctx a resource factory receives. Only called when the factory declares a ctx param
 * (arity >= 2); otherwise a per-layer empty ctx (see {@link emptyCtxFor}) is passed, allocated at
 * most once per layer. `defer` closes over the build's `settled`/`superseded` so late registration
 * behaves correctly. */
function buildCtx(
  instance: ResourceInstance,
  obs: Obs,
  span: Observe.Span | undefined,
  isSettled: () => boolean,
): Resource.Ctx {
  return new ResourceCtx(instance, obs, span, isSettled);
}

class EmptyCtx implements Resource.Ctx {
  readonly label = "";
  readonly obs = OFF_OBS;
  readonly log = OFF_LOG;
  readonly clock: Clock.Handle;
  readonly random: Random.Handle;
  private owner: Layer;
  constructor(owner: Layer) {
    this.owner = owner;
    this.clock = owner.clock;
    this.random = owner.random;
  }
  readonly defer = (): void => {
    raise("Disposed", { reason: "resource factory declared no ctx" });
  };
  get signal(): AbortSignal {
    return signalOf(this.owner);
  }
}

function writeThrough(
  layer: Layer,
  writers: readonly Scope.Extension<unknown>[],
  plain: Scope.Handle,
): Scope.Handle["controller"] {
  const cache = new Map<Data.Cell<unknown>, Scope.DataController<unknown>>();
  const chained = (
    target: Data.Cell<unknown> | Resource.Handle<unknown> | Operation.Handle<unknown, unknown>,
    ns?: Scope.NsArg,
  ): unknown => {
    ensureOpen(layer);
    if (isData(target)) {
      const hit = ns === undefined ? cache.get(target) : undefined;
      if (hit !== undefined) return hit;
      const plainCtl = plain.controller(target, ns);
      const at = (value: unknown, index: number): void => {
        if (index >= writers.length) {
          plainCtl.set(value);
          return;
        }
        const writer = writers[index];
        if (writer.write === undefined) {
          at(value, index + 1);
          return;
        }
        writer.write(target, value, () => at(value, index + 1));
      };
      const wrapped: Scope.DataController<unknown> = {
        get: () => plainCtl.get(),
        set: (value: unknown) => {
          ensureOpen(layer);
          at(value, 0);
        },
        update: (fn: (previous: unknown) => unknown) => {
          ensureOpen(layer);
          at(fn(plainCtl.get()), 0);
        },
        watch: (listener: (next: unknown, prev: unknown) => void) => plainCtl.watch(listener),
      };
      if (ns === undefined) cache.set(target, wrapped);
      return wrapped;
    }
    if (isResource(target)) return plain.controller(target, ns);
    return plain.controller(target, ns);
  };
  /** One cast: the broad internal entry covers every overload the public face types. */
  return chained as Scope.Handle["controller"];
}

/** Wrap the structural close in the extensions' `close` onion (ADR 0050): first registered is
 * outermost; extensions without a `close` hook are skipped when the chain is built. */
function closeThrough(
  layer: Layer,
  closers: readonly Scope.Extension<unknown>[],
): (opts?: Scope.CloseOptions) => Promise<Scope.Result> {
  return (opts?: Scope.CloseOptions): Promise<Scope.Result> => {
    const at = (index: number): Promise<Scope.Result> => {
      if (index >= closers.length) return closeLayer(layer, !opts?.graceful);
      const closer = closers[index];
      if (closer.close === undefined) return closeLayer(layer, !opts?.graceful);
      return closer.close(opts ?? {}, () => at(index + 1));
    };
    return at(0);
  };
}

/** Run the extensions' `start` onion (ADR 0050): registration order, first is outermost. Each
 * start's returned value (awaited) is stored per extension; the records flip `settled` only when
 * that extension's start settled. A rejected start records the layer failure (so a later close
 * settles `failed`), force-closes the scope at once, and rejects `ready` with the same error. */
function runStartChain(
  layer: Layer,
  scope: Scope.Handle,
  exts: readonly Scope.Extension<unknown>[],
  done: () => void,
  failed: (error: unknown) => void,
): void {
  const at = async (index: number): Promise<void> => {
    if (index >= exts.length) return;
    const ext = exts[index];
    if (ext.start === undefined) return at(index + 1);
    const value = await ext.start(scope, new ExtensionCtx(layer, ext.label), () => at(index + 1));
    const rec = EXTENSIONS.get(layer)?.get(ext);
    if (rec !== undefined) {
      rec.value = value;
      rec.settled = true;
    }
  };
  ignoreRejection(
    at(0).then(done, (error: unknown) => {
      layer.failure ??= { cause: error };
      ignoreRejection(closeLayer(layer, true));
      failed(error);
    }),
  );
}

function emptyCtxFor(owner: Layer): Resource.Ctx {
  return (owner.emptyCtx ??= new EmptyCtx(owner));
}

/** The receiver an extension's `start` builds through (ADR 0050): `defer` lands in the layer's
 * defers like `onClose` but receives the settled end; `signal` is the layer's abort signal. One
 * instance per extension, labelled with the extension. */
class ExtensionCtx implements Resource.Ctx {
  readonly obs = OFF_OBS;
  readonly log = OFF_LOG;
  readonly clock: Clock.Handle;
  readonly random: Random.Handle;
  readonly label: string;
  private owner: Layer;
  constructor(owner: Layer, label: string) {
    this.owner = owner;
    this.label = label;
    this.clock = owner.clock;
    this.random = owner.random;
  }
  readonly defer = (fn: (end: Scope.End) => void | PromiseLike<void>): void => {
    this.owner.defers.push({ fn, instance: undefined });
  };
  get signal(): AbortSignal {
    return signalOf(this.owner);
  }
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
    instance.owner.pending.add(instance.completion);
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

function finishInstance(
  instance: ResourceInstance,
  prior?: Promise<void>,
): Promise<void> | undefined {
  if (
    !instance.end ||
    instance.finishing ||
    instance.building ||
    instance.dependents ||
    instance.borrowers?.size
  )
    return instance.completion;
  instance.finishing = true;
  const { owner } = instance;
  owner.defers = owner.defers.filter((entry) => entry.instance !== instance);
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
    owner.pending.add(queued);
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
  span: Observe.Span | undefined,
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
  span: Observe.Span | undefined,
): never {
  if (rec.gen === gen) detachResourceDependencies(owner, target, rec);
  settleResourceInstance(instance, "failed", error);
  closeSpan(obs, span, "failed");
  throw error;
}

const NOOP_BUILD_SETTLED = (): void => undefined;

function buildHooklessResource<T>(
  owner: Layer,
  target: Resource.Handle<T>,
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
): unknown {
  const gen = rec.gen;
  const superseded = (): boolean => rec.gen !== gen;
  const canPublish = (): boolean => !superseded() && !owner.closed;
  const obs = owner.obs;
  const span = openSpan(obs, parent, target.label, "resource");
  rec.building = true;
  buildDepth++;
  try {
    const deps = resolveResourceDeps(owner, target, span, superseded, chain, rec, undefined);
    const pending = parked;
    const ctx = emptyCtxFor(owner);
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
  target: Resource.Handle<T>,
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
): unknown {
  if (rec.building) raise("CircularResource", { label: target.label });
  if (
    (target as HookFlag)[mayHookSym] === false &&
    rec.instance === undefined &&
    !hasPresetLayers(owner)
  )
    return buildHooklessResource(owner, target, parent, chain, rec);
  return buildTrackedResource(owner, target, parent, chain, rec);
}

function buildTrackedResource<T>(
  owner: Layer,
  target: Resource.Handle<T>,
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined,
  rec: ResourceState,
): unknown {
  let instance: ResourceInstance | undefined;
  const gen = rec.gen;
  const superseded = (): boolean => rec.gen !== gen;
  const canPublish = (): boolean => !superseded() && !owner.closed;
  const obs = owner.obs;
  const span = openSpan(obs, parent, target.label, "resource");
  rec.building = true;
  let settled = false;
  buildDepth++;
  try {
    const override = presetFor(owner, target) as Resource.Handle<T>["factory"] | undefined;
    const fn = override ?? target.factory;
    instance = startBuildInstance(owner, target, rec, fn.length >= 2);
    const deps = resolveResourceDeps(
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
        ? buildCtx(instance as ResourceInstance, obs, span, () => settled)
        : emptyCtxFor(owner);
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
  span: Observe.Span | undefined,
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
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
): Scope.ResourceController<T> {
  const owner = ownerOf(layer, target);
  /** An ns-blind controller holds the owner's node record directly. A named controller selects
   * on each read because an earlier key in a fallback chain may be built after controller creation. */
  const rec = nodeState(owner, target);
  const named = hasResourceNs(target, chain);
  return {
    resolve: () => {
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

/** Select an existing named resource through the shared layers-first bucket walk. */
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
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined = layer.ns,
  selected?: SelectedResource,
): unknown {
  const owner = ownerOf(layer, target);
  const rec = nodeState(owner, target);
  ensureOpen(layer);
  ensureOpen(owner);
  recordUsed(layer.obs, parent, target);
  if (hasResourceNs(target, chain))
    return namedResourceSlot(owner, target, parent, chain, selected);
  selected?.(owner, target, rec);
  if (rec.resource) return rec.resource.value;
  if (rec.failed) return rec.failed.promise;
  if (rec.build) return rec.build;
  const buildChain = target.target === "scope" ? NO_NAMESPACE : chain;
  return buildResource(owner, target, parent, buildChain, rec);
}

function namedResourceSlot(
  owner: Layer,
  target: Resource.Handle<unknown>,
  parent: Observe.Span | undefined,
  chain: readonly [Namespace, ...Namespace[]],
  selected?: SelectedResource,
): unknown {
  const [head] = chain;
  const state = selectNsResource(owner, target, chain) ?? ownNsResource(owner, target, head);
  selected?.(owner, target, state);
  return readResourceState(owner, target, parent, chain, state);
}

function readResourceState(
  owner: Layer,
  target: Resource.Handle<unknown>,
  parent: Observe.Span | undefined,
  chain: readonly Namespace[] | undefined,
  state: ResourceState,
): unknown {
  if (state.resource) return state.resource.value;
  if (state.failed) return state.failed.promise;
  if (state.build) return state.build;
  if (state.building) raise("CircularResource", { label: target.label });
  return buildResource(owner, target, parent, chain, state);
}

type Affected = { node: Node; owner: Layer };

/** Unlink every occupied bucket at this owner and clear its selection state. */
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
  if (!rec?.nsDataDependents) return;
  for (const states of rec.nsDataDependents.values()) {
    for (const state of states) visit(state.target, state.owner);
  }
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
  const dataReleased = invalidateAffected(collectAffected(target, targetOwner), affected);
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
  const affected = collectNamedRelease(namedDataSeeds(rec, entry));
  rec.nsCells.delete(ns);
  rec.nsDataDependents?.delete(entry);
  drainRelease(affected, () => flushCell(owner, target));
}

function namedDataSeeds(rec: NodeState, entry: Entry): NsResourceState[] {
  return [...(rec.nsDataDependents?.get(entry) ?? [])];
}

function releaseNamedResource(owner: Layer, target: Resource.Handle<unknown>, ns: Namespace): void {
  const state = owner.nodes.get(target)?.nsResources?.get(ns);
  if (!state) return;
  const affected = collectNamedRelease([state]);
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

function collectNamedRelease(pending: NsResourceState[]): Map<Layer, Released> {
  const affected = new Map<Layer, Released>();
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

/** Remove one resource from every dependents set (its incoming edges), dropping empty sets. */
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
  const list: ResourceInstance[] = [];
  let settle: () => void = noop;
  const done = new Promise<void>((resolve) => (settle = resolve));
  return { list, done, settle };
}

function removeBorrow(instance: ResourceInstance, work: Promise<unknown>): void {
  instance.borrowers?.delete(work);
  finishTracked(instance);
}

/** Seed a layer's tag map from the authored bindings: nothing (or only nothing, however
 * nested) leaves the map unallocated; otherwise every binding lands in authored order. */
function seedTags(input: Tag.Bindings): Map<Tag.Handle<unknown>, unknown[]> | undefined {
  const bindings = readMany(input);
  if (bindings.length === 0) return undefined;
  const tags = new Map<Tag.Handle<unknown>, unknown[]>();
  for (const binding of bindings) {
    const list = tags.get(binding.tag) ?? [];
    list.push(binding.value);
    tags.set(binding.tag, list);
  }
  return tags;
}

function seedPresets(seeds: Many<Scope.Preset>): {
  nodes: Map<object, NodeState>;
  presets: Map<unknown, unknown> | undefined;
} {
  const nodes = new Map<object, NodeState>();
  let presets: Map<unknown, unknown> | undefined;
  for (const p of readMany(seeds)) {
    const node = p.node;
    if (isData(node)) {
      const s = new NodeState();
      s.cell = { value: admit(node.label, node.parse, p.replacement) };
      nodes.set(node, s);
    } else (presets ??= new Map()).set(node, p.replacement);
  }
  return { nodes, presets };
}

function clockFor(parent: Layer | undefined, options: Scope.Options | undefined): Clock.Handle {
  if (parent) return parent.clock;
  return options?.clock ?? systemClock;
}

function randomFor(parent: Layer | undefined, options: Scope.Options | undefined): Random.Handle {
  if (parent) return parent.random;
  return options?.random ?? systemRandom;
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

function makeLayer(parent: Layer | undefined, options?: Scope.Options): Layer {
  const tags = seedTags(options?.tags);
  const { nodes, presets } = seedPresets(options?.presets);
  const clock = clockFor(parent, options);
  const layer: Layer = {
    parent,
    children: new Set(),
    nodes,
    presets,
    tags,
    pending: new Set(),
    defers: [],
    resourceHolds: 0,
    aborted: false,
    abortReason: undefined,
    abort: undefined,
    cancelled: false,
    swept: false,
    bodyEnd: undefined,
    failure: undefined,
    descendantFailure: undefined,
    secondary: [],
    body: undefined,
    closed: false,
    closing: undefined,
    obs: parent ? parent.obs : makeObs(options?.observe, clock),
    clock,
    random: randomFor(parent, options),
    emptyCtx: undefined,
    ns: nsFor(parent, options),
  };
  if (parent) {
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
  }
  return layer;
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

function abortSubtree(root: Layer): void {
  const reason = root.aborted ? root.abortReason : makeCancelReason();
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
    layer.secondary.push(cause);
    return;
  } finally {
    exitTeardown(layer);
  }
  try {
    await pending;
  } catch (cause) {
    layer.secondary.push(cause);
  }
}

async function drainDefers(layer: Layer, entries: DeferEntry[], end: Scope.End): Promise<void> {
  for (let i = entries.length - 1; i >= 0; i--) await drainCloseEntry(layer, entries[i], end);
}

/** A layer's body end, classified at the moment the body settled (`bodyEnd`, attached at session
 * creation so the abort-state reflects whether the body was interrupted, not the later own-close
 * abort — Q5). A bodyless layer returns undefined (its outcome comes from the close request). */
function classifyBody(layer: Layer): Promise<Scope.Outcome | undefined> {
  return layer.bodyEnd ?? Promise.resolve(undefined);
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
  const owned = layer.failure ?? layer.descendantFailure;
  if (owned) {
    layer.failure ??= owned;
    return { status: "failed", error: owned.cause };
  }
  if (layer.cancelled) return { status: "cancelled" };
  return SUCCESS;
}

/** A best-effort outcome for a re-entrant close ack before the layer has settled: whatever real state
 * is already known (a recorded failure, then an interrupted body), else success. */
function bestEffort(layer: Layer): Scope.Outcome {
  if (layer.failure) return { status: "failed", error: layer.failure.cause };
  return layer.cancelled ? { status: "cancelled" } : SUCCESS;
}

/** Drive every currently-attached child to close (children first, awaited sequentially). The mode is
 * re-checked per child: once an EARLIER child's failure has been collected (pushed into this layer's
 * `descendantFailure` while we awaited it), the remaining children close FORCED so their resources roll
 * back too. Collection is NOT done here: each child's real failure + teardown errors flow up through
 * `finishLayer` (swept push), so a child that already finished and detached still reaches its ancestor. */
async function closeChildren(layer: Layer, force: boolean): Promise<void> {
  for (const child of Array.from(layer.children)) {
    await closeLayer(child, force || (layer.failure ?? layer.descendantFailure) !== undefined);
  }
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
    layer.failure === undefined &&
    layer.descendantFailure === undefined &&
    !closeWouldReenter(layer)
  );
}

/** O(1) close for an idle scope: mark closed, settle by mode (forced rolls back to `cancelled`, which
 * with nothing to roll back is just the status), detach from the parent, and let GC drop the layer —
 * skipping the async teardown protocol, the abort event dispatch, and `nodes.clear()`. */
function fastClose(layer: Layer, force: boolean): Promise<Scope.Result> {
  layer.closed = true;
  const forced = force || layer.aborted;
  let settled: Scope.Outcome = SUCCESS;
  if (forced) {
    markAborted(layer, layer.aborted ? layer.abortReason : makeCancelReason());
    layer.cancelled = true;
    settled = { status: "cancelled" };
  }
  if (layer.nsLinked) detachNsLinked(layer, layer.nsLinked);
  layer.parent?.children.delete(layer);
  layer.closing = Promise.resolve(buildResult(settled, layer, undefined));
  return layer.closing;
}

function closeLayer(layer: Layer, force = true): Promise<Scope.Result> {
  if (!layer.closing) {
    if (canFastClose(layer)) return tapSessionHooks(layer, fastClose(layer, force));
    layer.closed = true;
    layer.closing = startClose(layer, force);
  }
  /** A second/later close (any mode) returns the in-flight close's Result — the mode of the FIRST call
   * wins (no graceful→forced escalation in v1; force-close from the start if a hang is a concern). This
   * also means a session's automatic self-close does not override an in-progress explicit graceful
   * close (ADR 0028). */
  /** A `close()` re-entered from within this layer's (or an ancestor's) own teardown is a request-only
   * acknowledgement: return an already-resolved best-effort `Result` so it never waits on itself (no
   * hang, no throw — ADR 0026 Q3, 0027/0028). The real settled `Result` is `layer.closing`. */
  if (closeWouldReenter(layer)) {
    return Promise.resolve(buildResult(bestEffort(layer), layer, undefined));
  }
  return tapSessionHooks(layer, layer.closing);
}

/** Build the `close()` Result from the settled outcome, the layer's abort reason (for a cancel), and
 * the teardown errors — never throws (ADR 0027). */
function buildResult(
  settled: Scope.Outcome,
  layer: Layer,
  teardownErrors: readonly unknown[] | undefined,
): Scope.Result {
  if (settled.status === "failed")
    return { status: "failed", error: settled.error, teardownErrors };
  if (settled.status === "cancelled") {
    return { status: "cancelled", reason: layer.abortReason, teardownErrors };
  }
  return { status: "success", teardownErrors };
}

/** Run a layer's close (ADR 0028): sweep the subtree, classify the body, close children, join owned
 * work, settle by reality, drain defers, then re-settle (a late child failure can land during the
 * drain) and detach. Never throws — resolves to the `Result`. A layer already aborted by an ancestor's
 * FORCED close is itself being force-torn-down whatever its own close mode, so it rolls back. The sweep
 * is SYNCHRONOUS (at close-call time) so a child that finishes and detaches before this close's async
 * body runs is still marked `swept` and its failure/errors still collected. */
/** Whether a layer's teardown rolls its subtree back (resources see `cancelled`) rather than committing
 * gracefully: the close is forced, an ancestor already aborted it, or it is FAILING — a real failure
 * (body throw, or an already-recorded owned-work / descendant failure) rolls the subtree back even
 * under a graceful close (transaction-abort). */
function rollsBack(layer: Layer, forced: boolean, body: Scope.Outcome | undefined): boolean {
  return (
    forced || body?.status === "failed" || (layer.failure ?? layer.descendantFailure) !== undefined
  );
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

async function closeInstances(layer: Layer, settled: Scope.Outcome): Promise<void> {
  const instances = collectLayerInstances(layer);
  for (const instance of instances) unlinkInstance(instance, settled);
  await drainDefers(layer, [...layer.defers], settled);
  for (const instance of instances) {
    const finished = finishInstance(instance);
    if (finished) ignoreRejection(finished);
  }
  while (layer.pending.size) await Promise.all(layer.pending);
}

function startClose(layer: Layer, force: boolean): Promise<Scope.Result> {
  const forced = force || layer.aborted;
  markSwept(layer);
  const run = async (): Promise<Scope.Result> => {
    if (forced) abortSubtree(layer);
    const body = await classifyBody(layer);
    const rollback = rollsBack(layer, forced, body);
    /** A session settles cancelled iff its body was interrupted; a bodyless scope iff its teardown rolls
     * back (POSIX-style: forced rolls resources back, graceful commits) — a body that SUCCEEDED is never
     * cancelled by a forced self-close. */
    if (body ? body.status === "cancelled" : rollback) layer.cancelled = true;
    await closeChildren(layer, rollback);
    while (layer.pending.size) await Promise.all(layer.pending);
    const settled = settleOutcome(layer, body);
    await closeInstances(layer, settled);
    /** Re-settle once more: a late real failure (pushed up from a child whose cleanup was parked on a
     * gate) can land WHILE we await the defers; `settleOutcome` never downgrades a recorded failure, so
     * the result stays monotonic and a collecting ancestor still sees it. */
    const finalSettled = settleOutcome(layer, body);
    const teardownErrors = finishLayer(layer);
    return buildResult(finalSettled, layer, teardownErrors);
  };
  return Promise.resolve().then(run);
}

/** Detach the layer and clear all its state after teardown; returns the collected teardown errors
 * (in execution order) for `TeardownFailed`, or undefined if there were none. A layer swept by an
 * ancestor's close pushes its teardown errors + failure up to its parent as it detaches, so a
 * collecting ancestor gathers descendant results at any depth even when a descendant finished and
 * detached before the intervening scopes began their own close (F1 / grandchild). */
function finishLayer(layer: Layer): unknown[] | undefined {
  const teardownErrors = layer.secondary.length ? [...layer.secondary] : undefined;
  if (layer.nsLinked) detachNsLinked(layer, layer.nsLinked);
  const parent = layer.parent;
  if (parent) {
    parent.children.delete(layer);
    if (layer.swept) propagateSweptOutcome(layer, parent);
  }
  for (const s of layer.nodes.values()) s.eff = undefined;
  layer.nodes.clear();
  layer.presets = undefined;
  layer.tags = undefined;
  layer.pending.clear();
  layer.children.clear();
  layer.defers.length = 0;
  layer.secondary.length = 0;
  return teardownErrors;
}

function propagateSweptOutcome(layer: Layer, parent: Layer): void {
  for (const cause of layer.secondary) parent.secondary.push(cause);
  /** A descendant's settled failure goes to a SEPARATE slot ranked BELOW the parent's OWN failure
   * (body/owned-work): a real owned-work failure must still beat a failure a child merely inherited
   * from the close request (a wished `failed` echoed back down and up). First descendant wins. */
  if (layer.failure) parent.descendantFailure ??= layer.failure;
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

/** Run `body` in a child session of `parent`, then force-close it — `runSession` with the
 * body receiving the child layer directly (no handle→layer registry; ADR 0038). The public
 * `session()` passes `(child, handle) => fn(handle)`; a tagged call passes its own runner. When the
 * root installed `session` hooks (ADR 0051), the whole life runs inside their onion: `next()`
 * resolves with the close `Result`. No hooks means no wrapper — main's body below, inline, after one
 * root lookup. */
async function runSessionWith<R>(
  parent: Layer,
  options: Scope.Options | undefined,
  body: (child: Layer, handle: Scope.Handle) => R | PromiseLike<R>,
): Promise<R> {
  ensureOpen(parent);
  const sessions = sessionsFor(parent);
  if (sessions !== undefined) return runSessionWrapped(parent, options, body, sessions);
  const child = makeLayer(parent, options);
  const started = runBodyWith(child, body);
  child.body = started;
  child.bodyEnd = started.then(
    (): Scope.Outcome => (child.aborted ? { status: "cancelled" } : SUCCESS),
    (cause: unknown): Scope.Outcome =>
      isCancel(child, cause) ? { status: "cancelled" } : { status: "failed", error: cause },
  );
  const result = await bodyResult(started);
  /** `close()` never throws (ADR 0027/0028); it resolves to the actual settled `Result`. A session is
   * promise-style, so map that Result back to resolve/reject: a real failure or cancellation rejects
   * (with the cause / abort reason), a clean run resolves the body value; teardown errors aggregate
   * into `TeardownFailed` either way. The self-close is FORCED — the body is done, so any still-running
   * owned work is aborted rather than awaited; the body's own outcome decides success/cancelled. */
  const ended = await closeLayer(child, true);
  const teardownCauses = ended.teardownErrors ? [...ended.teardownErrors] : undefined;
  if (ended.status === "failed") settleSession(true, ended.error, teardownCauses);
  else if (ended.status === "cancelled") settleSession(true, ended.reason, teardownCauses);
  else settleSession(false, undefined, teardownCauses);
  return result as R;
}

/** A session under a root that installed `session` hooks: the whole life inside their onion. Cold
 * path only — the hooks' handles are built eagerly here, never on the unwrapped path above. The
 * body receives the same handle the hooks do, so a session created under a session stays wrapped. */
async function runSessionWrapped<R>(
  parent: Layer,
  options: Scope.Options | undefined,
  body: (child: Layer, handle: Scope.Handle) => R | PromiseLike<R>,
  sessions: readonly Scope.Extension<unknown>[],
): Promise<R> {
  const child = makeLayer(parent, options);
  const handle = withSessionCreate(handleFor(child), child, sessions);
  const wrapped = await sessionThrough(sessions, handle, () =>
    runSessionEnded(child, (c) => runBodyWithTo(c, handle, body)),
  );
  settleSessionEnded(wrapped.ended);
  return wrapped.result as R;
}

/** Find the root's `session` chain for a session created under `parent` (extensions are root-only,
 * ADR 0050): walk up to the root, one map lookup there. Undefined when no extension declares the
 * hook — the chain is stored only then. */
function sessionsFor(parent: Layer): readonly Scope.Extension<unknown>[] | undefined {
  let root = parent;
  while (root.parent !== undefined) root = root.parent;
  return SESSIONS.get(root);
}

/** A session's own life: run the body, force-close, keep the body's value beside the close `Result`.
 * `close()` never throws (ADR 0027/0028); the `Result` decides resolve/reject in
 * {@link settleSessionEnded}. The self-close is FORCED — the body is done, so any still-running
 * owned work is aborted rather than awaited; the body's own outcome decides success/cancelled. */
async function runSessionEnded<R>(
  child: Layer,
  start: (child: Layer) => Promise<R>,
): Promise<{ result: unknown; ended: Scope.Result }> {
  const started = start(child);
  child.body = started;
  child.bodyEnd = started.then(
    (): Scope.Outcome => (child.aborted ? { status: "cancelled" } : SUCCESS),
    (cause: unknown): Scope.Outcome =>
      isCancel(child, cause) ? { status: "cancelled" } : { status: "failed", error: cause },
  );
  const result = await bodyResult(started);
  const ended = await closeLayer(child, true);
  return { result, ended };
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

async function runSession<R>(
  parent: Layer,
  options: Scope.Options | undefined,
  fn: (scope: Scope.Handle) => R | PromiseLike<R>,
): Promise<R> {
  return runSessionWith(parent, options, (_child, handle) => fn(handle));
}

/** Start a session body with its handle, normalizing to a promise. `fn` is called synchronously
 * (no extra adoption microtask) so an already-settled value/promise settles `bodyEnd` before a
 * later abort, letting the body's OWN end reflect whether the BODY was interrupted (an aborted
 * body → cancelled) rather than a subsequent self-close abort. A sync throw becomes a rejection. */
function runBodyWith<R>(
  child: Layer,
  fn: (child: Layer, handle: Scope.Handle) => R | PromiseLike<R>,
): Promise<R> {
  try {
    return Promise.resolve(fn(child, handleFor(child)));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** {@link runBodyWith} with a prebuilt handle — the wrapped session path hands the body the same
 * handle the hooks received (whose `createSession` stays wrapped). */
function runBodyWithTo<R>(
  child: Layer,
  handle: Scope.Handle,
  fn: (child: Layer, handle: Scope.Handle) => R | PromiseLike<R>,
): Promise<R> {
  try {
    return Promise.resolve(fn(child, handle));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** A handle whose `createSession` wraps every child in the root's `session` chain (ADR 0051): the
 * one override sessions carry — `resolve`/`run`/`controller` stay the plain dispatch (v1 limit).
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
  SESSION_SETTLERS.set(child, settleNext);
  const base = withSessionCreate(plain, child, sessions);
  const outcome = sessionThrough(sessions, base, () =>
    nextPromise.then((ended) => ({ result: undefined, ended })),
  );
  ignoreRejection(outcome);
  wrapped = {
    ...base,
    close: (opts?: Scope.CloseOptions) =>
      closeLayer(child, !opts?.graceful).then(() => outcome.then(({ ended: chained }) => chained)),
  };
  return wrapped;
}

/** The session body's value, or undefined if it rejected — the body's end (success/failed/cancelled)
 * is classified authoritatively by `startClose` via `classifyBody` (ADR 0026). */
async function bodyResult<R>(body: Promise<R>): Promise<R | undefined> {
  try {
    return await body;
  } catch {
    return undefined;
  }
}

/** Wrap a plain root handle with the extensions' plumbing (ADR 0050): store one
 * start-value record per installed extension, override `close` with the close chain, add `ready`,
 * then kick the start chain with the EXTENDED handle. Cold path only — plain scopes never enter. */
function extendHandle(
  layer: Layer,
  plain: Scope.Handle,
  exts: readonly Scope.Extension<unknown>[],
): Scope.Handle {
  const records = new Map<Scope.Extension<unknown>, ExtRec>();
  for (const ext of exts) records.set(ext, { settled: false, value: undefined });
  EXTENSIONS.set(layer, records);
  const closers = exts.filter((ext) => ext.close !== undefined);
  const resolvers = exts.filter((ext) => ext.resolve !== undefined);
  const runners = exts.filter((ext) => ext.run !== undefined);
  const writers = exts.filter((ext) => ext.write !== undefined);
  const sessions = exts.filter((ext) => ext.session !== undefined);
  if (sessions.length > 0) SESSIONS.set(layer, sessions);
  let settleReady: () => void = noop;
  let failReady: (error: unknown) => void = noop;
  const ready = new Promise<void>((resolveReady, rejectReady) => {
    settleReady = resolveReady;
    failReady = rejectReady;
  });
  ignoreRejection(ready);
  const extended: Scope.Handle = {
    ...plain,
    close: closers.length === 0 ? plain.close : closeThrough(layer, closers),
    ready,
  };
  if (resolvers.length > 0) extended.resolve = resolveThrough(layer, resolvers);
  if (runners.length > 0) extended.run = runThrough(layer, runners, plain);
  if (writers.length > 0) extended.controller = writeThrough(layer, writers, plain);
  if (sessions.length > 0)
    extended.createSession = (options?: Scope.Options) => wrapSession(layer, options, sessions);
  runStartChain(layer, extended, exts, settleReady, failReady);
  return extended;
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
    const { resolve: hook } = resolvers[index] as {
      resolve?: (target: OnionTarget, next: () => unknown) => unknown;
    };
    if (hook === undefined) return next();
    return hook(target, next);
  };
  const chained = (target: OnionTarget, ns?: Scope.NsArg): unknown => {
    ensureOpen(layer);
    if (isExtension(target)) return resolveExtension(layer, target);
    const chain = ns?.ns === undefined ? layer.ns : nsChainOf(ns.ns);
    return at(target, 0, chain);
  };
  return chained as Scope.Handle["resolve"];
}

/** The `run` onion (ADR 0050, core/t34): registration order, first is outermost. The innermost
 * `next` is the plain handle's `run`, so declared operations and inline configs keep today's path,
 * including the tagged-call child session; `call` passes through unchanged. A hook that skips
 * `next` refuses the call. Root handle only in v1: sessions keep the plain dispatch. */
function runThrough(
  layer: Layer,
  runners: readonly Scope.Extension<unknown>[],
  plain: Scope.Handle,
): Scope.Handle["run"] {
  type OnionOp = Operation.Handle<unknown, unknown> | Scope.Inline<Scope.Depends, unknown, unknown>;
  type OnionCall = Scope.Invocation<unknown> | undefined;
  /** One cast: read the overloaded `run` as a plain function property, so the chain holds a callable instead of an unbound method. */
  const plainView = plain as { readonly run: (op: OnionOp, call?: OnionCall) => unknown };
  const at = (op: OnionOp, call: OnionCall, index: number): unknown => {
    if (index >= runners.length) return plainView.run(op, call);
    const next = (): unknown => at(op, call, index + 1);
    const { run: hook } = runners[index] as {
      run?: (op: OnionOp, call: OnionCall, next: () => unknown) => unknown;
    };
    if (hook === undefined) return next();
    return hook(op, call, next);
  };
  const chained = (op: OnionOp, call?: OnionCall): unknown => {
    ensureOpen(layer);
    return at(op, call, 0);
  };
  return chained as Scope.Handle["run"];
}

/** A namespaced resolve keeps the real layer and passes the storage chain explicitly. */
function resolveNs(layer: Layer, target: unknown, chain: readonly Namespace[]): unknown {
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
  if (isData(target)) return dataControllerNs(layer, target, chain);
  if (isResource(target)) return resourceController(layer, target, undefined, chain);
  return operationController(layer, target, undefined, chain);
}

function handleFor(layer: Layer): Scope.Handle {
  const settled = async (): Promise<void> => {
    while (layer.pending.size) await Promise.all(layer.pending);
  };
  const controllerOf = (
    target: Data.Cell<unknown> | Resource.Handle<unknown> | Operation.Handle<unknown, unknown>,
  ): unknown => {
    const s = nodeState(layer, target);
    if (s.controller) return s.controller;
    const ctl = isData(target)
      ? layer.ns !== undefined
        ? dataControllerNs(layer, target, layer.ns)
        : dataController(layer, target)
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
    ensureOpen(layer);
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
    if (!isOperation(op)) return runInline(op as Scope.Inline<Scope.Depends, T, I>, call);
    return (controllerOf(op) as { run(call?: Scope.Invocation<I>): T }).run(call);
  }) as Scope.Handle["run"];
  /** Run an inline config (ADR 0037): a throwaway `Operation.Handle` through the operation
   * controller path — one handle + one controller per call, nothing cached in the layer
   * (no `nodeState`/`controllerOf` residue). `input` lands on `ctx.input`/`ctx.rawInput`
   * unchanged (no parse); `tags` open the run's child session exactly as for a declared
   * operation (ADR 0038). Discrimination is the brand only. */
  const runInline = <R, I>(
    inline: Scope.Inline<Scope.Depends, R, I>,
    call: Scope.Invocation<I> | undefined,
  ): R | Promise<Awaited<R>> => {
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
    const dispatch = operationController(layer, handle, undefined).run as (
      call?: Scope.Invocation<I>,
    ) => R | Promise<Awaited<R>>;
    return call === undefined ? dispatch() : dispatch(call);
  };
  return {
    controller,
    resolve,
    run,
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
    release: (target: Data.Cell<unknown> | Resource.Handle<unknown>) => releaseNode(layer, target),
    releaseNs: (target: Data.Cell<unknown> | Resource.Handle<unknown>, ns: Namespace) =>
      releaseNamed(layer, target, ns),
    spans: () => layer.obs.history.slice(),
    onClose: (fn: () => void | PromiseLike<void>) => {
      ensureOpen(layer);
      layer.defers.push({ fn: () => fn(), instance: undefined });
    },
    settled,
    close: (opts?: Scope.CloseOptions) => closeLayer(layer, !opts?.graceful),
    ready: READY,
  };
}

/** Create a scope: the root of a layer chain that reads, controls, and runs cells, resources, tags, and operations. */
export function createScope(options?: Scope.Options): Scope.Handle {
  const layer = makeLayer(undefined, options);
  const plain = handleFor(layer);
  const exts = readMany(options?.extensions);
  if (exts.length === 0) return plain;
  return extendHandle(layer, plain, exts);
}

export { isError };
export type { Errors } from "./errors.ts";
