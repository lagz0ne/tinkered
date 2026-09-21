# @tinker/process

The process is tags, a command is an operation that
answers an exit code, and routing runs outside any
scope (ADR 0056). This package is the entrypoint
for every binary: one root per run, built for the
routed command, closed when it answers.

```text
argv ─▶ run ─▶ help | --version | unknown   (no root)
             └▶ route.entry(rest) ─▶ execute
                   root { argv, env, io, + entry.options }
                   scope.run(op) ─▶ code ─▶ close
```

```ts
import { command, main } from "@tinker/process";

const shell = {
  name: "tk",
  version: "0.1.0",
  commands: [
    command("check", check, {
      input: (a) => a[0],
      description: "check a file",
    }),
    {
      name: "serve",
      entry: () => ({
        op: waitForSignal,
        options: { extensions: [server] },
      }),
    },
  ],
};
if (import.meta.main) await main(shell);
```

## Commands

A command is an operation that answers an exit
code. What it needs it declares: the `argv`, `env`,
and `io` tags, cells, resources, other operations.

- Help lists the routes sorted with their
  descriptions and loads nothing.
- `--version` answers the version with exit 0.
- An unknown command prints usage to stderr with
  exit 2 and loads nothing.
- A command over an operation parses argv through
  its own `input` and answers one JSON line.
- `respond` overrides the default output, and a
  void operation prints nothing.
- An operation's parse failure prints usage to
  stderr with exit 2.
- A throwing operation prints its error to stderr
  with exit 1.
- A throwing loader is the run's failure with exit
  1, and the next run retries it.
- The selected loader runs once across two runs.
- A command answers its own exit code, and its
  `io` writes are collected in order.
- A command that throws a non-Error prints it as
  JSON with exit 1.

## Roots

Every run builds one root for the routed command,
from the process tags plus the entry's options. A
flag that must be a tag is bound there, in routing,
before any scope exists: a tagged call would open
a child session whose cell writes never reach a
watcher above it.

- An entry's own options bind tags and extensions
  on that command's root only.
- The `argv` and `env` tags carry the rest of argv
  and the process environment.
- A throwing run leaves the next run unaffected.
- The `env` tag reads an empty record when there
  is no process.

## Signals

An abort force-closes the root, so every
`ctx.signal` below it fires. The operation decides
what that means: return (a server: its own code)
or let the cancellation throw (a one-shot: 130).

- An abort force-closes the root, and a cancelled
  one-shot exits 130.
- A server that returns on the signal exits with
  its own code, not 130.
- An already-aborted signal exits 130 with empty
  streams and no root.

## Test recipe

`run(shell, argv, io?, signal?)` answers
`{ code, stdout, stderr }` and never touches the
process. `execute(entry, rest, io, opts?)` runs
one entry the same way.

```ts
const result = await run(shell, ["check", "a"]);
expect(result.code).toBe(0);
```

## Main

`main(shell)` is the process edge and the only
side effect here: argv in, SIGINT and SIGTERM to
one abort, exit with the code. Never returns.

- `main` reads argv off the process, writes to its
  streams, wires both signals, and exits with the
  code.
- `main` passes explicit args through instead of
  the process argv.
- `main` exits 2 on an unknown command and prints
  usage to the process stderr.
- `main` without a process raises `NoProcess`,
  which `isError` narrows and rejects other kinds.

## Errors

`NoProcess { reason }` — `main` found no process to
read argv from. Narrow with `isError(e,
"NoProcess")`; everything else a command throws
reaches stderr as its message.
