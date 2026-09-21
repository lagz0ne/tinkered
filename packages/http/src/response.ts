import { parse as runParse, type Data } from "@tinker/core";
import { raise } from "./errors.ts";
import type { HttpRequest } from "./request.ts";

export declare namespace HttpResponse {
  /** A received response: status, headers (lowercased keys), the request that produced it, body
   * readers, the adapter's own object (`source`: the web `Response` for `fetchBackend`) for
   * backend-specific reads. Readers delegate to the underlying web `Response` — each consumes the
   * body, so read it once at the process edge. */
  export type Handle = {
    readonly request: HttpRequest.Record;
    readonly status: number;
    readonly headers: Readonly<globalThis.Record<string, string>>;
    readonly source: unknown;
    text(): Promise<string>;
    json(): Promise<unknown>;
    json<T>(parse: HttpResponse.Parse<T>): Promise<T>;
    arrayBuffer(): Promise<ArrayBuffer>;
    formData(): Promise<FormData>;
    stream(): ReadableStream<Uint8Array>;
    /** Server-sent events from the body: WHATWG rules, generic (no `[DONE]` knowledge). */
    sse(): AsyncIterable<HttpResponse.SseEvent>;
  };
  /** One server-sent event: `data` is the joined data lines; `event` and `id` when sent. */
  export type SseEvent = {
    readonly data: string;
    readonly event?: string;
    readonly id?: string;
  };
  /** A body parser for `json(parse)`: validates raw JSON into a trusted value at the process edge. */
  export type Parse<T> = Data.Parse<T>;
  /** One status case: reads the response into a value. */
  export type Case<R> = (response: Handle) => R;
  /** The cases `matchStatus` dispatches on: exact statuses by number, class buckets, and a
   * fallback. An exact status beats its class bucket; anything unmatched falls to `orElse`. */
  export type Cases<R> = {
    readonly [status: number]: Case<R> | undefined;
    readonly "2xx"?: Case<R>;
    readonly "3xx"?: Case<R>;
    readonly "4xx"?: Case<R>;
    readonly "5xx"?: Case<R>;
    readonly orElse: Case<R>;
  };
  /** Options for {@link make}: status, headers, a body (string, bytes, a byte stream, or null for
   * none), and the adapter's own object when the response wraps one. */
  export type MakeOptions = {
    readonly status: number;
    readonly headers?: Readonly<globalThis.Record<string, string>>;
    readonly body?: string | Uint8Array | ReadableStream<Uint8Array> | null;
    readonly source?: unknown;
  };
}

/** Lowercase header keys; later entries win on a repeated key. */
function readHeaders(headers: Headers): globalThis.Record<string, string> {
  const out: globalThis.Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Wrap a web `Response` as a handle: the readers delegate, `source` is the response itself. An
 * empty body reads as `ResponseFailed/EmptyBody` on `json()`; invalid JSON or a throwing `parse`
 * reads as `ResponseFailed/Decode` carrying the `cause`; a missing body raises `NoBody` on
 * `stream()`. */
export function fromWeb(
  request: HttpRequest.Record,
  response: globalThis.Response,
): HttpResponse.Handle {
  const headers = readHeaders(response.headers);
  const status = response.status;
  const readJson = async <T>(parse?: HttpResponse.Parse<T>): Promise<T> => {
    const text = await response.text();
    if (text === "") raise("ResponseFailed", { request, response: handle, reason: "EmptyBody" });
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (cause) {
      raise("ResponseFailed", { request, response: handle, reason: "Decode", cause });
    }
    if (!parse) return raw as T;
    try {
      return runParse(parse, raw);
    } catch (cause) {
      raise("ResponseFailed", { request, response: handle, reason: "Decode", cause });
    }
  };
  const handle: HttpResponse.Handle = {
    request,
    status,
    headers,
    source: response,
    text: () => response.text(),
    json: <T>(parse?: HttpResponse.Parse<T>): Promise<T> => readJson(parse),
    arrayBuffer: () => response.arrayBuffer(),
    formData: () => response.formData(),
    stream: () => {
      const body = response.body;
      if (body === null) raise("NoBody", { status });
      return body;
    },
    sse: async function* () {
      yield* readSse(handle.stream());
    },
  };
  return handle;
}

/** Build a handle directly: the constructor a custom backend or a test uses. Implemented by
 * building a web `Response` and delegating to {@link fromWeb} — no duplicated reader bodies. */
export function make(
  request: HttpRequest.Record,
  options: HttpResponse.MakeOptions,
): HttpResponse.Handle {
  const response = new Response(readMakeBody(options.body), {
    status: options.status,
    headers: options.headers,
  });
  const handle = fromWeb(request, response);
  return options.source === undefined ? handle : { ...handle, source: options.source };
}

/** The web body for a `make` body: absent and null both mean no body. */
function readMakeBody(
  body: HttpResponse.MakeOptions["body"],
): string | Uint8Array | ReadableStream<Uint8Array> | null {
  if (body === undefined || body === null) return null;
  return body;
}

type SseFields = {
  data: string[];
  event: string | undefined;
  id: string | undefined;
};

/** The field and value of one event-stream line: one optional space after the colon is
 * dropped; a line without a colon is a field with an empty value. */
function readSseField(line: string): { field: string; value: string } {
  const colon = line.indexOf(":");
  if (colon === -1) return { field: line, value: "" };
  const value = line.slice(colon + 1);
  return { field: line.slice(0, colon), value: value.startsWith(" ") ? value.slice(1) : value };
}

/** One event-stream field folded into the pending state: `data` appends, `event` and `id`
 * set, any other field ignored. */
function readSseFieldInto(state: SseFields, field: string, value: string): void {
  if (field === "data") state.data.push(value);
  else if (field === "event") state.event = value;
  else if (field === "id") state.id = value;
}

/** One event-stream line folded into the pending fields: a blank line dispatches the pending
 * event when it has data, a comment is skipped, any other line folds its field in. */
function readSseLine(state: SseFields, line: string): HttpResponse.SseEvent | undefined {
  if (line === "") return dispatchSse(state);
  if (line.startsWith(":")) return undefined;
  const { field, value } = readSseField(line);
  readSseFieldInto(state, field, value);
  return undefined;
}

/** The pending fields as one event, or undefined when no data arrived: always resets. */
function dispatchSse(state: SseFields): HttpResponse.SseEvent | undefined {
  const event = state.event;
  const id = state.id;
  const data = state.data.length === 0 ? undefined : state.data.join("\n");
  state.data = [];
  state.event = undefined;
  state.id = undefined;
  if (data === undefined) return undefined;
  const out: { data: string; event?: string; id?: string } = { data };
  if (event !== undefined) out.event = event;
  if (id !== undefined) out.id = id;
  return out;
}

/** Complete lines from the decoded chunks so far, keeping the unfinished tail buffered. */
function readSseLines(buffer: string): { lines: string[]; rest: string } {
  const lines = buffer.split(/\r\n|\r|\n/);
  const rest = lines.pop() ?? "";
  return { lines, rest };
}

/** Server-sent events from a byte stream: UTF-8 decoded, split on `\n`, `\r\n`, or `\r`,
 * with the unfinished line kept between chunks and a pending event dispatched at the end. */
async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<HttpResponse.SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const state: SseFields = { data: [], event: undefined, id: undefined };
  let buffer = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const split = readSseLines(buffer);
      buffer = split.rest;
      yield* readSseEvents(state, split.lines);
    }
    yield* readSseEnd(state, buffer + decoder.decode());
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

/** The events dispatched by a batch of complete lines. */
function* readSseEvents(
  state: SseFields,
  lines: readonly string[],
): Generator<HttpResponse.SseEvent> {
  for (const line of lines) {
    const event = readSseLine(state, line);
    if (event !== undefined) yield event;
  }
}

/** The events left when the stream ends: the unfinished tail as one last line, then the
 * pending fields when they hold data. */
function* readSseEnd(state: SseFields, tail: string): Generator<HttpResponse.SseEvent> {
  if (tail !== "") {
    const event = readSseLine(state, tail);
    if (event !== undefined) yield event;
  }
  const last = dispatchSse(state);
  if (last !== undefined) yield last;
}

/** The response constructors plus the status readers: `HttpResponse.fromWeb(...)`,
 * `HttpResponse.make(...)`, `HttpResponse.filterStatus(...)`,
 * `HttpResponse.filterStatusOk(...)`, `HttpResponse.matchStatus(...)`. */
export const HttpResponse = { fromWeb, make, filterStatus, filterStatusOk, matchStatus };

/** Pass the response through when `accept(status)` holds, else raise `ResponseFailed/StatusCode`
 * carrying `request` and `response` (the body stays readable by a catch handler). */
export function filterStatus(
  response: HttpResponse.Handle,
  accept: (status: number) => boolean,
): HttpResponse.Handle {
  if (accept(response.status)) return response;
  raise("ResponseFailed", {
    request: response.request,
    response,
    reason: "StatusCode",
  });
}

/** `filterStatus` with the 2xx range — Effect's `filterStatusOk` shape, no `pipe`. */
export function filterStatusOk(response: HttpResponse.Handle): HttpResponse.Handle {
  return filterStatus(response, (status) => status >= 200 && status < 300);
}

/** Read a response into a value by status: an exact status beats its class bucket
 * (`"2xx"`/`"3xx"`/`"4xx"`/`"5xx"` by hundreds digit), anything unmatched falls to `orElse`.
 * The return type is the union of the case results (Effect's shape, no `Unify`). */
export function matchStatus<R>(response: HttpResponse.Handle, cases: HttpResponse.Cases<R>): R {
  const exact = cases[response.status];
  if (exact !== undefined) return exact(response);
  const bucket = readBucket(cases, response.status);
  if (bucket !== undefined) return bucket(response);
  return cases.orElse(response);
}

/** The class bucket for a status: `"2xx"` through `"5xx"` by hundreds digit. */
function readBucket<R>(
  cases: HttpResponse.Cases<R>,
  status: number,
): HttpResponse.Case<R> | undefined {
  const klass = Math.floor(status / 100);
  if (klass === 2) return cases["2xx"];
  if (klass === 3) return cases["3xx"];
  if (klass === 4) return cases["4xx"];
  if (klass === 5) return cases["5xx"];
  return undefined;
}
