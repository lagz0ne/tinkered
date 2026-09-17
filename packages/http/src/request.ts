export declare namespace HttpRequest {
  /** The HTTP verbs a record can carry. */
  export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  /** A request body: empty, text, raw bytes, multipart form, or URL-encoded params. */
  export type Body =
    | { readonly kind: "empty" }
    | { readonly kind: "text"; readonly text: string; readonly contentType: string }
    | { readonly kind: "bytes"; readonly bytes: Uint8Array; readonly contentType: string }
    | { readonly kind: "formData"; readonly formData: FormData }
    | { readonly kind: "urlParams"; readonly params: readonly (readonly [string, string])[] };
  /** An immutable request record: method, raw url, query pairs, fragment, headers (lowercased
   * keys), body. Build with `get`/`post`/... and change with `modify` — always a new record. */
  export type Record = {
    readonly method: Method;
    readonly url: string;
    readonly urlParams: readonly (readonly [string, string])[];
    readonly hash: string | undefined;
    readonly headers: Readonly<globalThis.Record<string, string>>;
    readonly body: Body;
  };
  /** Options for the `get`/`post`/... builders and `modify`: query pairs, fragment, headers
   * (any case, lowercased on the record), a body (a `bodyJson`/`bodyText`/... value), and accept
   * shorthands that set the header. */
  export type Options = {
    readonly urlParams?:
      | Readonly<globalThis.Record<string, string>>
      | readonly (readonly [string, string])[];
    readonly hash?: string;
    readonly headers?: Readonly<globalThis.Record<string, string>>;
    readonly body?: Body;
    readonly accept?: string;
    readonly acceptJson?: boolean;
  };
}

/** A JSON body: text with the JSON content type. A `stringify` failure surfaces as the caller's
 * own error (it is their value that would not serialize). */
export function bodyJson(value: unknown): HttpRequest.Body {
  return { kind: "text", text: JSON.stringify(value), contentType: "application/json" };
}

/** A text body with an explicit content type (default plain text). */
export function bodyText(text: string, contentType = "text/plain"): HttpRequest.Body {
  return { kind: "text", text, contentType };
}

/** A raw-bytes body with an explicit content type (default octet stream). */
export function bodyBytes(
  bytes: Uint8Array,
  contentType = "application/octet-stream",
): HttpRequest.Body {
  return { kind: "bytes", bytes, contentType };
}

/** A multipart-form body over the caller's `FormData` (its content type is the transport's). */
export function bodyFormData(formData: FormData): HttpRequest.Body {
  return { kind: "formData", formData };
}

/** A URL-encoded-params body: sent as `URLSearchParams` by `fetchBackend`. */
export function bodyUrlParams(
  params: Readonly<globalThis.Record<string, string>> | readonly (readonly [string, string])[],
): HttpRequest.Body {
  return { kind: "urlParams", params: readPairs(params) };
}

const EMPTY_BODY: HttpRequest.Body = { kind: "empty" };

/** Read query pairs from either shape the options accept: an object or a pair list. */
function readPairs(
  params: Readonly<globalThis.Record<string, string>> | readonly (readonly [string, string])[],
): readonly (readonly [string, string])[] {
  if (Array.isArray(params)) return params;
  return Object.entries(params);
}

/** Lowercase header keys; later bindings win on a repeated key. */
function readHeaders(
  headers: Readonly<globalThis.Record<string, string>> | undefined,
): globalThis.Record<string, string> {
  const out: globalThis.Record<string, string> = {};
  if (headers) {
    for (const key of Object.keys(headers)) out[key.toLowerCase()] = headers[key];
  }
  return out;
}

/** The accept header the options ask for, if any (`accept` wins over `acceptJson`). */
function readAccept(options: HttpRequest.Options | undefined): string | undefined {
  if (options?.accept !== undefined) return options.accept;
  if (options?.acceptJson === true) return "application/json";
  return undefined;
}

/** Build a record: method + url + normalized options (a fresh record every call). */
function buildRecord(
  method: HttpRequest.Method,
  url: string,
  options: HttpRequest.Options | undefined,
  body: HttpRequest.Body | undefined,
): HttpRequest.Record {
  const headers = readHeaders(options?.headers);
  const accept = readAccept(options);
  if (accept !== undefined) headers.accept = accept;
  const urlParams = options?.urlParams === undefined ? [] : readPairs(options.urlParams);
  return {
    method,
    url,
    urlParams,
    hash: options?.hash,
    headers,
    body: readBody(options, body),
  };
}

/** The body the record carries: the explicit builder arg wins, then the option, then empty. */
function readBody(
  options: HttpRequest.Options | undefined,
  body: HttpRequest.Body | undefined,
): HttpRequest.Body {
  if (body !== undefined) return body;
  return options?.body ?? EMPTY_BODY;
}

/** Build a `GET` record (no body). */
export function get(url: string, options?: Omit<HttpRequest.Options, "body">): HttpRequest.Record {
  return buildRecord("GET", url, options, undefined);
}

/** Build a `HEAD` record (no body). */
export function head(url: string, options?: Omit<HttpRequest.Options, "body">): HttpRequest.Record {
  return buildRecord("HEAD", url, options, undefined);
}

/** Build a `POST` record. */
export function post(url: string, options?: HttpRequest.Options): HttpRequest.Record {
  return buildRecord("POST", url, options, undefined);
}

/** Build a `PUT` record. */
export function put(url: string, options?: HttpRequest.Options): HttpRequest.Record {
  return buildRecord("PUT", url, options, undefined);
}

/** Build a `PATCH` record. */
export function patch(url: string, options?: HttpRequest.Options): HttpRequest.Record {
  return buildRecord("PATCH", url, options, undefined);
}

/** Build a `DELETE` record. */
export function del(url: string, options?: HttpRequest.Options): HttpRequest.Record {
  return buildRecord("DELETE", url, options, undefined);
}

/** Build an `OPTIONS` record. */
export function options(url: string, init?: HttpRequest.Options): HttpRequest.Record {
  return buildRecord("OPTIONS", url, init, undefined);
}

/** Derive a record: `urlParams`, `hash`, and `body` replace; `headers` merge (the option keys
 * win); `accept`/`acceptJson` set the accept header after the merge. Always a new record. */
export function modify(
  request: HttpRequest.Record,
  options: HttpRequest.Options,
): HttpRequest.Record {
  const headers: globalThis.Record<string, string> = { ...request.headers };
  const extra = readHeaders(options.headers);
  for (const key of Object.keys(extra)) headers[key] = extra[key];
  const accept = readAccept(options);
  if (accept !== undefined) headers.accept = accept;
  return {
    method: request.method,
    url: request.url,
    urlParams: options.urlParams === undefined ? request.urlParams : readPairs(options.urlParams),
    hash: options.hash === undefined ? request.hash : options.hash,
    headers,
    body: options.body ?? request.body,
  };
}

/** Prepend a base path by string concatenation (`path + url`, so a base path is kept). */
export function prependUrl(request: HttpRequest.Record, path: string): HttpRequest.Record {
  return { ...request, url: path + request.url };
}

/** Append a path suffix by string concatenation. */
export function appendUrl(request: HttpRequest.Record, path: string): HttpRequest.Record {
  return { ...request, url: request.url + path };
}

/** Set headers on a record: keys lowercased, later keys winning. Always a new record. */
export function setHeaders(
  request: HttpRequest.Record,
  headers: Readonly<globalThis.Record<string, string>>,
): HttpRequest.Record {
  const next: globalThis.Record<string, string> = { ...request.headers };
  for (const key of Object.keys(headers)) next[key.toLowerCase()] = headers[key];
  return { ...request, headers: next };
}

/** Set one header on a record (key lowercased). Always a new record. */
export function setHeader(
  request: HttpRequest.Record,
  key: string,
  value: string,
): HttpRequest.Record {
  return { ...request, headers: { ...request.headers, [key.toLowerCase()]: value } };
}

/** Replace the query pairs. Always a new record. */
export function setUrlParams(
  request: HttpRequest.Record,
  params: Readonly<globalThis.Record<string, string>> | readonly (readonly [string, string])[],
): HttpRequest.Record {
  return { ...request, urlParams: readPairs(params) };
}

/** The sendable URL: the raw url plus encoded query pairs plus the fragment. */
export function toUrl(request: HttpRequest.Record): string {
  let out = request.url;
  if (request.urlParams.length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of request.urlParams) params.append(key, value);
    out += `?${params.toString()}`;
  }
  if (request.hash !== undefined) out += `#${request.hash}`;
  return out;
}

/** The immutable request-record builders: `HttpRequest.get(...)`, `HttpRequest.bodyJson(...)`. */
export const HttpRequest = {
  get,
  head,
  post,
  put,
  patch,
  del,
  options,
  modify,
  prependUrl,
  appendUrl,
  setHeaders,
  setHeader,
  setUrlParams,
  bodyJson,
  bodyText,
  bodyBytes,
  bodyFormData,
  bodyUrlParams,
  toUrl,
};
