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
- Gates at 08cb5dd8, all exit 0: build, check
  (80 warnings, as main), devtools 17 tests,
  size 1990 B (cap 2160), prose, skills,
  release check, every package's tests.
- Not done by 14:00 UTC: the mutation lane (the
  lock was busy) and `calibrate.mjs` (stopped
  after 5 min). So not pushed yet.
- 2026-11-18 14:06: the lane ran no test. The
  sandbox left out `tsconfig.json`, so `@/index`
  read the real `src`. Fix: the `@` alias to the
  package's own `src`, as cli has (fc589f22).
- First real lane: 79.62. A lift by an Opus
  writer (c79f6912): 98.04, on kills alone.
- Left alive: the `handle.id` guard (the tap is on
  before any session, so no test reaches it) and
  the listener rethrow (only the dist child test
  reaches it).
