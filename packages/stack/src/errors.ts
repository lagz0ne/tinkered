type Payloads = {
  PieceInUse: { label: string };
  BadDevEntry: Record<string, never>;
  DevRootStopped: { code: number };
  BadLiveSubject: { subject: string };
  BadListenSettings: { keys: string[] };
  BadTraceSettings: { keys: string[] };
};

export declare namespace Errors {
  export type Name = keyof Payloads;
  export type Payload<N extends Name> = Payloads[N];
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw Object.assign(new Error(kind), { kind, payload });
}

/** Narrow the registry entry before reading its payload. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && "kind" in value && value.kind === kind;
}
