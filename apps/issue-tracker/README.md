# Issue tracker (slice t02: edit, assign, and discuss)

Create an issue, open it, edit its title/description, move it through
Open/In progress/Done, assign Ada/Lin/Sam or nobody, and add comments.
The server saves everything in a real database, two browser tabs see it
through sync, and it survives reload and restart.

Edits carry the revision originally opened. A stale save is rejected with
HTTP 409 and the current saved issue; the local draft is kept so the
person can reload the other change and try again. Comments append without
an edit revision.

## Run it

```bash
vp install
vp run --no-cache --filter '@tinker-issue-tracker...' build
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
