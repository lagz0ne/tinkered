# Process from its basic jobs

Status: complete review; the proposed shape is not implemented.
Owner: authoring lead.
Checked source: `91964db3`, 2026-10-01.

## Findings first

- **P1: main can lose output.**
  [Process source, line 208](../../../packages/process/src/index.ts#L208).
  It calls `process.exit` without waiting for stdout or stderr to finish.
  A real child writes 1,048,576 bytes through the public `io` tag.
  Its parent receives 146,176 bytes; the child still exits 0.
  The received count can vary, but this run proves lost output.
  [Node's exit rule](https://nodejs.org/api/process.html#processexitcode)
  says to set the exit code and let pending output finish.
  The app entry already does that at
  [tracker main, line 61](../../../apps/issue-tracker/src/server/main.ts#L61).

- **P1: a failed cleanup still answers success.**
  [Process source, line 84](../../../packages/process/src/index.ts#L84).
  `execute` awaits `closed` and discards its result.
  Its return code was picked before cleanup.
  A resource whose deferred cleanup throws gives exit 0 and empty stderr.
  Core reports `success` with one `teardownErrors` item for the same graph.
  Process must read both the status and those errors before choosing a code.
  Stack already does that at
  [exit source, line 19](../../../packages/stack/src/exit.ts#L19).

- **P2: a stop cannot reach the selected loader.**
  [Process source, line 157](../../../packages/process/src/index.ts#L157).
  `run` waits for `route.entry` before `execute` wires its stop listener.
  The loader receives only arguments, with no signal.
  A gated loader stays pending after its caller aborts.
  If it later rejects, the run prints that error and answers 1.
  It never reaches the cancelled-command path.
  `main` keeps both signal listeners installed, so another signal only
  repeats the abort while that loader is pending.
  The app still needs a way to stop awaiting a selected load safely.

- **P2: the live output path also keeps the full test transcript.**
  [Process source, line 131](../../../packages/process/src/index.ts#L131).
  Every write is appended to `stdout` or `stderr`, even with live writers.
  `main` uses that same collecting path at
  [line 202](../../../packages/process/src/index.ts#L202).
  A long stream keeps all earlier output until the command ends.
  Collection belongs to a caller that needs a transcript.

- **Contract mismatch: the test path reads the host environment.**
  [Process source, line 66](../../../packages/process/src/index.ts#L66).
  `run` is described as touching no process, but `execute` reads `process.env`.
  Identical calls in two child environments print `blue` and `red`.
  A route can override the environment tag today.
  That does not remove the hidden default read.
  Pass those outside facts in once, from `main`.

The README's first code block also imports `operation` from Process.
Process does not export it; it belongs to Core.
The loader-cache promises are supplied by a test fixture, not the package.
Native dynamic imports can cache modules, but arbitrary route callbacks need not.
Do not keep those claims as guarantees of `run`.

## What earns its place

Use the existing Unix main model from ADR 0056.
A process receives arguments and environment values.
It writes two streams, runs work, then reports a code after cleanup.
Node's exit rule adds one constraint: pending stream writes must finish.

The current units still fit the settled authoring model:

- Tags supply `argv`, `env`, and borrowed `io` writers.
- Operations perform command actions and return their code.
- Resources own work that needs cleanup.
- Extensions start and manage a service.
- Namespaces choose instances and settings; they do not own the process.
- Core owns each root's lifetime.

Keep lazy command selection outside the root.
Help and an unknown command should start no graph or SDK.
Keep native operations; do not bring back a command builder.
Keep `positionals` and `jsonLine`: they have real callers.
No new class, cache, parser framework, or registry is needed.

## Three cases expose the extra layers

- **Check a file:** choose a route, bind process facts, run its action,
  await cleanup, then choose the code.
  Blueprint and the tracker already author static command operations.

- **Stream a reply:** the same action writes through `io` as work happens.
  Tinkerer's command proves that with a local HTTP backend.
  Writing each piece does not require keeping every piece in Process.

- **Serve MCP:** extensions already connect and own the transport.
  The tracker adds a stop cell and a waiting operation just to keep
  Process's command path alive.
  See [tracker tools, line 47](../../../apps/issue-tracker/src/tools/main.ts#L47).
  The app's HTTP entry instead waits for the root's `closed` result.
  That is the smaller service case from ADR 0085.

```text
choose route
  command
    run action
    close and read result
  service
    start extensions
    await and read closed
```

The server-as-command rule predates the native root stop signal.
ADR 0085 already rejects Process owning every server's lifetime.
Those two entry cases should now be explicit.

## Proposed smaller shape

Keep the shell as static route metadata.
Use one entry object to tell an action from a service.
The selected entry may still load its graph lazily.
This is a sketch for review, not a callable API today.

```ts
import { operation } from "@tinker/core";
import { io, main } from "@tinker/process";
import { searchMcp } from "./search.ts";
import { stdio, streams } from "./stdio.ts";

const ping = operation({
  label: "ping",
  depends: { io: io.required },
  run: ({ io }) => {
    io.write("pong\n");
    return 0;
  },
});

const shell = {
  name: "coder",
  version: "1.0.0",
  commands: [
    {
      name: "ping",
      entry: () => ({ kind: "command", op: ping }),
    },
    {
      name: "mcp",
      entry: () => ({
        kind: "service",
        options: { extensions: [stdio, searchMcp] },
      }),
    },
  ],
};

if (import.meta.main) {
  process.exitCode = await main({
    shell,
    options: {
      tags: streams({
        input: process.stdin,
        output: process.stdout,
      }),
    },
  });
}
```

This uses the existing MCP example units and its borrowed stream config.
The ping action is declared once at module scope.
`main` reads the real process facts and returns after owned cleanup.
A lower-level `run` receives those facts in one object.
Its writers do not collect output unless the caller supplies a collector.
`execute` becomes a private step; no current external consumer imports it.
Help still starts no root, and commands still own their output and code.
Services wait for Core's close result instead of a waiting action.

Command cancellation and service shutdown keep distinct rules.
Do not swap in a call signal without checking data ownership:
Core's call signal makes a child session, whose writes do not change parent data.
That is a tested guarantee, not a drop-in root-stop replacement.
The known `core/graceful-writes` bug remains a separate service-close limit.

## Proof and scope

The lead read the complete Process source, all test fixtures and cases,
its docs, and the current Blueprint, Tinkerer, tracker, and example callers.
SCIP caller indices were refreshed for Process, Blueprint, and Tinkerer.
Source searches cover apps and examples as well.

Build and code check pass with no lint or type errors.
All 50 package tests pass.
Strict style census passes.
The small probes above fail the basic guarantees despite those green tests.
They use real child processes and public built entries.
No mock, host process patch, paid service, or timing claim is involved.
The existing main fixtures do replace `globalThis.process` and make exit throw.
They check returned codes but cannot prove a real pipe finished writing.
Use real child-process checks for that entry promise.

Logs use the `/tmp/tinkered-process-review-` prefix.
The results are in `probes.log`; the runnable probe is `probes.mjs`.
The other logs are `build.log`, `check.log`, `tests.log`, and `census.log`.
No runtime source, tests, public API, decision, or glossary changed.

My pick is to simplify around the three cases above.
Fix lost output and ignored cleanup first.
Then remove live transcript collection and the service waiting action.
Settle that boundary before changing all callers.
