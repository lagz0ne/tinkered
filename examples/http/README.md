# HTTP example

A local HTTP tour with a recording backend.
It sends no requests to GitHub or any other network service.
The URLs and tokens are sample values.

- The tour reports the parsed reply and first request URL.
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

`vp run dev` runs the same tour.
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

- `basic.ts` declares the operations once and exports `tour()`.
- `listRepos` reads and checks the response body inside the operation.
- `onboard` gives `createIssue` a token through call tags.
- Each tour call owns its scope and request list.
- A stop signal closes the root in `finally`; the tour waits for `closed`.
- The entry prints only when run directly.
- `vite.config.ts` and `tsconfig.json` belong to this folder.
