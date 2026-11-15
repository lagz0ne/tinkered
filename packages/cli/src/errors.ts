/** The registry: the command makes no error of its own outside it. */
type Payloads = {
  /** The app's `tinker.json` does not have the shape `Check.Config` names. */
  BadConfig: { path: string; reason: string };
  /** The app has a tool's config, but not the tool. */
  MissingTool: { tool: string; reason: string };
  /** A tool failed and printed no finding: its own output says why. */
  ToolFailed: { tool: string; output: string };
};

export declare namespace Errors {
  export type Name = keyof Payloads;
  export type Payload<N extends Name> = Payloads[N];
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** The only place the command throws a registry error. */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw Object.assign(new Error(kind), { kind, payload });
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}
