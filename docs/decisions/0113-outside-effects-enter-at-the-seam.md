# 0113 Outside effects enter at the seam

Date: 2026-10-12. Status: accepted.

- User, 2026-10-12: "Component like mail and db just
  need to have those tags required, and that's it."
- User: "Yes, pattern applies for all."
- User: "This is the official authoring pattern."
- User: "this is also the pattern meant to be applied to
  the core backend of logger and otel span."
- User: "Env is just a specific way of receiving the
  side-effect. We want the side-effect, external to
  come from seam. The internal should be as static
  as possible."

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

- **Functional core, imperative shell** (Bernhardt).
  The core takes values and returns values.
  The shell does the effects.
- **Ports and adapters** (Cockburn).
  The inside names a port; the outside plugs in.

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

## Rule

Anything from outside the process reaches a unit
only through the scope. The seam puts it there.

- Outside means: env, the clock, randomness,
  the network, the console and stdout, files.
- The seam is an entry, a server or client seam
  file, a part's `settings(env)`, or a test.
- A unit names what it needs: a tag, a resource,
  or Core's `ctx.clock` and `ctx.random`.
- A unit body never reads a global for it:
  no `process.*`, `Date.now`, `Math.random`,
  bare `fetch`, or `console.*`.
- A tag default may be a fixed value.
  It may also do a real effect, such as `fetch`
  (user: "yes, they can"). The default sits on
  the seam, not in a body; name it in the TSDoc.
- Core already works this way:
  a scope takes its clock and random.

Env is one case of the rule. The rest of this
ADR is that case.

## Decision for settings

- A provider exposes the exact values it needs as tags.
  Mail: `smtpUrl` (a `URL`) and `mailFrom`.
  Database: `databaseUrl` (a `URL`).
  Auth: `authSettings` (origin and secret).
  Telemetry: `telemetryService`, `tracesUrl`, `logsUrl`
  (both `URL`), `telemetrySide`, `logLevel`,
  and `spanHistory`.
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
- Core's log level and span history are tags too.
  `LOG_LEVEL` (default `info`) and `SPAN_HISTORY`
  (default `80`) fill them (user: "make them avail,
  with default sensible").
