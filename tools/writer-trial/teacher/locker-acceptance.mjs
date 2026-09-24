import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance for the parcel locker task. Runs only inside
// the disposable container: submitted code is imported here, never on the
// host. Every case comes from the frozen task text. Case-level results; any
// error or missing check fails its case, never passes. Later cases still run.
// Browser cases find things by role and accessible name only, and read table
// cells by their column header, so a different DOM layout still passes.
const root = process.argv[2];
assert.ok(root, "usage: locker-acceptance.mjs <submission-dir>");

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
  console.log(`ACCEPTANCE locker: ${results.length - failed.length}/${results.length} pass`);
  console.log(`RESULTS_JSON ${JSON.stringify({ cases: results, advisory })}`);
  process.exitCode = failed.length ? 1 : 0;
};

// ---- core checks: public entry, createScope, scope.run, scope.resolve ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-locker-core",
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
  "LOCKERS",
  "LockerApp",
  "collectParcel",
  "isError",
  "parcels",
  "receiveParcel",
  "returnToDesk",
  "storeParcel",
  "undoDesk",
].sort();
const LOCKER_LIST = [
  { number: 1, size: "S" },
  { number: 2, size: "S" },
  { number: 3, size: "M" },
  { number: 4, size: "M" },
  { number: 5, size: "L" },
  { number: 6, size: "L" },
];
const need = (value, label) => {
  assert.ok(value, `missing export: ${label}`);
  return value;
};
const parcelList = (s) => s.resolve(need(app.parcels, "parcels"));
// Plain clones: a broken in-place write must not pass by comparing a
// record against its own mutated alias.
const plain = (p) => ({ ...p });
const snap = (s) => parcelList(s).map(plain);
const receive = (s, recipient, size) => s.run(app.receiveParcel, { input: { recipient, size } });
const store = (s, parcelId, locker) => s.run(app.storeParcel, { input: { parcelId, locker } });
const collect = (s, parcelId) => s.run(app.collectParcel, { input: { parcelId } });
const giveBack = (s, parcelId) => s.run(app.returnToDesk, { input: { parcelId } });
const undo = (s) => s.run(app.undoDesk, {});
const shown = (value) => (value === undefined ? "undefined" : JSON.stringify(value));
const caught = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("want a thrown managed error");
};
// One failing call: the kind, the exact payload, and parcels left exactly
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
  assert.deepStrictEqual(snap(s), before, `${kind} changed parcels`);
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
const held = (p) => ({ ...plain(p), locker: null, state: "held" });
const stored = (p, locker) => ({ ...plain(p), locker, state: "stored" });
const collected = (p) => ({ ...plain(p), locker: null, state: "collected" });

const coreTests = [];
const core = (name, fn) => coreTests.push([name, fn]);

core("core entry exports exactly the named API", async () => {
  assert.ok(!loadError, loadError);
  for (const label of API) need(app[label], label);
  assert.deepStrictEqual(Object.keys(app).sort(), API);
  return API.join(", ");
});

core("core LOCKERS lists lockers 1 to 6 as S, S, M, M, L, L in number order", () => {
  assert.ok(Array.isArray(app.LOCKERS), "LOCKERS is a list");
  assert.deepStrictEqual(app.LOCKERS.map(plain), LOCKER_LIST);
  return "1 S, 2 S, 3 M, 4 M, 5 L, 6 L";
});

core("core each scope starts with no parcels and EmptyUndo {}", () =>
  inScope((s) => {
    assert.deepStrictEqual(parcelList(s), []);
    const error = caught(() => undo(s));
    assert.equal(error?.kind, "EmptyUndo");
    assert.deepStrictEqual(error.payload, {});
    return "empty list, EmptyUndo {}";
  }),
);

core("core receive trims and appends held parcels with no locker in creation order", () =>
  inScope((s) => {
    const a = receive(s, " Ann ", " M ");
    assert.ok(typeof a.id === "string" && a.id.length > 0, "nonempty text id");
    assert.deepStrictEqual(plain(a), {
      id: a.id,
      recipient: "Ann",
      size: "M",
      locker: null,
      state: "held",
    });
    const b = receive(s, "Bob", "S");
    const c = receive(s, "Ann", "L");
    assert.equal(new Set([a.id, b.id, c.id]).size, 3, "ids distinct");
    assert.deepStrictEqual(snap(s), [
      { id: a.id, recipient: "Ann", size: "M", locker: null, state: "held" },
      { id: b.id, recipient: "Bob", size: "S", locker: null, state: "held" },
      { id: c.id, recipient: "Ann", size: "L", locker: null, state: "held" },
    ]);
    assert.equal(undoCount(s), 3);
    return "trimmed, held, locker null, one step each";
  }),
);

const BAD_RECIPIENTS = ["", "   ", 3, null, undefined, true, ["Ann"]];

core("core blank or non-text recipient reports BlankRecipient with the original value", () =>
  inScope((s) => {
    for (const recipient of BAD_RECIPIENTS)
      failsWith(s, app.receiveParcel, { recipient, size: "S" }, "BlankRecipient", { recipient });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_RECIPIENTS.length} values: blank and non-text`;
  }),
);

const BAD_SIZES = [
  "s",
  "m",
  "l",
  "",
  "   ",
  "XL",
  "SM",
  "S M",
  "Small",
  "M.",
  2,
  null,
  undefined,
  ["S"],
];

core("core bad size text reports BadSize with the original value", () =>
  inScope((s) => {
    for (const size of BAD_SIZES)
      failsWith(s, app.receiveParcel, { recipient: "Ann", size }, "BadSize", { size });
    assert.equal(undoCount(s), 0, "no undo step");
    return `${BAD_SIZES.length} values: lower case, blank, XL, non-text`;
  }),
);

const BAD_LOCKERS = [
  "",
  "   ",
  "0",
  "7",
  "9",
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
];

core("core bad locker text reports BadLocker with the original value", () =>
  inScope((s) => {
    const p = receive(s, "Ann", "S");
    for (const locker of BAD_LOCKERS)
      failsWith(s, app.storeParcel, { parcelId: p.id, locker }, "BadLocker", { locker });
    assert.equal(undoCount(s), 1, "no undo step");
    return `${BAD_LOCKERS.length} values: blank, 0, 7, sign, decimal, space, letters, non-text`;
  }),
);

core("core bad locker text reports BadLocker before any parcel rule", () =>
  inScope((s) => {
    const inside = receive(s, "Ann", "S");
    const gone = receive(s, "Bob", "S");
    store(s, inside.id, "1");
    store(s, gone.id, "2");
    collect(s, gone.id);
    const tries = [
      ["missing-parcel", ""],
      [inside.id, "abc"],
      [inside.id, " "],
      [gone.id, "0"],
      [7, "7"],
    ];
    for (const [parcelId, locker] of tries)
      failsWith(s, app.storeParcel, { parcelId, locker }, "BadLocker", { locker });
    assert.equal(undoCount(s), 5);
    return "unknown, stored, collected, and non-text ids";
  }),
);

core("core unknown parcel ids report NotFound with that id", () =>
  inScope((s) => {
    const id = "missing-parcel";
    failsWith(s, app.storeParcel, { parcelId: id, locker: "5" }, "NotFound", { id });
    failsWith(s, app.collectParcel, { parcelId: id }, "NotFound", { id });
    failsWith(s, app.returnToDesk, { parcelId: id }, "NotFound", { id });
    const undone = receive(s, "Ann", "S");
    undo(s);
    const back = { id: undone.id };
    failsWith(s, app.storeParcel, { parcelId: undone.id, locker: "5" }, "NotFound", back);
    failsWith(s, app.collectParcel, { parcelId: undone.id }, "NotFound", back);
    failsWith(s, app.returnToDesk, { parcelId: undone.id }, "NotFound", back);
    assert.equal(undoCount(s), 0);
    return "store, collect, return; an id removed by undo";
  }),
);

// The miss every earlier trial repeated. NotFound's payload is
// { id: string }: an id that is not text names no record and still
// reports text. Core hands a `{ input }` call to the body unchecked and a
// `{ rawInput }` call through the operation's own reader, so each call
// style is its own case. Which text is not named: only its type is checked.
const NON_TEXT_IDS = [7, null, undefined, true, {}];
const notFoundText = (s, op, call, label) => {
  const before = snap(s);
  const error = caught(() => s.run(op, call));
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
  assert.deepStrictEqual(snap(s), before, `${label} changed parcels`);
};
// One held and one stored parcel, so a lookup that coerces the id could
// still reach a record; a one-item list holding a real id is the trap.
const nonTextIdsReportText = (via) =>
  inScope((s) => {
    const waiting = receive(s, "Ann", "S");
    const inside = receive(s, "Bob", "M");
    store(s, inside.id, "3");
    for (const id of [...NON_TEXT_IDS, [waiting.id], [inside.id]]) {
      const label = `{ ${via}: { parcelId: ${shown(id)} } }`;
      notFoundText(s, app.storeParcel, { [via]: { parcelId: id, locker: "5" } }, `store ${label}`);
      notFoundText(s, app.collectParcel, { [via]: { parcelId: id } }, `collect ${label}`);
      notFoundText(s, app.returnToDesk, { [via]: { parcelId: id } }, `return ${label}`);
    }
    assert.equal(undoCount(s), 3);
    return `${NON_TEXT_IDS.length + 2} non-text ids on store, collect, return; text payload`;
  });

core("core a non-text parcelId passed as { input } reports NotFound with a text id", () =>
  nonTextIdsReportText("input"),
);

core("core a non-text parcelId passed as { rawInput } reports NotFound with a text id", () =>
  nonTextIdsReportText("rawInput"),
);

core("core a recipient with 3 uncollected parcels reports TooManyParcels, trimmed", () =>
  inScope((s) => {
    const first = receive(s, "Ann", "S");
    receive(s, "Ann", "M");
    receive(s, " Ann ", "L");
    store(s, first.id, "1");
    failsWith(s, app.receiveParcel, { recipient: " Ann ", size: "S" }, "TooManyParcels", {
      recipient: "Ann",
    });
    assert.equal(receive(s, "ann", "S").recipient, "ann");
    assert.equal(receive(s, "Bob", "S").recipient, "Bob");
    assert.equal(undoCount(s), 6);
    return "held and stored count; ann and Bob are other recipients";
  }),
);

core("core collected parcels do not count toward TooManyParcels", () =>
  inScope((s) => {
    const first = receive(s, "Ann", "S");
    receive(s, "Ann", "M");
    receive(s, "Ann", "L");
    store(s, first.id, "2");
    collect(s, first.id);
    const fourth = receive(s, " Ann ", "S");
    assert.deepStrictEqual(plain(fourth), {
      id: fourth.id,
      recipient: "Ann",
      size: "S",
      locker: null,
      state: "held",
    });
    failsWith(s, app.receiveParcel, { recipient: "Ann", size: "M" }, "TooManyParcels", {
      recipient: "Ann",
    });
    return "a collected parcel frees a place; 3 uncollected again fails";
  }),
);

core("core storeParcel stores a held parcel in a locker with one undo step", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "M");
    const b = receive(s, "Bob", "S");
    const before = snap(s);
    assert.deepStrictEqual(plain(store(s, a.id, " 4 ")), stored(a, 4));
    assert.deepStrictEqual(snap(s), [stored(a, 4), plain(b)]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 2);
    return "trimmed locker text, stored in place, saved parcel returned";
  }),
);

core(
  "core storing a parcel in the locker it is already in passes with no change or undo step",
  () =>
    inScope((s) => {
      const a = receive(s, "Ann", "L");
      store(s, a.id, "5");
      const before = snap(s);
      assert.deepStrictEqual(plain(store(s, a.id, "5")), stored(a, 5));
      assert.deepStrictEqual(plain(store(s, a.id, " 5 ")), stored(a, 5));
      assert.deepStrictEqual(snap(s), before);
      assert.equal(undoCount(s), 2);
      return "saved parcel returned, no step";
    }),
);

core("core storing a stored parcel in another locker reports AlreadyStored with its locker", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "S");
    store(s, a.id, "1");
    failsWith(s, app.storeParcel, { parcelId: a.id, locker: "2" }, "AlreadyStored", {
      id: a.id,
      locker: 1,
    });
    failsWith(s, app.storeParcel, { parcelId: a.id, locker: "6" }, "AlreadyStored", {
      id: a.id,
      locker: 1,
    });
    assert.equal(undoCount(s), 2);
    return "id and current locker, no step";
  }),
);

core("core storing a collected parcel reports Collected", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "S");
    store(s, a.id, "1");
    collect(s, a.id);
    failsWith(s, app.storeParcel, { parcelId: a.id, locker: "1" }, "Collected", { id: a.id });
    failsWith(s, app.storeParcel, { parcelId: a.id, locker: "2" }, "Collected", { id: a.id });
    assert.equal(undoCount(s), 3);
    return "its old locker and another both refused";
  }),
);

core("core a locker that holds another parcel reports LockerBusy", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "L");
    const b = receive(s, "Bob", "L");
    const c = receive(s, "Cy", "S");
    store(s, a.id, "5");
    store(s, c.id, "6");
    failsWith(s, app.storeParcel, { parcelId: b.id, locker: "5" }, "LockerBusy", { locker: 5 });
    failsWith(s, app.storeParcel, { parcelId: b.id, locker: " 6 " }, "LockerBusy", {
      locker: 6,
    });
    collect(s, a.id);
    assert.deepStrictEqual(plain(store(s, b.id, "5")), stored(b, 5));
    giveBack(s, c.id);
    const d = receive(s, "Dee", "L");
    assert.deepStrictEqual(plain(store(s, d.id, "6")), stored(d, 6));
    return "busy refused; collect and return free the locker";
  }),
);

// Fit is by size order: S fits every locker, M fits M and L, L fits L only.
const FITS = { S: [1, 2, 3, 4, 5, 6], M: [3, 4, 5, 6], L: [5, 6] };

core("core a locker smaller than the parcel reports TooSmall with the locker and size", () =>
  inScope((s) => {
    for (const size of ["S", "M", "L"]) {
      const p = receive(s, `Size ${size}`, size);
      for (const { number } of LOCKER_LIST) {
        if (FITS[size].includes(number)) {
          assert.deepStrictEqual(plain(store(s, p.id, String(number))), stored(p, number));
          giveBack(s, p.id);
        } else {
          failsWith(s, app.storeParcel, { parcelId: p.id, locker: String(number) }, "TooSmall", {
            locker: number,
            size,
          });
        }
      }
    }
    return "S in 1-6; M in 3-6; L in 5-6; the rest TooSmall";
  }),
);

core("core collectParcel collects a stored parcel with no locker and one undo step", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "M");
    const b = receive(s, "Bob", "S");
    store(s, a.id, "3");
    const before = snap(s);
    assert.deepStrictEqual(plain(collect(s, a.id)), collected(a));
    assert.deepStrictEqual(snap(s), [collected(a), plain(b)]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "collected in place, locker null, saved parcel returned";
  }),
);

core("core collecting a collected parcel passes with no change or undo step", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "S");
    store(s, a.id, "2");
    collect(s, a.id);
    const before = snap(s);
    assert.deepStrictEqual(plain(collect(s, a.id)), collected(a));
    assert.deepStrictEqual(plain(collect(s, a.id)), collected(a));
    assert.deepStrictEqual(snap(s), before);
    assert.equal(undoCount(s), 3);
    return "saved parcel returned, no step";
  }),
);

core("core collecting a held parcel reports NotStored", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "S");
    failsWith(s, app.collectParcel, { parcelId: a.id }, "NotStored", { id: a.id });
    const b = receive(s, "Bob", "S");
    store(s, b.id, "1");
    giveBack(s, b.id);
    failsWith(s, app.collectParcel, { parcelId: b.id }, "NotStored", { id: b.id });
    assert.equal(undoCount(s), 4);
    return "new and returned held parcels refused";
  }),
);

core("core returnToDesk moves a stored parcel back to held with no locker and one undo step", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "M");
    const b = receive(s, "Bob", "S");
    store(s, a.id, "4");
    const before = snap(s);
    assert.deepStrictEqual(plain(giveBack(s, a.id)), held(a));
    assert.deepStrictEqual(snap(s), [held(a), plain(b)]);
    undo(s);
    assert.deepStrictEqual(snap(s), before);
    giveBack(s, a.id);
    assert.deepStrictEqual(plain(store(s, a.id, "3")), stored(a, 3));
    assert.equal(undoCount(s), 5);
    return "held in place, locker null; it can be stored again";
  }),
);

core("core returning a held parcel passes with no change or undo step", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "S");
    const before = snap(s);
    assert.deepStrictEqual(plain(giveBack(s, a.id)), held(a));
    store(s, a.id, "1");
    giveBack(s, a.id);
    const after = snap(s);
    assert.deepStrictEqual(plain(giveBack(s, a.id)), held(a));
    assert.deepStrictEqual(snap(s), after);
    assert.deepStrictEqual(after, before);
    assert.equal(undoCount(s), 3);
    return "saved parcel returned, no step";
  }),
);

core("core returning a collected parcel reports Collected", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "S");
    store(s, a.id, "1");
    collect(s, a.id);
    failsWith(s, app.returnToDesk, { parcelId: a.id }, "Collected", { id: a.id });
    assert.equal(undoCount(s), 3);
    return "collected parcel refused, no step";
  }),
);

core("core failed actions leave parcels and undo unchanged", () =>
  inScope((s) => {
    const desk = receive(s, "Ann", "S");
    const inside = receive(s, "Bob", "M");
    const gone = receive(s, "Cy", "S");
    store(s, inside.id, "3");
    store(s, gone.id, "1");
    collect(s, gone.id);
    receive(s, "Dee", "S");
    receive(s, "Dee", "M");
    const large = receive(s, "Dee", "L");
    const tries = [
      [app.receiveParcel, { recipient: " ", size: "S" }, "BlankRecipient"],
      [app.receiveParcel, { recipient: "Eve", size: "XL" }, "BadSize"],
      [app.receiveParcel, { recipient: "Dee", size: "S" }, "TooManyParcels"],
      [app.storeParcel, { parcelId: desk.id, locker: "0" }, "BadLocker"],
      [app.storeParcel, { parcelId: "missing-parcel", locker: "2" }, "NotFound"],
      [app.storeParcel, { parcelId: inside.id, locker: "4" }, "AlreadyStored"],
      [app.storeParcel, { parcelId: gone.id, locker: "2" }, "Collected"],
      [app.storeParcel, { parcelId: desk.id, locker: "3" }, "LockerBusy"],
      [app.storeParcel, { parcelId: large.id, locker: "2" }, "TooSmall"],
      [app.collectParcel, { parcelId: desk.id }, "NotStored"],
      [app.collectParcel, { parcelId: "missing-parcel" }, "NotFound"],
      [app.returnToDesk, { parcelId: gone.id }, "Collected"],
    ];
    for (const [op, input, kind] of tries) {
      const before = snap(s);
      const error = caught(() => s.run(op, { input }));
      assert.equal(error?.kind, kind, `want ${kind} for ${shown(input)}`);
      assert.deepStrictEqual(snap(s), before, `${kind} changed parcels`);
    }
    assert.equal(undoCount(s), 9);
    assert.deepStrictEqual(snap(s), []);
    return `${tries.length} failures, no write, no step`;
  }),
);

core("core undo restores the exact parcels in order", () =>
  inScope((s) => {
    const steps = [snap(s)];
    const a = receive(s, "Ann", "S");
    steps.push(snap(s));
    const b = receive(s, "Bob", "L");
    steps.push(snap(s));
    store(s, a.id, "1");
    steps.push(snap(s));
    store(s, b.id, "5");
    steps.push(snap(s));
    receive(s, "Cy", "M");
    steps.push(snap(s));
    collect(s, a.id);
    steps.push(snap(s));
    giveBack(s, b.id);
    for (const want of steps.reverse()) {
      assert.equal(undo(s), undefined);
      assert.deepStrictEqual(snap(s), want);
    }
    assert.equal(caught(() => undo(s))?.kind, "EmptyUndo");
    return "seven steps back, exact parcels";
  }),
);

core("core ids stay unique and are never reused after undo", () =>
  inScope((s) => {
    const a = receive(s, "Ann", "S");
    const b = receive(s, "Bob", "S");
    undo(s);
    undo(s);
    const seen = new Set([a.id, b.id]);
    const c = receive(s, "Ann", "S");
    const d = receive(s, "Bob", "S");
    for (const id of [c.id, d.id]) assert.ok(!seen.has(id), `id ${id} reused`);
    assert.notEqual(c.id, d.id);
    return "fresh ids after undo";
  }),
);

core("core two scopes share nothing", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    const p = receive(a, "Ann", "S");
    store(a, p.id, "1");
    assert.deepStrictEqual(snap(b), []);
    assert.equal(caught(() => undo(b))?.kind, "EmptyUndo");
    const q = receive(b, "Zed", "S");
    store(b, q.id, "1");
    assert.deepStrictEqual(snap(a), [stored(p, 1)]);
    assert.deepStrictEqual(snap(b), [stored(q, 1)]);
    return "separate parcels, lockers, and history";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core thrown errors narrow through isError", () =>
  inScope((s) => {
    const p = receive(s, "Ann", "S");
    const bad = caught(() => store(s, p.id, "abc"));
    assert.ok(app.isError(bad, "BadLocker"), "want BadLocker");
    assert.ok(!app.isError(bad, "NotFound"), "BadLocker is not NotFound");
    assert.deepStrictEqual(bad.payload, { locker: "abc" });
    const gone = caught(() => collect(s, "missing-parcel"));
    assert.ok(app.isError(gone, "NotFound"), "want NotFound");
    undo(s);
    const empty = caught(() => undo(s));
    assert.ok(app.isError(empty, "EmptyUndo"), "want EmptyUndo");
    return "BadLocker, NotFound, EmptyUndo";
  }),
);

// ---- browser checks: real Chromium, fresh mounts ----
const URL_ROOT = "http://127.0.0.1:5173";
const browserTests = [];
const browser = (name, fn) => browserTests.push([name, fn]);

const textbox = (scope, name) => scope.getByRole("textbox", { name, exact: true });
const recipientBox = (scope) => textbox(scope, "Recipient");
const sizeBox = (scope) => textbox(scope, "Size");
const lockerBox = (scope) => textbox(scope, "Locker");
const parcelBox = (scope) => scope.getByRole("combobox", { name: "Parcel", exact: true });
const parcelsTable = (scope) => scope.getByRole("table", { name: "Parcels", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const collectButton = (scope, who, locker) => button(scope, `Collect ${who} from locker ${locker}`);
const returnButton = (scope, who, locker) => button(scope, `Return ${who} from locker ${locker}`);

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
  // but not where they sit, so a Collect or Return button inside the
  // State cell must not change what the cell says.
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
const COLUMNS = ["Recipient", "Size", "Locker", "State"];
const rowsOf = (scope) => readTable(parcelsTable(scope), COLUMNS);
const whoShown = async (scope) =>
  (await readTable(parcelsTable(scope), ["Recipient", "State"])).map(([who]) => who);
// The row naming one recipient as a whole word; every setup gives each row
// its own recipient.
const rowOf = (scope, who) =>
  parcelsTable(scope)
    .getByRole("row")
    .filter({ hasText: new RegExp(`\\b${who}\\b`) });

const optionsOf = (select) =>
  select
    .locator("option")
    .evaluateAll((all) => all.map((o) => [o.textContent?.trim() ?? "", o.value]));
const labelsOf = async (select) => (await optionsOf(select)).map(([label]) => label);
const chosenLabel = (select) =>
  select.evaluate((el) => el.selectedOptions[0]?.textContent?.trim() ?? "");

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

const receiveVia = async (scope, recipient, size) => {
  await recipientBox(scope).fill(recipient);
  await sizeBox(scope).fill(size);
  await button(scope, "Receive").click();
};
// Distinct recipients only: each held parcel gets its own Parcel option
// label and each stored one its own button names.
const receiveParcels = async (scope, rows) => {
  for (const [who, size] of rows) {
    await receiveVia(scope, who, size);
    await settle(async () => (await labelsOf(parcelBox(scope))).includes(`${who} (${size})`), true);
  }
};
const storeVia = async (scope, label, locker) => {
  await parcelBox(scope).selectOption({ label });
  await lockerBox(scope).fill(locker);
  await button(scope, "Store").click();
};
const storeParcels = async (scope, rows) => {
  for (const [who, size, locker] of rows) {
    await storeVia(scope, `${who} (${size})`, locker);
    await collectButton(scope, who, locker).waitFor();
  }
};
// Receive with a blank recipient: BlankRecipient, without touching the
// store form or the filter.
const raiseBlank = async (scope) => {
  await recipientBox(scope).fill("");
  await sizeBox(scope).fill("S");
  await button(scope, "Receive").click();
  await seeAlert(scope, "BlankRecipient");
};
const open = async (page) => {
  await page.goto(URL_ROOT);
  await parcelsTable(page).waitFor();
};

browser("browser loads empty forms, the Parcels table, the filters, and Undo", async (page) => {
  await open(page);
  for (const box of [recipientBox, sizeBox, lockerBox])
    assert.equal(await box(page).inputValue(), "");
  assert.equal(await parcelBox(page).inputValue(), "");
  assert.deepStrictEqual(await optionsOf(parcelBox(page)), [["Choose parcel", ""]]);
  for (const name of ["Receive", "Store", "Undo", "All", "Held", "Stored", "Collected"])
    await button(page, name).waitFor();
  assert.ok(await button(page, "Undo").isEnabled(), "Undo enabled on empty history");
  assert.deepStrictEqual(await rowsOf(page), []);
  assert.equal(await alertText(page), "");
  return "inputs empty, Choose parcel only, named columns";
});

browser(
  "browser Receive appends a held row, clears both inputs, and lists the parcel in Parcel",
  async (page) => {
    await open(page);
    await receiveVia(page, " Ann ", " M ");
    await settle(() => rowsOf(page), [["Ann", "M", "None", "Held"]]);
    assert.equal(await recipientBox(page).inputValue(), "");
    assert.equal(await sizeBox(page).inputValue(), "");
    await receiveVia(page, "Bob", "S");
    await settle(
      () => rowsOf(page),
      [
        ["Ann", "M", "None", "Held"],
        ["Bob", "S", "None", "Held"],
      ],
    );
    const options = await optionsOf(parcelBox(page));
    assert.deepStrictEqual(
      options.map(([label]) => label),
      ["Choose parcel", "Ann (M)", "Bob (S)"],
    );
    const values = options.slice(1).map(([, value]) => value);
    assert.ok(
      values.every((value) => value !== ""),
      "each parcel option has its id",
    );
    assert.equal(new Set(values).size, 2, "distinct option values");
    assert.equal(await alertText(page), "");
    return "trimmed, Locker None, State Held; options <recipient> (<size>) in order";
  },
);

browser("browser bad receive input keeps both fields and shows the kind", async (page) => {
  await open(page);
  await receiveVia(page, "", "S");
  await seeAlert(page, "BlankRecipient");
  assert.equal(await recipientBox(page).inputValue(), "");
  assert.equal(await sizeBox(page).inputValue(), "S");
  await receiveVia(page, "Ann", "s");
  await seeAlert(page, "BadSize");
  assert.equal(await recipientBox(page).inputValue(), "Ann");
  assert.equal(await sizeBox(page).inputValue(), "s");
  await receiveParcels(page, [
    ["Ann", "S"],
    ["Ann", "M"],
    ["Ann", "L"],
  ]);
  await receiveVia(page, "Ann", "M");
  await seeAlert(page, "TooManyParcels");
  assert.equal(await recipientBox(page).inputValue(), "Ann");
  assert.equal(await sizeBox(page).inputValue(), "M");
  assert.equal((await rowsOf(page)).length, 3);
  return "BlankRecipient, BadSize, TooManyParcels; text kept";
});

browser(
  "browser Store stores the chosen parcel, empties Parcel, clears Locker, and drops the option",
  async (page) => {
    await open(page);
    await receiveParcels(page, [
      ["Ann", "M"],
      ["Bob", "S"],
    ]);
    await storeVia(page, "Ann (M)", " 4 ");
    await settle(
      () => rowsOf(page),
      [
        ["Ann", "M", "4", "Stored"],
        ["Bob", "S", "None", "Held"],
      ],
    );
    assert.equal(await parcelBox(page).inputValue(), "");
    assert.equal(await lockerBox(page).inputValue(), "");
    assert.deepStrictEqual(await labelsOf(parcelBox(page)), ["Choose parcel", "Bob (S)"]);
    assert.equal(await alertText(page), "");
    return "Stored in 4; Parcel empty, Locker cleared, only held options";
  },
);

browser("browser a failed store keeps Parcel and Locker and shows the kind", async (page) => {
  await open(page);
  await receiveParcels(page, [
    ["Ann", "L"],
    ["Bob", "S"],
  ]);
  await storeParcels(page, [["Bob", "S", "5"]]);
  const tries = [
    ["abc", "BadLocker"],
    ["5", "LockerBusy"],
    ["3", "TooSmall"],
    ["", "BadLocker"],
  ];
  await parcelBox(page).selectOption({ label: "Ann (L)" });
  const annId = await parcelBox(page).inputValue();
  for (const [locker, kind] of tries) {
    await lockerBox(page).fill(locker);
    await button(page, "Store").click();
    await seeAlert(page, kind);
    assert.equal(await parcelBox(page).inputValue(), annId, `${kind} kept Parcel`);
    assert.equal(await lockerBox(page).inputValue(), locker, `${kind} kept Locker`);
  }
  await parcelBox(page).selectOption("");
  await lockerBox(page).fill("6");
  await button(page, "Store").click();
  await seeAlert(page, "NotFound");
  assert.equal(await lockerBox(page).inputValue(), "6");
  assert.deepStrictEqual(await rowsOf(page), [
    ["Ann", "L", "None", "Held"],
    ["Bob", "S", "5", "Stored"],
  ]);
  return "BadLocker, LockerBusy, TooSmall, blank BadLocker, no parcel NotFound; both kept";
});

browser(
  "browser stored rows have Collect and Return buttons; held and collected rows have none",
  async (page) => {
    await open(page);
    await receiveParcels(page, [
      ["Ann", "S"],
      ["Bob", "M"],
      ["Cy", "L"],
    ]);
    await storeParcels(page, [
      ["Ann", "S", "1"],
      ["Cy", "L", "6"],
    ]);
    await returnButton(page, "Ann", "1").waitFor();
    assert.equal(await rowOf(page, "Bob").getByRole("button").count(), 0, "held row buttons");
    await collectButton(page, "Ann", "1").click();
    await settle(() => rowsOf(page).then((rows) => rows[0]), ["Ann", "S", "None", "Collected"]);
    assert.equal(await collectButton(page, "Ann", "1").count(), 0);
    assert.equal(await returnButton(page, "Ann", "1").count(), 0);
    assert.equal(await rowOf(page, "Ann").getByRole("button").count(), 0, "collected row");
    await returnButton(page, "Cy", "6").click();
    await settle(() => rowsOf(page).then((rows) => rows[2]), ["Cy", "L", "None", "Held"]);
    assert.equal(await rowOf(page, "Cy").getByRole("button").count(), 0, "returned row");
    assert.deepStrictEqual(await labelsOf(parcelBox(page)), ["Choose parcel", "Bob (M)", "Cy (L)"]);
    assert.equal(await alertText(page), "");
    return "Stored: Collect and Return; Held and Collected: none; Return lists it again";
  },
);

browser("browser filters show only parcels in that state and update live", async (page) => {
  await open(page);
  await receiveParcels(page, [
    ["Ann", "S"],
    ["Bob", "S"],
    ["Cy", "M"],
    ["Dee", "S"],
  ]);
  await storeParcels(page, [
    ["Bob", "S", "1"],
    ["Cy", "M", "3"],
    ["Dee", "S", "2"],
  ]);
  await collectButton(page, "Cy", "3").click();
  await settle(
    () => rowsOf(page),
    [
      ["Ann", "S", "None", "Held"],
      ["Bob", "S", "1", "Stored"],
      ["Cy", "M", "None", "Collected"],
      ["Dee", "S", "2", "Stored"],
    ],
  );
  await button(page, "Held").click();
  await settle(() => whoShown(page), ["Ann"]);
  await button(page, "Stored").click();
  await settle(() => whoShown(page), ["Bob", "Dee"]);
  await button(page, "Collected").click();
  await settle(() => whoShown(page), ["Cy"]);
  await button(page, "Stored").click();
  await settle(() => whoShown(page), ["Bob", "Dee"]);
  await returnButton(page, "Bob", "1").click();
  await settle(() => whoShown(page), ["Dee"]);
  assert.deepStrictEqual(await labelsOf(parcelBox(page)), ["Choose parcel", "Ann (S)", "Bob (S)"]);
  await button(page, "Held").click();
  await settle(() => whoShown(page), ["Ann", "Bob"]);
  await button(page, "All").click();
  await settle(() => whoShown(page), ["Ann", "Bob", "Cy", "Dee"]);
  return "Held, Stored, Collected only their state; rows and options move without another click";
});

browser("browser typing clears an earlier alert", async (page) => {
  await open(page);
  await raiseBlank(page);
  await lockerBox(page).fill("4");
  await noAlert(page);
  await button(page, "Receive").click();
  await seeAlert(page, "BlankRecipient");
  await sizeBox(page).fill("M");
  await noAlert(page);
  await button(page, "Receive").click();
  await seeAlert(page, "BlankRecipient");
  await recipientBox(page).fill("Ann");
  await noAlert(page);
  return "Locker, Size, and Recipient typing clear";
});

browser("browser choosing a parcel clears an earlier alert", async (page) => {
  await open(page);
  await receiveParcels(page, [["Ann", "S"]]);
  await lockerBox(page).fill("abc");
  await raiseBlank(page);
  await parcelBox(page).selectOption({ label: "Ann (S)" });
  await noAlert(page);
  assert.equal(await lockerBox(page).inputValue(), "abc");
  return "Parcel select clears";
});

browser("browser filtering clears an earlier alert", async (page) => {
  await open(page);
  await raiseBlank(page);
  await button(page, "Stored").click();
  await noAlert(page);
  await button(page, "Receive").click();
  await seeAlert(page, "BlankRecipient");
  await button(page, "All").click();
  await noAlert(page);
  return "Stored and All clear";
});

browser(
  "browser a passing no-op store clears an earlier alert and adds no undo step",
  async (page) => {
    await open(page);
    await receiveParcels(page, [["Ann", "S"]]);
    await storeParcels(page, [["Ann", "S", "2"]]);
    await returnButton(page, "Ann", "2").click();
    await parcelBox(page).selectOption({ label: "Ann (S)" });
    await button(page, "Undo").click();
    await settle(() => rowsOf(page), [["Ann", "S", "2", "Stored"]]);
    await lockerBox(page).fill("2");
    await raiseBlank(page);
    await button(page, "Store").click();
    await noAlert(page);
    assert.deepStrictEqual(await rowsOf(page), [["Ann", "S", "2", "Stored"]]);
    await settle(() => parcelBox(page).inputValue(), "");
    assert.equal(await lockerBox(page).inputValue(), "");
    await button(page, "Undo").click();
    await settle(() => rowsOf(page), [["Ann", "S", "None", "Held"]]);
    return "same locker passes, clears the alert and the form; undo skips it";
  },
);

browser(
  "browser undo that un-holds the chosen parcel shows Unavailable parcel; Store reports its error",
  async (page) => {
    await open(page);
    await receiveParcels(page, [["Ann", "M"]]);
    await storeParcels(page, [["Ann", "M", "3"]]);
    await returnButton(page, "Ann", "3").click();
    await parcelBox(page).selectOption({ label: "Ann (M)" });
    const annId = await parcelBox(page).inputValue();
    await lockerBox(page).fill("5");
    await button(page, "Undo").click();
    await settle(() => rowsOf(page), [["Ann", "M", "3", "Stored"]]);
    assert.equal(await parcelBox(page).inputValue(), annId, "stored parcel stays chosen");
    assert.equal(await chosenLabel(parcelBox(page)), "Unavailable parcel");
    assert.deepStrictEqual(await labelsOf(parcelBox(page)), [
      "Choose parcel",
      "Unavailable parcel",
    ]);
    await button(page, "Store").click();
    await seeAlert(page, "AlreadyStored");
    assert.equal(await parcelBox(page).inputValue(), annId);
    assert.equal(await lockerBox(page).inputValue(), "5");
    await receiveParcels(page, [["Bob", "S"]]);
    await parcelBox(page).selectOption({ label: "Bob (S)" });
    await settle(() => labelsOf(parcelBox(page)), ["Choose parcel", "Bob (S)"]);
    await button(page, "Undo").click();
    await settle(() => chosenLabel(parcelBox(page)), "Unavailable parcel");
    await lockerBox(page).fill("1");
    await button(page, "Store").click();
    await seeAlert(page, "NotFound");
    return "stored again by undo: AlreadyStored; removed by undo: NotFound";
  },
);

browser(
  "browser undo restores records and keeps form text, the chosen parcel, and the filter",
  async (page) => {
    await open(page);
    await receiveParcels(page, [
      ["Ann", "S"],
      ["Bob", "M"],
    ]);
    await storeParcels(page, [["Bob", "M", "4"]]);
    await receiveParcels(page, [["Cy", "L"]]);
    await button(page, "Held").click();
    await settle(() => whoShown(page), ["Ann", "Cy"]);
    await parcelBox(page).selectOption({ label: "Ann (S)" });
    const annId = await parcelBox(page).inputValue();
    await lockerBox(page).fill("6");
    await recipientBox(page).fill("Dee");
    await sizeBox(page).fill("L");
    await button(page, "Undo").click();
    await settle(() => whoShown(page), ["Ann"]);
    await button(page, "Undo").click();
    await settle(() => whoShown(page), ["Ann", "Bob"]);
    assert.equal(await recipientBox(page).inputValue(), "Dee");
    assert.equal(await sizeBox(page).inputValue(), "L");
    assert.equal(await parcelBox(page).inputValue(), annId);
    assert.equal(await lockerBox(page).inputValue(), "6");
    await button(page, "All").click();
    await settle(
      () => rowsOf(page),
      [
        ["Ann", "S", "None", "Held"],
        ["Bob", "M", "None", "Held"],
      ],
    );
    return "receive and store undone; text, Ann, Locker, and Held filter kept";
  },
);

browser("browser undo on empty history shows EmptyUndo", async (page) => {
  await open(page);
  await button(page, "Undo").click();
  await seeAlert(page, "EmptyUndo");
  await receiveVia(page, "Ann", "S");
  await noAlert(page);
  await settle(() => whoShown(page), ["Ann"]);
  return "EmptyUndo shown, next receive clears it";
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
  if (!appMod?.LockerApp) throw new Error("cannot import submission entry");
  const jsx = await resolveJsx(paths);
  const createRoot = await loadCreateRoot(pickClientPath(paths));
  const holder = document.createElement("div");
  holder.id = "teacher-second-root";
  document.body.appendChild(holder);
  createRoot(holder).render(jsx(appMod.LockerApp));
};

// First root: a stored parcel hidden by the Held filter, a chosen held
// parcel, and typed text in both forms. The second root changes everything
// of its own; the first must not move.
const seedFirstRoot = async (first) => {
  await receiveParcels(first, [
    ["Ann", "S"],
    ["Bob", "M"],
  ]);
  await storeParcels(first, [["Ann", "S", "1"]]);
  await button(first, "Held").click();
  await parcelBox(first).selectOption({ label: "Bob (M)" });
  await lockerBox(first).fill("3");
  await recipientBox(first).fill("Cy");
  await sizeBox(first).fill("L");
  await settle(() => whoShown(first), ["Bob"]);
  return parcelBox(first).inputValue();
};
const changeSecondRoot = async (second) => {
  assert.deepStrictEqual(await rowsOf(second), []);
  assert.equal(await recipientBox(second).inputValue(), "");
  assert.equal(await parcelBox(second).inputValue(), "");
  assert.equal(await lockerBox(second).inputValue(), "");
  await receiveParcels(second, [["Zed", "L"]]);
  await storeParcels(second, [["Zed", "L", "5"]]);
  await button(second, "Stored").click();
  await raiseBlank(second);
};
const firstUnmoved = async (first, bobId) => {
  await settle(() => whoShown(first), ["Bob"]);
  assert.equal(await recipientBox(first).inputValue(), "Cy");
  assert.equal(await sizeBox(first).inputValue(), "L");
  assert.equal(await parcelBox(first).inputValue(), bobId);
  assert.equal(await lockerBox(first).inputValue(), "3");
  assert.equal(await alertText(first), "");
};

browser("browser two LockerApps share nothing", async (page) => {
  try {
    await open(page);
    const first = page.locator("#root");
    const bobId = await seedFirstRoot(first);
    await page.evaluate(mountSecondRoot);
    const second = page.locator("#teacher-second-root");
    await parcelsTable(second).waitFor();
    await changeSecondRoot(second);
    await firstUnmoved(first, bobId);
    await button(first, "All").click();
    await settle(
      () => rowsOf(first),
      [
        ["Ann", "S", "1", "Stored"],
        ["Bob", "M", "None", "Held"],
      ],
    );
    await button(first, "Undo").click();
    await settle(
      () => rowsOf(first),
      [
        ["Ann", "S", "None", "Held"],
        ["Bob", "M", "None", "Held"],
      ],
    );
    await seeAlert(second, "BlankRecipient");
    await settle(() => rowsOf(second), [["Zed", "L", "5", "Stored"]]);
    return "records, lockers, text, chosen parcel, filter, notice, and undo separate";
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
  cacheDir: "/tmp/teacher-locker-browser",
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
