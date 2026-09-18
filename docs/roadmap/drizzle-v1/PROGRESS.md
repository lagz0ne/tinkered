# drizzle v1 — build progress

The second dedicated capability: a Drizzle store whose client is a scope resource and whose
transaction is a session resource — commit on the session's `success`, rollback otherwise (ADR
0041). New package `packages/drizzle` (`@tinker/drizzle`), `drizzle-orm` peer (types only at
runtime), PGlite as the real test database, size cap 10 kB gzip, no core change.

- **Decision:** `docs/decisions/0041-drizzle-transaction-is-a-session-resource.md`.
- **Glossary:** `docs/glossary.md` → "Drizzle store" (`store`, `tx` resource, `db query`, `core feedback`).
- **Gate + tag:** `scripts/ticket.sh drizzle <NN> "<title>"` → `drizzle/t<NN>`; validate lanes at t02.
- **Core feedback:** `docs/roadmap/core-feedback.md` (savepoints need "inherit the parent session's instance").

## Order & status

| tag         | ticket                                                                                                                     | blockers | status |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| drizzle/t01 | Package + frame: `config` tag, scope `db` (open/close by defer), session `tx` (commit/rollback by outcome), query log line | —        | [x]    |
| drizzle/t02 | Validation milestone: size, mutation ≥ 60 alone, README + cast-free example, validate lanes; SHIP                          | 01       | [x]    |

### Verify

- **t01** — with PGlite (`drizzle(new PGlite(), { schema, logger })` in `open`, table created in `open` via
  `db.execute(sql\`create table …\`)`for the test schema, or in a fixture through`store.db`):
(1) `store.db`opens once per scope (two ops, one`open`) and `close(db)`ran on`scope.close()`(a
counter, and`db.$client.closed === true`); (2) an op in a `scope.session(fn)`that inserts via`tx`→ after the session resolves, a root-level read via`store.db`sees the row (commit on`success`); (3) the same with a throwing op → the row is absent (rollback on `failed`) and
`session()`rejected with the op's error; (4) an op parked on`clock.sleep(…, signal)`after its
insert + a forced`scope.close()`→ the row is absent (rollback on`cancelled`); (5) two
sequential sessions get two transactions (a counter on `db.transaction`calls) — never held open
concurrently (PGlite is single-connection); (6) no`config`binding →`MissingTag`with the tag's
label; (7) with`observe.log`, one `db query`entry per statement carrying`sql`and no params
(insert a value like`"secret"`and assert it does not appear in any log entry); (8) at the root
(no session)`tx`builds at the root and commits at`scope.close()`.
  - _Landed (t01 169baa9 mutation 96.49; t02 on the validate-gate commit): 21 lanes green; size 1959 B;
    README gained the cheap-to-import rule and the async-dep note at review. **SHIPPED.**_
- **t02** — `vp run drizzle#size` ≤ 10240; `vp run drizzle#mutate` alone ≥ 60; README (the frame,
  an op that writes, the outcome rule, the one-transaction-per-request rule, the PGlite test recipe) +
  cast-free `examples/basic.ts`; `pnpm validate` gains drizzle lanes (tests, size, cast-free, pure
  bundle — `drizzle-orm` types only, no `node:`); lead review SHIP; TODO archive entry.

## Review loop

The lead reviews every ticket (diff vs ADR rows, convention shape rules, one promise per test, gate
re-run, SCIP refs for public symbols), then cherry-picks, runs the mutation lane alone, tags. Every
report ends with **Core feedback**.
