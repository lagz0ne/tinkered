# 0022 A subflow is invoked with an invocation object, never a bare value

Date: 2026-09-14. Status: accepted. Refines: 0020 (a dependency is delivered in its natural form).

## Context

ADR 0020 delivers a bare operation dependency as a **subflow**: a callable controller
`{ resolve(input) }`. The call took a single positional `input`. Two problems surfaced:

- **Void input read as a value.** A caller (and readers of the type) could treat an
  input-less operation's delivery as "just its value". The subflow must _always_ be a
  function — never collapse to a value — even when the operation takes no input.
- **A subflow needs more than typed input.** Invoking an operation in the caller's context
  should let the caller supply the **raw** input (to be parsed), or a **pre-typed** input
  (parse already done), and layer **ambient tags** onto the operation's context for this one
  call. A single positional `input` carries none of that.

## Decision

A subflow — and every command controller, including `getController(command)` — is invoked
with a single **invocation object**. It is always a function; there is no value form.

```ts
type Invocation<I> = {
  readonly input?: I; // pre-typed; parse is skipped
  readonly rawInput?: unknown; // raw; run through the operation's input parse
  readonly tags?: Tag.Bindings; // ambient bindings for this call (amended 2026-09-21, see 0023: a binding, nothing, or a nested list)
};
resolve(call): T;
```

- **Always callable.** A void-input operation is delivered as `{ resolve }` and called
  `resolve()` (or `resolve({ tags })`). It is never auto-run and never a bare value.
- **`input` vs `rawInput` (mutually exclusive; a defined `input` wins).** A **defined** `input`
  is used directly and `ctx.rawInput` mirrors it. An `input` of `undefined` counts as absent (a
  JS caller cannot smuggle `undefined` past the parse this way), so `rawInput` is parsed by the
  operation's `input` parse into `ctx.input` with `ctx.rawInput` the value supplied. If neither
  is present the input is `undefined` — fine for a void operation, a parse failure for one that
  requires input. The type forbids passing two _defined_ inputs at once; the runtime also
  ignores an `undefined` `input` because `exactOptionalPropertyTypes` is off (an optional
  `never` field still admits `undefined`).
- **Typed requirement.** For an input-carrying operation (`I` is not `void`) the caller must
  supply `input` or `rawInput`; a void-input operation may be called with no argument. Encoded
  as `resolve(...call: [I] extends [void] ? [Invocation<I>?] : [ProvideInput<I>])`, where
  `ProvideInput<I>` requires one of the two input fields.
- **`tags` is a read-only overlay.** Per-call `tags` are layered nearest-first _above_ the
  caller's scope bindings and are visible to the invoked operation's **own tag dependencies**.
  They do **not** change resource or cell ownership, and are **not** propagated into resources
  the operation builds or into nested subflows it invokes. Rationale: the invocation is a tag
  frame, not an owning layer — lifetime and copy-on-write stay on the real layer, so a per-call
  tag can never orphan a session resource or swallow a cell write. Broader propagation, if ever
  needed, is a separate decision.
- **Observation unchanged.** The call still opens one nested operation span under the caller.
- **`operation.controller` unchanged.** Still redundant with the bare form, still kept; removal
  stays the deferred 0020 follow-up.

## Consequences

- `CommandController<T, I>.resolve` takes the invocation object; every call site moves from
  `resolve(x)` to `resolve({ rawInput: x })` (or `{ input: x }`), and `resolve()` stays for
  void operations. A wide but mechanical test migration.
- Runtime: `commandController` reads `input`/`rawInput` off the call, builds a small tag
  overlay from `tags`, and threads it through tag reads (`tagFind`/`tagAll`/`tagRequired`) for
  the operation's direct dependencies only; resources, cells, and nested subflows resolve on
  the real layer as before.
- The glossary `subflow` row is updated to the invocation-object shape.
