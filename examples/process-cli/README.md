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

## Double a number

`basic.ts` exports the `arithmetic` shell through `index.ts`.
It declares the double command once.
From this folder, run:

```bash
node --experimental-strip-types basic.ts double 21
```

It prints twice the given number and exits with code 0:

```text
42
```

Both shells also have a lazy ping command.
Selecting ping imports its declared operations from `ping.ts`.
Help loads no command.
Every command's root closes before its result returns.

`main.ts` and `basic.ts` start only inside `if (import.meta.main)`.
The arithmetic entry returns its code to Node:

```ts
if (import.meta.main) {
  process.exitCode = await main({ shell: arithmetic });
}
```

The app entry keeps the `--` argument handling:

```ts
import { main } from "@tinker/process";
import { shell } from "./shell.ts";

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [first, ...rest] = args;
  process.exitCode = await main({
    shell,
    args: first === "--" ? rest : args,
  });
}
```

Process owns stop signals and cleanup.
Node finishes pending stream writes before exit.
`index.ts` exports the pieces from `shell.ts` and `basic.ts`.
Importing these pieces starts no command or root.
Each route returns `{ kind: "command", op }`.
Tests call public `run`, supply both writers, and collect their own output:

```ts
import { run } from "@tinker/process";
import { arithmetic } from "./index.ts";

const output: string[] = [];
const errors: string[] = [];
const code = await run({
  shell: arithmetic,
  args: ["double", "21"],
  io: {
    write: (text) => output.push(text),
    error: (text) => errors.push(text),
  },
});
```

`code` is 0 and `output` contains `"42\n"`.

Run the package checks here:

```bash
vp check
vp test
```
