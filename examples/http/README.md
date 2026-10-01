# HTTP example

A local HTTP example with a recording backend.
It sends no requests to GitHub or any other network service.
The URLs and tokens are sample values.

- The entry reports the parsed reply and first request URL.
- Onboarding uses the fresh token only for its issue request.
  Other calls keep the root's headers and base URL.
- Listing repos rejects a reply that is not a JSON string.

## Run

Use Node 22.18 or newer and Vite+ (`vp`).
The Tinker packages are not released yet.
From the repository root, build and export a copy:

```bash
vp install
vp run -r build
vp run example:export -- http /tmp/tinker-http
```

The copy includes the Tinker packages it needs.
Run these commands inside that folder:

```bash
cd /tmp/tinker-http
vp install
vp run start
```

Expected output:

```text
ok 200 https://api.github.com/users/octocat/repos
```

`vp run dev` runs the same entry.
After the repository install and build, these commands also work in
`examples/http`.

## Check

From the example folder:

```bash
vp run check
vp run test
```

The tests import `index.ts` and bind real recording backends through `backend`.
They need no browser or network service.

## Read the code

- `basic.ts` declares the operations once.
- `index.ts` exports those operations for each test's own root.
- `listRepos` reads and checks the response body inside the operation.
- `onboard` gives `createIssue` a token through call tags.
- The entry owns its root and request list inside `if (import.meta.main)`.
- A stop signal closes the root in `finally`; the entry waits for `closed`.
- Ctrl+C or SIGTERM asks the root to close.
- The entry removes its signal listeners after cleanup ends.
- After successful requests, a close or cleanup error makes the command fail.
- Importing the entry starts no root or requests.
- `vite.config.ts` and `tsconfig.json` belong to this folder.
