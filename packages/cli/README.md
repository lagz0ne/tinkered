# @tinker/cli

The CLI driver is an extension (ADR 0051): `cli(wiring)` installs the routing
rows, `scope.resolve(ext)` is `run(argv, io)`, and `runMain` is the root glue
over it.

```ts
import { operation } from "@tinker/core";
import { cli, command } from "@tinker/cli";

const migrate = operation({
  label: "migrate",
  input: (raw: unknown) => {
    if (typeof raw !== "string") throw new Error("bad target");
    return raw;
  },
  run: (_deps, ctx) => `migrated to ${ctx.input}`,
});

const shell = cli({
  name: "app",
  version: "1.0.0",
  commands: [
    command("migrate", () => import("./migrate.ts").then((m) => m.migrate), {
      description: "apply migrations",
      input: (argv) => argv[0],
    }),
    command.entry("serve", (argv) => serveMain(argv)),
  ],
});
```

A row is an operation plus its CLI edges (`input` hands raw argv to the
operation's parse; `respond` writes the value), or an entry run by hand. Either
way the routing table is flat wiring handed to the extension — no scope tags,
no meta. `command.entry` takes only a direct entry: it receives `(argv)` and
reads anything else from its defining module's closure, the root.

The loader runs only for the selected command — `help` loads nothing — and is
memoized on the row, so a second run on the same table reuses the operation.
An operation command runs in a session as an inline op (`app migrate` span,
one `cli command` log line) opened on the `start` scope; `io.signal` (tests)
force-closes that scope, the same close signals own in `runMain`.

Tests skip the process: install the extension, `await scope.ready`, resolve
`run`, and call `run(["migrate", "v2"], io)` — it returns
`{ code, stdout, stderr }`. The root outlives a run; close it when done. See
core's [observation guide](../core/README.md#observation) for spans.

`runMain(wiring, scope?)` is the real entrypoint: install the extension beside
any extra scope options, `ready`, resolve `run`, wire SIGINT/SIGTERM to an
abort, close graceful, `process.exit` with the run's code. Never returns. When
an entry must resolve a sibling extension off the root (the tracker's `mcp`
entry resolving its MCP server), `runMain` cannot serve — it never hands the
root back — so the root does the same ≤ 30 lines by hand (see
`apps/issue-tracker/src/tools/main.ts`).

Exit codes: 0 success · 1 failure (message to stderr) · 2 usage (unknown or
missing command, or the operation's parse failure) · 130 interrupted.
