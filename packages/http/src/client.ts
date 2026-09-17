import {
  operation as operationCore,
  resource,
  tag,
  type Data,
  type Operation,
  type Resource,
  type Tag,
} from "@tinker/core";
import { isError, raise } from "./errors.ts";
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
  /** Retry policy for a frame: `times` extra attempts after the first (`{ times: 0 }` never
   * retries); `delay` maps the 1-based wait number to ms slept on `ctx.clock` before that retry
   * (`delay(1)` is the first wait, after attempt 1), default no wait. Only transient failures
   * retry — a rejected backend, or a received 408, 429, or 5xx — never after `ctx.signal` aborts. */
  export type Retry = { readonly times: number; readonly delay?: (attempt: number) => number };
  /** The caller's receiver an `execute` sends through: the signal aborts on close, the rest is
   * the caller's own observation, logging, and clock (as on `Operation.Ctx`). */
  export type Ctx = Pick<Operation.Ctx<unknown>, "signal" | "obs" | "log" | "clock">;
  /** A built client: one method, `execute`, over an already-configured request (absolute URL,
   * merged headers) with the caller's ctx. */
  export type Handle = {
    readonly label: string;
    execute(request: HttpRequest.Record, ctx: Ctx): Promise<HttpResponse.Handle>;
  };
  /** An endpoint: a pure request builder plus an optional body reader. `request` is a pure
   * function of the parsed input; `response` reads the body once at the process edge
   * (`res.json(parse)`, ADR 0006) and is optional — when omitted the operation delivers the raw
   * `HttpResponse.Handle`. Declares no other `depends`: anything dynamic (a token, a tenant
   * base URL) is composed in a userland operation that depends on the endpoint and passes it
   * via per-call `tags` or a session binding, so every endpoint stays presettable and pure. */
  export type Endpoint<I, T> = {
    label: string;
    input?: Data.Parse<I>;
    request: (input: I) => HttpRequest.Record;
    response?: (response: HttpResponse.Handle) => T | PromiseLike<T>;
  };
  /** The `operation` method on a frame: one overload per response shape — an endpoint with a
   * `response` reader delivers its value, one without delivers the raw handle. */
  export type OperationFn = {
    <I = void, T = HttpResponse.Handle>(
      endpoint: Endpoint<I, T> & {
        response: (response: HttpResponse.Handle) => T | PromiseLike<T>;
      },
    ): Operation.Handle<Promise<T>, I>;
    <I = void>(
      endpoint: Endpoint<I, HttpResponse.Handle>,
    ): Operation.Handle<Promise<HttpResponse.Handle>, I>;
  };
  /** The frame `httpClient` returns: its label, its per-client `config` tag, its `client`
   * resource, and `operation` — the composition unit — which turns an endpoint into an ordinary
   * operation labelled `${frame.label}.${endpoint.label}`. A userland operation depends on the
   * endpoint as a subflow and hands a per-call value (a fresh token) through `tags`. */
  export type Frame = {
    readonly label: string;
    readonly config: Tag.Handle<Config>;
    readonly client: Resource.Handle<Handle>;
    readonly operation: OperationFn;
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
 * at the requesting layer and a session-bound `backend` is seen), whose factory closes over the
 * frame's `filterStatus` predicate (default accept all) and `retry` policy (default never retry)
 * and returns the `Handle`. The handle is a tiny object, so one build per session costs nothing. */
export function httpClient(config: {
  label: string;
  retry?: HttpClient.Retry;
  filterStatus?: (status: number) => boolean;
  meta?: readonly Tag.Binding<unknown>[];
}): HttpClient.Frame {
  const accept = config.filterStatus ?? acceptAll;
  const retry = config.retry ?? noRetry;
  const configTag: Tag.Handle<HttpClient.Config> = tag({
    label: `${config.label}.config`,
    meta: config.meta,
  });
  const frameLabel = config.label;
  const client: Resource.Handle<HttpClient.Handle> = resource({
    label: `${config.label}.client`,
    target: "session",
    depends: { send: backend },
    factory: ({ send }) => ({
      label: config.label,
      execute: (request, ctx) => execute(send, request, ctx, accept, retry),
    }),
  });
  const frameBase = { label: frameLabel, config: configTag, client };
  return {
    ...frameBase,
    operation: readEndpointOperation(frameBase),
  };
}

/** The frame's default status policy: accept every status. */
function acceptAll(_status: number): boolean {
  return true;
}

/** The frame's default retry policy: no retry. Shared — never mutated. */
const noRetry: HttpClient.Retry = { times: 0 };

/** Transient in v1 (fixed policy, not configurable): 408, 429, or 5xx — worth another attempt. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Bind the frame's `operation` method: one overload per response shape, closing over the
 * frame's label, config tag, and client resource. */
function readEndpointOperation(frame: Omit<HttpClient.Frame, "operation">): HttpClient.OperationFn {
  function operation<I = void, T = HttpResponse.Handle>(
    endpoint: HttpClient.Endpoint<I, T> & {
      response: (response: HttpResponse.Handle) => T | PromiseLike<T>;
    },
  ): Operation.Handle<Promise<T>, I>;
  function operation<I = void>(
    endpoint: HttpClient.Endpoint<I, HttpResponse.Handle>,
  ): Operation.Handle<Promise<HttpResponse.Handle>, I>;
  function operation(
    endpoint: HttpClient.Endpoint<unknown, unknown>,
  ): Operation.Handle<Promise<unknown>, unknown> {
    const read = endpoint.response;
    return operationCore({
      label: `${frame.label}.${endpoint.label}`,
      input: endpoint.input,
      depends: { client: frame.client, config: frame.config.all },
      run: async ({ client, config }, ctx) => {
        const request = applyConfig(endpoint.request(ctx.input), mergeConfig(config));
        const received = await client.execute(request, ctx);
        if (read !== undefined) return read(received);
        return received;
      },
    });
  }
  return operation;
}

/** Send an already-configured request through `send`, retrying transient failures: validate the
 * final URL once (failure → `RequestFailed/InvalidUrl` with `cause`); then loop up to
 * `retry.times + 1` attempts — `waitBeforeRetry` sleeps `ctx.clock` before every retry (an abort
 * during the wait rejects with the signal reason, no further call); each attempt is one `sendOnce`
 * in its own child span. A backend rejection logs one `http request failed` line and retries while
 * attempts remain, else becomes `RequestFailed/Transport` with the last cause — except when
 * `ctx.signal` aborted: the signal's reason is rethrown untouched (a cancel is a clean end,
 * ADR 0028). A received transient status with attempts remaining retries too; otherwise the
 * frame's `filterStatus` predicate runs BEFORE the caller sees the response (a rejected status
 * raises `ResponseFailed/StatusCode` carrying `request` and `response`, the body staying readable
 * by a catch handler). With `times: 0` the loop runs once and allocates nothing beyond today's
 * single send. */
async function execute(
  send: HttpClient.Backend,
  request: HttpRequest.Record,
  ctx: HttpClient.Ctx,
  accept: (status: number) => boolean,
  retry: HttpClient.Retry,
): Promise<HttpResponse.Handle> {
  const url = HttpRequest.toUrl(request);
  try {
    new URL(url);
  } catch (cause) {
    raise("RequestFailed", { request, reason: "InvalidUrl", cause });
  }
  const tries = retry.times + 1;
  for (let attempt = 1; ; attempt += 1) {
    await waitBeforeRetry(ctx, retry, attempt);
    try {
      const received = await sendOnce(send, request, url, ctx, accept, attempt, tries);
      if (retriesStatus(received.status, attempt, tries)) continue;
      return received;
    } catch (error) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      if (isError(error, "ResponseFailed")) throw error;
      if (attempt < tries) continue;
      raise("RequestFailed", { request, reason: "Transport", cause: error });
    }
  }
}

/** Sleep `retry.delay` for the 1-based wait number on `ctx.clock` before a retry (`delay(1)` is the
 * first wait, after attempt 1), default no wait; the first attempt never waits. An abort during the
 * wait rejects with the signal reason. */
async function waitBeforeRetry(
  ctx: HttpClient.Ctx,
  retry: HttpClient.Retry,
  attempt: number,
): Promise<void> {
  if (attempt === 1) return;
  await ctx.clock.sleep(retry.delay?.(attempt - 1) ?? 0, ctx.signal);
}

/** True while attempts remain and the received status is transient: policy says try again. */
function retriesStatus(status: number, attempt: number, tries: number): boolean {
  return attempt < tries && isTransientStatus(status);
}

/** One attempt inside its own manual child span (`http <METHOD> <url>`, attributes method/url/status
 * plus the 1-based `attempt`): a backend rejection logs one line and rethrows raw (the loop wraps
 * it); a received transient status with attempts remaining returns raw — that attempt's span
 * settles `"ok"` (the transport succeeded, the retry is policy) — otherwise `accept` runs inside
 * the span, so a rejected status settles it `"failed"`. */
async function sendOnce(
  send: HttpClient.Backend,
  request: HttpRequest.Record,
  url: string,
  ctx: HttpClient.Ctx,
  accept: (status: number) => boolean,
  attempt: number,
  tries: number,
): Promise<HttpResponse.Handle> {
  return ctx.obs.child(`http ${request.method} ${url}`, async (span) => {
    if (span !== undefined) {
      span.attributes.method = request.method;
      span.attributes.url = url;
      span.attributes.attempt = attempt;
    }
    let delivered: HttpResponse.Handle;
    try {
      delivered = await send(request, ctx.signal);
    } catch (error) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      ctx.log("http request failed", { method: request.method, url });
      throw error;
    }
    if (span !== undefined) span.attributes.status = delivered.status;
    if (retriesStatus(delivered.status, attempt, tries)) return delivered;
    if (!accept(delivered.status)) {
      raise("ResponseFailed", { request, response: delivered, reason: "StatusCode" });
    }
    return delivered;
  });
}
