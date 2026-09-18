# Core feedback from authoring

The other side of the spectrum: every integration (http, hono, drizzle, cli, claude, codex) is built to
find what core lacks or gets wrong. Contributors end each report with a **Core feedback** section; the
lead records the candidates here with the integration that surfaced them. A candidate becomes a core
ticket only after a second integration asks for it, or when the workaround is dishonest.

| candidate                                                                                                                     | surfaced by           | status                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------- |
| An operation's `parse` failure should be `DataValidationFailed` like data/tag parses                                          | hono/t02              | **done** — core/t28                                                     |
| A driver needs a per-request span its handler's span nests under                                                              | hono (ADR 0040)       | **not needed** — the request is an inline op                            |
| A session-target resource that inherits the parent session's built instance (savepoints, per-flow sharing under tagged calls) | drizzle (ADR 0041 Q3) | open — wait for a second asker (cli? claude?)                           |
| `tags: []` on a call means untagged (no session) — is an empty binding list ever a session?                                   | core/t27              | accepted as untagged; revisit only if a driver needs "always a session" |
| A lazy operation handle (`lazy(() => import(...))`) usable as a `depends` slot; today drivers load then run                   | cli (ADR 0042)        | open — wait for a second asker                                          |
