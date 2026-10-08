import type { Data, Namespace, Observe, Operation, Resource, RunResult, Scope } from "@tinker/core";
import type { ReactNode } from "react";
import {
  createContext,
  createElement,
  use,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { raise } from "./errors";

export { isError } from "./errors";
export type { Errors } from "./errors";

const ScopeContext = createContext<Scope.Handle | undefined>(undefined);
const NamespaceContext = createContext<Namespace | undefined>(undefined);

/** Start a scope's teardown without awaiting; a scope owns its own shutdown and never throws
 * (ADR 0027), so the unmounting subtree does not wait on the result. */
function closeScope(scope: Scope.Handle): void {
  return void scope.close();
}

/** The stable no-selector fallback for {@link useData}: a module constant so the selector handed to
 * the store keeps a stable identity across renders (a fresh closure would defeat its memoization). */
const identity = <V>(value: V): V => value;

/** Props for {@link ScopeProvider}: either an app-owned `scope` (the app closes it), or a `create`
 * factory the provider owns and closes on unmount. Exactly one. */
export type ScopeProviderProps =
  | { readonly scope: Scope.Handle; readonly create?: never; readonly children: ReactNode }
  | { readonly create: () => Scope.Handle; readonly scope?: never; readonly children: ReactNode };

/** Own a created scope for a subtree: create it in an effect (never during render, so a discarded
 * or StrictMode-replayed render leaks nothing), publish it to children only once it exists, and
 * close exactly that scope on unmount. StrictMode's mount→unmount→mount makes a fresh scope for
 * each live mount and never leaves a closed scope on context for a consumer to touch (ADR 0031). */
function OwnedScopeProvider(props: {
  readonly create: () => Scope.Handle;
  readonly children: ReactNode;
}): ReactNode {
  const createRef = useRef(props.create);
  createRef.current = props.create;
  const [scope, setScope] = useState<Scope.Handle | undefined>(undefined);
  useEffect(() => {
    const owned = createRef.current();
    setScope(owned);
    return () => {
      setScope(undefined);
      closeScope(owned);
    };
  }, []);
  if (scope === undefined) return null;
  return createElement(ScopeContext.Provider, { value: scope, children: props.children });
}

/** Put a `@tinker/core` scope on React context for the subtree. Hooks resolve against the nearest
 * provider's scope. This independent scope clears an outer React session's reset key. */
export function ScopeProvider(props: ScopeProviderProps): ReactNode {
  return createElement(NamespaceContext.Provider, {
    value: undefined,
    children:
      props.scope !== undefined
        ? createElement(ScopeContext.Provider, { value: props.scope, children: props.children })
        : createElement(OwnedScopeProvider, { create: props.create, children: props.children }),
  });
}

/** Open a child session for a subtree: created on mount from the nearest scope, force-closed on
 * unmount — a React subtree's mount lifetime IS a session lifetime (ADR 0031). Hooks under it resolve
 * against the session (the nearest `Handle`), so a `data` write is shadowed and does not reach the
 * parent. Created in an effect (StrictMode-safe, like {@link ScopeProvider}'s `create` mode): a
 * discarded or replayed mount closes its own session and the next live mount opens a fresh one. The
 * session is published paired with the parent it belongs to; if the nearest scope changes, the old
 * session is never exposed for the new parent (render null until the effect opens a fresh one).
 * The reset namespace head is saved with this session, including an inherited key.
 * `options` apply when the session is created — changing them for the same parent has no effect until
 * the provider remounts. */
export function SessionProvider(props: {
  readonly children: ReactNode;
  readonly options?: Scope.Options;
}): ReactNode {
  const parent = useScope();
  const inherited = useContext(NamespaceContext);
  const optionsRef = useRef(props.options);
  optionsRef.current = props.options;
  const [owned, setOwned] = useState<
    { parent: Scope.Handle; session: Scope.Handle; ns?: Namespace } | undefined
  >(undefined);
  useEffect(() => {
    const options = optionsRef.current;
    const session = parent.createSession(options);
    const ns = options?.ns;
    const [head] = ns === undefined ? [inherited] : "tags" in ns ? [ns] : ns;
    setOwned({ parent, session, ns: head });
    return () => {
      setOwned(undefined);
      closeScope(session);
    };
  }, [parent, inherited]);
  if (owned === undefined || owned.parent !== parent) return null;
  return createElement(NamespaceContext.Provider, {
    value: owned.ns,
    children: createElement(ScopeContext.Provider, {
      value: owned.session,
      children: props.children,
    }),
  });
}

/** Read the nearest scope `Handle`. Raises `NoProvider` when used outside a {@link ScopeProvider}. */
export function useScope(): Scope.Handle {
  const scope = useContext(ScopeContext);
  if (!scope) raise("NoProvider", { hook: "useScope" });
  return scope;
}

export declare namespace UseData {
  /** Options for {@link useData}: `writable` returns `[value, set]` (a `useState`-like pair) instead
   * of the bare value; `isEqual` compares selected slices (default `Object.is`). */
  export type Options<S> = {
    readonly isEqual?: (a: S, b: S) => boolean;
    readonly writable?: boolean;
  };
  /** The pair `useData(cell, { writable: true })` returns: the (selected) value and the cell's `set`. */
  export type Pair<T, S> = readonly [value: S, set: (value: T) => void];
}

/** Reactively read a `data` cell: returns its current value and re-renders when it changes. */
export function useData<T>(cell: Data.Cell<T>): T;

/** Reactively read a slice of a `data` cell: returns `selector(value)` and re-renders only when the
 * slice changes (`isEqual`, default `Object.is`). Lets a component subscribe to part of a cell. */
export function useData<T, S>(
  cell: Data.Cell<T>,
  selector: (value: T) => S,
  isEqual?: (a: S, b: S) => boolean,
): S;

export function useData<T>(
  cell: Data.Cell<T>,
  options: UseData.Options<T> & { readonly writable: true },
): UseData.Pair<T, T>;

/** Read a slice and write the whole cell: `[selector(value), set]`. */
export function useData<T, S>(
  cell: Data.Cell<T>,
  selector: (value: T) => S,
  options: UseData.Options<S> & { readonly writable: true },
): UseData.Pair<T, S>;

export function useData<T, S>(
  cell: Data.Cell<T>,
  a?: ((value: T) => S) | UseData.Options<T>,
  b?: ((a: S, b: S) => boolean) | UseData.Options<S>,
): T | S | UseData.Pair<T, T | S> {
  const selector = typeof a === "function" ? a : undefined;
  const options = typeof a === "function" ? (typeof b === "function" ? undefined : b) : a;
  const isEqual = typeof b === "function" ? b : options?.isEqual;
  const writable = options?.writable === true;
  const store = useDataStore(cell, selector, isEqual);
  const value = useSyncExternalStore(store.subscribe, store.read, store.read);
  return writable ? [value, store.set] : value;
}

function useDataStore<T, S>(
  cell: Data.Cell<T>,
  selector: ((value: T) => S) | undefined,
  isEqual: ((a: T, b: T) => boolean) | ((a: S, b: S) => boolean) | undefined,
): DataStore<T, T | S> {
  const controller = useScope().controller(cell);
  const own = useRef<SelectingStore<T, S> | undefined>(undefined);
  if (selector === undefined && isEqual === undefined) {
    return (rawStores.get(controller) as DataStore<T, T> | undefined) ?? createRawStore(controller);
  }
  const kept = own.current;
  const store =
    kept !== undefined && kept.controller === controller
      ? kept
      : (own.current = createDataStore<T, S>(controller));
  store.select = selector ?? (identity as (value: T) => S);
  store.equal = (isEqual ?? Object.is) as (a: S, b: S) => boolean;
  return store;
}

/** What `useSyncExternalStore` needs from a cell, plus the write half of the writable pair. */
type DataStore<T, S> = {
  subscribe: (notify: () => void) => () => void;
  read: () => S;
  set: (value: T) => void;
};

/** Raw and selected stores keep the same fields in the same order at the hook's read sites.
 * A selector's cached slice belongs to its component; raw stores are shared per controller. */
type SelectingStore<T, S> = DataStore<T, S> & {
  controller: Scope.DataController<T>;
  select: (value: T) => S;
  equal: (a: S, b: S) => boolean;
};

const rawStores = new WeakMap<object, DataStore<never, unknown>>();

/** Only a cache miss creates these closures. Core keeps each controller stable, and the
 * WeakMap lets its raw store go when the scope no longer retains that controller. */
function createRawStore<T>(controller: Scope.DataController<T>): DataStore<T, T> {
  const store: SelectingStore<T, T> = {
    controller,
    select: identity,
    equal: Object.is,
    subscribe: (notify) => controller.watch(notify),
    read: () => controller.get(),
    set: (value) => controller.set(value),
  };
  rawStores.set(controller, store);
  return store;
}

function createDataStore<T, S>(controller: Scope.DataController<T>): SelectingStore<T, S> {
  let memo:
    | { raw: T; slice: S; select: (value: T) => S; equal: (a: S, b: S) => boolean }
    | undefined = undefined;
  const store: SelectingStore<T, S> = {
    controller,
    select: identity as (value: T) => S,
    equal: Object.is,
    subscribe: (notify: () => void) => controller.watch(notify),
    read: (): S => {
      const raw = controller.get();
      const prev = memo;
      if (prev !== undefined && prev.select === store.select && prev.equal === store.equal) {
        if (Object.is(prev.raw, raw)) return prev.slice;
        const slice = store.select(raw);
        const kept = store.equal(prev.slice, slice) ? prev.slice : slice;
        prev.raw = raw;
        prev.slice = kept;
        prev.select = store.select;
        prev.equal = store.equal;
        return kept;
      }
      const fresh = store.select(raw);
      if (prev === undefined) {
        memo = { raw, slice: fresh, select: store.select, equal: store.equal };
      } else {
        prev.raw = raw;
        prev.slice = fresh;
        prev.select = store.select;
        prev.equal = store.equal;
      }
      return fresh;
    },
    set: (value: T) => controller.set(value),
  };
  return store;
}

/** The nearest scope's read/write controller for a `data` cell (`get`/`set`/`update`/`watch`).
 * For writes: a component that only holds a controller subscribes to nothing, so a write-only view
 * never re-renders when the cell changes. Read reactively with {@link useData} instead. */
export function useController<T>(cell: Data.Cell<T>): Scope.DataController<T> {
  return useScope().controller(cell);
}

type Outcome<T> =
  | { readonly ok: true; readonly value: T; readonly error?: never }
  | { readonly ok: false; readonly error: unknown; readonly value?: never };

export declare namespace Query {
  /** `suspense: false` renders local query state. `ns` selects the same named bucket for reads
   * and refetch. Without it, the scope's ambient namespace supplies reads and a React session
   * supplies the reset key when known. */
  export type Options = { readonly suspense?: boolean; readonly ns?: Namespace };
  /** The build state of a resource read with `{ suspense: false }`: a synchronous build is `success`
   * at once; an async build is `pending` until it settles; a failed build stays `error` until
   * `refetch` clears the selected bucket. The next read can build a fresh generation or reuse
   * a fallback that remains in the namespace chain. */
  export type State<T> =
    | { readonly status: "pending"; readonly data: undefined; readonly error: undefined }
    | { readonly status: "success"; readonly data: T; readonly error: undefined }
    | { readonly status: "error"; readonly data: undefined; readonly error: unknown };
  export type Handle<T> = State<T> & {
    readonly isPending: boolean;
    readonly isSuccess: boolean;
    readonly isError: boolean;
    readonly refetch: () => void;
  };
}

const QUERY_OPTIONS: Query.Options = {};

/** Query snapshots belong to one resource owner and stay unchanged until their visible state changes. */
class ResourceOwner<T> {
  scope: Scope.Handle;
  handle: Resource.Handle<T>;
  ns: Namespace | undefined;
  private force: () => void;
  controller: Scope.ResourceController<T>;
  inherited: Namespace | undefined = undefined;
  pending: Promise<Awaited<T>> | undefined = undefined;
  private settledKey: Promise<Awaited<T>> | undefined = undefined;
  private settled: Query.State<Awaited<T>> | undefined = undefined;
  private cached: Query.Handle<Awaited<T>> | undefined = undefined;

  constructor(
    scope: Scope.Handle,
    handle: Resource.Handle<T>,
    ns: Namespace | undefined,
    force: () => void,
  ) {
    this.scope = scope;
    this.handle = handle;
    this.ns = ns;
    this.force = force;
    this.controller = scope.controller(handle, ns === undefined ? undefined : { ns });
  }

  private refetch = (): void => {
    const selected = this.ns ?? this.inherited;
    if (selected === undefined || this.handle.target === "scope") this.scope.release(this.handle);
    else this.scope.releaseNs(this.handle, selected);
    this.force();
  };

  effect = (): (() => void) | undefined => {
    const pending = this.pending;
    if (pending === undefined) return;
    const observer: { live: boolean; work: Promise<void> | undefined } = {
      live: true,
      work: undefined,
    };
    observer.work = pending.then(
      (data) => {
        observer.work = undefined;
        if (observer.live) this.publish(pending, { status: "success", data, error: undefined });
      },
      (error: unknown) => {
        observer.work = undefined;
        if (observer.live) this.publish(pending, { status: "error", data: undefined, error });
      },
    );
    return () => {
      observer.live = false;
      observer.work = undefined;
    };
  };

  private publish(key: Promise<Awaited<T>>, state: Query.State<Awaited<T>>): void {
    this.settledKey = key;
    this.settled = state;
    this.force();
  }

  query(
    failed: boolean,
    error: unknown,
    value: Scope.ResourceValue<T> | undefined,
    pending: Promise<Awaited<T>> | undefined,
  ): Query.Handle<Awaited<T>> {
    if (failed) return this.snapshot("error", undefined, error);
    if (pending === undefined) return this.snapshot("success", value as Awaited<T>, undefined);
    const done = this.settledKey === pending ? this.settled : undefined;
    if (done === undefined) return this.snapshot("pending", undefined, undefined);
    return this.snapshot(done.status, done.data, done.error);
  }

  private snapshot(
    status: Query.State<T>["status"],
    data: Awaited<T> | undefined,
    err: unknown,
  ): Query.Handle<Awaited<T>> {
    const cached = this.cached;
    if (
      cached !== undefined &&
      cached.status === status &&
      Object.is(cached.data, data) &&
      Object.is(cached.error, err)
    )
      return cached;
    return (this.cached = {
      status,
      data,
      error: err,
      isPending: status === "pending",
      isSuccess: status === "success",
      isError: status === "error",
      refetch: this.refetch,
    } as Query.Handle<Awaited<T>>);
  }
}

/** Read a resource's built value from the nearest scope. A synchronously-built resource returns its
 * value directly (no promise). An async build suspends: the promise is handed to React's `use`, so a
 * `<Suspense>` fallback shows while pending and the value renders once it settles. Core builds once
 * per owner and returns the same promise on every resolve (including a rejected build, which stays
 * until release), so a Suspense retry reuses that promise rather than rebuilding (ADR 0032).
 * With `{ suspense: false }` nothing suspends or throws: the hook returns a react-query-like
 * `{ status, data, error, isPending, isSuccess, isError, refetch }` for a local loading state.
 * An explicit `ns` selects both reads and refetch; otherwise refetch uses the React session's
 * saved head when known. Clearing a head leaves fallback buckets intact, so the next read may
 * reuse a fallback. Shared scope resources retain their broad release (see {@link useRelease}). */
export function useResource<T>(
  handle: Resource.Handle<T>,
  options?: { suspense?: true; ns?: Namespace },
): Awaited<T>;

export function useResource<T>(
  handle: Resource.Handle<T>,
  options: { suspense: false; ns?: Namespace },
): Query.Handle<Awaited<T>>;

export function useResource<T>(
  handle: Resource.Handle<T>,
  options: Query.Options = QUERY_OPTIONS,
): Awaited<T> | Query.Handle<Awaited<T>> {
  const scope = useScope();
  const inherited = useContext(NamespaceContext);
  const ns = options.ns;
  const [, force] = useReducer(RunOwner.bump, 0);
  const ref = useRef<ResourceOwner<T> | undefined>(undefined);
  let owner = ref.current;
  if (owner === undefined || owner.scope !== scope || owner.handle !== handle || owner.ns !== ns)
    owner = ref.current = new ResourceOwner(scope, handle, ns, force);
  owner.inherited = inherited;
  return useResolvedResource(owner, options.suspense === false);
}

function useResolvedResource<T>(
  owner: ResourceOwner<T>,
  local: boolean,
): Awaited<T> | Query.Handle<Awaited<T>> {
  let value: Scope.ResourceValue<T> | undefined;
  let error: unknown;
  let failed = false;
  try {
    value = owner.controller.resolve();
  } catch (caught) {
    error = caught;
    failed = true;
  }
  const pending = value instanceof Promise ? (value as Promise<Awaited<T>>) : undefined;
  owner.pending = local ? pending : undefined;
  useSettled(owner);
  if (local) return owner.query(failed, error, value, pending);
  if (failed) throw error;
  return pending ? use(pending) : (value as Awaited<T>);
}

/** Detaching a resource owner or changing its promise stops the old observer from publishing. */
function useSettled<T>(owner: ResourceOwner<T>): void {
  useEffect(owner.effect, [owner, owner.pending]);
}

export declare namespace Run {
  /** The call a run was made with: the first argument of {@link useRun}'s `run`. */
  export type Variables<I> = Scope.CallArgs<I>[0];
  /** The settled state of the latest {@link useRun} run, shaped like a react-query mutation:
   * `status` plus `data`/`error`/`variables` and one boolean per status. */
  export type State<T, I> =
    | {
        readonly status: "idle";
        readonly data: undefined;
        readonly error: undefined;
        readonly variables: undefined;
      }
    | {
        readonly status: "pending";
        readonly data: undefined;
        readonly error: undefined;
        readonly variables: Variables<I>;
      }
    | {
        readonly status: "success";
        readonly data: T;
        readonly error: undefined;
        readonly variables: Variables<I>;
      }
    | {
        readonly status: "error";
        readonly data: undefined;
        readonly error: unknown;
        readonly variables: Variables<I>;
      };
  /** Hook-level callbacks, fired for every run when it settles (success, failure, then either way). */
  export type Options<T, I> = {
    readonly onSuccess?: (data: T, variables: Variables<I>) => void;
    readonly onError?: (error: unknown, variables: Variables<I>) => void;
    readonly onSettled?: (data: T | undefined, error: unknown, variables: Variables<I>) => void;
  };
  /** What {@link useRun} returns: the current {@link State}, one boolean per status, and the
   * imperative `run` (fire-and-forget: the outcome lands in state), `runAsync` (returns the
   * value, rejects with the failure — for callers that need the result in a handler) and `reset`. */
  export type Handle<T, I> = State<T, I> & {
    readonly isIdle: boolean;
    readonly isPending: boolean;
    readonly isSuccess: boolean;
    readonly isError: boolean;
    readonly run: (...call: Scope.CallArgs<I>) => void;
    readonly runAsync: (...call: Scope.CallArgs<I>) => Promise<T>;
    readonly reset: () => void;
  };
}

function settledState<T>(outcome: Outcome<T>): Query.State<T> {
  return outcome.ok
    ? { status: "success", data: outcome.value, error: undefined }
    : { status: "error", data: undefined, error: outcome.error };
}

function readRunOutcome<T>(result: RunResult<T>): Outcome<T> {
  return result.status === "success"
    ? { ok: true, value: result.value }
    : { ok: false, error: result.status === "failed" ? result.error : result.reason };
}

function notify<T, I>(
  on: Run.Options<T, I> | undefined,
  outcome: Outcome<T>,
  variables: Run.Variables<I>,
): void {
  if (!on) return;
  try {
    if (outcome.ok) on.onSuccess?.(outcome.value, variables);
    else on.onError?.(outcome.error, variables);
  } catch (error) {
    reportCallbackError(error);
  }
  try {
    on.onSettled?.(outcome.value, outcome.error, variables);
  } catch (error) {
    reportCallbackError(error);
  }
}

/** Callback failures belong to the host's error reporting, not the operation's outcome. */
function reportCallbackError(error: unknown): void {
  if (typeof reportError === "function") reportError(error);
  else
    queueMicrotask(() => {
      throw error;
    });
}

/** Each committed hook owns its view; old calls keep their result but lose publication on detach. */
class RunOwner<T, I> {
  private static idle = {
    status: "idle",
    data: undefined,
    error: undefined,
    variables: undefined,
  } as const;

  static bump(this: void, n: number): number {
    return n + 1;
  }

  scope: Scope.Handle;
  op: Operation.Handle<T, I>;
  private controller: Scope.OperationController<T, I>;
  private force: () => void;
  private live = false;
  private runId = 0;
  options: Run.Options<Awaited<T>, I> | undefined = undefined;
  private state: Run.State<Awaited<T>, I> = RunOwner.idle;
  private cached: Run.Handle<Awaited<T>, I> | undefined = undefined;

  constructor(scope: Scope.Handle, op: Operation.Handle<T, I>, force: () => void) {
    this.scope = scope;
    this.op = op;
    this.controller = scope.controller(op);
    this.force = force;
  }

  attach = (): (() => void) => {
    this.live = true;
    if (this.state !== RunOwner.idle) this.publish(RunOwner.idle);
    return () => {
      this.live = false;
    };
  };

  private run = (...call: Scope.CallArgs<I>): void => {
    const outcome = this.invoke(call);
    if (outcome instanceof Promise) outcome.catch(reportCallbackError);
  };

  private runAsync = async (...call: Scope.CallArgs<I>): Promise<Awaited<T>> => {
    const running = this.invoke(call);
    const outcome = running instanceof Promise ? await running : running;
    if (outcome.ok) return outcome.value;
    throw outcome.error;
  };

  private reset = (): void => {
    this.runId += 1;
    if (this.live) this.publish(RunOwner.idle);
  };

  private publish(state: Run.State<Awaited<T>, I>): void {
    this.state = state;
    this.cached = undefined;
    this.force();
  }

  private finish(
    id: number,
    result: RunResult<Awaited<T>>,
    variables: Run.Variables<I>,
  ): Outcome<Awaited<T>> {
    const outcome = readRunOutcome(result);
    if (this.live) {
      if (this.runId === id) this.publish({ ...settledState(outcome), variables });
      notify(this.options, outcome, variables);
    }
    return outcome;
  }

  private invoke(call: Scope.CallArgs<I>): Outcome<Awaited<T>> | Promise<Outcome<Awaited<T>>> {
    const id = (this.runId += 1);
    const [variables] = call;
    const result = this.controller.settle(...call);
    if (!(result instanceof Promise)) return this.finish(id, result, variables);
    if (this.live && this.runId === id)
      this.publish({ status: "pending", data: undefined, error: undefined, variables });
    return result.then((settled) => this.finish(id, settled, variables));
  }

  handle(): Run.Handle<Awaited<T>, I> {
    const state = this.state;
    return (this.cached ??= {
      status: state.status,
      data: state.data,
      error: state.error,
      variables: state.variables,
      isIdle: state.status === "idle",
      isPending: state.status === "pending",
      isSuccess: state.status === "success",
      isError: state.status === "error",
      run: this.run,
      runAsync: this.runAsync,
      reset: this.reset,
    } as Run.Handle<Awaited<T>, I>);
  }
}

/** Run an operation imperatively (a mutation): never suspends. Shaped like react-query's
 * `useMutation`: `run(input)` fires and forgets (the outcome lands in `status`/`data`/`error`
 * with `variables` = the call), `runAsync(input)` also returns the value or rejects, `reset()`
 * returns to idle. A rejection never reaches an error boundary (that is {@link useResource}'s job).
 * Only the latest run publishes state: a slower earlier run that settles after a newer one (or after
 * `reset`) is dropped, though its `options` callbacks still fire. Changing the provider or operation
 * clears the view and stops the old owner's state and callback writes; its caller still gets the result.
 * Handled failures are received through Core's `settle`, so a panic does not fail the owner. */
export function useRun<T, I>(
  op: Operation.Handle<T, I>,
  options?: Run.Options<Awaited<T>, I>,
): Run.Handle<Awaited<T>, I> {
  const scope = useScope();
  const [, force] = useReducer(RunOwner.bump, 0);
  const ref = useRef<RunOwner<T, I> | undefined>(undefined);
  let owner = ref.current;
  if (owner === undefined || owner.scope !== scope || owner.op !== op)
    owner = ref.current = new RunOwner(scope, op, force);
  owner.options = options;
  useLayoutEffect(owner.attach, [owner]);
  return owner.handle();
}

/** Reset a node in an explicit namespace, or the nearest React session's saved namespace head.
 * Clearing a head can expose a fallback; fallback keys remain intact. Scope-target resources and
 * calls with no known key retain Core's broad release. Opaque app-owned scope namespaces need an
 * explicit key, since a Core handle does not expose its ambient namespace. */
export function useRelease(
  ns?: Namespace,
): (node: Data.Cell<unknown> | Resource.Handle<unknown>) => void {
  const scope = useScope();
  const inherited = useContext(NamespaceContext);
  const selected = ns ?? inherited;
  return useCallback(
    (node) => {
      if (selected === undefined || ("target" in node && node.target === "scope")) {
        scope.release(node);
      } else {
        scope.releaseNs(node, selected);
      }
    },
    [scope, selected],
  );
}

/** Read the nearest scope's bounded span history (ADR 0030) for an inspector/devtools view — a
 * snapshot taken on each render (an empty snapshot when observation is off). Core exposes no span
 * subscription, so this is not push-reactive: a standalone inspector will not update on its own when
 * sibling components do work — the caller arranges its re-renders (co-render with the work, or a
 * manual refresh). */
export function useSpans(): readonly Observe.Span[] {
  return useScope().spans();
}
