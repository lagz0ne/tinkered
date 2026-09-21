# 0058 A step worth seeing is an operation; the graph must produce the trace

Date: 2026-09-21. Status: accepted. Refines: 0035 (the http frame), 0043 (the harness frame),
0056 (a command is an operation), 0057 (a unit is declared once). Retires: the frames' endpoint and
turn builders — a frame supplies units, it does not build the author's operation.

## Context

Authoring here means one thing: the author declares a graph of units, and core gives that graph its
observation for free. A span per operation, a span per resource build, nesting by subflow, all gated
on `observing` so an unobserved run pays nothing. Work that lives in a plain function gets none of
it.

The frames drifted away from that. `github.operation({ label, input, request, response })` and
`coder.turn({ label, input, request, response })` build the author's operation _for_ them, so the
call site shows neither `depends` nor `run`. A reader cannot see that an endpoint depends on a
client and every config binding — that wiring is at `client.ts:243`. Four dialects now mean "declare
an operation" (core, http, harness, process), and `request`/`response` mean different things in two
of them.

The cost is measurable. The repo's own advisory lint flags **33 of 175 units**: four operations whose
`run` only forwards to a closure that is not in `depends`, and a long tail of plain functions that
"read like an operation" (`runTurn` 91%, `readEndpointOperation` 84%, `command` 95%, `run` 94%,
`writeWhole` 99%) or "read like a resource" (`startClaude` 90%, `readSse` 96%). Where a plain
function badly needed a trace, someone rebuilt one by hand:

```text
hand-rolled spans       hand-written log lines
http   obs.child per    http, hono, harness, drizzle,
       retry attempt    process, mcp x2 = 8 lines,
hono   span.attributes  6 packages, each re-deriving
harness span.attributes ms from ctx.clock
```

`http` wanted a span per retry attempt badly enough to write `ctx.obs.child` by hand. That is the
tell: the graph was right, but the step was not a unit, so the trace had to be forged.

**The analogy** is Bazel. A macro may wrap targets, but `bazel query` always prints the expanded
graph — the macro is a convenience, the target is the truth. Terraform is the same: modules wrap
resources, `plan` still prints every resource. Our frames inverted it, making the sugar the truth
and the graph unreachable.

## Decision

1. **A step worth seeing in a trace is an operation.** A helper inside one step stays a plain
   function. The test is not purity, it is: _would I want this step in a trace, or to preset it?_
   A leaf tool is one operation and one span; an http retry attempt is its own operation, because
   someone already proved they wanted to see it.
2. **A frame supplies units; it never builds the author's operation.** `httpClient({ label })` stays
   — it is the construction-time factory of ADR 0057, and each API needs its own config-tag identity
   — but it exposes `send` and `attempt` as operations to depend on. The author writes the operation,
   so `depends` and `run` are on the page:

```ts
const listRepos = operation({
  label: "listRepos",
  input: parseUser,
  depends: { send: github.send },
  run: async ({ send }, ctx) => {
    const res = await send.run({
      input: HttpRequest.get(`/users/${ctx.input}/repos`),
    });
    return res.json(parseRepos);
  },
});
```

```text
the trace this produces, with no span code anywhere:
  github.listRepos
    github.send
      github.attempt   attempt=1
      github.attempt   attempt=2
```

3. **One mechanism per idea.** Per-call config is `tags` on the run (ADR 0038) — a tagged call opens
   a child session and `send` reads `config.all` from it. A merge helper lives inside the unit that
   needs it, never at the call site. No second config path is invented.
4. **Core owns the shape of a step's log line; a package owns its words.** Core emits label, ms, and
   outcome, gated on `obs.observing` exactly as spans are, so the hot path pays nothing (`op` is
   78.3 ns with a +2 ns ceiling; benched before landing). The eight hand-written lines keep their
   domain attributes and drop their hand-derived `ms`.
5. **A span-tree test proves it.** Every package ships one test that runs a real flow and asserts the
   shape of `scope.spans()`. Advisory judges point; this is the check that fails when a step slips
   back into a plain function. A grep for a hand-rolled span outside core rides beside it.
6. **Vocabulary: one word per idea.** `respond` maps a value out (hono, mcp, process, and now
   harness); `response` is kept only where the parameter _is_ a protocol response (http's reader).
   `request` is kept only where the value _is_ a request; harness's turn payload becomes `send`.
7. **Break cleanly, one package at a time.** No expand–contract and no compatibility shim: a package
   and its consumers change in one commit. A package that cannot justify its shape afterwards is
   sunset rather than patched.

## Consequences

- Three frames change shape; `http` first, then `harness`, then `process`, each with its consumers
  and its span-tree test in the same commit.
- The only hand-rolled `obs.child` in the repo is deleted, and the retry becomes visible to anyone
  reading a trace without reading `client.ts`.
- Jev's 33 flags are the starting census; the number is expected to fall and is recorded per package
  as each lands.
- `startClaude`'s `effectWithoutDefer` (81%) is a correctness defect about cleanup, not shape. It
  gets its own card so a real fix is not hidden behind a redesign.
- Authoring cost rises slightly at each call site — the author writes `depends` and `run` where a
  builder used to. That is the point: the graph is the product, and it is now legible.

## Alternatives rejected

- **Keep the builders, document the wiring** — the reader still cannot reach the units, and presets,
  spans, and swaps stay unavailable.
- **Expand–contract with both surfaces** — two ways to declare one endpoint, and the weaker one is
  the one already in every README.
- **Make the advisory lint the check** — it points, it never blocks (ADR 0054); a regression would
  land green.
- **Emit the core log line unconditionally** — breaks the operation budget for runs that never
  observe.
