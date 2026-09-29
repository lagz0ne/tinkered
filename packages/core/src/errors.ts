import type { Data, Resource } from "./index.ts";

/** The registry: core makes no error of its own outside it. */
type Payloads = {
  DataValidationFailed: { label: string; cause: unknown };
  SchemaRejected: { issues: readonly Data.SchemaIssue[] };
  SchemaAsync: { vendor: string };
  InvalidDependency: { label: string; reason: string };
  MissingTag: { label: string };
  Disposed: { reason: string };
  TeardownFailed: { causes: unknown[] };
  NotResolved: { label: string };
  CircularResource: { label: string };
};

export declare namespace Errors {
  export type Name = keyof Payloads;
  export type Payload<N extends Name> = Payloads[N];
  export type Of<N extends Name = Name> = Error & {
    readonly kind: N;
    readonly payload: Payloads[N];
  };
}

/** Build a registry error without throwing (for rejecting a promise). */
export function makeError<N extends Errors.Name>(
  kind: N,
  payload: Errors.Payload<N>,
): Errors.Of<N> {
  const error = new Error(kind) as Errors.Of<N>;
  Object.assign(error, { kind, payload });
  return error;
}

/** The only place core throws a registry error. Its other throws rethrow, or throw a user's kind
 * through `raiseFrom`. */
export function raise<N extends Errors.Name>(kind: N, payload: Errors.Payload<N>): never {
  throw makeError(kind, payload);
}

/** Narrow an unknown error to one registry entry; callers rethrow on mismatch. */
export function isError<N extends Errors.Name>(value: unknown, kind: N): value is Errors.Of<N> {
  return value instanceof Error && (value as Partial<Errors.Of>).kind === kind;
}

/** Where a failure first arose, with enclosing run labels in root-first order. */
export type Origin = { label: string; span?: number; path: string[] };

/** A run's value, failure, or cancellation, returned by `settle` without throwing. */
export type RunResult<T> =
  | { status: "success"; value: T }
  | { status: "failed"; error: unknown; kind: "error" | "panic"; origin?: Origin }
  | { status: "cancelled"; reason: unknown };

/** A run or resource ctx: where a failure can be stamped. */
type Site = Pick<Resource.Ctx, "label"> & { readonly span?: { id: number } };

/** The origin a failure carries, and the ctx that raised it (its own run adds no label). `open`
 * while the error is in flight from its first throw: only then does an enclosing run add its label,
 * so a rethrown error keeps its first path. */
type Stamp = { origin: Origin; by?: Site; open: boolean };

const stamps = new WeakMap<object, Stamp>();

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

/** Read the first stamped error in a cause chain; primitive throws have no origin. */
export function originOf(error: unknown): Origin | undefined {
  const seen = new Set<object>();
  while (isObject(error) && !seen.has(error)) {
    const stamp = stamps.get(error);
    if (stamp) return stamp.origin;
    seen.add(error);
    error = (error as { cause?: unknown }).cause;
  }
  return undefined;
}

export function causesOf(error: unknown): unknown[] {
  const chain: unknown[] = [];
  while (!chain.includes(error)) {
    chain.push(error);
    if (!isObject(error) || !("cause" in error)) break;
    error = error.cause;
  }
  return chain;
}

function firstOrigin(label: string, span: { id: number } | undefined): Origin {
  return span === undefined ? { label, path: [label] } : { label, span: span.id, path: [label] };
}

/** Stamp one failed run: the first stamp keeps its label and span; each enclosing run adds its
 * label to the front of the path while the flight is open, except the run whose own ctx raised the
 * error. The run that `ends` the flight (a root run, or a `settle`) closes it. */
export function stampOrigin(
  error: unknown,
  label: string,
  span: { id: number } | undefined,
  ctx: Site | undefined,
  ends: boolean,
): void {
  if (!isObject(error)) return;
  const stamp = stamps.get(error);
  if (stamp === undefined) {
    stamps.set(error, { origin: firstOrigin(label, span), open: !ends });
    return;
  }
  if (!stamp.open) return;
  if (ctx === undefined || stamp.by !== ctx)
    stamp.origin = { ...stamp.origin, path: [label, ...stamp.origin.path] };
  if (ends) stamp.open = false;
}

/** End an error's flight where a caller receives it as a value (`settle`). */
export function closeOrigin(error: unknown): void {
  const stamp = isObject(error) ? stamps.get(error) : undefined;
  if (stamp) stamp.open = false;
}

/** Classify the managed error shape shared by package registries. */
export function failureKind(error: unknown): "error" | "panic" {
  return error instanceof Error &&
    typeof (error as { kind?: unknown }).kind === "string" &&
    "payload" in error
    ? "error"
    : "panic";
}

/** Backs `ctx.raise`: a managed error is a value, not a panic (ADR 0067). */
export function raiseFrom<K extends string, P extends object>(
  ctx: Site | undefined,
  kind: K,
  payload: P,
): never {
  const error = Object.assign(new Error(kind), { kind, payload });
  if (ctx) stamps.set(error, { origin: firstOrigin(ctx.label, ctx.span), by: ctx, open: true });
  throw error;
}
