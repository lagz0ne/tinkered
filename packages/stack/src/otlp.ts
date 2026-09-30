import type { Observe } from "@tinker/core";

/** OTLP JSON uses decimal strings for uint64 times and hex for trace ids.
 * Core clocks supply epoch milliseconds; do the unit change in integer space. */
function nanos(time: number): string {
  return (BigInt(Math.trunc(time)) * 1_000_000n).toString();
}

function value(value: unknown): object {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number" && Number.isFinite(value)) return { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  return { stringValue: JSON.stringify(value) ?? String(value) };
}

function attributes(fields: Record<string, unknown>): object[] {
  return Object.entries(fields).map(([key, entry]) => ({ key, value: value(entry) }));
}

/** Copy the finished span into a wire record; the queue retains no core objects. */
export function encodeSpan(span: Observe.Span): string {
  return JSON.stringify({
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    flags: span.sampled ? 1 : 0,
    name: span.name,
    kind: 1,
    startTimeUnixNano: nanos(span.start),
    endTimeUnixNano: nanos(span.end!),
    attributes: attributes({ ...span.attributes, "tinker.kind": span.kind }),
    events: span.events.map((event) => ({
      name: event.name,
      timeUnixNano: nanos(event.time),
      attributes: attributes(event.attributes),
    })),
    status: { code: span.status === "failed" ? 2 : 1 },
  });
}

export function encodeLog(entry: Observe.Log): string {
  return JSON.stringify({
    timeUnixNano: nanos(entry.time),
    severityNumber: entry.level >= 50 ? 17 : entry.level >= 40 ? 13 : entry.level >= 30 ? 9 : 5,
    body: { stringValue: entry.message },
    attributes: attributes(entry.attributes),
    traceId: entry.span?.traceId,
    spanId: entry.span?.spanId,
    flags: entry.span?.sampled ? 1 : 0,
  });
}

export function encodeBatch(service: string, signal: "traces" | "logs", records: string[]): string {
  const resource = JSON.stringify({
    attributes: [{ key: "service.name", value: { stringValue: service } }],
  });
  const scope = JSON.stringify({ name: "@tinker/stack" });
  return signal === "traces"
    ? `{"resourceSpans":[{"resource":${resource},"scopeSpans":[{"scope":${scope},"spans":[${records.join(",")}]}]}]}`
    : `{"resourceLogs":[{"resource":${resource},"scopeLogs":[{"scope":${scope},"logRecords":[${records.join(",")}]}]}]}`;
}
