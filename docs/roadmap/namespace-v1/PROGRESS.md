# namespace-v1 -- make the namespace model real, move authoring onto it

The design is settled: ADR 0059 (a namespace is a parallel storage keyed by a branded value; the
invocation carries `ns`) and ADR 0060 (an integration is an extension the scope owns). A first core
spike (tag `probe/ns-spike-v1`, parked) proved the concept runs and, under an xhigh review, turned
the two open probes into the acceptance criteria now written into ADR 0059. This track builds the
model for real and moves every label-factory onto it.

Writer: pi `opencode-go/glm-5.3-flash`, max effort. Review: pi `openai-codex/gpt-6-astra`, xhigh.
Every ticket keeps the 385 `ns`-absent core tests green (additivity) and ends with the Jev loop.

## The Jev loop every ticket ends with

```text
node tools/jev/preflight.mjs main..HEAD
node tools/jev/tests.mjs <pkg>
node tools/jev/promises.mjs <pkg>
node tools/jev/label.mjs <judge> t|f <file> --by <ticket>
```

## Tickets

- **t01 ns values (cells + tags)** -- [x] blocked by: none
  `namespace(opts?)` mints a branded key; `opts.tags` are its bindings. `ns` rides run/resolve/
  controller and a subflow `.run({ ns })`. ONE bucket selector serves every read. The chain order is
  DECIDED and locked by a test that fails under the other order. `createSession({ ns })` sets it
  ambient; a per-call `ns` overrides for one run; a child session inherits the parent's `ns`. Cells
  and tags resolve through `(layer, ns, unit)`. The `ns`-absent path stays byte-for-byte and is
  benched (the +2 ns budget). Probes cover: two namespaces split one cell; a tag chain `[a, muse]`
  finds a binding in `muse`; ambient + override; parent-vs-child read order.
- **t02a ns resource build** -- [x] blocked by: t01
  Session-target resources key on `(owner, ns, handle)` via the same selector; scope-target stay
  ns-blind (one shared build, no tenant-tag leak); the warm/cache path is per namespace; a named
  resource's data dependency links to the entry the read actually resolved (nearer default shadows a
  farther named). Close tears the ns buckets down through the base path. NO `releaseNs` verb -- that
  is t02b. This is the clean, additive half that lands.
- **t02b-1 one release protocol (ADR 0063)** -- [ ] blocked by: t02a, t03
  Every resource instance (default and named) goes through one lifetime: `ctx.defer` hooks and run
  borrows are tagged with the instance, not the handle; `release` unlinks instances (cascading to
  instances built on them); an unlinked instance finishes when no run and no dependent instance
  holds it; a build that settles after its instance was unlinked is not a special case (the
  superseded teardown path goes). No new public API. Acceptance: every existing core test green
  (ADR 0026 ordering, borrow waits, sticky failures), plus N5 for the default path (a dependency
  released mid-async-build, a dependent built on it later: cleanup runs dependent first). Landing
  needs a `bench` run on the borrow path; `bench` is not on PATH here.
- **t02b-2 `releaseNs` verb** -- [ ] blocked by: t02b-1
  `scope.releaseNs(target, ns)` for resources and named data, on the t02b-1 protocol. Acceptance:
  the release tests on tag `namespace-v1/t02-release-ref` (about 30), adapted, plus N4 (a watcher that
  starts a run in a new namespace during a release must not join the old release's holders) and N5
  for a named bucket.

- **t02c `namespace` resource target (ADR 0064)** -- [ ] blocked by: t02a
  `target: "namespace"`: owned by the root, keyed by namespace, dependencies resolve at the root in
  that namespace (asking-session tags never reach it). Reuses t02a's named buckets with the root as
  owner. Probes: one build per namespace shared by two request sessions; no ns resolves the root
  default; a request session's tag never reaches the build; `release` and close clean every bucket
  once. Core mutation alone >= 85.
- **t03 ns correctness edges** -- [x] blocked by: t01, t02
  A named cell write notifies a named watcher (not only the default). A synchronous factory failure
  does not poison a named bucket against a retry. `.all` on a tag keeps repeated bindings for a named
  read. Inheritance completes: tagged subflows, inline operations, and imperative data/resource
  controllers all carry the ambient `ns`. Probes for each.
- **t09 hono request namespace** -- [ ] blocked by: t05
  The hono extension already opens one session per request; add an optional wiring hook
  `ns: (c) => Namespace | undefined` passed to that session beside `tags`, so a route serves a
  tenant's buckets (config, `namespace`-target pools) while the request stays its own lifetime.
  Probe through a real route: two tenants' requests share their own tenant pool, never each
  other's, and a request-scoped cell dies with its request.
- **t04 ns docs + ADR 0059 Accepted** -- [ ] blocked by: t01, t02, t03
  A README line per new surface (`namespace`, `ns`, `releaseNs`, the chain rule), a glossary row, and
  ADR 0059 moves from proposed to accepted with the decided chain order and release rule stated.
- **t05 drizzle onto ns** -- [ ] blocked by: t02c
  `drizzleStore({ label })` drops the label as a storage key; two stores are two namespaces. The `db`
  and `tx` resources resolve per namespace. Consumers bind config per namespace.
- **t06 sync family onto ns** -- [x] blocked by: t03
  `family({ label })` drops the label; a family member is a namespace. Parallel members share the
  declared graph and differ only by their namespace.
- **t07 tinkerer onto ns** -- [x] blocked by: t03
  `tinkerer({ label, tools, gate })` drops `label` as a storage key; two coders are two namespaces.
  `tools` and `gate` stay as graph authoring. The turn units are declared; config binds per namespace.
- **t08 harness onto ns** -- [x] blocked by: t03
  `harness({ label, adapter, ... })` drops `label` as a storage key; parallel harnesses are
  namespaces. `adapter`, `approve`, `tools` stay as graph authoring.

## Acceptance criteria source

ADR 0059 "Open -- decide with a probe before building" is now the build spec; the spike (astra
review, 2026-09-22) turned each into a concrete rule. Every core ticket cites the criterion it meets.

## Landed

One line per ticket: tag -- sha -- tests -- size (B gzip) -- mutation -- Jev flags before/after.

- **t01** -- tag `namespace-v1/t01` -- core 418 tests (385 old + ns
  probes) -- mutation 85.74 (floor 85) -- FOUR xhigh review rounds.
  namespace(), ns on run/resolve/controller + subflow, createSession({ ns })
  ambient with per-call override + child inheritance, storage (layer, ns,
  unit) via one selector, chain order = layers-first (near default beats
  far named), locked by a discriminator. Writer glm-5.3-flash built it and
  chose the chain order; a duration limit stopped its fix round, so sol
  (high) did the restructure (kill nsView, thread ns as a parameter). The
  review chain found and cleared, in order: parse-after-resolve additivity
  break; nsView layer-copy severing close/abort + the extension/session
  registries; tags not sharing the cells' order; scope-target build leaking
  tenant tags into the default bucket (a `= layer.ns` default parameter);
  ns lost through extensions; and a run of ns-watch bugs (sentinel leak,
  shared per-key comparison, then a re-entrancy rob) fixed by making each
  watcher own its chain + value and snapshotting before firing. The green
  gate never showed any of these -- the xhigh judge did.

- **t02a** -- tag `namespace-v1/t02a` -- core 424 tests -- mutation 85.30 (floor 85).
  Session-target resources key on `(owner, ns, handle)` via the shared selector; a chain
  reuses the nearest occupied bucket and builds in its head; scope-target stays ns-blind;
  a named resource links to the exact data entry it read; close and base `release`
  clear every bucket of a handle and wait for every borrow on it. No `releaseNs`.
  Writers sol 5.6 (build) and sol 6 (fix round); the lead reviewed it, not a judge
  agent. The lead's own probes found one real bug the writer's tests missed: a bucket
  left empty by a sync build failure was picked as a fallback and filled with a sibling
  chain's tags (the round-1 contamination returning). Fixed by selecting only occupied
  buckets. Also removed a dead per-bucket `borrowers` field and restored the inline
  ns-absent path in `resourceSlot`.

- **t03** -- tag `namespace-v1/t03` -- core 428 tests -- mutation 85.40. Tests only: every
  edge (named and chained watchers, failed-bucket retry from the `[b, a]` side, `.all` repeats in
  a namespace and through a chain, ambient `ns` through child session, tagged subflow, inline run,
  and controllers, with a per-call override that does not leak) already held after t01 and t02a.
  Writer sol 6; lead review asked for one fold (probes into `namespaces.test.ts`, a duplicate of
  t01's re-entrancy test dropped).

- **t06** -- tag `namespace-v1/t06` -- sync: `family` declares ONE cell; `family(id)` is a memoized
  namespace; wire keys stay `label/id`. Mutation 78.93. Lead measured the cost of one shared cell:
  a member write re-resolves every namespace watcher on the cell (0.12 ms at 100 members, 0.97 ms
  at 10000). Correct, linear; the fix is in core (see core feedback).
- **t07** -- tag `namespace-v1/t07` -- tinkerer: one frame, two coders by namespace (history, usage,
  config, inbox, steer isolated); `label` optional; `persist` takes an optional `ns` (one persist per
  coder, one file each). Mutation 85.46.
- **t08** -- tag `namespace-v1/t08` -- harness: one frame, two agents by namespace. The ADR 0059
  motivating case is proven: one `relay` operation sends to agent A then B, each keeps its own
  thread, items, and provider session, and both `harness.send` spans nest under `relay`. Mutation 76.39.
  All three: writer sol 6, lead review; each passed on the first round.
