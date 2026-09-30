# Hono example

A request tour built with `@tinker/hono`.
It needs Node 22.18 or newer and Vite+ (`vp`).
Requests stay in memory; no server port or network is used.
The database names are demo values, with no database to set up.

From this repo, install and build first:

```bash
vp install
vp run -r build
cd examples/hono
vp run start
```

It prints:

```text
200 200 200 alpha-db beta-db public-db ab
```

The three status codes come from two greetings and health.
The next three names are the selected databases.
The final `ab` is the complete streamed body.
`dev` runs the same tour as `start`.

To copy this package out, run from the repo root:

```bash
vp run example:export -- hono /tmp/tinker-hono
cd /tmp/tinker-hono
vp install
vp check
vp test
vp run start
```

The export includes the unreleased library packages.
Its install uses those copies.

## What it shows

- `/greet/ada` with `x-tenant: beta` says `hello ada from beta`.
- With no tenant header, it says `hello ada from public`.
  Request tags replace the root's tenant setting.
- `/health` answers with status 200.
- `/database` selects `alpha-db` or `beta-db` by tenant.
  An unknown tenant uses the root's database setting.
  The tour binds that setting to `public-db`.
- `/ticks` streams `a`, then `b`.
- `tour()` reads the full stream before stopping its root.
  Cleanup also runs when a request or body read fails.

`web`, `tenant`, and `database` are public pieces for test roots.
The route graph is declared once, then reused by each root.
`main.ts` starts only when run directly.

Run the package checks here:

```bash
vp check
vp test
```
