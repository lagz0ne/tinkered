# Issue tracker (slice t01: create and see it live)

Create an issue with a title and description. The server saves it in a real
database, two browser tabs see it through sync, and it survives reload and
restart. Open is the only status in this slice.

## Run it

```bash
vp install
vp run --filter '@tinker-issue-tracker...' build
HOST=127.0.0.1 PORT=4311 DATA_PATH=./data/issues vp run @tinker-issue-tracker#start
```

The build command builds the public workspace libraries before the app.

Then open `http://127.0.0.1:4311/` in two tabs. `HOST` and `PORT` set the
address; `DATA_PATH` is the persistent PGlite folder (gitignored).

## Check it

```bash
vp run @tinker-issue-tracker#test
vp run @tinker-issue-tracker#test:browser
```

`test` runs the behavior tests (real PGlite, real routes, memory-pair sync).
`test:browser` runs the two-tab Playwright proof against a server on
`127.0.0.1:4311` — start the server first with the commands above.

## How it fits together

React screen → HTTP command → short transaction → saved issue.
React screen ← sync snapshot ← committed root state.

Saves run in their own short child session and publish to the shared root
cell only after the database commit resolves. PGlite is single-connection,
so short write transactions queue instead of overlapping.
