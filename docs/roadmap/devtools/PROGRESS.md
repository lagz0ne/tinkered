# Devtools

## devtools/capsule

- Started 2026-11-18.
- Duke's calls, 2026-11-16: devtools is a plain
  capsule; the record is `Observe.Span`; the CUJ
  work owns `localStorage["tinker.exits"]`.
- Core gives `session.id` and `tinker.exit`
  (ADR 0162).
- Writer: Haiku built the package (e97823c7,
  9dcd3df3, 1929e850). Lead wrote ADR 0163.
- Review (Opus): NOT READY. The span copy lost
  `traceId`, `spanId` and `parentSpanId`, and
  copied Core's private fields.
- Fix round: an Opus writer (owner rule: no
  Haiku writers).
- Core feedback: a failed resource span has no
  `error` (row in core-feedback.md).
- npm: `@tinkered/devtools` is not on npm, so its
  first publish needs Duke (npm-first.yml).
