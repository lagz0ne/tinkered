# 0109 A preset replaces the whole node

Date: 2026-10-09. Status: accepted.
Refines 0015: a preset still replaces a node's realization, for tests only.
Changes one rule in Core's README: a resource preset no longer sees resolved deps.

## Context

Today a preset swaps only the factory or the run.
Core still builds every dep the replaced node declares.
So a test of one leaf builds the graph under that leaf too.

The scaffold shows the cost.
Presetting `database` still builds `databaseSettings`, which reads `env`.
So each backend test fills in `DATABASE_URL` and SMTP values it never uses.
Under ADR 0107, the replaced `database` would also load `pg` as a module.

The user's goal: testing a leaf must not rebuild the whole graph.
Otherwise tests need unrelated settings, mocks, and side effects.

The precedent is the test double, as in NestJS `overrideProvider` and Angular `TestBed`.
The override stands in for the provider.
The original provider's own injections are never resolved.

## Decision

- A preset replaces the node with everything below it.
- Core does not build the replaced node's declared deps.
  It does not read their tags, load their lazy modules, or run their factories.
- This holds for a resource preset and an operation preset alike.
- A resource preset's factory gets an empty deps object and the usual `ctx`.
  `defer`, `signal`, `clock`, and the rest work as before.
- An operation preset's run gets an empty deps object and the usual `ctx`.
  The call's input is still parsed: input belongs to the call, not to a dep.
- A data preset is unchanged: a data node has no deps.
- Downstream consumers still see the replacement, as in 0015.

A preset that needs a value supplies it itself:

```ts
preset(database, async (_deps, { defer }) => {
  const client = new PGlite();
  defer(() => client.close());
  return drizzle({ client });
});
```

## Consequences

- A leaf test binds only what the nodes it really builds read.
  The scaffold tests can drop the `env` values that only preset nodes read.
- The Core test "a resource preset receives the resolved deps" flips:
  it now proves the deps are not built.
- Of the 83 preset sites in the repo, that test is the only one that reads deps.
- Scope code still runs the preset check on every build.
  The path with no preset must not get slower.

## Options considered

- **Keep building the deps.** A leaf test keeps paying for the graph under it.
- **Let a preset declare its own deps.** That is more API for a case no test has today.
  A test that needs one can preset a node that depends on it instead.
- **Delay deps behind private operations, in app code.** The scaffold tried this.
  It adds an operation per resource only to dodge Core, and the graph reads worse.
