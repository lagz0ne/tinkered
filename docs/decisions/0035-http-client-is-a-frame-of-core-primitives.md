# 0035 The HTTP client is a pre-wired frame of core primitives (Effect HttpClient model)

Date: 2026-09-17. Status: accepted. Refines: 0034 (tiers), 0015 (preset), 0020 (subflows).

## Context

The first **dedicated capability** (ADR 0034 tiers) is an HTTP client. It must be a
"tinkered-first" component: glue without side effects, the scope as the single configuration
point, testable through the existing seams with no mocks, and observable (logging + spans)
without the caller doing anything.

The precedent is Effect's `HttpClient` (`@effect/platform` 0.97): an immutable
`HttpClientRequest` record, an `HttpClientResponse` over the transport's response, a client
service in the context, a fetch-backed layer whose `fetch` is swappable through the
`FetchHttpClient.Fetch` tag, and `RequestError`/`ResponseError` with reason unions. The backend
shape follows Go's `http.Client` + `Transport`: the client is policy, the transport is one
function that sends a request.

Where we are simpler: **no client combinators and no `pipe`**. Effect composes behaviour by
piping the client (`mapRequest`, `filterStatusOk`, `retry`, …). Core already composes work by
nesting operations (subflows, ADR 0020), so an HTTP call is an **operation** and the chain is
the operation graph, not a client pipeline.

## Decision

`@tinker/http` (`packages/http`, size cap 10 kB gzip) ships a **frame**: a pre-wired graph of
core primitives with **slots** the user fills in. Nothing in it runs until an operation resolves.

```text
httpClient({ label: "github", retry?, filterStatus? })   // the frame
├── backend            (shared tag)             slot: how a request is sent; default fetchBackend
├── github.config      (tag, one per client)    slot: baseUrl, headers — scope, session, or per call
├── github.client      (resource, one per scope) depends { backend }; execute(request, ctx): sends,
│                                               retries transient failures, filters status, spans, logs
└── github.operation({ label, input?, request, response? })
      an ordinary operation: depends { client, config: github.config.all }; per call it merges the
      config bindings (nearest wins), applies baseUrl + headers, forwards its OWN ctx to execute
```

Spans nest by construction: a userland operation → the endpoint operation (a subflow, ADR
0020/0022) → one `http <METHOD> <url>` child span opened in the endpoint's own ctx.

- **Backend** (the "swappable backend via scope tags"): a shared tag `backend` whose value is
  `(request: HttpRequest.Record, signal: AbortSignal) => Promise<HttpResponse.Handle>`. Default
  `fetchBackend` (web `fetch`, universal). A Node/undici backend is userland: call undici and
  build a response with `HttpResponse.make`. Pooling and caching live inside a backend, not in
  the resource. Tags layer, so a session may bind a different backend than its scope.
- **Config tag, one per client**: `github.config({ baseUrl, headers })`. Two clients in one
  scope are two frames with two config tags. This is Effect's `RequestInit` tag, made per-client
  so a scope configures each API independently. It is **read per call by the endpoint operation**
  (`github.config.all`, merged nearest-wins: a later binding's `baseUrl` replaces, `headers` merge
  key by key), not by the resource at build — so a session may rebind it, and a composing
  operation may hand a call-scoped value (an auth header from a resource it depends on) through
  the subflow's `tags` (ADR 0022). `mergeConfig(bindings)` is exported for custom operations.
  One tag, three levels, same merge rule:

  ```ts
  // scope: the common case — base URL and a service token, once
  createScope({
    tags: [
      github.config({
        baseUrl: "https://api.github.com",
        headers: { authorization: `Bearer ${svc}` },
      }),
    ],
  });
  // session: a tenant/user token for everything in that session; baseUrl inherited from the scope
  scope.session(
    { tags: [github.config({ headers: { authorization: `Bearer ${userToken}` } })] },
    run,
  );
  // per call: a composing operation that owns a fresh token hands it to one subflow call
  listRepos.resolve({
    input: user,
    tags: [github.config({ headers: { authorization: `Bearer ${fresh}` } })],
  });
  ```

- **Client resource**: `target: "scope"`, depends on `backend` only; it carries the frame's
  policy (`retry`, `filterStatus`). Its one method is `execute(request, ctx)` — the request
  arrives already configured (absolute URL, merged headers). `ctx` is the **caller's** ctx (`signal`, `obs`, `log`,
  `clock`, as on `Operation.Ctx`/`Resource.Ctx`): cancellation is the caller's `ctx.signal`
  (ADR 0034's explicit-signal rule, nothing new), the request span nests under the caller's
  span, failures are logged through the caller's `log`, and retry backoff sleeps on the caller's
  `clock` (a `TestClock` drives it). No `get/post` sugar on the instance: it would be a facade
  over `execute(HttpRequest.get(...), ctx)`.
- **Endpoint operation**: `github.operation({ label, input?, request, response? })` returns a
  normal `Operation.Handle` labelled `github.listRepos` (frame label as prefix — the span name).
  `request: (input) => HttpRequest.Record` is a pure function of the input; `response` reads the
  body once at the process edge (`res.json(parse)`, ADR 0006) and is optional — when omitted the
  operation delivers the raw `HttpResponse.Handle`, as Effect does. An endpoint declares **no
  other `depends`**: anything dynamic (a token, a tenant base URL) is composed in a userland
  operation that depends on the endpoint and on whatever owns the value, and passes it via
  per-call `tags` or a session binding. This keeps every endpoint presettable and pure.
- **Request record** = Effect's: `{ method, url, urlParams, hash, headers, body }` built by
  `HttpRequest.get/post/put/patch/del/head/options(url, options?)` with body builders
  (`bodyJson`, `bodyText`, `bodyBytes`, `bodyFormData`, `bodyUrlParams`) and `modify(req, opts)`.
  Data-first, no `pipe`. `prependUrl` is string concatenation (Effect's semantics; `new URL`
  would drop a base path). The endpoint applies the merged config with `applyConfig(request,
config)` = `prependUrl` + header merge, request headers winning over config headers; the same
  function serves a custom operation that calls `execute` directly.
- **Response record**: a base every backend fills (`status`, `headers`, `request`, body readers
  `text/json/arrayBuffer/formData/stream`) plus `source`: the adapter's own object (the web
  `Response` for `fetchBackend`) for anything backend-specific. `HttpResponse.fromWeb` and
  `HttpResponse.make` construct it; `filterStatus`, `filterStatusOk`, `matchStatus` are
  response-level functions usable inside `response` readers.
- **Status policy is a frame slot**: `httpClient({ label, filterStatus?: (status) => boolean })`,
  default accept all. A rejected status fails `execute` with `ResponseFailed/StatusCode` before
  `response` runs — Effect's `filterStatusOk` applied once on the client, expressed as config, so
  endpoints do not repeat it.
- **Errors** (`packages/http/src/errors.ts`, ADR 0004): `RequestFailed { request, reason:
"Transport" | "Encode" | "InvalidUrl", cause? }` and `ResponseFailed { request, response,
reason: "StatusCode" | "Decode" | "EmptyBody", cause? }` — Effect's unions.
- **Retry** is a frame slot: `httpClient({ label, retry: { times, delay?: (attempt) => ms } })`.
  Transient only: `RequestFailed/Transport`, status 408, 429, 5xx. An aborted signal never
  retries. Backoff is `ctx.clock.sleep(delay(attempt), ctx.signal)`.
- **Observation + logging** are built in: `execute` opens a manual child span
  (`http <METHOD> <url>`, attributes method/url/status), marks it failed on error, and writes one
  `log` line on failure. Behaviour-neutral (ADR 0009).
- **Test seam = `preset`** (ADR 0015). Swap the resource (`preset(github.client, () => fake)`)
  or the endpoint itself (`preset(repos, () => [])`). A test that wants to see the outgoing
  request binds a three-line backend on the tag:

  ```ts
  const seen: HttpRequest.Record[] = [];
  const fake: HttpClient.Backend = async (req) => {
    seen.push(req);
    return HttpResponse.make(req, { status: 200, body: JSON.stringify([]) });
  };
  createScope({ tags: [backend(fake), github.config({ baseUrl: "https://api" })] });
  ```

  No helper ships for this until a test needs recording that the closure above cannot do.

## Surface (v1)

```ts
export const backend: Tag.Handle<HttpClient.Backend>; // default fetchBackend
export const fetchBackend: HttpClient.Backend;
export function httpClient(config: {
  label: string;
  retry?: HttpClient.Retry;
  filterStatus?: (status: number) => boolean;
  meta?;
}): HttpClient.Frame;
export function mergeConfig(bindings: readonly HttpClient.Config[]): HttpClient.Config; // nearest-first in (a `.all` list)
export function applyConfig(
  request: HttpRequest.Record,
  config: HttpClient.Config,
): HttpRequest.Record; // prepend baseUrl; config headers under request headers

export declare namespace HttpClient {
  type Backend = (request: HttpRequest.Record, signal: AbortSignal) => Promise<HttpResponse.Handle>;
  type Config = { readonly baseUrl?: string; readonly headers?: Readonly<Record<string, string>> };
  type Retry = { readonly times: number; readonly delay?: (attempt: number) => number };
  type Ctx = Pick<Operation.Ctx<unknown>, "signal" | "obs" | "log" | "clock">;
  type Handle = {
    readonly label: string;
    execute(request: HttpRequest.Record, ctx: Ctx): Promise<HttpResponse.Handle>;
  };
  type Endpoint<I, T> = {
    label: string;
    input?: Data.Parse<I>;
    request: (input: I) => HttpRequest.Record;
    response?: (response: HttpResponse.Handle) => T | PromiseLike<T>;
  };
  type Frame = {
    readonly label: string;
    readonly config: Tag.Handle<Config>;
    readonly client: Resource.Handle<Handle>;
    operation<I = void, T = HttpResponse.Handle>(
      endpoint: Endpoint<I, T>,
    ): Operation.Handle<Promise<T>, I>;
  };
}
```

## Consequences

- One new package, no core change. Universal bundle: `fetchBackend` is web-standard; anything
  Node-only (undici, agents) stays in userland backends.
- Configuration is entirely at the scope: `backend(...)` once, `x.config(...)` per client.
  Production code never presets; tests preset or bind a fake backend.
- Because `execute` takes the caller's ctx, a forced close aborts in-flight requests and the run
  settles `cancelled` (ADR 0028); a `TestClock` makes retry deterministic; spans nest correctly.
- The generated endpoint operation is the composition unit: other operations depend on it as a
  subflow (ADR 0020). No client-level combinators will be added; behaviour that Effect expresses
  as `mapRequest`/`transform` is either config (baseUrl/headers) or an operation.
- Reading config per call costs one `.all` tag walk per request (a linear chain scan) — off the
  hot path of core, negligible next to a network round trip.

## Alternatives rejected

- **Effect's `pipe` + client combinators** — a second composition model beside operation
  nesting; costs size and a `Pipeable` protocol. Operations already nest.
- **Fetch-shaped backend (`Request → Response`)** — forces non-fetch backends (undici) to fake a
  web `Response`. The record + `source` keeps the base common and the adapter data reachable.
- **`get/post/...` on the client instance** — a facade over `execute(HttpRequest.get(...))`.
- **Per-client backend override in `config`** — YAGNI; tags already layer per session. Additive
  later if two backends in one scope becomes real.
- **A shipped `makeTestFetch` recorder** — `preset` plus a closure backend covers today's tests.
- **Cookies, redirects, tracer propagation** — Node/browser-specific or belong to the backend.
- **Extra `depends` on endpoints** (`request(input, deps)`) — composition already lives in a
  userland operation; a dependency on the endpoint would drag the auth resource into every test
  and blur what `preset(endpoint)` replaces. Per-call `tags` + session bindings cover it.
- **Config read by the resource at build** — a scope-target resource builds at the root and
  would never see a session or per-call binding (ADR 0018).
