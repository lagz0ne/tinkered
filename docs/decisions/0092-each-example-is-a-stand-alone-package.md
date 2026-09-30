# 0092 Each example is a stand-alone package

Date: 2026-09-30. Status: accepted.
Replaces ADR 0045's shared example package.

## Context

The user needs to run and copy each example on its own.
One shared install hides missing dependencies and run settings.
The precedent is a small consumer app with its own package file.
Keep all examples under `examples/`, but give each folder its own package.
Use public imports and plain versions, with local links inside the repo.
Each folder owns its config, entry, checks, and run steps.

## Consequences

The libraries are not on npm yet.
The export command includes local package archives for a copied example.
It rewrites only that copy's dependency settings.
Checks install and run the copy outside the repo.
The libraries' built public entries remain the only library code examples import.

See [pnpm's workspace rules](https://pnpm.io/workspaces).
