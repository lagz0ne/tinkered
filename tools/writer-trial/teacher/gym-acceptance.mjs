import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance for the gym class waitlist task. Runs only inside
// the disposable container: submitted code is imported here, never on the
// host. Every case comes from the frozen task text. Case-level results; any
// error or missing check fails its case, never passes. Later cases still run.
// Browser cases find things by role and accessible name only, and read table
// cells by their column header, so a different DOM layout still passes.
const root = process.argv[2];
assert.ok(root, "usage: gym-acceptance.mjs <submission-dir>");

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
  console.log(`ACCEPTANCE gym: ${results.length - failed.length}/${results.length} pass`);
  console.log(`RESULTS_JSON ${JSON.stringify({ cases: results, advisory })}`);
  process.exitCode = failed.length ? 1 : 0;
};

// ---- core checks: public entry, createScope, scope.run, scope.resolve ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-gym-core",
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
  "GymApp",
  "addClass",
  "classes",
  "isError",
  "joinClass",
  "leaveClass",
  "setCapacity",
  "signups",
  "undoGym",
].sort();
const need = (value, label) => {
  assert.ok(value, `missing export: ${label}`);
  return value;
};
// Plain clones: a broken in-place write must not pass by comparing a
// record against its own mutated alias.
const plain = (record) => ({ ...record });
const snap = (s) => ({
  classes: s.resolve(need(app.classes, "classes")).map(plain),
  signups: s.resolve(need(app.signups, "signups")).map(plain),
});
const gymClass = (id, name, capacity) => ({ id, name, capacity });
const booked = (classId, member) => ({ classId, member, status: "booked" });
const waiting = (classId, member) => ({ classId, member, status: "waiting" });
const add = (s, name, capacity) => s.run(app.addClass, { input: { name, capacity } });
const setCap = (s, classId, capacity) => s.run(app.setCapacity, { input: { classId, capacity } });
const join = (s, classId, member) => s.run(app.joinClass, { input: { classId, member } });
const leave = (s, classId, member) => s.run(app.leaveClass, { input: { classId, member } });
const undo = (s) => s.run(app.undoGym, {});
// Several joins in order: [["K1", "Ann"], ["K2", "Bob"]].
const joinAll = (s, pairs) => {
  for (const [classId, member] of pairs) join(s, classId, member);
};
const shown = (value) => (value === undefined ? "undefined" : JSON.stringify(value));
const caught = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail("want a thrown managed error");
};
// One failing call: one of the allowed [kind, payload] pairs, and classes
// and signups left exactly as they were.
const failsWithAny = (s, op, call, allowed) => {
  const before = snap(s);
  const error = caught(() => s.run(op, call));
  const kinds = allowed.map(([kind]) => kind);
  const at = kinds.indexOf(error?.kind);
  assert.ok(
    at >= 0,
    `want ${kinds.join(" or ")} for ${shown(call)}, got ${error?.kind ?? error?.message}`,
  );
  if (allowed[at][1] !== undefined) assert.deepStrictEqual(error.payload, allowed[at][1]);
  assert.deepStrictEqual(snap(s), before, `${error.kind} changed records`);
  return error;
};
const failsWith = (s, op, input, kind, payload) =>
  failsWithAny(s, op, { input }, [[kind, payload]]);
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

core("core each scope starts with no classes, no signups, and EmptyUndo {}", () =>
  inScope((s) => {
    assert.deepStrictEqual(snap(s), { classes: [], signups: [] });
    const error = caught(() => undo(s));
    assert.equal(error?.kind, "EmptyUndo");
    assert.deepStrictEqual(error.payload, {});
    return "empty lists; EmptyUndo {}";
  }),
);

core(
  "core addClass adds at the end with the trimmed name, a number capacity, and id K<count>, one undo step each",
  () =>
    inScope((s) => {
      assert.deepStrictEqual(plain(add(s, "  Yoga ", " 7 ")), gymClass("K1", "Yoga", 7));
      assert.deepStrictEqual(plain(add(s, "Spin", "20")), gymClass("K2", "Spin", 20));
      assert.deepStrictEqual(plain(add(s, "Box Fit", "1")), gymClass("K3", "Box Fit", 1));
      assert.deepStrictEqual(snap(s), {
        classes: [
          gymClass("K1", "Yoga", 7),
          gymClass("K2", "Spin", 20),
          gymClass("K3", "Box Fit", 1),
        ],
        signups: [],
      });
      assert.equal(undoCount(s), 3);
      return "K1 Yoga 7, K2 Spin 20, K3 Box Fit 1; saved class returned";
    }),
);

const BAD_NAMES = ["", "   ", 3, null, undefined, true, ["Yoga"], {}];

core("core blank or non-text name reports BadName with the original value", () =>
  inScope((s) => {
    add(s, "Yoga", "5");
    for (const name of BAD_NAMES)
      failsWith(s, app.addClass, { name, capacity: "5" }, "BadName", { name });
    assert.equal(undoCount(s), 1, "no undo step");
    return `${BAD_NAMES.length} values: blank and non-text`;
  }),
);

core(
  "core another class with the same trimmed name reports DuplicateName with the trimmed name",
  () =>
    inScope((s) => {
      add(s, "Yoga", "5");
      failsWith(s, app.addClass, { name: " Yoga  ", capacity: "3" }, "DuplicateName", {
        name: "Yoga",
      });
      failsWith(s, app.addClass, { name: "Yoga", capacity: "5" }, "DuplicateName", {
        name: "Yoga",
      });
      add(s, "Spin", "5");
      failsWith(s, app.addClass, { name: "Spin ", capacity: "2" }, "DuplicateName", {
        name: "Spin",
      });
      assert.equal(undoCount(s), 2, "no undo step");
      return "trimmed duplicates refused";
    }),
);

const BAD_CAPACITIES = [
  "",
  "   ",
  "0",
  "00",
  "21",
  "100",
  "05",
  "020",
  "+3",
  "-1",
  "3.0",
  "2.5",
  "1 2",
  "abc",
  "1e1",
  "3x",
  "0x5",
  5,
  null,
  undefined,
  true,
  ["5"],
];

core(
  "core bad capacity text reports BadCapacity with the original value on addClass and setCapacity",
  () =>
    inScope((s) => {
      add(s, "Yoga", "5");
      for (const capacity of BAD_CAPACITIES) {
        failsWith(s, app.addClass, { name: "Spin", capacity }, "BadCapacity", { capacity });
        failsWith(s, app.setCapacity, { classId: "K1", capacity }, "BadCapacity", { capacity });
      }
      assert.equal(undoCount(s), 1, "no undo step");
      return `${BAD_CAPACITIES.length} values: blank, 0, 21, leading zero, sign, decimal, space, letters, non-text`;
    }),
);

const BAD_MEMBERS = ["", "   ", 3, null, undefined, true, ["Ann"]];

core("core blank or non-text member reports BlankMember with the original value", () =>
  inScope((s) => {
    add(s, "Yoga", "5");
    join(s, "K1", "Ann");
    for (const member of BAD_MEMBERS) {
      failsWith(s, app.joinClass, { classId: "K1", member }, "BlankMember", { member });
      failsWith(s, app.leaveClass, { classId: "K1", member }, "BlankMember", { member });
    }
    assert.equal(undoCount(s), 2, "no undo step");
    return `${BAD_MEMBERS.length} values on join and leave`;
  }),
);

// Ids are not trimmed or parsed: only an exact saved id names a class.
const UNKNOWN_IDS = ["K2", "K0", "k1", "", "K01", "1", "Yoga"];

core("core unknown class ids report NotFound with that id", () =>
  inScope((s) => {
    add(s, "Yoga", "5");
    join(s, "K1", "Ann");
    for (const id of UNKNOWN_IDS) {
      failsWith(s, app.setCapacity, { classId: id, capacity: "3" }, "NotFound", { id });
      failsWith(s, app.joinClass, { classId: id, member: "Bob" }, "NotFound", { id });
      // Leave on an unknown class also has the member not in it: either rule may report.
      failsWithAny(s, app.leaveClass, { input: { classId: id, member: "Ann" } }, [
        ["NotFound", { id }],
        ["NotJoined", { classId: id, member: "Ann" }],
      ]);
    }
    assert.equal(undoCount(s), 2);
    return `${UNKNOWN_IDS.length} unknown ids on set, join, and leave; exact text payload`;
  }),
);

// The miss earlier trials repeated. NotFound's payload is { id: string }:
// an id that is not text names no class and still reports text. Core hands
// a `{ input }` call to the body unchecked and a `{ rawInput }` call
// through the operation's own reader, so each call style is its own case.
// Which text is not named: only its type is checked.
const NON_TEXT_IDS = [1, 2, null, undefined, true, {}, ["K1"], ["K2"]];
const textPayload = (error, label) => {
  const want = error.kind === "NotFound" ? ["id"] : ["classId", "member"];
  assert.deepStrictEqual(Object.keys(error.payload ?? {}).sort(), want.sort(), label);
  for (const key of want)
    assert.equal(
      typeof error.payload[key],
      "string",
      `${error.kind} ${key} must be text for ${label}; got ${shown(error.payload[key])}`,
    );
};
const nonTextIdsReportText = (via) =>
  inScope((s) => {
    add(s, "Yoga", "1");
    add(s, "Spin", "1");
    joinAll(s, [
      ["K1", "Ann"],
      ["K2", "Ann"],
    ]);
    for (const id of NON_TEXT_IDS) {
      const tries = [
        [app.setCapacity, { classId: id, capacity: "3" }, ["NotFound"]],
        [app.joinClass, { classId: id, member: "Bob" }, ["NotFound"]],
        [app.leaveClass, { classId: id, member: "Ann" }, ["NotFound", "NotJoined"]],
      ];
      for (const [op, fields, kinds] of tries) {
        const label = `{ ${via}: ${shown(fields)} }`;
        const error = failsWithAny(
          s,
          op,
          { [via]: fields },
          kinds.map((kind) => [kind, undefined]),
        );
        textPayload(error, label);
      }
    }
    assert.equal(undoCount(s), 4);
    return `${NON_TEXT_IDS.length} non-text ids on set, join, and leave; text payload`;
  });

core("core a non-text classId passed as { input } reports NotFound with a text id", () =>
  nonTextIdsReportText("input"),
);

core("core a non-text classId passed as { rawInput } reports NotFound with a text id", () =>
  nonTextIdsReportText("rawInput"),
);

core(
  "core joinClass adds the trimmed member at the end, booked while a place is free, then waiting",
  () =>
    inScope((s) => {
      add(s, "Yoga", "2");
      add(s, "Spin", "1");
      assert.deepStrictEqual(plain(join(s, "K1", " Ann ")), booked("K1", "Ann"));
      assert.deepStrictEqual(plain(join(s, "K1", "Bob")), booked("K1", "Bob"));
      assert.deepStrictEqual(plain(join(s, "K1", "Cy")), waiting("K1", "Cy"));
      assert.deepStrictEqual(plain(join(s, "K2", "Ann")), booked("K2", "Ann"));
      assert.deepStrictEqual(plain(join(s, "K1", "ann")), waiting("K1", "ann"));
      assert.deepStrictEqual(plain(join(s, "K2", "Dee")), waiting("K2", "Dee"));
      assert.deepStrictEqual(snap(s).signups, [
        booked("K1", "Ann"),
        booked("K1", "Bob"),
        waiting("K1", "Cy"),
        booked("K2", "Ann"),
        waiting("K1", "ann"),
        waiting("K2", "Dee"),
      ]);
      assert.equal(undoCount(s), 8);
      return "booked, booked, waiting; Ann in two classes; ann is another member; one step each";
    }),
);

core(
  "core joining a class the member is already in passes with no change or undo step and returns the saved signup",
  () =>
    inScope((s) => {
      add(s, "Yoga", "1");
      joinAll(s, [
        ["K1", "Ann"],
        ["K1", "Bob"],
      ]);
      const before = snap(s);
      assert.deepStrictEqual(plain(join(s, "K1", "Ann")), booked("K1", "Ann"));
      assert.deepStrictEqual(plain(join(s, "K1", " Bob ")), waiting("K1", "Bob"));
      assert.deepStrictEqual(snap(s), before);
      assert.equal(undoCount(s), 3);
      return "booked and waiting repeats return the saved signup, no step";
    }),
);

core("core leaveClass removes the signup and returns it as it was, one undo step", () =>
  inScope((s) => {
    add(s, "Yoga", "1");
    add(s, "Spin", "2");
    joinAll(s, [
      ["K1", "Ann"],
      ["K1", "Bob"],
      ["K1", "Cy"],
      ["K2", "Eve"],
      ["K1", "Dee"],
    ]);
    const before = snap(s);
    assert.deepStrictEqual(plain(leave(s, "K1", " Cy ")), waiting("K1", "Cy"));
    assert.deepStrictEqual(snap(s).signups, [
      booked("K1", "Ann"),
      waiting("K1", "Bob"),
      booked("K2", "Eve"),
      waiting("K1", "Dee"),
    ]);
    undo(s);
    assert.deepStrictEqual(snap(s), before, "one undo puts Cy back in place");
    assert.deepStrictEqual(plain(leave(s, "K2", "Eve")), booked("K2", "Eve"));
    assert.deepStrictEqual(snap(s).signups, [
      booked("K1", "Ann"),
      waiting("K1", "Bob"),
      waiting("K1", "Cy"),
      waiting("K1", "Dee"),
    ]);
    assert.equal(undoCount(s), 8);
    return "a waiting leaver and a booked leaver with no one waiting";
  }),
);

core(
  "core when a booked member leaves, the first waiting member in signup order becomes booked in place, as one step",
  () =>
    inScope((s) => {
      add(s, "Yoga", "1");
      add(s, "Spin", "1");
      joinAll(s, [
        ["K1", "Ann"],
        ["K2", "Bob"],
        ["K1", "Cy"],
        ["K2", "Dee"],
        ["K1", "Eve"],
      ]);
      const before = snap(s);
      assert.deepStrictEqual(plain(leave(s, "K1", "Ann")), booked("K1", "Ann"));
      assert.deepStrictEqual(snap(s).signups, [
        booked("K2", "Bob"),
        booked("K1", "Cy"),
        waiting("K2", "Dee"),
        waiting("K1", "Eve"),
      ]);
      undo(s);
      assert.deepStrictEqual(snap(s), before, "one undo restores the leave and the booking");
      assert.equal(undoCount(s), 7);
      return "Cy (first waiting in Yoga) booked where it stood; Eve and Spin untouched";
    }),
);

core(
  "core a member not in the class reports NotJoined with the class id and the trimmed member",
  () =>
    inScope((s) => {
      add(s, "Yoga", "2");
      add(s, "Spin", "2");
      joinAll(s, [
        ["K1", "Ann"],
        ["K2", "Bob"],
      ]);
      failsWith(s, app.leaveClass, { classId: "K1", member: " Bob " }, "NotJoined", {
        classId: "K1",
        member: "Bob",
      });
      failsWith(s, app.leaveClass, { classId: "K1", member: "ann" }, "NotJoined", {
        classId: "K1",
        member: "ann",
      });
      leave(s, "K1", "Ann");
      failsWith(s, app.leaveClass, { classId: "K1", member: "Ann" }, "NotJoined", {
        classId: "K1",
        member: "Ann",
      });
      assert.equal(undoCount(s), 5);
      return "another class's member, ann, and a member who left";
    }),
);

core("core setCapacity changes the capacity and returns the saved class, one undo step", () =>
  inScope((s) => {
    add(s, "Yoga", "5");
    add(s, "Spin", "3");
    joinAll(s, [
      ["K1", "Ann"],
      ["K1", "Bob"],
    ]);
    const signups = snap(s).signups;
    assert.deepStrictEqual(plain(setCap(s, "K1", " 2 ")), gymClass("K1", "Yoga", 2));
    assert.deepStrictEqual(snap(s), {
      classes: [gymClass("K1", "Yoga", 2), gymClass("K2", "Spin", 3)],
      signups,
    });
    assert.deepStrictEqual(plain(setCap(s, "K1", "10")), gymClass("K1", "Yoga", 10));
    undo(s);
    assert.deepStrictEqual(snap(s).classes, [gymClass("K1", "Yoga", 2), gymClass("K2", "Spin", 3)]);
    assert.equal(undoCount(s), 5);
    return "lowered to the booked count, raised; one step each";
  }),
);

core(
  "core a larger capacity books that class's waiting members first come first served, as one step",
  () =>
    inScope((s) => {
      add(s, "Yoga", "1");
      add(s, "Spin", "1");
      joinAll(s, [
        ["K1", "Ann"],
        ["K1", "Bob"],
        ["K2", "Zed"],
        ["K2", "Yan"],
        ["K1", "Cy"],
        ["K1", "Dee"],
      ]);
      const before = snap(s);
      assert.deepStrictEqual(plain(setCap(s, "K1", "3")), gymClass("K1", "Yoga", 3));
      assert.deepStrictEqual(snap(s).signups, [
        booked("K1", "Ann"),
        booked("K1", "Bob"),
        booked("K2", "Zed"),
        waiting("K2", "Yan"),
        booked("K1", "Cy"),
        waiting("K1", "Dee"),
      ]);
      undo(s);
      assert.deepStrictEqual(snap(s), before, "one undo restores capacity and bookings");
      setCap(s, "K1", "10");
      assert.deepStrictEqual(snap(s).signups, [
        booked("K1", "Ann"),
        booked("K1", "Bob"),
        booked("K2", "Zed"),
        waiting("K2", "Yan"),
        booked("K1", "Cy"),
        booked("K1", "Dee"),
      ]);
      assert.equal(undoCount(s), 9);
      return "3 books Bob and Cy in place; 10 books everyone waiting; Spin untouched";
    }),
);

core(
  "core a capacity below the booked count reports CapacityTooLow with the class id and that count",
  () =>
    inScope((s) => {
      add(s, "Yoga", "3");
      joinAll(s, [
        ["K1", "Ann"],
        ["K1", "Bob"],
        ["K1", "Cy"],
        ["K1", "Dee"],
      ]);
      for (const capacity of ["2", " 1 "])
        failsWith(s, app.setCapacity, { classId: "K1", capacity }, "CapacityTooLow", {
          classId: "K1",
          booked: 3,
        });
      assert.equal(undoCount(s), 5);
      return "3 booked, 1 waiting: 2 and 1 refused with booked 3";
    }),
);

core(
  "core setting the same capacity passes with no change or undo step and returns the saved class",
  () =>
    inScope((s) => {
      add(s, "Yoga", "1");
      joinAll(s, [
        ["K1", "Ann"],
        ["K1", "Bob"],
      ]);
      const before = snap(s);
      assert.deepStrictEqual(plain(setCap(s, "K1", "1")), gymClass("K1", "Yoga", 1));
      assert.deepStrictEqual(plain(setCap(s, "K1", " 1 ")), gymClass("K1", "Yoga", 1));
      assert.deepStrictEqual(snap(s), before);
      assert.equal(undoCount(s), 3);
      return "saved class returned, Bob still waiting, no step";
    }),
);

core("core failed actions leave classes, signups, and undo history unchanged", () =>
  inScope((s) => {
    add(s, "Yoga", "2");
    add(s, "Spin", "1");
    joinAll(s, [
      ["K1", "Ann"],
      ["K1", "Bob"],
      ["K1", "Cy"],
      ["K2", "Dee"],
    ]);
    const tries = [
      [app.addClass, { name: " ", capacity: "3" }, "BadName"],
      [app.addClass, { name: "Yoga", capacity: "3" }, "DuplicateName"],
      [app.addClass, { name: "Box", capacity: "0" }, "BadCapacity"],
      [app.setCapacity, { classId: "K1", capacity: "x" }, "BadCapacity"],
      [app.setCapacity, { classId: "K9", capacity: "3" }, "NotFound"],
      [app.setCapacity, { classId: "K1", capacity: "1" }, "CapacityTooLow"],
      [app.joinClass, { classId: "K9", member: "Eve" }, "NotFound"],
      [app.joinClass, { classId: "K1", member: "" }, "BlankMember"],
      [app.leaveClass, { classId: "K1", member: " " }, "BlankMember"],
      [app.leaveClass, { classId: "K1", member: "Eve" }, "NotJoined"],
      [app.leaveClass, { classId: "K2", member: "Ann" }, "NotJoined"],
    ];
    for (const [op, input, kind] of tries) failsWithAny(s, op, { input }, [[kind, undefined]]);
    assert.equal(undoCount(s), 6, "failures added no step and removed none");
    assert.deepStrictEqual(snap(s), { classes: [], signups: [] });
    return `${tries.length} failures, no write, no step`;
  }),
);

core("core undo restores the exact classes and signups step by step, then EmptyUndo", () =>
  inScope((s) => {
    const steps = [snap(s)];
    add(s, "Yoga", "1");
    steps.push(snap(s));
    add(s, "Spin", "2");
    steps.push(snap(s));
    join(s, "K1", "Ann");
    steps.push(snap(s));
    join(s, "K1", "Bob");
    steps.push(snap(s));
    setCap(s, "K1", "2");
    steps.push(snap(s));
    leave(s, "K1", "Ann");
    steps.push(snap(s));
    join(s, "K2", "Cy");
    for (const want of steps.reverse()) {
      assert.equal(undo(s), undefined);
      assert.deepStrictEqual(snap(s), want);
    }
    assert.equal(caught(() => undo(s))?.kind, "EmptyUndo");
    assert.deepStrictEqual(plain(add(s, "Box", "4")), gymClass("K1", "Box", 4));
    return "seven steps back, exact records; the next class is K1 again";
  }),
);

core("core two scopes share nothing", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    add(a, "Yoga", "1");
    join(a, "K1", "Ann");
    assert.deepStrictEqual(snap(b), { classes: [], signups: [] });
    assert.equal(caught(() => undo(b))?.kind, "EmptyUndo");
    add(b, "Spin", "2");
    assert.deepStrictEqual(snap(a), {
      classes: [gymClass("K1", "Yoga", 1)],
      signups: [booked("K1", "Ann")],
    });
    assert.deepStrictEqual(snap(b), { classes: [gymClass("K1", "Spin", 2)], signups: [] });
    return "separate classes, signups, and history";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core thrown errors narrow through isError", () =>
  inScope((s) => {
    const bad = caught(() => add(s, "Yoga", "05"));
    assert.ok(app.isError(bad, "BadCapacity"), "want BadCapacity");
    assert.ok(!app.isError(bad, "NotFound"), "BadCapacity is not NotFound");
    assert.deepStrictEqual(bad.payload, { capacity: "05" });
    const gone = caught(() => join(s, "K9", "Ann"));
    assert.ok(app.isError(gone, "NotFound"), "want NotFound");
    const empty = caught(() => undo(s));
    assert.ok(app.isError(empty, "EmptyUndo"), "want EmptyUndo");
    return "BadCapacity, NotFound, EmptyUndo";
  }),
);

// ---- browser checks: real Chromium, fresh mounts ----
const URL_ROOT = "http://127.0.0.1:5173";
const browserTests = [];
const browser = (name, fn) => browserTests.push([name, fn]);

const textbox = (scope, name) => scope.getByRole("textbox", { name, exact: true });
const nameBox = (scope) => textbox(scope, "Name");
const capacityBox = (scope) => textbox(scope, "Capacity");
const memberBox = (scope) => textbox(scope, "Member");
const classBox = (scope) => scope.getByRole("combobox", { name: "Class", exact: true });
const classesTable = (scope) => scope.getByRole("table", { name: "Classes", exact: true });
const signupsTable = (scope) => scope.getByRole("table", { name: "Signups", exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const removeButton = (scope, member, className) =>
  button(scope, `Remove ${member} from ${className}`);

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
  // A cell's own text without its controls: the task names the Remove
  // buttons but not where they sit, so a button inside the Member or
  // Status cell must not change what the cell says.
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
  const rows = await Promise.all((await table.getByRole("row").all()).map(cellsOf));
  const head = rows.findIndex((cells) => columns.every((column) => cells.includes(column)));
  assert.ok(head >= 0, `want columns ${columns.join(", ")}; found ${rows[0]?.join(", ") ?? ""}`);
  const at = columns.map((column) => rows[head].indexOf(column));
  return rows.slice(head + 1).map((cells) => at.map((i) => cells[i]));
};
const CLASS_COLUMNS = ["Class", "Capacity", "Booked", "Waiting"];
const SIGNUP_COLUMNS = ["Class", "Member", "Status"];
const classRows = (scope) => readTable(classesTable(scope), CLASS_COLUMNS);
const signupRows = (scope) => readTable(signupsTable(scope), SIGNUP_COLUMNS);

// The Class select: option labels in order (an empty-label option is
// ignored), and the label it shows now ("" with no option chosen).
const optionLabels = async (scope) =>
  (await classBox(scope).locator("option").allTextContents())
    .map((label) => label.trim())
    .filter((label) => label !== "");
const chosenLabel = (scope) =>
  classBox(scope).evaluate((el) => el.selectedOptions[0]?.textContent?.trim() ?? "");

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
  await nameBox(scope).inputValue(),
  await capacityBox(scope).inputValue(),
  await memberBox(scope).inputValue(),
];

const addVia = async (scope, name, capacity) => {
  await nameBox(scope).fill(name);
  await capacityBox(scope).fill(capacity);
  await button(scope, "Add class").click();
};
// Passing adds; each waits for the class form to clear.
const addClasses = async (scope, list) => {
  for (const [name, capacity] of list) {
    await addVia(scope, name, capacity);
    await settle(async () => (await formText(scope)).slice(0, 2), ["", ""]);
  }
};
const choose = (scope, className) => classBox(scope).selectOption({ label: className });
// Passing joins into one class; each waits for its Remove button.
const joinMembers = async (scope, className, members) => {
  await choose(scope, className);
  for (const member of members) {
    await memberBox(scope).fill(member);
    await button(scope, "Join").click();
    await removeButton(scope, member.trim(), className).waitFor();
  }
};
const setCapacityVia = async (scope, capacity) => {
  await capacityBox(scope).fill(capacity);
  await button(scope, "Set capacity").click();
};
const open = async (page) => {
  await page.goto(URL_ROOT);
  await classesTable(page).waitFor();
  await signupsTable(page).waitFor();
};

browser(
  "browser loads empty forms, an empty Class select, both tables, the filters, and Undo",
  async (page) => {
    await open(page);
    assert.deepStrictEqual(await formText(page), ["", "", ""]);
    assert.deepStrictEqual(await optionLabels(page), []);
    assert.equal(await chosenLabel(page), "");
    for (const name of ["Add class", "Join", "Set capacity", "Undo", "All", "Booked", "Waiting"])
      await button(page, name).waitFor();
    assert.ok(await button(page, "Undo").isEnabled(), "Undo enabled on empty history");
    assert.deepStrictEqual(await classRows(page), []);
    assert.deepStrictEqual(await signupRows(page), []);
    assert.equal(await alertText(page), "");
    return "inputs empty; no class; Classes and Signups empty";
  },
);

browser(
  "browser a passing Add class adds the row, clears Name and Capacity, and Class starts on the first class",
  async (page) => {
    await open(page);
    await memberBox(page).fill("Ann");
    await addVia(page, " Yoga ", " 3 ");
    await settle(() => classRows(page), [["Yoga", "3", "0", "0"]]);
    assert.deepStrictEqual(await formText(page), ["", "", "Ann"]);
    await settle(() => chosenLabel(page), "Yoga");
    await addVia(page, "Spin", "12");
    await settle(
      () => classRows(page),
      [
        ["Yoga", "3", "0", "0"],
        ["Spin", "12", "0", "0"],
      ],
    );
    assert.deepStrictEqual(await formText(page), ["", "", "Ann"]);
    await settle(() => optionLabels(page), ["Yoga", "Spin"]);
    assert.equal(await chosenLabel(page), "Yoga");
    assert.equal(await alertText(page), "");
    return "trimmed row, Booked 0, Waiting 0; Class lists Yoga, Spin and shows Yoga";
  },
);

browser("browser a failed Add class keeps Name and Capacity and shows the kind", async (page) => {
  await open(page);
  await addClasses(page, [["Yoga", "3"]]);
  const tries = [
    [" ", "3", "BadName"],
    ["Box", "05", "BadCapacity"],
    ["Box", "", "BadCapacity"],
    ["Box", "21", "BadCapacity"],
    ["Box", "2.5", "BadCapacity"],
    [" Yoga ", "4", "DuplicateName"],
  ];
  for (const [name, capacity, kind] of tries) {
    await addVia(page, name, capacity);
    await seeAlert(page, kind);
    assert.deepStrictEqual(
      (await formText(page)).slice(0, 2),
      [name, capacity],
      `${kind} kept text`,
    );
  }
  assert.deepStrictEqual(await classRows(page), [["Yoga", "3", "0", "0"]]);
  return "BadName, BadCapacity (05, blank, 21, 2.5), DuplicateName";
});

browser(
  "browser Join adds the chosen class and member, booked then Waiting <n>, clears Member, and keeps Class",
  async (page) => {
    await open(page);
    await addClasses(page, [
      ["Yoga", "2"],
      ["Spin", "1"],
    ]);
    await memberBox(page).fill(" Ann ");
    await button(page, "Join").click();
    await removeButton(page, "Ann", "Yoga").waitFor();
    assert.deepStrictEqual(await formText(page), ["", "", ""]);
    await joinMembers(page, "Yoga", ["Bob", "Cy"]);
    await joinMembers(page, "Spin", ["Ann", "Dee"]);
    assert.equal(await chosenLabel(page), "Spin");
    await joinMembers(page, "Yoga", ["Eve"]);
    await settle(
      () => signupRows(page),
      [
        ["Yoga", "Ann", "Booked"],
        ["Yoga", "Bob", "Booked"],
        ["Yoga", "Cy", "Waiting 1"],
        ["Spin", "Ann", "Booked"],
        ["Spin", "Dee", "Waiting 1"],
        ["Yoga", "Eve", "Waiting 2"],
      ],
    );
    await settle(
      () => classRows(page),
      [
        ["Yoga", "2", "2", "2"],
        ["Spin", "1", "1", "1"],
      ],
    );
    assert.deepStrictEqual(await formText(page), ["", "", ""]);
    assert.equal(await alertText(page), "");
    return "class names, Booked / Waiting 1 / Waiting 2; counts Booked 2 Waiting 2";
  },
);

browser("browser a failed Join keeps Member text and shows the kind", async (page) => {
  await open(page);
  await memberBox(page).fill("Ann");
  await button(page, "Join").click();
  await seeAlert(page, "NotFound");
  assert.deepStrictEqual(await formText(page), ["", "", "Ann"]);
  await addClasses(page, [["Yoga", "2"]]);
  await memberBox(page).fill("  ");
  await button(page, "Join").click();
  await seeAlert(page, "BlankMember");
  assert.deepStrictEqual(await formText(page), ["", "", "  "]);
  assert.deepStrictEqual(await signupRows(page), []);
  return "NotFound with no class, BlankMember; Member kept";
});

browser(
  "browser Set capacity sets the chosen class from the Capacity text, books waiters in order, and clears Capacity only",
  async (page) => {
    await open(page);
    await addClasses(page, [
      ["Yoga", "1"],
      ["Spin", "1"],
    ]);
    await joinMembers(page, "Yoga", ["Ann", "Bob"]);
    await joinMembers(page, "Spin", ["Dee", "Eve"]);
    await joinMembers(page, "Yoga", ["Cy", "Fay"]);
    await nameBox(page).fill("Box");
    await memberBox(page).fill("Zed");
    await setCapacityVia(page, " 3 ");
    await settle(
      () => signupRows(page),
      [
        ["Yoga", "Ann", "Booked"],
        ["Yoga", "Bob", "Booked"],
        ["Spin", "Dee", "Booked"],
        ["Spin", "Eve", "Waiting 1"],
        ["Yoga", "Cy", "Booked"],
        ["Yoga", "Fay", "Waiting 1"],
      ],
    );
    await settle(
      () => classRows(page),
      [
        ["Yoga", "3", "3", "1"],
        ["Spin", "1", "1", "1"],
      ],
    );
    assert.deepStrictEqual(await formText(page), ["Box", "", "Zed"]);
    for (const [capacity, kind] of [
      ["2", "CapacityTooLow"],
      ["abc", "BadCapacity"],
      ["", "BadCapacity"],
    ]) {
      await setCapacityVia(page, capacity);
      await seeAlert(page, kind);
      assert.deepStrictEqual(await formText(page), ["Box", capacity, "Zed"], `${kind} kept text`);
    }
    assert.deepStrictEqual(await classRows(page), [
      ["Yoga", "3", "3", "1"],
      ["Spin", "1", "1", "1"],
    ]);
    return "Bob and Cy booked in place, Fay waits; CapacityTooLow and BadCapacity keep text";
  },
);

browser(
  "browser every signup row has Remove <member> from <class name>, and a booked leave books the first waiter in place",
  async (page) => {
    await open(page);
    await addClasses(page, [
      ["Yoga", "1"],
      ["Spin", "1"],
    ]);
    await joinMembers(page, "Yoga", ["Ann"]);
    await joinMembers(page, "Spin", ["Bob"]);
    await joinMembers(page, "Yoga", ["Cy"]);
    await joinMembers(page, "Spin", ["Dee"]);
    await joinMembers(page, "Yoga", ["Eve"]);
    assert.equal(await signupsTable(page).getByRole("button").count(), 5, "one button per row");
    await removeButton(page, "Ann", "Yoga").click();
    await settle(
      () => signupRows(page),
      [
        ["Spin", "Bob", "Booked"],
        ["Yoga", "Cy", "Booked"],
        ["Spin", "Dee", "Waiting 1"],
        ["Yoga", "Eve", "Waiting 1"],
      ],
    );
    await removeButton(page, "Dee", "Spin").click();
    await settle(
      () => signupRows(page),
      [
        ["Spin", "Bob", "Booked"],
        ["Yoga", "Cy", "Booked"],
        ["Yoga", "Eve", "Waiting 1"],
      ],
    );
    assert.equal(await alertText(page), "");
    return "Cy booked where it stood; a waiting leave books no one";
  },
);

browser("browser filters show only signup rows with that status and update live", async (page) => {
  await open(page);
  await addClasses(page, [["Yoga", "1"]]);
  await joinMembers(page, "Yoga", ["Ann", "Bob", "Cy"]);
  await button(page, "Booked").click();
  await settle(() => signupRows(page), [["Yoga", "Ann", "Booked"]]);
  await button(page, "Waiting").click();
  await settle(
    () => signupRows(page),
    [
      ["Yoga", "Bob", "Waiting 1"],
      ["Yoga", "Cy", "Waiting 2"],
    ],
  );
  assert.deepStrictEqual(await classRows(page), [["Yoga", "1", "1", "2"]]);
  await removeButton(page, "Bob", "Yoga").click();
  await settle(() => signupRows(page), [["Yoga", "Cy", "Waiting 1"]]);
  await memberBox(page).fill("Dee");
  await button(page, "Join").click();
  await settle(
    () => signupRows(page),
    [
      ["Yoga", "Cy", "Waiting 1"],
      ["Yoga", "Dee", "Waiting 2"],
    ],
  );
  await button(page, "Booked").click();
  await settle(() => signupRows(page), [["Yoga", "Ann", "Booked"]]);
  await button(page, "All").click();
  await settle(
    () => signupRows(page),
    [
      ["Yoga", "Ann", "Booked"],
      ["Yoga", "Cy", "Waiting 1"],
      ["Yoga", "Dee", "Waiting 2"],
    ],
  );
  return "Booked and Waiting show only their rows; Classes unfiltered; rows move live";
});

browser("browser typing in Name, Capacity, or Member clears an earlier alert", async (page) => {
  await open(page);
  const boxes = [
    [nameBox, "Yoga"],
    [capacityBox, "3"],
    [memberBox, "Ann"],
  ];
  for (const [box, text] of boxes) {
    await button(page, "Undo").click();
    await seeAlert(page, "EmptyUndo");
    await box(page).fill(text);
    await noAlert(page);
  }
  return "each box clears EmptyUndo";
});

browser("browser choosing a class or a filter clears an earlier alert", async (page) => {
  await open(page);
  await addClasses(page, [
    ["Yoga", "2"],
    ["Spin", "2"],
  ]);
  await button(page, "Join").click();
  await seeAlert(page, "BlankMember");
  await choose(page, "Spin");
  await noAlert(page);
  await button(page, "Join").click();
  await seeAlert(page, "BlankMember");
  await button(page, "Waiting").click();
  await noAlert(page);
  await button(page, "Join").click();
  await seeAlert(page, "BlankMember");
  await button(page, "All").click();
  await noAlert(page);
  return "Class choice, Waiting, and All clear BlankMember";
});

browser(
  "browser a passing no-op Join or Set capacity clears an earlier alert and adds no undo step",
  async (page) => {
    await open(page);
    await addClasses(page, [["Yoga", "2"]]);
    await joinMembers(page, "Yoga", ["Ann", "Bob"]);
    await capacityBox(page).fill("2");
    await button(page, "Join").click();
    await seeAlert(page, "BlankMember");
    await button(page, "Set capacity").click();
    await noAlert(page);
    assert.deepStrictEqual(await formText(page), ["", "", ""]);
    await memberBox(page).fill("Ann");
    await capacityBox(page).fill("1");
    await button(page, "Set capacity").click();
    await seeAlert(page, "CapacityTooLow");
    await button(page, "Join").click();
    await noAlert(page);
    await settle(() => formText(page), ["", "1", ""]);
    const rows = [
      ["Yoga", "Ann", "Booked"],
      ["Yoga", "Bob", "Booked"],
    ];
    assert.deepStrictEqual(await signupRows(page), rows);
    assert.deepStrictEqual(await classRows(page), [["Yoga", "2", "2", "0"]]);
    await button(page, "Undo").click();
    await settle(() => signupRows(page), rows.slice(0, 1));
    return "same capacity clears BlankMember; a repeat Join clears CapacityTooLow; one Undo removes Bob";
  },
);

browser(
  "browser undo restores both tables and keeps form text, the chosen class, and the filter",
  async (page) => {
    await open(page);
    await addClasses(page, [
      ["Yoga", "1"],
      ["Spin", "1"],
    ]);
    await joinMembers(page, "Yoga", ["Ann"]);
    await joinMembers(page, "Spin", ["Bob"]);
    await joinMembers(page, "Yoga", ["Cy"]);
    await choose(page, "Spin");
    await button(page, "Waiting").click();
    await settle(() => signupRows(page), [["Yoga", "Cy", "Waiting 1"]]);
    await nameBox(page).fill("Box");
    await capacityBox(page).fill("4");
    await memberBox(page).fill("Dee");
    await button(page, "Undo").click();
    await settle(() => signupRows(page), []);
    await button(page, "Undo").click();
    await settle(
      () => classRows(page),
      [
        ["Yoga", "1", "1", "0"],
        ["Spin", "1", "0", "0"],
      ],
    );
    assert.deepStrictEqual(await signupRows(page), []);
    assert.deepStrictEqual(await formText(page), ["Box", "4", "Dee"]);
    assert.equal(await chosenLabel(page), "Spin");
    await button(page, "All").click();
    await settle(() => signupRows(page), [["Yoga", "Ann", "Booked"]]);
    return "Cy's and Bob's joins undone; Box, 4, Dee, Spin, and Waiting kept";
  },
);

browser(
  "browser Class falls back to the first class when the chosen one is gone, or to none, and then sends an empty id",
  async (page) => {
    await open(page);
    await addClasses(page, [
      ["Yoga", "2"],
      ["Spin", "2"],
    ]);
    await joinMembers(page, "Spin", ["Ann"]);
    await button(page, "Undo").click();
    await settle(() => signupRows(page), []);
    assert.equal(await chosenLabel(page), "Spin", "undo keeps a class that still exists");
    await button(page, "Undo").click();
    await settle(() => optionLabels(page), ["Yoga"]);
    await settle(() => chosenLabel(page), "Yoga");
    await memberBox(page).fill("Bob");
    await button(page, "Join").click();
    await settle(() => signupRows(page), [["Yoga", "Bob", "Booked"]]);
    await button(page, "Undo").click();
    await button(page, "Undo").click();
    await settle(() => optionLabels(page), []);
    assert.equal(await chosenLabel(page), "");
    await memberBox(page).fill("Cy");
    await button(page, "Join").click();
    await seeAlert(page, "NotFound");
    await setCapacityVia(page, "3");
    await seeAlert(page, "NotFound");
    assert.deepStrictEqual(await formText(page), ["", "3", "Cy"]);
    return "Spin gone: Yoga shown and joined; no class: Join and Set capacity report NotFound";
  },
);

browser("browser undo on empty history shows EmptyUndo", async (page) => {
  await open(page);
  await button(page, "Undo").click();
  await seeAlert(page, "EmptyUndo");
  await addClasses(page, [["Yoga", "2"]]);
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
  if (!appMod?.GymApp) throw new Error("cannot import submission entry");
  const jsx = await resolveJsx(paths);
  const createRoot = await loadCreateRoot(pickClientPath(paths));
  const holder = document.createElement("div");
  holder.id = "teacher-second-root";
  document.body.appendChild(holder);
  createRoot(holder).render(jsx(appMod.GymApp));
};

// First root: two classes, a waiting signup shown by the Waiting filter,
// Spin chosen, and typed text in all three boxes. The second root changes
// everything of its own; the first must not move.
const seedFirstRoot = async (first) => {
  await addClasses(first, [
    ["Yoga", "1"],
    ["Spin", "2"],
  ]);
  await joinMembers(first, "Yoga", ["Ann", "Bob"]);
  await choose(first, "Spin");
  await button(first, "Waiting").click();
  await nameBox(first).fill("Box");
  await capacityBox(first).fill("4");
  await memberBox(first).fill("Cy");
  await settle(() => signupRows(first), [["Yoga", "Bob", "Waiting 1"]]);
};
const changeSecondRoot = async (second) => {
  await settle(() => classRows(second), []);
  assert.deepStrictEqual(await formText(second), ["", "", ""]);
  assert.deepStrictEqual(await optionLabels(second), []);
  await addClasses(second, [["Pilates", "1"]]);
  await joinMembers(second, "Pilates", ["Zed"]);
  await button(second, "Booked").click();
  await button(second, "Join").click();
  await seeAlert(second, "BlankMember");
};
const firstUnmoved = async (first) => {
  await settle(() => signupRows(first), [["Yoga", "Bob", "Waiting 1"]]);
  assert.deepStrictEqual(await classRows(first), [
    ["Yoga", "1", "1", "1"],
    ["Spin", "2", "0", "0"],
  ]);
  assert.deepStrictEqual(await formText(first), ["Box", "4", "Cy"]);
  assert.equal(await chosenLabel(first), "Spin");
  assert.equal(await alertText(first), "");
};

browser("browser two GymApps share nothing", async (page) => {
  try {
    await open(page);
    const first = page.locator("#root");
    await seedFirstRoot(first);
    await page.evaluate(mountSecondRoot);
    const second = page.locator("#teacher-second-root");
    await classesTable(second).waitFor();
    await changeSecondRoot(second);
    await firstUnmoved(first);
    await button(first, "Undo").click();
    await settle(() => signupRows(first), []);
    await button(first, "All").click();
    await settle(() => signupRows(first), [["Yoga", "Ann", "Booked"]]);
    await seeAlert(second, "BlankMember");
    await settle(() => signupRows(second), [["Pilates", "Zed", "Booked"]]);
    assert.deepStrictEqual(await classRows(second), [["Pilates", "1", "1", "0"]]);
    return "classes, signups, text, choice, filter, notice, and undo separate";
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
  cacheDir: "/tmp/teacher-gym-browser",
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
