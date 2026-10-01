# Tinkerer entries

Two agents share one graph and keep separate conversation data.
The default command uses a local HTTP backend.
It reads a streamed reply through the same code as a live run.
It needs no token, network, or file access.

## Run in this repo

From the repo root:

```bash
vp install
vp run -r build
cd examples/tinkerer
vp run start
vp check
vp test
```

`vp run dev` runs the same safe demo.
Both agents return `Hello from the demo.` with token counts.
The example uses no agent tools.

## Copy and run on its own

The Tinker libraries are not on npm yet.
From the repo root, export this example with their archives:

```bash
vp run example:export -- tinkerer /tmp/tinker-tinkerer
cd /tmp/tinker-tinkerer
vp install
vp run start
vp check
vp test
```

The copy has its own package, config, and library archives.
It needs Node 22.18 or newer and Vite+.
Its package file selects pnpm 12.4.1.

## Use a live service

Use a service that accepts streamed Chat Completions requests.
Set its values in these environment variables:

- `TINKERER_API_KEY`: the service's API key.
- `TINKERER_BASE_URL`: the URL before `/chat/completions`.
  Tinkerer adds `/chat/completions`.
- `TINKERER_MODEL`: the model name from that service.
- `TINKERER_PROMPT`: the prompt for both agents.
  If absent, it uses `Say hi in five words.`

From this folder, run:

```bash
vp run live
```

This command makes two live requests and uses your account.
It prints each final reply and its token counts.
Missing or invalid settings fail before a request is sent.
An `InvalidSettings` error lists field names, never values.
The code has no default account, model, or token file.

## Code and checks

- `coder.ts` declares the graph and both namespaces once.
- `settings.ts` checks live inputs before a root is made.
- `real.ts` owns the live root inside `if (import.meta.main)`.
  Config tags carry model, URL, key, and each agent's system prompt.
  Namespaces split the two agents' conversation state.
  Tinkerer data holds text and token counts.
  The root stops and waits for `closed` in `finally`.
  A failed close is reported if the run itself did not fail.
- `demo.ts` owns the local root inside `if (import.meta.main)`.
  Both entries stop on SIGINT or SIGTERM and remove their listeners after cleanup.
- `recorded.ts` supplies the local HTTP backend.
  It returns valid stream chunks and never opens a socket.
- `index.ts` exports the graph, namespaces, backend, settings reader, and error guard.
  Imports start no entry and read no environment variables.

Tests build their own small roots from the units in `index.ts`.
Two streamed replies keep separate conversation data without an account.
Missing live settings fail before a request and report only field names.
