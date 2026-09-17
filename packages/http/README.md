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
  request: ({ title }) => HttpRequest.post("/issues", { body: HttpRequest.bodyJson({ title }) }),
});

// a composing operation: owns the fresh token, hands it to one subflow call via tags
const onboard = operation({
  label: "onboard",
  depends: { repos: listRepos, issue: createIssue },
  run: ({ repos, issue }, ctx) =>
    issue.run({
      input: ctx.input,
      tags: [github.config({ headers: { authorization: `Bearer ${fresh}` } })],
    }),
});
```

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
scope.run(listRepos, { tags: [github.config({ headers: { authorization: `Bearer ${fresh}` } })] });
```

Note: per-call `tags` reach the operation's **own** tag dependencies (the `config.all` read),
not into the built `client` resource (ADR 0022). The client is `target: "session"`, so its
`backend` dep resolves at the requesting layer (ADR 0018): a session-bound `backend` is seen by
runs in that session, while the root scope keeps its own.

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

## Errors

`RequestFailed { request, reason: "Transport" | "Encode" | "InvalidUrl", cause? }` and
`ResponseFailed { request, response, reason: "StatusCode" | "Decode" | "EmptyBody", cause? }`.
Narrow with `isError(e, "RequestFailed")` by control flow, then read `payload.reason`. A forced
close while a request is in flight rethrows the signal's reason untouched — a cancel is a clean
end, not a `RequestFailed`.
