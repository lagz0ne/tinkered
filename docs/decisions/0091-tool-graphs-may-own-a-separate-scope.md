# 0091 Tool graphs may own a separate scope

Date: 2026-09-30. Status: accepted.

## Context

Observer callbacks receive spans and logs, without the app's owner.
A queue captured by one reusable sink mixes state from multiple roots.
The user asked for the observer's own graph and scope.
The same rule applies to a logger or devtools module with state and cleanup.

## Decision

Use a separate scope for the tool's graph.
Its extension drives its goal.
Tags configure it; data and resources hold its state; operations act on it.
The app borrows a small callback value resolved from that graph.

The root entry wires both scopes, as it wires a separate telemetry pipeline.
Close the app first, then close the tool scope to finish the final events.
Leave a telemetry graph's own observation off by default.
Do not create a private root inside a helper or expose its scope to userland.
A plain formatter with no state or cleanup remains a pure function.

This keeps the static graph rule from ADR 0088.
It extends ADR 0078's root wiring to include separate tool owners.
The callback API remains `Observe.Config`; Core needs no observer change.
Stack's reusable trace extension is the first checked case.
