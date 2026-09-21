# 0056 The process is tags; a command is an operation that answers an exit code; routing runs outside any scope

Date: 2026-09-21. Status: accepted. Retires: ADR 0042 (the CLI entrypoint owns the scope) and the
`@tinker/cli` package. Refines: 0051 (drivers are extensions), 0050 (extensions are middleware),
0038 (a tagged call opens a child session), 0028 (close is a shutdown mode).

## Context

`@tinker/cli` grew from one job (route argv to an operation) into an entrypoint that owns the root:
`runMain` calls `createScope` for you. Three things broke against that shape.

- **The tracker could not use it.** Its `mcp` entry must `resolve()` a sibling extension off the
  root, and `runMain` never hands the root back — so the app hand-rolls 24 lines of root glue.
- **An agent cannot stream through it.** A row returns one string at the end. The escape hatch,
  `command.entry`, writes straight to `process.stdout`: measured, an entry's output never reaches
  the driver's `io`, so the main output of an agent is untestable and leaks into a test's terminal.
- **One binary does several jobs.** `help` needs no root; `check` needs a root and one session;
  `serve` needs a root that outlives many sessions and treats a signal as its normal stop. The
  driver built one root before routing, so `help` paid for a root it never used.

Patching it meant three new row edges (`out`, `tags`, `fail`) and coupling a library operation to a
driver-owned tag so it could print. The user's reading cut the knot: the package is mostly process
side effects; the environment cannot change during a run, so it is **tags**; and routing is a plain
lookup that needs no scope at all. What is left of a command is an operation.

**The analogy** is Unix and Go's `main`. A command reads argv and the environment, writes to two
streams, and answers an exit code; `git help` never opens the repository. Go's `main` builds the
root context, wires the signal to cancel, and hands it down; a server is a function that returns
when told to stop. Ours is smaller: sessions are structural, so cancellation needs no plumbing.

## Decision

```text
argv
 │
 ├─ help | --version | unknown      no root exists yet
 │
 └─ route.entry(rest) ─▶ execute
       createScope(entry.options
         + tags: argv, env, io)
       scope.run(op) ─▶ code
       close
```

1. **The process is three tags** (`@tinker/process`): `argv` (the words after the command name),
   `env`, and `io` (`{ write, error }`). They are bound once per run and cannot change during it —
   which is what makes them tags rather than cells. There is no `signal` tag: every operation
   already has `ctx.signal`.
2. **A command is an operation that answers an exit code** — `Operation.Handle<number, void>`.
   What it needs it declares: the process tags, cells, resources, other operations. `command(name,
op | loader, { input?, respond? })` stays as the sugar for a plain operation (ADR 0042's rule
   survives: a command IS an operation; its parse failure is exit 2, its value goes through
   `respond`), and a loader still runs only for the selected command.
3. **Routing runs outside any scope.** A route answers the entry for _these_ args:
   `entry: (rest) => { op, options }`. Help, version, and an unknown command are answered before a
   root exists. A flag that must become a tag is bound **here**, in the entry's `options` — not as
   a tagged call inside the command, because a tagged call opens a child session whose cell writes
   never reach a watcher above it (ADR 0038; this cost one debugging round in the spike).
4. **One root per run, built for the routed command, closed when it answers.** `execute` is the
   only place a root exists. A command that needs its own extensions (an MCP server, an HTTP
   listener) names them in its entry's `options`; a sibling extension is resolved by the operation
   through `depends`, or by the extension itself in its `start` (ADR 0051).
5. **An abort force-closes the root; the operation decides what that means.** The run wires
   `signal` to `scope.close()`, so every `ctx.signal` below fires. A one-shot lets the cancellation
   throw and the run answers `130`; a server catches its own signal and returns `0`, because for a
   server a signal is the normal stop. The driver stops guessing.
6. **`run(shell, argv, io?, signal?)` is the seam**, answering `{ code, stdout, stderr }` and
   touching no process. `main(shell)` is the process edge and the only side effect in the package:
   argv in, SIGINT and SIGTERM to one abort, exit with the code.
7. **Every entrypoint follows this shape, not just the CLI.** An HTTP entrypoint, an MCP stdio
   entrypoint, and a CLI differ only in what they bind and what they expose: the thing that serves
   is a resource or an extension, the thing that runs is an operation, and what it needs it
   requires. `@tinker/hono` and `@tinker/mcp` keep their own row tables — they are drivers, which
   map outside work onto sessions (ADR 0051) — but their _roots_ are built this way, by the app,
   with the process as tags. No driver creates a scope.
8. **`@tinker/cli` is retired.** Its four consumers move to `@tinker/process`: blueprint's binary,
   the tracker's tools binary, tinkerer's `ask`, and the examples. `command.entry` has no successor
   and needs none — an entry was only ever "a command that gets no scope", and now every command
   gets one.

## Consequences

- Measured on the spike: `@tinker/process` is 2646 B gzip with 22 seam tests and an 83.43 mutation
  lane, against `@tinker/cli`'s 476 source lines. Nine cases pass that the old shape could not all
  serve: help and unknown build **no root**; a streamed agent's tokens are **captured by the seam**;
  a server exits 0 on SIGINT while a hanging one-shot exits 130 in ~30 ms.
- `command.entry`'s hole closes: what it did is now an ordinary command, so its output is
  assertable and its exit code is its own return value.
- The tracker's 24 lines of root glue become an entry's `options`.
- Three candidate CLI edges (`out`, `tags`, `fail`) are withdrawn: `io` is a tag, flags are bound
  by routing, and the exit code is the operation's return value.
- The glossary's "entrypoint driver — a driver that IS `main` and creates the scope" is wrong under
  this ADR and is replaced: the app owns the root; a driver receives one.
- Core is untouched. Everything here is tags, operations, extensions, and `session(options, fn)`
  that core already has.

## Alternatives rejected

- **Three new edges on `@tinker/cli`** (`out` for streaming, `tags` for flags, `fail` for codes) —
  more surface, and it couples a library operation to a driver-owned tag so it can print.
- **A reshaped driver where a command body receives the root** (`(scope, argv, io) => code`) — it
  works (nine cases passed in the spike) but widens "two hands" to every command body and keeps a
  package whose remaining job is a lookup in a table.
- **Delete `@tinker/cli` with no successor** — each app would re-implement routing, usage, exit
  codes, and a seam; the three tags and `execute` are the part worth sharing.
- **`io` as an ambient capability on `ctx`** (like `clock`, ADR 0034) — a core change that puts a
  writer on every operation in every app, including those with no console at all.
