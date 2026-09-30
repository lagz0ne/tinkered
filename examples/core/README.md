# Core example

A small tour of tags, data, operations, resources, sessions, and a test clock.
It runs without a network service.
The tour keeps its result before closing the scope.

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

The output is `Core tour: 286`.
`vp run dev` runs the same tour.
After the repository install and build, these commands also work in
`examples/core`.

## Check

From the example folder:

```bash
vp run check
vp run test
```

The test runs the real tour through `index.ts`.

## Read the code

- `basic.ts` declares the graph once and exports `tour()`.
- Each tour call owns a new scope and a test clock set to zero.
- The child session changes its own count without changing the root's count.
- The tour reads its result while the scope is open.
- A stop signal closes the root in `finally`; the tour waits for `closed`.
- A failed close or cleanup error makes the command fail.
- `main.ts` prints only when run as the entry file.
- `vite.config.ts` and `tsconfig.json` belong to this folder.
