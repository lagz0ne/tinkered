---
name: autoresearch
description: "Experiment loop discipline for autoresearch sessions — decision rules, git workflow, JSONL logging, benchmark metrics, anti-patterns"
---

# Autoresearch — Experiment Loop Skill

You are in an autoresearch session. This skill governs how you run the experiment loop.

## Session State

State lives in files (survives context resets):

- `.autoresearch/current` — active session id
- `.autoresearch/sessions/<session-id>/state.md` — config, rules, scope
- `.autoresearch/sessions/<session-id>/benchmark.sh` — benchmark wrapper
- `.autoresearch/sessions/<session-id>/run.jsonl` — run log (append-only)
- `research/learnings/<session-id>.md` — extracted learning that should be committed
- Git branch `autoresearch/*` — all work happens here

Runtime state under `.autoresearch/**` is in-progress state. Never commit it.

**On context reset**: read `.autoresearch/current`, then that session's `state.md` and only the last 20 lines of `run.jsonl`. The last JSONL entry tells you the run number and current state. Do not scan older sessions by default. To extend prior work, create a new session id and set `Extends:` in `state.md`; then read only the parent session's summary/last 20 runs unless the user asks for deeper history.

## Retention

Default policy:

- Hot: active session from `.autoresearch/current`
- Warm: sessions modified in the last 14 days
- Cold: older sessions, read only on request or explicit `Extends:`

On start/resume/stop, prune cold runtime sessions that are not active. Keep `research/learnings/*.md` as the durable record.

## Experiment Protocol

### Each Iteration

1. **Hypothesize** — one change, clear rationale, predicted impact
2. **Implement** — minimal diff, touch only scoped files
3. **Benchmark** — `bash "$SESSION_DIR/benchmark.sh"`
4. **Decide** — based on target metric and direction from `$SESSION_DIR/state.md`
5. **Record** — append JSONL, commit or revert
6. **Report** — run#, change, before→after, decision

### Decision Rules

| Outcome           | Action                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Metric improves   | `git add <intended-paths>` and commit with `Result:` trailer. JSONL: `"status":"keep"`         |
| Metric regresses  | Revert only intended experiment pathspecs. JSONL: `"status":"discard"`                         |
| Metric unchanged  | Discard unless change is a prerequisite. JSONL: `"status":"discard"`                           |
| Benchmark crashes | Revert only intended experiment pathspecs. JSONL: `"status":"crash"`. Diagnose before next run |
| Benchmark timeout | Treat as crash                                                                                 |

Never use `git add .` or whole-tree checkout/reset in an autoresearch session. They mix runtime trash, unrelated user edits, and experiment edits.

### Commit Format

```
experiment: <short description>

<detailed rationale — what and why>

Result: <metric>=<value>, <metric>=<value>
```

### JSONL Schema

Each line is a JSON object:

```json
{"run":<n>,"commit":"<short-hash>","metrics":{<parsed>},"status":"keep|discard|crash","description":"<what changed>","timestamp":<unix>}
```

- `run` — sequential, starts at 1 (baseline)
- `commit` — short hash of HEAD at time of run (before revert if discarded)
- `metrics` — full parsed output from `parse-metrics.sh`
- `status` — decision outcome
- `description` — human-readable summary of the change
- `timestamp` — Unix epoch seconds

## Extracted Learning

Commit learning only when it is reusable outside the active run. Use one file per session:

```text
research/learnings/<session-id>.md
```

This avoids conflicts between resumed or parallel research sessions. Keep these commits separate from experiment commits when practical.

## Anti-Patterns

- **Compound changes** — never change two things at once. If you can't attribute the metric delta to exactly one change, split it.
- **Ignoring regressions** — if the metric went down, revert. No exceptions for "but it's cleaner code."
- **Skipping the benchmark** — every change gets benchmarked. No eyeballing.
- **Changing the benchmark** — never modify `$SESSION_DIR/benchmark.sh` mid-session unless the benchmark itself is broken. Log this as a special entry.
- **Committing runtime state** — never commit `.autoresearch/**`; it is local progress state.
- **Bloating session state** — do not read or preserve old runtime logs forever. Compact by default; keep learning in committed files.
- **Unbounded exploration** — if 3 consecutive experiments are discarded, stop and reassess strategy. Report to user.
- **Forgetting to log** — every run gets a JSONL entry, even crashes.
- **Large diffs** — keep each experiment's diff under 50 lines. Smaller is better.

## Session Resumption

If `.autoresearch/current` exists but you have no conversation context:

1. Read `.autoresearch/current` to get the session id
2. Read `.autoresearch/sessions/<session-id>/state.md` for config
3. Read only the last 20 lines of `.autoresearch/sessions/<session-id>/run.jsonl`
4. Check `git log --oneline -5` for recent experiment commits
5. Prune non-active cold runtime sessions older than 14 days
6. Report status to user: "Resuming autoresearch session: run {n}, last result: {status}"
7. Continue the loop

## Progress Reporting

Every 5 runs (or on user request), show a summary:

- Total runs, keeps, discards, crashes
- Best metric value and which run achieved it
- Cumulative improvement from baseline
- Trend direction
