import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance for the kitchen queue task. Runs only inside
// the disposable container: submitted code is imported here, never on the
// host. Every case comes from the frozen task text. Case-level results; any
// error or missing check fails its case, never passes. Later cases still run.
// Browser cases find things by role and accessible name only, and read table
// cells by their column header, so a different DOM layout still passes.
const root = process.argv[2];
assert.ok(root, "usage: kitchen-acceptance.mjs <submission-dir>");

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
  console.log(`ACCEPTANCE kitchen: ${results.length - failed.length}/${results.length} pass`);
  console.log(`RESULTS_JSON ${JSON.stringify({ cases: results, advisory })}`);
  process.exitCode = failed.length ? 1 : 0;
};

// ---- core checks: public entry, createScope, scope.run, scope.resolve ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-kitchen-core",
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
  "KitchenApp",
  "MENU",
  "addTicket",
  "cancelTicket",
  "isError",
  "serveTicket",
  "setStove",
  "startCooking",
  "stove",
  "tickets",
  "undoKitchen",
];
const DISHES = ["Soup", "Salad", "Pasta", "Steak", "Cake"];
const need = (value, label) => {
  assert.ok(value, `missing export: ${label}`);
  return value;
};
const ticketList = (s) => s.resolve(need(app.tickets, "tickets"));
const stoveSize = (s) => s.resolve(need(app.stove, "stove"));
// Plain clones: a broken in-place write must not pass by comparing a
// record against its own mutated alias.
const plain = (t) => ({ ...t });
const snap = (s) => ({ tickets: ticketList(s).map(plain), stove: stoveSize(s) });
const add = (s, table, dish, qty) => s.run(app.addTicket, { input: { table, dish, qty } });
const cook = (s, ticketId) => s.run(app.startCooking, { input: { ticketId } });
const serve = (s, ticketId) => s.run(app.serveTicket, { input: { ticketId } });
const cancel = (s, ticketId) => s.run(app.cancelTicket, { input: { ticketId } });
const sizeTo = (s, size) => s.run(app.setStove, { input: { size } });
const undo = (s) => s.run(app.undoKitchen, {});
const caught = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("want a thrown managed error");
};
// One failing call: the kind, the exact payload, and tickets and stove
// left exactly as they were.
const failsWith = (s, op, input, kind, payload) => {
  const before = snap(s);
  const error = caught(() => s.run(op, { input }));
  assert.equal(error?.kind, kind, `want ${kind} for ${JSON.stringify(input)}`);
  assert.deepStrictEqual(error.payload, payload);
  assert.deepStrictEqual(snap(s), before, `${kind} changed tickets or stove`);
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
const waiting = (t) => ({ ...plain(t), state: "waiting" });
const cooking = (t) => ({ ...plain(t), state: "cooking" });
const served = (t) => ({ ...plain(t), state: "served" });

const coreTests = [];
const core = (name, fn) => coreTests.push([name, fn]);

core("core entry exports exactly the named API", async () => {
  assert.ok(!loadError, loadError);
  for (const label of API) need(app[label], label);
  assert.deepStrictEqual(Object.keys(app).sort(), API);
  return API.join(", ");
});

core("core MENU lists Soup, Salad, Pasta, Steak, Cake in order", () => {
  assert.ok(Array.isArray(app.MENU), "MENU is a list");
  assert.deepStrictEqual([...app.MENU], DISHES);
  return DISHES.join(", ");
});

core("core each scope starts with no tickets, a stove of 3, and EmptyUndo {}", () =>
  inScope((s) => {
    assert.deepStrictEqual(ticketList(s), []);
    assert.equal(stoveSize(s), 3);
    const error = caught(() => undo(s));
    assert.equal(error?.kind, "EmptyUndo");
    assert.deepStrictEqual(error.payload, {});
    return "empty list, stove 3, EmptyUndo {}";
  }),
);

core("core add trims, parses, and appends waiting tickets in creation order", () =>
  inScope((s) => {
    const a = add(s, " 4 ", " Soup ", " 2 ");
    assert.ok(typeof a.id === "string" && a.id.length > 0, "nonempty id");
    assert.deepStrictEqual(plain(a), {
      id: a.id,
      table: 4,
      dish: "Soup",
      qty: 2,
      state: "waiting",
    });
    const b = add(s, "4", "Salad", "1");
    const c = add(s, "12", "Soup", "9");
    assert.equal(new Set([a.id, b.id, c.id]).size, 3, "ids distinct");
    assert.deepStrictEqual(snap(s).tickets, [
      { id: a.id, table: 4, dish: "Soup", qty: 2, state: "waiting" },
      { id: b.id, table: 4, dish: "Salad", qty: 1, state: "waiting" },
      { id: c.id, table: 12, dish: "Soup", qty: 9, state: "waiting" },
    ]);
    assert.equal(undoCount(s), 3);
    return "trimmed, same table other dish and same dish other table are new, one step each";
  }),
);

core("core whole numbers at the range edges pass", () =>
  inScope((s) => {
    const low = add(s, "1", "Cake", "1");
    const high = add(s, "40", "Cake", "9");
    assert.deepStrictEqual([low.table, low.qty, high.table, high.qty], [1, 1, 40, 9]);
    assert.equal(sizeTo(s, "1"), 1);
    assert.equal(stoveSize(s), 1);
    assert.equal(sizeTo(s, "5"), 5);
    assert.equal(stoveSize(s), 5);
    return "table 1 and 40, qty 1 and 9, size 1 and 5";
  }),
);

const BAD_TABLES = [
  "",
  "   ",
  "0",
  " 0 ",
  "41",
  "+3",
  "-1",
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

core("core bad table text reports BadTable with the original value", () =>
  inScope((s) => {
    for (const table of BAD_TABLES)
      failsWith(s, app.addTicket, { table, dish: "Soup", qty: "2" }, "BadTable", { table });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_TABLES.length} bad values, none defaulted`;
  }),
);

const BAD_QTYS = [
  "",
  "  ",
  "0",
  " 0 ",
  "10",
  "+3",
  "-2",
  "3.0",
  "1 2",
  "abc",
  "2x",
  3,
  null,
  undefined,
  false,
];

core("core bad qty text reports BadQty with the original value", () =>
  inScope((s) => {
    for (const qty of BAD_QTYS)
      failsWith(s, app.addTicket, { table: "4", dish: "Soup", qty }, "BadQty", { qty });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_QTYS.length} bad values, none defaulted`;
  }),
);

const BAD_SIZES = ["", " ", "0", "6", "+3", "-3", "3.0", "1 2", "abc", " 3 x", 3, null, undefined];

core("core bad stove size text reports BadSize first with the original value", () =>
  inScope((s) => {
    const a = add(s, "1", "Soup", "1");
    const b = add(s, "2", "Soup", "1");
    cook(s, a.id);
    cook(s, b.id);
    for (const size of BAD_SIZES) failsWith(s, app.setStove, { size }, "BadSize", { size });
    assert.equal(stoveSize(s), 3);
    assert.equal(undoCount(s), 4, "no undo step");
    return `${BAD_SIZES.length} bad values; 3.0 beside size 3 and 0 beside 2 cooking`;
  }),
);

const BAD_DISHES = [
  "",
  "   ",
  "soup",
  "SOUP",
  "Soups",
  "Pizza",
  "Soup Salad",
  "Soup,Salad",
  1,
  null,
  undefined,
  ["Soup"],
];

core("core unknown dish reports UnknownDish with the original value", () =>
  inScope((s) => {
    for (const dish of BAD_DISHES)
      failsWith(s, app.addTicket, { table: "4", dish, qty: "2" }, "UnknownDish", { dish });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_DISHES.length} values: blank, case, off-menu, non-text`;
  }),
);

core("core unknown ticket ids report NotFound with that id", () =>
  inScope((s) => {
    const id = "missing-ticket";
    failsWith(s, app.startCooking, { ticketId: id }, "NotFound", { id });
    failsWith(s, app.serveTicket, { ticketId: id }, "NotFound", { id });
    failsWith(s, app.cancelTicket, { ticketId: id }, "NotFound", { id });
    const gone = add(s, "4", "Soup", "1");
    cancel(s, gone.id);
    failsWith(s, app.startCooking, { ticketId: gone.id }, "NotFound", { id: gone.id });
    failsWith(s, app.cancelTicket, { ticketId: gone.id }, "NotFound", { id: gone.id });
    assert.equal(undoCount(s), 2);
    return "start, serve, cancel; a cancelled ticket's id";
  }),
);

// NotFound's payload is { id: string }: an id that is not text names no
// record and still reports text. Which text is not named, so only its type
// is checked.
const notFoundText = (s, op, input) => {
  const before = snap(s);
  const error = caught(() => s.run(op, { input }));
  assert.equal(error?.kind, "NotFound", `want NotFound for ${String(input.ticketId)}`);
  assert.deepStrictEqual(Object.keys(error.payload ?? {}), ["id"]);
  assert.equal(typeof error.payload.id, "string", "NotFound id is text");
  assert.deepStrictEqual(snap(s), before);
};

core("core ids that are not text report NotFound with a text id", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    cook(s, a.id);
    add(s, "5", "Soup", "1");
    for (const id of [5, null, undefined, true, {}]) {
      notFoundText(s, app.startCooking, { ticketId: id });
      notFoundText(s, app.serveTicket, { ticketId: id });
      notFoundText(s, app.cancelTicket, { ticketId: id });
    }
    assert.equal(undoCount(s), 3);
    return "5 non-text ids on 3 operations, string payload";
  }),
);

core("core adding the same table and dish grows the waiting ticket in place", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "2");
    const b = add(s, "5", "Soup", "1");
    const before = snap(s);
    const merged = add(s, " 4 ", " Soup", "3 ");
    assert.deepStrictEqual(plain(merged), { ...plain(a), qty: 5 });
    assert.deepStrictEqual(snap(s).tickets, [{ ...plain(a), qty: 5 }, plain(b)]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "same id, same place, qty 2+3, one undo step";
  }),
);

core("core a merged qty above 9 reports TooMany with the id and total", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "5");
    failsWith(s, app.addTicket, { table: "4", dish: "Soup", qty: "5" }, "TooMany", {
      id: a.id,
      qty: 10,
    });
    assert.equal(add(s, "4", "Soup", "4").qty, 9);
    failsWith(s, app.addTicket, { table: "4", dish: "Soup", qty: "9" }, "TooMany", {
      id: a.id,
      qty: 18,
    });
    assert.equal(undoCount(s), 2);
    return "5+5 fails, 5+4 makes 9, 9+9 fails";
  }),
);

core("core cooking and served tickets never merge", () =>
  inScope((s) => {
    const first = add(s, "4", "Soup", "1");
    cook(s, first.id);
    serve(s, first.id);
    const second = add(s, "4", "Soup", "2");
    assert.notEqual(second.id, first.id);
    cook(s, second.id);
    const third = add(s, "4", "Soup", "3");
    assert.ok(![first.id, second.id].includes(third.id), "a new ticket");
    const grown = add(s, "4", "Soup", "4");
    assert.deepStrictEqual(plain(grown), { ...waiting(third), qty: 7 });
    assert.deepStrictEqual(snap(s).tickets, [
      { ...served(first) },
      { ...cooking(second) },
      { ...waiting(third), qty: 7 },
    ]);
    return "served and cooking stay; a waiting one grows";
  }),
);

core("core startCooking moves a waiting ticket to cooking with one undo step", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    const b = add(s, "5", "Cake", "2");
    const before = snap(s);
    assert.deepStrictEqual(plain(cook(s, a.id)), cooking(a));
    assert.deepStrictEqual(snap(s).tickets, [cooking(a), plain(b)]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "cooking in place, saved ticket returned";
  }),
);

core("core starting a cooking ticket passes with no change or undo step", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    cook(s, a.id);
    const before = snap(s);
    assert.deepStrictEqual(plain(cook(s, a.id)), cooking(a));
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "saved ticket returned, no step";
  }),
);

core("core starting a cooking ticket passes even when the stove is full", () =>
  inScope((s) => {
    const rows = [add(s, "1", "Soup", "1"), add(s, "2", "Soup", "1"), add(s, "3", "Soup", "1")];
    for (const row of rows) cook(s, row.id);
    const before = snap(s);
    for (const row of rows) assert.deepStrictEqual(plain(cook(s, row.id)), cooking(row));
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 6);
    return "already cooking beats StoveFull, no step";
  }),
);

core("core a waiting ticket on a full stove reports StoveFull with the size", () =>
  inScope((s) => {
    const rows = ["1", "2", "3", "4", "5"].map((table) => add(s, table, "Pasta", "1"));
    for (const row of rows.slice(0, 3)) cook(s, row.id);
    failsWith(s, app.startCooking, { ticketId: rows[3].id }, "StoveFull", { size: 3 });
    sizeTo(s, "4");
    cook(s, rows[3].id);
    failsWith(s, app.startCooking, { ticketId: rows[4].id }, "StoveFull", { size: 4 });
    serve(s, rows[0].id);
    assert.equal(cook(s, rows[4].id).state, "cooking");
    return "3 of 3, 4 of 4 full; a served ticket frees a place";
  }),
);

core("core starting a served ticket reports AlreadyServed", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    cook(s, a.id);
    serve(s, a.id);
    failsWith(s, app.startCooking, { ticketId: a.id }, "AlreadyServed", { id: a.id });
    assert.equal(undoCount(s), 3);
    return "served ticket refused, no step";
  }),
);

core("core starting a served ticket reports AlreadyServed even when the stove is full", () =>
  inScope((s) => {
    sizeTo(s, "1");
    const a = add(s, "4", "Soup", "1");
    const b = add(s, "5", "Soup", "1");
    cook(s, a.id);
    serve(s, a.id);
    cook(s, b.id);
    failsWith(s, app.startCooking, { ticketId: a.id }, "AlreadyServed", { id: a.id });
    return "StoveFull is only for a waiting ticket";
  }),
);

core("core serveTicket moves a cooking ticket to served with one undo step", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    const b = add(s, "5", "Cake", "2");
    cook(s, a.id);
    const before = snap(s);
    assert.deepStrictEqual(plain(serve(s, a.id)), served(a));
    assert.deepStrictEqual(snap(s).tickets, [served(a), plain(b)]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "served in place, saved ticket returned";
  }),
);

core("core serving a served ticket passes with no change or undo step", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    cook(s, a.id);
    serve(s, a.id);
    const before = snap(s);
    assert.deepStrictEqual(plain(serve(s, a.id)), served(a));
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "saved ticket returned, no step";
  }),
);

core("core serving a waiting ticket reports NotCooking", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    failsWith(s, app.serveTicket, { ticketId: a.id }, "NotCooking", { id: a.id });
    assert.equal(undoCount(s), 1);
    return "waiting ticket refused, no step";
  }),
);

core("core cancel removes a waiting ticket with one undo step", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    const b = add(s, "5", "Soup", "1");
    const c = add(s, "6", "Soup", "1");
    const before = snap(s);
    assert.equal(cancel(s, b.id), undefined);
    assert.deepStrictEqual(snap(s).tickets, [plain(a), plain(c)]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "ticket gone, undo brings it back in place";
  }),
);

core("core cancelling a cooking or served ticket reports CannotCancel", () =>
  inScope((s) => {
    const hot = add(s, "4", "Soup", "1");
    const done = add(s, "5", "Soup", "1");
    cook(s, hot.id);
    cook(s, done.id);
    serve(s, done.id);
    failsWith(s, app.cancelTicket, { ticketId: hot.id }, "CannotCancel", { id: hot.id });
    failsWith(s, app.cancelTicket, { ticketId: done.id }, "CannotCancel", { id: done.id });
    assert.equal(undoCount(s), 5);
    return "cooking and served refused";
  }),
);

core("core setStove changes the size with one undo step and returns it", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    assert.equal(sizeTo(s, " 5 "), 5);
    assert.deepStrictEqual(snap(s), { tickets: [plain(a)], stove: 5 });
    undo(s);
    assert.deepStrictEqual(snap(s), { tickets: [plain(a)], stove: 3 });
    assert.equal(undoCount(s), 1);
    return "trimmed, saved, undone";
  }),
);

core("core setStove to the size it has passes with no change or undo step", () =>
  inScope((s) => {
    const before = snap(s);
    assert.equal(sizeTo(s, "3"), 3);
    assert.equal(sizeTo(s, " 3 "), 3);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 0);
    sizeTo(s, "2");
    assert.equal(sizeTo(s, "2"), 2);
    assert.equal(undoCount(s), 1);
    return "size returned, no step";
  }),
);

core("core setStove below the cooking count reports BelowCooking", () =>
  inScope((s) => {
    const rows = ["1", "2", "3"].map((table) => add(s, table, "Steak", "1"));
    for (const row of rows) cook(s, row.id);
    failsWith(s, app.setStove, { size: "2" }, "BelowCooking", { size: 2, cooking: 3 });
    failsWith(s, app.setStove, { size: " 1 " }, "BelowCooking", { size: 1, cooking: 3 });
    assert.equal(sizeTo(s, "4"), 4);
    assert.equal(sizeTo(s, "3"), 3);
    assert.equal(stoveSize(s), 3);
    return "below fails; equal to the cooking count passes";
  }),
);

core("core failed actions leave tickets, stove, and undo unchanged", () =>
  inScope((s) => {
    sizeTo(s, "2");
    const full = add(s, "1", "Soup", "9");
    const hot = add(s, "2", "Soup", "1");
    const done = add(s, "3", "Soup", "1");
    const idle = add(s, "4", "Soup", "1");
    cook(s, hot.id);
    cook(s, done.id);
    serve(s, done.id);
    cook(s, full.id);
    const cold = add(s, "5", "Salad", "8");
    const tries = [
      [app.addTicket, { table: "0", dish: "Soup", qty: "1" }, "BadTable"],
      [app.addTicket, { table: "1", dish: "Pizza", qty: "1" }, "UnknownDish"],
      [app.addTicket, { table: "1", dish: "Soup", qty: "" }, "BadQty"],
      [app.addTicket, { table: "5", dish: "Salad", qty: "2" }, "TooMany"],
      [app.startCooking, { ticketId: "missing-ticket" }, "NotFound"],
      [app.startCooking, { ticketId: idle.id }, "StoveFull"],
      [app.startCooking, { ticketId: done.id }, "AlreadyServed"],
      [app.serveTicket, { ticketId: cold.id }, "NotCooking"],
      [app.cancelTicket, { ticketId: hot.id }, "CannotCancel"],
      [app.cancelTicket, { ticketId: done.id }, "CannotCancel"],
      [app.setStove, { size: "x" }, "BadSize"],
      [app.setStove, { size: "1" }, "BelowCooking"],
    ];
    for (const [op, input, kind] of tries) {
      const before = snap(s);
      assert.equal(caught(() => s.run(op, { input }))?.kind, kind);
      assert.deepStrictEqual(snap(s), before, `${kind} changed tickets or stove`);
    }
    assert.equal(undoCount(s), 10);
    assert.deepStrictEqual(snap(s), { tickets: [], stove: 3 });
    return `${tries.length} failures, no write, no step`;
  }),
);

core("core undo restores the exact tickets and stove in order", () =>
  inScope((s) => {
    const steps = [snap(s)];
    const a = add(s, "4", "Soup", "1");
    steps.push(snap(s));
    const b = add(s, "5", "Cake", "2");
    steps.push(snap(s));
    add(s, "4", "Soup", "3");
    steps.push(snap(s));
    cook(s, a.id);
    steps.push(snap(s));
    sizeTo(s, "1");
    steps.push(snap(s));
    serve(s, a.id);
    steps.push(snap(s));
    cancel(s, b.id);
    steps.push(snap(s));
    sizeTo(s, "5");
    for (const want of steps.reverse()) {
      assert.equal(undo(s), undefined);
      assert.deepStrictEqual(snap(s), want);
    }
    assert.equal(caught(() => undo(s))?.kind, "EmptyUndo");
    return "eight steps back, exact tickets and stove";
  }),
);

core("core ids stay unique and are never reused after undo", () =>
  inScope((s) => {
    const a = add(s, "4", "Soup", "1");
    const b = add(s, "5", "Soup", "1");
    undo(s);
    undo(s);
    const seen = new Set([a.id, b.id]);
    const c = add(s, "4", "Soup", "1");
    const d = add(s, "5", "Soup", "1");
    for (const id of [c.id, d.id]) assert.ok(!seen.has(id), `id ${id} reused`);
    assert.notEqual(c.id, d.id);
    return "fresh ids after undo";
  }),
);

core("core two scopes share nothing", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    const t = add(a, "4", "Soup", "1");
    cook(a, t.id);
    sizeTo(a, "5");
    assert.deepStrictEqual(snap(b), { tickets: [], stove: 3 });
    assert.equal(caught(() => undo(b))?.kind, "EmptyUndo");
    add(b, "9", "Cake", "2");
    sizeTo(b, "1");
    assert.deepStrictEqual(
      ticketList(a).map((row) => row.dish),
      ["Soup"],
    );
    assert.equal(stoveSize(a), 5);
    return "separate tickets, stove, and history";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core thrown errors narrow through isError", () =>
  inScope((s) => {
    const bad = caught(() => add(s, "4", "Soup", "abc"));
    assert.ok(app.isError(bad, "BadQty"), "want BadQty");
    assert.ok(!app.isError(bad, "NotFound"), "BadQty is not NotFound");
    assert.deepStrictEqual(bad.payload, { qty: "abc" });
    const gone = caught(() => cook(s, "missing-ticket"));
    assert.ok(app.isError(gone, "NotFound"), "want NotFound");
    const empty = caught(() => undo(s));
    assert.ok(app.isError(empty, "EmptyUndo"), "want EmptyUndo");
    return "BadQty, NotFound, EmptyUndo";
  }),
);

// ---- browser checks: real Chromium, fresh mounts ----
const URL_ROOT = "http://127.0.0.1:5173";
const browserTests = [];
const browser = (name, fn) => browserTests.push([name, fn]);

const textbox = (scope, name) => scope.getByRole("textbox", { name, exact: true });
const tableBox = (scope) => textbox(scope, "Table");
const qtyBox = (scope) => textbox(scope, "Qty");
const sizeBox = (scope) => textbox(scope, "Stove size");
const dishBox = (scope) => scope.getByRole("combobox", { name: "Dish", exact: true });
const ticketsTable = (scope) => scope.getByRole("table", { name: "Tickets", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const cookButton = (scope, dish, table) => button(scope, `Cook ${dish} for table ${table}`);
const cancelButton = (scope, dish, table) => button(scope, `Cancel ${dish} for table ${table}`);
const serveButton = (scope, dish, table) => button(scope, `Serve ${dish} for table ${table}`);

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
  // but not where they sit, so a Cook or Serve button inside the State
  // cell must not change what the cell says.
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
const COLUMNS = ["Table", "Dish", "Qty", "State"];
const rowsOf = (scope) => readTable(ticketsTable(scope), COLUMNS);
const tablesShown = async (scope) =>
  (await readTable(ticketsTable(scope), ["Table", "Dish"])).map((row) => row.join(" "));

const optionsOf = (select) =>
  select
    .locator("option")
    .evaluateAll((all) => all.map((o) => [o.textContent?.trim() ?? "", o.value]));

// The saved stove size from the "Stove: <size>" text anywhere in the view.
const wholeOf = (scope) => (typeof scope.goto === "function" ? scope.locator("body") : scope);
const stoveShown = async (scope) => {
  const text = await wholeOf(scope).innerText();
  return /Stove:\s*(\d+)/.exec(text)?.[1] ?? "(no Stove: text)";
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

const addVia = async (scope, table, dish, qty) => {
  await tableBox(scope).fill(table);
  await dishBox(scope).selectOption(dish);
  await qtyBox(scope).fill(qty);
  await button(scope, "Add ticket").click();
};
// Distinct table and dish pairs only: two rows with one pair would share
// one button name.
const addTickets = async (scope, rows) => {
  for (const [table, dish, qty] of rows) {
    await addVia(scope, table, dish, qty);
    await cookButton(scope, dish, table).waitFor();
  }
};
const setSize = async (scope, size) => {
  await sizeBox(scope).fill(size);
  await button(scope, "Set stove").click();
};
const raiseBadTable = async (scope) => {
  await tableBox(scope).fill("abc");
  await dishBox(scope).selectOption("Soup");
  await qtyBox(scope).fill("2");
  await button(scope, "Add ticket").click();
  await seeAlert(scope, "BadTable");
};
const open = async (page) => {
  await page.goto(URL_ROOT);
  await ticketsTable(page).waitFor();
};

browser("browser loads empty forms, Stove: 3, the Tickets table, and the filters", async (page) => {
  await open(page);
  for (const box of [tableBox, qtyBox, sizeBox]) assert.equal(await box(page).inputValue(), "");
  assert.equal(await dishBox(page).inputValue(), "");
  assert.deepStrictEqual(await optionsOf(dishBox(page)), [
    ["Choose dish", ""],
    ...DISHES.map((dish) => [dish, dish]),
  ]);
  for (const name of ["Add ticket", "Set stove", "Undo", "All", "Waiting", "Cooking", "Served"])
    await button(page, name).waitFor();
  assert.ok(await button(page, "Undo").isEnabled(), "Undo enabled on empty history");
  assert.equal(await stoveShown(page), "3");
  assert.deepStrictEqual(await rowsOf(page), []);
  assert.equal(await alertText(page), "");
  return "inputs empty, Choose dish then MENU values, Stove: 3, named columns";
});

browser(
  "browser Add ticket appends a waiting row, clears Table and Qty, and keeps Dish",
  async (page) => {
    await open(page);
    await addVia(page, " 4 ", "Soup", " 2 ");
    await settle(() => rowsOf(page), [["4", "Soup", "2", "Waiting"]]);
    assert.equal(await tableBox(page).inputValue(), "");
    assert.equal(await qtyBox(page).inputValue(), "");
    assert.equal(await dishBox(page).inputValue(), "Soup");
    await tableBox(page).fill("7");
    await qtyBox(page).fill("1");
    await button(page, "Add ticket").click();
    await settle(
      () => rowsOf(page),
      [
        ["4", "Soup", "2", "Waiting"],
        ["7", "Soup", "1", "Waiting"],
      ],
    );
    assert.equal(await alertText(page), "");
    return "trimmed, creation order, Dish kept for the next ticket";
  },
);

browser("browser bad ticket input keeps all three fields and shows the kind", async (page) => {
  await open(page);
  await addVia(page, "abc", "Pasta", "2");
  await seeAlert(page, "BadTable");
  assert.equal(await tableBox(page).inputValue(), "abc");
  assert.equal(await dishBox(page).inputValue(), "Pasta");
  assert.equal(await qtyBox(page).inputValue(), "2");
  await tableBox(page).fill("4");
  await qtyBox(page).fill("");
  await button(page, "Add ticket").click();
  await seeAlert(page, "BadQty");
  assert.equal(await tableBox(page).inputValue(), "4");
  assert.equal(await dishBox(page).inputValue(), "Pasta");
  await qtyBox(page).fill("2");
  await dishBox(page).selectOption("");
  await button(page, "Add ticket").click();
  await seeAlert(page, "UnknownDish");
  assert.equal(await tableBox(page).inputValue(), "4");
  assert.equal(await qtyBox(page).inputValue(), "2");
  assert.deepStrictEqual(await rowsOf(page), []);
  return "BadTable, blank BadQty, no dish UnknownDish; text kept";
});

browser(
  "browser the same table and dish grows the waiting row; above 9 shows TooMany",
  async (page) => {
    await open(page);
    await addTickets(page, [["4", "Soup", "2"]]);
    await addVia(page, "4", "Soup", "3");
    await settle(() => rowsOf(page), [["4", "Soup", "5", "Waiting"]]);
    await addVia(page, "4", "Soup", "5");
    await seeAlert(page, "TooMany");
    assert.equal(await tableBox(page).inputValue(), "4");
    assert.equal(await qtyBox(page).inputValue(), "5");
    assert.deepStrictEqual(await rowsOf(page), [["4", "Soup", "5", "Waiting"]]);
    return "one row, qty 2+3; 5+5 refused, form kept";
  },
);

browser(
  "browser row buttons follow the state: Cook and Cancel, then Serve, then none",
  async (page) => {
    await open(page);
    await addTickets(page, [
      ["1", "Soup", "1"],
      ["2", "Salad", "1"],
      ["3", "Pasta", "2"],
    ]);
    await cancelButton(page, "Soup", "1").waitFor();
    assert.equal(await serveButton(page, "Soup", "1").count(), 0);
    await cookButton(page, "Soup", "1").click();
    await serveButton(page, "Soup", "1").waitFor();
    await settle(() => cookButton(page, "Soup", "1").count(), 0);
    assert.equal(await cancelButton(page, "Soup", "1").count(), 0);
    await settle(() => rowsOf(page).then((rows) => rows[0]), ["1", "Soup", "1", "Cooking"]);
    await serveButton(page, "Soup", "1").click();
    await settle(() => rowsOf(page).then((rows) => rows[0]), ["1", "Soup", "1", "Served"]);
    for (const find of [cookButton, cancelButton, serveButton])
      assert.equal(await find(page, "Soup", "1").count(), 0);
    await cancelButton(page, "Salad", "2").click();
    await settle(
      () => rowsOf(page),
      [
        ["1", "Soup", "1", "Served"],
        ["3", "Pasta", "2", "Waiting"],
      ],
    );
    assert.equal(await alertText(page), "");
    return "Waiting: Cook and Cancel; Cooking: Serve; Served: none; Cancel removes";
  },
);

browser("browser a full stove shows StoveFull and keeps the Cook button enabled", async (page) => {
  await open(page);
  await setSize(page, "1");
  await settle(() => stoveShown(page), "1");
  await addTickets(page, [
    ["1", "Soup", "1"],
    ["2", "Salad", "1"],
  ]);
  await cookButton(page, "Soup", "1").click();
  await serveButton(page, "Soup", "1").waitFor();
  assert.ok(await cookButton(page, "Salad", "2").isEnabled(), "Cook stays enabled");
  await cookButton(page, "Salad", "2").click();
  await seeAlert(page, "StoveFull");
  assert.deepStrictEqual(await rowsOf(page), [
    ["1", "Soup", "1", "Cooking"],
    ["2", "Salad", "1", "Waiting"],
  ]);
  await serveButton(page, "Soup", "1").click();
  await noAlert(page);
  await cookButton(page, "Salad", "2").click();
  await settle(() => rowsOf(page).then((rows) => rows[1]), ["2", "Salad", "1", "Cooking"]);
  return "StoveFull shown; serving frees the stove";
});

browser("browser Set stove shows the size and clears the input; failure keeps it", async (page) => {
  await open(page);
  await setSize(page, " 5 ");
  await settle(() => stoveShown(page), "5");
  assert.equal(await sizeBox(page).inputValue(), "");
  await setSize(page, "abc");
  await seeAlert(page, "BadSize");
  assert.equal(await sizeBox(page).inputValue(), "abc");
  assert.equal(await stoveShown(page), "5");
  await addTickets(page, [
    ["1", "Soup", "1"],
    ["2", "Soup", "1"],
  ]);
  await cookButton(page, "Soup", "1").click();
  await cookButton(page, "Soup", "2").click();
  await serveButton(page, "Soup", "2").waitFor();
  await setSize(page, "1");
  await seeAlert(page, "BelowCooking");
  assert.equal(await sizeBox(page).inputValue(), "1");
  assert.equal(await stoveShown(page), "5");
  return "Stove: 5, input cleared; BadSize and BelowCooking keep the text";
});

browser("browser filters show only rows in that state and update live", async (page) => {
  await open(page);
  await addTickets(page, [
    ["1", "Soup", "1"],
    ["2", "Salad", "1"],
    ["3", "Pasta", "1"],
    ["4", "Cake", "1"],
  ]);
  await cookButton(page, "Soup", "1").click();
  await serveButton(page, "Soup", "1").click();
  await cookButton(page, "Salad", "2").click();
  await settle(
    () => rowsOf(page),
    [
      ["1", "Soup", "1", "Served"],
      ["2", "Salad", "1", "Cooking"],
      ["3", "Pasta", "1", "Waiting"],
      ["4", "Cake", "1", "Waiting"],
    ],
  );
  await button(page, "Waiting").click();
  await settle(() => tablesShown(page), ["3 Pasta", "4 Cake"]);
  await button(page, "Cooking").click();
  await settle(() => tablesShown(page), ["2 Salad"]);
  await button(page, "Served").click();
  await settle(() => tablesShown(page), ["1 Soup"]);
  await button(page, "Waiting").click();
  await settle(() => tablesShown(page), ["3 Pasta", "4 Cake"]);
  await cookButton(page, "Pasta", "3").click();
  await settle(() => tablesShown(page), ["4 Cake"]);
  await button(page, "Cooking").click();
  await settle(() => tablesShown(page), ["2 Salad", "3 Pasta"]);
  await button(page, "All").click();
  await settle(() => tablesShown(page), ["1 Soup", "2 Salad", "3 Pasta", "4 Cake"]);
  return "Waiting, Cooking, Served only their state; rows move without another click";
});

browser("browser typing clears an earlier alert", async (page) => {
  await open(page);
  await raiseBadTable(page);
  await qtyBox(page).fill("3");
  await noAlert(page);
  await button(page, "Add ticket").click();
  await seeAlert(page, "BadTable");
  await sizeBox(page).fill("4");
  await noAlert(page);
  await button(page, "Add ticket").click();
  await seeAlert(page, "BadTable");
  await tableBox(page).fill("5");
  await noAlert(page);
  return "Qty, Stove size, and Table typing clear";
});

browser("browser choosing a dish clears an earlier alert", async (page) => {
  await open(page);
  await raiseBadTable(page);
  await dishBox(page).selectOption("Cake");
  await noAlert(page);
  assert.equal(await tableBox(page).inputValue(), "abc");
  return "Dish select clears";
});

browser("browser filtering clears an earlier alert", async (page) => {
  await open(page);
  await raiseBadTable(page);
  await button(page, "Cooking").click();
  await noAlert(page);
  await button(page, "Add ticket").click();
  await seeAlert(page, "BadTable");
  await button(page, "All").click();
  await noAlert(page);
  return "Cooking and All clear";
});

browser("browser a passing no-op stove size clears an earlier alert", async (page) => {
  await open(page);
  await sizeBox(page).fill("3");
  await button(page, "Undo").click();
  await seeAlert(page, "EmptyUndo");
  await button(page, "Set stove").click();
  await noAlert(page);
  assert.equal(await stoveShown(page), "3");
  await button(page, "Undo").click();
  await seeAlert(page, "EmptyUndo");
  return "same size passes, clears, adds no step";
});

browser(
  "browser undo restores records and the stove and keeps form text, dish, and filter",
  async (page) => {
    await open(page);
    await addTickets(page, [
      ["1", "Soup", "1"],
      ["2", "Salad", "2"],
    ]);
    await cookButton(page, "Soup", "1").click();
    await serveButton(page, "Soup", "1").waitFor();
    await setSize(page, "4");
    await settle(() => stoveShown(page), "4");
    await button(page, "Waiting").click();
    await settle(() => tablesShown(page), ["2 Salad"]);
    await tableBox(page).fill("7");
    await dishBox(page).selectOption("Cake");
    await qtyBox(page).fill("4");
    await sizeBox(page).fill("2");
    await button(page, "Undo").click();
    await settle(() => stoveShown(page), "3");
    assert.deepStrictEqual(await tablesShown(page), ["2 Salad"]);
    await button(page, "Undo").click();
    await settle(() => tablesShown(page), ["1 Soup", "2 Salad"]);
    assert.equal(await tableBox(page).inputValue(), "7");
    assert.equal(await dishBox(page).inputValue(), "Cake");
    assert.equal(await qtyBox(page).inputValue(), "4");
    assert.equal(await sizeBox(page).inputValue(), "2");
    await button(page, "All").click();
    await settle(
      () => rowsOf(page),
      [
        ["1", "Soup", "1", "Waiting"],
        ["2", "Salad", "2", "Waiting"],
      ],
    );
    return "stove and cook undone; text, Cake, and Waiting filter kept";
  },
);

browser("browser undo on empty history shows EmptyUndo", async (page) => {
  await open(page);
  await button(page, "Undo").click();
  await seeAlert(page, "EmptyUndo");
  await addVia(page, "4", "Soup", "1");
  await noAlert(page);
  await settle(() => tablesShown(page), ["4 Soup"]);
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
  if (!appMod?.KitchenApp) throw new Error("cannot import submission entry");
  const jsx = await resolveJsx(paths);
  const createRoot = await loadCreateRoot(pickClientPath(paths));
  const holder = document.createElement("div");
  holder.id = "teacher-second-root";
  document.body.appendChild(holder);
  createRoot(holder).render(jsx(appMod.KitchenApp));
};

// First root: records, a cooking row hidden by the Waiting filter, a
// changed stove, typed text, and a chosen dish. The second root changes
// everything of its own; the first must not move.
const seedFirstRoot = async (first) => {
  await addTickets(first, [
    ["1", "Soup", "1"],
    ["2", "Salad", "2"],
  ]);
  await cookButton(first, "Soup", "1").click();
  await serveButton(first, "Soup", "1").waitFor();
  await setSize(first, "4");
  await settle(() => stoveShown(first), "4");
  await button(first, "Waiting").click();
  await tableBox(first).fill("8");
  await dishBox(first).selectOption("Steak");
  await qtyBox(first).fill("3");
  await sizeBox(first).fill("2");
  await settle(() => tablesShown(first), ["2 Salad"]);
};
const changeSecondRoot = async (second) => {
  assert.deepStrictEqual(await rowsOf(second), []);
  assert.equal(await stoveShown(second), "3");
  assert.equal(await tableBox(second).inputValue(), "");
  assert.equal(await dishBox(second).inputValue(), "");
  await addTickets(second, [["9", "Cake", "1"]]);
  await cookButton(second, "Cake", "9").click();
  await serveButton(second, "Cake", "9").waitFor();
  await setSize(second, "1");
  await settle(() => stoveShown(second), "1");
  await button(second, "Served").click();
  await raiseBadTable(second);
};
const firstUnmoved = async (first) => {
  await settle(() => tablesShown(first), ["2 Salad"]);
  assert.equal(await stoveShown(first), "4");
  assert.equal(await tableBox(first).inputValue(), "8");
  assert.equal(await dishBox(first).inputValue(), "Steak");
  assert.equal(await qtyBox(first).inputValue(), "3");
  assert.equal(await sizeBox(first).inputValue(), "2");
  assert.equal(await alertText(first), "");
};

browser("browser two KitchenApps share nothing", async (page) => {
  try {
    await open(page);
    const first = page.locator("#root");
    await seedFirstRoot(first);
    await page.evaluate(mountSecondRoot);
    const second = page.locator("#teacher-second-root");
    await ticketsTable(second).waitFor();
    await changeSecondRoot(second);
    await firstUnmoved(first);
    await button(first, "Undo").click();
    await settle(() => stoveShown(first), "3");
    assert.equal(await stoveShown(second), "1");
    await seeAlert(second, "BadTable");
    assert.equal(await tableBox(second).inputValue(), "abc");
    await settle(() => tablesShown(second), []);
    await button(second, "All").click();
    await settle(() => rowsOf(second), [["9", "Cake", "1", "Cooking"]]);
    return "records, stove, text, dish, filter, notice, and undo separate";
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
  cacheDir: "/tmp/teacher-kitchen-browser",
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
