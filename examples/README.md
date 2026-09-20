# @tinker/examples

Cast-free tours of the public `@tinker/*` surface, one per concept. These import each package by its
published name (`@tinker/core`, `@tinker/react`, …) — the same surface a consumer sees — so a release
version bump flows straight through them (ADR 0045). Every value's type is **inferred**: no `as`, no
non-null `!`.

| Folder           | Reads                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`          | the whole `@tinker/core` API: data, operation, resource, clock                                                                            |
| `react/`         | the `@tinker/react` seam: providers, cells, suspending resource; `form.tsx` (one-cell draft, `typeDraft` + `saveDraft`)                   |
| `http/`          | the `@tinker/http` frame: client, endpoints, per-call tags                                                                                |
| `hono/`          | the `@tinker/hono` driver: scope at the entrypoint, per-request session                                                                   |
| `drizzle/`       | the `@tinker/drizzle` store on PGlite                                                                                                     |
| `cli/`           | the `@tinker/cli` driver (`basic.ts`) and a real entrypoint (`main.ts`)                                                                   |
| `harness/`       | the `@tinker/harness` frame: `basic.ts` (fake `query`), `real.ts` / `codex.ts` (real adapters), `approvals.ts` / `tools.ts`               |
| `mcp/`           | the `@tinker/mcp` driver: `basic.ts` (in-memory client), `serve.ts` (stdio), `cli.ts` (entry through `@tinker/cli`)                       |
| `sync/`          | the `@tinker/sync` pair: `source` / `subscribe` over `memoryPair`, a family of cells; `hono.ts` serves the pair over an event stream      |
| `issue-tracker/` | the runnable [`apps/issue-tracker`](../apps/issue-tracker/README.md): real issues over HTTP, sync, CLI, MCP, and an optional triage draft |

Combine concepts by importing several packages in one file — that is the point of keeping them here
rather than inside each package.

The cast-free grep and the CLI smoke test in `scripts/validate.mjs` read this folder.
