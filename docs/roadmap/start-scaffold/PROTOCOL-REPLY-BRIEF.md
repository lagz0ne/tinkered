# Scaffold protocol reply brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0067, 0099, 0100, 0101, 0102, and 0103.

## Goal

The Start scaffold's own operations stop speaking HTTP (ADR 0103).
Routes own the wire both ways; operations take plain params and return
plain values or raise managed errors.

## Found by

The whole-repo review of ADR 0102 and 0103:

- `src/scaffold/telemetry/ingest.server.ts:18-58`, `:61-86`: operations take
  a `Request`, read origin, content-type, and content-length headers, and
  return a `Response` with 202, 400, 403, 413, 415, or 503 and `Cache-Control`.
- `src/scaffold/backend/stream.ts:205-232`: the `openSync` input reader parses
  the query string and `Last-Event-ID`; `stream.open` returns a `Response`
  with SSE headers.
- `src/backend/auth.ts:44-52`: `handleAuth` takes a whole `Request` and
  returns better-auth's `Response`.
- `requestHeaders` is exported to app code (`src/backend/index.ts:7`,
  `src/lib/tinker.server.ts:2`), so any operation can read raw headers.
- `tinker-forms/SKILL.md:80-99`: the `postNotice` example hands
  `{ status, headers, body }` straight to its callers.

## Do

1. Telemetry ingest: `src/routes/api.telemetry.ts` checks origin and headers
   and reads the bounded body. The operation takes a `Telemetry.Batch` and
   raises error kinds. The route maps each kind to its status and headers.
   The wire stays the same.
2. Sync stream: `src/routes/api.sync.ts` reads the cursor and `Last-Event-ID`
   and passes `{ cursor }`. `open` returns the body stream; the route wraps it
   in a `Response` with the SSE headers. The wire stays the same.
3. Auth: better-auth's handler is a mounted third-party HTTP handler, so it is
   protocol layer. Move the `Request`/`Response` handling into the route; if
   an operation must stay, record it as the named exception in ADR 0103.
4. Stop exporting `requestHeaders` to app code; only the scaffold and
   `auth.ts` use it.
5. `check:plain`: fail an operation whose input is `z.instanceof(Request)`
   or that returns a `Response`, outside the named exception. Planted cases.
6. Also from earlier reviews:
   - catch destructured browser globals (`const { fetch } = globalThis`,
     `const { sendBeacon } = navigator`, `const { XMLHttpRequest } = globalThis`);
   - fail non-literal `import()`/`require()` and `createRequire` outside
     `src/scaffold/`;
   - `export type` from a banned module passes;
   - the `postNotice` skill example maps the reply to a domain value or error;
   - move the `README.md:165` graceful-close line from "Promises tested"
     to a limits note;
   - rename the lifetime tag labels `sync.backendStop`/`sync.requestStop`
     to `lifetime.*` and fix the comment at `lifetime.ts:2-4`.
7. Rebuild the registry.

## Proof, all by exit code

1. Each change red then green; each new `check:plain` case planted.
2. The telemetry and sync wire is unchanged: a test or script compares
   status, headers, and body before and after for each case
   (good batch, bad origin, wrong type, too large, bad body, closed backend;
   sync open, resume with `Last-Event-ID`, bad cursor).
3. `check:plain --prove`, seam, boundary, registry, app tests, build,
   `vp check`, all tests, prose, `pnpm validate`.

## Limits

- Change only `apps/start-scaffold/`, `docs/roadmap/start-scaffold/`,
  and `docs/decisions/0103-the-protocol-layer-owns-the-reply.md`.
- Do not change Core or React. Note any Core gap in PROGRESS.md.
- Vitest 5: await every `expect.poll` and async assertion.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
