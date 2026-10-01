type Payloads = {
  BadAppName: { name: unknown };
  AppExists: { path: string };
};

export declare namespace Errors {
  type Name = keyof Payloads;
  type Of<N extends Name> = Error & { kind: N; payload: Payloads[N] };
}

export function raise<N extends Errors.Name>(kind: N, payload: Payloads[N]): never {
  throw Object.assign(new Error(kind), { kind, payload });
}

export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && "kind" in value && value.kind === kind;
}
