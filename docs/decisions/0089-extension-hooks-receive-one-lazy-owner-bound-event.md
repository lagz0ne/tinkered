# 0089 Extension hooks receive one lazy owner-bound event

Date: 2026-09-30.
Status: accepted shape; implementation gates remain open.
Builds on: 0050, 0051, 0073, and 0088.

## Context

An engine needs the namespace and owner of the work it controls.
Adding positional arguments makes each hook harder to grow.
The user asked for one combined object that is lazy and cheap.

The precedent is a typed event with a `kind` field.
That field tells the caller which payload and continuation it has.
The existing middleware chain still selects which hooks receive it.

## Decision

Add named object hooks beside the existing callback form.
Each new hook takes one event with payload, `next`, and bound access.
Existing callback arguments stay unchanged.
If both forms define the same kind, the object hook wins.

```ts
const managed = tag({ default: false });
const count = data({ initial: 0 });
const engine = extension({
  label: "http.engine",
  hooks: {
    run(event) {
      if (!event.resolve(managed)) return event.next();
      event.controller(count).update((n) => n + 1);
      return event.next();
    },
  },
});
```

- `kind` selects start, session, run, resolve, write, or close.
- `Scope.ExtensionEvent` names the combined union.
- `Scope.ExtensionEvents["run"]` names one member.
- `ns` includes the inherited or overridden namespace chain.
- Controllers act in the event's actual session and key.
- Run hooks own their waits, cleanup, and resource holds.
- Resource targets still choose sharing and lifetime.
- Start and close act on their root's state.
- Live state belongs in resources or data, not the definition.

Create an event only for a subscribed object hook.
Build and retain its access functions on first use.
Passing through must not make controllers or access contexts.
Keep the path with no hooks unchanged.

## Limits

Resolve hooks wrap direct root reads only.
They do not wrap session reads, dependencies, or event access.
A module must expose explicit setup when it needs readiness before a read.

Namespaces remain keys with fixed bindings.
No namespace lifetime or sibling-session routing is added.
Closing an owner discards its live state, as in ADR 0088.

## Proof

The authoring track tests the cases and records queued timing checks.
Its size gate remains the existing Core budget.
This decision approves the shape, not a budget increase.
See [the case notes](../roadmap/authoring-model/EXTENSION-SHAPE.md).
