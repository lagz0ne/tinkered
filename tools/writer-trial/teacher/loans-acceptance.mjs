import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance for the tool library task. Runs only inside
// the disposable container: submitted code is imported here, never on the
// host. Every case comes from the frozen task text. Case-level results; any
// error or missing check fails its case, never passes. Later cases still run.
// Browser cases find things by role and accessible name only, and read table
// cells by their column header, so a different DOM layout still passes.
const root = process.argv[2];
assert.ok(root, "usage: loans-acceptance.mjs <submission-dir>");

const results = [];
const advisory = [];
const test = async (name, fn) => {
  try {
    const detail = await fn();
    results.push({
      name,
      pass: true,
      ...(detail === undefined ? {} : { detail: String(detail).slice(0, 160) }),
    });
  } catch (error) {
    results.push({ name, pass: false, error: (error?.message ?? String(error)).slice(0, 300) });
  }
};

for (const c of shapeCases(root).cases) results.push(c);
for (const a of shapeCases(root).advisory) advisory.push(a);
advisory.push({
  name: "ownership evidence is manual",
  detail:
    "React state shape and unknown-error rethrow are lead-review notes, never a pass; only exact-syntax shape cases fail.",
});

const finish = () => {
  for (const r of results) {
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.name}${r.pass && r.detail ? ` — ${r.detail}` : ""}${r.pass ? "" : ` — ${r.error}`}`,
    );
  }
  for (const a of advisory) console.log(`NOTE ${a.name} — ${a.detail}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`ACCEPTANCE loans: ${results.length - failed.length}/${results.length} pass`);
  console.log(`RESULTS_JSON ${JSON.stringify({ cases: results, advisory })}`);
  process.exitCode = failed.length ? 1 : 0;
};

// ---- core checks: public entry, createScope, scope.run, scope.resolve ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-loans-core",
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
let app;
let coreMod;
let loadError;
try {
  app = await vite.ssrLoadModule("/src/index.ts");
  coreMod = await vite.ssrLoadModule("@tinker/core");
} catch (error) {
  loadError = error?.message ?? String(error);
}

const API = [
  "LibraryApp",
  "addTool",
  "isError",
  "lendTool",
  "loans",
  "retireTool",
  "returnLoan",
  "setCopies",
  "tools",
  "undoLibrary",
];
const need = (value, label) => {
  assert.ok(value, `missing export: ${label}`);
  return value;
};
const toolList = (s) => s.resolve(need(app.tools, "tools"));
const loanList = (s) => s.resolve(need(app.loans, "loans"));
// Plain clones: a broken in-place write must not pass by comparing a
// record against its own mutated alias.
const snap = (s) => ({
  tools: toolList(s).map((t) => ({ ...t })),
  loans: loanList(s).map((l) => ({ ...l })),
});
const addOne = (s, name, copies = "2") => s.run(app.addTool, { input: { name, copies } });
const lend = (s, toolId, member) => s.run(app.lendTool, { input: { toolId, member } });
const retire = (s, toolId) => s.run(app.retireTool, { input: { toolId } });
const setTo = (s, toolId, copies) => s.run(app.setCopies, { input: { toolId, copies } });
const giveBack = (s, loanId) => s.run(app.returnLoan, { input: { loanId } });
const undo = (s) => s.run(app.undoLibrary, {});
const caught = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("want a thrown managed error");
};
// One failing call: the kind, the exact payload, and tools and loans
// left exactly as they were.
const failsWith = (s, op, input, kind, payload) => {
  const before = snap(s);
  const error = caught(() => s.run(op, { input }));
  assert.equal(error?.kind, kind, `want ${kind} for ${JSON.stringify(input)}`);
  assert.deepStrictEqual(error.payload, payload);
  assert.deepStrictEqual(snap(s), before, `${kind} changed tools or loans`);
  return error;
};
// Undo history depth, read by undoing until EmptyUndo {}. It empties the
// scope's history, so it runs last in a case.
const undoCount = (s) => {
  let depth = 0;
  for (;;) {
    try {
      undo(s);
    } catch (error) {
      assert.equal(error?.kind, "EmptyUndo");
      assert.deepStrictEqual(error.payload, {});
      return depth;
    }
    depth++;
    assert.ok(depth < 200, "undo never reached EmptyUndo");
  }
};
const inScope = async (fn) => {
  const s = coreMod.createScope();
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
};
// A retired tool with open loans cannot be built through the operations,
// yet the task names it twice. Write the exported cells through the scope's
// public controller to reach it.
const seedRetiredOnLoan = (s) => {
  s.controller(app.tools).set([{ id: "seed-tool-1", name: "Drill", copies: 2, retired: true }]);
  s.controller(app.loans).set([
    { id: "seed-loan-1", toolId: "seed-tool-1", member: "Ann" },
    { id: "seed-loan-2", toolId: "seed-tool-1", member: "Bob" },
  ]);
};

const coreTests = [];
const core = (name, fn) => coreTests.push([name, fn]);

core("core entry exports exactly the named API", async () => {
  assert.ok(!loadError, loadError);
  for (const label of API) need(app[label], label);
  assert.deepStrictEqual(Object.keys(app).sort(), API);
  return API.join(", ");
});

core("core each scope starts with no tools, no loans, and EmptyUndo {}", () =>
  inScope((s) => {
    assert.deepStrictEqual(toolList(s), []);
    assert.deepStrictEqual(loanList(s), []);
    const error = caught(() => undo(s));
    assert.equal(error?.kind, "EmptyUndo");
    assert.deepStrictEqual(error.payload, {});
    return "empty lists, EmptyUndo {}";
  }),
);

core("core add trims the name, parses copies, and appends in order", () =>
  inScope((s) => {
    const a = addOne(s, "  Drill  ", "2");
    assert.ok(typeof a.id === "string" && a.id.length > 0, "nonempty id");
    assert.deepStrictEqual({ ...a }, { id: a.id, name: "Drill", copies: 2, retired: false });
    const b = addOne(s, "Drill", " 20 ");
    const c = addOne(s, "Saw", "1");
    assert.equal(new Set([a.id, b.id, c.id]).size, 3, "ids distinct");
    assert.deepStrictEqual(snap(s).tools, [
      { id: a.id, name: "Drill", copies: 2, retired: false },
      { id: b.id, name: "Drill", copies: 20, retired: false },
      { id: c.id, name: "Saw", copies: 1, retired: false },
    ]);
    return "trimmed, duplicate names, 20 and 1 kept, creation order";
  }),
);

const BAD_COPIES = [
  "",
  "   ",
  "0",
  " 0 ",
  "21",
  "+3",
  "-2",
  "3.0",
  "1.5",
  "1 2",
  "abc",
  "3a",
  "1e1",
  3,
  null,
  undefined,
  true,
];

core("core bad copies text reports BadCopies with the original value", () =>
  inScope((s) => {
    for (const copies of BAD_COPIES)
      failsWith(s, app.addTool, { name: "Drill", copies }, "BadCopies", { copies });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_COPIES.length} bad values, none defaulted`;
  }),
);

core("core setCopies checks copies text before any other rule", () =>
  inScope((s) => {
    const kept = addOne(s, "Drill", "2");
    const gone = addOne(s, "Saw", "1");
    lend(s, kept.id, "Ann");
    retire(s, gone.id);
    for (const copies of ["abc", "", "0", "1 2", 1])
      failsWith(s, app.setCopies, { toolId: gone.id, copies }, "BadCopies", { copies });
    failsWith(s, app.setCopies, { toolId: kept.id, copies: "21" }, "BadCopies", { copies: "21" });
    failsWith(s, app.setCopies, { toolId: kept.id, copies: " " }, "BadCopies", { copies: " " });
    assert.equal(undoCount(s), 4);
    return "BadCopies before Retired, same value, and BelowLoans";
  }),
);

core("core blank names keep the original value", () =>
  inScope((s) => {
    for (const name of ["", "   ", 42, null, undefined])
      failsWith(s, app.addTool, { name, copies: "2" }, "BlankName", { name });
    assert.equal(undoCount(s), 0);
    return "raw values kept, nothing written";
  }),
);

core("core blank members keep the original value", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "2");
    for (const member of ["", "  ", 7, null])
      failsWith(s, app.lendTool, { toolId: tool.id, member }, "BlankMember", { member });
    assert.equal(undoCount(s), 1);
    return "raw values kept, no loan";
  }),
);

core("core unknown tool and loan ids report NotFound", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "2");
    const id = "missing-tool";
    failsWith(s, app.setCopies, { toolId: id, copies: "3" }, "NotFound", { id });
    failsWith(s, app.retireTool, { toolId: id }, "NotFound", { id });
    failsWith(s, app.lendTool, { toolId: id, member: "Ann" }, "NotFound", { id });
    failsWith(s, app.returnLoan, { loanId: "missing-loan" }, "NotFound", { id: "missing-loan" });
    const loan = lend(s, tool.id, "Ann");
    giveBack(s, loan.id);
    failsWith(s, app.returnLoan, { loanId: loan.id }, "NotFound", { id: loan.id });
    assert.equal(undoCount(s), 3);
    return "set, retire, lend, return, returned twice";
  }),
);

core("core lend trims the member and appends loans in order", () =>
  inScope((s) => {
    const drill = addOne(s, "Drill", "2");
    const saw = addOne(s, "Saw", "2");
    const first = lend(s, drill.id, "  Ann  ");
    assert.ok(typeof first.id === "string" && first.id.length > 0, "nonempty loan id");
    assert.deepStrictEqual({ ...first }, { id: first.id, toolId: drill.id, member: "Ann" });
    const second = lend(s, saw.id, "Bob");
    const third = lend(s, drill.id, "Cy");
    assert.equal(new Set([first.id, second.id, third.id]).size, 3);
    assert.deepStrictEqual(snap(s).loans, [
      { id: first.id, toolId: drill.id, member: "Ann" },
      { id: second.id, toolId: saw.id, member: "Bob" },
      { id: third.id, toolId: drill.id, member: "Cy" },
    ]);
    return "trimmed member, creation order";
  }),
);

core("core lend on a retired tool reports Retired", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "2");
    retire(s, tool.id);
    failsWith(s, app.lendTool, { toolId: tool.id, member: "Ann" }, "Retired", { id: tool.id });
    return "never lent again";
  }),
);

core("core lend with no copy left reports NoCopyLeft", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "1");
    lend(s, tool.id, "Ann");
    failsWith(s, app.lendTool, { toolId: tool.id, member: "Bob" }, "NoCopyLeft", {
      id: tool.id,
    });
    return "open loans equal copies";
  }),
);

core("core fourth loan for one member reports MemberLimit", () =>
  inScope((s) => {
    const ids = ["A", "B", "C", "D"].map((name) => addOne(s, name, "2").id);
    for (const id of ids.slice(0, 3)) lend(s, id, "Ann");
    failsWith(s, app.lendTool, { toolId: ids[3], member: "  Ann " }, "MemberLimit", {
      member: "Ann",
    });
    lend(s, ids[3], "Bob");
    return "trimmed member in payload; others still borrow";
  }),
);

core("core repeat lend returns the existing loan with no undo step", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "2");
    const loan = lend(s, tool.id, "Ann");
    const before = snap(s);
    assert.deepStrictEqual(lend(s, tool.id, " Ann "), loan);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "same loan, no step";
  }),
);

core("core repeat lend passes even with no copy left", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "1");
    const loan = lend(s, tool.id, "Ann");
    const before = snap(s);
    assert.deepStrictEqual(lend(s, tool.id, "Ann"), loan);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "held loan beats NoCopyLeft";
  }),
);

core("core repeat lend passes even at the member limit", () =>
  inScope((s) => {
    const ids = ["A", "B", "C"].map((name) => addOne(s, name, "2").id);
    const held = ids.map((id) => lend(s, id, "Ann"));
    const before = snap(s);
    assert.deepStrictEqual(lend(s, ids[1], "Ann"), held[1]);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 6);
    return "held loan beats MemberLimit";
  }),
);

core("core repeat lend passes even when the tool is retired", () =>
  inScope((s) => {
    seedRetiredOnLoan(s);
    const before = snap(s);
    const again = lend(s, "seed-tool-1", "Ann");
    assert.deepStrictEqual({ ...again }, before.loans[0]);
    assert.deepStrictEqual(snap(s), before);
    failsWith(s, app.lendTool, { toolId: "seed-tool-1", member: "Cy" }, "Retired", {
      id: "seed-tool-1",
    });
    assert.equal(undoCount(s), 0);
    return "held loan beats Retired";
  }),
);

core("core return removes the loan with one undo step", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "2");
    const first = lend(s, tool.id, "Ann");
    const second = lend(s, tool.id, "Bob");
    const before = snap(s);
    assert.equal(giveBack(s, first.id), undefined);
    assert.deepStrictEqual(snap(s).loans, [{ ...second }]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "loan gone, undo brings it back in place";
  }),
);

core("core retire marks the tool retired and keeps it listed", () =>
  inScope((s) => {
    const drill = addOne(s, "Drill", "2");
    const saw = addOne(s, "Saw", "1");
    const done = retire(s, drill.id);
    assert.deepStrictEqual({ ...done }, { ...drill, retired: true });
    assert.deepStrictEqual(snap(s).tools, [{ ...drill, retired: true }, { ...saw }]);
    undo(s);
    assert.deepStrictEqual(snap(s).tools, [{ ...drill }, { ...saw }]);
    return "retired in place, one step";
  }),
);

core("core retire with open loans reports OnLoan in saved loan order", () =>
  inScope((s) => {
    const drill = addOne(s, "Drill", "3");
    const saw = addOne(s, "Saw", "2");
    const zed = lend(s, drill.id, "Zed");
    lend(s, saw.id, "Zed");
    const amy = lend(s, drill.id, "Amy");
    failsWith(s, app.retireTool, { toolId: drill.id }, "OnLoan", {
      id: drill.id,
      loanIds: [zed.id, amy.id],
    });
    return "only this tool's loans, saved order";
  }),
);

core("core retire repeat passes with no undo step", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "2");
    const done = retire(s, tool.id);
    const before = snap(s);
    assert.deepStrictEqual(retire(s, tool.id), done);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "saved tool returned, no step";
  }),
);

core("core retire repeat passes even with open loans", () =>
  inScope((s) => {
    seedRetiredOnLoan(s);
    const before = snap(s);
    const again = retire(s, "seed-tool-1");
    assert.deepStrictEqual({ ...again }, before.tools[0]);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 0);
    return "already retired beats OnLoan";
  }),
);

core("core setCopies changes only copies with one undo step", () =>
  inScope((s) => {
    const drill = addOne(s, "Drill", "2");
    const saw = addOne(s, "Saw", "1");
    const changed = setTo(s, drill.id, " 5 ");
    assert.deepStrictEqual({ ...changed }, { ...drill, copies: 5 });
    assert.deepStrictEqual(snap(s).tools, [{ ...drill, copies: 5 }, { ...saw }]);
    undo(s);
    assert.deepStrictEqual(snap(s).tools, [{ ...drill }, { ...saw }]);
    return "copies only, order kept";
  }),
);

core("core setCopies same value passes with no step, even when retired", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "3");
    const before = snap(s);
    assert.deepStrictEqual({ ...setTo(s, tool.id, "3") }, { ...tool });
    assert.deepStrictEqual(snap(s), before);
    const done = retire(s, tool.id);
    assert.deepStrictEqual({ ...setTo(s, tool.id, " 3 ") }, { ...done });
    assert.equal(undoCount(s), 2);
    return "saved tool returned, no step";
  }),
);

core("core setCopies on a retired tool reports Retired", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "3");
    retire(s, tool.id);
    failsWith(s, app.setCopies, { toolId: tool.id, copies: "4" }, "Retired", { id: tool.id });
    return "retired tool locked";
  }),
);

core("core setCopies below open loans reports BelowLoans", () =>
  inScope((s) => {
    const tool = addOne(s, "Drill", "3");
    lend(s, tool.id, "Ann");
    lend(s, tool.id, "Bob");
    failsWith(s, app.setCopies, { toolId: tool.id, copies: "1" }, "BelowLoans", {
      id: tool.id,
      onLoan: 2,
    });
    assert.equal(setTo(s, tool.id, "2").copies, 2);
    return "below fails, equal passes";
  }),
);

core("core failed actions leave tools, loans, and undo unchanged", () =>
  inScope((s) => {
    const [one, two, three, four, five] = ["A", "B", "C", "D", "E"].map(
      (name, i) => addOne(s, name, i === 0 ? "1" : "2").id,
    );
    for (const id of [one, two, three]) lend(s, id, "Ann");
    retire(s, four);
    const tries = [
      [app.lendTool, { toolId: one, member: "Bob" }, "NoCopyLeft"],
      [app.lendTool, { toolId: four, member: "Bob" }, "Retired"],
      [app.lendTool, { toolId: five, member: "Ann" }, "MemberLimit"],
      [app.retireTool, { toolId: one }, "OnLoan"],
      [app.setCopies, { toolId: four, copies: "3" }, "Retired"],
      [app.setCopies, { toolId: two, copies: "0" }, "BadCopies"],
      [app.addTool, { name: " ", copies: "2" }, "BlankName"],
      [app.lendTool, { toolId: five, member: " " }, "BlankMember"],
      [app.returnLoan, { loanId: "missing-loan" }, "NotFound"],
    ];
    for (const [op, input, kind] of tries) {
      const before = snap(s);
      assert.equal(caught(() => s.run(op, { input }))?.kind, kind);
      assert.deepStrictEqual(snap(s), before, `${kind} changed tools or loans`);
    }
    assert.equal(undoCount(s), 9);
    assert.deepStrictEqual(snap(s), { tools: [], loans: [] });
    return "9 kinds, no write, no step";
  }),
);

core("core undo restores the exact tools and loans in order", () =>
  inScope((s) => {
    const steps = [snap(s)];
    const drill = addOne(s, "Drill", "2");
    steps.push(snap(s));
    const saw = addOne(s, "Saw", "1");
    steps.push(snap(s));
    const ann = lend(s, drill.id, "Ann");
    steps.push(snap(s));
    lend(s, saw.id, "Bob");
    steps.push(snap(s));
    setTo(s, drill.id, "3");
    steps.push(snap(s));
    giveBack(s, ann.id);
    steps.push(snap(s));
    retire(s, drill.id);
    for (const want of steps.reverse()) {
      assert.equal(undo(s), undefined);
      assert.deepStrictEqual(snap(s), want);
    }
    assert.equal(caught(() => undo(s))?.kind, "EmptyUndo");
    return "seven steps back, exact order";
  }),
);

core("core ids stay unique and are never reused after undo", () =>
  inScope((s) => {
    const a = addOne(s, "Drill", "2");
    const b = addOne(s, "Saw", "2");
    const l = lend(s, a.id, "Ann");
    undo(s);
    undo(s);
    undo(s);
    const seen = new Set([a.id, b.id, l.id]);
    const c = addOne(s, "Drill", "2");
    const d = addOne(s, "Saw", "2");
    const m = lend(s, c.id, "Ann");
    for (const id of [c.id, d.id, m.id]) assert.ok(!seen.has(id), `id ${id} reused`);
    assert.equal(new Set([c.id, d.id, m.id]).size, 3);
    return "fresh ids after undo";
  }),
);

core("core two scopes share nothing", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    const tool = addOne(a, "Drill", "2");
    lend(a, tool.id, "Ann");
    assert.deepStrictEqual(snap(b), { tools: [], loans: [] });
    assert.equal(caught(() => undo(b))?.kind, "EmptyUndo");
    addOne(b, "Saw", "1");
    assert.deepStrictEqual(
      toolList(a).map((t) => t.name),
      ["Drill"],
    );
    assert.equal(loanList(a).length, 1);
    return "separate records and history";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core thrown errors narrow through isError", () =>
  inScope((s) => {
    const bad = caught(() => addOne(s, "Drill", "abc"));
    assert.ok(app.isError(bad, "BadCopies"), "want BadCopies");
    assert.ok(!app.isError(bad, "NotFound"), "BadCopies is not NotFound");
    assert.deepStrictEqual(bad.payload, { copies: "abc" });
    const gone = caught(() => retire(s, "missing-tool"));
    assert.ok(app.isError(gone, "NotFound"), "want NotFound");
    const empty = caught(() => undo(s));
    assert.ok(app.isError(empty, "EmptyUndo"), "want EmptyUndo");
    return "BadCopies, NotFound, EmptyUndo";
  }),
);

// ---- browser checks: real Chromium, fresh mounts ----
const URL_ROOT = "http://127.0.0.1:5173";
const browserTests = [];
const browser = (name, fn) => browserTests.push([name, fn]);

const nameBox = (scope) => scope.getByLabel("Name", { exact: true });
const copiesBox = (scope) => scope.getByLabel("Copies", { exact: true });
const memberBox = (scope) => scope.getByLabel("Member", { exact: true });
const toolBox = (scope) => scope.getByRole("combobox", { name: "Tool", exact: true });
const toolsTable = (scope) => scope.getByRole("table", { name: "Tools", exact: true });
const loansTable = (scope) => scope.getByRole("table", { name: "Loans", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });

const pause = () => new Promise((done) => setTimeout(done, 50));
// Poll a read until it equals the wanted value; the last read is the error.
const settle = async (read, want) => {
  let last;
  for (let i = 0; i < 60; i++) {
    last = await read();
    if (JSON.stringify(last) === JSON.stringify(want)) return;
    await pause();
  }
  assert.deepStrictEqual(last, want);
};

const cellsOf = async (row) => {
  const cells = row
    .getByRole("cell")
    .or(row.getByRole("columnheader"))
    .or(row.getByRole("rowheader"));
  // A cell's own text without its controls: the task names the buttons
  // but not where they sit, so a Retire or Return button inside the
  // Status or Member cell must not change what the cell says.
  return cells.evaluateAll((all) =>
    all.map((cell) => {
      const copy = cell.cloneNode(true);
      for (const control of copy.querySelectorAll("button, input, select, textarea, [role=button]"))
        control.remove();
      return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    }),
  );
};
// Rows of a named table by header text: the header row is the first row
// naming every wanted column, whatever role its cells get. Extra columns
// and column order are free; hidden (filtered) rows are skipped by role.
const readTable = async (table, columns) => {
  const rows = [];
  for (const row of await table.getByRole("row").all()) rows.push(await cellsOf(row));
  const head = rows.findIndex((cells) => columns.every((column) => cells.includes(column)));
  assert.ok(head >= 0, `want columns ${columns.join(", ")}; found ${rows[0]?.join(", ") ?? ""}`);
  const at = columns.map((column) => rows[head].indexOf(column));
  return rows.slice(head + 1).map((cells) => at.map((i) => cells[i]));
};
const TOOL_COLUMNS = ["Name", "Copies", "Out", "Status"];
const toolRowsOf = (scope) => readTable(toolsTable(scope), TOOL_COLUMNS);
const toolNames = async (scope) =>
  (await readTable(toolsTable(scope), ["Name"])).map((row) => row[0]);
const loanRowsOf = (scope) => readTable(loansTable(scope), ["Tool", "Member"]);

// One shared alert block: more than one role=alert fails. Empty or absent
// both count as no notice.
const alertText = async (scope) => {
  const alerts = scope.getByRole("alert");
  const count = await alerts.count();
  assert.ok(count <= 1, `want one shared alert, found ${count}`);
  return count === 0 ? "" : (await alerts.first().innerText()).trim();
};
const seeAlert = async (scope, kind) => {
  let last = "";
  for (let i = 0; i < 60; i++) {
    last = await alertText(scope);
    if (last.includes(kind)) return;
    await pause();
  }
  assert.fail(`want alert ${kind}, got "${last}"`);
};
const noAlert = (scope) => settle(() => alertText(scope), "");

const addTool = async (scope, name, copies) => {
  await nameBox(scope).fill(name);
  await copiesBox(scope).fill(copies);
  await button(scope, "Add tool").click();
};
const addTools = async (scope, rows) => {
  for (const [name, copies] of rows) {
    await addTool(scope, name, copies);
    await button(scope, `Retire ${name}`).first().waitFor();
  }
};
const lendTo = async (scope, toolName, member) => {
  await toolBox(scope).selectOption({ label: toolName });
  await memberBox(scope).fill(member);
  await button(scope, "Lend").click();
};
const raiseBlankName = async (scope) => {
  await nameBox(scope).fill("   ");
  await copiesBox(scope).fill("2");
  await button(scope, "Add tool").click();
  await seeAlert(scope, "BlankName");
};
const open = async (page) => {
  await page.goto(URL_ROOT);
  await toolsTable(page).waitFor();
};

browser("browser loads empty forms, both tables, and the filters", async (page) => {
  await open(page);
  assert.equal(await nameBox(page).inputValue(), "");
  assert.equal(await copiesBox(page).inputValue(), "");
  assert.equal(await memberBox(page).inputValue(), "");
  assert.equal(await toolBox(page).inputValue(), "");
  const labels = await toolBox(page)
    .locator("option")
    .evaluateAll((options) => options.map((o) => o.textContent?.trim() ?? ""));
  assert.deepStrictEqual(labels, ["Choose tool"]);
  for (const name of ["Add tool", "Lend", "Undo", "All", "Available", "Retired"])
    await button(page, name).waitFor();
  assert.ok(await button(page, "Undo").isEnabled(), "Undo enabled on empty history");
  assert.deepStrictEqual(await toolRowsOf(page), []);
  assert.deepStrictEqual(await loanRowsOf(page), []);
  assert.equal(await alertText(page), "");
  return "inputs empty, Choose tool, tables with named columns";
});

browser("browser add tool appends a row and clears both inputs", async (page) => {
  await open(page);
  await addTool(page, "  Drill  ", "2");
  await settle(() => toolRowsOf(page), [["Drill", "2", "0", "Available"]]);
  assert.equal(await nameBox(page).inputValue(), "");
  assert.equal(await copiesBox(page).inputValue(), "");
  await addTool(page, "Saw", " 1 ");
  await settle(
    () => toolRowsOf(page),
    [
      ["Drill", "2", "0", "Available"],
      ["Saw", "1", "0", "Available"],
    ],
  );
  assert.equal(await alertText(page), "");
  return "trimmed, creation order, inputs cleared";
});

browser("browser bad copies keeps the form text and shows BadCopies", async (page) => {
  await open(page);
  await addTool(page, "Saw", "abc");
  await seeAlert(page, "BadCopies");
  assert.equal(await nameBox(page).inputValue(), "Saw");
  assert.equal(await copiesBox(page).inputValue(), "abc");
  await copiesBox(page).fill("");
  await button(page, "Add tool").click();
  await seeAlert(page, "BadCopies");
  assert.equal(await nameBox(page).inputValue(), "Saw");
  assert.deepStrictEqual(await toolRowsOf(page), []);
  return "abc and blank both refused, text kept";
});

browser("browser blank name keeps the form text and shows BlankName", async (page) => {
  await open(page);
  await raiseBlankName(page);
  assert.equal(await nameBox(page).inputValue(), "   ");
  assert.equal(await copiesBox(page).inputValue(), "2");
  assert.deepStrictEqual(await toolRowsOf(page), []);
  return "BlankName, text kept, nothing saved";
});

browser("browser select lists every tool by name with its id", async (page) => {
  await open(page);
  await addTools(page, [
    ["Drill", "2"],
    ["Saw", "1"],
  ]);
  await button(page, "Retire Saw").click();
  await settle(() => toolNames(page), ["Drill", "Saw"]);
  const options = await toolBox(page)
    .locator("option")
    .evaluateAll((all) => all.map((o) => [o.textContent?.trim() ?? "", o.value]));
  assert.deepStrictEqual(
    options.map(([label]) => label),
    ["Choose tool", "Drill", "Saw"],
  );
  assert.equal(options[0][1], "");
  assert.ok(options[1][1] !== "" && options[2][1] !== "", "ids as values");
  assert.notEqual(options[1][1], options[2][1]);
  return "creation order, retired kept, ids as values";
});

browser("browser lend adds a loan row and keeps the lend form", async (page) => {
  await open(page);
  await addTools(page, [["Drill", "1"]]);
  await lendTo(page, "Drill", " Ann ");
  await settle(() => loanRowsOf(page), [["Drill", "Ann"]]);
  await settle(() => toolRowsOf(page), [["Drill", "1", "1", "Out"]]);
  assert.equal(await memberBox(page).inputValue(), " Ann ");
  assert.equal(await toolBox(page).locator("option:checked").innerText(), "Drill");
  assert.notEqual(await toolBox(page).inputValue(), "");
  await button(page, "Return Drill from Ann").waitFor();
  assert.equal(await alertText(page), "");
  return "loan row, Out 1, status Out, form kept";
});

browser("browser return button removes the loan", async (page) => {
  await open(page);
  await addTools(page, [["Drill", "2"]]);
  await lendTo(page, "Drill", "Ann");
  await lendTo(page, "Drill", "Bob");
  await settle(
    () => loanRowsOf(page),
    [
      ["Drill", "Ann"],
      ["Drill", "Bob"],
    ],
  );
  await settle(() => toolRowsOf(page), [["Drill", "2", "2", "Out"]]);
  await button(page, "Return Drill from Ann").click();
  await settle(() => loanRowsOf(page), [["Drill", "Bob"]]);
  await settle(() => toolRowsOf(page), [["Drill", "2", "1", "Available"]]);
  return "loan gone, Out drops, Available again";
});

browser("browser failed lend shows the kind and keeps the lend form", async (page) => {
  await open(page);
  await addTools(page, [["Drill", "1"]]);
  await lendTo(page, "Drill", "Ann");
  await settle(() => loanRowsOf(page), [["Drill", "Ann"]]);
  await memberBox(page).fill("Bob");
  await button(page, "Lend").click();
  await seeAlert(page, "NoCopyLeft");
  assert.equal(await memberBox(page).inputValue(), "Bob");
  assert.equal(await toolBox(page).locator("option:checked").innerText(), "Drill");
  assert.deepStrictEqual(await loanRowsOf(page), [["Drill", "Ann"]]);
  return "NoCopyLeft, tool and member kept";
});

browser("browser retire shows Retired and drops its Retire button", async (page) => {
  await open(page);
  await addTools(page, [
    ["Drill", "2"],
    ["Saw", "1"],
  ]);
  await button(page, "Retire Saw").click();
  await settle(
    () => toolRowsOf(page),
    [
      ["Drill", "2", "0", "Available"],
      ["Saw", "1", "0", "Retired"],
    ],
  );
  assert.equal(await button(page, "Retire Saw").count(), 0);
  assert.equal(await button(page, "Retire Drill").count(), 1);
  return "Retired status, row kept, no Retire Saw";
});

browser("browser blocked retire shows OnLoan and keeps the row", async (page) => {
  await open(page);
  await addTools(page, [["Drill", "2"]]);
  await lendTo(page, "Drill", "Ann");
  await settle(() => toolRowsOf(page), [["Drill", "2", "1", "Available"]]);
  assert.ok(await button(page, "Retire Drill").isEnabled(), "Retire stays enabled");
  await button(page, "Retire Drill").click();
  await seeAlert(page, "OnLoan");
  assert.deepStrictEqual(await toolRowsOf(page), [["Drill", "2", "1", "Available"]]);
  return "OnLoan shown, nothing retired";
});

browser("browser filters show Available and Retired rows live", async (page) => {
  await open(page);
  await addTools(page, [
    ["Drill", "2"],
    ["Saw", "2"],
    ["Hammer", "2"],
  ]);
  await button(page, "Retire Saw").click();
  await button(page, "Available").click();
  await settle(() => toolNames(page), ["Drill", "Hammer"]);
  await button(page, "Retired").click();
  await settle(() => toolNames(page), ["Saw"]);
  await button(page, "Available").click();
  await settle(() => toolNames(page), ["Drill", "Hammer"]);
  await button(page, "Retire Hammer").click();
  await settle(() => toolNames(page), ["Drill"]);
  await button(page, "All").click();
  await settle(() => toolNames(page), ["Drill", "Saw", "Hammer"]);
  return "filters hide rows only, update without another click";
});

browser("browser typing clears an earlier alert", async (page) => {
  await open(page);
  await raiseBlankName(page);
  await copiesBox(page).fill("3");
  await noAlert(page);
  await button(page, "Add tool").click();
  await seeAlert(page, "BlankName");
  await memberBox(page).fill("Ann");
  await noAlert(page);
  await button(page, "Add tool").click();
  await seeAlert(page, "BlankName");
  await nameBox(page).fill("Drill");
  await noAlert(page);
  return "Copies, Member, and Name typing clear";
});

browser("browser choosing a tool clears an earlier alert", async (page) => {
  await open(page);
  await addTools(page, [["Drill", "2"]]);
  await raiseBlankName(page);
  await toolBox(page).selectOption({ label: "Drill" });
  await noAlert(page);
  return "select clears";
});

browser("browser filtering clears an earlier alert", async (page) => {
  await open(page);
  await raiseBlankName(page);
  await button(page, "Available").click();
  await noAlert(page);
  await button(page, "Add tool").click();
  await seeAlert(page, "BlankName");
  await button(page, "All").click();
  await noAlert(page);
  return "Available and All clear";
});

browser("browser a passing no-op lend clears an earlier alert", async (page) => {
  await open(page);
  await addTools(page, [["Drill", "2"]]);
  await lendTo(page, "Drill", "Ann");
  await settle(() => loanRowsOf(page), [["Drill", "Ann"]]);
  await raiseBlankName(page);
  await button(page, "Lend").click();
  await noAlert(page);
  assert.deepStrictEqual(await loanRowsOf(page), [["Drill", "Ann"]]);
  await button(page, "Undo").click();
  await settle(() => loanRowsOf(page), []);
  await button(page, "Undo").click();
  await settle(() => toolRowsOf(page), []);
  return "repeat lend passes, clears, adds no step";
});

browser("browser undo restores records and keeps form text, tool, and filter", async (page) => {
  await open(page);
  await addTools(page, [
    ["Drill", "2"],
    ["Saw", "1"],
  ]);
  await button(page, "Retire Saw").click();
  await lendTo(page, "Drill", "Ann");
  await settle(() => loanRowsOf(page), [["Drill", "Ann"]]);
  const drillId = await toolBox(page).inputValue();
  await button(page, "Available").click();
  await settle(() => toolNames(page), ["Drill"]);
  await nameBox(page).fill("Hammer");
  await copiesBox(page).fill("4");
  await memberBox(page).fill("Bob");
  await button(page, "Undo").click();
  await settle(() => loanRowsOf(page), []);
  await settle(() => toolRowsOf(page), [["Drill", "2", "0", "Available"]]);
  assert.equal(await nameBox(page).inputValue(), "Hammer");
  assert.equal(await copiesBox(page).inputValue(), "4");
  assert.equal(await memberBox(page).inputValue(), "Bob");
  assert.equal(await toolBox(page).inputValue(), drillId);
  await button(page, "Undo").click();
  await settle(() => toolNames(page), ["Drill", "Saw"]);
  return "records back, text, tool, and Available filter kept";
});

browser("browser undo on empty history shows EmptyUndo", async (page) => {
  await open(page);
  await button(page, "Undo").click();
  await seeAlert(page, "EmptyUndo");
  await addTool(page, "Drill", "1");
  await noAlert(page);
  await settle(() => toolNames(page), ["Drill"]);
  return "EmptyUndo shown, next add clears it";
});

// Runs inside the page: one ordinary async function passed directly to
// page.evaluate. All helpers nest INSIDE it, so the serialized closure is
// self-contained.
const mountSecondRoot = async () => {
  const entryCandidates = ["/src/index.ts", "/src/index.tsx"];
  const pickEntry = async () => {
    for (const entry of entryCandidates) {
      try {
        return await import(entry);
      } catch {}
    }
    throw new Error("cannot import submission entry");
  };
  const ownJsx = (mod) => mod?.jsx ?? mod?.jsxs;
  const inheritedJsx = (mod) =>
    mod?.default?.jsx ?? mod?.default?.createElement ?? mod?.createElement;
  const firstJsx = (mod) => ownJsx(mod) ?? inheritedJsx(mod);
  const probeDirectJsx = async () =>
    firstJsx(await import("/@id/__x00__react/jsx-runtime").catch(() => null));
  const probeBareJsx = async () => firstJsx(await import("react/jsx-runtime").catch(() => null));
  const probeJsxRuntime = async () => {
    const direct = await probeDirectJsx();
    if (typeof direct === "function") return direct;
    return probeBareJsx();
  };
  const candidatePaths = (paths) =>
    paths.filter((p) => p.includes("jsx-runtime") || p.includes("react")).slice(0, 8);
  const loadCandidateJsx = async (cand) => {
    try {
      const jsx = firstJsx(await import(cand));
      return typeof jsx === "function" ? jsx : undefined;
    } catch {
      return undefined;
    }
  };
  const scanJsxCandidates = async (paths) => {
    for (const cand of candidatePaths(paths)) {
      const jsx = await loadCandidateJsx(cand);
      if (typeof jsx === "function") return jsx;
    }
    return undefined;
  };
  const pickClientPath = (paths) => {
    const pick = (...subs) => paths.find((p) => subs.every((s) => p.includes(s)));
    return pick("react-dom", "client") ?? "/node_modules/.vite/deps/react-dom_client.js";
  };
  const loadCreateRoot = async (clientPath) => {
    const clientMod = await import(clientPath);
    const createRoot = clientMod.createRoot ?? clientMod.default?.createRoot ?? clientMod.default;
    if (typeof createRoot !== "function") throw new Error("cannot load createRoot");
    return createRoot;
  };
  const resolveJsx = async (paths) => {
    const probed = await probeJsxRuntime();
    if (typeof probed === "function") return probed;
    const scanned = await scanJsxCandidates(paths);
    if (typeof scanned === "function") return scanned;
    throw new Error("cannot load jsx runtime");
  };
  // Keep the full module URL (path plus query): a second copy of React
  // would reset useId counters and collide labels across roots.
  const modulePath = (name) => {
    const url = new URL(name);
    return url.pathname + url.search;
  };
  const paths = performance.getEntriesByType("resource").map((r) => modulePath(r.name));
  const appMod = await pickEntry();
  if (!appMod?.LibraryApp) throw new Error("cannot import submission entry");
  const jsx = await resolveJsx(paths);
  const createRoot = await loadCreateRoot(pickClientPath(paths));
  const holder = document.createElement("div");
  holder.id = "teacher-second-root";
  document.body.appendChild(holder);
  createRoot(holder).render(jsx(appMod.LibraryApp));
};

// First root: records, a retired row hidden by the Available filter, a
// loan, typed text, and a chosen tool. The second root changes everything
// of its own; the first must not move.
const seedFirstRoot = async (first) => {
  await addTools(first, [
    ["Drill", "2"],
    ["Saw", "1"],
  ]);
  await button(first, "Retire Saw").click();
  await lendTo(first, "Drill", "Ann");
  await settle(() => loanRowsOf(first), [["Drill", "Ann"]]);
  await button(first, "Available").click();
  await nameBox(first).fill("Kept");
  await copiesBox(first).fill("9");
  await settle(() => toolNames(first), ["Drill"]);
};
const changeSecondRoot = async (second) => {
  assert.deepStrictEqual(await toolRowsOf(second), []);
  assert.deepStrictEqual(await loanRowsOf(second), []);
  assert.equal(await nameBox(second).inputValue(), "");
  assert.equal(await toolBox(second).inputValue(), "");
  await addTools(second, [["Hammer", "1"]]);
  await lendTo(second, "Hammer", "Zed");
  await settle(() => loanRowsOf(second), [["Hammer", "Zed"]]);
  await button(second, "Retired").click();
  await raiseBlankName(second);
};
const firstUnmoved = async (first, drillId) => {
  await settle(() => toolNames(first), ["Drill"]);
  assert.deepStrictEqual(await loanRowsOf(first), [["Drill", "Ann"]]);
  assert.equal(await nameBox(first).inputValue(), "Kept");
  assert.equal(await copiesBox(first).inputValue(), "9");
  assert.equal(await memberBox(first).inputValue(), "Ann");
  assert.equal(await toolBox(first).inputValue(), drillId);
  assert.equal(await alertText(first), "");
};

browser("browser two LibraryApps share nothing", async (page) => {
  try {
    await open(page);
    const first = page.locator("#root");
    await seedFirstRoot(first);
    const drillId = await toolBox(first).inputValue();
    await page.evaluate(mountSecondRoot);
    const second = page.locator("#teacher-second-root");
    await toolsTable(second).waitFor();
    await changeSecondRoot(second);
    await firstUnmoved(first, drillId);
    await button(first, "Undo").click();
    await settle(() => loanRowsOf(first), []);
    assert.deepStrictEqual(await loanRowsOf(second), [["Hammer", "Zed"]]);
    await seeAlert(second, "BlankName");
    assert.equal(await nameBox(second).inputValue(), "   ");
    await settle(() => toolNames(second), []);
    return "records, text, tool, filter, notice, and undo separate";
  } finally {
    await page
      .evaluate(() => document.getElementById("teacher-second-root")?.remove())
      .catch(() => {});
  }
});

// No entry, no browser: fail every case on the load error instead of
// burning timeouts on a page that can never boot.
if (loadError) {
  for (const [name] of [...coreTests, ...browserTests])
    results.push({ name, pass: false, error: `load failed: ${loadError}`.slice(0, 300) });
  await vite.close();
  finish();
  process.exit(process.exitCode);
}
for (const [name, fn] of coreTests) await test(name, fn);
await vite.close();

const server = await createServer({
  root,
  cacheDir: "/tmp/teacher-loans-browser",
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "@tinker/core", "@tinker/react"],
  },
  configFile: false,
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  logLevel: "silent",
});
let browserHandle;
try {
  await server.listen();
  browserHandle = await chromium.launch({ headless: true });
  const page = await browserHandle.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  for (const [name, fn] of browserTests) await test(name, () => fn(page));
} catch (error) {
  const message = (error?.message ?? String(error)).slice(0, 300);
  for (const [name] of browserTests) {
    if (!results.some((r) => r.name === name)) results.push({ name, pass: false, error: message });
  }
} finally {
  await browserHandle?.close();
  await server.close();
}

finish();
