// The Jev lint + guide bank (plan: docs/roadmap/jev-loop/PLAN.md, "lint + guide").
//
// Shape borrowed from ESLint: a deterministic selector finds one node (here: one declared
// unit or one top-level function), each rule asks one narrow question about it, and code
// applies the threshold and prints. Jev supplies only the yes/no or the pick; it never
// locates, counts, or gates. Every question ships with a bad/clean fixture pair in
// evals/fixtures/lint.mjs and stays in the bank only while evals/lint.mjs shows >= 30 points
// of separation. Advisory: vp check / tests / mutate / the lead still decide.

// ---------- slicer (deterministic: Jev never locates or counts) ----------
// On a real parser since 2026-09-21 (`extract.mjs`, oxc-parser); these keep the old names.
import { units as extractUnits, tests as extractTests } from "./extract.mjs";

/** Every declared unit plus each top-level function that declares none (a function that
 *  declares units is a composition root or a tour, not a primitive candidate). */
export function slice(src, file = "a.ts") {
  return extractUnits(src, file);
}

/** The fields the decision depends on — nothing else rides into the state. */
export const forJev = ({ kind, name, source }) => ({ kind, name, source });

// ---------- lint: anti-goal judges (one boolean per rule grep cannot see) ----------
// `applies` is the kind filter the code enforces; `threshold` is per question (Jev
// probabilities are not comparable across questions). Rule numbers: docs/best-practices.md.
export const LINT = {
  runForwardsToClosure: {
    applies: ["operation"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does the operation's run body hand its ctx, deps, controller, transaction, or database to a function declared outside the operation, which then does the real work?",
      criteria: {
        true: "run forwards ctx, deps, a controller, tx, or db to an outside function that does the job",
        false:
          "run does its own reads and writes with its declared deps; any helper it calls takes only plain values",
      },
    },
  },
  effectWithoutDefer: {
    applies: ["resource", "operation", "function", "hook"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this code start ongoing work — a timer, interval, listener, subscription, poll, socket, or connection — and leave its stop outside any ctx.defer hook?",
      criteria: {
        true: "ongoing work is started and its stop is a returned close method, a manual flag, or missing",
        false: "each started thing is stopped from a ctx.defer hook, or nothing ongoing is started",
      },
    },
  },
  stateOutsideCell: {
    applies: ["resource", "function", "hook"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Is state that other code reads over time — a selection, a filter, a draft, a status, a list — kept in a closure variable, module variable, object field, or ref with hand-made listeners, instead of a data cell?",
      criteria: {
        true: "shared, watched state lives in a variable, field, or ref with its own listener set",
        false:
          "shared state lives in data cells, or the variables are private bookkeeping behind this unit's methods",
      },
    },
  },
  configNotTag: {
    applies: ["resource", "operation"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this unit read an environment choice — a URL, port, path, flag, or feature switch — from process.env, a hard-coded literal, a struct field, or a closure argument instead of a tag in its depends?",
      criteria: {
        true: "an environment value comes from process.env, a literal, a field, or a parameter",
        false: "environment values arrive through a tag in depends, or none are used",
      },
    },
  },
  handRolledLifetime: {
    applies: ["resource", "operation", "function", "hook"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this code manage when work is done or stopped by hand — a done or closed boolean, a promise tail or waiter, a queue of pending callers, or a map of senders — where a scope's signal, defer, ready, or close would do?",
      criteria: {
        true: "manual flags, promise chains, queues, or maps decide when work is done or stopped",
        false:
          "cancellation goes through ctx.signal, cleanup through defer, waiting through ready or close, or there is no lifetime to manage",
      },
    },
  },
  stopOnlyInDefer: {
    applies: ["resource", "operation"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Is running work stopped only from inside a ctx.defer hook, with ctx.signal ignored, so a forced close waits on work that only defer would stop?",
      criteria: {
        true: "the only stop for in-flight work is set from defer; the signal is never consulted",
        false:
          "in-flight work watches ctx.signal or calls throwIfAborted so close can end it, or there is no in-flight work",
      },
    },
  },
  ignoresAbortAfterAwait: {
    applies: ["resource"],
    threshold: 0.7,
    q: {
      type: "boolean",
      instructions:
        "Look at each await in this factory. Is any await followed by a call that starts new work — a query, a subscribe, a send, a build — with no signal.throwIfAborted() or signal.aborted check between the await and that call?",
      criteria: {
        true: "at least one await is followed by new work and no signal check sits between them",
        false:
          "every await that is followed by new work has a signal check first, or no work follows any await",
      },
    },
  },
};

// React judges (rules 9 and 10 + the @tinker/react README): grep owns useState/useRef/useEffect
// and Scope.Handle props; Jev gets the five things grep cannot see.
Object.assign(LINT, {
  readsMoreThanRendered: {
    applies: ["component"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this component read a whole list or collection from a cell with useData, and then use only one item of it — found by id, key, or index — with no selector argument?",
      criteria: {
        true: "useData(cell) returns a whole list and the component picks one item out of it by id, key, or index",
        false:
          "useData gets a selector for the item, the component renders the list it reads, or the cell holds a single record or form draft whose fields are rendered",
      },
    },
  },
  subscribesToWriteOnly: {
    applies: ["component"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this component subscribe to a cell it only writes — useData, or useData with writable — where the read value never appears in the output?",
      criteria: {
        true: "a cell is read with useData but only its setter is used; the value is never rendered",
        false: "every value read is rendered, or write-only access goes through useController",
      },
    },
  },
  runDuringRender: {
    applies: ["component"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this component call run, runAsync, set, or update directly in its render body — outside any event handler, callback, or effect?",
      criteria: {
        true: "a run or a cell write sits in the function body and executes on every render",
        false: "every run or write is inside an onClick, onChange, onSubmit, or other callback",
      },
    },
  },
  domainLogicInRender: {
    applies: ["component"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this component decide a domain rule itself — a conflict, a merge, validity against saved data, a revision check — instead of rendering a notice or flag that an operation wrote to a cell?",
      criteria: {
        true: "the component compares saved and draft data or applies a business rule to decide what happens",
        false:
          "the component renders cells plus view-only formatting (labels, disabled while pending, empty-text checks); rules live in operations",
      },
    },
  },
  effectOwnedByComponent: {
    applies: ["component"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this component itself start a fetch, timer, listener, socket, or stream — in its body or in a handler — instead of running an operation with useRun or reading a resource?",
      criteria: {
        true: "fetch, setInterval, setTimeout, addEventListener, EventSource, or a websocket is created in the component",
        false: "the component only runs operations with useRun and reads cells or resources",
      },
    },
  },
});

// ---------- guide: which unit should this be? (the one-law table as criteria) ----------
export const GUIDE = {
  unit: {
    minConfidence: 0.6,
    q: {
      type: "choice",
      instructions: "Which @tinker/core unit fits this code or description?",
      criteria: {
        data: "a piece of state kept and read over time — a form field, a draft, a filter, a selection, a notice, a list — written by operations or a driver",
        resource:
          "something that subscribes, listens, polls, connects, opens, or streams; built once per owner; needs cleanup",
        operation:
          "something a user, request, CLI, or tool asks for; runs once per call with typed input; may have effects",
        tag: "an environment choice — a URL, path, flag, or setting — bound at the root and rebound in tests",
        glue: "a plain function that takes values in and returns a value, keeps no state and starts no effect; or wiring at the composition root",
        view: "a React component: reads cells with useData, runs operations with useRun, renders; owns no state and no effect",
      },
    },
  },
  target: {
    minConfidence: 0.6,
    q: {
      type: "choice",
      instructions: "For a resource: one instance for the whole scope, or one per session?",
      criteria: {
        scope: "one shared instance for the process: a database, a server, a cache, a pool, a wire",
        session:
          "one per request, tab, call, or turn: a transaction, a request context, per-call state",
      },
    },
  },
  needsDefer: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this start or hold something that must be stopped, closed, or rolled back when its owner closes?",
      criteria: {
        true: "a connection, timer, listener, transaction, or buffer must be released at close",
        false: "it computes or reads values only; nothing to release",
      },
    },
  },
};

/** The target shape per unit, from the one-law table in docs/best-practices.md. */
export const SHAPE = {
  data: 'const x = data({ label: "x", initial }); // written by an operation or a driver; read with watch / useData',
  resource:
    'const x = resource({ label: "x", target, depends, factory: (deps, { defer, signal }) => { …; defer(() => stop()); return api; } })',
  operation:
    'const x = operation({ label: "x", input: shape.parse, depends, run: async (deps, ctx) => { … } })',
  tag: 'const x = tag<Config>({ label: "x" }); // bound at the root: createScope({ tags: [x(value)] })',
  glue: "a helper over plain values only — never a scope, session, controller, or tx — or delete it",
  view: "function X() { const v = useData(cell, select?); const op = useRun(operation); return <… onClick={() => op.run({ input })} />; }",
};

// ---------- tests: the convention's "over-testing is a defect" rules a grep cannot see ----------
// State per test: { title, body }. Pairwise state: { a: { title, body }, b: { title, body } }.
// Rule text: .agents/skills/coding-convention/SKILL.md "Tests".
export const TESTS = {
  helperAlone: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this test exercise a builder, guard, reader, or helper by itself — constructing a value and asserting its fields — instead of a behaviour that uses it through the public seam?",
      criteria: {
        true: "the test's subject is a helper's own output (a built record, a guard's boolean, a reader's parse) with no behaviour around it",
        false:
          "the test runs a behaviour a user could trigger and asserts its outcome; helpers are only on the way",
      },
    },
  },
  manyCauses: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this test bundle two or more unrelated causes — separate inputs whose outcomes do not depend on each other — so that it names more than one promise?",
      criteria: {
        true: "several independent set-ups each with their own assertions, joined only by the test body",
        false: "one cause and one decisive outcome, possibly checked by several short assertions",
      },
    },
  },
  typeGuarantee: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this test assert something the TypeScript types already guarantee — a literal discriminant right after constructing that variant, a field equal to the argument that set it, a return type's shape?",
      criteria: {
        true: "an assertion that cannot fail once the code compiles",
        false: "every assertion checks a runtime outcome the types leave open",
      },
    },
  },
  negativeTwin: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this test prove only the absence of an unrelated failure or the falsity of a guard (a negative twin), adding nothing a positive test did not already prove?",
      criteria: {
        true: "the decisive assertion is that some other error did not happen or that a guard returns false",
        false: "the decisive assertion is a promised value, state, or event",
      },
    },
  },
};

/** Pairwise: do two tests in one file prove the same shipped promise from a second angle? */
export const TEST_PAIR = {
  reprovesSamePromise: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Do these two tests prove the same shipped promise — the second merely checking it again from another angle (count then contents, toBe then toEqual, positive then negative), so that deleting one loses no promise?",
      criteria: {
        true: "one promise, two tests; deleting either keeps every promise covered",
        false: "each test names a promise the other does not",
      },
    },
  },
};

/** Each `test("…", …)` / `it("…", …)` call: title, body, line, and its causes/asserts/narrows. */
export function sliceTests(src, file = "a.test.ts") {
  return extractTests(src, file);
}
