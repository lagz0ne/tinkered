# Issue tracker (slice t03: CLI and MCP tools)

Create an issue, open it, edit its title/description, move it through
Open/In progress/Done, assign Ada/Lin/Sam or nobody, and add comments.
The server saves everything in a real database, two browser tabs see it
through sync, and it survives reload and restart. The same actions also
work from the command line and from MCP tools; both reach the running
server over HTTP, which stays the single owner of the saved state.

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

## Use it from the command line

Every command reaches the running server over HTTP; `BASE_URL` picks the
address (default `http://127.0.0.1:4311`). Help needs no backend.

```bash
BASE_URL=http://127.0.0.1:4311 vp run @tinker-issue-tracker#tools help
BASE_URL=http://127.0.0.1:4311 vp run @tinker-issue-tracker#tools list
BASE_URL=http://127.0.0.1:4311 vp run @tinker-issue-tracker#tools create --title "Title" --description "Why"
BASE_URL=http://127.0.0.1:4311 vp run @tinker-issue-tracker#tools update ID --base-revision 0 --status done
BASE_URL=http://127.0.0.1:4311 vp run @tinker-issue-tracker#tools comment ID --author Ada --text "Shipped"
BASE_URL=http://127.0.0.1:4311 vp run @tinker-issue-tracker#tools get ID
```

Edits carry the revision originally opened. A stale save exits nonzero
with the current revision; fetch the saved detail with `get ID` and try
again. Comments append without a revision.

## Use it from MCP

The same five actions are MCP tools (`list`, `create`, `update`,
`comment`, `get`) served over stdio:

```bash
BASE_URL=http://127.0.0.1:4311 vp run @tinker-issue-tracker#mcp
```

Point a harness at that command directly (stdio carries the protocol,
so run node itself rather than through the task runner):

```json
{
  "mcpServers": {
    "issues": {
      "command": "node",
      "args": ["/abs/path/apps/issue-tracker/src/tools/main.ts", "mcp"],
      "env": { "BASE_URL": "http://127.0.0.1:4311" }
    }
  }
}
```

No account is needed; the default path reaches the local server above.

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
