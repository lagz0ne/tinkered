# process v1 — retiring `@tinker/cli`

The process is tags, a command is an operation that answers an exit code, and routing runs outside
any scope (ADR 0056). `packages/process` (`@tinker/process`) replaces `packages/cli`, which is
deleted at the end of this track.

- **Decision:** `docs/decisions/0056-the-process-is-tags-a-command-is-an-operation-that-answers-an-exit-code-routing-runs-outside-any-scope.md`.
- **Glossary:** `docs/glossary.md` → "Process entrypoint" (process tags, command, route, execute,
  run, main); the `entrypoint driver` row and the CLI section are marked retired.
- **Gate + tag:** `scripts/ticket.sh process <NN> "<title>"` → `process/t<NN>`; mutation lane alone,
  floor 75.
- **Spike:** the shape was built and run before the ADR — nine cases, including a streamed agent
  captured by the seam, a server exiting 0 on SIGINT, and a hanging one-shot exiting 130 in ~30 ms.

## The package, as its own blueprint

```yaml
- tag:
    name: argv
    promise: the words after the command name
    why: what a command reads, unchanged during a run
- tag:
    name: env
    promise: the process environment; empty without one
    why: same lifetime as argv, so a tag not a cell
- tag:
    name: io
    promise: >-
      where a run writes; a test binds a
      collector, main binds the process
    why: streaming must be assertable
- operation:
    name: command
    promise: >-
      an operation that answers an exit code;
      the sugar parses argv through the
      operation's own input
    why: ADR 0042 survives — a command IS an operation
- operation:
    name: execute
    depends: [argv, env, io]
    promise: >-
      one root per run from the entry's options
      plus the process tags; an abort force-closes
      it; the operation decides what that means
    why: the only place a root exists
- operation:
    name: run
    promise: >-
      route, answer help and version without a
      root, then execute; answers code and streams
    why: the seam a test drives
- operation:
    name: main
    promise: >-
      argv in, signals to one abort,
      exit with the code
    why: the only side effect in the package
```

## Order & status

Each ticket blocks the next one.

- **process/t01** — [x]
  The package: three tags, `command` sugar with a
  loader, `execute`, `run`, `usageOf`, `main`, the
  `NoProcess` registry. 22 seam tests including the
  process edge under a faked `globalThis.process`.
  `examples/process/app.ts`: an operation command, a
  streaming command, a server command.
- **process/t02** — [ ]
  Migrate `packages/blueprint` (its binary is the
  driver's best case: four commands, usage, help,
  exit codes). `main.ts` binds the key; `commands`
  become routes. Delete its `@tinker/cli` dep.
- **process/t03** — [ ]
  Migrate `apps/issue-tracker`: the `mcp` entry
  becomes a command whose entry options install the
  MCP extension — the 24 lines of hand-rolled root
  glue go.
- **process/t04** — [ ]
  Migrate `packages/tinkerer` (`askCommand` → a
  streaming `ask` command that watches `text` and
  writes through the `io` tag) and the examples
  (`examples/cli/**`, `examples/mcp/cli.ts`).
- **process/t05** — [ ]
  Delete `packages/cli`; drop its lanes from
  `scripts/validate.mjs` and add the process lanes;
  drop the dead deps from `sync` and `mcp`.

## Ticket rules

- One package per contributor, own worktree (`docs/roadmap/contributor-brief.md`).
- Every command is proven through `run(shell, argv, io)` — never through a process.
- A flag that must be a tag is bound in the route's `entry`, never as a tagged call inside the
  command: a tagged call opens a child session whose cell writes never reach a watcher above it.
- Every report ends with **Core feedback** (a failing snippet, not prose).

### Landed

One line per ticket: tag — sha — tests — size (B gzip) — mutation — notes.
