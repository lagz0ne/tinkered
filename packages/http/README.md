# @tinker/http

Shared tags and operations make the HTTP client (ADR 0035).
Declare the app graph once and reuse it across roots and namespaces.
A request starts when `send` runs.

- `backend` is the tag for how a request is sent.
  Its default is `fetchBackend`.
- `config` is the tag for the base URL, headers, retry, and accepted status.
- `send` merges settings, checks the URL, and retries through `attempt`.
- `attempt` sends one request through the backend.

## Two services in one scope

Give GitHub and Cloudflare separate namespace settings.
Both reuse the same `config`, `send`, `attempt`, and `backend` declarations.
The token strings below are example values.

```ts
import { createScope, namespace } from "@tinker/core";
import { config, HttpRequest, send } from "@tinker/http";

const github = namespace({
  tags: config({
    baseUrl: "https://api.github.com",
    headers: {
      authorization: "Bearer github-example-token",
    },
  }),
});
const cloudflare = namespace({
  tags: config({
    baseUrl: "https://api.cloudflare.com/client/v4",
    headers: {
      authorization: "Bearer cloudflare-example-token",
    },
  }),
});

const stop = new AbortController();
const scope = createScope({ signal: stop.signal });
await scope.ready;
try {
  const repo = await scope.run(send, {
    ns: github,
    input: HttpRequest.get("/repos/octocat/Hello-World"),
  });
  const zones = await scope.run(send, {
    ns: cloudflare,
    input: HttpRequest.get("/zones"),
  });
  console.log(await repo.json(), await zones.json());
} finally {
  stop.abort();
  await scope.closed;
}
```

Namespaces select settings; scopes and sessions own lifetime and cleanup.
A session can call both namespaces within the same lifetime.
Changing `ns` does not create a session.
The same graph and namespace keys can be used in another root;
closing one root leaves the other root usable.

See [one agent, two services](../../examples/harness/SERVICES.md)
for a Harness agent that uses these namespaces through two tools.

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

/** The auth resource owns the token. One call gets a fresh
 * token through tags (a child session, ADR 0038). */
const onboard = operation({
  label: "onboard",
  input: parseIssue,
  depends: { auth, issue: createIssue },
  run: async ({ auth, issue }, { input }) => {
    const token = await auth.token();
    return issue.run({
      input,
      tags: config({
        headers: { authorization: `Bearer ${token}` },
      }),
    });
  },
});
```

`HttpRequest.modify(req, options)` keeps the fragment and body the options leave out.
`HttpRequest.modify` with `acceptJson: true` sets the `accept` header to `application/json`.

## Retry: a config value

`config({ retry: { times, delay? } })` — `times` extra attempts after the first (default 0),
`delay(n)` the milliseconds to wait before retry `n` (1-based, default none). Transient
only: a backend failure, or status 408, 429, 5xx. A non-transient status is never retried,
and an aborted signal never retries. Backoff sleeps on the caller's `ctx.clock`, so a
`makeTestClock` drives it deterministically in tests. Merged nearest-wins like `baseUrl`:
a session retries, the scope does not.
A backend rejection becomes `RequestFailed` (reason `Transport`) inside the attempt.
Retry receives each try through core's `settle` (ADR 0067) and retries only that error.
A panic (a throwing `accept`) is thrown unchanged and never retried.
A response delivered after a forced close is returned, as `run` returns it; the close still reports `cancelled`.
A backend failure that a forced close lands on rejects with the abort reason, not `RequestFailed`.

```ts
createScope({
  tags: config({
    baseUrl: "https://api",
    retry: { times: 2, delay: (n) => n * 1000 },
  }),
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
  tags: config({
    baseUrl: "https://api",
    accept: (status) => status < 300,
  }),
});
```

Inside a body reader, `HttpResponse.filterStatus(res, accept)` does the same per call,
`HttpResponse.filterStatusOk(res)` is the 2xx form, and `HttpResponse.matchStatus(res, cases)`
dispatches by status — an exact status beats its class bucket (`"2xx"`/`"3xx"`/`"4xx"`/`"5xx"`),
anything unmatched falls to `orElse`:

```ts
const res = await send.run({
  input: HttpRequest.get("/api/repo"),
});
return HttpResponse.matchStatus(res, {
  404: () => null,
  "2xx": (ok) => ok.json(parseRepo),
  orElse: (other) => {
    throw HttpResponse.filterStatusOk(other);
  },
});
```

`filterStatusOk` passes 200 through 299; 300 raises `ResponseFailed/StatusCode`.
Each class bucket catches only its own hundreds: 204 is `2xx`, 302 `3xx`, 418 `4xx`, 503 `5xx`.

## Config: settings merge nearest first

Bind `config` on a namespace, scope, session, or call.
`mergeConfig` takes a `.all` list (nearest first): `baseUrl` is the nearest binding that has
one; `headers` merge key by key, nearer winning. `applyConfig` prepends the `baseUrl` and puts
the request's own headers on top (request wins).

```ts
/** Scope defaults: base URL and service token. */
createScope({
  tags: [
    config({
      baseUrl: "https://api.github.com",
      headers: { authorization: `Bearer ${svc}` },
    }),
  ],
});
/** Session token; the scope supplies the base URL. */
await scope.session(
  {
    tags: config({
      headers: { authorization: `Bearer ${user}` },
    }),
  },
  run,
);
/** One call gets a fresh token. */
scope.run(listRepos, {
  input: "octocat",
  tags: config({
    headers: { authorization: `Bearer ${fresh}` },
  }),
});
```

A call with `tags` opens a child session for that run (ADR 0038; a value when that session ended in
place, a promise when it must wait, ADR 0072). `attempt`
depends on the bare `backend` tag, so deps resolve at the requesting layer (ADR 0018):
a session-bound or call-bound `backend` is seen by that flow, while the root scope keeps its own.
Preset `attempt` to swap the transport in tests.
The default `fetchBackend` never sends a body with GET or HEAD, even when the record carries one.

## Test recipe: a closure backend

No helper ships for this — a three-line closure on the tag records the outgoing request:

```ts
const seen: HttpRequest.Record[] = [];
const fake: HttpClient.Backend = async (req) => {
  seen.push(req);
  return HttpResponse.make(req, {
    status: 200,
    body: JSON.stringify([]),
  });
};
createScope({
  tags: [backend(fake), config({ baseUrl: "https://api" })],
});
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

## Trace ids

- Each traced HTTP attempt sends its own traceparent without changing the caller's request.
- An HTTP attempt keeps the remote unsampled flag.
- Observation off sends the caller's headers without adding traceparent.
