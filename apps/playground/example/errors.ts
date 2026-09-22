/** Every error the example throws, named with its code. Code throws only from here; callers narrow
 * with `isError`. A bad operation input crosses the door as core's DataValidationFailed, which
 * carries one of these as its cause. */
export type ErrorCode = "BadPress" | "BadPhysics" | "BadStorm" | "BadTurn";

export type ExampleError = Error & { readonly code: ErrorCode };

/** Throw a registry error. The only throw site in the example. */
export function raise(code: ErrorCode, message: string): never {
  throw Object.assign(new Error(message), { code });
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError(error: unknown, code: ErrorCode): error is ExampleError {
  return error instanceof Error && (error as { code?: unknown }).code === code;
}
