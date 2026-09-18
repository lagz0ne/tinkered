# sync v1 — build progress

A cell is the shared unit; the server is the truth; the transport is userland's (ADR 0048).
Package `packages/sync` (`@tinker/sync`), runtime import only `@tinker/core`, one entry, size cap
10 kB gzip, no core change.

- **Decision:** `docs/decisions/0048-sync-a-cell-is-the-shared-unit-server-is-the-truth-transport-is-userlands.md`.
- **Glossary:** `docs/glossary.md` → "Sync".
- **Gate + tag:** `scripts/ticket.sh sync <NN> "<title>"` → `sync/t<NN>`; validate lanes at the milestone.
- **Core facts:** `data({ label, initial, parse?, eq?, meta? })` → `Data.Cell<T>` (`label`, `initial`, `parse`,
  `eq`, `meta`, `controller`); `scope.controller(cell)` → `{ get, set, update, watch }`; `tag.read(cell)`;
  `scope.resolve(tag.all)`; `scope.session(fn)` / `createSession`; an inline op `s.run({ label, depends, run })`
  with `rawInput`; `isError(e, "DataValidationFailed")`.

## Order & status

| tag      | ticket                                                                                                | blockers | status |
| -------- | ----------------------------------------------------------------------------------------------------- | -------- | ------ |
| sync/t01 | Package: `synced` meta, `family`, `sync` binding tag, `Sync.Message`/`Sync.Transport`, `memoryPair()` | —        | [ ]    |
| sync/t02 | `syncServer(scope).connect(transport)`: session per transport, snapshots, `sync set <key>`, fan-out   | t01      | [ ]    |
| sync/t03 | `syncClient(scope, transport)`: snapshots through parse, optimistic sets, revert on reject            | t02      | [ ]    |
| sync/t04 | Validation milestone: lanes, mutation, README recipes (Hono SSE+POST, WebSocket, React), archive      | t03      | [ ]    |

### Landed

| tag | sha | tests | size (B gzip) | mutation | notes |
| --- | --- | ----- | ------------- | -------- | ----- |

### Impact blocks (ADR 0047)

```impact sync/t01
sync  synced      src/index.ts tests/sync.test.ts
sync  family      src/index.ts tests/sync.test.ts
sync  sync        src/index.ts tests/sync.test.ts
sync  memoryPair  src/index.ts tests/sync.test.ts
```

## Review loop

The lead reviews every ticket (diff vs ADR rows, convention, one promise per test, gate re-run, SCIP
refs, `node scripts/jev/impact.mjs <tag>`), cherry-picks, runs the mutation lane alone, tags. Reports
end with **Core feedback**.
