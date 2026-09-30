export declare namespace Errors {
  type Payloads = {
    GoneTab: { id: string };
    NoStream: { status: number };
    RegistrationFailed: { status: number };
    StreamEnded: { client: string };
  };
}

/** Error payloads identify the failed tab or response without retaining a stream. */
export function raise<N extends keyof Errors.Payloads>(
  kind: N,
  payload: Errors.Payloads[N],
): never {
  throw Object.assign(new Error(kind), { kind, payload });
}
