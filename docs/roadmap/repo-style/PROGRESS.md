# Repo style work

## repo/no-import-extensions

Owner: lead (Claude, Start scaffold session); Codex writer.
Branch: `repo/no-import-extensions`.
The lead fix round is saved in Review.
Both Start cards are in main at `381e2ef3`.
No push, publish, or mutation run in this round.

- Rebased and kept main's new registry source.
  The cleanup script ran across the whole repo.
- The parser now reads plain module names under `seams`.
  It also decodes JSON held inside receipt strings.
  File paths and copy targets keep their endings.
- The registry's copied test imports omit TS endings.
- Doctor builds todos suggestions from the real registry item.
  The old main item fails the no-ending check.
  The fixed item passes all nine example tests.
- The saved text check rejects TS module endings after
  `from` or `import` in docs, JSON, and templates.
  It also rejects seam `from` fields and decoded receipts.
  Assets, query imports, and file targets pass.
- `pnpm validate` runs the check and its behavior tests.
- The full strict census has old hits.
  Compare its counts with main; do not widen this fix round.
- Proof files keep headers and summary lines only.
  The final gate codes are in `no-import-extensions-proof.json`.

### Gate summary

- Every ordered gate returned 0.
- Check found zero errors and 28 warnings.
- Root tests: 1,855 passed; one old React test skipped.
- Start: 404 passed, including nine doctor example tests.
- Writer trial: 93 passed.
- Cleanup and saved text tests: five passed.
- All 18 validate lanes passed.
- Registry: 10 items; 90 emitted files match source.
- The real-service scaffold proof passed and stopped its processes.
- The cleanup script wrote nothing on its second run.
- Census S17 has zero hits.
  Strict census has 89 old hits on the same files on main.
  This round adds none.

### Path summary

- Fixed 781 kept module path strings.
  The first pass fixed 566.
  The parser extension fixed 212 more.
  Three copied-test replacement strings changed too.
- Public registry JSON: 644.
- Source registry metadata: 84.
- Templates: 25.
- Scaffold README: seven.
- Registry proof scripts: four.
- Registry source generator: three.
- Start doctor test receipts: 13.
- Start proof doc: one.
- Cut full output from the touched old proof log.
  Its 101 ending-bearing entries were removed with that output.
- Cut the old full label outputs from this card's proof JSON.
  The case bank remains separate from proof logs.

Next: the lead reviews this round.
No new Core feedback.

## repo/fast-code-rules

Owner: lead (Claude, Start scaffold session); Codex writer.
Branch: `repo/fast-code-rules`.
Saved for lead review; no push or publish.

- Added F1–F14 and A1–A6 to the coding skill.
  Each rule names its evidence report.
- Added `docs/fast-code.md`: one bad and good example per rule.
  It lists the study reports and the tools for each check.
- Added inline budget, megamorphic, microtask turn, and context slot to the glossary.
  The writer brief points at the rules.
- Added five checks and seven tiny parser tests to `pnpm validate`.
  Baselines are in `scripts/fast-code-baseline.json`.
  Lower values pass; a rise needs a reviewed baseline edit.
  A missing inline edge always fails.
- The new lane passed in 7.25 seconds of check work.
  Its parser tests took 0.13 seconds.
  Child jobs share a 55-second limit.
  These are check runtimes, not a code speed claim.
- Every planted break returned 1; each original returned 0.
  Temp copies were removed.
  Slots: 341 → 342; runOnce: 502 → 512 bytes.
  Constructor growth removed the inline edge.
  An arrow raised runOnce closures from zero to one.
  A mapped zod module raised client chunks from zero to one.
- Existing rule gaps stay as found.
  Core reaches module slot 341, past 255.
  runOnce is 502 bytes, past 460; it stays its own root by design.
  buildHooklessResource has three function literals.
  runHookChain has two; stepRunHook has one.
  The case study owns the fix plans.

### Gate proof

- Fetch and rebase, install, build: exit 0.
- Check: exit 0; zero errors, 28 old warnings.
- All workspace test tasks: exit 0.
- Prose and scaffold check: exit 0.
- Validate: exit 0; all 19 lanes pass.
- Parser tests: seven pass.
- Jev: exit 0; no changed TypeScript source to judge.
- Census: exit 0; no changed TypeScript files to count.
- No benchmark verdict or mutation run, as the card allows.
  No Core or Start source changed.
- Full counts, check times, and breaks are in
  [the proof](fast-code-rules-proof.json).

### Assumptions and limits

- Node v24.21.0 and V8 13.6.233.17-node.53 pin bytecode.
  A new engine needs fresh reviewed baselines.
- Start ships source, so only Core and React have module-slot baselines.
- Client checks use hidden source maps from a fresh start-min build.
  Missing chunks or maps fail.
- Function-literal counts include defaults and constructor fields.
  They stop at each nested function body.
  They do not prove zero runtime allocations.
- No new Core feedback.

Next: the lead reviews the rules and saved baselines.

### Engine review round

- Only F1 bytecode and F1/F2 inlining need a matching engine.
  F9 slots, F6 function literals, and F13 client chunks still run.
- The engine mismatch now names one recovery command:

  ```bash
  node scripts/check-fast-code.mjs --rebaseline-engine
  ```

- Recovery writes only Node, V8, and F1 bytecode fields.
  Each hot function prints old → new.
  A rise above 460 fails before the baseline file is written.
  The existing 502-byte runOnce root may stay or fall; it cannot rise.
  The constructor must still inline with default Maglev.
  The saved inline expectation stays true.
- Two new fixture tests pass; nine parser tests pass in all.
  The fixture changes an engine and raises and lowers bytecode counts.
  Other saved fields stay the same.
  Above-limit growth and a lost inline promise fail.
- The engine-mismatch break plants rises in F9, F6, and F13 together.
  All three fail on their own rule, not on the engine check.
  Both engine checks fail and print the recovery command.
  Recovery returns 0; the restored full check returns 0.
- A refused runOnce rise returns 1 and leaves the file unchanged.
  The old runner rejects the recovery option with exit 1.
  All five earlier break proofs still pass.
  Temp copies were removed; the real baseline did not change.
- Every ordered gate returns 0; all 19 validate lanes pass.
  Check still reports zero errors and 28 old warnings.
  Prose, Jev, and census return 0.
  No Core or Start source changed; no mutation or speed claim.
- The new message and proof are saved under `engineReviewRound` in
  [the proof](fast-code-rules-proof.json).

Next: lead review of the engine recovery fix.
