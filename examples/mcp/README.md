# MCP search tool

One search operation serves three entries.
MCP is the protocol a client uses to list and call the tool.
The safe demo connects a client and server in memory.
It needs no network, account, or extra process.

## Run in this repo

From the repo root:

```bash
vp install
vp run -r build
cd examples/mcp
vp run start
vp check
vp test
```

`vp run dev` runs the same safe demo.
The output is:

```text
search=["hit:owls"]
```

The client first lists tools, then calls `search` with `q: "owls"`.
The tool returns a list containing `hit:owls`.
The MCP driver maps the list to JSON text.

## Copy and run on its own

The Tinker libraries are not on npm yet.
From the repo root, export this example with their archives:

```bash
vp run example:export -- mcp /tmp/tinker-mcp
cd /tmp/tinker-mcp
vp install
vp run start
vp check
vp test
```

The copy has its own package, config, and library archives.
It needs Node 22.18 or newer and Vite+.
Its package file selects pnpm 12.4.1.

## Serve a client

The server reads protocol messages from stdin.
It writes only protocol replies to stdout.
The standalone server writes errors to stderr.
From this folder:

```bash
vp run serve
```

For a client's launch command, run the entry file directly:

```bash
node --experimental-strip-types serve.ts
```

Set the client's working directory to this example folder.
The server stops when input ends, the transport closes,
or SIGINT or SIGTERM arrives.

The command version uses `@tinker/process`:

```bash
vp run cli -- --help
vp run cli -- mcp
```

A client can launch the command entry directly:

```bash
node --experimental-strip-types cli.ts mcp
```

Both entries expose the same search tool.
A leading `--` from the task runner is allowed.

## Ownership and checks

`search.ts` declares the operation and MCP driver once.
Each root gets a separate server from that driver.
`stdio.ts` owns each transport and its listeners.
Its stop state lives in a data cell.
The entry binds input and output as tags.
It borrows those streams and removes its listeners on close.

The memory demo closes its client in `finally`.
Each root owns its transport cleanup, including a failed start.
The standalone root takes a stop signal and awaits `closed`.
The command entry lets `@tinker/process` own its root.
Imports open no transport and add no process listeners.

`vp test` checks the memory tool list and reply.
It also calls both stdio entries with SDK clients in child processes.
A third check ends the standalone server's input and waits for exit code 0.
The tests use the public exports in `index.ts` and the entry commands.
