// The Jev lint + guide bank (plan: docs/roadmap/jev-loop/PLAN.md, "lint + guide").
//
// Shape borrowed from ESLint: a deterministic selector finds one node (here: one declared
// unit or one top-level function), each rule asks one narrow question about it, and code
// applies the threshold and prints. Jev supplies only the yes/no or the pick; it never
// locates, counts, or gates. Every question ships with a bad/clean fixture pair in
// evals/fixtures/lint.mjs and stays in the bank only while evals/lint.mjs shows >= 30 points
// of separation. Advisory: vp check / tests / mutate / the lead still decide.

// ---------- slicer (deterministic: Jev never locates or counts) ----------
const QUOTES = new Set(['"', "'", "`"]);
const COMMENT = new Set(["/", "*"]);
const DEPTH = { "(": 1, "[": 1, "{": 1, ")": -1, "]": -1, "}": -1 };

function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== quote) j += src[j] === "\\" ? 2 : 1;
  return j + 1;
}

function skipComment(src, i) {
  const line = src[i + 1] === "/";
  const end = line ? src.indexOf("\n", i) : src.indexOf("*/", i + 2);
  if (end < 0) return src.length;
  return line ? end + 1 : end + 2;
}

/** Index just past the bracket that closes the opener at `i`; strings and comments skipped. */
export function walk(src, i) {
  let depth = 0;
  for (let j = i; j < src.length;) {
    const ch = src[j];
    if (QUOTES.has(ch)) {
      j = skipString(src, j);
      continue;
    }
    if (ch === "/" && COMMENT.has(src[j + 1])) {
      j = skipComment(src, j);
      continue;
    }
    depth += DEPTH[ch] ?? 0;
    if (depth === 0) return j + 1;
    j++;
  }
  return src.length;
}

const UNIT =
  /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(data|resource|operation|tag|extension)\s*(?:<[\s\S]*?>)?\s*\(/g;
const FN = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
const ARROW =
  /(?:export\s+)?const\s+([A-Z]\w*)\s*=\s*(?:\([^)]*\)|[A-Za-z_]\w*)\s*(?::\s*[^=>{]+)?=>\s*/g;

/** A capitalised function in a .tsx file is a component; a use* function is a hook. */
function kindOf(name, file) {
  if (file.endsWith(".tsx") && /^[A-Z]/.test(name)) return "component";
  if (/^use[A-Z]/.test(name)) return "hook";
  return "function";
}

const lineOf = (src, at) => src.slice(0, at).split("\n").length;
const unit = (src, kind, name, start, end) => ({
  kind,
  name,
  line: lineOf(src, start),
  start,
  end,
  source: src.slice(start, end),
});

function fromCall(src, m) {
  const open = m.index + m[0].length - 1;
  return unit(src, m[2], m[1], m.index, walk(src, open));
}

function fromFunction(src, m, file) {
  const params = walk(src, m.index + m[0].length - 1);
  const body = src.indexOf("{", params);
  return body < 0 ? null : unit(src, kindOf(m[1], file), m[1], m.index, walk(src, body));
}

/** An arrow component: `const Name = (props) => {` or `=> (`; expression bodies are skipped. */
function fromArrow(src, m) {
  const at = m.index + m[0].length;
  if (src[at] !== "{" && src[at] !== "(") return null;
  return unit(src, "component", m[1], m.index, walk(src, at));
}

const byStart = (a, b) => a.start - b.start;
const encloses = (outer, inner) => inner.start > outer.start && inner.end <= outer.end;

function outermost(units) {
  const kept = [];
  let end = -1;
  for (const u of units.sort(byStart)) {
    if (u.start >= end) {
      kept.push(u);
      end = u.end;
    }
  }
  return kept;
}

/** Every declared unit plus each outermost function that declares none (a function that
 *  declares units is a composition root or a tour, not a primitive candidate). */
export function slice(src, file = "") {
  const declared = [...src.matchAll(UNIT)].map((m) => fromCall(src, m));
  const arrows = file.endsWith(".tsx")
    ? [...src.matchAll(ARROW)].map((m) => fromArrow(src, m))
    : [];
  const fns = outermost(
    [...[...src.matchAll(FN)].map((m) => fromFunction(src, m, file)), ...arrows].filter(Boolean),
  ).filter((f) => !declared.some((u) => encloses(f, u)));
  return [...declared, ...fns].sort(byStart);
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
