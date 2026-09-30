# 0087 Extensions control tagged namespaces; the scope disposes their state

Date: 2026-09-30.
Status: accepted model; proposed namespace disposal was never implemented.
Disposal rule superseded by [0088](0088-keep-the-graph-static-close-the-session-to-discard-state.md).
Builds on: 0059, 0060, 0063, 0064, 0070, and 0081.

## Context

The user wants tags, resources, operations, and data to form a module's API.
Its extension manages work and state for the instances selected by namespace.
Tags on a namespace tell the extension what it should manage.

The concrete case is a GitHub HTTP client and a Cloudflare HTTP client.
Each has its own namespace and settings.
They can share directory management.
Isolation here means separate instances.

The earlier choice between a module stop operation and namespace shutdown
added a feature the user had not asked for.
The user clarified the desired action: dispose the unwanted namespace.

The precedents already exist in this repo.
ADR 0070 describes a controller that watches state and acts on it.
ADR 0063 releases owned resources while waiting for current users.
Namespace disposal should build on those rules.

## Decision

- Extensions must know which namespace they are handling.
- Namespace tag bindings describe what an extension should control.
- An extension can control the selected instance's state.
  ADR 0070's rule still holds: a status has one writer, its owner.
- Disposing an unwanted namespace frees its owned state and resources.
  A separate module stop and restart API is not required for disposal.
- The scope owns the stored values and performs their disposal.
  A namespace remains their selection key.
- Disposing GitHub leaves the separate Cloudflare client and their shared
  directory service alive.

Dropping a JavaScript variable is not disposal in the current implementation.
The scope's maps still hold namespace keys and their stored values.

## Open API

One proposed spelling is:

```ts
await scope.dispose(github);
```

This method does not exist yet.
The signature, discovery of namespaces, and disposal during active work
still need a design and tests.
The [track](../roadmap/authoring-model/PROGRESS.md) holds the current proposal.
