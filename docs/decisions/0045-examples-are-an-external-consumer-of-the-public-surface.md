# 0045 Examples are an external consumer of the public surface, not internal fixtures

Date: 2026-09-18. Status: accepted. Relates: 0016 (release budget gate), and every package ADR whose
`examples/` moved (0035 http, 0039/0040 hono, 0041 drizzle, 0042 cli, 0043 harness, 0046 mcp, 0048 sync).

## Context

Each package carried its own `packages/<pkg>/examples/*.ts`, and each tour imported the package
through `../src/index.ts` — the **source**, not the built entry. That has three costs:

- **They lie about the release.** A real consumer imports `@tinker/<pkg>` and gets `dist` through the
  package's `exports` map. Importing `../src` bypasses the very surface a version bump ships, so a
  tour could pass while the published entry was broken or the export was missing.
- **They can't combine concepts.** A tour of core+react+http together had no home — an example lived
  inside one package and could only reach its own `src`.
- **Docs are scattered.** Nine `examples/` folders, one per package, is nine places to look.

The precedent this is shaped like: an **integration-test app** (or a published package's `examples/`
that lives in the repo root, as most OSS monorepos keep them) — a downstream workspace member that
depends on the libraries by their public names and is never published itself. Borrow that: the
examples are a consumer, so they resolve through the same `exports` a user hits.

## Decision

One private workspace package `@tinker/examples` at the repo root holds every tour, one folder per
concept, each importing the **public** name:

```text
examples/
├── package.json         private; dependencies: @tinker/* via workspace:*  (the release rewrites these)
├── tsconfig.json        jsx + dom + node — one config spans core, react (.tsx), harness
├── vite.config.ts       lint typeAware + typeCheck, fmt  (so `vp check` covers the tours)
├── core/  react/  http/  hono/  drizzle/  cli/  harness/  mcp/  sync/
└── (combine concepts by importing several @tinker/* in one file)
```

- **Every import is a public import.** `@tinker/core`, `@tinker/react`, … resolve through the
  workspace symlink to each package's `exports` → `dist`. The tour now type-checks against exactly
  what ships; a broken or missing export fails `vp check`. This is what "supports the release /
  version switch" means — `workspace:*` is rewritten to the real version at publish, and the tour
  rides whatever the entry currently exposes.
- **The tours stay cast-free.** The same grep, repointed from `packages/<pkg>/examples` to
  `examples/<pkg>` in `scripts/validate.mjs` (ADR 0016 lane), still enforces 0 `as` / 0 `!`.
- **The CLI smoke test spawns the moved entry.** `packages/cli/tests/cli.test.ts` runs
  `examples/cli/main.ts` from the examples package cwd — through `@tinker/cli`'s built entry.

## Consequences

- A tour needs the packages **built** (`dist` present) to type-check — the same requirement react's
  and http's own checks already had, since they import `@tinker/core` from `dist` too. It is not a
  new constraint, just applied to the tours.
- Package `README`s point at `examples/<pkg>/...`; the historical `docs/roadmap/**` notes keep their
  old paths as a record of where the tour lived when the ticket shipped.
