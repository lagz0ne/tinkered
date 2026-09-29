# 0078 An entry runs only as main; its root is one function; pieces live beside their code

Date: 2026-09-29. Status: accepted. Builds on: 0050 (extensions), 0051 (flat rows), 0056 §7 (an
HTTP entry is built like a command), 0060 (no wrapper owns the scope). Fits: 0074 and 0077 (the
stack holds the server start and shutdown).

## Context

The issue tracker's `createApp(config)` built the scope, the Hono app, the port, and the boot
publish in one call, started the root, and handed it back.

- Every test called it, so every test carried Hono and the port.
- A failed boot could only be tested by booting everything.
- The unmapped-error handler was set in three places.
- The port opened before the saved list was published, so a tab that connected in that gap got
  `[]` first.

A committee (Astra and Fable, three rounds) judged the fix.

**The precedent is the composition root** (Mark Seemann): wire the graph in one place, near the
entry. Two known ways keep that place testable:

- Python's `if __name__ == "__main__":` and Node's `import.meta.main` (Node 22.18 and 24.2): a
  file starts its program only when it is the one node was asked to run.
- Go's thin `main` over a `run(ctx, args, getenv)` that returns an error (Mat Ryer): a test
  calls `run` and gets the real program.

Ours is simpler than Go's: every piece is already one row in the root's list, so a test that
needs less lists less.

## Decision

1. **A piece builds nothing.** A piece is one row in a root's list: an extension, a tag
   binding, or a function that returns one. It lives beside the code it uses:
   `issueServer` in `routes.ts`, `publish` in `publish.ts`, `draftTags` in `draft.ts`.
   No grab-bag file.
2. **The app's one full root is a function in its entry file.** It builds the scope, waits
   for a stop, closes, and answers an exit code. It never hands the scope back.

   ```ts
   export async function runServer(env: Env, stop: AbortSignal): Promise<number>;
   ```

3. **The entry starts only when run.** Importing the entry file starts nothing:

   ```ts
   if (import.meta.main) {
     const stop = new AbortController();
     process.on("SIGTERM", () => stop.abort());
     process.exitCode = await runServer(process.env, stop.signal);
   }
   ```

   One test calls `runServer` on a free port, so a broken full list fails a test. A command
   line entry does the same with `if (import.meta.main) await main(shell)`; its test seam is
   `run(shell, args)` (ADR 0056).

4. **Every other test is its own small root.** It lists only the pieces it uses. No shared
   helper returns the full list: that is `createApp` again. A test file may keep its own
   `boot()` fixture for the pieces its tests share.
5. **The serving extension is first in the list.** First listed is outermost, and work after
   `await next()` runs inside out. So the port opens after every other start has finished.
6. **A failed `ready` is closed and awaited.** Core starts the close but rejects `ready`
   before the close ends. Every root catches, awaits `close()`, then answers or rethrows.
7. **Two plain rules keep it** (`tools/jev/plain.mjs`):
   - **S27 unguardedEntry** — a top-level `await` outside `if (import.meta.main)`.
   - **S28 returnedRoot** — a function that makes a scope with `createScope` and returns it,
     alone or inside an object. Test files never count.

## Consequences

- `createApp` and `app.ts` are gone.
- A test shows every piece it uses. A hidden link fails a small root at once: the list route
  reads the published cell, so a root without `publish` answers `[]`.
- The signal and exit code glue in `runServer` is hand-written until `@tinker/stack` holds it
  (ADR 0074). The guard and the root as one function stay.
- `docs/roadmap/core-feedback.md` gets a row: a rejected `ready` settles before its close does.

## Options considered

- **Keep `createApp`.** Rejected: every test carries every piece.
- **One helper that returns the full list** (tests spread it and swap a piece). Rejected: tests
  drift back to taking everything.
- **The pieces inside the entry file.** Rejected: it mixes the pieces with the root, and a test
  would import the entry to get a piece.
- **A `requires` field, so the server names `publish`.** Rejected: a cell's reader never names
  its writer (the list route already depends on the cell), and ADR 0073 keeps units free of
  such declarations.
- **A Jev model question.** Rejected: plain code on the syntax tree finds both shapes.
