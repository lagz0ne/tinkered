/** The registry: this package raises no error of its own outside it. */
type Payloads = {
  /** Sending an HTTP request, or reading its reply, failed; an HTTP status is a result. */
  HttpRequestFailed: {
    method: string;
    path: string;
    cause?: { name?: string; code?: string | number };
  };
  /** A command's main answered with no `closed` promise, so the host cannot wait for its root. */
  MainClosedMissing: Record<string, never>;
  /** A page loaded a backend entry; only a program on Bun or Node may import it. */
  BackendInPage: Record<string, never>;
};

export declare namespace Errors {
  type Name = keyof Payloads;
  type Payload<N extends Name> = Payloads[N];
  type Of<N extends Name = Name> = Error & { kind: N; payload: Payloads[N] };
  /** Core's `ctx.raise`, typed to this registry: the kind picks the payload. */
  type Raise = <N extends Name>(kind: N, payload: Payloads[N]) => never;
}

/** The only place this package throws a registry error itself; an operation uses `ctx.raise`. */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw Object.assign(new Error(kind), { kind, payload });
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && "kind" in value && value.kind === kind;
}

/** Abort consumers keep the native AbortError name and code without a per-call stack. */
export const abortReasons = {
  closed: new DOMException("The owner closed", "AbortError"),
};
