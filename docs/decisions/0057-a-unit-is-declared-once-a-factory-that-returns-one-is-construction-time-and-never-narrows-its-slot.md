# 0057 A unit is declared once; a factory that returns one is construction-time, and never narrows its slot

Date: 2026-09-21. Status: accepted. Refines: 0046 (`expose` rows), 0053 (the tinkerer frame and its
`gate` slot), 0056 (routes are plain data). Retires: `tinkerer`'s `gate()` builder.

## Context

Packages here kept reaching for a factory that takes a callback and returns a unit, so a user could
write a plain function instead of an operation. `tinkerer`'s `gate()` is the clearest:

```ts
export function gate(decide: Decide): Gate {
  return operation({
    label: "gate",
    input: (raw: unknown) => raw as GateRequest,
    run: (_deps, ctx) => decide(ctx.input),
  });
}
```

It saves one line and costs three things. The slot takes an operation; the builder takes a bare
function, so **`depends` is unreachable** — a gate that reads a cell, applies a policy, or asks a
human cannot use it. Our own test proved it: the interesting case in `gate.test.ts` abandons the
builder and writes `operation({ label: "policy", depends: { allowed }, run })` by hand. The label is
pinned to `"gate"`, so every span says `gate` whatever it is. And the cast it claims to hide did not
go away — it moved into the library, and the test wrote its own anyway.

The raw form needs no builder and no cast. The slot annotation carries the input type, checked under
`vp check`:

```ts
const guard: Tinkerer.Gate = operation({
  label: "guard",
  depends: { allowed },
  run: (_deps, ctx) => {
    if (ctx.input.name === "bash") {
      return { allow: false, reason: "no" };
    }
    return { allow: true };
  },
});
```

Behind that is the reason a factory cannot simply be a style choice: **a unit's identity is its cache
key**. Core keys resource builds, cell state, controllers, and presets on the handle itself, so a
factory mints a new one on every call. Measured:

```text
declared, resolved twice   builds: 1
factory ×2, resolved 3x    builds: 2   a !== b
preset(a), read via a      { n: 999 }
preset(a), read via b      { n: 3 }    seam misses
write via c1, read via c2  0           c1 reads 5

2000 resolves, declared    builds 1     1.7ms
2000 resolves, factory     builds 2000  17.7ms
```

**The analogy** is React: a factory called per call is _a component defined inside render_. Same
mint-a-new-identity mistake, same two symptoms — state silently lost, work silently repeated. And the
same cure: declare it once, outside.

The distinction that decides every case is what the factory returns. A **unit** (operation, resource,
data cell, tag) carries identity that core reads. A **row** (`{ op, meta }`, an inbox entry, a route)
is plain data that a driver reads by value; the unit inside it is already declared. `expose(op, meta)`
and `tool(op, meta)` return rows, so calling them anywhere is free — only the `op` they name has
identity, and that was declared elsewhere.

## Decision

1. **A unit is declared once, at module scope.** `operation`, `resource`, `data`, and `tag` calls
   belong where the module is evaluated — never inside a request, a loop, a render, or a per-call
   helper.
2. **A factory that returns a unit is construction-time only.** A frame (`tinkerer({ label })`,
   `httpClient({ label })`, `harness({ label, adapter })`) or a composition root may call it once to
   build its graph. Its name and docs must say so. If a factory could be called in a userland loop,
   it is wrong: the loop mints identities that defeat every cache, preset, and cell.
3. **A factory that returns plain data is free.** Rows and entries carry no identity; build them
   wherever they read best. `expose`, `tool`, `steer`, and `queue` stay.
4. **A builder may never narrow its slot.** If a slot takes a unit, the way to fill it is the unit.
   A package may add a builder only when it wires something the user cannot reach — deps it owns,
   cells it owns, a label it must control. A builder that only closes over a callback narrows the
   slot; delete it. `command(name, op, sugar)` and `persist` pass this test (each wires cells or deps
   the user has no handle on). `askCommand` was deleted (nw/tinkerer-ask, 2026-09-24): it only used
   public frame parts. `gate()` does not pass, and goes.
5. **An operation's input type may be declared by its slot.** `const g: Tinkerer.Gate =
operation({ label, run })` types `ctx.input` with no parse and no cast, because the annotation
   flows into the generic. This is the supported way to write a unit whose input is built by a frame
   rather than parsed at an edge; it is documented in core's README so the next author does not
   reach for a cast or a builder.

```text
factory returns     may be called
-----------------   --------------------------
a unit              once, at construction
  op/resource/      (module scope)
  cell/tag
a row               anywhere, a loop included
  { op, meta },
  an inbox entry
```

## The audit this ADR ran

Every package was searched for a factory that returns a unit — the only shape these rules govern
(`return operation(` / `resource(` / `data(` / `tag(` / `extension(`), plus every exported function
whose parameter is a callback. Five hits, one violation:

```text
harness   turn(shape)          wires thread, status,
                               text, tool deps         keep
process   command(name, op)    wires argv, io, the
                               op subflow, the log      keep
tinkerer  persist({frame})     wires the session hook   keep
sync      subscribe(transport) wires cells, transport   keep
tinkerer  gate(decide)         wires nothing the user
                               cannot reach           DELETE
```

The four kept factories each wire deps or cells the user holds no handle on, and each is called once
where a graph is built. `gate` closed over a callback and nothing else, so it only took things away.

Row builders were checked against the second rule and stay: `expose`, `tool`, `steer`, `queue`, and
`command`'s route all return plain data, so no cache, preset, or cell write depends on them.

## Consequences

- `gate()` is deleted; three call sites and the README move to a declared operation, which also
  unlocks the deps case the builder could not express.
- The rule gives a one-question review test — _can the raw unit do something the builder forbids?_ —
  and a second — _what does it return?_
- Core feedback: nothing documents that a slot annotation types `ctx.input`. Until it is in core's
  README, authors will keep writing a cast or a builder to get there. Recorded as a candidate, with
  `gate` as the first asker.
- No core change. Identity already works this way; this ADR writes down what it costs to ignore it.

## Alternatives rejected

- **Keep `gate()` and add a second overload for the deps case** — two ways to fill one slot, and the
  weaker one is the one in the README.
- **Delete `expose`/`tool`/`steer`/`queue` too, for consistency** — they return plain data, so they
  break no cache and lose no state; churning 44 call sites to remove an object literal is motion.
- **Forbid factories that return units entirely** — frames are exactly that factory, and they are how
  a package ships a pre-wired graph (ADR 0035). The constraint is _when_ they are called, not that
  they exist.
