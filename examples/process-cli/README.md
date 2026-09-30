# Process CLI example

A small command line app built with `@tinker/process`.
It needs Node 22.18 or newer and Vite+ (`vp`).
It uses no network or service accounts.

From this repo, install and build first:

```bash
vp install
vp run -r build
cd examples/process-cli
vp run start
```

With no command, it prints help and exits with code 0:

```text
usage: tinker <command>
  greet
  ping
```

Run either command:

```bash
vp run start -- ping
vp run start -- greet ada
```

`ping` prints `"pong"` as one JSON line.
`greet ada` prints `hello ada` and a newline.
It reads the first name argument.
With no name, `greet` prints usage to stderr and exits with code 2.
`dev` runs the same entry as `start`.

To copy this package out, run from the repo root:

```bash
vp run example:export -- process-cli \
  /tmp/tinker-process-cli
cd /tmp/tinker-process-cli
vp install
vp check
vp test
vp run start -- greet ada
```

The export includes the unreleased library packages.
Its install uses those copies.

## The tour

`tour()` is also public through `index.ts`.
It runs help, doubles 21, then selects a lazy ping command.
Help loads no command.
Selecting ping imports its declared operations from `ping.ts`.
The tour reuses one declared shell.

The returned report is:

```text
help 0
double 0: 42
ping 0: "pong"
```

It shows all three commands succeeding, with 42 and `"pong"` as their answers.
Every command's root closes before its result returns.

`main.ts` starts only when run directly.
`index.ts` exports the pieces from `shell.ts` and `basic.ts`.
Tests import these pieces without loading the entry file.

Run the package checks here:

```bash
vp check
vp test
```
