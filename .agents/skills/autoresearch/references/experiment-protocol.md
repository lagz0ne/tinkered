# Experiment protocol: templates

## `state.md`

Path: `.autoresearch/sessions/<id>/state.md`.

```markdown
# Autoresearch: {goal}

## Config

- **Session**: `{id}`
- **Extends**: `{parent id|none}`
- **Benchmark**: `{command}`
- **Target metric**: `{name}`
  ({higher|lower} is better)
- **Scope**: {files or folders in play}
- **Branch**: `autoresearch/{slug}`
- **Base commit**: `{short hash}`
- **Started**: {YYYY-MM-DDTHH:MM:SS}

## Rules

1. One change per experiment.
2. Benchmark after every change.
3. Better: keep. Worse: discard.
4. Log every run to `run.jsonl`.
5. Never commit `.autoresearch/**`.
6. Commit kept code by explicit path,
   with a `Result:` trailer.
7. Commit learnings to
   `research/learnings/{id}.md`.
8. Resume reads only this file and
   the last 20 log lines.
9. Old sessions stay cold unless asked
   for or named in `Extends:`.

## Notes

{what matters about the code, limits,
earlier attempts}
```

## `benchmark.sh`

Path: `.autoresearch/sessions/<id>/benchmark.sh`. It runs the benchmark and
passes through its `METRIC` lines.

```bash
#!/usr/bin/env bash
set -euo pipefail

{benchmark_command} 2>&1 \
  | tee /dev/stderr \
  | grep '^METRIC '
```

## `checks.sh` (optional)

Path: `.autoresearch/sessions/<id>/checks.sh`. Runs before each experiment. A
non-zero exit skips the benchmark.

```bash
#!/usr/bin/env bash
set -euo pipefail

{lint_or_build_command}
{test_command}
```

## `METRIC` lines

A benchmark prints one metric per line:

```text
METRIC name=value
```

- `name` matches `[a-zA-Z_][a-zA-Z0-9_]*`.
- `value` is a number: whole, decimal, negative, or `1.5e-4` form.
- The line starts with exactly `METRIC ` (one space).

```text
METRIC ns_per_op=412
METRIC heap_kb=1830
METRIC delta=-0.03
METRIC ratio=1.5e-4
```

## Log lines

Baseline:

```json
{
  "run": 1,
  "commit": "abc1234",
  "metrics": { "ns_per_op": 520 },
  "status": "keep",
  "description": "baseline",
  "timestamp": 1710000000
}
```

A crash logs empty metrics:

```json
{
  "run": 4,
  "commit": "jkl3456",
  "metrics": {},
  "status": "crash",
  "description": "pool the scope objects",
  "timestamp": 1710000900
}
```

## A session, start to end

```text
/autoresearch "cut ns per op on scope.run"

Benchmark: node probe.mjs run
Metric: ns_per_op, lower is better
Branch: autoresearch/cut-scope-run
Baseline: ns_per_op=520

2: share the trap object   → 480  KEEP
3: inline the lookup       → 495  DISCARD
4: lazy abort controller   → 430  KEEP
5: cache the ctx           → 430  DISCARD (same)
6: pool the scope objects  → OOM  CRASH

After 6 runs: 2 kept, 2 discarded, 1 crash.
Best: 430 (run 4), 17% under baseline.
```
