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
- The full strict census has 89 old hits.
  The same changed files on `origin/main` have the same hits.
  S17 has zero hits after the cleanup.
  Leave those old rules for their own work.
- `scripts/ticket.sh --no-mutation --check-only` runs its
  normal checks without mutation, a commit, or a tag.

Final gate proof is saved in `no-import-extensions-proof.json`.
The lead still owns review and landing.
Land after both Start cards; the first release waits.

### What passed

- Install, all builds, check, all tests, and prose returned 0.
- The registry built 10 local items and passed its check.
- The scaffold proof used real auth, SMTP, and Postgres.
  A saved todo reached two tabs.
  Its browser sessions, server, relay, and Compose project stopped.
- All 17 fixed budget checks passed.
- Core source and built-file tests passed in the ticket gate.
- The script rewrote 2,453 parsed module paths from main.
  That count includes live code and saved code samples.
- Doctor rejects a bad ending and tsc reports TS5097.
- The one named BREAKS proof caught 1 of 1 breaks.
  This is the direct regression check the brief asks for.
  No Stryker or full mutation lane ran.

### Jev

- Preflight returned 0: 1 file flag and 144 flagged units.
  All 169 model questions were explained and labeled.
  This card adds 91 bank rows; saved matches are reused.
  Their full output and reasons are in the proof JSON.
- Every flagged file has the same body as main.
  Only parsed module endings differ.
- Test review returned 0: 7 old test-shape flags.
  The guard tests test the guard itself.
  The result tests guard a result before reading its fields.
  This change keeps those tests and their checks.
  Jev has no registered test-label question for those flags.
- Promise review returned 0 for Core, React, Start, and Blueprint.
  Core has 42 old titles with no README match.
  They test type rules, close order, and race edge cases.
  They add safety checks under the existing API promises.
  No test title or README promise changed here.
  The other three packages have zero gaps.
- Saved judge code now has no TS module endings.
  Edited row IDs use the label tool’s SHA-1 rule.
  Prior labels and their reasons stay intact.
  The lead must rerun calibration when landing these labels.

### Limits and choices

- Keep `/index` choices; remove only the ending.
- Plain Node loads built files; Vite loads source for proofs.
- No live TS import keeps a TS ending.
- The generated app and trial configs use bundler resolution.
- The full strict census still fails on 89 old hits.
  Main has the same counts for the same files.
  The new import rule has zero hits.
- React has one old skipped test.
- No timing, Stryker, push, publish, or main landing ran.
- No Core API change or new Core feedback.
- The other Start card may still land after this handoff.
  The lead reruns the cleanup script and gates after that rebase.
