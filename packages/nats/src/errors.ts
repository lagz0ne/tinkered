type Payloads = {
  InvalidConfig: { key: "NATS_URL" };
  ChecksumMismatch: { file: string };
  ServerStopped: { output: string; storeDir: string };
};

export declare namespace Errors {
  type Name = keyof Payloads;
  type Payload<N extends Name> = Payloads[N];
  type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw Object.assign(new Error(`${kind}: ${JSON.stringify(payload)}`), { kind, payload });
}

/** Narrow at a catch boundary; rethrow errors from other packages. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
