# 0093 Extension hooks use the event form only

Date: 2026-09-30. Status: accepted.

## Context

The user asked to remove positional hooks and migrate all current extensions.
Keeping both forms leaves two authoring paths and a precedence rule to learn.
The event form already gives each hook lazy owner and namespace access.

## Decision

Use `hooks` as the single extension hook API.
Its six verbs each receive one bound event.
Remove top-level positional hooks and their fallback dispatch.
Migrate current packages, apps, examples, tests, and probes together.

```ts
const boot = extension({
  label: "boot",
  hooks: {
    async start(event) {
      await event.next();
    },
  },
});
```

This replaces ADR 0089's compatibility and precedence rules.
Its event shape, lazy access, ownership, and resolve limits still apply.
The middleware order and cleanup rules from ADRs 0050 and 0051 remain.
Core keeps its 16 KiB gzip cap.
