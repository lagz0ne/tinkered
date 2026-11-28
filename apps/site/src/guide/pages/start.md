# Start

Tinker is a TypeScript library for apps.
An app is capsules: you build capsules, and you
use other capsules. Core runs them, traces each
call, and closes them.

## The units

- **capsule**: a feature's config, exports and
  hooks. The units below live inside one.
  Code reaches them through the install:
  `const tide = sea({ size: 4 })`, then
  `tide.press`.
- **operation**: an action. It has a label,
  an input shape, its deps and a `run`.
- **data**: a cell. One value, or members
  under keys.
- **resource**: a thing with a life, such as
  a socket or a timer. It is built once and
  cleaned up on close.
- **tag**: a typed key a capsule reads.

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
