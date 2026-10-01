# 0095 Drizzle publishes static units for each database

Date: 2026-10-01. Status: accepted.
Extends 0094; keeps its native resource and session outcome rules.

## Context

Removing the store builder left Drizzle with only helper functions.
Every app still had to declare the same database graph.
The user asked for reusable public resources and actions.
PGlite is the first case, used by the tracker and standalone example.

The precedent is [Effect SQL](https://effect.website/docs/v4/api/effect/sql/SqlClient).
It shares an SQL API while each database integration owns its connection rules.
Its SQLite integration holds a connection lock until the transaction ends.
Our graph stays native and uses Core to own instances.

## Decision

Publish `config`, `database`, and `transaction` at `@tinker/drizzle/pglite`.
Publish `migrationConfig` and the `migrate` operation there too.
Declare these units once, at module scope.
Namespace bindings choose settings and separate instances.
The SDK loads only inside the database factory.

The config is an object with `kind: "open"` or `kind: "borrow"`.
The scope closes a client it opened.
The outside owner closes a borrowed client.
App transactions belong to sessions and keep native Drizzle handles.

The migration action owns one locked database transaction.
It runs the app's baseline callback and pending migration files.
It returns after commit or rollback finishes.
The app's extension runs that action before continuing startup.
App tables and actions stay in the app.

```ts
import { namespace } from "@tinker/core";
import { config } from "@tinker/drizzle/pglite";

const issues = namespace({
  tags: [
    config({
      kind: "open",
      url: "./data/issues",
    }),
  ],
});
```

Keep the helper entry for custom schemas and compatible callback transactions.
A namespace changes settings, not the resource's static TypeScript type.
PGlite's native transaction awaits its callback.
Synchronous SQLite callbacks require a separate transaction path.
The PGlite module does not promise interchangeable database engines.
