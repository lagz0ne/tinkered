import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance for the stock packet. Runs only inside the
// disposable container: submitted code is imported here, never on the host.
// Case-level results; any error or missing check fails its case, never
// passes. Later cases still run. Source-shape notes stay advisory: ownership
// evidence is a manual lead-review note, distinct from pass/fail.
const root = process.argv[2];
assert.ok(root, "usage: stock-acceptance.mjs <submission-dir>");

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

// Runs over submitted text only; never imports it. The BookingApp ownership
// note inside is advisory: a stock app names StockApp, and only exact-syntax
// rules (console, bare throw, hidden casts, mocks) fail.
for (const c of shapeCases(root).cases) results.push(c);
for (const a of shapeCases(root).advisory) advisory.push(a);
advisory.push({
  name: "ownership evidence is manual",
  detail:
    "React state shape and unknown-error rethrow are lead-review notes, never a pass; only exact-syntax shape cases fail.",
});

// ---- core checks: the frozen stock packet, nothing invented ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-stock-core",
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
const need = (value, label) => {
  assert.ok(value, `missing export: ${label}`);
  return value;
};
const stockRows = (scope) => scope.resolve(need(app.stock, "stock"));
const moveRows = (scope) => scope.resolve(need(app.moves, "moves"));
const draftOf = (scope) => scope.resolve(need(app.editDraft, "editDraft"));
const throws = (scope, op, input) => {
  try {
    scope.run(op, { input });
  } catch (error) {
    return error;
  }
  assert.fail("want throw");
};
const throwsVoid = (scope, op) => {
  try {
    scope.run(op, {});
  } catch (error) {
    return error;
  }
  assert.fail("want throw");
};
const coreTests = [];
const core = (name, fn) => coreTests.push([name, fn]);

core("core loads public entry", async () => {
  assert.ok(!loadError, loadError);
  for (const label of [
    "items",
    "places",
    "stock",
    "moves",
    "editDraft",
    "moveStock",
    "openMoveEdit",
    "saveMoveEdit",
    "discardMoveEdit",
    "undoMove",
    "StockApp",
    "isError",
  ])
    need(app[label], label);
  return "entry loads";
});

core("core initial stock is four rows in order", async () => {
  const s = coreMod.createScope();
  try {
    assert.deepStrictEqual(stockRows(s), [
      { item: "Cable", place: "East", quantity: 8 },
      { item: "Cable", place: "West", quantity: 2 },
      { item: "Stand", place: "East", quantity: 3 },
      { item: "Stand", place: "West", quantity: 1 },
    ]);
    assert.deepStrictEqual(moveRows(s), []);
    assert.strictEqual(draftOf(s), undefined);
    return "Cable 8/2, Stand 3/1";
  } finally {
    await s.close();
  }
});

core("core items and places order", async () => {
  assert.deepStrictEqual([...need(app.items, "items")], ["Cable", "Stand"]);
  assert.deepStrictEqual([...need(app.places, "places")], ["East", "West"]);
  return "Cable, Stand; East, West";
});

core("core move conserves stock, spares other rows", async () => {
  const s = coreMod.createScope();
  try {
    const saved = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 3 },
    });
    assert.deepStrictEqual(stockRows(s), [
      { item: "Cable", place: "East", quantity: 5 },
      { item: "Cable", place: "West", quantity: 5 },
      { item: "Stand", place: "East", quantity: 3 },
      { item: "Stand", place: "West", quantity: 1 },
    ]);
    assert.equal(moveRows(s).length, 1);
    assert.deepStrictEqual(moveRows(s)[0], saved);
    assert.equal(saved.item, "Cable");
    assert.equal(saved.from, "East");
    assert.equal(saved.to, "West");
    assert.equal(saved.quantity, 3);
    return "East 5, West 5, Stand untouched";
  } finally {
    await s.close();
  }
});

core("core move ids are nonempty, unique, opaque", async () => {
  const s = coreMod.createScope();
  try {
    s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    s.run(app.moveStock, {
      input: { item: "Stand", from: "East", to: "West", quantity: 1 },
    });
    const ids = moveRows(s).map((m) => m.id);
    assert.equal(ids.length, 2);
    for (const id of ids) assert.equal(typeof id, "string");
    assert.ok(ids.every((id) => id.length > 0));
    assert.notEqual(ids[0], ids[1]);
    return "two distinct nonempty ids";
  } finally {
    await s.close();
  }
});

core("core UnknownItem keeps the original value", async () => {
  const s = coreMod.createScope();
  try {
    const before = stockRows(s);
    const failed = throws(s, app.moveStock, {
      item: "Wire",
      from: "East",
      to: "West",
      quantity: 1,
    });
    assert.equal(failed.kind, "UnknownItem");
    assert.deepStrictEqual(failed.payload, { item: "Wire" });
    assert.deepStrictEqual(stockRows(s), before);
    assert.deepStrictEqual(moveRows(s), []);
    assert.strictEqual(draftOf(s), undefined);
    assert.equal(throwsVoid(s, app.undoMove).kind, "EmptyUndo");
    return "UnknownItem Wire, nothing written";
  } finally {
    await s.close();
  }
});

core("core UnknownPlace keeps the original value", async () => {
  const s = coreMod.createScope();
  try {
    const before = stockRows(s);
    const failed = throws(s, app.moveStock, {
      item: "Cable",
      from: "North",
      to: "West",
      quantity: 1,
    });
    assert.equal(failed.kind, "UnknownPlace");
    assert.deepStrictEqual(failed.payload, { place: "North" });
    assert.deepStrictEqual(stockRows(s), before);
    assert.deepStrictEqual(moveRows(s), []);
    return "UnknownPlace North, nothing written";
  } finally {
    await s.close();
  }
});

core("core SamePlace reports that place", async () => {
  const s = coreMod.createScope();
  try {
    const before = stockRows(s);
    const failed = throws(s, app.moveStock, {
      item: "Cable",
      from: "East",
      to: "East",
      quantity: 1,
    });
    assert.equal(failed.kind, "SamePlace");
    assert.deepStrictEqual(failed.payload, { place: "East" });
    assert.deepStrictEqual(stockRows(s), before);
    assert.deepStrictEqual(moveRows(s), []);
    return "SamePlace East, nothing written";
  } finally {
    await s.close();
  }
});

core("core BadQuantity for zero, fraction, NaN, infinity", async () => {
  const s = coreMod.createScope();
  try {
    for (const quantity of [0, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      const failed = throws(s, app.moveStock, {
        item: "Cable",
        from: "East",
        to: "West",
        quantity,
      });
      assert.equal(failed.kind, "BadQuantity");
    }
    assert.deepStrictEqual(moveRows(s), []);
    return "six bad quantities rejected";
  } finally {
    await s.close();
  }
});

core("core raw invalid quantity keeps its text", async () => {
  const s = coreMod.createScope();
  try {
    const text = throws(s, app.moveStock, {
      item: "Cable",
      from: "East",
      to: "West",
      quantity: "3",
    });
    assert.equal(text.kind, "BadQuantity");
    assert.strictEqual(text.payload.quantity, "3");
    const blank = throws(s, app.moveStock, {
      item: "Cable",
      from: "East",
      to: "West",
      quantity: "",
    });
    assert.equal(blank.kind, "BadQuantity");
    assert.strictEqual(blank.payload.quantity, "");
    assert.deepStrictEqual(moveRows(s), []);
    return 'BadQuantity "3" and ""';
  } finally {
    await s.close();
  }
});

core("core ShortStock names available and requested", async () => {
  const s = coreMod.createScope();
  try {
    const before = stockRows(s);
    const failed = throws(s, app.moveStock, {
      item: "Cable",
      from: "East",
      to: "West",
      quantity: 9,
    });
    assert.equal(failed.kind, "ShortStock");
    assert.equal(failed.payload.item, "Cable");
    assert.equal(failed.payload.place, "East");
    assert.equal(failed.payload.available, 8);
    assert.equal(failed.payload.requested, 9);
    assert.deepStrictEqual(stockRows(s), before);
    assert.deepStrictEqual(moveRows(s), []);
    assert.equal(throwsVoid(s, app.undoMove).kind, "EmptyUndo");
    return "ShortStock 8 of 9, nothing written";
  } finally {
    await s.close();
  }
});

core("core scopes share no stock, moves, or drafts", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    const made = a.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    a.run(app.openMoveEdit, { input: { id: made.id } });
    assert.equal(moveRows(a).length, 1);
    assert.equal(moveRows(b).length, 0);
    assert.deepStrictEqual(stockRows(b), [
      { item: "Cable", place: "East", quantity: 8 },
      { item: "Cable", place: "West", quantity: 2 },
      { item: "Stand", place: "East", quantity: 3 },
      { item: "Stand", place: "West", quantity: 1 },
    ]);
    assert.strictEqual(draftOf(b), undefined);
    return "separate";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core open copies, mutating the copy writes nothing", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 2 },
    });
    const draft = s.run(app.openMoveEdit, { input: { id: made.id } });
    assert.equal(draft.id, made.id);
    assert.deepStrictEqual(draftOf(s), draft);
    draft.quantity = 99;
    assert.equal(moveRows(s)[0].quantity, 2);
    assert.equal(draftOf(s).quantity, 2);
    assert.equal(throwsVoid(s, app.undoMove).kind, "EmptyUndo");
    s.run(app.discardMoveEdit, { input: { id: made.id } });
    return "copy only, open adds no step";
  } finally {
    await s.close();
  }
});

core("core open of an unknown id reports NotFound", async () => {
  const s = coreMod.createScope();
  try {
    const failed = throws(s, app.openMoveEdit, { id: "gone" });
    assert.equal(failed.kind, "NotFound");
    assert.deepStrictEqual(failed.payload, { id: "gone" });
    assert.strictEqual(draftOf(s), undefined);
    return "NotFound gone";
  } finally {
    await s.close();
  }
});

core("core second open drops the first draft", async () => {
  const s = coreMod.createScope();
  try {
    const a = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    const b = s.run(app.moveStock, {
      input: { item: "Stand", from: "East", to: "West", quantity: 1 },
    });
    s.run(app.openMoveEdit, { input: { id: a.id } });
    s.run(app.openMoveEdit, { input: { id: b.id } });
    assert.equal(draftOf(s).id, b.id);
    return "second open wins";
  } finally {
    await s.close();
  }
});

core("core save needs an open draft for that id", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    const closed = throws(s, app.saveMoveEdit, {
      id: made.id,
      item: "Cable",
      from: "East",
      to: "West",
      quantity: 1,
    });
    assert.equal(closed.kind, "NotFound");
    assert.deepStrictEqual(closed.payload, { id: made.id });
    const other = s.run(app.moveStock, {
      input: { item: "Stand", from: "East", to: "West", quantity: 1 },
    });
    s.run(app.openMoveEdit, { input: { id: made.id } });
    const different = throws(s, app.saveMoveEdit, {
      id: other.id,
      item: "Stand",
      from: "East",
      to: "West",
      quantity: 1,
    });
    assert.equal(different.kind, "NotFound");
    assert.deepStrictEqual(different.payload, { id: other.id });
    assert.equal(draftOf(s).id, made.id);
    return "closed and different drafts NotFound";
  } finally {
    await s.close();
  }
});

core("core save 3 to 5 keeps id and list place", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 3 },
    });
    s.run(app.openMoveEdit, { input: { id: made.id } });
    const replaced = s.run(app.saveMoveEdit, {
      input: { id: made.id, item: "Cable", from: "East", to: "West", quantity: 5 },
    });
    assert.equal(replaced.id, made.id);
    assert.deepStrictEqual(stockRows(s), [
      { item: "Cable", place: "East", quantity: 3 },
      { item: "Cable", place: "West", quantity: 7 },
      { item: "Stand", place: "East", quantity: 3 },
      { item: "Stand", place: "West", quantity: 1 },
    ]);
    assert.deepStrictEqual(
      moveRows(s).map((m) => [m.id, m.quantity]),
      [[made.id, 5]],
    );
    assert.deepStrictEqual(moveRows(s)[0], replaced);
    assert.strictEqual(draftOf(s), undefined);
    return "East 3, West 7, same id";
  } finally {
    await s.close();
  }
});

core("core save may change item and direction", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 2 },
    });
    s.run(app.openMoveEdit, { input: { id: made.id } });
    const replaced = s.run(app.saveMoveEdit, {
      input: { id: made.id, item: "Stand", from: "West", to: "East", quantity: 1 },
    });
    assert.equal(replaced.id, made.id);
    assert.equal(replaced.item, "Stand");
    assert.equal(replaced.from, "West");
    assert.equal(replaced.to, "East");
    assert.equal(replaced.quantity, 1);
    assert.deepStrictEqual(stockRows(s), [
      { item: "Cable", place: "East", quantity: 8 },
      { item: "Cable", place: "West", quantity: 2 },
      { item: "Stand", place: "East", quantity: 4 },
      { item: "Stand", place: "West", quantity: 0 },
    ]);
    return "Cable restored, Stand West 0";
  } finally {
    await s.close();
  }
});

core("core reversal shortage is atomic, draft stays open", async () => {
  const s = coreMod.createScope();
  try {
    const first = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 3 },
    });
    s.run(app.moveStock, {
      input: { item: "Cable", from: "West", to: "East", quantity: 4 },
    });
    const beforeStock = stockRows(s);
    const beforeMoves = moveRows(s).map((m) => ({ ...m }));
    s.run(app.openMoveEdit, { input: { id: first.id } });
    const failed = throws(s, app.saveMoveEdit, {
      id: first.id,
      item: "Cable",
      from: "East",
      to: "West",
      quantity: 5,
    });
    assert.equal(failed.kind, "ShortStock");
    assert.equal(failed.payload.item, "Cable");
    assert.equal(failed.payload.place, "West");
    assert.equal(failed.payload.available, 1);
    assert.equal(failed.payload.requested, 3);
    assert.deepStrictEqual(stockRows(s), beforeStock);
    assert.deepStrictEqual(
      moveRows(s).map((m) => ({ ...m })),
      beforeMoves,
    );
    assert.equal(draftOf(s).id, first.id);
    s.run(app.undoMove, {});
    assert.deepStrictEqual(
      moveRows(s).map((m) => m.id),
      [first.id],
    );
    return "ShortStock West 1 of 3, failed save adds no step";
  } finally {
    await s.close();
  }
});

core("core replacement shortage is atomic, draft stays open", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 3 },
    });
    const beforeStock = stockRows(s);
    s.run(app.openMoveEdit, { input: { id: made.id } });
    const failed = throws(s, app.saveMoveEdit, {
      id: made.id,
      item: "Cable",
      from: "East",
      to: "West",
      quantity: 9,
    });
    assert.equal(failed.kind, "ShortStock");
    assert.equal(failed.payload.place, "East");
    assert.equal(failed.payload.available, 8);
    assert.equal(failed.payload.requested, 9);
    assert.deepStrictEqual(stockRows(s), beforeStock);
    assert.equal(moveRows(s).length, 1);
    assert.equal(moveRows(s)[0].quantity, 3);
    assert.equal(draftOf(s).id, made.id);
    return "ShortStock East 8 of 9, nothing written";
  } finally {
    await s.close();
  }
});

core("core discard closes and writes nothing", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    s.run(app.openMoveEdit, { input: { id: made.id } });
    s.run(app.discardMoveEdit, { input: { id: made.id } });
    assert.strictEqual(draftOf(s), undefined);
    assert.equal(moveRows(s).length, 1);
    const closed = throws(s, app.discardMoveEdit, { id: made.id });
    assert.equal(closed.kind, "NotFound");
    assert.deepStrictEqual(closed.payload, { id: made.id });
    const other = s.run(app.moveStock, {
      input: { item: "Stand", from: "East", to: "West", quantity: 1 },
    });
    s.run(app.openMoveEdit, { input: { id: made.id } });
    const different = throws(s, app.discardMoveEdit, { id: other.id });
    assert.equal(different.kind, "NotFound");
    assert.deepStrictEqual(different.payload, { id: other.id });
    assert.equal(draftOf(s).id, made.id);
    return "closed and different drafts NotFound";
  } finally {
    await s.close();
  }
});

core("core undo restores exact stock and moves, adds no step", async () => {
  const s = coreMod.createScope();
  try {
    const before = stockRows(s);
    s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 3 },
    });
    s.run(app.undoMove, {});
    assert.deepStrictEqual(stockRows(s), before);
    assert.deepStrictEqual(moveRows(s), []);
    assert.equal(throwsVoid(s, app.undoMove).kind, "EmptyUndo");
    return "move undone, history empty";
  } finally {
    await s.close();
  }
});

core("core undo of an edit restores the prior move", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 3 },
    });
    s.run(app.openMoveEdit, { input: { id: made.id } });
    s.run(app.saveMoveEdit, {
      input: { id: made.id, item: "Cable", from: "East", to: "West", quantity: 5 },
    });
    s.run(app.undoMove, {});
    assert.deepStrictEqual(
      moveRows(s).map((m) => [m.id, m.quantity]),
      [[made.id, 3]],
    );
    assert.deepStrictEqual(stockRows(s), [
      { item: "Cable", place: "East", quantity: 5 },
      { item: "Cable", place: "West", quantity: 5 },
      { item: "Stand", place: "East", quantity: 3 },
      { item: "Stand", place: "West", quantity: 1 },
    ]);
    s.run(app.undoMove, {});
    assert.deepStrictEqual(moveRows(s), []);
    assert.equal(throwsVoid(s, app.undoMove).kind, "EmptyUndo");
    return "one step per success";
  } finally {
    await s.close();
  }
});

core("core open, failed, and discard actions add no undo step", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    s.run(app.openMoveEdit, { input: { id: made.id } });
    throws(s, app.saveMoveEdit, {
      id: made.id,
      item: "Cable",
      from: "East",
      to: "West",
      quantity: 99,
    });
    s.run(app.discardMoveEdit, { input: { id: made.id } });
    s.run(app.undoMove, {});
    assert.deepStrictEqual(moveRows(s), []);
    assert.equal(throwsVoid(s, app.undoMove).kind, "EmptyUndo");
    return "only the move was a step";
  } finally {
    await s.close();
  }
});

core("core undo keeps the draft; a removed draft cannot save", async () => {
  const s = coreMod.createScope();
  try {
    const made = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    s.run(app.openMoveEdit, { input: { id: made.id } });
    s.run(app.moveStock, {
      input: { item: "Stand", from: "East", to: "West", quantity: 1 },
    });
    s.run(app.undoMove, {});
    assert.equal(moveRows(s).length, 1);
    assert.equal(draftOf(s).id, made.id);
    s.run(app.undoMove, {});
    assert.deepStrictEqual(moveRows(s), []);
    const gone = throws(s, app.saveMoveEdit, {
      id: made.id,
      item: "Cable",
      from: "East",
      to: "West",
      quantity: 1,
    });
    assert.equal(gone.kind, "NotFound");
    assert.deepStrictEqual(gone.payload, { id: made.id });
    return "draft survives undo, gone id NotFound";
  } finally {
    await s.close();
  }
});

core("core ids are never reused after undo", async () => {
  const s = coreMod.createScope();
  try {
    const issued = new Set();
    const first = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    issued.add(first.id);
    s.run(app.undoMove, {});
    const second = s.run(app.moveStock, {
      input: { item: "Cable", from: "East", to: "West", quantity: 1 },
    });
    assert.ok(!issued.has(second.id));
    assert.notEqual(second.id, first.id);
    return "fresh id after undo";
  } finally {
    await s.close();
  }
});

core("core empty undo reports EmptyUndo", async () => {
  const s = coreMod.createScope();
  try {
    const failed = throwsVoid(s, app.undoMove);
    assert.equal(failed.kind, "EmptyUndo");
    assert.deepStrictEqual(failed.payload, {});
    return "EmptyUndo on a fresh scope";
  } finally {
    await s.close();
  }
});

if (loadError) {
  for (const [name] of coreTests) {
    results.push({ name, pass: false, error: `load failed: ${loadError}`.slice(0, 300) });
  }
} else {
  for (const [name, fn] of coreTests) await test(name, fn);
}
await vite.close();

// No entry, no browser: fail the browser cases on the same load error
// instead of burning timeouts on a page that can never boot.
if (loadError) {
  const names = [
    "browser loads form with initial text",
    "browser stock table shows four rows in order",
    "browser move appends one row in list order",
    "browser blank quantity is BadQuantity and saves nothing",
    "browser form values survive success and failure",
    "browser filter hides rows without deleting",
    "browser editor seeds from the clicked row",
    "browser failed save keeps text, passing save clears notice",
    "browser undo restores stock and keeps draft text",
    "browser discard drops the draft and writes nothing",
    "browser two roots share no stock, form, or notice",
  ];
  for (const name of names)
    results.push({ name, pass: false, error: `load failed: ${loadError}`.slice(0, 300) });
  for (const r of results) {
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.name}${r.pass && r.detail ? ` — ${r.detail}` : ""}${r.pass ? "" : ` — ${r.error}`}`,
    );
  }
  for (const a of advisory) console.log(`NOTE ${a.name} — ${a.detail}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`ACCEPTANCE stock: ${results.length - failed.length}/${results.length} pass`);
  process.exitCode = failed.length ? 1 : 0;
  process.exit(process.exitCode);
}

// ---- browser checks: real Chromium, fresh mounts ----
const server = await createServer({
  root,
  cacheDir: "/tmp/teacher-stock-browser",
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "@tinker/core", "@tinker/react"],
  },
  configFile: false,
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  logLevel: "silent",
});
const browserTests = [];
const browser = (name, fn) => browserTests.push([name, fn]);
let booted = "";
try {
  await server.listen();
  booted = "server listens";
} catch (error) {
  booted = error?.message ?? String(error);
}

browser("browser loads form with initial text", async (page) => {
  assert.ok(booted === "server listens", booted);
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Item", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Item", { exact: true }).inputValue(), "Cable");
  assert.equal(await page.getByLabel("From", { exact: true }).inputValue(), "East");
  assert.equal(await page.getByLabel("To", { exact: true }).inputValue(), "West");
  assert.equal(await page.getByLabel("Quantity", { exact: true }).inputValue(), "1");
  await page.getByRole("button", { name: "Move stock", exact: true }).waitFor();
  return "Cable, East, West, 1";
});

browser("browser stock table shows four rows in order", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Stock" });
  await table.waitFor();
  const text = await table.innerText();
  for (const cell of ["Item", "Place", "Quantity", "Cable", "East", "8", "2", "Stand", "3", "1"])
    assert.match(text, new RegExp(cell), `stock table shows ${cell}`);
  assert.ok(text.indexOf("8") < text.lastIndexOf("2"), "Cable East before Cable West");
  return "four rows in order";
});

browser("browser move appends one row in list order", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const moves = page.getByRole("table", { name: "Moves" });
  await moves.waitFor();
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  await moves.getByRole("button", { name: "Edit move", exact: true }).waitFor();
  assert.equal(await moves.getByRole("button", { name: "Edit move", exact: true }).count(), 1);
  const text = await moves.innerText();
  for (const cell of ["Item", "From", "To", "Quantity", "Cable", "East", "West", "1"])
    assert.match(text, new RegExp(cell), `moves table shows ${cell}`);
  return "one move row with Edit move";
});

browser("browser blank quantity is BadQuantity and saves nothing", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Quantity", { exact: true }).fill("");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "BadQuantity" }).waitFor();
  const moves = page.getByRole("table", { name: "Moves" });
  assert.equal(await moves.getByRole("button", { name: "Edit move", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Quantity", { exact: true }).inputValue(), "");
  return "BadQuantity, nothing saved, text kept";
});

browser("browser form values survive success and failure", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  await page
    .getByRole("table", { name: "Moves" })
    .getByRole("button", { name: "Edit move" })
    .waitFor();
  assert.equal(await page.getByLabel("Item", { exact: true }).inputValue(), "Cable");
  assert.equal(await page.getByLabel("Quantity", { exact: true }).inputValue(), "1");
  await page.getByLabel("Quantity", { exact: true }).fill("99");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "ShortStock" }).waitFor();
  assert.equal(await page.getByLabel("Quantity", { exact: true }).inputValue(), "99");
  return "values kept both ways";
});

browser("browser filter hides rows without deleting", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  await page.getByLabel("Item", { exact: true }).fill("Stand");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  const moves = page.getByRole("table", { name: "Moves" });
  await moves.getByRole("button", { name: "Edit move", exact: true }).nth(1).waitFor();
  await page.getByRole("button", { name: "Cable", exact: true }).click();
  assert.equal(await moves.getByRole("button", { name: "Edit move", exact: true }).count(), 1);
  const stock = await page.getByRole("table", { name: "Stock" }).innerText();
  assert.match(stock, /7/, "filter changes no stock");
  await page.getByRole("button", { name: "All", exact: true }).click();
  assert.equal(await moves.getByRole("button", { name: "Edit move", exact: true }).count(), 2);
  await page.getByRole("button", { name: "Stand", exact: true }).click();
  assert.equal(await moves.getByRole("button", { name: "Edit move", exact: true }).count(), 1);
  return "filter hides, All restores";
});

browser("browser editor seeds from the clicked row", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  await page.getByLabel("Item", { exact: true }).fill("Stand");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  const moves = page.getByRole("table", { name: "Moves" });
  await moves.getByRole("button", { name: "Edit move", exact: true }).nth(1).waitFor();
  await moves.getByRole("button", { name: "Edit move", exact: true }).nth(1).click();
  assert.equal(await page.getByLabel("Edit item", { exact: true }).inputValue(), "Stand");
  await moves.getByRole("button", { name: "Edit move", exact: true }).first().click();
  assert.equal(await page.getByLabel("Edit item", { exact: true }).inputValue(), "Cable");
  assert.equal(await page.getByLabel("Edit quantity", { exact: true }).inputValue(), "1");
  await page.getByLabel("Edit quantity", { exact: true }).fill(" typed");
  assert.match(await moves.innerText(), /Cable/, "typing changes no saved row");
  return "switch replaces all text";
});

browser("browser failed save keeps text, passing save clears notice", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  const moves = page.getByRole("table", { name: "Moves" });
  await moves.getByRole("button", { name: "Edit move", exact: true }).waitFor();
  await moves.getByRole("button", { name: "Edit move", exact: true }).first().click();
  await page.getByLabel("Edit quantity", { exact: true }).fill("99");
  await page.getByRole("button", { name: "Save move", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "ShortStock" }).waitFor();
  assert.equal(await page.getByLabel("Edit quantity", { exact: true }).inputValue(), "99");
  await page.getByLabel("Edit quantity", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save move", exact: true }).click();
  await page.getByRole("button", { name: "Save move", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("alert").count(), 0);
  const stock = await page.getByRole("table", { name: "Stock" }).innerText();
  assert.match(stock, /6/, "edit changes stock");
  return "failure keeps text, success clears";
});

browser("browser undo restores stock and keeps draft text", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
  await page.getByLabel("Item", { exact: true }).fill("typed text");
  await page
    .getByRole("button", { name: "Maple", exact: true })
    .click()
    .catch(() => {});
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "EmptyUndo" }).waitFor();
  assert.equal(await page.getByLabel("Item", { exact: true }).inputValue(), "typed text");
  await page.getByLabel("Item", { exact: true }).fill("Cable");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  const moves = page.getByRole("table", { name: "Moves" });
  await moves.getByRole("button", { name: "Edit move", exact: true }).waitFor();
  await moves.getByRole("button", { name: "Edit move", exact: true }).first().click();
  await page.getByLabel("Edit quantity", { exact: true }).fill("unsaved edit");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await moves.getByRole("button", { name: "Edit move", exact: true }).waitFor({ state: "hidden" });
  assert.equal(
    await page.getByLabel("Edit quantity", { exact: true }).inputValue(),
    "unsaved edit",
  );
  const stock = await page.getByRole("table", { name: "Stock" }).innerText();
  assert.match(stock, /8/, "undo restores East 8");
  return "undo data only, text kept";
});

browser("browser discard drops the draft and writes nothing", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Move stock", exact: true }).click();
  const moves = page.getByRole("table", { name: "Moves" });
  await moves.getByRole("button", { name: "Edit move", exact: true }).waitFor();
  await moves.getByRole("button", { name: "Edit move", exact: true }).first().click();
  await page.getByLabel("Edit quantity", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Discard move", exact: true }).click();
  await page.getByRole("button", { name: "Save move", exact: true }).waitFor({ state: "hidden" });
  const stock = await page.getByRole("table", { name: "Stock" }).innerText();
  assert.match(stock, /7/, "discard changes no stock");
  assert.match(await moves.innerText(), /1/, "discard changes no move");
  return "discard drops text";
});

// Runs inside the page: one ordinary async function passed directly to
// page.evaluate. All helpers nest INSIDE it, so the serialized closure is
// self-contained with complexity split in real code the lint sees.
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
  const paths = performance.getEntriesByType("resource").map((r) => new URL(r.name).pathname);
  const appMod = await pickEntry();
  if (!appMod?.StockApp) throw new Error("cannot import submission entry");
  const jsx = await resolveJsx(paths);
  const createRoot = await loadCreateRoot(pickClientPath(paths));
  const holder = document.createElement("div");
  holder.id = "teacher-second-root";
  document.body.appendChild(holder);
  createRoot(holder).render(jsx(appMod.StockApp));
};

browser("browser two roots share no stock, form, or notice", async (page) => {
  try {
    await page.goto("http://127.0.0.1:5173");
    await page.getByLabel("Item", { exact: true }).waitFor();
    await page.evaluate(mountSecondRoot);
    const secondScope = page.locator("#teacher-second-root");
    await secondScope.waitFor({ state: "attached" });
    let secondItem = secondScope.getByLabel("Item", { exact: true });
    if ((await secondItem.count()) === 0) secondItem = secondScope.locator("input").first();
    let secondQty = secondScope.getByLabel("Quantity", { exact: true });
    if ((await secondQty.count()) === 0) secondQty = secondScope.locator("input").nth(3);
    await secondItem.waitFor({ state: "visible" });
    await secondQty.fill("99");
    await secondScope.getByRole("button", { name: "Move stock", exact: true }).click();
    await secondScope.getByRole("alert").filter({ hasText: "ShortStock" }).waitFor();
    assert.equal(await page.locator("#root").getByRole("alert").count(), 0);
    assert.equal(
      await page.locator("#root").getByLabel("Quantity", { exact: true }).inputValue(),
      "1",
    );
    const firstStock = await page
      .locator("#root")
      .getByRole("table", { name: "Stock" })
      .innerText();
    assert.match(firstStock, /8/, "first root stock untouched");
    return "two roots truly separate";
  } finally {
    await page
      .evaluate(() => document.getElementById("teacher-second-root")?.remove())
      .catch(() => {});
  }
});

let browserHandle;
try {
  browserHandle = await chromium.launch({ headless: true });
  const page = await browserHandle.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(5000);
  for (const [name, fn] of browserTests) await test(name, () => fn(page, browserHandle));
} catch (error) {
  const message = (error?.message ?? String(error)).slice(0, 300);
  for (const [name] of browserTests) {
    if (!results.some((r) => r.name === name)) results.push({ name, pass: false, error: message });
  }
} finally {
  await browserHandle?.close();
  await server.close();
}

for (const r of results) {
  console.log(
    `${r.pass ? "PASS" : "FAIL"} ${r.name}${r.pass && r.detail ? ` — ${r.detail}` : ""}${r.pass ? "" : ` — ${r.error}`}`,
  );
}
for (const a of advisory) console.log(`NOTE ${a.name} — ${a.detail}`);
const failed = results.filter((r) => !r.pass);
console.log(`ACCEPTANCE stock: ${results.length - failed.length}/${results.length} pass`);
process.exitCode = failed.length ? 1 : 0;
