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
        "Is this operation's run body a pass-through — a single call that hands the work to a function, method, or closure that is NOT listed in the operation's depends?",
      criteria: {
        true: "the whole run is one call to an outside function, method, or closure missing from depends, usually receiving ctx or ctx.input",
        false:
          "run has its own multi-step body, or its only outside call is to a dep listed in depends; helpers take plain values or a dep delivered by depends",
      },
    },
  },
  effectWithoutDefer: {
    applies: ["resource", "operation", "function", "hook"],
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does this start something that keeps running after it returns — a timer, interval, watch, listener, subscription, poll, socket, stream, or connection — and stop it by hand (a returned close method, a finally block, a manual flag) instead of a ctx.defer hook? A function whose body only opens a session, wires one abort listener for it, and closes it in its own finally is the session owner itself, not a missed defer.",
      criteria: {
        true: "a timer, watch, listener, subscription, or stream is started and its stop is manual or missing",
        false:
          "every started thing is stopped from a ctx.defer hook, nothing keeps running, or the function's own body is the open-and-close of one session",
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
        "Does this keep a hand-rolled pending queue — a variable holding a promise that each new caller appends to with .then, so calls run one at a time in arrival order — where the scope should own the ordering instead (a resource factory with defer, ctx.signal, scope.ready, or a declared save queue)? The signature alone can name it: a helper that takes a scope handle and returns queued save and detail callers keeps a pending queue. A plain value registry (a Map whose entries are added and removed by key), a reconnecting transport's per-attempt promises and per-wire listener sets, and library or driver internals (the scope, the test clock, a stream or session adapter) are not a pending queue.",
      criteria: {
        true: "the source keeps a pending queue: a promise tail with chained .then, or a helper returning queued save and detail callers off a scope handle",
        false:
          "no pending queue appears: ordering goes through the scope, or the source only keeps a keyed registry, a transport retry, or driver internals",
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
  titleVague: {
    threshold: 0.5,
    q: {
      type: "boolean",
      instructions:
        "Does the title fail to name the outcome the body's decisive assertion checks — a vague verb (works, handles, supports, correctly), a mechanism instead of a result, or a claim the body never asserts?",
      criteria: {
        true: "a reader cannot tell from the title alone what value, state, error, or exit the body proves, or the title claims something the assertions do not check",
        false:
          "the title states the cause and the checked outcome in plain words, and the decisive assertion checks exactly that",
      },
    },
  },
};

/** Each `test("…", …)` / `it("…", …)` call: title, body, line, and its causes/asserts/narrows. */
export function sliceTests(src, file = "a.test.ts") {
  return extractTests(src, file);
}

// ---------- survivors: one anti-goal judge per surviving mutant (survivors.mjs) ----------
export const SURVIVORS = {
  survivorMatters: {
    // 0.7 from the first 10 labels (2026-09-21): false cases reached 76%, true cases start at 81%.
    threshold: 0.7,
    q: {
      type: "boolean",
      instructions:
        "This mutant survived every test: inside the unit shown, the code `before` became `after` and no test failed. Would a user of this package observe a wrong result, a missed error, a wrong count, or a leak if this change shipped?",
      criteria: {
        true: "the change alters a value, a branch, an error code, an ordering, or a cleanup a caller can observe — a boundary, a returned field, a thrown code, a defer, a limit",
        false:
          "the change touches only a message or label string, a log line, an expression with the same result, unreachable or dead code, or a speed-only path with the same outcome",
      },
    },
  },
};

const isSurvivor = (m) => m.status === "Survived" || m.status === "NoCoverage";

/** The original text a mutant replaced: `source` sliced from start to end (1-based lines and columns). */
function spanText(source, start, end) {
  const lines = source.split("\n");
  const at = (line, from = 0, to) => (lines[line - 1] ?? "").slice(from, to);
  if (start.line === end.line) return at(start.line, start.column - 1, end.column - 1);
  const out = [at(start.line, start.column - 1)];
  for (let line = start.line + 1; line < end.line; line++) out.push(lines[line - 1] ?? "");
  out.push(at(end.line, 0, end.column - 1));
  return out.join("\n");
}

/** The unit enclosing the mutant span, or a ±15-line window named `module#<file>`. */
function enclosingUnit(units, file, source, startLine, endLine) {
  for (const u of units) {
    const end = u.line + u.source.split("\n").length - 1;
    if (u.line <= startLine && startLine <= end)
      return { unit: { kind: u.kind, name: u.name }, source: u.source };
  }
  const lines = source.split("\n");
  const from = Math.max(1, startLine - 15);
  const to = Math.min(lines.length, endLine + 15);
  return { unit: { kind: "module", name: file }, source: lines.slice(from - 1, to).join("\n") };
}

/** One file's survivors, in report order. */
function sliceFile(key, entry, pkgDir) {
  const file = pkgDir ? `${pkgDir}/${key}` : key;
  const source = entry.source ?? "";
  const units = extractUnits(source, key);
  return (entry.mutants ?? []).filter(isSurvivor).map((m) => {
    const enclosed = enclosingUnit(units, key, source, m.location.start.line, m.location.end.line);
    return {
      id: `${file}#${m.id}`,
      file,
      line: m.location.start.line,
      column: m.location.start.column,
      mutator: m.mutatorName,
      status: m.status,
      before: spanText(source, m.location.start, m.location.end),
      after: m.replacement ?? "",
      unit: enclosed.unit,
      source: enclosed.source,
    };
  });
}

/** Every survivor in a Stryker JSON report: the fields the judge depends on, nothing else. */
export function sliceSurvivors(report, pkgDir = "") {
  return Object.entries(report.files ?? {}).flatMap(([key, entry]) =>
    sliceFile(key, entry, pkgDir),
  );
}

/** The fields the decision depends on — not `id`, not `status`. */
export const forSurvivorJev = ({ file, unit, line, mutator, before, after, source }) => ({
  file,
  unit: `${unit.kind}#${unit.name}`,
  line,
  mutator,
  before,
  after,
  source,
});
