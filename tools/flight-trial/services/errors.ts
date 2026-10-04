export declare namespace HttpErrors {
  type Payloads = { HttpRequestFailed: { method: string; path: string } };
  type Name = keyof Payloads;
  type Of<N extends Name> = Error & { kind: N; payload: Payloads[N] };
}

/** Narrows a service failure by kind; callers rethrow every other failure. */
export function isError<N extends HttpErrors.Name>(
  error: unknown,
  kind: N,
): error is HttpErrors.Of<N> {
  return error instanceof Error && "kind" in error && error.kind === kind;
}
