# 0129 The code is the map: an analyzer reads it, and spans check it

Date: 2026-11-09. Status: accepted; not built yet
(cards `analyze/*`).
Accepted: Duke, 2026-11-09, one answer per question
(thread "Make Tinker AI-first via lint, analysis, runtime").
Builds on: 0119 (one hose), 0121 (capsule config in the
call).

## What the user said

- 02:07: "Let's make tinker the ai first
  library/ecosystem."
  It must tell the shape of the call stack by static
  analysis, through lint, analysis and runtime, with "a
  cross check to guarantee correctness and completion".
- 02:42: the bias serves "logic validation, performance
  optimization, troubleshooting, debug".
- 02:54: "those all should be able to carry tags".
- 03:04: a unit tag is a fact, not a binding (A).
- 03:09: complete means option C.
- 03:22: "if we can analyze the code, then we'd rather do
  that".
- 03:40: "ignore the state chart for now".
- 03:43: the analyzer lives beside Core (A).
- 03:58: the tool is for an LLM's next step, "read only
  the part of flow matter to the subject".
- 04:02: "callstack matter": the error carries it, and the
  story is redrawn from static analysis.
- 04:04: do not copy a resolved value out; `throw`,
  `raise`, `return` and `.run` are what the analyzer reads.
- 05:13: "plain return is fine".

## Context

Every function in a Tinker app is an operation.
Its `depends` names each callee.
Its `run` calls them as `dep.run()` or `dep.settle()`.
So the call graph is in the source, not only at run time.

A scratch pass on Hedl (c8f8770) checked this.
Scripts: project files,
`tinkered/plans/agentic-first/proof-callshape/`.

- 573 files, 800 ops, 1124 edges, in 3 s.
- 0 deps used other than by a call.
- 61 of 62 route rows name an op.
- 1462 tests ran with one span tap.
- 738 ops ran; 717 matched a static call shape on every
  run.

## Precedent

- **Reflexion models** (Murphy, Notkin, Sullivan, 1995).
  A model is checked against the system.
  Each edge is a convergence, a divergence or an absence.
- **Exception edges in a CFG** (Soot, WALA).
  A call can exit by a throw.
- **Encore Flow.** A framework draws its own map from the
  source, and ships traces beside it.
- **OpenTelemetry semantic conventions.**
  `http.route` names the route of a span.
- **TypeScript checker.** A type is checked against the
  body; a doc comment drifts.
- **Conformance checking** (van der Aalst, process
  mining). A model is checked against an event log.
  Fitness: each run fits the model.
  Coverage: each path ran.
- **Program slicing** (Weiser 1981). Keep only the code
  that matters to one subject.
- **SherLog** (2010), **lprof** (2014). Redraw a run from
  a few logs plus the source.

Where ours is simpler:

- No points-to analysis.
  Lint forbids passing a dep on, so the dep name is the
  callee.
- No new language: the facts come from code and types.

## Decision

1. **Derive, do not declare.**
   A fact the code can say comes from the code.
   Lint keeps the code in shapes the analyzer reads.
   A tag holds only a fact the code cannot say.
2. **Units can carry tags.**
   `operation`, `resource` and `data` take `tags`.
   The handle keeps them.
   - A unit tag is a fact.
     It is never bound into a run.
   - Each tag that is not `secret` goes on the unit's span
     as an attribute.
   - A run hook reads them as `event.op.tags`.
   - Core ships no fact tags today.
3. **The analyzer reads:**
   - the graph: units, deps, labels;
   - call shapes per op: order, branches, loops, early
     returns, throw exits;
   - a sequence diagram per route and per cmd;
   - effects: the outside module behind each `module:`
     resource, and read or write by method or SQL verb;
   - the error kinds each route can raise.
4. **Lint rules** that make the code readable:
   - A1: a unit label is a literal, on a module const.
   - A2: a resolved value is only called.
     This covers a dep, the scope and the run context.
     It is never passed, stored, aliased or captured by a
     callback that outlives the run.
   - N1: an entry table (routes, tools, rpc) is a literal.
     The analyzer finds it by its config type.
   - E1: an outside module comes in only as a `module:`
     resource.
   - R1: a raised error kind is a literal.
5. **Exits and edges.**
   - `.run` and `.settle` are the edges.
   - `return`, `raise` and `throw` are the exits, each at
     file and line.
   - A plain `return` is fine.
     It leaves no span, so a trace narrows it to the
     returns between two calls.
6. **Runtime.** The routes driver puts `http.route` and
   `http.response.status_code` on the span of the op a row
   runs.
7. **Conformance** compares the static shapes with
   observed spans:
   - fitness: divergence (a run or edge with no static
     shape) must be 0;
   - coverage: every static call shape must run in a test;
   - a `try`'s catch counts once, not once per call.
8. **Slice and story.** The tool serves an LLM's next
   step; it never guesses.
   - `slice <subject>`: only the paths of one route, op or
     cmd, at file and line.
   - `story <failed run>`: span names, the error's
     `origin.path` and its stack, joined with the map.
   - Where it cannot read, it says why and what to read
     next.
     Example: a callee picked by a capsule hook.
   - Where a trace fits more than one exit, it lists them.
9. **Where.** The analyzer is a package beside Core in this
   repo: `packages/analyze`.
   It ships with each Core release.

## Parked

- A path id on each span (Ball-Larus 1996), so a success
  run is redrawn to one exit.
  Restart when real cases show that the status code and
  the candidate list are not enough.

- Statecharts: the move rules and their lint (M1).
  Restart once the cards below are on main.

## Consequences

- Hedl gets findings at once:
  - 5 GET routes reach a SQL write;
  - 21 queries run inside a loop
    (one task list made 32 queries);
  - 36 route call shapes have no test.
- A new primitive must say how the analyzer reads it,
  or it is a divergence.
