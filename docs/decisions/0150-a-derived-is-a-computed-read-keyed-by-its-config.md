# 0150 A derived is a computed read, keyed by its config

Date: 2026-11-13. Status: accepted (Duke picked
each part, 04:10 to 07:40 UTC); not built.
Changes: the glossary row "derivation".

## What the user said

Duke, 04:10: "useMemo to create a stable reference
of a slice. Which I think should be supported as a
first class citizen onto react."

Duke, 05:06: "what might be able to make it stable
even without react ... a curried function to create
the slice".

Duke, 05:27: "we can consider those as a composite
key (a family we did before)".

Duke, 06:32: "similar style to the config we done
like capsule? So that'll be a parameterized one".

Duke, 07:32: "we'll stay small firstly then expand
as needed".

Duke, 07:40: "A is fine. the config can also be
empty, right?"

## Context

acountee and Hedl make 13 slices with `useMemo`.
Each has one reader.

- acountee screens (3): `scope.run(op)` over two
  `useData` reads and props.
- acountee lists (4): a reshape fed to TanStack
  Virtual, which needs the same reference.
- Hedl board (5): plain logic inside the arrow.
  `tinker/plain` does not see it.

`useData(cell, selector)` covers one cell. Nothing
covers two sources, a prop, or an op.

Core has one stable read with no memo:
`cell.where(part)`. The read object is new each
render. Core keys the reader by the key text and
keeps one result per cell value.

## Precedent

- **Jotai `atomFamily`, Recoil `selectorFamily`.**
  A derived unit with a param. One copy per param.
- **TanStack Query `queryKey`.** Same key, same
  entry. The key is written as text with sorted
  fields.
- **Capsule config (ADR 0120, 0121).** A unit
  declares typed keys. The call with values is the
  binding.
- **TanStack `virtual-core` and its adapters.** A
  library with state sits behind a thin adapter.

## Decision

1. **A derived is a unit.** It is declared once at
   module level, like data or an operation. The
   maker is `derived({ ... })` (Svelte `derived`,
   Jotai's derived atom).
2. **It declares `config`, as a capsule does.**
   Each key is a tag, `.required` or with a
   default. Core types the call from them.
3. **The call is the read.** With no config, or
   only keys with a default, the bare unit reads
   too, as a capsule with no config installs
   uncalled: `useData(total)` is
   `useData(total())`. Its key is its defaults,
   `{}` with no config: one entry for the scope.

   With config:

   ```ts
   const view = useData(
     prView({ viewer: me.email, mode }));
   ```

   Outside React, the same read:

   ```ts
   scope.resolve(prView({ viewer, mode }));
   ```

4. **The config is the key.** It follows the
   keyed-data key (ADR 0135): a flat object of
   strings and finite numbers. Core writes it as
   text with sorted fields.
5. **One entry per key text.** Every reader of the
   same key shares it. The last reader leaves, the
   entry goes (as a keyed part, ADR 0136).
6. **Sources are declared in `depends`.** The
   analyzer reads them from code (ADR 0129).
   `depends` may take the config, so a part can
   follow a config value:

   ```ts
   depends: (c) => ({
     rows: approvals.board.prs
       .where({ viewer: c.viewer }),
     f: filters,
   }),
   ```

7. **A source change computes the entry again.**
   A cell, a read, and a capsule export are
   watched. A resource value is fixed until it
   builds again.
8. **A config key may hold a slot.** A slot holds
   a unit the derived reads: a cell, a read, a
   capsule export, or a resource. Core keys a unit
   by a number it gives once. A unit is declared
   once (ADR 0057), so the number is stable.
9. **No operation in a slot.** A derived computes.
   It does not act. The work it does is an op it
   names in `depends`.
10. **A slot is read, not owned.** It is delivered
    as a `depends` slot (ADR 0044). A pending build
    waits, and `useData` suspends (ADR 0032). A
    failed build makes the entry a fault. When the
    entry goes, nothing in the slot is released.
11. **A library with state joins by its adapter.**
    A resource builds the library object and writes
    its changes to a cell. `ctx.defer` ends it. The
    derived reads the cell.

## Where ours is simpler

- No `get` with run-time tracking, as Jotai has.
  The sources are known from code.
- No new key rule. The keyed-data key is reused.
- No new hook. `useData` reads a derived as it
  reads a keyed part.

## Not decided

- **Op slots.** Left out for now. Add one when a
  real case needs it.
- **Size.** Core is at its size cap. The build
  measures the cost.

## Proof owed

- A test: two readers, one key, one compute.
- A test: a new key leaves the old entry.
- The 13 sites move off `useMemo`.
