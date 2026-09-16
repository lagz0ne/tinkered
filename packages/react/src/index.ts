import type { Data, Resource, Scope } from "@tinker/core";
import type { ReactNode } from "react";
import {
  createContext,
  createElement,
  use,
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
