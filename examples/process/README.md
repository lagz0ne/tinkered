# Process example

A small command shell built with `@tinker/process`.
It needs Node 22.18 or newer and Vite+ (`vp`).

From this repo, install and build first:

```bash
vp install
vp run -r build
cd examples/process
vp run start
vp run start -- check a.yaml
vp run start -- lazy-check a.yaml
vp run start -- count 3
vp run start -- serve
```

Press Ctrl+C to stop `serve`.
It prints the tick count after its owned work ends.
`dev` runs the same entry as `start`.

To copy this package out, run from the repo root:

```bash
vp run example:export -- process /tmp/tinker-process
cd /tmp/tinker-process
vp install
vp check
vp test
vp run start -- check a.yaml
```

The export includes the unreleased library packages.
Its install uses those copies.

## What it shows

- No command prints help and exits with code 0.
- `check a.yaml` prints `checked a.yaml`.
  It is a demo check; it does not read the file.
- `lazy-check a.yaml` loads its command on selection.
  It prints the same answer as one JSON line.
- A missing or empty file name prints usage with code 2.
- `count 3` streams `1 2 3` and a newline.
  No count uses 3; a non-number prints usage with code 2.
- `serve` ticks every 10 milliseconds until a stop signal.
  Its clock wait is owned by the command.
  A data cell keeps the count; a resource owns cleanup.

`app.ts` declares the command graph once.
`index.ts` exports its static `shell` and starts no process.
`main.ts` calls Process `main(shell)` only inside `if (import.meta.main)`.
That command entry owns the selected command's root, signals, and cleanup.
Tests call the public Process `run` function with `shell`.
The serve test stops after one test-clock tick and checks the final count.

Run the package checks here:

```bash
vp check
vp test
```
