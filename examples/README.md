# @tinker/examples

Cast-free tours of the public `@tinker/*` surface, one per concept. These import each package by its
published name (`@tinker/core`, `@tinker/react`, …) — the same surface a consumer sees — so a release
version bump flows straight through them (ADR 0045). Every value's type is **inferred**: no `as`, no
non-null `!`.

- **core:** data, operations, resources, and the clock.
- **react:** providers, cells, and a suspending resource.
  `form.tsx` uses one draft cell with `typeDraft` and `saveDraft`.
- **http:** the client, endpoints, and per-call tags.
- **hono:** a scope at the entrypoint and a session per request.
- **drizzle:** the store on PGlite.
- **process:** `app.ts` has operation, streaming, lazy, and server commands.
- **process-cli:** `basic.ts` shows the `run` seam.
  `main.ts` is a real entrypoint.
- **harness:** `basic.ts` uses a fake SDK query.
  `real.ts` and `codex.ts` use real adapters.
  `approvals.ts` and `tools.ts` add permission checks and tools.
- **mcp:** `basic.ts` uses an in-memory client.
  `serve.ts` uses stdio; `cli.ts` uses a process command.
- **sync:** `source` and `subscribe` connect through `memoryPair`.
  `hono.ts` serves them over an event stream.
- **issue-tracker:** the runnable [app](../apps/issue-tracker/README.md)
  has real issues over HTTP, sync, CLI, MCP, and an optional triage draft.

Combine concepts by importing several packages in one file — that is the point of keeping them here
rather than inside each package.

[One agent, two services](harness/SERVICES.md) is a complete Harness example.
One conversation reads GitHub and Cloudflare through separate HTTP settings.
Run its tests, with no live accounts, through `vp run @tinker/examples#test`.

The cast-free grep and the CLI smoke test in `scripts/validate.mjs` read this folder.
