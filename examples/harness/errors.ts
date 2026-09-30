import type { Scope } from "@tinker/core";

export declare namespace Errors {
  export type Payloads = { InvalidSettings: { fields: string[] } };
  export type Name = keyof Payloads;
  export type Of<N extends Name> = Error & { kind: N; payload: Payloads[N] };
}

/** The payload names missing fields without retaining tokens or other environment values. */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payloads[N]): never {
  throw Object.assign(new Error(kind), { kind, payload });
}

export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && "kind" in value && value.kind === kind;
}

/** A successful run must still report a failed root or its first teardown error. */
export function checkClosed(result: Scope.Result): void {
  if (result.status === "failed") throw result.error;
  if (result.teardownErrors?.length) {
    const [error] = result.teardownErrors;
    throw error;
  }
}
