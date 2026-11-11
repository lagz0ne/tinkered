# Start

Tinker is a TypeScript library for apps.
You write the app as a graph of small units.
Core runs the graph, traces each call, and closes it.

## The units

- **operation**: an action. It has a label,
  an input shape, its deps and a `run`.
- **data**: a cell. One value, or members
  under keys.
- **resource**: a thing with a life, such as
  a socket or a timer. It is built once and
  cleaned up on close.
- **tag**: a typed key a capsule reads.
- **capsule**: a feature's one door. It holds
  config, exports and hooks.

## The app

An app is capsules on two sides.

```text
cmds/server.ts   server scope
   |  rpc and remote data
cmds/browser.tsx client scope
```

- Each side is its own scope.
- Each side runs alone.
- The wire between them is rpc and remote
  data.

## Start an app

```bash
bunx degit lagz0ne/tinker-app my-app
cd my-app && bun install
bun run dev
```

## Read next

- [Operation](/guide/operation)
- [Data](/guide/data)
- [Capsule](/guide/capsule)
- [rpc](/guide/rpc)
- [Remote data](/guide/remote-data)
- [The rules](/guide/rules)
