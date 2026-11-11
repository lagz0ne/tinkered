# keyed data: build progress

A cell that holds members under keys, on both sides of
the wire. The client asks for a part. `invalidate` marks
a part dirty.

- **Decisions:** ADR 0135 (the mode, the key, the member),
  ADR 0136 (the key at the read; stop at the key),
  ADR 0137 (the client asks; `invalidate`),
  ADR 0138 (the key comes from the member; the review
  answers).
- **Glossary:** `docs/glossary.md` (`mode`, `keyed cell`,
  `member`, `part`, `invalidate`).
- **Proofs:** project files, `tinkered/data-family/`.
  They are scratch runs, not tests of this repo.
- **Design page:** <https://claude.ai/artifact/Lt3tGcHQ4vgZ59qyoxRPAu>.

## Answers the tickets use

Duke accepted every pick of the review page on
2026-11-10 23:49 UTC. ADR 0138 holds them.

- The names `"single"`, `of`, `where`, and `load`.
- The key comes from the member: `key` is a function.
- The server sends a signal with no data. It names a
  key or a part.
- The guard runs at each ask.
- A served keyed cell lives at the root only.

Not decided: an order with a limit. Hedl's Tasks panel
reads the newest 50 tasks. Decide it before k07.

## Tickets

- **k01 keyed cell on one scope** -- [ ] blocked by: none
  `data({ mode: "keyed", key, parse })` makes a keyed cell.
  `key` is a function that reads the key from a member.
  Its controller has `set(member)`, `update(key, fn)`,
  `delete(key)`, and the reads `of` and `where`.
  Its reads are all members, `of(key)`, and `where(part)`.
  A read gives plain members.
  Verify: tests at the Core entry for the three writes
  and the three reads; a write to one member wakes the
  watcher of that member and of its parts, and no other;
  two keys with the same fields in another order are one
  member; an `update` of a key that is not there is a
  named error, and so is an `update` whose result has
  another key; a key with `NaN` is refused; an op reads
  one member through the controller; today's `data()`
  calls compile with no change.

- **k02 React reads by key** -- [ ] blocked by: k01
  `useData(cell.where(part))` and `useData(cell.of(key))`
  take the key at each render.
  Verify: a browser test: two panels read two parts of one
  cell; a write to one part renders only its panel; a
  panel that changes its part leaves the old one; the
  scope holds no more units after 1,000 different keys.

- **k03 a client asks for a part** -- [ ] blocked by: k01
  `remoteData` serves a keyed cell. The first reader of a
  part joins it and asks. The server answers from its
  cell. The last reader leaves the part.
  Verify: on the memory transport and on the WebSocket:
  two clients read two parts and each gets only its
  members; the board's guard gets the part at each ask
  and can refuse it; a served keyed cell in a session
  layer is refused; a client that connects again asks
  again; after the last reader leaves, the server's table
  of readers is empty and the client's part is dropped.

- **k04 invalidate, on both sides** -- [ ] blocked by: k03
  On the client, `invalidate(part)` marks the part dirty
  and asks again. On the server, it sends a signal with
  no data to each reader of the part. A set on a served
  cell marks that key dirty.
  Verify: a signal for a full key makes each reader ask
  for one member; an answer that arrives after a later
  ask started is dropped; `await invalidate(part)`
  resolves after the fresh members are in the cell; a
  client that reads another part gets no signal; two keys
  of one part in one pass make one signal for the part.

- **k05 load a part from a store** -- [ ] blocked by: k04
  A board takes a `load` for a keyed cell. It gives the
  members of a part. The server keeps no member.
  The input type of the `load` says which fields a part
  must have.
  Verify: the six cases of ADR 0137 as tests, with a fake
  store that answers late; the server holds 0 members
  after each case; an ask for a part with fewer fields
  than the `load` needs is refused before the guard; the
  guide for a projector has the rule of the cut log.

- **k06 the template's todo is keyed** -- [ ] blocked by: k02, k04
  In `tinker-app`: the todo list is a keyed cell. A row
  reads its own member.
  Verify: one toggle sends one member, not the list
  (measure the bytes on the wire for 1,000 todos); a
  toggle renders one row; `bun run check` exits 0; the
  README says that a store with no notices tells a second
  client only through the op.

- **k07 Hedl's tasks board is keyed** -- [ ] blocked by: k05, a release, the order decision (ADR 0138)
  In Hedl: the projector calls `invalidate` for each
  notice. The panel reads `where({ project })`. The tasks
  board has no session tag.
  The panel reads the newest 50 tasks today, and the
  board's value has `engine` and `lease_minutes` too.
  A part has no order and no limit: decide first.
  Verify: the e2e flows pass; a task change sends one
  member to a reader of that project; a reader of
  another project gets nothing.

- **k08 Hedl's checks and Inbox boards are keyed** -- [ ] blocked by: k07
  The two other boards move the same way.
  Verify: the e2e flows pass; no board in Hedl uses
  `config`.

- **k09 the keyed board of remoteData goes** -- [ ] blocked by: k08
  `remoteData` loses `config` and its session tags
  (ADR 0135, Consequences).
  Verify: no caller in `tinker-app` or Hedl; Core's tests
  and mutation floor hold.

## k01 keyed cell on one scope

Owner: thread "Build keyed data in Core".
Writer and lead: Claude Opus 5.5, in one session.

### Impact before code

- `data` gets a second overload: `mode: "keyed"`.
  The old call shape keeps its type. No caller changes.
- `Data.Cell` gets `mode: "single" | "keyed"`.
  Only `data()` makes a cell, so no caller builds one.
- `scope.controller`, `Starting.controller` and the
  `depends` slot type learn `Data.Keyed`. A plain cell
  still maps to `DataController`.
- React, remoteData, tinker-app and Hedl read
  `Data.Cell` only. A keyed cell is a `Data.Cell` of a
  list, so each reads it as all members.
- New errors: `MissingMember`, `KeyChanged`,
  `InvalidKey`. No old path raises them.

### Shape

- The value of a keyed cell is a plain list of members.
  Every single-cell path carries it as is: layers,
  namespaces, presets, write hooks, capsule views.
- Core keeps an index per value (a `WeakMap`): the
  members by key text, and the one key that the last
  write changed.
- The keyed controller wraps the plain controller of
  the cell. A write is one plain `set` of a new list.
- A reader from `of` or `where` joins its part on its
  first watcher and leaves it on its last. The plain
  watch under them ends with the last part.
- A write that one step made from the last value
  visits the 2^d parts of its key. Any other change
  (a preset, a value of a layer) visits each part.

### Proof

- `tests/keyed-data.test.ts`: 23 tests at the Core
  entry. Core: 1,237 tests pass.
- Mutation on the new lines alone (scoped Stryker):
  91.15 (174 killed, 16 survived, 1 timeout).
  The first run was 71.35; the tests that killed the
  rest name real promises (a write during a write, a
  stop called twice, the last part leaving).
- Survivors left are the same answer by another road:
  the string-key branch of the key text, the extra
  mask of the 2^d loop, the id counter going down.
- `scripts/check-slots.mjs`: headroom still 2. The
  new classes sit after the release block.

### Size

- Main `6d11994`: 19,350 B gzip for Core without rpc.
- With k01 and k02: 20,600 B. The old cap was 20,480 B.
- The cap is now 21,504 B (+1 KiB), in
  `scripts/check-core-entries.mjs`. A second mode of
  `data` is new code; Duke set size as not a goal
  (2026-11-01).

## k02 React reads by key

- `tasks.of(key)` and `tasks.where(part)` on the cell
  give a `Data.Read`. It names the cell and the part,
  and makes no unit.
- `useData(read)` reads it through the keyed
  controller of the nearest scope.
- A part in use hands back the reader that joined it.
  So the hook gets the same reader, and the same store,
  at each render of the same part.
- Proof: `packages/react/tests/use-data-keyed.test.tsx`,
  3 browser tests. A write to p1 renders the p1 panel
  once and the p2 panel not at all. A panel moved over
  1,000 keys leaves each old part: a late write to the
  first key renders nothing, and its reader is gone.
- React's mutation lane runs no tests (known, card in
  `TODO.md`), so it has no number here.
