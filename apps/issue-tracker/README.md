# Issue tracker

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

Creating an issue posts once and clears the create form after success.
Posting a comment clears its draft text after success.
A rejected comment saves no row and records no activity.

If the live connection drops — a wire failure or a server restart — the
page keeps every typed draft, and the browser reconnects by itself.
Reconnecting keeps the same page, so the local title, comment, and edit
revision survive. A server restart keeps the database on disk; the fresh
connection accepts the newer saved state even when the server's revision
is lower than the last one the old connection saw.

The live connection is one server-sent stream, `GET /sync?keys=issues`:

- **the keys ride in the URL** — the server reads them and registers the
  tab when the stream connects, then sends one snapshot per key.
  - No key, or a key the server does not publish: 400, no stream.
  - The first frame is `retry: 1000`: the browser waits 1 second before
    each reconnect.
- **the browser reconnects** — each reconnect is a fresh GET with the
  keys, so the server registers the tab again and sends a fresh snapshot.
- **server down at boot** — the page shows "Connecting…" and comes alive
  when the server returns.
- **the dead page** — "Could not connect" with its own Reconnect button.
  - It shows only when the stream fails for good before the first
    snapshot: the server answered an HTTP error, or the first frame was
    malformed.
  - A stream that cannot be opened at all fails the boot the same way.
- **a stream that fails for good after the boot** — an HTTP error on a
  reconnect, or a malformed frame. The list and drafts stay, and sync
  stays attached. The tab waits for Reconnect.
- **Reconnect** — the button opens a fresh stream now.
- **what the tab shows** — one state at a time:
  - live: no notice.
  - reconnecting: "Live updates stopped", "Reconnecting…", and Reconnect
    greyed out.
  - failed: "Live updates stopped" and a Reconnect button.
- **closing the page's scope** — it closes the stream and tells sync once.

Offline saves show a plain notice ("Could not reach the server. Your work
is kept — try again.") instead of a raw error name, and the typed text is
kept. The same plain wording covers create, edit, comment, and detail
refresh; retrying after the connection returns saves normally.
A panic in a background detail load fails the page's scope.

## Triage draft (optional helper, off by default)

Selecting an issue shows a triage draft box. With the helper off it says
so and ordinary tracker use needs no account. If checking the helper
fails, the box shows a plain notice with a Retry button instead of
claiming it is off; retrying keeps the surrounding edit draft. A panic
(a bug, not a failed answer) while checking shows the same notice, rejects
the check, and fails the page's scope, so it is never hidden. With the
helper on, "Draft a summary" streams a short summary or next steps for
that issue. Cancel stops the run, Discard throws the draft away — neither
saves anything. "Post draft" appends the generated text as a comment
under the chosen Ada/Lin/Sam author through the normal comment action.

While a draft post is pending, posting controls stay disabled; it saves once.
A model error result or thrown error ends the turn as failed with no final draft.
An HTTP disconnect or root close cancels the model turn and saves nothing.

Shutdown waits for a live sync wire and a held draft turn to finish closing.
Ordinary saves continue while a draft turn holds.
Each issue's live draft keeps its own text and result.

Turn the helper on for local use:

```bash
DRAFT_HELPER=1 PUBLIC_BASE_URL=http://127.0.0.1:4311 HOST=127.0.0.1 PORT=4311 DATA_PATH=./data/issues vp run @tinker-issue-tracker#start
```

`DRAFT_HELPER=1` (or `true`) opts in; without it the helper stays off.
`PUBLIC_BASE_URL` is the address the helper's read tools call — set it to
the same server, or omit it to use `http://HOST:PORT`. The real Claude
adapter reads its credentials from the server environment (for example
`ANTHROPIC_API_KEY` as the Claude Agent SDK documents); keep them
server-only and never put keys in the browser or client bundle.

The run may call only the existing issue `get`/`list` read tools through
its in-process server. Built-in tools are disabled, filesystem settings
are off, outside MCP config is refused, and unexpected permission prompts
are denied. A credentialed live model run was not verified.

A draft request's `prompt` is optional. A blank one asks for the default
summary; one that is not text answers 400 and runs no model.

## Run it

```bash
vp install
vp run --no-cache --filter '@tinker-issue-tracker...' build
HOST=127.0.0.1 PORT=4311 DATA_PATH=./data/issues vp run @tinker-issue-tracker#start
```

The build command builds the public workspace libraries before the app.

Then open `http://127.0.0.1:4311/` in two tabs. `HOST` and `PORT` set the
address; `DATA_PATH` is the persistent PGlite folder (gitignored).

Importing either entry file starts nothing.
`runServer(env, stop)` serves until the stop signal fires.
It waits for a clean close and answers 0; a boot failure answers 1.

Saved issues reach the list route and sync stream before the port opens.

A `PORT` that is not a whole number from 1 to 65535 stops the boot with
`BadPort`; a missing `PORT` means 4311.

Walkthrough: create an issue in the first tab and see it appear in the
second; open it in both; change status/assignee in one tab and watch the
other; add a comment in the second and watch the first; reload either tab
and everything persists. Stop the server, start it again on the same
`DATA_PATH`, and the saved issues return. Type a local edit, restart the
server while an edit is open, change the saved title elsewhere, and the
page comes back by itself with the new saved title while keeping the local
draft; saving with the old revision is rejected with 409 and the exact
saved detail is unchanged until "Reload their change".

## Use it from the command line

Every command reaches the running server over HTTP; `BASE_URL` picks the
address (default `http://127.0.0.1:4311`). Help needs no backend.
Missing or blank `--base-revision` values report command usage.

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
`comment`, `get`) served over stdio.
They save through the same server and report conflicts as tool errors.

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

Replace `/abs/path` with your repo folder. From the repo root, `pwd` prints it.
No account is needed; the default path reaches the local server above.

## Check it

```bash
vp run @tinker-issue-tracker#test
vp run @tinker-issue-tracker#test:browser
```

`test` runs the behavior tests (real PGlite, real routes, memory-pair sync):
`issues` (saves, conflicts, restart), `tools` (CLI/MCP over real HTTP), and
`draft` (helper streaming, cancel, failure, shutdown).
`test:browser` runs the self-owned browser proof: it starts its own
temporary server on a free port with a temporary database, drives two real
390px Chromium tabs (create/edit/status/assign/comment, conflict with
explicit reload, CLI create/update/comment/get visible in the browser,
reload, a tab opened while the server is down that shows "Connecting…"
and goes live when it starts, one server restart the tab comes back from
by itself keeping local drafts and rejecting the stale revision with 409,
and Reconnect pressed after the stream was refused with a 503), then runs
the helper cases
(cancel/discard/Post with a held comment request, closing the view,
malformed stream, shutdown with a live wire and held turn). It cleans up
its servers, browsers, and temp data, and needs no model credentials.

## How it fits together

React screen → HTTP command → short transaction → saved issue.
React screen ← sync snapshot ← committed root state.

Saves run in their own short child session and publish to the shared root
cell only after the database commit resolves. PGlite is single-connection,
so short write transactions queue instead of overlapping.

Every saved id (issue, comment, activity row) comes from the scope's
random, so a scope with a seeded random replays the same ids.

Each save runs smaller operations as subflows:

- `loadSaved` reads one issue in the request's transaction.
- `writeIssue` writes an edit over the saved row.
- `recordActivity` appends one activity row.

An edit of a missing issue fails with the origin `loadSaved`.
A test can preset one of them alone.
A preset `recordActivity` receives every activity write.

The `publish()` extension reads saved issues during start.
It reads again after each successful non-GET request commits.
A POST updates the published list; a 400 or GET keeps the same list object.

After a create commits, a publish failure keeps the row and the 201 response.
It logs one `publish failed` line; the next commit tries again.

The list route reads the published cell and needs no database.
First listed is outermost; work after `await next()` runs inside out.
The server listed first opens its port last.

The detail and conflict routes also work through `app.request` with no port.
`api.config` rejects a 500 as `ResponseFailed` by default and lets a 409 through.
An explicit `accept` replaces that default status rule.

The JSON log sink writes every log line and only failed spans.
A log writer that throws loses that line; the scope keeps running.
An error no route maps answers 500 and writes one `request failed` line.

The trace comes from the graph: the caller, its `http.send`, then `http.attempt`.

The app is built from the public libraries:

- [`@tinker/core`](../../packages/core/src/index.ts): scopes, operations,
  and data cells — the app boots one owning scope and runs each save as a
  short operation.
- [`@tinker/drizzle`](../../packages/drizzle/src/index.ts): the PGlite
  store behind the issue/comment/activity rows.
- [`@tinker/hono`](../../packages/hono/src/index.ts): the HTTP server —
  one scope at the entrypoint, one session per request.
- [`@tinker/http`](../../packages/http/src/index.ts): the browser command
  frame — typed operations over HTTP with managed request/response errors.
- [`@tinker/sync`](../../packages/sync/src/index.ts): the live list — the
  server publishes the issue list source, each tab subscribes and fills
  its cells from snapshots.
- [`@tinker/react`](../../packages/react/src/index.ts): providers and
  hooks — the page reads cells with `useData` and saves with `useRun`.
- [`@tinker/process`](../../packages/process/src/index.ts): the entrypoint —
  the `issues` commands and the `mcp` stdio server in `src/tools/main.ts`.
- [`@tinker/mcp`](../../packages/mcp/src/index.ts): the same five actions
  as MCP tools over stdio.
- [`@tinker/harness`](../../packages/harness/src/index.ts): the optional
  triage draft — the real Claude adapter behind the helper, read-only
  issue tools, server-side credentials only.
