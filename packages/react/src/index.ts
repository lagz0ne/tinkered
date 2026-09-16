import type { Scope } from "@tinker/core";
import type { ReactNode } from "react";
import { createContext, createElement, useContext, useEffect, useRef, useState } from "react";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

const ScopeContext = createContext<Scope.Handle | undefined>(undefined);

/** Start a scope's teardown without awaiting; a scope owns its own shutdown and never throws
 * (ADR 0027), so the unmounting subtree does not wait on the result. */
function closeScope(scope: Scope.Handle): void {
  return void scope.close();
}

/** Own a created scope for a subtree: create it once, and close it on unmount. StrictMode (and a
 * discarded concurrent render) runs mount→unmount→mount; the prior scope is closed by its cleanup,
 * so the remount creates a fresh one (ADR 0031) rather than reusing a closed scope. */
function useOwnedScope(create: () => Scope.Handle): Scope.Handle {
  const createRef = useRef(create);
  createRef.current = create;
  const [scope, setScope] = useState(() => createRef.current());
  const reopen = useRef(false);
  useEffect(() => {
    if (reopen.current) {
      reopen.current = false;
      setScope(createRef.current());
      return;
    }
    return () => {
      reopen.current = true;
      closeScope(scope);
    };
  }, [scope]);
  return scope;
}

/** Props for {@link ScopeProvider}: either an app-owned `scope` (the app closes it), or a `create`
 * factory the provider owns and closes on unmount. Exactly one. */
export type ScopeProviderProps =
  | { readonly scope: Scope.Handle; readonly create?: never; readonly children: ReactNode }
  | { readonly create: () => Scope.Handle; readonly scope?: never; readonly children: ReactNode };

function OwnedScopeProvider(props: {
  readonly create: () => Scope.Handle;
  readonly children: ReactNode;
}): ReactNode {
  const scope = useOwnedScope(props.create);
  return createElement(ScopeContext.Provider, { value: scope }, props.children);
}

/** Put a `@tinker/core` scope on React context for the subtree. Hooks resolve against the nearest
 * provider's scope. */
export function ScopeProvider(props: ScopeProviderProps): ReactNode {
  if ("scope" in props) {
    return createElement(ScopeContext.Provider, { value: props.scope }, props.children);
  }
  return createElement(OwnedScopeProvider, { create: props.create, children: props.children });
}

/** Read the nearest scope `Handle`. Raises `NoProvider` when used outside a {@link ScopeProvider}. */
export function useScope(): Scope.Handle {
  const scope = useContext(ScopeContext);
  if (!scope) raise("NoProvider", { hook: "useScope" });
  return scope;
}
