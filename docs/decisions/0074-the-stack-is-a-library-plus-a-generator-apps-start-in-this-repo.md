# 0074 The stack is a library plus a generator; apps start in this repo

Date: 2026-09-29. Status: accepted. Builds on: 0049 (the golden example), 0051 (drivers are
extensions; wiring is flat rows), 0060 (an integration is an extension the scope owns).
Research: `docs/roadmap/stack-v1/RESEARCH.md`.

## Context

The user wants one default stack to start every web project on the tools they care about.

`apps/issue-tracker` shows the cost of having none. About 550 of its 3,559 source lines are glue
with nothing about issues in it: the server start (`src/server/main.ts`, 158 lines), JSON logs,
errors mapped to HTTP codes by hand, hand SQL migrations, the SSE wire on both sides, publish
after commit, and the browser's boot page. A second app would copy all of it.

**The precedent is Rails and Laravel.** Starter kits ship three ways:

- **A template** (Epic Stack, create-t3-app, Remix Stacks): the app owns every line and gets no
  upgrades. Epic: "there is no way to update it other than making manual changes." Remix Stacks
  were archived on 2025-04-28.
- **A framework** (RedwoodJS, Blitz, Wasp): the app depends on all of it. Redwood is in
  maintenance mode; Blitz gave up its Next.js fork.
- **Both**: logic in a library the app upgrades, app code written once by a generator. Rails
  (`rails new`, skip flags, `app:update`) and Laravel (Fortify is a library; the starter kit's
  pages are copied in). These lasted.

Ours is simpler than Rails: every piece is already an extension or a tag in the root's list, so
leaving one out is deleting one row, not a skip flag.

## Decision

1. **`@tinker/stack` is a library.** It holds the glue an app never edits: the server start and
   shutdown, the log and trace sink, the error-to-HTTP answer, migrations, the sync wire, the
   browser boot. An app depends on it, and a fix reaches every app by version.
2. **A generator writes the app's own code once.** It is registered in `create.templates` in the
   root `vite.config.ts` and runs with `vp create`. Pages, schema, and operations belong to the
   app from then on.
3. **Split by who edits it.** Code the app never edits goes in the library; code the app will
   change goes through the generator (Laravel's Fortify and starter kit split).
4. **Every piece can be left out or swapped.** Each is one extension or tag at the composition
   root. The library never needs a flag to turn a piece off.
5. **Apps start in this repo.** A generated app lands in `apps/*` and depends on `workspace:*`.
   `@tinker/*` is published to npm only after the stack runs two apps: the issue tracker moved
   onto it, and one new app. Core changed its rules three times this week (ADRs 0071–0073);
   publishing now would turn each change into a release.
6. **The v1 box.** Always in: Node and Hono, React with Tailwind and shadcn, Drizzle on PGlite,
   live sync, JSON logs, tests. Extras the user named for v1: auth (Better Auth considered),
   background jobs, email, OpenTelemetry for logs and traces, and server-side React (TanStack
   named as the example). Deploy is not in v1. Each extra gets its own decision.

## Consequences

- Two new things to build: `packages/stack` and one generator package.
- The issue tracker becomes the first consumer; its glue moves into the stack.
- Until the npm release, an app does not record which stack version it started from. The release
  adds that field (Epic's `epic-stack` field, Rails's `load_defaults`).
- Deploy stays per app until a later decision.

## Options considered

- **Template only.** Rejected: no upgrade path; each fix is copied by hand into every app.
- **Own repos now.** Rejected for v1: needs a release flow for eleven `@tinker/*` packages still
  at `0.0.0`.
- **A chooser with many options** (Better-T-Stack). Rejected: one way per job; every mix would
  need its own tests.
