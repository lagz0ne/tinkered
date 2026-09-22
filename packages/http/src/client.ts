import {
  isError as isCoreError,
  operation as operationCore,
  tag,
  type Operation,
  type Scope,
  type Tag,
} from "@tinker/core";
import { isError, raise } from "./errors.ts";
import { HttpRequest } from "./request.ts";
import { HttpResponse } from "./response.ts";

export declare namespace HttpClient {
  /** How a request is sent: the one swappable slot (the `backend` tag's value). */
  export type Backend = (
    request: HttpRequest.Record,
    signal: AbortSignal,
  ) => Promise<HttpResponse.Handle>;
  /** Client configuration, bound on the shared `config` tag at any layer (scope, session, per
   * call) and merged nearest-wins: a base URL prepended to relative paths, headers merged under
   * the request's own, a retry policy (default never retry), and a status predicate (default
   * accept all). Plain values — no factory, no closure. */
  export type Config = {
    readonly baseUrl?: string;
    readonly headers?: Readonly<globalThis.Record<string, string>>;
    readonly retry?: Retry;
    readonly accept?: (status: number) => boolean;
  };
  /** Retry policy for a send: `times` extra attempts after the first (`{ times: 0 }` never
   * retries); `delay` maps the 1-based wait number to ms slept on `ctx.clock` before that retry
   * (`delay(1)` is the first wait, after attempt 1), default no wait. Only transient failures
   * retry — a rejected backend, or a received 408, 429, or 5xx — never after `ctx.signal` aborts. */
  export type Retry = { readonly times: number; readonly delay?: (attempt: number) => number };
  /** The caller's receiver an `execute` sends through: the signal aborts on close, the rest is
   * the caller's own observation, logging, and clock (as on `Operation.Ctx`). */
  export type Ctx = Pick<Operation.Ctx<unknown>, "signal" | "obs" | "log" | "clock">;
  /** One send: the already-merged request, its absolute URL, and which try this is. The `send`
   * operation builds it; nothing else does, so it carries no parse (see core's Operation input). */
  export type Attempt = {
    readonly request: HttpRequest.Record;
    readonly url: string;
    readonly attempt: number;
    readonly tries: number;
  };
  /** The declared units: one shared `config` tag plus two operations to depend on. `send`
   * merges config, validates the URL once, and retries transient failures by running `attempt`
   * as a subflow — so a caller's trace reads `caller > send > attempt` with no span code
   * anywhere (ADR 0058). A per-call value (a fresh token) rides on the run's `tags`. */
  export type Units = {
    readonly config: Tag.Handle<Config>;
    readonly send: Operation.Handle<Promise<HttpResponse.Handle>, HttpRequest.Record>;
    readonly attempt: Operation.Handle<Promise<HttpResponse.Handle>, Attempt>;
  };
}

/** Send a record over web `fetch`: method, headers, body by kind (text/bytes carry their content
 * type when the record sets none; formData and urlParams become their web bodies; empty sends
 * nothing; GET/HEAD never send a body), `signal`, then wrap with `HttpResponse.fromWeb`. A thrown
 * fetch error is NOT wrapped here — `attempt` wraps it, so a custom backend gets the same
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
 * has one; `headers` merge key by key, nearer winning, keys lowercased; `retry` and `accept`
 * are the nearest binding that sets each. Empty list → `{}`. */
export function mergeConfig(bindings: readonly HttpClient.Config[]): HttpClient.Config {
  return {
    baseUrl: readBaseUrl(bindings),
    headers: readMergedHeaders(bindings),
    retry: readRetry(bindings),
    accept: readAccept(bindings),
  };
}

/** The nearest `retry` in a nearest-first `.all` list, if any binding sets one. */
function readRetry(
  bindings: readonly HttpClient.Config[],
): HttpClient.Retry | undefined {
  for (const binding of bindings) {
    if (binding.retry !== undefined) return binding.retry;
  }
  return undefined;
}

/** The nearest `accept` in a nearest-first `.all` list, if any binding sets one. */
function readAccept(
  bindings: readonly HttpClient.Config[],
): ((status: number) => boolean) | undefined {
  for (const binding of bindings) {
    if (binding.accept !== undefined) return binding.accept;
  }
  return undefined;
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

/** The shared config slot; no default (absent means no bindings, `.all` reads `[]`). Bind
 * `baseUrl`, `headers`, `retry`, and `accept` at any layer — scope, session, per call. Two
 * clients (github, stripe) are two sessions binding this one tag. */
export const config: Tag.Handle<HttpClient.Config> = tag({ label: "http.config" });

/** One send through the backend. Its own span carries the method, url, attempt, and status,
 * so the retry is visible without any span code (ADR 0058). It reads `accept` from the merged
 * config bindings (default accept all), so a per-call `tags: [config({ accept })]` is seen. */
export const attempt: Operation.Handle<Promise<HttpResponse.Handle>, HttpClient.Attempt> =
  operationCore({
    label: "http.attempt",
    depends: { send: backend, config: config.all },
    run: async ({ send, config: bindings }, ctx) =>
      sendOnce(send, ctx.input, ctx, mergeConfig(bindings).accept ?? acceptAll),
  });

/** Merge the config bindings nearest-first, validate the URL once, then run `attempt` as a
 * subflow until it delivers or the tries run out. `retry` is the merged policy (default never
 * retry). */
export const send: Operation.Handle<Promise<HttpResponse.Handle>, HttpRequest.Record> =
  operationCore({
    label: "http.send",
    depends: { attempt, config: config.all },
    run: (deps, ctx) => {
      const merged = mergeConfig(deps.config);
      return runSend(
        deps.attempt,
        applyConfig(ctx.input, merged),
        ctx,
        merged.retry ?? noRetry,
      );
    },
  });

/** The retry loop: each try is one `attempt` subflow, so each gets its own nested span. A
 * transient status or a rejected backend tries again until `retry.times + 1` is spent. */
async function runSend(
  attempt: Scope.OperationController<Promise<HttpResponse.Handle>, HttpClient.Attempt>,
  request: HttpRequest.Record,
  ctx: Operation.Ctx<HttpRequest.Record>,
  retry: HttpClient.Retry,
): Promise<HttpResponse.Handle> {
  const url = HttpRequest.toUrl(request);
  try {
    new URL(url);
  } catch (cause) {
    raise("RequestFailed", { request, reason: "InvalidUrl", cause });
  }
  const tries = retry.times + 1;
  for (let n = 1; ; n += 1) {
    await waitBeforeRetry(ctx, retry, n);
    try {
      const received = await attempt.run({ input: { request, url, attempt: n, tries } });
      if (retriesStatus(received.status, n, tries)) continue;
      return received;
    } catch (error) {
      if (propagates(error, ctx)) throw ctx.signal.aborted ? ctx.signal.reason : error;
      if (n < tries) continue;
      raise("RequestFailed", { request, reason: "Transport", cause: error });
    }
  }
}

/** Errors that end the send exactly as they are, instead of buying another try: the caller
 * aborted, the scope closed before the backend was reached (core's `Disposed` — a cancellation,
 * never a transport failure that blames a network nobody touched), or the status was rejected. */
function propagates(error: unknown, ctx: Operation.Ctx<HttpRequest.Record>): boolean {
  if (ctx.signal.aborted) return true;
  if (isCoreError(error, "Disposed")) return true;
  return isError(error, "ResponseFailed");
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
  call: HttpClient.Attempt,
  ctx: Operation.Ctx<HttpClient.Attempt>,
  accept: (status: number) => boolean,
): Promise<HttpResponse.Handle> {
  const { request, url, attempt, tries } = call;
  const span = ctx.obs.span;
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
}
