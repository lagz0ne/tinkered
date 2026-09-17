// Deep-chain ceiling (ADR 0016 / ledger invariant 5). Teardown, release and session nesting are
// ITERATIVE / async and must survive very deep trees (>=10k). Two BUILD-time paths recurse on the
// native stack and have finite (but unrealistic) ceilings — asserted at realistic depths, ceilings
// documented in ADR 0029.
const { createScope, resource, data } = await import("../packages/core/src/index.ts");

let fail = false;
const assert = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) fail = true;
};
const survives = (fn) => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};
const survivesAsync = async (fn) => {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
};

// --- Iterative / async paths must survive 10k (invariant 5) ---
assert(
  "create 10k-deep session tree",
  survives(() => {
    let s = createScope();
    for (let i = 0; i < 10000; i++) s = s.createSession();
  }),
);
assert(
  "close 10k-deep session tree",
  await survivesAsync(async () => {
    let s = createScope();
    for (let i = 0; i < 10000; i++) s = s.createSession();
    await s.close();
  }),
);

// --- Recursive BUILD paths: assert a realistic depth; report the ceiling ---
const chainTop = (n) => {
  let p = null;
  for (let i = 0; i < n; i++) {
    const d = p;
    p = d
      ? resource({ label: `r${i}`, depends: { d }, factory: ({ d }) => d + 1 })
      : resource({ label: "r0", factory: () => 0 });
  }
  return p;
};
assert(
  "resolve a 500-deep sync resource chain",
  survives(() => createScope().controller(chainTop(500)).resolve()),
);
assert(
  "flush through 1000 nested sessions",
  survives(() => {
    const root = createScope();
    const c = data({ label: "c", initial: 0 });
    let s = root;
    for (let i = 0; i < 1000; i++) s = s.createSession();
    s.controller(c).watch(() => {});
    root.controller(c).set(1);
  }),
);

// informational ceilings (documented limits, not asserted)
const ceiling = (fn) => {
  let lo = 100;
  let hi = 100;
  while (survives(() => fn(hi))) {
    lo = hi;
    hi *= 2;
    if (hi > 200000) break;
  }
  return `~${lo}-${hi}`;
};
console.log(
  `info: sync resource-chain ceiling ${ceiling((n) => createScope().controller(chainTop(n)).resolve())}`,
);

process.exit(fail ? 1 : 0);
