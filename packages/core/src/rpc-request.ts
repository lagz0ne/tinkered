import { tag } from "./index";
import type { Observe } from "./index";

// What a server transport binds for each call it serves (ADR 0130): the Fetch `Request` it
// answers and the signal that ends with it. The HTTP routes bind the same two, so an op reads
// a header, a cookie or the stop the same way under any transport (tRPC's `createContext({ req })`).

/** The request a call answers: bound per call by the transport, read only by HTTP-aware ops. */
export const request = tag<Request>({ label: "request" });

/** Aborts when the request ends: the caller left, or the server drains. */
export const requestStop = tag<AbortSignal>({ label: "request.stop" });

const header = /^00-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;

/**
 * A W3C `traceparent` header, version 00, read as Core's remote parent (ADR 0076). Lowercase
 * hex only; an all-zero trace or span id fails. No header, or a bad one, gives null: the call
 * starts a fresh trace, and never fails for it.
 */
export function traceparentOf(value: unknown): Observe.Trace | null {
  if (typeof value !== "string" || !header.test(value)) return null;

  const [, traceId = "", parentSpanId = "", flags = ""] = value.split("-");
  return { traceId, parentSpanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 };
}
