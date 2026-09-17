import { resource, tag, type Operation, type Resource, type Tag } from "@tinker/core";
import { raise } from "./errors.ts";
import { HttpRequest } from "./request.ts";
import { HttpResponse } from "./response.ts";

export declare namespace HttpClient {
  /** How a request is sent: the frame's one swappable slot (the `backend` tag's value). */
  export type Backend = (
    request: HttpRequest.Record,
    signal: AbortSignal,
  ) => Promise<HttpResponse.Handle>;
  /** Per-client configuration: a base URL prepended to relative paths, headers merged under the
   * request's own. Bound on the frame's `config` tag at any layer (scope, session, per call). */
  export type Config = {
    readonly baseUrl?: string;
    readonly headers?: Readonly<globalThis.Record<string, string>>;
  };
  /** The caller's receiver an `execute` sends through: the signal aborts on close, the rest is
   * the caller's own observation, logging, and clock (as on `Operation.Ctx`). */
  export type Ctx = Pick<Operation.Ctx<unknown>, "signal" | "obs" | "log" | "clock">;
  /** A built client: one method, `execute`, over an already-configured request (absolute URL,
   * merged headers) with the caller's ctx. */
  export type Handle = {
    readonly label: string;
    execute(request: HttpRequest.Record, ctx: Ctx): Promise<HttpResponse.Handle>;
  };
  /** The frame `httpClient` returns: its label, its per-client `config` tag, its `client`
   * resource. Nothing runs until an operation resolves. */
  export type Frame = {
    readonly label: string;
    readonly config: Tag.Handle<Config>;
    readonly client: Resource.Handle<Handle>;
  };
}

/** Send a record over web `fetch`: method, headers, body by kind (text/bytes carry their content
 * type when the record sets none; formData and urlParams become their web bodies; empty sends
 * nothing; GET/HEAD never send a body), `signal`, then wrap with `HttpResponse.fromWeb`. A thrown
 * fetch error is NOT wrapped here — `execute` wraps it, so a custom backend gets the same
 * treatment. */
export const fetchBackend: HttpClient.Backend = async (
  request: HttpRequest.Record,
  signal: AbortSignal,
): Promise<HttpResponse.Handle> => {
  const headers: globalThis.Record<string, string> = { ...request.headers };
  const body = readFetchBody(request.body, headers);
  const response = await globalThis.fetch(HttpRequest.toUrl(request), {
    method: request.method,
    headers,
    body: sendsBody(request.method) ? body : undefined,
    signal,
  });
  return HttpResponse.fromWeb(request, response);
};

/** True for verbs that may carry a body (`GET`/`HEAD` never send one). */
function sendsBody(method: HttpRequest.Method): boolean {
  return method !== "GET" && method !== "HEAD";
}

/** The fetch body for a record body: text/bytes carry their content type when the record sets
 * none; formData and urlParams become their web bodies; empty sends nothing. */
function readFetchBody(
  content: HttpRequest.Body,
  headers: globalThis.Record<string, string>,
): string | Uint8Array | FormData | URLSearchParams | undefined {
  if (content.kind === "text") {
    if (headers["content-type"] === undefined) headers["content-type"] = content.contentType;
    return content.text;
  }
  if (content.kind === "bytes") {
    if (headers["content-type"] === undefined) headers["content-type"] = content.contentType;
    return content.bytes;
  }
  if (content.kind === "formData") return content.formData;
  if (content.kind === "urlParams") return readFetchParams(content.params);
  return undefined;
}

/** URL-encoded params as a web body. */
function readFetchParams(pairs: readonly (readonly [string, string])[]): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of pairs) params.append(key, value);
  return params;
}

/** The shared slot for how a request is sent; default `fetchBackend`. Bind another backend on a
 * scope or session to observe or replace the transport — `preset` is never needed for this. */
export const backend: Tag.Handle<HttpClient.Backend> = tag({
  label: "http.backend",
  default: fetchBackend,
});

/** Merge one `.all` config list, nearest first (ADR 0012): `baseUrl` is the nearest binding that
 * has one; `headers` merge key by key, nearer winning, keys lowercased. Empty list → `{}`. */
export function mergeConfig(bindings: readonly HttpClient.Config[]): HttpClient.Config {
  return { baseUrl: readBaseUrl(bindings), headers: readMergedHeaders(bindings) };
}

/** The nearest `baseUrl` in a nearest-first `.all` list, if any binding has one. */
function readBaseUrl(bindings: readonly HttpClient.Config[]): string | undefined {
  for (const binding of bindings) {
    if (binding.baseUrl !== undefined) return binding.baseUrl;
  }
  return undefined;
}

/** Headers merged key by key (nearer winning, keys lowercased) — undefined when none bind any. */
function readMergedHeaders(
  bindings: readonly HttpClient.Config[],
): globalThis.Record<string, string> | undefined {
  let headers: globalThis.Record<string, string> | undefined;
  for (const binding of bindings) {
    if (binding.headers === undefined) continue;
    headers ??= {};
    for (const key of Object.keys(binding.headers)) {
      const lower = key.toLowerCase();
      if (headers[lower] === undefined) headers[lower] = binding.headers[key];
    }
  }
  return headers;
}

/** Apply a merged config to a request: prepend `baseUrl` when present; headers are the config's
 * with the request's own on top (request wins). Pure — always a new record. */
export function applyConfig(
  request: HttpRequest.Record,
  config: HttpClient.Config,
): HttpRequest.Record {
  const based =
    config.baseUrl === undefined ? request : HttpRequest.prependUrl(request, config.baseUrl);
  return config.headers === undefined
    ? based
    : HttpRequest.setHeaders(HttpRequest.setHeaders(based, config.headers), request.headers);
}

/** Build the frame: a `config` tag labelled `${label}.config` (no default: absent means no
 * bindings, `.all` reads `[]`), a `client` resource labelled `${label}.client` (`target:
 * "session"`, `depends: { send: backend }` — the bare tag delivers its value — so deps resolve
 * at the requesting layer and a session-bound `backend` is seen), whose factory returns the
 * `Handle`. The handle is a tiny object, so one build per session costs nothing. */
export function httpClient(config: {
  label: string;
  meta?: readonly Tag.Binding<unknown>[];
}): HttpClient.Frame {
  const configTag: Tag.Handle<HttpClient.Config> = tag({
    label: `${config.label}.config`,
    meta: config.meta,
  });
  const client: Resource.Handle<HttpClient.Handle> = resource({
    label: `${config.label}.client`,
    target: "session",
    depends: { send: backend },
    factory: ({ send }) => ({
      label: config.label,
      execute: (request, ctx) => execute(send, request, ctx),
    }),
  });
  return { label: config.label, config: configTag, client };
}

/** Send an already-configured request through `send`: validate the final URL once (failure →
 * `RequestFailed/InvalidUrl` with `cause`); a backend rejection becomes `RequestFailed/Transport`
 * with `cause` — except when `ctx.signal` aborted: the signal's reason is rethrown untouched (a
 * cancel is a clean end, ADR 0028). Nothing else in t01. */
async function execute(
  send: HttpClient.Backend,
  request: HttpRequest.Record,
  ctx: HttpClient.Ctx,
): Promise<HttpResponse.Handle> {
  try {
    new URL(HttpRequest.toUrl(request));
  } catch (cause) {
    raise("RequestFailed", { request, reason: "InvalidUrl", cause });
  }
  try {
    return await send(request, ctx.signal);
  } catch (error) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    raise("RequestFailed", { request, reason: "Transport", cause: error });
  }
}
