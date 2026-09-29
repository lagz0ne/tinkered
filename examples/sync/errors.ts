export declare namespace Errors {
  type Payloads = { GoneTab: { id: string } };
}

/** A posted register cannot reach a tab whose stream has ended. */
export function raise<N extends keyof Errors.Payloads>(
  kind: N,
  payload: Errors.Payloads[N],
): never {
  throw Object.assign(new Error(kind), { kind, payload });
}
