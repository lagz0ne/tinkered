# http v1 — build progress

The first dedicated capability on `@tinker/core`: an HTTP client as a **frame** of core primitives
(a shared `backend` tag, a per-client `config` tag, a `client` resource, endpoint operations), on
Effect's `HttpClient` model without `pipe` (ADR 0035). New package `packages/http` (`@tinker/http`),
size cap 10 kB gzip, no core change.

- **Decision:** `docs/decisions/0035-http-client-is-a-frame-of-core-primitives.md`.
- **Glossary:** `docs/glossary.md` → "HTTP client" (`frame`, `slot`, `backend`, `config tag`,
  `client resource`, `endpoint operation`, `source`, `transient failure`).
- **Gate + tag:** `scripts/ticket.sh` takes the package (`http`) → tag `http/t<NN>` (check +
  `vp run -r test` + `http#size`, mutate best-effort). A red gate makes no checkpoint.
- **Precedent files:** `@effect/platform` 0.97 `HttpClient`, `HttpClientRequest`,
  `HttpClientResponse`, `HttpClientError`, `FetchHttpClient` (read from the npm tarball).

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
export function mergeConfig(bindings: readonly HttpClient.Config[]): HttpClient.Config;
export function applyConfig(
  request: HttpRequest.Record,
  config: HttpClient.Config,
): HttpRequest.Record;
// HttpClient.Frame = { label, config: Tag.Handle<Config>, client: Resource.Handle<Handle>, operation(endpoint) }
// HttpClient.Handle = { label, execute(request, ctx): Promise<HttpResponse.Handle> }   // ctx = caller's
// HttpRequest.get/post/put/patch/del/head/options(url, options?) · bodyJson/Text/Bytes/FormData/UrlParams · modify
// HttpResponse.fromWeb / make · status, headers, request, source · text/json(parse?)/arrayBuffer/formData/stream
// HttpResponse.filterStatus / filterStatusOk / matchStatus
// errors.ts: RequestFailed { Transport | Encode | InvalidUrl } · ResponseFailed { StatusCode | Decode | EmptyBody }
```

Anchors in core: `Operation.Ctx` / `Resource.Ctx` (`index.ts:142` / `:170`) — the ctx shape
`execute` takes; `Tag.Handle` (`:49`) and tag lookup (ADR 0012) — the `backend`/`config` tags;
`preset` (`:524`, ADR 0015) — the test seam; `obs.child` (`:104`) — the per-request span.

## Order & status

Linear; each ticket is one green checkpoint with decisive, deterministic seam tests (no real
network, no wall-clock sleeps — ADR 0003: a closure backend and `makeTestClock`). Mark `x` when
its tag exists.

| tag      | ticket                                                                                        | blockers | status |
| -------- | --------------------------------------------------------------------------------------------- | -------- | ------ |
| http/t01 | Package + frame + `execute`: scaffold, errors, tags, `fetchBackend`, request/response records | —        | [x]    |
| http/t02 | Endpoint operations + `preset` seam + cancel; status filters                                  | 01       | [x]    |
| http/t03 | Observation + logging: child span per request, failure log line, zero cost when off           | 01       | [x]    |
| http/t04 | Retry: frame slot, transient policy, `ctx.clock.sleep` backoff under a TestClock              | 02       | [ ]    |
| http/t05 | Validation milestone: size, mutation, README + cast-free example, universal bundle; SHIP      | 03, 04   | [ ]    |

### Verify (the observable proof for each)

- **t01** — `packages/http` exists with `package.json` (`size` cap 10240), `vite.config.ts`,
  `tsconfig.json`, `src/errors.ts`, `src/index.ts`, `tests/`; `scripts/ticket.sh` gates a named
  package. Seam tests: an operation `depends: { client: github.client }` calls
  `client.execute(applyConfig(HttpRequest.get("/users"), mergeConfig(configs)), ctx)` with
  `configs` from `depends: { config: github.config.all }`; under
  `createScope({ tags: [backend(fake), github.config({ baseUrl: "https://api", headers: { a: "1" } })] })`
  the closure backend receives `url === "https://api/users"` and header `a`; a request header
  overrides a config header; a session binding `github.config({ headers: { b: "2" } })` merges
  (`a` kept, `b` added) and a session `baseUrl` replaces; the operation delivers the backend's
  response (`status`, `await res.text()`). A relative URL with no `baseUrl` rejects
  `RequestFailed/InvalidUrl`. A backend that throws rejects
  `RequestFailed/Transport` with the cause. `fetchBackend` is the tag default (type-level +
  `backend.hasDefault`). `HttpResponse.fromWeb(req, new Response("x"))` reads `text()`; `source`
  is the web `Response`. `vp check` + `vp run -r test` + `http#size` green.
  - _Landed (b31ad3f, lead review SHIP):_ size 4312 B; mutation **43.35** with 102 uncovered mutants
    (request builders never referenced by a test, `fetchBackend`'s body builder) — recorded, not
    hidden; the t05 break line (60) is reached by t02's endpoint scenarios (verbs + bodies) and, if
    still short, a `fetchBackend` scenario against a loopback server (a real dependency, not a mock).
    Review changed the client resource to `target: "session"` (ADR 0035 amended).
- **t02** — `github.operation({ label, input: parse, request, response })` is labelled
  `github.<label>` and resolves through a scope with `{ input }` and `{ rawInput }` (parse runs);
  `response` omitted delivers the raw `HttpResponse.Handle`; a per-call
  `tags: [github.config({ headers })]` on the subflow reaches the backend merged with the scope's
  `baseUrl` (the dynamic-auth path); the frame's `filterStatus` rejects a 404 with
  `ResponseFailed/StatusCode` carrying the response before `response` runs, and
  `HttpResponse.filterStatusOk(res)` does the same inside a reader; `res.json(parse)` failure →
  `ResponseFailed/Decode`. `preset(github.client, () => fake)` makes the endpoint use the fake;
  `preset(endpoint, () => value)` short-circuits it. A forced `close()` while a backend awaits the
  signal aborts it and the run settles `cancelled` (its `defer` sees `cancelled`, ADR 0028).
- **t03** — with `observe: { history }`, one endpoint resolve yields an operation span with one
  child span named `http GET https://api/users` (`kind: "manual"`), attributes
  `{ method, url, status }`, `status: "ok"`; a backend failure marks the child `failed` and emits
  one `observe.log` entry with the method/url. With observation off, `scope.spans()` is empty and
  the request still succeeds.
- **t04** — `httpClient({ label, retry: { times: 2, delay: (n) => n * 1000 } })` under
  `makeTestClock`: a backend failing twice then succeeding yields success after `advance(1000)`
  and `advance(2000)` (three calls seen); a 503 then 200 succeeds; a 404 is not retried (one
  call, raw response); aborting the signal during backoff rejects with the signal reason and makes
  no further call; `times: 0` (default) never retries.
- **t05** — `vp run http#size` ≤ 10240 B; `vp run http#mutate` alone ≥ 60; the package README and
  `examples/basic.ts` are cast-free (same grep as core's validate lane); `dist/index.mjs` has no
  `node:` import and loads in a bare `node --input-type=module`; lead review SHIP; TODO archive entry.

## Review loop (mandatory, per ticket)

The lead reviews every ticket itself before it lands (user decision 2026-09-17: we know what we
expect from our own authoring, so no delegated reviewer). Review = the diff read line by line
against the ADR's rows, the convention's shape rules (facades, duplicated hot bodies, leaked
internals, per-call allocation, identity-keyed memos), test quality (seam-only, one promise per
test), and the gate re-run by the lead. Blockers go back to the contributor as one fix round;
nits the lead fixes directly. Serial tickets — a fix often re-touches the same file.

## Contributor briefs (delegated implementation, CLAUDE.md)

One contributor per ticket in its own worktree (`git worktree add ../tinkered-http-t<NN> -b
http/t<NN>-work main`), `vp install` there, commits by pathspec, never pushes. The brief carries:
this file's Verify for the ticket, ADR 0035, `.agents/skills/coding-convention/SKILL.md`, the
gate (`vp check` 0 errors, `vp run -r test`, `http#size`, census `--strict`), and the report
format (branch, SHAs, what was verified and how). The lead reviews shape, re-gates, cherry-picks,
runs `http#mutate` isolated, tags, removes the worktree.

## Reset (git techniques)

- Undo current (unlanded) work: `git reset --hard http/t<last>`.
- Redo a landed ticket: `git reset --hard http/t<blocker>`, rebuild, re-run the gate.
- Inspect a checkpoint: `git switch --detach http/t02`.
