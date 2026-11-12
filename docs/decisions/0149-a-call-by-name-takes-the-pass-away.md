# 0149 A call by name takes the pass away

Date: 2026-11-12. Status: accepted (Duke, 15:17:
he chose "A. Build the guard"); built.
Adds to: ADR 0145 (`tinker/plain`).

## What the user said

Duke, 13:35: "Ah so more rules added so it can be
bypassed then".
Duke, 14:03: "Are we underlook this. Spend more
time on this".

## Context

`tinker/plain` judged a function only where it is
written. A function passed when it was a callback,
a Core body, a library option, a closure in a unit
body, a listener, or a React component.

Each pass has one reason: something other than app
code calls the function. The check never looked at
who calls it. So a passing function could still be
used as a plain helper.

Three apps passed the check: Hedl, the template,
the site. An audit with the TypeScript checker
resolved every call in them.

- Hedl: 13,055 calls. 384 go straight to an app
  function. 334 of those reach a closure in a unit
  body, and 16 reach a listed entry.
- 10 functions in Hedl pass, hold no state, and
  are called by name. The template and the site
  have 1 each.

```ts
const columnX = useCallback(
  (column: number) => X0 + column * COLW,
  [],
);
```

A set of 20 tries to hide a helper: the check
caught 6.

## Precedent

- **React's Rules of Hooks lint.** It checks call
  sites, by syntax and by name. It is not complete,
  and it holds a code base to the rule.
- **`unicorn/consistent-function-scoping`.** "A
  function definition should be placed as close to
  the top-level scope as possible without breaking
  its captured values." A function that captures
  nothing does not need to be inside.
- **ArchUnit, dependency-cruiser.** A structure
  rule checks the edges (who uses what), not only
  the declarations.

## Decision

1. **A pass says who calls the function.** Core, a
   library, React, an event source. A call by name
   from app code takes the pass away.
2. **App code calls by name only three things.**
   - An operation, through the scope.
   - A closure: a function that reads a name of a
     function around it, so it holds state of the
     unit it lives in.
   - An entry listed in `tinker-analyze.json`.
3. **The finding is at the helper.** One line for
   each helper, with its first call:

   ```text
   src/a.ts:7 tinker/plain a helper, called by
   name at src/a.ts:20
   ```

4. **Syntax only.** The check follows a name to a
   local, a top-level name, or an app import, and
   an alias (`const b = a`). A member is followed
   only into an object literal.
5. **A keeping call keeps the name.** A library
   call that hands back the function it takes:
   `useCallback(fn)`. The list starts with that
   one name. Add one with its reason.
6. **The listener pass is gone.** Each app used it
   once, for a function it also called by name. A
   listener is written inline.
7. **`cn` is an entry.** No name passes by itself.
   The app lists `cn` with its reason.

## What the check does not see

A syntax check cannot be complete. It makes the
easy path the right path, and review does the rest.

- **Through the graph.** An operation or a resource
  returns functions, and the user names it in
  `depends`. Syntax cannot tell a bag of helpers
  from a real handle.
- **A library hands the function back.**
  `memoize(fn)`, `identity({ add })`. Syntax cannot
  tell `box.add()` from `server.fetch()` on
  `Bun.serve({ fetch })`.
- **A trick.** A Proxy, `new Function`, or a read
  of outer state that does nothing.

## Where ours is simpler

- No type checker. The audit took 18 s on Hedl;
  the check takes 2.5 s. TypeScript 7 has no
  program API to build on.
- One guard for every pass. A new pass adds no way
  around the rule, because a passing function still
  cannot be called by name.

## Proof

`packages/analyze/tests/called.test.ts`: a kept
function, an owned member, a handed function, a
component called as a function, the calls syntax
cannot follow, an entry, and one finding per
helper.

On the 3 apps: 0 findings that the audit does not
also show.

## Not decided

- **Flow files** (ADR 0148, proposed). With this
  guard, a flow function may be called by name
  only from a flow function.
