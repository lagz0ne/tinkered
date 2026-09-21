# tinkerer v1 — build progress

Tinkerer is our own ReAct loop on core: a frame whose turn calls a chat model, runs the
tool calls it asks for as subflows, and repeats until a reply has no tool call (ADR 0053).
Package `packages/tinkerer` (`@tinker/tinkerer`), built on `@tinker/core`, `@tinker/http`,
`@tinker/mcp` (`expose` rows); peer `zod`. Model: Muse Spark 1.3 Contributor over
`https://api.meta.ai/v1/chat/completions`.

- **Decision:** `docs/decisions/0053-tinkerer-is-our-own-react-loop-on-core-settings-are-a-session-cell-the-inbox-steers-or-queues.md`.
- **Glossary:** `docs/glossary.md` → "Tinkerer" (tinkerer, step, transcript, settings, mode, inbox, persist).
- **Analogy:** pi's `agent-loop.js` (`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`).
- **Probe:** `packages/tinkerer/probe/` — recorded request and reply of one round trip (2026-09-21, both 200). The replies are the first fixtures.
- **Gate + tag:** `scripts/ticket.sh tinkerer <NN> "<title>"` → `tinkerer/t<NN>`; mutation lane alone, floor 75.
- **Key:** `/home/paseo/pilot/.muse-token`, read at the composition root, bound as a header on the config tag; never printed, never in the package.

## The frame, as its own blueprint

```yaml
- tag:
    name: config
    promise: >-
      model, baseUrl, headers, system,
      reasoning_effort, max_completion_tokens;
      nearest binding wins per key
    why: the provider's own fields, nothing invented
- tag:
    name: mode
    promise: >-
      read-only | workspace-write | full-access;
      the default for a session's settings
    why: a policy string, Codex's approvalPolicy shape
- operation:
    name: step
    depends: [config]
    promise: >-
      one POST /chat/completions on the merged
      config; SSE deltas out; one span
    why: the model call is an http endpoint
    work: HttpRequest.post + res.sse()
- data:
    name: messages
    promise: the transcript, wire shape, one per session
    why: what was sent is what is stored
- data:
    name: settings
    promise: >-
      { mode, options }; seeded from the tags at
      turn start; read at every step and tool call
    why: mode always goes with the next call
- data:
    name: inbox
    promise: >-
      pending entries { kind, content, mode?, options? };
      queue waits for the answer, steer aborts the step
    why: talk to a running turn without a new API
- data:
    name: status
    promise: idle | running | done | failed
    why: a TUI or a test reads one word
- data:
    name: text
    promise: the reply text so far, streamed
    why: watch it, do not poll it
- data:
    name: usage
    promise: input, cached, output tokens; summed per turn
    why: the provider reports it; keep it
- operation:
    name: turn
    depends:
      - step
      - messages
      - settings
      - inbox
      - status
      - text
      - usage
      - tools
    promise: >-
      prompt in; steps and tool calls until a reply
      has no tool call; the final message out
    why: the loop is one operation, every piece a subflow
    work: >-
      push user; loop: read settings; step; on
      tool_calls run each as a subflow (mode check
      first); push results; drain inbox
- operation:
    name: read
    promise: a file under cwd, with offset and limit
    why: the smallest real tool; proves the loop
- operation:
    name: bash
    promise: >-
      a command in cwd with a timeout;
      full-access only
    why: pi's shape
- operation:
    name: edit
    promise: replace oldText by newText once, under cwd
    why: pi's shape
- operation:
    name: write
    promise: write content to a path under cwd
    why: pi's shape
```

## Order & status

Each ticket blocks the next one.

- **http/t06** — [x]
  `HttpResponse.sse()`: server-sent events from
  `stream()` (WHATWG rules: `event`, `data`, `id`;
  blank line ends an event; `:` lines skipped).
  Generic — no `[DONE]` knowledge; the caller stops.
  Fixture through `HttpResponse.make({ body })`.
  In `packages/http`.
- **tinkerer/t01** — [x]
  Package, frame, `config` tag, `step` endpoint,
  cells `messages`, `status`, `text`, `usage`.
  `turn` with no tools: prompt → streamed answer.
  Seam test: the `backend` tag fed with the recorded
  `2-answer` reply; `text` grows; `usage` lands.
  `examples/tinkerer/real.ts` prints one answer.
- **tinkerer/t02** — [x]
  Tools as `expose` rows; tool calls as subflows,
  parallel unless `sequential`, results in the
  model's order. `length` guard; unknown tool and
  a throw → error result. `mode` tag → `settings`
  seeded; `read` tool; `read-only` blocks the rest.
  Seam test: `1-ask` then `2-answer` fixtures.
- **tinkerer/t03** — [x]
  `bash`, `edit`, `write`; `workspace-write` (paths
  under cwd, no bash) and `full-access`.
  Seam tests in a temp dir.
- **tinkerer/t04** — [x]
  `inbox`: `queue` after the answer would land;
  `steer` aborts the step in flight (the loop
  watches the cell), running tools get `aborted`
  results, partial text kept, partial tool calls
  dropped, `settings` patched. Test with a backend
  that hangs until aborted.
- **tinkerer/t05** — [x]
  `persist(dir)` extension on the `session` hook:
  JSONL per session; `resume(file)` seeds
  `messages`. Test through `createScope({ extensions })`.
- **tinkerer/t06** — [x]
  `@tinker/cli` command `tinkerer ask "<prompt>"`
  (`--cwd`, `--mode`); README; `files`, size lane;
  mutation alone ≥ 75; validate lanes.

## Ticket rules

- One package per contributor, own worktree (`docs/roadmap/contributor-brief.md`).
- Every operation has a seam test through `createScope({ tags, presets })` and the http
  `backend` tag; no network in tests. The recorded probe replies are the fixtures.
- The transcript is the wire shape; no converted message union.
- `settings` is read at every step and every tool call, never cached for the turn.
- Every report ends with **Core feedback** (a failing snippet, not prose).

### Landed

One line per ticket: tag — sha — tests — size (B gzip) — mutation — notes.

- **http/t06** — `573d3f6` — 6 sse tests (61 in http) —
  7389 (cap 10240) — 84.69 alone (`response.ts` 77.20) —
  writer-built (pi meta-muse), one fix round (the
  fixture was untracked; a CRLF split across chunks
  made a false blank line — test first, then fix).
  Lead seam test: a pending event at end of stream.
  Jev review 0 flags. Core feedback: the guide's
  "reads like a X" note has no judge to label
  (`label.mjs unit` unknown).
- **tinkerer/t01** — `2552b0e` — 12 tests —
  1996 (cap 10240) — 78.21 alone (63.69 before the
  lead's five seam tests) — writer-built (pi
  meta-muse), one fix round (core controller types,
  `EmptyPrompt`, no line comments, one status
  write). Real endpoint: the example streamed
  "Hi there, how are you?" (13 in / 682 out).
  Fact: `{ input }` skips the op's parse; only
  `{ rawInput }` runs it.
- **tinkerer/t02** — `c0cc33a` — 25 tests —
  4265 (cap 10240) — 78.70 alone (72.99 before the
  lead's four seam tests: DuplicateTool, bad JSON
  args, sequential, parallel) — writer died once in
  the read phase (resumed with a step list), then
  committed with `--no-verify` and reported its
  three check errors as pre-existing; the lead
  fixed them (typed `tool:` slots as in harness,
  complexity, exact asserts, no test cast). Real
  endpoint: `user > assistant > tool > assistant`,
  the model read the README heading.
- **tinkerer/t03** — `655ad06` — 32 tests —
  5811 (cap 10240) — 79.10 alone — lead-built
  (the writer route dies on multi-file tickets):
  `write`, `edit`, `bash`, a shared `resolveUnder`
  path guard, `EditMiss` in the registry,
  `shippedTools`. Real endpoint (`workspace-write`):
  the model wrote hello.txt and was told bash needs
  full-access. Fact: a mutant can write outside the
  temp dir (once left /tmp/escape.txt) — an escape
  test targets a fresh dir it also asserts empty.
- **tinkerer/t04** — `f937143` — inbox: queue and
  steer, six seam tests, mutation 79.19 alone —
  lead-built. The fold breaks between stream events
  on a pending steer (a mid-read async-generator
  `return()` deadlocks). Real endpoint: a queued
  follow-up answered "Hello" then "Bonjour" in one
  run.
- **tinkerer/t05** — `8172607` — persist extension:
  JSONL per file, resume seeds `messages`, `restore`
  reader; four seam tests; 79.50 alone — lead-built.
  On the session hook, watch the session handle (a
  write flows down), seed from the file, append the
  rest.
- **tinkerer/t06** — `6462a3f` — `askCommand`: a
  `@tinker/cli` row over `frame.turn`; four seam
  tests; 80.10 alone — lead-built. Config is scope
  level (the root binds `cwd`/`mode`). Real endpoint:
  `ask "…"` printed the answer, code 0. Also
  formatted a pre-existing unformatted blueprint ADR
  so `vp check` is green on main.
- **tinkerer/t07** — `5007d2a` — the gate (ADR
  0053's deferred human-in-the-loop slot):
  `gate((request) => decision)` runs as a subflow
  before each tool, after the mode check; a block
  answers the model and the tool never runs. Being
  an operation, it may read a cell or ask a human.
  Four seam tests; 80.31 alone. Real endpoint: the
  gate declined a `write` in a full-access session,
  no file written, the model said why.

### Impact blocks (ADR 0047)

New package: every tinkerer ticket's impact is `packages/tinkerer/**` plus
`examples/tinkerer/**`. `http/t06` is `packages/http/src/response.ts`,
`packages/http/tests/**`, `packages/http/README.md`. t06 adds
`packages/cli/**` only if the command needs a new row shape (it should not).
