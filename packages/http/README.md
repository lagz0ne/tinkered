# @tinker/http

An HTTP client as a **frame** of core primitives (ADR 0035): a pre-wired graph with slots the
user fills in. Nothing in it runs until an operation resolves.

```text
httpClient({ label: "github" })   // the frame
├── backend            (shared tag)             slot: how a request is sent; default fetchBackend
├── github.config      (tag, one per client)    slot: baseUrl, headers — scope, session, or per call
└── github.client      (resource, one per session) depends { backend }; execute(request, ctx): sends
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
