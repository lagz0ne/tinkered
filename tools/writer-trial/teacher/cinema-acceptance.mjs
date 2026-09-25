import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance for the cinema seat map task. Runs only inside
// the disposable container: submitted code is imported here, never on the
// host. Every case comes from the frozen task text. Case-level results; any
// error or missing check fails its case, never passes. Later cases still run.
// Browser cases find things by role and accessible name only, and read table
// cells by their column header, so a different DOM layout still passes.
const root = process.argv[2];
assert.ok(root, "usage: cinema-acceptance.mjs <submission-dir>");

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
  console.log(`ACCEPTANCE cinema: ${results.length - failed.length}/${results.length} pass`);
  console.log(`RESULTS_JSON ${JSON.stringify({ cases: results, advisory })}`);
  process.exitCode = failed.length ? 1 : 0;
};

// ---- core checks: public entry, createScope, scope.run, scope.resolve ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-cinema-core",
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
  "ROWS",
  "SeatApp",
  "buySeats",
  "holdSeat",
  "isError",
  "releaseSeat",
  "seats",
  "undoSeats",
].sort();
const ROW_LIST = ["A", "B", "C", "D", "E"];
const SEAT_IDS = ROW_LIST.flatMap((row) => [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${row}${n}`));
const need = (value, label) => {
  assert.ok(value, `missing export: ${label}`);
  return value;
};
const seatList = (s) => s.resolve(need(app.seats, "seats"));
// Plain clones: a broken in-place write must not pass by comparing a
// record against its own mutated alias.
const plain = (seat) => ({ ...seat });
const snap = (s) => seatList(s).map(plain);
// One seat as the task defines it; its row and number come from its id.
const seatOf = (id, state = "free", customer = null) => ({
  id,
  row: id[0],
  number: Number(id.slice(1)),
  state,
  customer,
});
// All 40 seats in order, free unless named: { A1: ["held", "Ann"] }.
const mapWith = (changes = {}) =>
  SEAT_IDS.map((id) => (changes[id] ? seatOf(id, ...changes[id]) : seatOf(id)));
const hold = (s, row, number, customer) =>
  s.run(app.holdSeat, { input: { row, number, customer } });
// Hold by seat id: "C5" is row C, number 5.
const holdId = (s, id, customer) => hold(s, id[0], id.slice(1), customer);
const buy = (s, customer) => s.run(app.buySeats, { input: { customer } });
const release = (s, seatId) => s.run(app.releaseSeat, { input: { seatId } });
const undo = (s) => s.run(app.undoSeats, {});
const shown = (value) => (value === undefined ? "undefined" : JSON.stringify(value));
const caught = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("want a thrown managed error");
};
// One failing call: the kind, the exact payload, and seats left exactly
// as they were.
const failsWith = (s, op, input, kind, payload) => {
  const before = snap(s);
  const error = caught(() => s.run(op, { input }));
  assert.equal(
    error?.kind,
    kind,
    `want ${kind} for ${shown(input)}, got ${error?.kind ?? error?.message}`,
  );
  assert.deepStrictEqual(error.payload, payload);
  assert.deepStrictEqual(snap(s), before, `${kind} changed seats`);
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

const coreTests = [];
const core = (name, fn) => coreTests.push([name, fn]);

core("core entry exports exactly the named API", async () => {
  assert.ok(!loadError, loadError);
  for (const label of API) need(app[label], label);
  assert.deepStrictEqual(Object.keys(app).sort(), API);
  return API.join(", ");
});

core("core ROWS lists A, B, C, D, E in order", () => {
  assert.ok(Array.isArray(app.ROWS), "ROWS is a list");
  assert.deepStrictEqual([...app.ROWS], ROW_LIST);
  return ROW_LIST.join(", ");
});

core("core each scope starts with 40 free seats A1 to E8 in order and EmptyUndo {}", () =>
  inScope((s) => {
    assert.deepStrictEqual(snap(s), mapWith());
    const error = caught(() => undo(s));
    assert.equal(error?.kind, "EmptyUndo");
    assert.deepStrictEqual(error.payload, {});
    return "40 free seats, no customer; EmptyUndo {}";
  }),
);

core("core holdSeat trims and holds a free seat for the trimmed customer with one undo step", () =>
  inScope((s) => {
    assert.deepStrictEqual(plain(hold(s, " C ", " 5 ", " Ann ")), seatOf("C5", "held", "Ann"));
    assert.deepStrictEqual(snap(s), mapWith({ C5: ["held", "Ann"] }));
    assert.deepStrictEqual(plain(hold(s, "E", "8", "Bob")), seatOf("E8", "held", "Bob"));
    assert.deepStrictEqual(
      snap(s),
      mapWith({ C5: ["held", "Ann"], E8: ["held", "Bob"] }),
      "held in place, seat order kept",
    );
    assert.equal(undoCount(s), 2);
    return "trimmed row, number, customer; saved seat returned; one step each";
  }),
);

const BAD_ROWS = [
  "a",
  "e",
  "",
  "   ",
  "F",
  "AB",
  "A B",
  "A1",
  "1",
  "Row A",
  1,
  null,
  undefined,
  true,
  ["A"],
];

core("core bad row text reports BadRow with the original value", () =>
  inScope((s) => {
    for (const row of BAD_ROWS)
      failsWith(s, app.holdSeat, { row, number: "1", customer: "Ann" }, "BadRow", { row });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_ROWS.length} values: lower case, blank, F, AB, non-text`;
  }),
);

const BAD_NUMBERS = [
  "",
  "   ",
  "0",
  "9",
  "10",
  "+3",
  "-1",
  "3.0",
  "1 2",
  "abc",
  "03",
  "1e0",
  "3x",
  3,
  null,
  undefined,
  true,
  ["3"],
];

core("core bad number text reports BadNumber with the original value", () =>
  inScope((s) => {
    for (const number of BAD_NUMBERS)
      failsWith(s, app.holdSeat, { row: "A", number, customer: "Ann" }, "BadNumber", { number });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_NUMBERS.length} values: blank, 0, 9, sign, decimal, space, letters, non-text`;
  }),
);

const BAD_CUSTOMERS = ["", "   ", 3, null, undefined, true, ["Ann"]];

core("core blank or non-text customer reports BlankCustomer with the original value", () =>
  inScope((s) => {
    holdId(s, "A1", "Ann");
    for (const customer of BAD_CUSTOMERS) {
      failsWith(s, app.holdSeat, { row: "B", number: "2", customer }, "BlankCustomer", {
        customer,
      });
      failsWith(s, app.buySeats, { customer }, "BlankCustomer", { customer });
    }
    assert.equal(undoCount(s), 1, "no undo step");
    return `${BAD_CUSTOMERS.length} values on hold and buy`;
  }),
);

core("core unknown seat ids report NotFound with that id", () =>
  inScope((s) => {
    holdId(s, "A1", "Ann");
    for (const id of ["Z1", "A9", "A0", "F1", "a1", "1A", "", "seat-A1"])
      failsWith(s, app.releaseSeat, { seatId: id }, "NotFound", { id });
    assert.equal(undoCount(s), 1);
    return "8 unknown ids, exact text payload";
  }),
);

// The miss earlier trials repeated. NotFound's payload is { id: string }:
// an id that is not text names no seat and still reports text. Core hands
// a `{ input }` call to the body unchecked and a `{ rawInput }` call
// through the operation's own reader, so each call style is its own case.
// Which text is not named: only its type is checked.
const NON_TEXT_IDS = [7, 11, null, undefined, true, {}];
const notFoundText = (s, call, label) => {
  const before = snap(s);
  const error = caught(() => s.run(app.releaseSeat, call));
  assert.equal(
    error?.kind,
    "NotFound",
    `want NotFound for ${label}, got ${error?.kind ?? error?.message}`,
  );
  assert.deepStrictEqual(Object.keys(error.payload ?? {}), ["id"]);
  assert.equal(
    typeof error.payload.id,
    "string",
    `NotFound id must be text for ${label}; got ${typeof error.payload.id} ${shown(error.payload.id)}`,
  );
  assert.deepStrictEqual(snap(s), before, `${label} changed seats`);
};
// One held and one sold seat, so a lookup that coerces the id could still
// reach a record; a one-item list holding a real id is the trap.
const nonTextIdsReportText = (via) =>
  inScope((s) => {
    holdId(s, "A1", "Ann");
    holdId(s, "B2", "Bob");
    buy(s, "Bob");
    for (const id of [...NON_TEXT_IDS, ["A1"], ["B2"]]) {
      const label = `release { ${via}: { seatId: ${shown(id)} } }`;
      notFoundText(s, { [via]: { seatId: id } }, label);
    }
    assert.equal(undoCount(s), 3);
    return `${NON_TEXT_IDS.length + 2} non-text ids on release; text payload`;
  });

core("core a non-text seatId passed as { input } reports NotFound with a text id", () =>
  nonTextIdsReportText("input"),
);

core("core a non-text seatId passed as { rawInput } reports NotFound with a text id", () =>
  nonTextIdsReportText("rawInput"),
);

core("core holding a seat the same customer holds passes with no change or undo step", () =>
  inScope((s) => {
    holdId(s, "B4", "Ann");
    const before = snap(s);
    assert.deepStrictEqual(plain(holdId(s, "B4", "Ann")), seatOf("B4", "held", "Ann"));
    assert.deepStrictEqual(plain(hold(s, " B ", " 4 ", " Ann ")), seatOf("B4", "held", "Ann"));
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 1);
    return "saved seat returned, no step";
  }),
);

core("core a same-customer repeat hold at the limit passes with no change or undo step", () =>
  inScope((s) => {
    holdId(s, "A1", "Ann");
    holdId(s, "A2", "Ann");
    buy(s, "Ann");
    holdId(s, "A3", "Ann");
    holdId(s, "A4", "Ann");
    const before = snap(s);
    assert.deepStrictEqual(plain(holdId(s, "A4", " Ann ")), seatOf("A4", "held", "Ann"));
    assert.deepStrictEqual(plain(holdId(s, "A3", "Ann")), seatOf("A3", "held", "Ann"));
    assert.deepStrictEqual(snap(s), before);
    failsWith(s, app.holdSeat, { row: "A", number: "5", customer: "Ann" }, "SeatLimit", {
      customer: "Ann",
    });
    assert.equal(undoCount(s), 5);
    return "2 sold + 2 held: repeats pass, a fifth seat is SeatLimit";
  }),
);

core("core a seat held by another customer reports SeatTaken with that customer", () =>
  inScope((s) => {
    holdId(s, "C5", "Ann");
    failsWith(s, app.holdSeat, { row: "C", number: "5", customer: "Bob" }, "SeatTaken", {
      id: "C5",
      customer: "Ann",
    });
    failsWith(s, app.holdSeat, { row: " C ", number: "5", customer: " ann " }, "SeatTaken", {
      id: "C5",
      customer: "Ann",
    });
    assert.equal(undoCount(s), 1);
    return "id and holder; customers match exactly";
  }),
);

core("core holding a sold seat reports SeatSold, even for its buyer", () =>
  inScope((s) => {
    holdId(s, "D6", "Ann");
    buy(s, "Ann");
    failsWith(s, app.holdSeat, { row: "D", number: "6", customer: "Bob" }, "SeatSold", {
      id: "D6",
    });
    failsWith(s, app.holdSeat, { row: "D", number: "6", customer: "Ann" }, "SeatSold", {
      id: "D6",
    });
    assert.equal(undoCount(s), 2);
    return "another customer and the buyer both refused";
  }),
);

core("core SeatLimit counts held plus sold seats and reports the trimmed customer", () =>
  inScope((s) => {
    holdId(s, "A1", "Ann");
    holdId(s, "A2", "Ann");
    holdId(s, "A3", "Ann");
    buy(s, "Ann");
    holdId(s, "B1", " Ann ");
    failsWith(s, app.holdSeat, { row: "B", number: "2", customer: " Ann " }, "SeatLimit", {
      customer: "Ann",
    });
    assert.equal(holdId(s, "B2", "ann").customer, "ann");
    assert.equal(holdId(s, "B3", "Bob").customer, "Bob");
    release(s, "B1");
    assert.deepStrictEqual(plain(holdId(s, "B4", "Ann")), seatOf("B4", "held", "Ann"));
    return "3 sold + 1 held is the limit; ann and Bob are others; release frees a place";
  }),
);

core("core buySeats sells every seat the customer holds in seat order as one undo step", () =>
  inScope((s) => {
    holdId(s, "D1", "Ann");
    buy(s, "Ann");
    holdId(s, "C2", "Ann");
    holdId(s, "A5", "Ann");
    holdId(s, "A1", "Bob");
    holdId(s, "B1", "Ann");
    const before = snap(s);
    assert.deepStrictEqual(buy(s, " Ann ").map(plain), [
      seatOf("A5", "sold", "Ann"),
      seatOf("B1", "sold", "Ann"),
      seatOf("C2", "sold", "Ann"),
    ]);
    assert.deepStrictEqual(
      snap(s),
      mapWith({
        A1: ["held", "Bob"],
        A5: ["sold", "Ann"],
        B1: ["sold", "Ann"],
        C2: ["sold", "Ann"],
        D1: ["sold", "Ann"],
      }),
    );
    undo(s);
    assert.deepStrictEqual(snap(s), before, "one undo restores all three");
    assert.equal(undoCount(s), 6);
    return "held seats sold and returned in seat order; one step";
  }),
);

core("core buying with no held seat reports NothingHeld with the trimmed customer", () =>
  inScope((s) => {
    failsWith(s, app.buySeats, { customer: " Ann " }, "NothingHeld", { customer: "Ann" });
    holdId(s, "E1", "Ann");
    buy(s, "Ann");
    holdId(s, "E2", "Bob");
    failsWith(s, app.buySeats, { customer: "Ann" }, "NothingHeld", { customer: "Ann" });
    failsWith(s, app.buySeats, { customer: "bob" }, "NothingHeld", { customer: "bob" });
    assert.equal(undoCount(s), 3);
    return "none, only sold, and another's holds";
  }),
);

core("core releaseSeat frees a held seat with no customer and one undo step", () =>
  inScope((s) => {
    holdId(s, "B3", "Ann");
    holdId(s, "C4", "Ann");
    const before = snap(s);
    assert.deepStrictEqual(plain(release(s, "B3")), seatOf("B3"));
    assert.deepStrictEqual(snap(s), mapWith({ C4: ["held", "Ann"] }));
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "free in place, customer null, saved seat returned";
  }),
);

core("core releasing a free seat passes with no change or undo step", () =>
  inScope((s) => {
    assert.deepStrictEqual(plain(release(s, "A1")), seatOf("A1"));
    holdId(s, "A1", "Ann");
    release(s, "A1");
    const before = snap(s);
    assert.deepStrictEqual(plain(release(s, "A1")), seatOf("A1"));
    assert.deepStrictEqual(plain(release(s, "A1")), seatOf("A1"));
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "saved seat returned, no step";
  }),
);

core("core releasing a sold seat reports SeatSold", () =>
  inScope((s) => {
    holdId(s, "E5", "Ann");
    buy(s, "Ann");
    failsWith(s, app.releaseSeat, { seatId: "E5" }, "SeatSold", { id: "E5" });
    assert.equal(undoCount(s), 2);
    return "sold seat refused, no step";
  }),
);

core("core failed actions leave seats and undo unchanged", () =>
  inScope((s) => {
    holdId(s, "A1", "Ann");
    holdId(s, "A2", "Bob");
    buy(s, "Bob");
    holdId(s, "B1", "Cy");
    holdId(s, "B2", "Cy");
    holdId(s, "B3", "Cy");
    holdId(s, "B4", "Cy");
    const tries = [
      [app.holdSeat, { row: "f", number: "1", customer: "Dee" }, "BadRow"],
      [app.holdSeat, { row: "C", number: "0", customer: "Dee" }, "BadNumber"],
      [app.holdSeat, { row: "C", number: "1", customer: " " }, "BlankCustomer"],
      [app.holdSeat, { row: "A", number: "1", customer: "Dee" }, "SeatTaken"],
      [app.holdSeat, { row: "A", number: "2", customer: "Dee" }, "SeatSold"],
      [app.holdSeat, { row: "C", number: "1", customer: "Cy" }, "SeatLimit"],
      [app.buySeats, { customer: "" }, "BlankCustomer"],
      [app.buySeats, { customer: "Dee" }, "NothingHeld"],
      [app.releaseSeat, { seatId: "Z9" }, "NotFound"],
      [app.releaseSeat, { seatId: "A2" }, "SeatSold"],
    ];
    for (const [op, input, kind] of tries) {
      const before = snap(s);
      const error = caught(() => s.run(op, { input }));
      assert.equal(error?.kind, kind, `want ${kind} for ${shown(input)}`);
      assert.deepStrictEqual(snap(s), before, `${kind} changed seats`);
    }
    assert.equal(undoCount(s), 7);
    assert.deepStrictEqual(snap(s), mapWith());
    return `${tries.length} failures, no write, no step`;
  }),
);

core("core undo restores the exact seats", () =>
  inScope((s) => {
    const steps = [snap(s)];
    holdId(s, "A1", "Ann");
    steps.push(snap(s));
    holdId(s, "B2", "Bob");
    steps.push(snap(s));
    holdId(s, "A2", "Ann");
    steps.push(snap(s));
    buy(s, "Ann");
    steps.push(snap(s));
    release(s, "B2");
    steps.push(snap(s));
    holdId(s, "E8", "Cy");
    for (const want of steps.reverse()) {
      assert.equal(undo(s), undefined);
      assert.deepStrictEqual(snap(s), want);
    }
    assert.equal(caught(() => undo(s))?.kind, "EmptyUndo");
    return "six steps back, exact seats";
  }),
);

core("core two scopes share nothing", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    holdId(a, "A1", "Ann");
    buy(a, "Ann");
    assert.deepStrictEqual(snap(b), mapWith());
    assert.equal(caught(() => undo(b))?.kind, "EmptyUndo");
    holdId(b, "A1", "Zed");
    assert.deepStrictEqual(snap(a), mapWith({ A1: ["sold", "Ann"] }));
    assert.deepStrictEqual(snap(b), mapWith({ A1: ["held", "Zed"] }));
    return "separate seats and history";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core thrown errors narrow through isError", () =>
  inScope((s) => {
    const bad = caught(() => hold(s, "A", "abc", "Ann"));
    assert.ok(app.isError(bad, "BadNumber"), "want BadNumber");
    assert.ok(!app.isError(bad, "NotFound"), "BadNumber is not NotFound");
    assert.deepStrictEqual(bad.payload, { number: "abc" });
    const gone = caught(() => release(s, "Z9"));
    assert.ok(app.isError(gone, "NotFound"), "want NotFound");
    const empty = caught(() => undo(s));
    assert.ok(app.isError(empty, "EmptyUndo"), "want EmptyUndo");
    return "BadNumber, NotFound, EmptyUndo";
  }),
);

// ---- browser checks: real Chromium, fresh mounts ----
const URL_ROOT = "http://127.0.0.1:5173";
const browserTests = [];
const browser = (name, fn) => browserTests.push([name, fn]);

const textbox = (scope, name) => scope.getByRole("textbox", { name, exact: true });
const rowBox = (scope) => textbox(scope, "Row");
const numberBox = (scope) => textbox(scope, "Number");
const customerBox = (scope) => textbox(scope, "Customer");
const seatsTable = (scope) => scope.getByRole("table", { name: "Seats", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const releaseButton = (scope, id) => button(scope, `Release ${id}`);

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
  // but not where they sit, so a Release button inside the State cell
  // must not change what the cell says.
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
// The 40 rows are read in parallel: one round trip each, not in series.
const readTable = async (table, columns) => {
  const rows = await Promise.all((await table.getByRole("row").all()).map(cellsOf));
  const head = rows.findIndex((cells) => columns.every((column) => cells.includes(column)));
  assert.ok(head >= 0, `want columns ${columns.join(", ")}; found ${rows[0]?.join(", ") ?? ""}`);
  const at = columns.map((column) => rows[head].indexOf(column));
  return rows.slice(head + 1).map((cells) => at.map((i) => cells[i]));
};
const COLUMNS = ["Seat", "State", "Customer"];
const rowsOf = (scope) => readTable(seatsTable(scope), COLUMNS);
const idsShown = async (scope) => (await rowsOf(scope)).map(([id]) => id);
// The whole table as the task shows it: every seat Free with None unless
// named, { A1: ["Held", "Ann"] }. Reads compare all 40 rows by content.
const tableWith = (changes = {}) =>
  SEAT_IDS.map((id) => [id, ...(changes[id] ?? ["Free", "None"])]);
// The row with a cell named exactly by one seat id. Row text alone is not
// enough: cells join with no space, so "D6" can run into "Held".
const rowOf = (scope, id) => {
  const table = seatsTable(scope);
  const named = (role) => table.page().getByRole(role, { name: id, exact: true });
  return table.getByRole("row").filter({ has: named("cell").or(named("rowheader")) });
};

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
const formText = async (scope) => [
  await rowBox(scope).inputValue(),
  await numberBox(scope).inputValue(),
  await customerBox(scope).inputValue(),
];

const holdVia = async (scope, row, number, customer) => {
  await rowBox(scope).fill(row);
  await numberBox(scope).fill(number);
  await customerBox(scope).fill(customer);
  await button(scope, "Hold").click();
};
// Passing holds by seat id; each waits for its Release button.
const holdSeats = async (scope, ids, customer) => {
  for (const id of ids) {
    await holdVia(scope, id[0], id.slice(1), customer);
    await releaseButton(scope, id).waitFor();
  }
};
const buyVia = async (scope, customer) => {
  await customerBox(scope).fill(customer);
  await button(scope, "Buy").click();
};
// Hold with a row that is not a row: BadRow, and no other rule fails.
const raiseBadRow = async (scope) => {
  await rowBox(scope).fill("Z");
  await numberBox(scope).fill("1");
  await customerBox(scope).fill("Ann");
  await button(scope, "Hold").click();
  await seeAlert(scope, "BadRow");
};
const open = async (page) => {
  await page.goto(URL_ROOT);
  await seatsTable(page).waitFor();
};

browser("browser loads an empty form, 40 free seats, the filters, and Undo", async (page) => {
  await open(page);
  assert.deepStrictEqual(await formText(page), ["", "", ""]);
  for (const name of ["Hold", "Buy", "Undo", "All", "Free", "Held", "Sold"])
    await button(page, name).waitFor();
  assert.ok(await button(page, "Undo").isEnabled(), "Undo enabled on empty history");
  await settle(() => rowsOf(page), tableWith());
  assert.equal(await seatsTable(page).getByRole("button").count(), 0, "free rows have no button");
  assert.equal(await alertText(page), "");
  return "inputs empty; A1 to E8 Free, None; no row buttons";
});

browser(
  "browser a passing Hold holds the seat, clears Row and Number, and keeps Customer",
  async (page) => {
    await open(page);
    await holdVia(page, " C ", " 5 ", "Ann");
    await settle(() => rowsOf(page), tableWith({ C5: ["Held", "Ann"] }));
    assert.deepStrictEqual(await formText(page), ["", "", "Ann"]);
    await rowBox(page).fill("A");
    await numberBox(page).fill("2");
    await button(page, "Hold").click();
    await settle(() => rowsOf(page), tableWith({ A2: ["Held", "Ann"], C5: ["Held", "Ann"] }));
    assert.deepStrictEqual(await formText(page), ["", "", "Ann"]);
    assert.equal(await alertText(page), "");
    return "Held, Ann; Row and Number empty, Customer Ann";
  },
);

browser("browser a failed Hold keeps all three fields and shows the kind", async (page) => {
  await open(page);
  await holdSeats(page, ["A1"], "Bob");
  await buyVia(page, "Bob");
  await settle(() => rowsOf(page).then((rows) => rows[0]), ["A1", "Sold", "Bob"]);
  await holdSeats(page, ["B1"], "Bob");
  await holdSeats(page, ["C1", "C2", "C3", "C4"], "Cy");
  const tries = [
    ["a", "2", "Ann", "BadRow"],
    ["A", "9", "Ann", "BadNumber"],
    ["A", "", "Ann", "BadNumber"],
    ["A", "2", " ", "BlankCustomer"],
    ["B", "1", "Ann", "SeatTaken"],
    ["A", "1", "Ann", "SeatSold"],
    ["D", "1", "Cy", "SeatLimit"],
  ];
  for (const [row, number, customer, kind] of tries) {
    await holdVia(page, row, number, customer);
    await seeAlert(page, kind);
    assert.deepStrictEqual(await formText(page), [row, number, customer], `${kind} kept text`);
  }
  await settle(
    () => rowsOf(page),
    tableWith({
      A1: ["Sold", "Bob"],
      B1: ["Held", "Bob"],
      C1: ["Held", "Cy"],
      C2: ["Held", "Cy"],
      C3: ["Held", "Cy"],
      C4: ["Held", "Cy"],
    }),
  );
  return "BadRow, BadNumber, blank BadNumber, BlankCustomer, SeatTaken, SeatSold, SeatLimit";
});

browser(
  "browser a passing Buy sells the customer's held seats and keeps all three fields",
  async (page) => {
    await open(page);
    await holdSeats(page, ["B2", "A7"], "Ann");
    await holdSeats(page, ["C3"], "Bob");
    await rowBox(page).fill("D");
    await numberBox(page).fill("4");
    await buyVia(page, "Ann");
    await settle(
      () => rowsOf(page),
      tableWith({ A7: ["Sold", "Ann"], B2: ["Sold", "Ann"], C3: ["Held", "Bob"] }),
    );
    assert.deepStrictEqual(await formText(page), ["D", "4", "Ann"]);
    assert.equal(await releaseButton(page, "A7").count(), 0, "sold rows have no Release");
    assert.equal(await releaseButton(page, "B2").count(), 0, "sold rows have no Release");
    assert.equal(await alertText(page), "");
    await button(page, "Buy").click();
    await seeAlert(page, "NothingHeld");
    assert.deepStrictEqual(await formText(page), ["D", "4", "Ann"]);
    return "Ann's seats Sold, Bob's kept; D, 4, Ann stay; NothingHeld keeps them";
  },
);

browser(
  "browser only held rows have a Release button, and Release frees the seat",
  async (page) => {
    await open(page);
    await holdSeats(page, ["A3", "B5"], "Ann");
    await buyVia(page, "Ann");
    await settle(() => releaseButton(page, "A3").count(), 0);
    await holdSeats(page, ["D6", "E2"], "Bob");
    assert.equal(await rowOf(page, "A3").getByRole("button").count(), 0, "sold row");
    assert.equal(await rowOf(page, "A4").getByRole("button").count(), 0, "free row");
    assert.equal(await rowOf(page, "D6").getByRole("button").count(), 1, "held row");
    assert.equal(await seatsTable(page).getByRole("button").count(), 2, "two held rows");
    await releaseButton(page, "D6").click();
    await settle(
      () => rowsOf(page),
      tableWith({ A3: ["Sold", "Ann"], B5: ["Sold", "Ann"], E2: ["Held", "Bob"] }),
    );
    assert.equal(await rowOf(page, "D6").getByRole("button").count(), 0, "released row");
    assert.equal(await alertText(page), "");
    return "Release <id> on held rows only; D6 back to Free, None";
  },
);

browser("browser filters show only seats in that state and update live", async (page) => {
  await open(page);
  await holdSeats(page, ["A1", "B2"], "Ann");
  await buyVia(page, "Ann");
  await settle(() => releaseButton(page, "A1").count(), 0);
  await holdSeats(page, ["C3", "E8"], "Bob");
  await button(page, "Held").click();
  await settle(() => idsShown(page), ["C3", "E8"]);
  await button(page, "Sold").click();
  await settle(() => idsShown(page), ["A1", "B2"]);
  await button(page, "Free").click();
  await settle(
    () => idsShown(page),
    SEAT_IDS.filter((id) => !["A1", "B2", "C3", "E8"].includes(id)),
  );
  await button(page, "Held").click();
  await settle(() => idsShown(page), ["C3", "E8"]);
  await releaseButton(page, "C3").click();
  await settle(() => idsShown(page), ["E8"]);
  await buyVia(page, "Bob");
  await settle(() => idsShown(page), []);
  await button(page, "Sold").click();
  await settle(() => idsShown(page), ["A1", "B2", "E8"]);
  await button(page, "All").click();
  await settle(
    () => rowsOf(page),
    tableWith({ A1: ["Sold", "Ann"], B2: ["Sold", "Ann"], E8: ["Sold", "Bob"] }),
  );
  return "Free, Held, Sold only their state; rows move without another click";
});

browser("browser typing clears an earlier alert", async (page) => {
  await open(page);
  await raiseBadRow(page);
  await numberBox(page).fill("2");
  await noAlert(page);
  await button(page, "Hold").click();
  await seeAlert(page, "BadRow");
  await customerBox(page).fill("Bob");
  await noAlert(page);
  await button(page, "Hold").click();
  await seeAlert(page, "BadRow");
  await rowBox(page).fill("Y");
  await noAlert(page);
  return "Number, Customer, and Row typing clear";
});

browser("browser filtering clears an earlier alert", async (page) => {
  await open(page);
  await raiseBadRow(page);
  await button(page, "Sold").click();
  await noAlert(page);
  await button(page, "Hold").click();
  await seeAlert(page, "BadRow");
  await button(page, "All").click();
  await noAlert(page);
  return "Sold and All clear";
});

// In this screen a failed click and a passing no-op are always split by
// typing or by a passing change, and both clear the notice first. So the
// no-op is checked straight after an alert that typing cleared: it must
// pass without a notice of its own, clear Row and Number, and add no step.
browser(
  "browser a passing no-op Hold shows no alert, clears Row and Number, and adds no undo step",
  async (page) => {
    await open(page);
    await holdSeats(page, ["B4"], "Ann");
    await raiseBadRow(page);
    await rowBox(page).fill("B");
    await numberBox(page).fill("4");
    await button(page, "Hold").click();
    await settle(() => formText(page), ["", "", "Ann"]);
    assert.equal(await alertText(page), "");
    assert.deepStrictEqual(await rowsOf(page), tableWith({ B4: ["Held", "Ann"] }));
    await button(page, "Undo").click();
    await settle(() => rowsOf(page), tableWith());
    return "same seat, same customer passes; one Undo frees it";
  },
);

browser("browser undo restores seats and keeps form text and the filter", async (page) => {
  await open(page);
  await holdSeats(page, ["A5"], "Ann");
  await holdSeats(page, ["B6", "C7"], "Bob");
  await buyVia(page, "Bob");
  await settle(() => releaseButton(page, "B6").count(), 0);
  await button(page, "Held").click();
  await settle(() => idsShown(page), ["A5"]);
  await rowBox(page).fill("E");
  await numberBox(page).fill("3");
  await customerBox(page).fill("Dee");
  await button(page, "Undo").click();
  await settle(() => idsShown(page), ["A5", "B6", "C7"]);
  await button(page, "Undo").click();
  await settle(() => idsShown(page), ["A5", "B6"]);
  assert.deepStrictEqual(await formText(page), ["E", "3", "Dee"]);
  await button(page, "All").click();
  await settle(() => rowsOf(page), tableWith({ A5: ["Held", "Ann"], B6: ["Held", "Bob"] }));
  return "buy and hold undone; E, 3, Dee and the Held filter kept";
});

browser("browser undo on empty history shows EmptyUndo", async (page) => {
  await open(page);
  await button(page, "Undo").click();
  await seeAlert(page, "EmptyUndo");
  await holdSeats(page, ["A1"], "Ann");
  await noAlert(page);
  return "EmptyUndo shown, the next action clears it";
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
  if (!appMod?.SeatApp) throw new Error("cannot import submission entry");
  const jsx = await resolveJsx(paths);
  const createRoot = await loadCreateRoot(pickClientPath(paths));
  const holder = document.createElement("div");
  holder.id = "teacher-second-root";
  document.body.appendChild(holder);
  createRoot(holder).render(jsx(appMod.SeatApp));
};

// First root: sold seats hidden by the Held filter, one held seat, and
// typed text in all three fields. The second root changes everything of
// its own; the first must not move.
const seedFirstRoot = async (first) => {
  await holdSeats(first, ["A1", "B2"], "Ann");
  await buyVia(first, "Ann");
  await settle(() => releaseButton(first, "A1").count(), 0);
  await holdSeats(first, ["C3"], "Ann");
  await button(first, "Held").click();
  await rowBox(first).fill("D");
  await numberBox(first).fill("4");
  await customerBox(first).fill("Cy");
  await settle(() => idsShown(first), ["C3"]);
};
const changeSecondRoot = async (second) => {
  await settle(() => rowsOf(second), tableWith());
  assert.deepStrictEqual(await formText(second), ["", "", ""]);
  await holdSeats(second, ["E8"], "Zed");
  await button(second, "Sold").click();
  await raiseBadRow(second);
};
const firstUnmoved = async (first) => {
  await settle(() => idsShown(first), ["C3"]);
  assert.deepStrictEqual(await formText(first), ["D", "4", "Cy"]);
  assert.equal(await alertText(first), "");
};

browser("browser two SeatApps share nothing", async (page) => {
  try {
    await open(page);
    const first = page.locator("#root");
    await seedFirstRoot(first);
    await page.evaluate(mountSecondRoot);
    const second = page.locator("#teacher-second-root");
    await seatsTable(second).waitFor();
    await changeSecondRoot(second);
    await firstUnmoved(first);
    await button(first, "Undo").click();
    await settle(() => idsShown(first), []);
    await button(first, "All").click();
    await settle(() => rowsOf(first), tableWith({ A1: ["Sold", "Ann"], B2: ["Sold", "Ann"] }));
    await seeAlert(second, "BadRow");
    await settle(() => idsShown(second), []);
    await button(second, "All").click();
    await settle(() => rowsOf(second), tableWith({ E8: ["Held", "Zed"] }));
    return "seats, text, filter, notice, and undo separate";
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
  cacheDir: "/tmp/teacher-cinema-browser",
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
