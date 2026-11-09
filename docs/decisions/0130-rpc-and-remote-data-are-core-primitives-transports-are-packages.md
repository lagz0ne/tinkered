# 0130 rpc and remoteData are Core primitives; transports are packages

Date: 2026-11-09. Status: accepted; not built yet
(card `core/rpc`).
Accepted: Duke, 2026-11-09, decisions 1 and 4
(thread "Make Tinker AI-first via lint, analysis, runtime").
Decisions 2, 3 and 5 are the lead's picks; Duke can change
them.
Replaces: tinker-app `docs/decisions/remote-data-and-rpc.md`,
the part "userland, not Core".
Its other decisions hold: faults, lifecycle hooks, keyed
reads, the protocol options.

## What the user said

- 07:07: devtools and the other template components can be
  packages; "Components meant to be before we matured the
  capsule concept".
- 08:23: "Rpc and remote should be in core actually".
- 08:46: "don't make it subpath, it is a primitive (along
  with remoteData), as a part of the main core. others are
  packages."
  The transport under rpc is its own package, "developed and
  shared like authoring model rather than being rebuilt all
  the time".

## Context

- rpc and remoteData live in tinker-app as copied source.
- Hedl's copies differ from the template by 0 lines.
- A transport is already a capsule pair:
  - the client side exports `call` and `watch`;
  - the server side exports `serve` and `serveStream`.
- The memory transport has no imports.
  The ws transport imports `bun`.
- Core has 0 dependencies.
  rpc, protocol and remoteData use zod (62 places).

## Precedent

- **Connect RPC.** The client takes a `Transport`.
  `createConnectTransport` and `createGrpcWebTransport` are
  separate packages.
- **MCP SDK.** One `Transport` interface; stdio and HTTP
  implement it.
- **tRPC links.** The router is core; each link is a package.
- **Standard Schema.** One spec that zod, valibot and arktype
  implement.
  tRPC and TanStack Form accept any of them with no
  dependency.

## Decision

1. **Two new primitives in the main export.**

   ```ts
   import { rpc, remoteData } from "@tinker/core"
   ```

   Their shape is the one tinker-app has today.

2. **The protocol comes with them.**
   Wire shapes, faults, codec and lifecycle hooks are Core
   code.
3. **The transport contract is a Core type.**
   A transport is a capsule pair:
   - client exports `call` and `watch`;
   - server exports `serve` and `serveStream`.
     Core types each op; a package implements them.
4. **Transports are packages.**
   - memory: no imports, for tests.
   - Bun WebSocket, SSE: one package each.
     An app picks one in its cmd.
5. **Schemas by Standard Schema.**
   A contract's `input` and `output` take any Standard
   Schema value.
   Core keeps 0 dependencies.
   zod contracts keep working.

## Consequences

- tinker-app and Hedl drop `protocol`, `rpc`, `remote-data`
  and `memory` from `tinker/components/`.
- A transport author writes one capsule pair and its tests.
  rpc is not rebuilt for each link.
- Core's API grows by two names.
  Each needs a glossary row and a test file.
