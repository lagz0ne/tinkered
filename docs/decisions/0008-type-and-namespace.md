# 0008 `type` over `interface`; one namespace per concept

Date: 2026-09-13. Status: accepted.

## Context

`interface` and `type` both describe shapes. `interface` merges and can be
implemented; those powers are rarely needed and make a reader ask which one
is in play. Loose sibling types (`TaskOptions`, `TaskResult`, `TaskLike`)
scatter one concept across many names.

## Decision

- Shapes are `type X = { ... }`. `interface` only when a class implements it,
  a later module must merge into it, or the shape is recursive in a way
  `type` cannot express. The TSDoc names the reason.
- Types for one concept sit in `export declare namespace <Concept>` in that
  concept's module, named after the runtime value that creates it:
  `createTasks(): Tasks.Handle`, `Tasks.Task`. Runtime values stay top-level.

## Consequences

Census W09 reports `interface` declarations (watch, not strict). The worked
example in `.agents/skills/coding-convention/examples/tasks/` shows the shape.
