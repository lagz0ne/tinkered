import type { Operation } from "@tinker/core";
import type { HttpRequest } from "./request.ts";
import type { HttpResponse } from "./response.ts";

/** Payload type for each http error. The registry is the only place this package throws. */
type Payloads = {
  RequestFailed: {
    request: HttpRequest.Record;
    reason: "Transport" | "Encode" | "InvalidUrl";
    cause?: unknown;
  };
  ResponseFailed: {
    request: HttpRequest.Record;
    response: HttpResponse.Handle;
    reason: "StatusCode" | "Decode" | "EmptyBody";
    cause?: unknown;
  };
  NoBody: {
    status: number;
  };
};

export declare namespace Errors {
  /** Every http error name. */
  export type Name = keyof Payloads;
  /** The typed payload carried by one error name. */
  export type Payload<N extends Name> = Payloads[N];
  /** An http error: identified by `kind`, carrying a typed `payload`. */
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** Build a registry error without throwing (for rejecting a promise). */
export function makeError<N extends Errors.Name>(
  kind: N,
  payload: Errors.Payload<N>,
): Errors.Of<N> {
  const error = new Error(kind) as Errors.Of<N>;
  Object.assign(error, { kind, payload });
  return error;
}

/** Throw a registry error where no run ctx is in scope (a body reader). */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw makeError(kind, payload);
}

/** Throw a registry error through a run's `ctx.raise`, so core stamps its origin at the throw
 * site (ADR 0067). */
export function raiseFrom<N extends Errors.Name>(
  ctx: Pick<Operation.Ctx<unknown>, "raise">,
  kind: N,
  payload: Errors.Payload<N>,
): never {
  return ctx.raise(kind, payload);
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
