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
- **t02a ns resource build** -- [ ] blocked by: t01
  Session-target resources key on `(owner, ns, handle)` via the same selector; scope-target stay
  ns-blind (one shared build, no tenant-tag leak); the warm/cache path is per namespace; a named
  resource's data dependency links to the entry the read actually resolved (nearer default shadows a
  farther named). Close tears the ns buckets down through the base path. NO `releaseNs` verb -- that
  is t02b. This is the clean, additive half that lands.
- **t02b ns resource release** -- [ ] blocked by: t02a
  `scope.releaseNs(target, ns)` and its borrow/cleanup lifetime. The reference implementation lives at
  tag `namespace-v1/t02-release-ref` (5 of 6 review findings fixed, with tests); it is NOT landable
  as-is: one finding (N5 -- a resource released mid-async-build whose dependent forms later needs its
  cleanup ordered after that dependent) needs a cleanup-completion mechanism, and mutation sits at
  84.71 under the 85 floor. This ticket redesigns release from that reference with proper design time
  -- the release lifetime is a bigger subsystem than one ticket (three review rounds churned on it).
  Session-target resources key on `(owner, ns, handle)` via the same selector; scope-target resources
  are blind to `ns` (one shared build; a tenant's tags never reach it). `scope.releaseNs(target, ns)`
  drops one bucket now, running its `defer` once with `released`; siblings and the default stay;
  layer close drains the rest once. Borrows key on `(owner, ns, handle)` -- a live run in one
  namespace never blocks, and never frees, a bucket in another. Probes: one pool shared across two
  clients; release runs one cleanup and leaves the sibling; no under-wait frees a held bucket.
- **t03 ns correctness edges** -- [ ] blocked by: t01, t02
  A named cell write notifies a named watcher (not only the default). A synchronous factory failure
  does not poison a named bucket against a retry. `.all` on a tag keeps repeated bindings for a named
  read. Inheritance completes: tagged subflows, inline operations, and imperative data/resource
  controllers all carry the ambient `ns`. Probes for each.
- **t04 ns docs + ADR 0059 Accepted** -- [ ] blocked by: t01, t02, t03
  A README line per new surface (`namespace`, `ns`, `releaseNs`, the chain rule), a glossary row, and
  ADR 0059 moves from proposed to accepted with the decided chain order and release rule stated.
- **t05 drizzle onto ns** -- [ ] blocked by: t03
  `drizzleStore({ label })` drops the label as a storage key; two stores are two namespaces. The `db`
  and `tx` resources resolve per namespace. Consumers bind config per namespace.
- **t06 sync family onto ns** -- [ ] blocked by: t03
  `family({ label })` drops the label; a family member is a namespace. Parallel members share the
  declared graph and differ only by their namespace.
- **t07 tinkerer onto ns** -- [ ] blocked by: t03
  `tinkerer({ label, tools, gate })` drops `label` as a storage key; two coders are two namespaces.
  `tools` and `gate` stay as graph authoring. The turn units are declared; config binds per namespace.
- **t08 harness onto ns** -- [ ] blocked by: t03
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
