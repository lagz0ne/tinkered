# Repo style work

## repo/no-import-extensions

Owner: lead (Claude, Start scaffold session); Codex writer.
Branch: `repo/no-import-extensions`.
The lead asked for one fix round.
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
- The saved-text check rejects TS module endings after
  `from` or `import` in docs, JSON, and templates.
  It also rejects seam `from` fields and decoded receipts.
  Assets, query imports, and file targets pass.
- `pnpm validate` runs the check and its behavior tests.
- The full strict census has old hits.
  Compare its counts with main; do not widen this fix round.
- Proof files keep headers and summary lines only.
  The final gate codes are in `no-import-extensions-proof.json`.

Final ordered gate results are saved after they finish.
