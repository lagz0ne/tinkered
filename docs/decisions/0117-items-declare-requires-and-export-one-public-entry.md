# 0117 Items declare requires and export one public entry

Date: 2026-10-13. Status: proposed.
Replaces the numbered ordering part of 0116.
Builds on: 0112, 0113, 0116.

## Context and precedent

A folder number makes the app owner guess an item's order.
An item should name what it needs instead.
Core only needs order for shared tag bindings, `tag.all`,
and extensions that resolve another extension.

Tags are values; resources are built on first use.

[Java modules, JEP 261](https://openjdk.org/jeps/261),
use `requires` for dependencies, `exports` for public packages,
and `provides` for service implementations.
Their dependency graph forbids cycles.
They also refuse two readable modules exporting the same package.
We borrow that rule for unrelated items binding the same tag.
[NestJS modules](https://docs.nestjs.com/modules)
also name imports and export only their public providers.
[Node package exports](https://nodejs.org/api/packages.html#package-entry-points)
limit callers to a package's public entries.
Our entries are fixed file names, without an export map.

[Python graphlib](https://docs.python.org/3/library/graphlib.html)
exposes ready nodes and reports a closed cycle with `CycleError`.
We use Kahn's algorithm: take a ready item, then unlock its readers.
Sorting the ready names after each item gives stable ties.
Unlike graphlib, a missing required item is an error here.

## Decision

- Items live in `src/items/<item>/`.
  Names match `[a-z][a-z0-9-]*`.
  Reject old numbered role folders.
  The error says to rename and declare `requires`.
- `item.json` declares direct dependencies:

  ```json
  { "requires": ["errors", "postgres"] }
  ```

  Missing `item.json` means `requires: []`.
  An empty object also means no dependencies.
  Repeated names mean one edge.
  Unknown keys and invalid names or JSON fail prepare.

- Prepare reads JSON and file names only.
  It never parses or imports item TypeScript.
  A seam star export cannot cross into item source, even
  through another local module.
  Use explicit named exports from item indexes there.
  The existing unreadable-star message names the seam path.
  Role files still provide the roles named in 0116.
  An item with only `index.ts`, `index.server.ts`, or a
  manifest can satisfy a dependency without providing a role.
  Helper-only folders still have no effect.
- Dependencies come first, then ready items by name.
  That puts dependency extensions on the outside.
  It puts dependency bindings before their readers' bindings.
  The user's seam stays last.
  Missing items, self-requires, and cycles fail with paths.
  A missing-item message says to `shadcn add` it.
  A cycle repeats its first manifest at the end.
- `index.ts` and `index.server.ts` are the public API.
  Use `@/items/mail`, `@/items/mail/index`, or
  `@/items/mail/index.server` from outside the item.
  Other item files are private.
  Doctor check 6 reports private `@/items` paths at file:line.
  Tests may import private files, as with package barrels.
  Imports within one item stay free.
- An item importing another item's API must name that item
  in its own direct `requires` list.
  An indirect dependency permits ordered bindings;
  it does not grant direct imports.
  Doctor reports undeclared imports as errors.
  Helper-only folders must declare imports too.
  Normalize item alias paths before checking their target.
  The build already stops on check 6 errors.
- Adding, removing, or editing `item.json` restarts dev.
  Role-file add and remove still restart it.
- No items keeps the original generated seam bytes.
  Single-role ownership rules from 0116 stay the same.

## Shared tags: check values at settings time

Prepare cannot see tags without parsing or running item code.
Doctor cannot prove what a settings reader returns:
a helper, alias, conditional return, or nested list can bind a tag.
Matching source names would miss real clashes and flag distinct tags.

Generated server settings calls each item reader once.
When at least two items supply settings, `joinSettings` checks
nested bindings by tag object identity before returning them.
It keeps binding objects and their list order.
No resources are opened and the user's reader stays last.
Unrelated owners of one tag fail with both settings paths.
A reader may replace a dependency's binding, even through
an indirect dependency with no settings of its own.
Repeated bindings inside one item still follow Core's rules.
The check compares every prior owner, so a shared dependent
cannot hide a clash between its unrelated dependencies.

This is a settings-time error, not a doctor source check.
It costs one walk over the returned bindings at scope setup.
It adds no work to later tag reads.
The user seam may override any item on purpose.

## Left out on purpose

No `requires transitive`, qualified exports, or `opens`.
No configurable export map or new role list.
Sync slices and navigation stay on later registry cards.
