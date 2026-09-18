# 0042 The CLI entrypoint owns the scope; routing is scope configuration; loading policy follows the process

Date: 2026-09-18. Status: accepted. Refined by 0046 §5 (cli/t04): a command is an operation with `command` meta bound with `commands(op)`; the loader and resource rows below stay for lazy modules. Refines: 0034 (tiers: driver), 0039 (Hono: session-level driver,
answers its open Q3), 0040 (a request is an inline operation), 0037/0038 (inline ops, tagged calls),
0028 (close modes), 0006 (the operation's `parse` is the edge).

## Context

The CLI is the first driver that IS the entrypoint: it creates the scope, runs one command, and
closes the scope, mapping the outcome to stdout and an exit code. Effect's `@effect/cli` builds a
command tree (`Command.make(name, { args, options }, handler)`, `withSubcommands`) and
`NodeRuntime.runMain` forks it, interrupts on SIGINT, and exits 1 on failure, 0 otherwise.

Two rules of thumb from authoring shape ours:

1. **Config via the scope.** The routing of arguments to operations is configuration, so it lives
   on the scope as tag bindings — the same way per-client http config and hono's request tags do.
   A test configures the whole CLI through `Scope.Options`, nothing else.
2. **Loading policy follows the process.** A CLI is short-lived: `app help` must not import the
   driver, the store, or any command module. A server is long-lived: it imports every route at
   mount and warms its pools at startup, so the first request pays nothing and bad configuration
   fails at boot. Same table shape (loaders), two policies chosen by the driver.

## Decision

```text
runMain({ name, version, scope })      the entrypoint driver: createScope(scope) … close
├── command.all (tag bindings)          the routing table: name → loader, input, respond — read from the scope
├── argv[0] missing / unknown / "help"  usage from the bound names; exit 2 (help: 0); NO module loaded
├── op = await load()                   the selected command's module only; cached on the binding
├── session.run({ label: "app migrate", depends: { op }, run })   the command is an inline op:
│     ├── span "app migrate", attributes { command, args }, one `cli command` log line { command, code, ms }
│     ├── op.run({ rawInput: input(argv) })     the op's parse is the edge (DataValidationFailed → usage, 2)
│     └── respond(value) → stdout               default JSON; void → nothing
├── SIGINT / SIGTERM → scope.close() forced     the command settles cancelled → exit 130
└── done → scope.close({ graceful: true })      success → 0 · failure → stderr, 1
```

- **Commands are tag bindings.** `command(name, load, { input?, respond? })` returns a binding of
  the `command` tag; `runMain` reads `command.all` from the scope it created. `load` is
  `() => Operation.Handle | PromiseLike<Operation.Handle>` (a dynamic `import` in practice; an
  eager handle is allowed). `input: (argv: readonly string[]) => unknown` hands raw argv to the
  operation; no flags parser in v1 (`node:util.parseArgs` inside `input` is the reader's choice).
  `respond?: (value) => string` writes stdout; default JSON, nothing for `undefined`.
- **Entry commands.** `command.entry(name, load)` where the loaded value is `(scope: Scope.Handle,
argv: readonly string[]) => void | PromiseLike<void>`: the one place a handle is handed to
  userland, because `runMain` is `main`. This is how `app serve` mounts hono on the same scope —
  ADR 0039's Q3 answered: one scope, several drivers, shared at the entrypoint only.
- **Exit codes:** 0 success; 1 failure (message to stderr); 2 usage — unknown/missing command or
  the operation's `parse` failure; 130 interrupted by SIGINT/SIGTERM.
- **Lifetime = ADR 0028.** A signal force-closes the scope: the command's session settles
  `cancelled`, resources roll back. Completion closes gracefully: commit. `runMain` awaits the
  close before `process.exit`.
- **Testable without the process:** `run({ name, version, scope, argv, io })` does everything
  `runMain` does except signals and `process.exit`, returning `{ code, stdout, stderr }`.
  `runMain` = `run` + process wiring. Tests pass `presets` and tags in `scope`.
- **Loading policy, stated once:**
  - CLI: lazy. Usage and help read only the bound names; the selected loader runs once.
  - Server (hono/t05, routes at the scope): eager. `honoApp(scope)` imports every route at mount;
    `main` warms pools with `await scope.resolve(store.db)` before `serve` — no new mechanism, the
    read verb is the warm-up.
  - Frames are cheap to import: driver and client imports live inside `open` and loaders, never
    at module top (`drizzleStore`'s `open` does `await import("@electric-sql/pglite")`).

```ts
export const command: Tag.Handle<Cli.Command>;                 // bound on the scope
export function command(name, load, route?): Tag.Binding<Cli.Command>;   // value + tag, like http's builders
export namespace command { entry(name, load): Tag.Binding<Cli.Command> }
export function run(options: Cli.Options & { argv: readonly string[]; io?: Cli.Io }): Promise<Cli.Result>;
export function runMain(options: Cli.Options): Promise<never>;  // exits
// Cli.Options = { name: string; version: string; scope?: Scope.Options }
// Cli.Result  = { code: number; stdout: string; stderr: string }
```

## Consequences

- One binary, many commands, one configuration point. Tests are `run({ scope: { presets, tags },
argv })` and assert code and output — no process, no mocks.
- The command run is an inline operation, so spans, the log line, clock, and signal come from
  core exactly as in hono (ADR 0040).
- hono/t05 adopts routes-at-the-scope with the eager policy; the two drivers then read alike.
- **A lazy module is a resource** (settled after two askers, 2026-09-18): `resource({ factory: () =>
import("./x.ts").then((m) => m.op) })` is the lazy unit — built once per owner, cached, presettable,
  with a span — and `drizzleStore.open` already has this shape. A driver runs `scope.run(await
scope.resolve(module), …)`; a userland operation depends on the module resource like any other.
  No new core unit; the drivers' loader functions are the hand-rolled form of it.

## Alternatives rejected

- **A built-in flags parser** — a second edge beside the operation's `parse`.
- **Commands as a `runMain` parameter** — the same table, but outside the scope: tests would
  configure two things.
- **Lazy everywhere, including the server** — a server that imports a route on first request
  trades boot time it does not care about for latency and late failures it does.
