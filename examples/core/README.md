# Core example

A small example of tags, data, operations, resources, sessions, and a test clock.
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

The output is `Core example: 286`.
`vp run dev` runs the same entry.
After the repository install and build, these commands also work in
`examples/core`.

## Check

From the example folder:

```bash
vp run check
vp run test
```

Tests build small roots from the units in `index.ts`.

## Read the code

- `basic.ts` declares the graph once.
- `index.ts` exports `region`, `count`, `doubled`, `store`, and `stamp`.
- A child session changes its own count without changing the root's count.
- An inline call reads tags, data, and its input.
- Reading the store again keeps its rows.
- `stamp` reads the clock supplied by the root.
- `main.ts` owns a root and a test clock set to zero inside `if (import.meta.main)`.
- The entry reads its result while the scope is open.
- A stop signal closes the root in `finally`; the entry waits for `closed`.
- SIGINT and SIGTERM ask the root to stop.
  Their listeners are removed after cleanup.
- A failed close or cleanup error makes the command fail.
- Imports start nothing.
- `vite.config.ts` and `tsconfig.json` belong to this folder.
