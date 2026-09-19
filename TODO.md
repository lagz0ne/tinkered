# TODO

The live working list. **Goal: drive it to empty.** Each item is checkable and carries a
**Verify** — the exact observable proof. Tick `[x]` ONLY after the Verify passes (gate green,
a failing→passing test, or command output). Never tick on intent. Add/split items freely.

## Externalize examples (ADR 0045)

Move every `packages/*/examples/` into one top-level `@tinker/examples` workspace package so the
examples live in one place (docs, combined concepts) and import the **public** `@tinker/*` surface —
the consumer path, so a release version-switch flows through them.

- [x] **Create `examples/` package** — package.json (private, `workspace:*` on every `@tinker/*`),
      tsconfig (jsx + dom + node), vite.config (lint typeAware), added to `pnpm-workspace.yaml`.
      Verified: `vp install` links all 9 `@tinker/*` (incl. mcp, sync) into `examples/node_modules/@tinker`.
- [x] **Move + rewrite imports** — each `../src/index.ts` → `@tinker/<pkg>`; folders per concept (9 packages,
      16 tours incl. harness approvals/tools, mcp basic/serve/cli, sync). Verified: `vp check examples` clean
      (0 lint/type errors in 17 files); root `vp check` 0 errors (13 pre-existing warnings, none in examples).
- [x] **Fix consumers** — validate.mjs cast-free grep paths (7 lanes, all count 0), cli smoke-test
      path/cwd (`examples/cli/main.ts`), README pointers (root, react, harness, mcp), `.prettierignore` for the
      hand-aligned docs tables. Verified: `vp run cli#test` 25/25 green; `node scripts/validate.mjs` 33/33 lanes PASS.
- [x] **ADR 0045** records the decision (external consumer of the public surface); index updated.

## Jev advisory layer (see docs/roadmap/jev-loop/PLAN.md)

Landed: advisory scripts `scripts/jev/{plan-check,preflight,review}.mjs` (judge set proven 11/11;
route gated at 0.6). Advisory only — the gate and the human decide (no self-grading).

- [x] **jev/impact — the impact chain (ADR 0047).** _Done 2026-09-18 (917171a, writer-built with one fix round):
      `scripts/jev/impact.mjs <tag> [range] [--goal] [--block]` reads the ` ```impact <tag> ` block, runs SCIP `refs` by
      exact display name, set-diffs expected vs actual files (+ undeclared exports), asks Jev one boolean per discrepancy
      with the file's diff hunk as evidence, maps it to the verdict; `scripts/ticket.sh` pre-read. Verify observed:
      `node scripts/jev/evals/impact.mjs` → the real cli/t04 block = neither (0 discrepancies, no model call); the
      under-scoped block = PLAN wrong on tests/cli.test.ts and examples/basic.ts at 82–87% over 3 runs (without the
      hunk it wobbled at 57–61% = unclear — the evidence is what makes the question answerable)._
- [ ] **jev/calibrate — route + plan-check fixtures.** Label 3 pos / 3 neg per question (mine from git
      history); set each threshold from data. Verify: `eval.mjs`-style separation report per question.

## Now — authoring (first-class integrations, ADR 0034 tiers)

Perf pursuit is closed (see archive). Next: production-ready "tinkered-first" components on the reusable
operation/resource model — glue without side effects, testable without mocks, the scope as the single
configuration point. Start with `grill-with-docs` (ADRs in `docs/decisions/`, terms in `docs/glossary.md`).

First integration shipped: **httpClient** (ADR 0035, archived below). Second shipped: the **Hono driver**
(ADR 0039/0040, archived below). Later candidates: app entrypoint with graceful
shutdown; TUI app — each starts with `grill-with-docs`.

**Authoring queue (user-ordered, 2026-09-17).** Each starts with `grill-with-docs` (ADR + glossary), then
tickets, then contributors with lead review:

1. **Drizzle** — **shipped** (ADR 0041, tags `drizzle/t01`, `drizzle/t02`; archived below).
2. **CLI entrypoint** — **shipped** (ADR 0042, tags `cli/t01`, `cli/t02`, core/t29; archived below). Was: commands are tag
   bindings on the scope (`command(name, load, { input?, respond? })`, `command.entry` for a server command that
   receives the scope), lazy loaders (help loads nothing), the command run is an inline op (span + `cli command`
   log line), exit codes 0/1/2/130, `run()` testable without the process, `runMain()` = run + signals + exit.
   - [x] **cli/t01 — package + `command` tag/builders + `run` + `runMain`.** _Done: tag `cli/t01` (3d92fd3 + lead nits), 16 tests incl. one real-process smoke test, size 3087 B, 21 validate lanes green, lead review SHIP (3 internal-proof tests cut); core feedback recorded (`resolve(tag.all)` and a lazy op unit now each have a likely second asker in hono/t05)._ Verify: tests through `run({ scope,
 argv, io })` — a command loads only when selected (a loader counter; `help`/unknown load nothing and exit
         0/2 with usage listing the bound names); the op's parse failure → exit 2 with usage; a throwing op → exit 1 + stderr; a void op prints nothing; `respond` overrides; an entry command receives the scope and can
         `scope.resolve` a resource; with `observe` the command span `app migrate` parents the op span and one
         `cli command` log line carries `{ command, code, ms }`; a session-target resource's `defer` sees `success`
         on exit 0 and `failed` on exit 1; `run` with an `AbortSignal` in `io` (the signal stand-in for tests) →
         exit 130 and `cancelled`; `runMain` is covered by a smoke test that spawns `node` on the example (real
         process, real exit code — the one process-level test).
   - [x] **cli/t02 — validation milestone.** _Done: tag `cli/t02`; 25 validate lanes green (cli lanes added), mutation 68.94, README + cast-free examples (`basic.ts` tour, `main.ts` real entrypoint). core/t29 landed alongside: `scope.resolve(tag.all)`._
   - [x] **hono/t05 — routes at the scope, eager mount (ADR 0042 policy).** _Done: tag `hono/t05`, `routes` tag +
         `route.get/post/put/patch/delete` bindings, `honoApp(scope)` mounts every route eagerly (loaders run once at
         boot, a rejecting loader fails boot), 30 hono tests, size 3376 B, mutation 82.10, lead review SHIP. Core feedback: a lazy
         operation unit now has TWO askers (cli, hono) → core/t30 queued below._
   - [x] **core/t30 — a lazy operation unit: NOT NEEDED.** _Closed 2026-09-18 by the user's observation: laziness is a
         resource whose factory imports (`resource({ factory: () => import("./x.ts").then((m) => m.op) })`) — built once
         per owner, cached, presettable, with a span; `drizzleStore.open` already is one. Drivers do
         `scope.run(await scope.resolve(module), …)`. Follow-up (optional): cli/hono tables accept a
         `Resource.Handle<Operation.Handle>` beside a loader so the load is cached per scope and observable._
   - [x] **cli/t03 — a command bound to a resource that delivers its operation.** _Done: tag `cli/t03` (d880d6b), the
         first ticket written by the re-wired pi writer (`vercel-gateway/meta/muse-spark-1.3-contributor`, one launch, no
         fix round): `command(name, module, route?)` / `command.entry(name, module)` beside the loaders; each row carries
         one `source`; `run` resolves the resource through the scope it owns (built once per scope, a `resource` span);
         help/unknown build nothing. 4 seam tests (20 total), size 3346 B, 29 lanes green, mutation 70.56. Core
         feedback: a public `isResourceHandle` guard; drivers that close their scope test spans through `export`._

3. **Harnesses (Claude Code, Codex)** — **decided (ADR 0043)**: `@tinker/harness`, one frame generic over the
   adapter's own SDK types; adapters are resources whose factories import the SDK; the thread is a session
   resource; ambient state as data cells; a turn is an operation. Plan: `docs/roadmap/harness-v1/PROGRESS.md`.
   - [x] **harness/t01 — package + frame + Claude Code adapter + ambient cells + `turn` op.** _Done: tag `harness/t01`
         (87e5023), `@tinker/harness`: `harness({ label, adapter })` frame (session `thread` resource, six cells, `resume`
         tag, `turn` op with span attr `adapter` + one `harness turn` line), `claudeCode` adapter whose SDK module is a
         resource (`claudeCode.sdk`, the test seam), 7 seam tests over recorded `SDKMessage` fixtures, size 3722 B,
         25 validate lanes green, mutation 69.27, lead review SHIP after one fix round (`text` reset per turn,
         `cancelled` in the log line, self-contained example). Design refined by the forced-close test: no
         `Thread.interrupt` — the signal is the interrupt (ops settle before defers); a forced close seals the session
         so no `status` write lands. First contributor archived mid-draft at the lead handoff; relaunched. Core
         feedback recorded (three rows)._
   - [x] **harness/t02 — Codex adapter.** _Done: tag `harness/t02` (97e284b), `codex` adapter on `@openai/codex-sdk` 0.155.0:
         `codex.options` = the SDK's `CodexOptions & ThreadOptions` (split at thread start: the constructor's six keys,
         `startThread` the rest), the SDK module is a resource (`codex.sdk`, the seam), `runStreamed` events → cells
         (agent text growth streamed as deltas — Codex reports the whole text so far), the result is the SDK's own
         `Turn`, `turn.failed` → `TurnFailed`; frame change: `Hooks.resume` replaces `Adapter.withResume` (Claude spreads
         it into `Options`, Codex calls `resumeThread`). 7 seam tests over recorded `ThreadEvent` fixtures (14 total),
         size 5279 B, 25 lanes green, mutation 66.74 (codex.ts 60.00 — t05 adds one all-keys options-split test), lead review SHIP after one fix round (raw event as `source`
         by identity; no module-level test state). SDK facts recorded: Codex offers NO approval callback and NO
         in-process tools — t03/t04 are Claude-only code._
   - [x] **harness/t03 — approvals as operations.** _Done: tag `harness/t03` (b46ae7f), lead-built after three pi
         contributor deaths. `harness({ …, approve })` attaches an approve op at frame construction (option A); the turn op
         depends on it and hands its controller to the thread (`Harness.TurnCalls`); `claudeCode` answers `canUseTool`
         through it and writes `{ kind: "approval", id: toolUseID, status: behavior }` into `items`; the op's input is the
         SDK's own request (`ClaudeCode.Approval`, typed by the `claudeCode.approval` guard-parse), its result the SDK's
         `PermissionResult` (`ClaudeCode.Decision`); adapters carry a type-level `Harness.Calls` record (`never` where the
         SDK has no hook — Codex rejects `approve` at compile time). 3 seam tests (17 total), size 6049 B, 25 lanes green,
         mutation with t04. Core feedback: a TAG-bound op cannot be run as a subflow (recorded)._
   - [x] **harness/t04 — tools as operations.** _Done: tag `harness/t04` (658863e), lead-built (the re-wired pi writer
         `opencode-go/muse-spark-1.3-contributor` hit its monthly quota at once). `claudeCode.tool({ name, description,
 schema, depends?, run })` declares an in-process tool as an ordinary operation (input = the zod-inferred shape the
         SDK already validated, result = the MCP `CallToolResult`); `harness({ …, tools })` spreads one `tool:<name>`
         dep per tool into the turn op, so each call is a subflow of the turn; the adapter builds one MCP server per
         thread named after the frame (`Hooks.label`) beside bound `mcpServers`; `ClaudeCode.Sdk` gains `tool` +
         `createSdkMcpServer` (the seam; fakes share `readToolSdk()`); Codex's `Calls.tool` is `never`. 4 seam tests
         (21 total), size 6746 B, 25 lanes green, mutation 64.38 (t03+t04, run once). zod + MCP SDK are devDeps only
         (0 runtime imports in dist)._
   - [x] **harness/t05 — validation milestone.** _Done: tag `harness/t05`; 29 validate lanes green (harness tests /
         size / cast-free examples / pure bundle with no zod or MCP SDK at runtime), 22 seam tests (the all-keys Codex
         options-split test added), size 6746 B, mutation 64.38 (claude.ts reports 42 uncovered mutants — a follow-up
         look), README pass (frame tree with the seam and the `approve`/`tools` slots, a Testing section). Archived below._
4. **Operations as tools; harnesses reach them over MCP** — **shipped (ADR 0046; archived below)**, user 2026-09-18 (`1A 2:analyze
& choose → external MCP server as a driver 3A 4A 5A`). Plan: `docs/roadmap/mcp-v1/PROGRESS.md`.
   - [x] **mcp/t01 — `@tinker/mcp`: `tool` meta tag, `tools` binding tag, `mcpServer(scope, { name, version })`.** _Done: tag
         `mcp/t01` (0e3d335), written by the vercel-gateway pi writer (one fix round: the session outcome tells the truth on a
         parse failure — log + rethrow inside, one mapping outside; the `registerTool` callback built once; three test helpers).
         Every bound op is registered off `tool.read(op)` (name = meta.name ?? label); each call is a session running an inline
         op `mcp <name>` with the op as its subflow through `rawInput` (the op's parse stays the edge), `respond` default one
         JSON text, failures → `{ isError: true }`, one `mcp tool` log line; `ToolUndeclared` for a bound op without meta.
         8 seam tests through the MCP SDK's in-memory Client, size 1529 B, 29 lanes green, mutation 80.60. Core feedback
         recorded (3 rows)._
   - [x] **harness/t06 — adapters read `tool.read(op)`.** _Done: tag `harness/t06` (08f3846), writer-built with one fix round
         (the tool op's result is `unknown` — one declaration serves the MCP driver and Claude's in-process path at the
         type level too; `readTool` lives in `@tinker/mcp` so `ToolUndeclared` has one registry; a seam test binds the
         same op in `mcpServer` and `harness({ tools })`). `Harness.Tool<C>` = an ordinary op with `tool` meta (Codex's
         `never` still rejects `tools`); `ToolCall = { op, meta, run }`; Claude registers `sdk.tool(meta.name ?? op.label,
 meta.description, meta.schema, args => answerTool(meta, await run.run({ rawInput: args })))`; `claudeCode.tool`
         builder deleted; `answerTool` exported by `@tinker/mcp` (a harness dependency, never bundled); README: Tools
         rewritten + MCP recipes (Claude `mcpServers`, Codex `config.mcp_servers`, Paseo plugin). Harness 24 tests,
         size 6886 B, 29 lanes green, mutation harness 69.77 / mcp 80.60._
   - [x] **cli/t04 — commands as operations with `command` meta.** _Done: tag `cli/t04` (c8dad0b), writer-built with one
         fix round (internal overloads and a duplicated dispatch branch cut; the parse-failure test asserts stderr).
         `command({ description, argv?, respond?, name? })` is a meta tag (`command.read(op)`), `commands(op)` binds the op on
         the scope (`Cli.Bound = Cli.Command | Operation.Handle`), `readCommand(op)` reads the facts or throws `CommandUndeclared`
         (`run` rejects, the scope still closes); `run` normalizes each bound op into an eager row, so the session, span, log
         line, and exit codes are unchanged; help prints `  name  description`. Loaders and resource modules stay for lazy
         modules. 5 seam tests (25 total), size 4057 B, 29 lanes green, mutation 72.03. Core feedback recorded._
   - [x] **mcp/t02 — validation milestone.** _Done: tag `mcp/t02` (4eb9588), writer-built with no fix round: four mcp
         lanes in `pnpm validate` (tests, size, cast-free examples, pure bundle — runtime imports are `@tinker/core` and
         the SDK's `server/mcp.js` only), 33 lanes green, the summary line lists `harness#mutate` and `mcp#mutate`,
         `examples/cli.ts` = the stdio entry through `@tinker/cli` (`command.entry("mcp", () => serve)` beside
         `tools(search)`; `node cli.ts help` exits 0), README pass (dual `tool` + `command` meta on one op;
         `readTool`/`answerTool` as the shared readers). Size 1591 B, mutation 80.60. Archived below._
5. **Sync (`@tinker/sync`)** — **shipped two-way, then re-cut one way (ADR 0048 amended 2026-09-19: the viewer registers by identity; `source`/`subscribe`)**, user 2026-09-18 (`1A`; a cell with an id is a family member;
   transport agnostic; hook waits: `B`). Plan: `docs/roadmap/sync-v1/PROGRESS.md`.
   - [x] **sync/t01 — package: `synced` meta, `family`, `sync` binding tag, `Sync.Message` + `Sync.Transport`, `memoryPair()`.**
         _Done: tag `sync/t01` (7f25563), writer-built, no fix round: `@tinker/sync` with `synced`/`sync` tags, `family()` (members
         memoized per id, each an ordinary cell keyed `label/id`, `members()`), `readSynced`/`SyncUndeclared`, `isFamily`,
         `memoryPair()` (microtask delivery in order; close fires both sides once). 8 seam tests, size 1429 B, 33 lanes green,
         mutation 80.60. First real `impact.mjs` run: PLAN wrong on `readSynced`/`isFamily`/`Sync` — the block
         under-declared the brief's surface (corrected); scanner nit fixed (undeclared exports scan `src/` only)._
   - [x] **sync/t02 — `syncServer(scope).connect(transport)`.** _Done: tag `sync/t02` (b6bd197), writer-built after one
         provider death and one fix round (five needless casts, a split read/write path, a polling test helper, an escaping
         throw). A session per transport; snapshots down (newest binding first); a `set` runs as inline op `sync set <key>`
         (parse → LWW by version → ack/reject → fan out through ONE watcher per key, which is also where the version moves,
         so userland writes fan out the same way); unknown key / non-set message / unexpected throw close the transport;
         `family.onMember`; `SyncConflict` when two cells claim a key. 9 seam tests (17 total), size 2839 B, 33 lanes green,
         mutation 77.89. Core feedback: a session shadows cell writes (the truth is written through the scope handle);
         `resolve(tag.all)` is newest-first. Impact chain: `onMember` untested → direct test in t03._
   - [x] **sync/t03 — `syncClient(scope, transport)`.** _Done: tag `sync/t03` (2a96f01), writer-built with one fix round
         (the published-set registry shared by both drivers: `readPublished(scope, make)`). Snapshots written through the
         cell's parse (family members created on arrival), local writes sent at once with the last seen version, `ack`
         moves the version, `reject` fills the truth (never re-sent — an `applying` flag around the driver's own `set`
         tells its write from userland's); a snapshot the parse refuses, an unknown key, or a `set` from the server
         close the transport; `client.close()` detaches. 10 seam tests (27 total, incl. a direct `onMember` test the
         impact chain asked for), size 3697 B, 33 lanes green, mutation 68.18. Impact chain: neither._
   - [x] **sync/t04 — validation milestone.** _Done: tag `sync/t04`, writer-built, no fix round: four sync lanes
         (37 total; the summary line lists `sync#mutate`), `examples/hono.ts` = the SSE + POST recipe wired by hand on
         `tinker(scope)` + `stream(c, write)` with ONE seam test through `app.request` (stream, POST a set, read to the
         ack, assert the server cell), six client edge tests aimed at the surviving mutants, README pass (Shared / Server /
         Client / Wire it: Hono, WebSocket sketch, React note). 34 tests, size 3697 B, mutation 78.32 (up from 68.18).
         Impact chain: neither. Landed twice: the first landing was reset away by a concurrent lead in the shared
         landing worktree — re-landed from a private one. Archived below._
   - [x] **sync/t05 — one way, registration by identity: `source(scope)` + `subscribe(scope, transport)`.** _Done: tag
         `sync/t05` (cf01bbb), writer-built, no fix round: the write path deleted (`set`/`ack`/`reject`, the `sync set` op, the
         optimistic client), `register { keys }` in — a key set per subscriber on the source, a `sync register` inline op
         with one log line per register, snapshots only for registered keys, a missing member created on the source with
         its initial value; the client registers bound singletons + held members at connect and each new member on
         `onMember`; violations close the transport; a local write on a client stays local. 20 seam tests (11 new incl. the
         Hono recipe with POST as registration), size 3324 B, 37 lanes green, mutation 73.53. Impact chain:
         a false "source wrong" — the examples moved to `examples/sync/` (outside the package index); blocks list src
         and tests only from now on._
6. **Extensions (core)** — **decided (ADR 0050)**, user 2026-09-19 (`1A middleware-style, 2A, 3A`; delivery `A`: start +
   close first). Plan: `docs/roadmap/extensions-v1/PROGRESS.md`.
   - [x] **core/t32 — `Scope.Extension` + `extensions` option + `start`/`close` chains + `scope.ready` + `resolve(ext)`.**
         _Done: tag `core/t32` (66bcea7), writer-built with one fix round (the first cut extracted `handleFor` into helpers
         with a spread to satisfy the complexity lint: create +88 ns — restored to main's literal; extensions wired on the
         cold path in `createScope` → `extendHandle`). `extension({ label, start?, close?, … })` builder; a declared
         `resolve`/`run`/`write` throws `NotSupported`; a rejected start records the layer failure and force-closes;
         `resolveExtension` walks up so sessions see values. 12 seam tests (core 239), size 22128 B, 37 lanes green,
         mutation 78.47. Lead A/B (pinned core, min of 3): create −7 ns, warm 0, op +0.2, opres −3.5,
         cold +17 ns, session +16 ns — one extra field on every `Layer` (`exts`) and on every handle (`ready`); t33 moves
         `exts` into a WeakMap keyed by root layer and extracts only the resolve dispatch (handleFor sits at the
         complexity ceiling, 13th warning)._
   - [ ] **core/t33 — the `resolve` chain.** Verify: probes flat when unhooked; one hooked read test.
   - [ ] **core/t34 — the `run` chain.** Verify: `op` probe flat when unhooked; a refusing middleware short-circuits.
   - [ ] **core/t35 — the `write` chain.** Verify: cell-write probe flat when unhooked; a refusing write leaves the cell.
   - [ ] **sync/t06 — `source()` and `subscribe(transport)` as extensions;** `subscribe`'s start resolves when the initial
         registration's snapshots arrived; `scope.resolve(source).connect`; the Hono recipe and README follow.
7. **`@tinker/ai`** — the LLM layer over the AI SDK (the model is the swappable slot; generateText/streamText as
   ops; tools as operations; `MockLanguageModelV4` as the test seam). Deferred until a driver asks.

Perf follow-up when the sandbox `bench` is available: `op` parity (budgets.md "Call paths (t27)").

## Shipped — archived

- **sync v1 (2026-09-19)** — complete, ONE WAY: `@tinker/sync` (ADR 0048 + amendment; tags `sync/t01`…`sync/t05`): a
  cell is the shared unit (`synced({ key })` meta; `family({ label, initial, parse? })` = a cell with an id, members
  memoized per id), registration is the client scope's `sync(cell | family)` bindings sent by identity
  (`register { keys }`; a new member registers the moment it exists), the source is the truth
  (`source(scope).connect(transport)`: a session per subscriber, a `sync register` inline op answers with the initial
  snapshots, then every change on a registered key fans out through one watcher per key), the client fills
  snapshots through the cell's parse (`subscribe(scope, transport)`; local writes stay local in v1), and the transport
  is userland's (`Sync.Transport`; `memoryPair()` is the seam; the Hono SSE + POST recipe is `examples/sync/hono.ts`,
  proven through `app.request`). t02–t04 first shipped a two-way LWW design; the user re-cut v1 one way (t05).
  Gate: 37 lanes green, 20 seam tests, size 3324 B, runtime import `@tinker/core` only, mutation 73.53.
  Core feedback: a session shadows cell writes; `tag.all` is newest-first; `scope.onMount` (unregister on last
  watcher) and a core cell family wait for a second asker. Detail: `docs/roadmap/sync-v1/PROGRESS.md`.

- **mcp v1 (2026-09-18)** — complete: `@tinker/mcp` (ADR 0046; tags `mcp/t01`, `harness/t06`, `cli/t04`, `mcp/t02`): a
  tool is an ordinary operation with `tool({ description, schema, name?, respond? })` meta; `tools(op)` binds the list on
  the scope; `mcpServer(scope, { name, version })` returns the SDK's own `McpServer` with every bound op registered, each
  call a session running an inline op `mcp <name>` with the op as its subflow (`rawInput` → the op's parse), one `mcp tool`
  line, `answerTool` default JSON text, failures `{ isError: true }`; `readTool`/`answerTool` shared with the harness
  adapters (the `claudeCode.tool` builder gone; MCP recipes for Claude, Codex, Paseo); the CLI follows the same rule
  (`command` meta + `commands(op)`, loaders stay for lazy modules); a stdio entry through `@tinker/cli`. Gate: 33 lanes
  green, 8 seam tests through the SDK's in-memory Client, size 1591 B, mutation 80.60 (cli 72.03, harness 69.77).
  Detail: `docs/roadmap/mcp-v1/PROGRESS.md`; core feedback rows in `docs/roadmap/core-feedback.md`.

- **harness v1 (2026-09-18)** — complete: `@tinker/harness` (ADR 0043; tags `harness/t01`…`harness/t05`): one frame
  `harness({ label, adapter, approve?, tools? })` over the SDK's OWN types; the SDK module is a resource and the test
  seam (`claudeCode.sdk`, `codex.sdk`); the thread is a session resource (stops its SDK call on the signal; a forced
  close seals the session); six ambient cells; `turn` is an op with one `harness turn` line; resume rides the hooks;
  Claude + Codex adapters; approvals and tools are operations attached at construction, each a subflow of the turn
  (Claude only — Codex's SDK has neither hook). Gate: 29 lanes green, 22 seam tests, size 6746 B, mutation 64.38.
  Along the way: **core/t31** (ADR 0044) — a resource dep is its value, deps build before the body, async typed
  through the graph, the lazy deps Proxy gone (`opres` −95 ns). Three pi contributor deaths in the read phase →
  t03/t04/t05 lead-built. Detail: `docs/roadmap/harness-v1/PROGRESS.md`; core feedback rows in
  `docs/roadmap/core-feedback.md`.

Both v1 milestones are complete. Full ticket detail, budgets, and reset recipes live in the
durable trackers (this list is just the pointer):

- **cli v1 (2026-09-18)** — complete: `@tinker/cli` — the entrypoint driver (ADR 0042): `runMain({ name,
version, scope })` creates and closes the scope; commands are tag bindings on it (`command(name, load, {
input?, respond? })`, `command.entry` for a server command that receives the scope); loaders are lazy
  (help loads nothing); the command runs as an inline op in a session (span + one `cli command` log line);
  exit codes 0/1/2/130; `run()` is the process-free seam. Gate: 25 validate lanes green (cli lanes added),
  size 3087 B, mutation 68.94, 16 tests incl. one real-process smoke test. **core/t29** (found by cli +
  hono/t05): `scope.resolve(tag.all | .optional | .required)` delivers the depends form — no more
  smuggling a table out through an inline op. Core feedback: a lazy operation unit (two askers now).

- **drizzle v1 (2026-09-18)** — complete: `@tinker/drizzle` — `drizzleStore({ label, open, close? })`: a
  required `config` tag, a scope-target `db` resource (`open` once with a logger bound to `ctx.log`, `close`
  by `defer`), a session-target `tx` resource that holds `db.transaction(cb)` open for the session and
  commits on `success` / rolls back on `failed`/`cancelled`/`released` (the session outcome, ADR 0028 paying
  off), one `db query` log line per statement with no params, PGlite as the real test database. Gate: 21
  validate lanes green (drizzle lanes added), size 1959 B, mutation 96.49, 8 seam tests. Core feedback
  recorded (savepoints need "inherit the parent session's instance"; a `defer` TSDoc note; build counts
  via spans). Detail: `docs/roadmap/drizzle-v1/PROGRESS.md`.

- **hono v1 (2026-09-17)** — complete: `@tinker/hono` as a session-level driver (ADR 0039, 0040; tags
  `hono/t01`…`hono/t04`): the entrypoint owns the scope, `tinker(scope, { tags?, onError? })` opens a session per
  request (graceful close = commit after the handler, forced = rollback on client abort), `handle(op, { input?,
respond? })` runs the request as an inline operation (span `GET /users/:id`, one `http request` log line, the
  route op as a nested subflow), error mapping inside the request (400 / 499 / 500 / rethrow), `stream(c, write)`
  keeps the session open until the body ends (the writer is an inline op), `request` tag, `NoSession`. Gate: 17
  validate lanes green (hono tests/size/cast-free/pure bundle added), size 2838 B, mutation 83.33, 24 seam tests
  through `app.request`, every ticket lead-reviewed (found: a forced close after a good request rolled resources
  back; a parse re-run hack → core/t28). core/t28: an operation's `parse` failure is `DataValidationFailed`.
  Census S09 skips import lines. Detail: `docs/roadmap/hono-v1/PROGRESS.md`.

- **http v1 (2026-09-17)** — complete: `@tinker/http` as a frame of core primitives (ADR 0035; tags
  `http/t01`…`http/t05`): shared `backend` tag (default `fetchBackend`), per-client `config` tag read
  per call and merged nearest-wins, session-target `client` resource with `execute(request, ctx)`,
  pure endpoint operations (`x.operation`), `filterStatus` slot + `filterStatus/filterStatusOk/
matchStatus`, one child span per attempt + one log line on transport failure, `retry` slot with a
  fixed transient policy and backoff on `ctx.clock`, `preset` as the test seam. Gate: 13 validate
  lanes green (`pnpm validate` now covers http tests/size/cast-free/pure bundle), size 6203 B of
  10240, mutation 69.87 (break 60), 27 seam tests, every ticket lead-reviewed. Detail:
  `docs/roadmap/http-v1/PROGRESS.md`.
- **verbs + inline + tagged calls (2026-09-17)** — core/t24 (`controller`/`resolve`/`run`, ADR 0036,
  mutation 78.57), core/t26 (inline `scope.run({ depends, run }, call?)`, ADR 0037; `tags` on a call
  open a child session, always async, ADR 0038; mutation 78.39; +9 ns on `op` recorded → core/t27),
  core/t27 (call-path floors, exact tagged promise census 17), core/t25 (tests speak the everyday verbs).

- **clock v1** — complete and shipped (t20–t23, tags `core/t20`…`core/t23`, ADR 0034): ambient `Clock`
  on every ctx, `makeTestClock` (now/advance/setTime), virtual + real `sleep` with signal abort, forced
  close cancels an in-flight sleep; validation milestone green (validate lanes, mutation 79.13%, cast-free
  README + example). Detail: `docs/roadmap/clock-v1/PROGRESS.md`.
- **perf batch (2026-09-16)** — ctx classes with prototype `signal`, shared obs/trap objects, one record
  lookup per build, lazy deps without a per-build Map (astra SHIP after 4 rounds); cold make+resolve
  3353 → ~715 ns, op run 532 → ~134 ns. Rules: coding-convention "Performance" + census P01–P04.
  Notes: `research/learnings/2026-09-16-core-vs-inferdi.md`.
- **react/store perf vs the field (2026-09-16)** — six-library bench (`bench/react-stores.mjs`,
  `bench/stores-probe.mjs`); tinker first on mount (535 µs) and update (69.5 µs) vs Zustand, Jotai,
  Legend v2/v3, Preact Signals. Landed: per-cell watchers, 3-hook `useData`, data controller record
  fast path, op run path trims (op 134→79 ns), always-valid effective entry (read 9.8→0.54 ns), one eq
  per layer per flush (1000-way fan-out 30→8.4 µs, Zustand 12). Gate 70c7924: validate PASS, mutation 78.52%.
  Notes: `research/learnings/2026-09-16-react-stores.md`.
- **react options (2026-09-16)** — `useResolve` in react-query mutation shape; `useData({ writable })`
  and `useResource({ suspense: false })` as options, not new hooks (ADR 0032 amended).
- **core v1** — complete: packaged scope, data (read/write/watch), operations, tags, sessions,
  structured close, sync/async resources + targets, outcome hooks + `session(fn)`, release +
  cascade, observation, presets, static meta (t01–t18); teardown/lifetime redesign lt1–lt4
  (`ctx.defer`/`ctx.signal`, reverse-registration LIFO, `close()` returns a `Result` and never
  throws, close is a shutdown MODE — ADRs 0024–0029); v1 validation gate green (t19).
  Detail: `docs/roadmap/core-v1/PROGRESS.md`; budgets `budgets.md`; teardown `teardown-redesign.md`.
- **react v1** — complete: `ScopeProvider`/`SessionProvider`, `useScope`, `useData` (+ selector),
  `useController`, `useResource`, `useResolve`, `useRelease`, `useSpans` (r01–r17, all
  astra-reviewed to SHIP; r16 span emission reverted post-v1). Detail:
  `docs/roadmap/react-v1/PROGRESS.md`.
