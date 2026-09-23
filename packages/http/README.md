# @tinker/http

An HTTP client as a **frame** of core primitives (ADR 0035): a pre-wired graph with slots the
user fills in. Nothing in it runs until an operation resolves.

```text
declared units (no factory — import them)
├── backend            (shared tag)             slot: how a request is sent; default fetchBackend
├── config             (shared tag)             slot: baseUrl, headers, retry, accept — scope, session, or per call
├── send               (operation)              merges config, validates the URL, retries via attempt
└── attempt            (operation)              one send through the backend; the swappable seam
```

Two clients (github, stripe) are two sessions binding the one `config` tag:

```ts
const github = scope.createSession({
  tags: [config({ baseUrl: "https://api.github.com" })],
});
const stripe = scope.createSession({
  tags: [config({ baseUrl: "https://api.stripe.com" })],
});
await github.run(listRepos, { input: "octocat" });
await stripe.run(createCharge, { input: charge });
```

## Operations: declared by the author, on `send`

The author declares the operation; `send` merges config and retries. A userland operation
depends on it as a subflow. Per-call config is `tags` on the run, never a helper. An
endpoint with no `response` reader just returns the handle.

```ts
const listRepos = operation({
  label: "github.listRepos",
  input: parseUser,
  depends: { send },
  run: async ({ send: sendIt }, ctx) => {
    const res = await sendIt.run({
      input: HttpRequest.get(`/users/${ctx.input}/repos`),
    });
    return res.json(parseRepos);
  },
});

// a composing operation: depends on the resource that owns the token and on the endpoint,
// and hands a fresh token to one subflow call via tags (a child session for that call, ADR 0038)
const onboard = operation({
  label: "onboard",
  input: parseIssue,
  depends: { auth, issue: createIssue },
  run: async ({ auth, issue }, { input }) =>
    issue.run({
      input,
      tags: [config({ headers: { authorization: `Bearer ${await auth.token()}` } })],
    }),
});
```

## Retry: a config value

`config({ retry: { times, delay? } })` — `times` extra attempts after the first (default 0),
`delay(n)` the milliseconds to wait before retry `n` (1-based, default none). Transient
only: a backend failure, or status 408, 429, 5xx. A non-transient status is never retried,
and an aborted signal never retries. Backoff sleeps on the caller's `ctx.clock`, so a
`makeTestClock` drives it deterministically in tests. Merged nearest-wins like `baseUrl`:
a session retries, the scope does not.

```ts
createScope({
  tags: [config({ baseUrl: "https://api", retry: { times: 2, delay: (n) => n * 1000 } })],
});
```

## Observation: one attempt span per try

Every try is one `attempt` subflow, so the trace reads `caller > send > attempt` with no span
code anywhere. Each attempt span carries `method`, `url`, `attempt`, and `status`. It settles
`ok` when the backend answered and `failed` when it did not or when the status was rejected.
A transport failure also writes one `http request failed` line with method and url.
Each observed operation writes a separate core step line with its label, `ms`, and outcome.
A rejected status or forced close writes no transport failure line; the step line still records failure.
With observation off, spans and core step lines are absent; a configured `log` sink still receives the transport line.

## Status: a frame slot plus response-level readers

`config({ accept })` rejects a bad status inside `attempt`, before the caller sees the
response and before any body reader runs: a rejected status raises
`ResponseFailed/StatusCode` carrying `request` and `response` (the body stays readable by a
catch handler). Default accept all.

```ts
createScope({
  tags: [config({ baseUrl: "https://api", accept: (status) => status < 300 })],
});
```

Inside a body reader, `HttpResponse.filterStatus(res, accept)` does the same per call,
`HttpResponse.filterStatusOk(res)` is the 2xx form, and `HttpResponse.matchStatus(res, cases)`
dispatches by status — an exact status beats its class bucket (`"2xx"`/`"3xx"`/`"4xx"`/`"5xx"`),
anything unmatched falls to `orElse`:

```ts
const res = await send.run({ input: HttpRequest.get("/api/repo") });
return HttpResponse.matchStatus(res, {
  404: () => null,
  "2xx": (ok) => ok.json(parseRepo),
  orElse: (other) => {
    throw HttpResponse.filterStatusOk(other);
  },
});
```

## Config: one tag, three levels, same merge rule

`mergeConfig` takes a `.all` list (nearest first): `baseUrl` is the nearest binding that has
one; `headers` merge key by key, nearer winning. `applyConfig` prepends the `baseUrl` and puts
the request's own headers on top (request wins).

```ts
// scope: the common case — base URL and a service token, once
createScope({
  tags: [
    config({
      baseUrl: "https://api.github.com",
      headers: { authorization: `Bearer ${svc}` },
    }),
  ],
});
// session: a tenant/user token for everything in that session; baseUrl inherited from the scope
scope.session({ tags: [config({ headers: { authorization: `Bearer ${user}` } })] }, run);
// per call: a composing operation hands a fresh token to one subflow call
scope.run(listRepos, {
  input: "octocat",
  tags: [config({ headers: { authorization: `Bearer ${fresh}` } })],
});
```

A call with `tags` opens a child session for that run (ADR 0038, always a promise). `attempt`
depends on the bare `backend` tag, so deps resolve at the requesting layer (ADR 0018):
a session-bound or call-bound `backend` is seen by that flow, while the root scope keeps its own.
Preset `attempt` to swap the transport in tests.

## Test recipe: a closure backend

No helper ships for this — a three-line closure on the tag records the outgoing request:

```ts
const seen: HttpRequest.Record[] = [];
const fake: HttpClient.Backend = async (req) => {
  seen.push(req);
  return HttpResponse.make(req, { status: 200, body: JSON.stringify([]) });
};
createScope({ tags: [backend(fake), config({ baseUrl: "https://api" })] });
```

## Server-sent events

`sse()` yields one event per blank-line block with data lines joined by newline; carries
`event` and `id` and skips comment lines; joins an event split across chunks; dispatches a pending event when the stream ends without a blank line; keeps a CRLF
split across chunks as one line end; a body reader may return `sse()` and the operation
delivers the stream.

## Errors

`RequestFailed { request, reason: "Transport" | "Encode" | "InvalidUrl", cause? }` and
`ResponseFailed { request, response, reason: "StatusCode" | "Decode" | "EmptyBody", cause? }`.
A scope closed before an attempt reaches the backend rejects with core's `Disposed`, never a
wrapped `RequestFailed/Transport` — the network was not touched, so nothing blames it.
A bodiless response raises `NoBody { status }` on `stream()` **and `sse()`** — `stream()`
never returns `null`.
Narrow with `isError(e, "RequestFailed")` by control flow, then read `payload.reason`. A forced
close while a request is in flight rethrows the signal's reason untouched — a cancel is a clean
end, not a `RequestFailed`.
