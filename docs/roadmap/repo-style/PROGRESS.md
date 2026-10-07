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
