import type { Issues } from "./shared/issues.ts";

type ErrorPayloads = {
  BadPage: Record<string, never>;
  BadDataSettings: { keys: string[] };
  BadIssue: { label: string };
  BadIssueList: { label: string };
  BadCreateInput: { reason: string };
  BadEditInput: { reason: string };
  BadCommentInput: { reason: string };
  BadDraftInput: { reason: string };
  BadRegister: { reason: string };
  DraftOff: Record<string, never>;
  DraftFailed: { reason: string };
  IssueNotFound: { id: string };
  IssueConflict: { id: string; currentRevision: number; current: Issues.Issue };
  SyncDropped: { reason: string };
};

export declare namespace Errors {
  export type Payloads = ErrorPayloads;
  export type Name = keyof Payloads;
  export type Payload<N extends Name> = Payloads[N];
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** Build a registry error without throwing it. */
export function fail<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): Errors.Of<N> {
  return Object.assign(new Error(kind), { kind, payload });
}

export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw fail(kind, payload);
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && "kind" in value && value.kind === kind;
}
