# 0107 A body gets outside libraries only from its deps

Date: 2026-10-08. Status: proposed.
Refines 0044 and the lazy module of 0042.
Replaces the start-scaffold rule "load a library inside the unit that uses it".

## Context

Start-scaffold operations load libraries inside `run` with `import()`.
Ten operations repeat the same Drizzle import.
The graph hides those loads: the trace times them inside each operation.
The user wants each load to be its own node.
That makes the graph honest, gives each load its own span, and leaves room to inline later.

The precedent is Effect.
`Schema` and `Context.Tag` are module values, built with normal imports.
A program never imports a service; it reads the service from context.
Bazel's strict deps is the same idea: a target declares every dep it uses directly.

Every module load happens at one of two places: at import, or as a graph node.
The cut is by where code runs, not by where it comes from.
A first draft cut by origin, and Drizzle table builders needed an exception.
Cutting by where code runs needs none.

## Decision

### Words

- **Top level:** module code outside any function. It runs once, at import.
- **Unit body:** an operation's `run`, a resource's `factory`, an extension hook,
  and every function created inside them.
- **Graph code:** a unit body, plus every own function it calls, followed through each call.
  A helper that a body calls is graph code; a React component is not.
- **Own module:** a relative path, a `#` import, or a `@tinker/*` package.
- **Outside module:** every other path, including `node:*` and the host framework.

### Allowed at top level

1. `import type` from any module.
2. A static import of an own module.
3. A static import of an outside module, when that file uses its names only at top level.
   Examples: `pgTable` in a schema file, `z` in `mail.ts`, `createServerFn`.

### Allowed in graph code

4. Values from declared deps.
5. Names from own modules.
6. Values built at top level, and their methods.
   Examples: a table, `databaseEnv.safeParse(env)`.

### Not allowed in graph code

7. A name imported from an outside module.
8. `import()`, `require`, or `createRequire`.
   `import()` appears only as the whole factory of a lazy module.

When a file uses an outside name at top level and in graph code, the graph code use breaks rule 7.
That code takes the module from a lazy module instead.

### Lazy module

9. One lazy module per import path, across the whole workspace.
10. It has exactly this shape: no deps, no other code, a literal path.
    Its value is the module namespace.

    ```ts
    export const drizzleOrm = resource({
      label: "module:drizzle-orm",
      target: "scope",
      factory: () => import("drizzle-orm"),
    });
    ```

11. It lives in the lowest package that uses it.
    `@tinker/start/server` exports `drizzleOrm`; the app depends on that one node.
12. Modules that exclude each other belong to separate resources.
    A binding picks one, as in 0095 (`pg` or PGlite).

An operation then reads:

```ts
depends: { database, orm: drizzleOrm },
run: async ({ database, orm }, { input }) => {
  const { eq, sql } = orm;
  // ...
},
```

### Where it holds

The rules hold in the `src` of every app and package.
Tests, test presets, `maintain` scripts, and config files are outside it.
So is code the framework calls rather than the graph:
a React component, a server function handler, a `createIsomorphicFn` branch.

Plain code checks rules 7, 8, and 9.

## Consequences

- Every outside load in a body shows as one span, named `module:<path>`.
- A module the host has already loaded still gets a node; its span is near zero.
  Example: `responseBodies` takes `@tanstack/react-start/server` from a lazy module.
- Deps build before the body (0044).
  An operation that uses `eq` on one branch loads `drizzle-orm` on both.
- Importing the backend still loads no driver, auth library, or mail client.
  `maintain/check-imports.mjs` keeps proving that.
- Table declarations load `drizzle-orm/pg-core` at import.
  That is top-level work, so rule 3 allows it.

## Options considered

- **Load inside the unit that uses it.** This was the old rule.
  It hides loads inside other spans and repeats imports in every operation.
- **Group modules into store resources with named queries.** This hides which module a body uses.
  It also costs a design per group.
- **Cut by origin: outside modules always go through the graph.** Table builders,
  `z`, and `createServerFn` would need exceptions.
- **Each package declares its own `drizzleOrm`.** That makes two nodes for one module,
  and the trace splits its cost.
