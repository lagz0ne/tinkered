# HTTP docs brief (ADR 0102, 0103)

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Read ADR 0102, 0103, `docs/writing-style.md`, and the code in
`apps/start-scaffold/src/scaffold/http-backend.ts` and `backend/http.ts`.

## Goal

Docs and fix texts say exactly what the code does.

## Do

1. ADR 0102: each request makes two spans (`http.request` and
   `http <METHOD> <path>`); `http` is session-target; requests stop on the
   `backendStop` and `requestStop` tags, on forced close, and on cleanup —
   at that step, direct graceful close still waited (fixed by ADR 0104);
   the ban list in `check:plain`; WebSocket and EventSource are out of scope
   (ADR 0048); the backend tag lives in `http-backend.ts`.
2. `docs/glossary.md`: the HTTP section is no longer `@tinker/http`;
   rows for `httpBackend`, `http`, `httpRequest`, the stop tags, and
   "protocol layer" agree with the code; remove retired rows or mark them.
3. `apps/start-scaffold/README.md` and the skills: no "one child span" claims;
   the old graceful-close limit was fixed by start/http-closing.
4. `tools/jev/plain.mjs` S24 message and fix line and `tools/jev/README.md`:
   the fix snippet uses `rawInput` (the input is branded), imports from
   `@/lib/tinker.server`, and maps the reply (ADR 0103). Remove old
   `packages/http` mentions (`tools/jev/README.md`, `plain.test.mjs`).
5. A test: the S24 fix snippet typechecks in a copy of the scaffold.

## Proof, all by exit code

Prose; Jev tests; the snippet typecheck; `vp check`.

## Limits

- Change only `docs/`, `apps/start-scaffold/README.md`,
  `apps/start-scaffold/.agents/skills/`, and `tools/jev/`.
- Do not change app or scaffold source code.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
