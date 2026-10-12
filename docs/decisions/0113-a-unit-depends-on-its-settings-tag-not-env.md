# 0113 A unit depends on its settings tag, not env

Date: 2026-10-12. Status: accepted.

- User, 2026-10-12: "Component like mail and db just
  need to have those tags required, and that's it."
- User: "Yes, pattern applies for all."
- User: "This is the official authoring pattern."
- User: "this is also the pattern meant to be applied to
  the core backend of logger and otel span."

Replaces the "App settings become resources over `env`" part of ADR 0106.
Uses: 0006, 0099, 0105, 0106.

## Context

ADR 0106 made the `env` tag a copy of `process.env`.
App settings became resources over `env`.
So `mailSettings` and `databaseSettings` each depended on every key.

- The graph showed `mail → env`, not what mail needs.
- Mail parsed text it should not own.
- A test bound key names (`SMTP_PORT: "25"`), not typed values.
- The scaffold's own rule already said "Tag: fixed settings".

## Precedent

- **Composition Root** (Seemann).
  Read config in one place, at the root.
  Pass each part only its own values.
- **Service Locator is an anti-pattern** (Seemann).
  A bag you pull keys from hides what a unit needs.
  The `env` tag is that bag.
- **.NET Options pattern.**
  A service takes `IOptions<SmtpOptions>`, not `IConfiguration`.
  Startup binds and checks the values.
- **Twelve-Factor, III Config.**
  Config lives in env. That stays true at the root.

## Decision

- A provider exposes the exact values it needs as tags.
  Mail: `smtpUrl` (a `URL`) and `mailFrom`.
  Database: `databaseUrl` (a `URL`).
  Auth: `authSettings` (origin and secret).
  Telemetry: `telemetryService`, `tracesUrl`, `logsUrl`
  (both `URL`), and `telemetrySide`.
  The logger and span backend (observer, queue,
  delivery) each need only the tags they use.
- The value's type is the provider's choice.
- A provider never reads `env` and never parses text.
- Whoever makes the scope fills the tags:
  - the server seam's `settings(env)`, at start;
  - each base part's `settings(env)`, at start;
  - a test, with typed values.
- The `env` tag is gone. No unit can read the bag.
- This is the authoring rule for every unit.
- `settings` checks and converts env keys.
  A refused key raises BadSettings, with each key.
- That conversion is tested alone; no provider runs.

```ts
// mail.server.ts
export const smtpUrl = tag<URL>({
  label: "mail.smtpUrl",
});
export const mailFrom = tag<string>({
  label: "mail.from",
});
```

```ts
// src/lib/tinker.server.ts
export function settings(env: Env.Values) {
  const keys = check(env);
  return [
    databaseUrl(new URL(keys.DATABASE_URL)),
    smtpUrl(smtp),
    mailFrom(keys.SMTP_FROM),
  ];
}
```

```ts
// a test
tags: [databaseUrl(new URL("postgres://proof"))]
```

## Where ours is simpler

- A tag is the options type. No options class.
- No binder library: `settings` is one plain function.

## Consequences

- `settings` is a new required seam export.
  Doctor 5 names a seam that lacks it.
- The app template exports `settings = () => []`.
- The plain check counts the base as `settings`'s caller.
- The mail example now needs its SMTP keys to start.
  Before, it needed them only when it sent mail.
- Auth and telemetry fill their tags the same way.
  Their keys are still checked by the part's env table.
- A refused base key now stops start at once,
  before any root starts.
- Code that bound `env(...)` binds the typed tag.
