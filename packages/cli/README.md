# @tinker/cli

The entrypoint driver: it owns the scope, routes argv to lazily loaded
operations bound on the scope, and maps the outcome to stdout and an exit code
(ADR 0042).

```ts
import { operation } from "@tinker/core";
import { command, commands, runMain } from "@tinker/cli";

const migrate = operation({
  label: "migrate",
  input: (raw: unknown) => {
    if (typeof raw !== "string") throw new Error("bad target");
    return raw;
  },
  meta: [command({ description: "apply migrations", argv: (argv) => argv[0] })],
  run: (_deps, ctx) => `migrated to ${ctx.input}`,
});

await runMain({
  name: "app",
  version: "1.0.0",
  scope: {
    tags: [
      commands(migrate),
      command.entry("serve", () => import("./serve.ts").then((m) => m.serve)),
    ],
  },
});
```

A command is an ordinary operation with `command` meta, the same rule
`@tinker/mcp` sets for tools (ADR 0046): one declaration can be a CLI command
and an MCP tool. `command(name, load, { input?, respond? })` binds a lazily
loaded row instead; either way the command runs in a session as an inline op
(`app migrate` span, one `cli command` log line). The loader runs once, only for the selected
command — `help` loads nothing. `command.entry` binds a server-style command
that receives the scope itself. A command may also bind through a resource
that delivers its operation — built once per scope and
observable as a `resource` span (ADR 0042, ADR 0044):

```ts
import { resource } from "@tinker/core";

command(
  "migrate",
  resource({ label: "app.migrate", factory: () => import("./migrate.ts").then((m) => m.migrate) }),
);
```

Tests skip the
process: `run({ name, version, scope, argv, io })` returns `{ code, stdout,
stderr }`, and `io.signal` is the stand-in for SIGINT/SIGTERM (abort → 130).

Exit codes: 0 success · 1 failure (message to stderr) · 2 usage (unknown or
missing command, or the operation's parse failure) · 130 interrupted.
