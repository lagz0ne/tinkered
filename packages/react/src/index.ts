import type { Data, Observe, Operation, Resource, Scope } from "@tinker/core";
import type { ReactNode } from "react";
import {
  createContext,
  createElement,
  use,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

const ScopeContext = createContext<Scope.Handle | undefined>(undefined);

/** Start a scope's teardown without awaiting; a scope owns its own shutdown and never throws
 * (ADR 0027), so the unmounting subtree does not wait on the result. */
function closeScope(scope: Scope.Handle): void {
  return void scope.close();
}

/** The stable no-selector fallback for {@link useData}: a module constant so the selector handed to
 * the store keeps a stable identity across renders (a fresh closure would defeat its memoization). */
const identity = <V>(value: V): V => value;

/** Does a built resource value need awaiting? An async factory is delivered as a promise. */
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  !!value &&
  (typeof value === "object" || typeof value === "function") &&
  typeof (value as { then?: unknown }).then === "function";

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
 * provider's scope. */
export function ScopeProvider(props: ScopeProviderProps): ReactNode {
  if (props.scope !== undefined) {
    return createElement(ScopeContext.Provider, { value: props.scope, children: props.children });
  }
  return createElement(OwnedScopeProvider, { create: props.create, children: props.children });
}

/** Open a child session for a subtree: created on mount from the nearest scope, force-closed on
 * unmount — a React subtree's mount lifetime IS a session lifetime (ADR 0031). Hooks under it resolve
 * against the session (the nearest `Handle`), so a `data` write is shadowed and does not reach the
 * parent. Created in an effect (StrictMode-safe, like {@link ScopeProvider}'s `create` mode): a
 * discarded or replayed mount closes its own session and the next live mount opens a fresh one. The
 * session is published paired with the parent it belongs to; if the nearest scope changes, the old
 * session is never exposed for the new parent (render null until the effect opens a fresh one).
 * `options` apply when the session is created — changing them for the same parent has no effect until
 * the provider remounts. */
export function SessionProvider(props: {
  readonly children: ReactNode;
  readonly options?: Scope.Options;
}): ReactNode {
  const parent = useScope();
  const optionsRef = useRef(props.options);
  optionsRef.current = props.options;
  const [owned, setOwned] = useState<{ parent: Scope.Handle; session: Scope.Handle } | undefined>(
    undefined,
  );
  useEffect(() => {
    const session = parent.createSession(optionsRef.current);
    setOwned({ parent, session });
    return () => {
      setOwned(undefined);
      closeScope(session);
    };
  }, [parent]);
  if (owned === undefined || owned.parent !== parent) return null;
  return createElement(ScopeContext.Provider, { value: owned.session, children: props.children });
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
/** Read and write a `data` cell as a `useState`-like pair: `[value, set]`. */
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
  const { selector, isEqual, writable } = readDataArgs(a, b);
  const scope = useScope();
  const store = useMemo(() => createDataStore<T, S>(scope.controller(cell)), [scope, cell]);
  store.select = selector ?? (identity as (value: T) => S);
  store.equal = (isEqual ?? Object.is) as (a: S, b: S) => boolean;
  const value = useSyncExternalStore(store.subscribe, store.read, store.read);
  return writable ? [value, store.set] : value;
}

function readDataArgs<T, S>(
  a: ((value: T) => S) | UseData.Options<T> | undefined,
  b: ((a: S, b: S) => boolean) | UseData.Options<S> | undefined,
): {
  selector: ((value: T) => S) | undefined;
  isEqual: ((a: T | S, b: T | S) => boolean) | undefined;
  writable: boolean;
} {
  const selector = typeof a === "function" ? a : undefined;
  const options = typeof a === "function" ? (typeof b === "function" ? undefined : b) : a;
  const isEqual = typeof b === "function" ? b : options?.isEqual;
  return {
    selector,
    isEqual: isEqual as ((a: T | S, b: T | S) => boolean) | undefined,
    writable: options?.writable === true,
  };
}

function createDataStore<T, S>(
  controller: Scope.DataController<T>,
): {
  select: (value: T) => S;
  equal: (a: S, b: S) => boolean;
  subscribe: (notify: () => void) => () => void;
  read: () => S;
  set: (value: T) => void;
} {
  let memo:
    | { raw: T; slice: S; select: (value: T) => S; equal: (a: S, b: S) => boolean }
    | undefined = undefined;
  const store: {
    select: (value: T) => S;
    equal: (a: S, b: S) => boolean;
    subscribe: (notify: () => void) => () => void;
    read: () => S;
    set: (value: T) => void;
  } = {
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
        memo = { raw, slice: kept, select: store.select, equal: store.equal };
        return kept;
      }
      const fresh = store.select(raw);
      memo = { raw, slice: fresh, select: store.select, equal: store.equal };
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
  const scope = useScope();
  return useMemo(() => scope.controller(cell), [scope, cell]);
}

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

async function settle<T>(run: () => T): Promise<Outcome<Awaited<T>>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

export declare namespace Query {
  /** Options for {@link useResource}: `suspense: false` renders a local status instead of suspending. */
  export type Options = { readonly suspense?: boolean };
  /** The build state of a resource read with `{ suspense: false }`: a synchronous build is `success`
   * at once; an async build is `pending` until it settles; a failed build stays `error` until
   * `refetch` (which releases the instance and builds a fresh generation). */
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

const QUERY_PENDING = { status: "pending", data: undefined, error: undefined } as const;

type Settled<T> = { readonly key: PromiseLike<unknown>; readonly state: Query.State<T> };

function queryHandle<T>(state: Query.State<T>, refetch: () => void): Query.Handle<T> {
  return {
    ...state,
    isPending: state.status === "pending",
    isSuccess: state.status === "success",
    isError: state.status === "error",
    refetch,
  };
}

/** Read a resource's built value from the nearest scope. A synchronously-built resource returns its
 * value directly (no promise). An async build suspends: the promise is handed to React's `use`, so a
 * `<Suspense>` fallback shows while pending and the value renders once it settles. Core builds once
 * per owner and returns the same promise on every resolve (including a rejected build, which stays
 * until release), so a Suspense retry reuses that promise rather than rebuilding (ADR 0032).
 * With `{ suspense: false }` nothing suspends or throws: the hook returns a react-query-like
 * `{ status, data, error, isPending, isSuccess, isError, refetch }` for a local loading state. */
export function useResource<T>(
  handle: Resource.Handle<T>,
  options?: { suspense?: true },
): Awaited<T>;
export function useResource<T>(
  handle: Resource.Handle<T>,
  options: { suspense: false },
): Query.Handle<Awaited<T>>;
export function useResource<T>(
  handle: Resource.Handle<T>,
  options?: Query.Options,
): Awaited<T> | Query.Handle<Awaited<T>> {
  const scope = useScope();
  const controller = useMemo(() => scope.controller(handle), [scope, handle]);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const built = controller.resolve();
  const pending = isThenable(built) ? (built as PromiseLike<Awaited<T>>) : undefined;
  const local = options?.suspense === false;
  const settled = useSettled(local ? pending : undefined);
  const refetch = useCallback(() => {
    scope.release(handle);
    bump();
  }, [scope, handle]);
  if (!local) return pending ? (use(pending) as Awaited<T>) : (built as Awaited<T>);
  const state: Query.State<Awaited<T>> = pending
    ? (settled ?? QUERY_PENDING)
    : { status: "success", data: built as Awaited<T>, error: undefined };
  return queryHandle(state, refetch);
}

/** The settled state of `pending`, or undefined while it is in flight (or when there is nothing to
 * wait for). Keyed by promise identity, so a fresh promise after `refetch` reads as pending again. */
function useSettled<T>(pending: PromiseLike<T> | undefined): Query.State<T> | undefined {
  const [settled, setSettled] = useState<Settled<T> | undefined>(undefined);
  useEffect(() => {
    if (!pending) return;
    let live = true;
    settle(() => pending).then((outcome) => {
      if (live) setSettled({ key: pending, state: settledState(outcome) });
    }, noop);
    return () => {
      live = false;
    };
  }, [pending]);
  return settled && settled.key === pending ? settled.state : undefined;
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

const noop = (): void => undefined;

const IDLE = { status: "idle", data: undefined, error: undefined, variables: undefined } as const;

function settledState<T>(outcome: Outcome<T>): Query.State<T> {
  return outcome.ok
    ? { status: "success", data: outcome.value, error: undefined }
    : { status: "error", data: undefined, error: outcome.error };
}

function notify<T, I>(
  on: Run.Options<T, I> | undefined,
  outcome: Outcome<T>,
  variables: Run.Variables<I>,
): void {
  if (!on) return;
  if (outcome.ok) on.onSuccess?.(outcome.value, variables);
  else on.onError?.(outcome.error, variables);
  on.onSettled?.(
    outcome.ok ? outcome.value : undefined,
    outcome.ok ? undefined : outcome.error,
    variables,
  );
}

/** Run an operation imperatively (a mutation): never suspends. Shaped like react-query's
 * `useMutation`: `run(input)` fires and forgets (the outcome lands in `status`/`data`/`error`
 * with `variables` = the call), `runAsync(input)` also returns the value or rejects, `reset()`
 * returns to idle. A rejection never reaches an error boundary (that is {@link useResource}'s job).
 * Only the latest run publishes state: a slower earlier run that settles after a newer one (or after
 * `reset`) is dropped, though its `options` callbacks still fire. */
export function useRun<T, I>(
  op: Operation.Handle<T, I>,
  options?: Run.Options<Awaited<T>, I>,
): Run.Handle<Awaited<T>, I> {
  const scope = useScope();
  const controller = useMemo(() => scope.controller(op), [scope, op]);
  const [state, setState] = useState<Run.State<Awaited<T>, I>>(IDLE);
  const runId = useRef(0);
  const latest = useRef(options);
  latest.current = options;
  const invoke = useCallback(
    async (call: Scope.CallArgs<I>): Promise<Outcome<Awaited<T>>> => {
      const id = (runId.current += 1);
      const [variables] = call;
      setState({ status: "pending", data: undefined, error: undefined, variables });
      const outcome = await settle(() => controller.run(...call));
      if (runId.current === id) setState({ ...settledState(outcome), variables });
      notify(latest.current, outcome, variables);
      return outcome;
    },
    [controller],
  );
  const run = useCallback(
    (...call: Scope.CallArgs<I>): void => {
      invoke(call).catch(noop);
    },
    [invoke],
  );
  const runAsync = useCallback(
    async (...call: Scope.CallArgs<I>): Promise<Awaited<T>> => {
      const outcome = await invoke(call);
      if (outcome.ok) return outcome.value;
      throw outcome.error;
    },
    [invoke],
  );
  const reset = useCallback((): void => {
    runId.current += 1;
    setState(IDLE);
  }, []);
  return {
    ...state,
    isIdle: state.status === "idle",
    isPending: state.status === "pending",
    isSuccess: state.status === "success",
    isError: state.status === "error",
    run,
    runAsync,
    reset,
  };
}

/** Release a node at the nearest scope: reset a `data` cell to its inherited/initial value (notifying
 * `useData` readers) or drop a resource's instance so the next `useResource` rebuilds a fresh
 * generation. Pair with an error-boundary reset to retry a failed resource (ADR 0032). */
export function useRelease(): (node: Data.Cell<unknown> | Resource.Handle<unknown>) => void {
  const scope = useScope();
  return useCallback((node) => scope.release(node), [scope]);
}

/** Read the nearest scope's bounded span history (ADR 0030) for an inspector/devtools view — a
 * snapshot taken on each render (an empty snapshot when observation is off). Core exposes no span
 * subscription, so this is not push-reactive: a standalone inspector will not update on its own when
 * sibling components do work — the caller arranges its re-renders (co-render with the work, or a
 * manual refresh). */
export function useSpans(): readonly Observe.Span[] {
  return useScope().spans();
}
