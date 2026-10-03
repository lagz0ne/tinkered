# 0100 No service outside the graph

Date: 2026-10-03. Status: accepted.
Adds to ADR 0099.

## Context

The flight-trial services had `startSupplier()` and `startPayment()`.
Each helper made a scope and started a server from outside the graph.
The Start scaffold kept its server root scope in a module-level getter.

The user ruled that a service must never exist outside the graph.

## Decision

Only entry points call `createScope`.
An entry point owns its scope, its stop signal, and process exit.
For Start these are the server entry and the client router factory.
For a trial service it is that service's `main.ts`.
A test is its own entry point.

Every long-lived thing is owned by a resource:
a server, client, connection, clock, timer, watcher, queue, or cache.
None lives at module level or inside a plain function.

No helper exports a scope, a scope getter, or a "start" function.

The strict check from ADR 0099 also fails on:
`createScope` outside an entry file,
a module-level `let` that holds a scope or handle,
and an exported function that returns a scope.
