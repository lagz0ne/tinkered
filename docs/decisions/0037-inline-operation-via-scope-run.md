# 0037 `scope.run` also runs an inline operation, with its input passed in, not closed over

Date: 2026-09-17. Status: accepted (call shape amended the same day by 0038). Refines: 0036 (verbs), 0010 (operation = command), 0006 (edge).

## Context

Glue code — a script, a test, a request handler, a one-off job — wants to run a body with
dependencies resolved by the scope and one parameter, without first declaring a named unit. Today
that is `operation({ label, depends, run })` plus `scope.run(op, { input })`, or a closure that
captures the parameter — which hides the input from `ctx.input`, `rawInput`, and the span.

## Decision

`scope.run` gains a second input shape (one overload per shape, ADR-free rule 9 of the
convention): an **inline operation** config, with the same call object as a declared run.

```ts
scope.run(op, ...call);                            // declared operation, unchanged (ADR 0036)
scope.run({ label?, depends?, run }, { input?, tags? }?);   // inline operation, same call object

await scope.run(
  { depends: { db, clock }, run: ({ db, clock }, { input, signal }) => db.insert(input, clock.currentTimeMillis(), signal) },
  { input: row }, // -> ctx.input (and rawInput); I is inferred from `input`
);
scope.run({ depends: { count }, run: ({ count }) => count * 2 });                 // no input: I = void
scope.run({ depends: { logger }, run: ({ logger }) => logger.info("x") }, { tags: [logBackend(fileSink)] }); // ADR 0038
```

- **Same path as a declared operation.** A throwaway `Operation.Handle` is built and run through
  the operation controller path: deps delivered in their natural form (ADR 0020; session bindings
  and presets on the deps apply), one span named `label ?? "inline"` nested like any operation,
  the full `Operation.Ctx` (`signal`, `defer`, `obs`, `log`, `clock`), owned-work tracking so a
  forced close cancels it and a graceful close waits for it (ADR 0028).
- **No identity, so no controller cache and no residue:** nothing is stored in the layer for the
  inline handle. Cost is one handle + controller allocation per call — fine for glue, not for a
  hot loop; a declared operation is the hot-loop form. A probe scenario `inline` measures it
  beside `op`.
- **The call is the same invocation object as a declared run**: `{ input?, tags? }` (ADR 0038
  amended the first cut, which passed the input bare). `input` is typed from the call and
  delivered as `ctx.input` and `ctx.rawInput` unchanged. No `parse` and no `rawInput`: the value
  is already inside the process (ADR 0006); a body that needs a parse wants a declared operation.
  `tags` open a child session for the run (ADR 0038), exactly as for a declared operation.
- **Not presettable** — it has no identity. Test the effects through the deps it names (ADR 0015).
- Runtime discrimination is the existing brand: an `Operation.Handle` is declared; any other
  object is inline.

```ts
// Scope.Handle
run<T, I>(op: Operation.Handle<T, I>, ...call: CallArgs<I>): T;
run<const D extends Depends = Record<string, never>, R = unknown, I = void>(
  inline: Inline<D, R, I>,
  ...call: InlineCall<I>,
): R;
// Scope.Inline<D, R, I>   = { label?: string; depends?: D; run: (deps: SlotValues<D>, ctx: Operation.Ctx<I>) => R }
// Scope.InlineCall<I>     = [I] extends [void] ? [call?: { tags?: Bindings }] : [call: { input: I; tags?: Bindings }]
//                           (no `rawInput` — there is no parse)
```

## Consequences

- One verb, two shapes; the glossary's `run` row gains the inline form.
- Glue code stops capturing parameters in closures: the input is on the ctx and visible to
  observation.
- A contributor brief for this change carries the SCIP refs table for `Scope.Handle#run` (rule 1
  of the SCIP workflow) since the overload set of a public symbol changes.

## Alternatives rejected

- **A separate verb (`exec`, `runInline`)** — same meaning as `run`; a second name for one act.
- **Closure-captured params** — the input is invisible to ctx, spans, and preset-based tests.
- **`parse` / `rawInput` on inline** — not needed by glue; each is one step toward a declared
  operation, which already exists. (`tags` IS supported — ADR 0038 — because it is ambient, not
  a parse concern.)
- **Bare positional input** (`scope.run(inline, row)`, the first cut) — once `tags` is needed the
  no-input-with-tags case reads `(inline, undefined, tags)`; the object form is one convention.
- **Caching the inline handle** — there is nothing to key it by; caching would leak per call.
