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
    stream(): ReadableStream<Uint8Array> | null;
  };
  /** A body parser for `json(parse)`: validates raw JSON into a trusted value at the process edge. */
  export type Parse<T> = Data.Parse<T>;
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
 * reads as `ResponseFailed/Decode` carrying the `cause`. */
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
    stream: () => response.body,
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

/** The response constructors: `HttpResponse.fromWeb(...)`, `HttpResponse.make(...)`. */
export const HttpResponse = { fromWeb, make };
