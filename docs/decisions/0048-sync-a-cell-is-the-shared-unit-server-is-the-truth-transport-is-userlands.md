# 0048 Sync: a cell is the shared unit; the server is the truth; the transport is userland's

Date: 2026-09-18. Status: accepted; **amended 2026-09-19 (one way, registration by identity — see the last section)**. Refines: 0034 (tiers: driver), 0040 (a server request is an
inline operation — a sync write is one too), 0042/0046 (config on the scope; static facts ride on
the unit's `meta`), 0006 (the parse is the edge — a snapshot from the wire is raw input).

## Context

Client and server should share the data itself: the same `data` cell module imported on both
sides, kept equal over a wire. Nothing new for the reader of a cell — `useData(counter)` on the
client and `scope.resolve(counter)` on the server keep working; a driver on each side moves values.

**The model analogy is Meteor's DDP:** the server publishes, the client subscribes and receives
snapshots, writes go up as methods, the client applies its own write at once and rolls it back when
the server rejects it (latency compensation), the server is the truth. Ours is simpler: whole cell
values (JSON primitives and records), no documents, no diffs, no merge.

**The wire analogy is the MCP SDK's `Transport`:** `McpServer.connect(transport)` speaks one
message protocol over stdio, SSE, or an in-memory pair. Ours copies that: `@tinker/sync` owns the
messages and the rules; the wire is a `Transport` object userland supplies.

## Decision

1. **A synced cell is a cell with `synced` meta.** `synced({ key })` is a meta tag from
   `@tinker/sync`; a cell declares `meta: [synced({ key: "counter" })]` and stays an ordinary cell
   (its `parse` is the edge on BOTH sides: a snapshot from the wire goes through it). Values must
   survive JSON.
2. **A cell with an id is a family member.** `family({ label, initial, parse?, eq? })` returns
   `(id: string) => Data.Cell<T>`, memoized per id in the module, each member carrying
   `synced({ key: "<label>/<id>" })`. A member is an ordinary cell (presets, `useData`, `watch`
   all work); `family.members()` lists the ids created in this process. No core change (the
   candidate "a cell family in core" is core feedback, one asker).
3. **The published set is scope config.** `sync(cell | family)` binds on the scope; the drivers
   read `scope.resolve(sync.all)`. A family is published whole: every member the server holds goes
   down (DDP publishes a collection); per-member subscription needs a "first watcher" hook core
   does not have (`scope.onMount`, core feedback, one asker — decided to wait, 2026-09-18).
4. **The server is the truth; last-writer-wins by version.** `syncServer(scope)` returns
   `{ connect(transport) }`. A connect opens a session (like a request): every published value
   goes down as `snapshot { key, version, value }`; a `set { id, key, base, value }` runs as an
   inline operation `sync set <key>` (span, one `sync set` log line): the cell's parse, then
   `base === version` → apply, `version + 1`, `ack`, fan out to every session; otherwise
   `reject { id, key, version, value }` with the current truth. A parse failure rejects too. The
   session closes when the transport closes.
5. **The client applies snapshots and writes optimistically.** `syncClient(scope, transport)`
   writes each snapshot into the cell through its parse (creating family members with
   `family(id)`), watches every published cell, sends a local change as `set` with the last seen
   version, and on `reject` reverts to the server's value. Reads and writes stay the core verbs.
6. **Transports are userland's.** `Sync.Transport = { send(message), onMessage(fn) → unsubscribe,
onClose(fn) → unsubscribe, close() }`. The package ships only `memoryPair()` (the test seam and
   the reference). SSE + POST over Hono and WebSocket are README recipes.
7. **One package, one entry.** Both drivers import only `@tinker/core`; nothing server-only
   remains, so `@tinker/sync` has one entry (Q4's three entries assumed Hono on the server side).

```text
shared:  const counter = data({ label: "counter", initial: 0, parse, meta: [synced({ key: "counter" })] })
         const todo = family({ label: "todo", initial: "", parse })          todo("7") → a cell
server:  createScope({ tags: [sync(counter), sync(todo)] }); syncServer(scope).connect(transport)
client:  createScope({ tags: [sync(counter), sync(todo)] }); syncClient(scope, transport)
wire:    snapshot ↓ · set ↑ · ack/reject ↓         (userland: memoryPair | SSE+POST | WebSocket)
```

## Consequences

- One declaration, two processes, no wrapper: React's `useData` and the server's `resolve` are
  untouched; the drivers write the same cells.
- Seam tests need no sockets: `memoryPair()` links a client scope to a server scope in one test.
- The client driver must tell its own snapshot write from a local write inside `watch` (it
  compares to the last applied value with the cell's `eq`); if that proves fragile it is the
  second asker for a write-origin signal in core.
- Size cap 10 kB gzip; runtime import only `@tinker/core`; mutation ≥ 60.

## Alternatives rejected

- **CRDT merge (Y.js)** — no conflicts, but a document model and a heavy dependency for primitives.
- **A `syncStore({ cells })` frame owning its own cells** — a second cell kind; the meta rule wins.
- **Built-in SSE/WebSocket transports** — the user wants the wire configurable; recipes suffice.
- **`scope.onMount` now** — one asker; the whole-family publish is a real design, not a workaround.

## Amendment 2026-09-19 — v1 is one way; the viewer registers what it looks at

The user's concept, restated: a **source** is a scope with the source extension; each client knows how
to connect to its source (that is the protocol, userland's transport); depending on the client's
**registration** the data set is delivered initially and then synced as it changes on the source;
matching is by **family and identity** (the key `label/id`). Writes from the client are a later version.

- `source(scope)` returns `{ connect(transport) }` (replaces `syncServer`); `subscribe(scope, transport)`
  returns `{ close() }` (replaces `syncClient`). Decision §4 (writes, LWW, ack/reject) and §5 (optimistic
  writes, revert) are withdrawn for v1; §1–§3 and §6–§7 stand.
- The wire has two messages: `register { keys }` (client → source) and `snapshot { key, version, value }`
  (source → client). `set`/`ack`/`reject` are gone.
- **Registration is the client's `sync(...)` bindings, by identity:** at connect the client registers every
  bound singleton key and every family member it already holds; a member created later (`todo("7")`
  first called, e.g. by `useData`) is registered the moment it exists (`family.onMember`). Nothing is
  pushed unasked: the source keeps a key set per transport and fans a change out only to the transports
  registered for that key. A registered member the source does not hold yet is created there with its
  initial value. This replaces "a family is published whole" (§3).
- Each `register` runs on the source as an inline operation `sync register` (span, one `sync register`
  log line with the key count) inside the subscriber's session; a key that is not published, or a
  message in the wrong direction, closes the transport (protocol violation, as before).
- A userland write on a client cell stays local in v1 (the next snapshot overwrites it); the README says so.
- Unregister waits for `scope.onMount` (a member is memoized for the process's life); the core-feedback
  candidate stands with one asker.
