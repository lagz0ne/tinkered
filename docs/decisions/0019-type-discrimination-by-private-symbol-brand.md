# 0019 Type discrimination by module-private symbol brand

Date: 2026-09-14. Status: accepted.

## Context

The engine must tell its unit kinds apart at runtime — data cell, command, tag,
edge, and future kinds — to resolve dependencies. Structural sniffing (`typeof`,
shape checks) is brittle and lets userland accidentally or deliberately pass an
object that looks like a kind it is not.

## Decision

- Each unit kind carries a **module-private `unique symbol` brand**, set by its
  factory (`data` → `cell`, `operation` → `command`, `tag` → `tagSym`, edges →
  `edge`). The brand symbols are **never exported**.
- Because the brand symbol is never exported, its key is unnameable outside the
  module: userland cannot write a branded literal or a competing guard, and
  accidental key collisions are impossible. This is a **provenance signal, not a
  security boundary** — a determined caller could still copy a brand via object
  spread or read it via `Object.getOwnPropertySymbols`. Within our own code that
  provenance is enough, so a guard asserts **only the brand's presence**.
- Guards are uniform one-liners using optional-chained property access (safe on
  any value, including primitives — never `in`, which throws):

  ```ts
  const isData = (n: unknown): n is Data.Cell<unknown> =>
    (n as { [cell]?: true } | null | undefined)?.[cell] === true;
  ```

- This is the **sole** discrimination mechanism for all current and future engine
  objects. Do not add structural guards. Foreign shapes that are not our kinds
  (e.g. a thenable) are detected by their own predicate, never confused with a brand.

## Consequences

- Guards are minimal and uniform; the brand is a provenance signal, not a
  tamper-proof seal.
- The public type surface exposes only a phantom key (`readonly [cell]: true`)
  whose symbol is private, so a `Data.Cell` literal cannot be written by hand.
- New unit kinds follow the same pattern: one private brand + one property-access
  guard.
