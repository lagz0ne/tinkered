# Core example

A small capsule with config, a data cell, operations, a resource, a session, and a test clock.
It runs without a network service.
The entry keeps its result before closing the scope.

## Run

Use Node 22.18 or newer and Vite+ (`vp`).
The Tinker packages are not released yet.
From the repository root, build and export a copy:

```bash
vp install
vp run -r build
vp run example:export -- core /tmp/tinker-core
```

The copy includes the Tinker packages it needs.
Run these commands inside that folder:

```bash
cd /tmp/tinker-core
vp install
vp run start
```

The output is `Core example: 265 (eu:21)`.
`vp run dev` runs the same entry.
After the repository install and build, these commands also work in
`examples/core`.

## Check

From the example folder:

```bash
vp run check
vp run test
```

Each test installs the capsule from `index.ts` and reaches its units through the install.

## Read the code

- `basic.ts` declares the units once, inside one capsule, `basic`.
- `index.ts` exports `basic` only. Its units leave only as its exports.
- The cmd keeps the install in a const, `app = basic({ region: "eu" })`, and reaches each unit through it: `app.setCount`, `app.count`.
- `app.count` is a read view: `get` and `watch`, no `set`. `app.setCount` changes it.
- A child session changes its own count without changing the root's count.
- The install's config reaches its operations: `app.where` answers `eu:21`.
- Reading the store again keeps its rows.
- `app.stamp` reads the clock supplied by the root.
- `main.ts` owns a root and a test clock set to zero inside `if (import.meta.main)`.
- The entry reads its result while the scope is open.
- A stop signal closes the root in `finally`; the entry waits for `closed`.
- SIGINT and SIGTERM ask the root to stop.
  Their listeners are removed after cleanup.
- A failed close or cleanup error makes the command fail.
- Imports start nothing.
- `vite.config.ts` and `tsconfig.json` belong to this folder.
