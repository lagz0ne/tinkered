---
name: autoresearch
description: "Rules for an autoresearch experiment loop: one change per run, benchmark, keep or revert, log every run as JSONL, commit what was learned."
---

# Autoresearch

This skill runs the experiment loop in an autoresearch session.

## Where state lives

State lives in files, so it survives a context reset:

- `.autoresearch/current` — the active session id.
- `.autoresearch/sessions/<id>/state.md` — config, rules, scope.
- `.autoresearch/sessions/<id>/benchmark.sh` — the benchmark wrapper.
- `.autoresearch/sessions/<id>/run.jsonl` — the run log. Append only.
- `research/learnings/<id>.md` — what was learned. This one is committed.
- A git branch `autoresearch/*` — all work happens there.

Everything under `.autoresearch/**` is work in progress. Never commit it.

Templates for `state.md`, `benchmark.sh`, and the log:
[references/experiment-protocol.md](references/experiment-protocol.md).

## Each run

1. **Guess:** one change, why, and what it should do to the metric.
2. **Change:** the smallest diff, only in scoped files.
3. **Measure:** `bash "$SESSION_DIR/benchmark.sh"`.
4. **Decide:** by the target metric and direction in `state.md`.
5. **Record:** append a JSONL line, then commit or revert.
6. **Report:** run number, change, before → after, decision.

Wall-clock timing never runs in this container. Run it through `bench` (see
the global rules).

## Keep or revert

- **Better** — commit the intended paths with a `Result:` trailer.
  Log `"status":"keep"`.
- **Worse** — revert only the experiment's paths. Log `"status":"discard"`.
- **Same** — discard, unless a later change needs it.
  Log `"status":"discard"`.
- **Crash** — revert only the experiment's paths. Log `"status":"crash"`.
  Find the cause before the next run.
- **Timeout** — same as a crash.

Never `git add .`. Never check out or reset the whole tree. Both mix log
files, the user's own edits, and the experiment.

## Commit message

```text
experiment: <short description>

<what changed and why>

Result: <metric>=<value>, <metric>=<value>
```

## Log line

One JSON object per line:

```json
{
  "run": 2,
  "commit": "def5678",
  "metrics": { "ns_per_op": 412 },
  "status": "keep",
  "description": "share the trap object",
  "timestamp": 1710000300
}
```

- `run` — counts up from 1, the baseline.
- `commit` — short hash of HEAD at run time, before any revert.
- `metrics` — every `METRIC` line the benchmark printed.
- `status` — `keep`, `discard`, or `crash`.
- `description` — the change, in plain words.
- `timestamp` — Unix seconds.

## What was learned

Commit a learning only when it helps outside this run. One file per session,
`research/learnings/<id>.md`, so two sessions never edit the same file. Commit
it apart from experiment commits.

## Traps

- **Two changes at once.** If you cannot pin the delta on one change, split it.
- **Keeping a regression.** Worse means revert, even if the code is cleaner.
- **Skipping the benchmark.** Every change is measured. No eyeballing.
- **Changing the benchmark.** Leave `benchmark.sh` alone mid-session unless it
  is broken. If you fix it, log that as its own line.
- **Committing `.autoresearch/**`.**
- **Hoarding old logs.** Keep learnings in committed files; prune the rest.
- **Wandering.** Three discards in a row: stop, rethink, tell the user.
- **A run with no log line.** Crashes get a line too.
- **Big diffs.** Keep each experiment under 50 lines.

## Resume after a reset

If `.autoresearch/current` exists but you have no context:

1. Read `.autoresearch/current` for the id.
2. Read that session's `state.md`.
3. Read only the last 20 lines of its `run.jsonl`. The last line gives the run
   number and state.
4. Check `git log --oneline -5` for recent experiment commits.
5. Prune old sessions (see below).
6. Tell the user: "Resuming autoresearch session: run {n}, last result:
   {status}".
7. Go on with the loop.

To build on an older session, start a new id and set `Extends:` in its
`state.md`. Read only the parent's summary and last 20 runs, unless the user
asks for more.

## Old sessions

- **Hot:** the one named in `.autoresearch/current`.
- **Warm:** touched in the last 14 days.
- **Cold:** older. Read only when asked, or when named in `Extends:`.

On start, resume, and stop, delete cold sessions that are not active. The
learnings files are the lasting record.

## Progress

Every 5 runs, or when asked, report:

- runs, keeps, discards, crashes;
- the best value, and which run got it;
- the total gain over the baseline;
- the trend.
