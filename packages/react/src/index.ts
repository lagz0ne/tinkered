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
  useRef,
  useState,
} from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";
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

/** Reactively read a `data` cell: returns its current value and re-renders when it changes. */
export function useData<T>(cell: Data.Cell<T>): T;
/** Reactively read a slice of a `data` cell: returns `selector(value)` and re-renders only when the
 * slice changes (`isEqual`, default `Object.is`). Lets a component subscribe to part of a cell. */
export function useData<T, S>(
  cell: Data.Cell<T>,
  selector: (value: T) => S,
  isEqual?: (a: S, b: S) => boolean,
): S;
export function useData<T, S>(
  cell: Data.Cell<T>,
  selector?: (value: T) => S,
  isEqual?: (a: S, b: S) => boolean,
): T | S {
  const scope = useScope();
  const store = useMemo(() => {
    const controller = scope.getController(cell);
    return {
      subscribe: (onChange: () => void) => controller.watch(onChange),
      getSnapshot: () => controller.get(),
    };
  }, [scope, cell]);
  const equal = isEqual as ((a: T | S, b: T | S) => boolean) | undefined;
  return useSyncExternalStoreWithSelector<T, T | S>(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
    selector ?? identity,
    equal,
  );
}

/** The nearest scope's read/write controller for a `data` cell (`get`/`read`/`set`/`update`/`watch`).
 * For writes: a component that only holds a controller subscribes to nothing, so a write-only view
 * never re-renders when the cell changes. Read reactively with {@link useData} instead. */
export function useController<T>(cell: Data.Cell<T>): Scope.DataController<T> {
  const scope = useScope();
  return useMemo(() => scope.getController(cell), [scope, cell]);
}

/** Read a resource's built value from the nearest scope. A synchronously-built resource returns its
 * value directly (no promise). An async build suspends: the promise is handed to React's `use`, so a
 * `<Suspense>` fallback shows while pending and the value renders once it settles. Core builds once
 * per owner and returns the same promise on every resolve (including a rejected build, which stays
 * until release), so a Suspense retry reuses that promise rather than rebuilding (ADR 0032). */
export function useResource<T>(handle: Resource.Handle<T>): Awaited<T> {
  const scope = useScope();
  const controller = useMemo(() => scope.getController(handle), [scope, handle]);
  const built = controller.resolve();
  if (isThenable(built)) return use(built) as Awaited<T>;
  return built as Awaited<T>;
}

export declare namespace Resolve {
  /** The call a run was made with: the first argument of {@link useResolve}'s `resolve`. */
  export type Variables<I> = Scope.CallArgs<I>[0];
  /** The settled state of the latest {@link useResolve} run, shaped like a react-query mutation:
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
  /** What {@link useResolve} returns: the current {@link State}, one boolean per status, and the
   * imperative `resolve` (fire-and-forget: the outcome lands in state), `resolveAsync` (returns the
   * value, rejects with the failure — for callers that need the result in a handler) and `reset`. */
  export type Handle<T, I> = State<T, I> & {
    readonly isIdle: boolean;
    readonly isPending: boolean;
    readonly isSuccess: boolean;
    readonly isError: boolean;
    readonly resolve: (...call: Scope.CallArgs<I>) => void;
    readonly resolveAsync: (...call: Scope.CallArgs<I>) => Promise<T>;
    readonly reset: () => void;
  };
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

const IDLE = { status: "idle", data: undefined, error: undefined, variables: undefined } as const;

function settledState<T, I>(
  outcome: Outcome<T>,
  variables: Resolve.Variables<I>,
): Resolve.State<T, I> {
  return outcome.ok
    ? { status: "success", data: outcome.value, error: undefined, variables }
    : { status: "error", data: undefined, error: outcome.error, variables };
}

function notify<T, I>(
  on: Resolve.Options<T, I> | undefined,
  outcome: Outcome<T>,
  variables: Resolve.Variables<I>,
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
 * `useMutation`: `resolve(input)` fires and forgets (the outcome lands in `status`/`data`/`error`
 * with `variables` = the call), `resolveAsync(input)` also returns the value or rejects, `reset()`
 * returns to idle. A rejection never reaches an error boundary (that is {@link useResource}'s job).
 * Only the latest run publishes state: a slower earlier run that settles after a newer one (or after
 * `reset`) is dropped, though its `options` callbacks still fire. */
export function useResolve<T, I>(
  op: Operation.Command<T, I>,
  options?: Resolve.Options<Awaited<T>, I>,
): Resolve.Handle<Awaited<T>, I> {
  const scope = useScope();
  const controller = useMemo(() => scope.getController(op), [scope, op]);
  const [state, setState] = useState<Resolve.State<Awaited<T>, I>>(IDLE);
  const runId = useRef(0);
  const latest = useRef(options);
  latest.current = options;
  const run = useCallback(
    async (call: Scope.CallArgs<I>): Promise<Outcome<Awaited<T>>> => {
      const id = (runId.current += 1);
      const [variables] = call;
      setState({ status: "pending", data: undefined, error: undefined, variables });
      const outcome = await settle(() => controller.resolve(...call));
      if (runId.current === id) setState(settledState(outcome, variables));
      notify(latest.current, outcome, variables);
      return outcome;
    },
    [controller],
  );
  const resolve = useCallback(
    (...call: Scope.CallArgs<I>): void => {
      run(call);
    },
    [run],
  );
  const resolveAsync = useCallback(
    async (...call: Scope.CallArgs<I>): Promise<Awaited<T>> => {
      const outcome = await run(call);
      if (outcome.ok) return outcome.value;
      throw outcome.error;
    },
    [run],
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
    resolve,
    resolveAsync,
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
