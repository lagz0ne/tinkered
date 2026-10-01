# Thin Process entries

Status: Done; full checks and all affected fault lanes pass.
Owner: authoring lead.
Writers: Astra xhigh; one package per turn.
Review: Opus high.

The user approved the Process review and its smaller shape.
[Observed failures and proposed cases](PROCESS-REVIEW.md).
The Unix main precedent stays: route, run, finish cleanup, return a code.
Node's output rule requires natural exit after pending writes finish.

## API and ownership

Keep native tags, operations, resources, and extensions.
Routing remains outside Core: help and unknown routes build no root.
A route still loads only after selection.
Its callback receives one object with `args` and optional `signal`.
The signal lets owned loader work stop too.
An import promise stays observed if its caller stops awaiting it.
A loader only supplies graph units and config; it does not start a service.

Each selected entry is one of these cases:

```ts
{ kind: "command", op: checkCommand }
{ kind: "service", options: {
  extensions: [stdio, searchMcp],
} }
```

A command still returns its own exit code and writes through `io`.
Its abort force-closes its one root, preserving root data ownership.
Do not use Core's call signal: that makes a child session.
A service starts its extensions and waits for Core's `closed` result.
Its stop requests graceful root close; no waiting operation is needed.

`stop` is a static Process tag carrying a borrowed `() => void` port.
The runner binds it to its root's native stop controller.
A service extension calls it when stdin ends or its transport closes.
That gives EOF and OS signals the same native lifetime boundary.
No stop cell, scope handle, or close promise is handed to userland.

The public calls are object calls, with no legacy form:

```ts
const code = await run({
  shell,
  args: ["check", "README.md"],
  env: {},
  io: {
    write: (text) => output.push(text),
    error: (text) => errors.push(text),
  },
});

if (import.meta.main) {
  process.exitCode = await main({ shell });
}
```

`run` answers a number and never reads the host process.
Its `io` is required; `env` defaults to an empty record.
Its optional `signal` comes from its caller.
Its optional `options` supplies common Core settings.
The entry's own settings override common fields.
Tags combine process facts, then common tags, then entry tags.
Use ordinary options precedence, not a new merge framework.
Process owns the root signal; the public `signal` or `stop` port requests its stop.

`main` reads real argv, environment, and streams once.
It accepts `{ shell, args?, options? }` and returns a number.
It installs both OS stop listeners and removes both after the first stop
or after the run ends, so a second signal can terminate the process.
It never calls `process.exit`; its app owns `process.exitCode`.
Environment values are copied at the edge for the run's static binding.

Remove public `execute` and `Process.Result`.
The executor is private; callers collect only the output they need.
Retain `usageOf`, `positionals`, `jsonLine`, and managed Process errors.
No command builder, class, cache, or generic manager is added.

## Exit rules

- Help and version return 0 without a loader or root.
- Unknown route or invalid command input returns 2 with usage.
- Loader or command failure returns 1 with the failure text.
- A pre-aborted call starts no loader and returns 130.
- An abort while loading returns 130 and observes a late rejection.
- A cancelled command returns 130 unless it handles the stop and returns.
- A service's normal stop or EOF returns 0 after cleanup.
- Failed start or teardown makes a successful run return 1.
- An earlier failed command keeps its code and primary failure.
  Secondary cleanup must not hide it or create a false success.

## Impact before code

Process changes `Entry`, `Route`, `run`, and `main`.
It adds the static `stop` port and removes `execute` and `Result`.
SCIP references and source searches name these callers:

- Process source, its tests, and its README.
- Blueprint's static shell, main, command tests, and docs.
- Tinkerer's command tests and README.
- The tracker tools entry, route list, tests, and README.
- Process, Process CLI, and MCP examples and their docs.
- MCP package README and the authoring guide.
- Glossary and a new decision replacing the affected ADR 0056 rules.

Blueprint's shell becomes static metadata.
Common settings move to the Process call instead of repeated route closures.
Domain operations and resources keep their identities.
Each writer touches only its assigned package in its own worktree.
Callers can be prepared together from this contract.
Their final gates wait for the new Process package to be built.
No legacy compatibility adapter lands.

Core, HTTP, Hono, Drizzle, Harness, and server runtime graphs are unchanged.
The known Core graceful-write and close-hook limits remain separate cards.
No paid backend is used for gates.

## Tickets

- **Process API and bugs** — blocked by: none.
  New cases and object calls; full pipe output; cleanup failure handling.
  Verify: package check/tests; real pipe, loader stop, and service EOF cases.

- **Caller migration** — blocked by: the built Process API for final checks.
  Static shells, explicit output collection, native service lifetime.
  Verify: each package's own checks and tests; no old public symbol refs.

- **Lead integration** — blocked by: both preceding slices.
  Review, full repo checks, package fault proof, and landing.
  Verify: build, check, all tests, prose, strict census, release checks;
  affected package mutation floors remain 85; imports start nothing;
  outside-repo Process, Process CLI, and MCP copies pass.

## Proof

Source at `87789d8a` passed Opus high review: READY.
The lead read the source and public entry tests too.
The final source includes the newer auth landing from `175c408b`.

- Full build passes: 23 tasks.
- Full check passes: 0 errors, 28 existing warnings.
- Full tests pass: all 31 package and example tasks.
- Process passes 48 tests; Blueprint passes 118 local tests.
  Its one existing paid test stays skipped.
- Tinkerer passes 103; tracker passes 82.
- Process example passes 7; Process CLI passes 5; MCP passes 6.
- Three outside-repo example copies pass install, checks, tests, and run.
- Strict census and TSDoc pass for all 32 changed TypeScript files.
- Jev lead review has 0 flags.
  Writer model checks for Blueprint and Tinkerer were skipped without a key.
  Other writer checks passed; no new label state was added.
- Active code has no old Result, shell builder, wait action, or positional call.
  The public built Process entry has no `execute` export.
- Three injected regressions fail as required:
  forced exit loses pipe output; ignored close returns false success;
  a removed loader race leaves stop waiting.

The first fault run failed at 73.20: the Vitest runner skipped child-only faults.
Its coverage result overrode the disabled-coverage setting.
Process now uses Stryker's built-in command runner.
Each fault runs the whole suite; children inherit its native fault env port.
The native child timeout is a cleanup bound, not a speed claim.
The next Process run failed at 83.60, with no skipped faults.
Its short outer limit produced 81 timeouts.
The runner now uses two workers and a 30-second outer limit.
Stronger checks prove pre-abort, sorted help, and graceful service cleanup.
Four added cases cover loader stop races, in-root command cancellation,
and an owned service task failing after startup.
Opus high reviewed these checks at `bc779217`: READY.
Targeted stop and failure checks killed all 23 faults, with no timeouts.

- Blueprint's fresh full fault score passes at 86.23.
  It killed 1,334 faults; 6 timed out; 157 survived; 57 had no coverage.
- Tinkerer's fresh full fault score passes at 91.82.
  It killed 659 faults; 26 timed out; 53 survived; 8 had no coverage.
- All 54 release checks pass, exit 0.

The final full Process lane passes at 86.00, exit 0.
It killed 205 faults; 10 timed out; 35 survived; none were skipped.
The floor remains 85, with every source file included.
The lead read all 10 timeout changes:
five remove command cleanup, two drop the root bindings,
one leaves the loader waiting forever, and two make argument loops run backward.
Each prevents promised work from starting or finishing.
The targeted stop and failure checks killed all 23 faults without a timeout.

The final 48-test suite, build, check, prose, census, and TSDoc pass.
All fault input hashes still match the checked source and tests.
Runtime source stayed fixed through the final review and fault runs.
