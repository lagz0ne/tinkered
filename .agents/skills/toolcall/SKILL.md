---
name: toolcall
description: Wrap every tool call in a Jev-judged decision chain — record the goal once, judge each call BEFORE it runs (is it linked to the objective / intention / verification?), then AFTER verify the request and result and trim the output so raw dumps do not pollute the context. Use when a task has a clear goal and you want tool calls kept on-objective and the context clean. Harness-agnostic (Claude, Codex, pi contributors).
---

# The tool-call decision chain

Every tool call passes through a small chain judged by **Jev** (the TypeSafe
evaluation model: typed yes/no · pick · score, **no text generation** —
`docs/roadmap/jev-loop/PLAN.md`). The chain keeps calls on-objective and keeps
raw output from flooding the context. It is **advisory** — it flags and trims;
your gates (`scripts/ticket.sh`, `vp check`, tests) and the human still decide.

Driver: `scripts/jev/toolcall.mjs` (`frame` · `before` · `after`). Key is read
from `/home/paseo/pilot/.ai-gateway-token`, never printed. No key → the chain
skips and you proceed. Cost is fractions of a cent per call. Every call appends a
JSON record to `.jev/trace.jsonl` (gitignored, FIFO-capped to the newest
~2000 entries) — the trace we analyze after a run.

## The three steps

```
frame   (once)   goal → { objective, intention, verification[] }   ── the chain decision
  │
  ▼  per tool call
before           is this call OFF the objective / intention / verification chain?
  │              ✓ proceed   ·   ⚠ weak link → reconsider or note why
  ▼  run the tool
after            verify: did the request stray? did the output fail?
                 trim:   drop tooling noise, keep the signal, save the full dump
```

### 1. Frame — once, at task start

Turn the goal into a structured chain decision. **You** supply the structure
(Jev cannot write it):

```bash
node scripts/jev/toolcall.mjs frame --json '{
  "objective":   "Make the login test pass",
  "intention":   "Fix the null-session bug in auth, no UI changes",
  "verification":["vp test auth green","vp check clean"]
}'
```

Saved to `.jev/frame.json` (gitignored). Re-frame when the goal changes.

### 2. Before — judge the intended call

```bash
node scripts/jev/toolcall.mjs before --json '{
  "tool":"Edit","args":{"file":"src/ui/theme.css"},"why":"tweak button color"
}'
# ⚠ objective link weak (96%), intention link weak (95%) — reconsider or note why you proceed
```

A ✓ means the call is linked to the objective, intention, and verification
chain. A ⚠ means at least one link is weak (≥ 60%): drop the call, or state in
one line why you proceed anyway. It never blocks.

### All-in-one — `run` (gate → execute → prune, a single call)

To wrap a real command in the whole chain at once — no separate `before`/`after`:

```bash
node scripts/jev/toolcall.mjs run \
  --intention "Inspect the failing auth test to locate the null-session bug" \
  --why "read the test output" \
  -- vp test auth
```

It gates the command (won't run an off-intention or unsafe one — add `--force` to
override), runs it, then prunes the output. `--intention` (with optional
`--objective`/`--verification`) is used inline; omit them to reuse the saved frame.
Everything after `--` is the real command, run without a shell so your quoting is
kept. This is the "squeeze it into one call" form; `frame`/`before`/`after` remain
for wrapping non-command tools (Read, Edit, MCP calls).

**Exit codes:** the child's own exit code when the command runs; **3** when the gate
blocks it (nothing ran — distinct from a passing `0`); `2` for a usage error. So
`toolcall run ... && next` runs `next` only if the command ran *and* passed.

> **Write `--why`/`why` to name how the command serves the intention.** The gate
> judges the command text + your `why`, not your unspoken plan. A bare
> `cat /tmp/x` with `why: "reproduce the failure"` scored 24% → skipped; the same
> command with `why: "read the captured test output for the null-session failure"`
> scored 80% → ran. If a call you know is on-goal gets skipped, sharpen the `why`
> (or pass `--force`).

### 3. After — verify the result and trim the output

Write the tool's raw output to a file, then:

```bash
node scripts/jev/toolcall.mjs after \
  --json '{"tool":"Bash","args":{"cmd":"vp test auth"},"why":"see the failure"}' \
  --out /tmp/tool-output.txt
# → trimmed output on stdout; verify flags + "after: errors (95%): kept 3/11 line(s)" on stderr
```

- **Verify** (Jev): flags if the request strayed from intention, or the output
  failed to satisfy the request.
- **Trim** (Jev picks, script cuts): one **choice** of strategy — `whole`
  (the "none" option: do not trim), `pointer` (collapse all), `head`, `tail`, or
  `errors` (keep the failure lines). Jev only routes; the **script executes** the
  strategy deterministically, so nothing is invented or reordered, and the kept
  text still answers the goal. Trusted only at ≥ 60% confidence — below that it
  keeps the output **whole** (safe default). Every trim leaves a pointer to that
  call's own dump under `.jev/out/` (a unique file, so older pointers stay valid;
  `.jev/last-output.txt` is a convenience copy of the newest). Nothing is ever lost.

## Honesty rails (measured, not guessed — see `[[toolcall-evals]]`)

Jev is **jagged**. The evals in `scripts/jev/evals/` measure exactly where, on
labeled cases (2026-09-18), by **separation**:

- **Strong as a pre-filter.** `before` should-run scored **6/6, 82% separation**
  (`command-prefilter.mjs`): run-worthy commands 87–95%, detours/unsafe 2–5%.
  This is the chain's core value — trust it.
- **Good at routing.** Picking the tool lane (read/search/run/edit): **4/4**;
  trust a pick at ≥ 60%, keep whole/defer below.
- **Good at whole-output trim decisions.** Deciding whether a whole response is
  worth keeping scored **8/8, 86% separation** (`should-trim.mjs`), and picking a
  trim strategy scored **5/5** (`trim-how.mjs`). So the trim is a **choice Jev
  routes and the script executes** — never per-line judgment.
- **Blind at per-line relevance.** Scoring individual fragments for noise landed
  **~0% separation** (`reading-intention.mjs`) — Jev could not tell an npm
  warning from a real `FAIL`. So the script never asks Jev which lines to keep;
  it applies a whole-output strategy (`head`/`tail`/`errors`/`pointer`) instead.
  Below the confidence bar it keeps the output whole — nothing lost.

Therefore:

- The trim **keeps on doubt** and is **recoverable** — never trust it to have
  dropped only junk; the full dump is one file away.
- Jev **never** marks a todo done or decides pass/fail. Keep every numeric gate
  (size, CRAP, mutation, heap, dates) in code. See `[[jev-evaluate-access]]`
  and `docs/roadmap/jev-loop/PLAN.md`.
- Each wrapped call adds ~1–3s of round trip and uses the rate-capped free tier.
  Apply the chain to calls that matter — decisions and output-heavy commands —
  not to every trivial read.
