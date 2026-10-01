# Harness examples

Run two recorded agents without an account.
Each agent keeps its own conversation and streamed text.
The first reply becomes the second agent's prompt.
The example uses a local adapter and makes no network call.

## Run in this repo

From the repo root:

```bash
vp install
vp run -r build
cd examples/harness
vp run start
vp check
vp test
```

`vp run dev` runs the same safe example.
Each entry runs inside `if (import.meta.main)`.
Importing an entry or `index.ts` starts no work and loads no agent SDK.
`index.ts` exports the local graph for tests that own their roots.

## Copy and run on its own

The Tinker libraries are not on npm yet.
From the repo root, export this example with their archives:

```bash
vp run example:export -- harness /tmp/tinker-harness
cd /tmp/tinker-harness
vp install
vp run start
vp check
vp test
```

The copy has its own package, config, and library archives.
It needs Node 22.18 or newer and Vite+.
Its package file selects pnpm 12.4.1.

## Live examples

These commands use a real SDK and your account.
Run them from this folder with auth already set up.
They use the current folder as the working directory.

- `vp run claude`: Claude Code streams a short reply.
- `vp run codex`: Codex streams a short reply.
- `vp run tools`: Claude Code may call the search tool.
  The tool reads an index name from its session tag.
- `vp run approvals`: Claude Code asks to list files.
  The policy allows Read and denies other approval requests.
- `vp run services -- "Read octocat/Hello-World."`:
  Claude Code reads GitHub and Cloudflare through two tools.
  See [the service example](SERVICES.md) for token setup.

The graphs are declared once.
Tags carry fixed settings; Harness data holds turn state.
Each root has a stop signal and waits for `closed` in `finally`.
Ctrl+C lets the current reply finish and prevents the next call.
The entry waits to stop its root until the current reply ends.
A second Ctrl+C quits at once.
SIGTERM also waits for the current reply before stopping.
A failed close is reported if the run itself did not fail.
Claude Code and Codex print each new text chunk once.

## Checks without accounts

`vp test` checks the local reply and the service entry's arguments.
It also runs six service checks with a recorded SDK and HTTP backend.
The checks call the public exports in `index.ts`.

- The example keeps each conversation and its text in its own namespace.
  The first reply becomes the second prompt.
- A lone task separator is rejected as a missing prompt.
  Missing tokens stop the entry before it can load the SDK.
- The agent reads two service URLs with separate tokens.
  Each tool returns only the parsed fields.
- Two turns reuse one SDK server and resume one conversation.
- Closing one root leaves the same graph usable in another root.
- The root shares cwd and exposes only two service tools.
  It denies extra approval requests.
- Bad response fields and Cloudflare failure replies are rejected.
- A non-2xx reply fails before its body is read.

The checks make no live account calls.
