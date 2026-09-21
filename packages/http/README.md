# @tinker/http

An HTTP client as a **frame** of core primitives (ADR 0035): a pre-wired graph with slots the
user fills in. Nothing in it runs until an operation resolves.

```text
httpClient({ label: "github" })   // the frame
├── backend            (shared tag)             slot: how a request is sent; default fetchBackend
├── github.config      (tag, one per client)    slot: baseUrl, headers — scope, session, or per call
├── github.client      (resource, one per session) depends { backend }; execute(request, ctx): sends
└── github.operation({ label, input?, request, response? })   // the composition unit
```

## Endpoints: pure operations on the frame

An endpoint is a pure request builder plus an optional body reader. The operation is labelled
`github.listRepos` (frame label as prefix); a userland operation depends on it as a subflow.
`request` is a pure function of the parsed input; `response` reads the body once at the
process edge and is optional — when omitted the operation delivers the raw handle.

```ts
const listRepos = github.operation({
  label: "listRepos",
  input: parseUser,
  request: (user) => HttpRequest.get(`/users/${user}/repos`),
  response: (res) => res.json(parseRepos),
});

const createIssue = github.operation({
  label: "createIssue",
  input: parseIssue, // { title: string }
  request: ({ title }) => HttpRequest.post("/issues", { body: HttpRequest.bodyJson({ title }) }),
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
      tags: [github.config({ headers: { authorization: `Bearer ${await auth.token()}` } })],
    }),
});
```

## Retry: a frame slot

`httpClient({ label, retry: { times, delay? } })` — `times` extra attempts after the first
(default 0), `delay(n)` the milliseconds to wait before retry `n` (1-based, default none).
Transient only: a backend failure, or status 408, 429, 5xx. A non-transient status is never
retried, and an aborted signal never retries. Backoff sleeps on the caller's `ctx.clock`, so a
`makeTestClock` drives it deterministically in tests.

```ts
const github = httpClient({ label: "github", retry: { times: 2, delay: (n) => n * 1000 } });
```

## Observation: one child span per attempt

Every request opens one child span under the calling operation's span, named
`http GET https://api/users/octocat/repos`, with attributes `method`, `url`, `status`, and
`attempt`. It settles `ok` when the backend answered and `failed` when it did not or when the
status was rejected. A transport failure also writes one log line, `http request failed`, with
the method and url. Nothing is recorded when observation is off.

## Status: a frame slot plus response-level readers

`httpClient({ label, filterStatus })` rejects a bad status inside `execute`, before the caller
sees the response and before any endpoint `response` reader runs: a rejected status raises
`ResponseFailed/StatusCode` carrying `request` and `response` (the body stays readable by a
catch handler). Default accept all.

```ts
const github = httpClient({ label: "github", filterStatus: (status) => status < 300 });
```

Inside a `response` reader, `HttpResponse.filterStatus(res, accept)` does the same per call,
`HttpResponse.filterStatusOk(res)` is the 2xx form, and `HttpResponse.matchStatus(res, cases)`
dispatches by status — an exact status beats its class bucket (`"2xx"`/`"3xx"`/`"4xx"`/`"5xx"`),
anything unmatched falls to `orElse`:

```ts
response: (res) =>
  HttpResponse.matchStatus(res, {
    404: () => null,
    "2xx": (ok) => ok.json(parseRepo),
    orElse: (other) => {
      throw HttpResponse.filterStatusOk(other);
    },
  }),
```

## Config: one tag, three levels, same merge rule

`mergeConfig` takes a `.all` list (nearest first): `baseUrl` is the nearest binding that has
one; `headers` merge key by key, nearer winning. `applyConfig` prepends the `baseUrl` and puts
the request's own headers on top (request wins).

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
scope.session({ tags: [github.config({ headers: { authorization: `Bearer ${user}` } })] }, run);
// per call: a composing operation hands a fresh token to one subflow call
scope.run(listRepos, {
  input: "octocat",
  tags: [github.config({ headers: { authorization: `Bearer ${fresh}` } })],
});
```

A call with `tags` opens a child session for that run (ADR 0038, always a promise). The client
is `target: "session"`, so it is built in that session and its `backend` dep resolves there
(ADR 0018): a session-bound or call-bound `backend` is seen by that flow, while the root scope
keeps its own.

## Test recipe: a closure backend

No helper ships for this — a three-line closure on the tag records the outgoing request:

```ts
const seen: HttpRequest.Record[] = [];
const fake: HttpClient.Backend = async (req) => {
  seen.push(req);
  return HttpResponse.make(req, { status: 200, body: JSON.stringify([]) });
};
createScope({ tags: [backend(fake), github.config({ baseUrl: "https://api" })] });
```

## Server-sent events

`sse()` yields one event per blank-line block with data lines joined by newline; carries
`event` and `id` and skips comment lines; joins an event split across chunks; keeps a CRLF
split across chunks as one line end; an endpoint reader may return `sse()` and the operation
delivers the stream.

## Errors

`RequestFailed { request, reason: "Transport" | "Encode" | "InvalidUrl", cause? }` and
`ResponseFailed { request, response, reason: "StatusCode" | "Decode" | "EmptyBody", cause? }`.
A bodiless response raises `NoBody { status }` on `stream()` **and `sse()`** — `stream()`
never returns `null`.
Narrow with `isError(e, "RequestFailed")` by control flow, then read `payload.reason`. A forced
close while a request is in flight rethrows the signal's reason untouched — a cancel is a clean
end, not a `RequestFailed`.
