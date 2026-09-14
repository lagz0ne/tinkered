# 0015 `preset` is a test-only replacement

Date: 2026-09-14. Status: accepted.

## Context

The prototype used `preset` two ways: as a scalar-`data` starting value (which
bypassed `parse`) and as a production warm-reload seed. It ignored presets for
resources, operations, and families. pumped-fn treats presets as a test-only
substitution seam (`no-preset-outside-test`).

## Decision

- **`preset(node, replacement)` replaces a node's realization, for tests only.**
  It is the substitution seam that lets a scope test swap an edge with no module
  mocks. It is not a production mechanism.
- **Only downstream consumers benefit.** Units that depend on the preset node
  resolve the replacement instead of the real node; the node itself is
  substituted at the scope where the preset is applied.
- Typed per node kind: a value for `data`, a factory/value for `resource`, a run
  for `operation`. A `data` replacement value is validated through `parse` — no
  bypass.
- **Warm reload is not a preset.** Restoring saved state on load seeds `data`
  values explicitly (write them at/after scope creation), never via `preset`.

## Consequences

- Tests substitute any node kind through one seam; production code never presets.
- The `app.ts` scratch demo must stop reloading via `preset` and seed `data`
  from storage instead.
- A future lint (mirroring `no-preset-outside-test`) can enforce test-only use.
