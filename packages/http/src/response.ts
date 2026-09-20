import type { Data } from "@tinker/core";
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
      return parse(raw);
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
