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

| tag      | ticket                                                                                                  | blockers | status |
| -------- | ------------------------------------------------------------------------------------------------------- | -------- | ------ |
| sync/t01 | Package: `synced` meta, `family`, `sync` binding tag, `Sync.Message`/`Sync.Transport`, `memoryPair()`   | —        | [x]    |
| sync/t02 | `syncServer(scope).connect(transport)`: session per transport, snapshots, `sync set <key>`, fan-out     | t01      | [x]    |
| sync/t03 | `syncClient(scope, transport)`: snapshots through parse, optimistic sets, revert on reject              | t02      | [x]    |
| sync/t04 | Validation milestone: lanes, mutation, README recipes (Hono SSE+POST, WebSocket, React), archive        | t03      | [x]    |
| sync/t05 | One way, registration by identity: `source` + `subscribe` replace `syncServer`/`syncClient` (amendment) | t04      | [x]    |
| sync/t06 | Source/subscribe installed as extensions; ready is the initial data set (ADR 0050)                      | core/t32 | [x]    |
| sync/t07 | Public seam coverage after t06; isolated mutation ≥ 70                                                  | t06      | [x]    |

### Landed

| tag      | sha     | tests | size (B gzip) | mutation | notes                                                                                                                                                                                                               |
| -------- | ------- | ----- | ------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sync/t01 | 7f25563 | 8     | 1429          | 80.60    | writer-built, no fix round; `family` from `data()` + a Map, nothing from core; impact chain: plan under-declared 3 symbols (corrected below).                                                                       |
| sync/t02 | b6bd197 | 17    | 2839          | 77.89    | writer-built (one death, one fix round); the truth is written through the scope handle (a session shadows writes); one watcher per key bumps the version and fans out.                                              |
| sync/t03 | 2a96f01 | 27    | 3697          | 68.18    | writer-built, one fix round (shared `readPublished` registry); `applying` flag = write origin; impact chain: neither.                                                                                               |
| sync/t04 | e290944 | 34    | 3697          | 78.32    | validation milestone: four lanes (37), `examples/hono.ts` SSE+POST recipe with a seam test through `app.request`, six client edge tests, README pass. Writer-built, no fix round.                                   |
| sync/t05 | cf01bbb | 20    | 3324          | 73.53    | one way: `source` + `subscribe`, `register { keys }`, a key set per subscriber, `sync register` op; the write path deleted; stryker `inPlace` so the recipe test (root examples) loads. Writer-built, no fix round. |
| sync/t06 | 6409128 | 21    | 4066          | 62.34    | both engines are core extensions (ADR 0050); tracked in `docs/roadmap/extensions-v1/PROGRESS.md`.                                                                                                                   |
| sync/t07 | 3a6ae72 | 28    | 4066          | 78.06    | Tests only; one lead fix round; full gate and isolated mutation green. Review and old/new SCIP tables in extensions-v1/PROGRESS.md.                                                                                 |

### Impact blocks (ADR 0047)

Examples live at `examples/<pkg>/` (outside the package's SCIP index) since 2026-09-19, so blocks list `src/` and `tests/` files only.

```impact sync/t01
sync  synced      src/index.ts tests/sync.test.ts examples/basic.ts
sync  sync        src/index.ts tests/sync.test.ts examples/basic.ts
sync  family      src/index.ts tests/sync.test.ts examples/basic.ts
sync  readSynced  src/index.ts tests/sync.test.ts examples/basic.ts
sync  isFamily    src/index.ts tests/sync.test.ts
sync  memoryPair  src/index.ts tests/sync.test.ts examples/basic.ts
sync  Sync        src/index.ts tests/sync.test.ts
sync  raise       src/errors.ts src/index.ts
sync  isError     src/errors.ts src/index.ts tests/sync.test.ts
sync  Errors      src/errors.ts src/index.ts
```

```impact sync/t02
sync  syncServer  src/index.ts tests/sync.test.ts examples/basic.ts
sync  onMember    src/index.ts tests/sync.test.ts
```

```impact sync/t03
sync  syncClient  src/index.ts tests/sync.test.ts examples/basic.ts
```

```impact sync/t05
sync  source      src/index.ts tests/sync.test.ts
sync  subscribe   src/index.ts tests/sync.test.ts
sync  syncServer  (none)
sync  syncClient  (none)
```

```impact sync/t04
sync  syncServer  src/index.ts tests/sync.test.ts examples/basic.ts examples/hono.ts
sync  syncClient  src/index.ts tests/sync.test.ts examples/basic.ts
```

## Review loop

The lead reviews every ticket (diff vs ADR rows, convention, one promise per test, gate re-run, SCIP
refs, `node scripts/jev/impact.mjs <tag>`), cherry-picks, runs the mutation lane alone, tags. Reports
end with **Core feedback**.
