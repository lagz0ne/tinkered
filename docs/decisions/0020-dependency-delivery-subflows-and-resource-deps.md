# 0020 A dependency is delivered in its natural form: subflow, instance, value

Date: 2026-09-14. Status: accepted. Refines: 0010 (operation = command), 0013/0018 (resources, owner-context).

## Context

Today a dependency delivers: `data` (bare) → its value, `data.controller` → a read/write
handle; a tag → `.required/.optional/.all` → value(s); a **command** used bare was
_rejected_ (`InvalidDependency`), forcing `command.controller` + `.resolve(input)`; and a
**resource** was not depend-able at all. The bare-command rejection treated "depend on an
operation" as a mistake, but depending on an operation is a **subflow** — a legitimate,
common composition — and depending on a resource (a db pool providing a transaction) is
the normal DI shape.

## Decision

A dependency is delivered in the **natural form of the thing depended on**:

- **`data`** — bare → value; `.controller` → read/write handle. (unchanged)
- **tag** — `.required/.optional/.all`. (unchanged)
- **operation** — bare → a **subflow**: an _executable_ the caller invokes. Invoking it
  parses `input`/`rawInput`, resolves the operation's own deps and ambient **tags** in the
  caller's context, runs it, and (when observation is on) is **tracked as a nested subflow
  span**. It is NOT auto-run and NOT a value. The bare-command rejection is removed.
  - Type: an input-less operation may also be depended on and run with no input; an
    input-requiring operation delivered as a subflow still requires its input at call time.
    The delivered shape is the callable controller (`{ resolve(input) }`), same as
    `command.controller`. `operation.controller` is therefore redundant; it is **kept for now**
    (additive change) and removing it is a deferred follow-up cleanup once the subflow shape is
    confirmed.
- **resource** — bare → its **built instance** (built once at its owner; async → a promise,
  per ADR 0009's `ResourceValue`). This makes resource-to-resource composition first-class
  (a `scope` db-pool resource provides a `session` transaction resource); deps resolve at
  the depending node's owner and bubble (ADR 0018). `resource.controller` stays for the
  imperative `resolve()`/`get()` handle.

## Consequences

- Subflows compose operations without ceremony; the type system guides input-carrying calls;
  observation nests subflow spans under their caller (detailed in the observation tickets).
- Resources depend on resources (pool → tx), the expected DI shape.
- Code change: `SlotValue` maps a bare `Operation.Command<R, I>` → a subflow executable and a
  bare `Resource.Handle<T>` → `ResourceValue<T>`; `resolveDep` resolves them instead of
  raising; `operation.controller` is dropped. A dedicated ticket carries this (a wide but
  mechanical `SlotValue`/`resolveDep` change) ahead of the observation work.
- The old "a bare command is rejected" test is replaced by "a bare operation is a subflow"
  and "a bare resource delivers its instance".
