/** Every error this package names, with its payload. `ctx.raise` is untyped (ADR 0067), so a site
 * that raises through it checks its payload with `satisfies Errors.Payload<…>`. */
type Payloads = {
  StreamEnded: {
    label: string;
  };
  MissingConfig: {
    label: string;
    key: string;
  };
  EmptyPrompt: {
    label: string;
  };
  DuplicateTool: {
    label: string;
    name: string;
  };
  EditMiss: {
    label: string;
    path: string;
    count: number;
  };
  PathOutsideCwd: {
    label: string;
    path: string;
  };
};

export declare namespace Errors {
  export type Name = keyof Payloads;
  export type Payload<N extends Name> = Payloads[N];
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

export function makeError<N extends Errors.Name>(
  kind: N,
  payload: Errors.Payload<N>,
): Errors.Of<N> {
  const error = new Error(kind) as Errors.Of<N>;
  Object.assign(error, { kind, payload });
  return error;
}

/** Throw a registry error where no `ctx` is at hand (a helper, an input parser). Inside a run,
 * `ctx.raise` throws the same kind and stamps its origin at the throw site (ADR 0067). */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw makeError(kind, payload);
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
