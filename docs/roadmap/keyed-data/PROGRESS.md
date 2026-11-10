# keyed data: build progress

A cell that holds members under keys, on both sides of
the wire. The client asks for a part. `invalidate` marks
a part dirty.

- **Decisions:** ADR 0135 (the mode, the key, the member),
  ADR 0136 (the key at the read; stop at the key),
  ADR 0137 (the client asks; `invalidate`).
- **Glossary:** `docs/glossary.md` (`mode`, `keyed cell`,
  `member`, `part`, `invalidate`).
- **Proofs:** project files, `tinkered/data-family/`.
  They are scratch runs, not tests of this repo.
- **Design page:** <https://claude.ai/artifact/Lt3tGcHQ4vgZ59qyoxRPAu>.

## Drafts the tickets use

Duke saw these on 2026-11-10 and has not said a word
on them yet. A ticket that uses one says so.

- The names `"single"`, `of`, `where`.
- The name `load` for `fill`.
- The server sends a signal with no data.
- The signal names a key or a part.
- The key is given at the write (not read from the
  member).

## Tickets

- **k01 keyed cell on one scope** -- [ ] blocked by: none
  `data({ mode: "keyed", key, parse })` makes a keyed cell.
  Its controller has `set`, `update`, `delete` by key.
  Its reads are all members, `of(key)`, and `where(part)`.
  Verify: tests at the Core entry for the three writes
  and the three reads; a write to one member wakes the
  watcher of that member and of its parts, and no other;
  two keys with the same fields in another order are one
  member; today's `data()` calls compile with no change.

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
  members; the board's `onStart` guard gets the part and
  can refuse it; a client that connects again asks again;
  after the last reader leaves, the server's table of
  readers is empty.

- **k04 invalidate, on both sides** -- [ ] blocked by: k03
  On the client, `invalidate(part)` marks the part dirty
  and asks again. On the server, it sends a signal with
  no data to each reader of the part. A set on a served
  cell marks that key dirty.
  Verify: a signal for a full key makes each reader ask
  for one member; an answer that arrives after a later
  ask started is dropped; `await invalidate(part)`
  resolves after the fresh members are in the cell; a
  client that reads another part gets no signal.

- **k05 load a part from a store** -- [ ] blocked by: k04
  A board takes a `load` for a keyed cell. It gives the
  members of a part. The server keeps no member.
  Verify: the six cases of ADR 0137 as tests, with a fake
  store that answers late; the server holds 0 members
  after each case.

- **k06 the template's todo is keyed** -- [ ] blocked by: k02, k04
  In `tinker-app`: the todo list is a keyed cell. A row
  reads its own member.
  Verify: one toggle sends one member, not the list
  (measure the bytes on the wire for 1,000 todos); a
  toggle renders one row; `bun run check` exits 0.

- **k07 Hedl's tasks board is keyed** -- [ ] blocked by: k05, a release
  In Hedl: the projector calls `invalidate` for each
  notice. The panel reads `where({ project })`. The tasks
  board has no session tag.
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
