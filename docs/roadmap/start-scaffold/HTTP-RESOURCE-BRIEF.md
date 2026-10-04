# HTTP resource brief

Owner: lead (Claude, Start scaffold session); Sol writer.
Read the fixed [contributor brief](../contributor-brief.md) first.
Use the `coding-convention` skill for every TypeScript file.
Read ADR 0035, 0099, 0100, 0101, and 0102.

## Goal

Every outgoing HTTP call in a Start app is a child span,
an edge in the graph, and aborted when its scope closes.
Built-in `fetch` is wrapped once, in the scaffold.

## Do

1. Add `src/scaffold/backend/http.ts` with the three units of ADR 0102:
   - `httpBackend`: a tag; default wraps built-in `fetch`.
   - `http`: a resource over `httpBackend`. It owns requests in flight
     and aborts them on scope close (`ctx.defer`).
   - `httpRequest`: an operation. Input: `url`, `method`, optional
     `headers` and `body` (string). It passes the run's `ctx.signal`.
     Its span is named `http <METHOD> <path>` (use `ctx.obs.child`
     or a span attribute; the path has no query string).
     It records the status. It returns `status`, `headers`, and the body text.
     A non-2xx status is a normal result, not a failure.
     A network error is a managed scaffold error, never a bare throw.
2. Export them through the scaffold's server seam (`@/lib/tinker.server`)
   and the backend index, as other scaffold units are.
3. Telemetry: replace `telemetryBackend` with `httpBackend`.
   Its sender must not open its own request spans (it would trace itself).
4. `check:plain`: fail on a bare `fetch(` or `globalThis.fetch` in `src/`,
   except `src/scaffold/backend/http.ts`. Add planted cases.
5. Skills: teach it in `tinker-forms` (and wherever HTTP appears),
   with one filled example: an operation that depends on
   `httpRequest.controller` and runs it.
6. Tests through the seam, no mocks of the global:
   - a run makes one child span `http POST /x` with the status;
   - closing the scope aborts a request in flight;
   - a test binds `httpBackend` to a fake, and no real network is used;
   - a network error is the managed error.
7. Rebuild the registry. `check:plain`, seam, registry, app tests green.

## Proof, all by exit code

1. Each new test fails without its code (red log), passes now.
2. `check:plain --prove` includes the new fetch cases.
3. Build, `vp check`, all tests, prose, `pnpm validate`.

## Limits

- Change only `apps/start-scaffold/` and `docs/roadmap/start-scaffold/`.
- Do not change Core, React, or `tools/`. Jev's S24 is a later card.
- Never use `git stash`. Commit per step.
- Do not ask questions; assume, note it, continue.
- Report everything in one final message: commits, gates, logs.
