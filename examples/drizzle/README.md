# Drizzle example

A local database tour using Drizzle and PGlite.
PGlite runs Postgres in memory; no database server is needed.
Each run starts with a new database.
The tour reads the name committed by its session.
It waits for the database to close before returning.

## Run

Use Node 22.18 or newer and Vite+ (`vp`).
The Tinker packages are not released yet.
From the repository root, build and export a copy:

```bash
vp install
vp run -r build
vp run example:export -- drizzle /tmp/tinker-drizzle
```

The copy includes the Tinker packages it needs.
Run these commands inside that folder:

```bash
cd /tmp/tinker-drizzle
vp install
vp run start
```

The output is `ada`.
`vp run dev` runs the same tour.
After the repository install and build, these commands also work in
`examples/drizzle`.

## Check

From the example folder:

```bash
vp run check
vp run test
```

The test runs the real tour through `index.ts` with an in-memory database.

## Read the code

- `basic.ts` declares the table, config tag, resources, and operations once.
- A namespace binds the database URL and selects its database instance.
  The session insert and root read use the same namespace.
- The database resource opens its client when first used.
  It registers cleanup with `ctx.defer` before setting up the table.
  The root closes the client even if setup fails.
- Each session owns a transaction, a group of database changes.
  A successful session commits its changes before the root reads them.
- `createQueryLogger(ctx)` sends SQL logs through the database resource.
- A stop signal closes the root in `finally`; the tour waits for `closed`.
- The entry prints only when run directly.
- `vite.config.ts` and `tsconfig.json` belong to this folder.

The transaction resource uses the declared database directly:

```ts
const transaction = resource({
  label: "tour.tx",
  target: "session",
  depends: { db: database },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
```

Its factory returns the native Drizzle transaction.
`openTransaction` uses the resource's cleanup to commit or roll back.
