# @tinker/process

A command is a Core operation that returns an exit code.
A service starts through Core extensions and waits for its root to close.
Process routes first, owns one root, and reads cleanup before returning.

```ts
import { operation } from "@tinker/core";
import { io, main, type Process } from "@tinker/process";

const ping = operation({
  label: "ping",
  depends: { io: io.required },
  run: ({ io }) => {
    io.write("pong\n");
    return 0;
  },
});

const shell: Process.Shell = {
  name: "tk",
  version: "0.1.0",
  commands: [
    {
      name: "ping",
      entry: () => ({ kind: "command", op: ping }),
    },
  ],
};

if (import.meta.main) {
  process.exitCode = await main({ shell });
}
```

## Run with supplied facts

`run` takes one object and returns `Promise<number>`.
It requires `shell`, `args`, and both `io` writers.
It accepts `env`, `signal`, and common Core `options`.
It reads no host process facts and keeps no output transcript.

```ts
const output: string[] = [];
const errors: string[] = [];
const code = await run({
  shell,
  args: ["ping"],
  env: {},
  io: {
    write: (text) => output.push(text),
    error: (text) => errors.push(text),
  },
});
```

- A command returns its own code and writes directly to the supplied writers.
- Run binds the supplied args and env and otherwise uses an empty env.
- The `argv` tag carries arguments after the selected route name.
- Entry options override common options and tags combine after process facts.
  Common tags follow Process tags; entry tags follow common tags.
  Other Core options use ordinary field replacement.
- A command with a signal writes to the root data its extensions read.
- The graph produces the trace: the command operation and the operation it drives beneath it.

## Routes and commands

Each route has a name, an optional description, and an `entry` callback.
The callback receives `{ args, signal? }` and returns an entry or a promise.
It supplies graph units and config; service work starts through extensions.

- Help sorts routes by name and preserves duplicate order without loading.
  No arguments, `help`, and `--help` print usage and return 0.
- Version returns 0 without loading.
  `--version` writes the shell version.
- An unknown command prints usage to stderr with exit 2 and loads nothing.
- Each run calls its selected loader with args and retries after failure.
  Process adds no cache; native imports keep their own module cache.
- A loader failure prints its error and returns 1.
- A command parses argv through its operation and writes a JSON line.
  The command owns all output; Process adds no success output.
- An operation's parse failure prints usage to stderr with exit 2.
- A command failure prints its error with exit 1.
  Non-Error values print as JSON; `undefined` prints `unknown`.
- A command that returns closes its root gracefully.
- Failed setup finishes cleanup and calls each close hook once.
- A successful command returns 1 when cleanup fails.
- Cleanup failure keeps an earlier command exit code.
- Cleanup failure follows the primary command error without hiding it.

## Services and stop

A service entry contains only Core options.
There is no waiting command.
Its extensions own startup and cleanup.

```ts
import { extension } from "@tinker/core";
import { stop } from "@tinker/process";

const stdio = extension({
  label: "stdio",
  hooks: {
    start: (event) => {
      const finish = event.resolve(stop.required);
      process.stdin.once("end", finish);
      process.stdin.resume();
      event.defer(() => {
        process.stdin.removeListener("end", finish);
        process.stdin.pause();
      });
      return event.next();
    },
  },
});

const service: Process.Entry = {
  kind: "service",
  options: { extensions: [stdio] },
};
```

The static `stop` tag supplies a borrowed `() => void` function.
It asks Core to close the root gracefully, including during startup.
Call it when stdin ends or a transport closes.

- An already aborted call starts no loader and returns 130.
- Abort during loading returns 130 before the loader ends and observes its late rejection.
- An abort during extension start exits 130 without running the command.
- Command abort force-closes its root and a cancelled command returns 130.
  A command that handles the stop and returns keeps its own code.
- A service signal waits for graceful cleanup before returning 0.
- A service stop during startup finishes start and then cleans up.
- A service whose start fails returns 1 after cleanup.
- A service cleanup failure returns 1.
- Stdin EOF stops a service and waits for cleanup.

## Main

`main({ shell, args?, options? })` is the OS entry.
It returns a code for the guarded app entry to assign to `process.exitCode`.
It never calls `process.exit`, so Node can finish pending writes.

- Main lets each full 1 MiB pipe write finish before the app exits.
- Main reads real args and env and removes both stop listeners after return.
  It copies environment values before loading the selected entry.
- Main accepts explicit args instead of host argv.
- Main returns 2 for an unknown route and writes usage to stderr.
- A real command SIGINT exits 130.
- A service SIGINT or SIGTERM removes both listeners and closes gracefully.
- A second OS signal terminates stalled service cleanup normally.

## Helpers

- `jsonLine` answers one JSON line and stays undefined for a void value.
- `positionals` keeps the plain words in order and drops a `--flag`.
- A flag named in `values` drops its value too.
- `--name=value` is one flag, so it drops with no word after it.
- `--` ends the flags, so every later word is plain.
- `positionals` keeps a lone dash as a plain word.
- `positionals` drops a single-dash flag.
- A value flag at the end takes no word and drops alone.

```ts
const [file, dir] = positionals(argv, {
  values: ["--key-file"],
});
```

## Errors

`NoProcess { reason }` means `main` found no host process.
Narrow with `isError(error, "NoProcess")`.
Other command failures reach the supplied error writer.
