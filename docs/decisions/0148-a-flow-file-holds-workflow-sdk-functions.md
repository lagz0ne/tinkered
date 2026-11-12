# 0148 A flow file holds the Workflow SDK's functions

Date: 2026-11-12. Status: accepted (issue #35,
option 1; Duke, 15:47: "Go ahead"); built.
Adds to: ADR 0145 (`tinker/plain`) and ADR 0149
(a call by name).

## What the asker said

Issue #35, from an app on tinker-app v0.25.1 that
runs the [Workflow SDK](https://workflow-sdk.dev)
(`workflow@5`):

- "So the plain function is the SDK's contract,
  not app logic escaping the graph."
- Option 1 first: "Only in `*.flow.ts` (and
  `*.flow.server.ts`) files."

## Context

The SDK finds a workflow and a step by a
directive at the top of a named function:

```ts
export async function nameFlow() {
  "use workflow";
  return await suggest();
}

async function suggest() {
  "use step";
  return callOperation("naming.suggest");
}
```

- Its compiler rewrites each one and gives it a
  stable id. It cannot find an `operation({ run })`.
- It bundles each workflow and step on its own.
  A step that imports a cell gets its own copy,
  and the scope refuses it (`InvalidDependency`).
- So a step calls a server operation by name.
  The logic stays in operations.

`tinker/plain` printed one finding per workflow
and per step: 16 in the asker's spike. The only
way out was one `plain.entries` row per function.

## Precedent

- **ECMAScript directives.** `"use strict"` counts
  only in the leading string statements of a body.
  The same string later is a plain expression.
- **Next.js `"use server"`.** The directive marks a
  function the framework calls, not app code.
- **Go `_test.go`, and ADR 0131 `*.testing.ts`.**
  The file name marks a kind of code.
- **ESLint `overrides.files`.** A rule reads a file
  by its glob.

## Decision

1. **A flow file** is a file whose name ends in
   `.flow.ts` or `.flow.server.ts`.
2. **In a flow file, a flow function passes
   `tinker/plain`.** Its body starts with
   `"use workflow"` or `"use step"`, among its
   leading string statements, as ECMAScript reads
   a directive.
3. **Everywhere else, it still fails.** A directive
   function in any other file is a plain function.
4. **Only the directive counts.** A string after a
   statement, a string in parens, or another
   directive (`"use server"`) passes nothing.
5. **A helper in a flow file still fails.** The
   file name passes no other function.
6. **A flow function is called by name only from
   a flow function.** ADR 0149 makes a passing
   function that a call names a finding. A
   workflow calls its steps by name, so a call
   whose outermost function is a flow function in
   a flow file may name a flow function. A call
   from any other place is a finding.
   `start(nameFlow, [...])` hands the workflow to
   the SDK. It does not call it, so it passes.

## The shape a flow keeps

- A flow function stays thin: it awaits hooks,
  sleeps, and calls operations by name.
- A step can run again after a crash, so each step
  is safe to repeat.
- The logic lives in operations, as before.

## Where ours is simpler

- The check reads syntax only. It does not check
  that a step calls only operations (option 2).
- No config. The file name is the opt-in, so each
  feature keeps its flows in one place.

## Proof

`packages/analyze/tests/plain.test.ts`:

- a workflow and a step pass in a flow file; a
  helper beside them fails;
- the same functions fail outside a flow file;
- a directive after a statement, in parens, or
  another directive fails.

`packages/analyze/tests/called.test.ts`:

- a workflow calls its step by name, also inside
  an arrow in its body: no finding;
- a plain file that calls a step by name: a
  finding at the step;
- a plain file that hands the workflow to
  `start`: no finding.

## Not decided

- **Option 2:** a finding when a flow function
  does more than await, sleep, and call operations
  by name.
- **The page.** A `.flow.ts` file in `src/` is a
  page file, so the page rules read it. A
  `.flow.server.ts` file is not.
