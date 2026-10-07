# Repo style work

## repo/no-import-extensions

Owner: Codex writer.
Branch: `repo/no-import-extensions`.
Saved in Review; the lead has not read it yet.
No push, publish, or Stryker run.

- The cleanup script uses the Oxc parser.
  It edits imports, exports, import types, and module names.
  It also reads code in docs, shell samples, and registry JSON.
  A second run writes nothing.
- Keep the `/index` path choice.
  Only the file ending changes.
- Node loads built Core and flight service files.
  Vite loads source in the import proofs.
- `.mjs`, `.js`, `.json`, `.css`, assets, and `?url` stay.
  They need their file endings.
- Doctor check 6 names bad endings with file and line.
  It reads app source, tests, and config files.
  It skips dependencies and generated output.
- The generated app config lets tsc reject a TS ending.
  Its test sees TS5097, then passes without the ending.
- Census S17 reads parsed module paths.
  It checks `.ts`, `.tsx`, and `.mts` files.
  Its selftest rejects a bad ending in strict mode.
- The full strict census has 85 old hits.
  The same changed files on `origin/main` have the same hits.
  S17 has zero hits after the cleanup.
  Leave those old rules for their own work.
- `scripts/ticket.sh --no-mutation --check-only` runs its
  normal checks without mutation, a commit, or a tag.

Final gate proof is added after the last rebase.
