# HTTP polish brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Read ADR 0102 and `docs/roadmap/start-scaffold/HTTP-RESOURCE-BRIEF.md`.

## Goal

Close the three low gaps the `start/http-resource` review left.

## Do

1. Add `node:http2`, `http2`, `ws`, and `ofetch` to the client import ban
   in `check:plain`. A planted case each.
2. Skip `import type` (and `import { type X }`) from banned modules;
   a type-only import sends nothing. A planted case that must pass.
3. `HttpRequestFailed` cause: accept a number or a string `code`,
   and read `name` and `code` one by one, so an abort (`DOMException`,
   code 20) and a nested string cause keep what they can.
   Never keep a message or a URL. A test each.
4. Rebuild the registry.

## Proof, all by exit code

1. Each change red then green.
2. `check:plain --prove`, seam, registry, app tests, build, `vp check`, prose.

## Limits

- Change only `apps/start-scaffold/` and `docs/roadmap/start-scaffold/`.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
