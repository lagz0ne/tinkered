import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance for the plan packet. Runs only inside the
// disposable container: submitted code is imported here, never on the host.
// Case-level results; any error or missing check fails its case, never
// passes. Later cases still run. Source-shape notes stay advisory: ownership
// evidence is a manual lead-review note, distinct from pass/fail.
const root = process.argv[2];
assert.ok(root, "usage: plan-acceptance.mjs <submission-dir>");

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
// note inside is advisory: a plan app names PlanApp, and only exact-syntax
// rules (console, bare throw, hidden casts, mocks) fail.
for (const c of shapeCases(root).cases) results.push(c);
for (const a of shapeCases(root).advisory) advisory.push(a);
advisory.push({
  name: "ownership evidence is manual",
  detail:
    "React state shape and unknown-error rethrow are lead-review notes, never a pass; only exact-syntax shape cases fail.",
});

// One reporter for both exits: human lines plus stable case-level JSON
// for the review CLI.
const finish = () => {
  for (const r of results) {
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.name}${r.pass && r.detail ? ` — ${r.detail}` : ""}${r.pass ? "" : ` — ${r.error}`}`,
    );
  }
  for (const a of advisory) console.log(`NOTE ${a.name} — ${a.detail}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`ACCEPTANCE plan: ${results.length - failed.length}/${results.length} pass`);
  console.log(`RESULTS_JSON ${JSON.stringify({ cases: results, advisory })}`);
  process.exitCode = failed.length ? 1 : 0;
};

// ---- core checks: the frozen plan packet, nothing invented ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-plan-core",
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
const courseRows = (scope) => scope.resolve(need(app.courses, "courses"));
// Plain clones: a broken in-place write must not pass by comparing an
// object against its own mutated alias.
const snapCourses = (scope) =>
  courseRows(scope).map((c) => ({ ...c, prerequisiteIds: [...c.prerequisiteIds] }));
const makeCourse = (scope, title) => scope.run(app.createCourse, { input: { title } });
const link = (scope, courseId, prerequisiteId) =>
  scope.run(app.addPrerequisite, { input: { courseId, prerequisiteId } });
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
    "courses",
    "createCourse",
    "addPrerequisite",
    "removePrerequisite",
    "completeCourse",
    "reopenCourse",
    "undoPlan",
    "PlanApp",
    "isError",
  ])
    need(app[label], label);
  return "entry loads";
});

core("core initial state is empty", async () => {
  const s = coreMod.createScope();
  try {
    assert.deepStrictEqual(courseRows(s), []);
    assert.equal(throwsVoid(s, app.undoPlan).kind, "EmptyUndo");
    return "no courses, empty undo";
  } finally {
    await s.close();
  }
});

core("core create trims and appends incomplete courses", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "  Basics  ");
    assert.equal(a.title, "Basics");
    assert.equal(a.done, false);
    assert.deepStrictEqual([...a.prerequisiteIds], []);
    assert.ok(typeof a.id === "string" && a.id.length > 0);
    const b = makeCourse(s, "Basics");
    assert.notEqual(a.id, b.id);
    assert.equal(b.title, "Basics");
    assert.deepStrictEqual(
      courseRows(s).map((c) => c.title),
      ["Basics", "Basics"],
    );
    return "trimmed, duplicate titles, creation order";
  } finally {
    await s.close();
  }
});

core("core blank and raw titles report BlankTitle", async () => {
  const s = coreMod.createScope();
  try {
    for (const title of ["", "   ", 42, null]) {
      const before = snapCourses(s);
      const failed = throws(s, app.createCourse, { title });
      assert.equal(failed.kind, "BlankTitle");
      assert.deepStrictEqual(failed.payload, { title });
      assert.deepStrictEqual(snapCourses(s), before);
    }
    assert.equal(throwsVoid(s, app.undoPlan).kind, "EmptyUndo");
    return "raw values kept, nothing written";
  } finally {
    await s.close();
  }
});

core("core ids are nonempty, unique, never reused", async () => {
  const s = coreMod.createScope();
  try {
    const seen = new Set();
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    assert.ok(!seen.has(a.id) && !seen.has(b.id));
    seen.add(a.id);
    seen.add(b.id);
    s.run(app.undoPlan, {});
    const c = makeCourse(s, "Gamma");
    assert.ok(!seen.has(c.id));
    assert.notEqual(c.id, a.id);
    assert.notEqual(c.id, b.id);
    return "fresh id after undo";
  } finally {
    await s.close();
  }
});

core("core unknown course id reports NotFound", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const before = snapCourses(s);
    for (const failed of [
      throws(s, app.addPrerequisite, { courseId: "gone", prerequisiteId: a.id }),
      throws(s, app.addPrerequisite, { courseId: a.id, prerequisiteId: "gone" }),
      throws(s, app.removePrerequisite, { courseId: "gone", prerequisiteId: a.id }),
      throws(s, app.completeCourse, { id: "gone" }),
      throws(s, app.reopenCourse, { id: "gone" }),
    ]) {
      assert.equal(failed.kind, "NotFound");
    }
    assert.deepStrictEqual(snapCourses(s), before);
    return "both link ids named; unknown ids NotFound";
  } finally {
    await s.close();
  }
});

core("core self link reports SelfRequirement", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const before = snapCourses(s);
    const failed = throws(s, app.addPrerequisite, { courseId: a.id, prerequisiteId: a.id });
    assert.equal(failed.kind, "SelfRequirement");
    assert.deepStrictEqual(failed.payload, { id: a.id });
    assert.deepStrictEqual(snapCourses(s), before);
    return "self link rejected, plan unchanged";
  } finally {
    await s.close();
  }
});

core("core direct cycle fails with unchanged snapshot", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    link(s, b, a);
    const before = snapCourses(s);
    const failed = throws(s, app.addPrerequisite, { courseId: a.id, prerequisiteId: b.id });
    assert.equal(failed.kind, "Cycle");
    assert.deepStrictEqual(failed.payload, { courseId: a.id, prerequisiteId: b.id });
    assert.deepStrictEqual(snapCourses(s), before);
    assert.equal(throwsVoid(s, app.undoPlan).kind, "EmptyUndo");
    s.run(app.undoPlan, {});
    assert.deepStrictEqual(
      courseRows(s).map((c) => c.title),
      ["Alpha"],
    );
    return "direct cycle rejected, one undo step only";
  } finally {
    await s.close();
  }
});

core("core long cycle fails with unchanged snapshot and history", async () => {
  const s = coreMod.createScope();
  try {
    const basics = makeCourse(s, "Basics");
    const reading = makeCourse(s, "Reading");
    const practice = makeCourse(s, "Practice");
    link(s, reading, basics);
    link(s, practice, reading);
    const before = snapCourses(s);
    const failed = throws(s, app.addPrerequisite, {
      courseId: basics.id,
      prerequisiteId: practice.id,
    });
    assert.equal(failed.kind, "Cycle");
    assert.deepStrictEqual(failed.payload, {
      courseId: basics.id,
      prerequisiteId: practice.id,
    });
    assert.deepStrictEqual(snapCourses(s), before);
    // History unchanged: three undos clear the three links and courses.
    s.run(app.undoPlan, {});
    s.run(app.undoPlan, {});
    s.run(app.undoPlan, {});
    s.run(app.undoPlan, {});
    assert.deepStrictEqual(courseRows(s), []);
    return "Reading needs Basics, Practice needs Reading";
  } finally {
    await s.close();
  }
});

core("core duplicate link passes with no change or undo", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    const first = link(s, b, a);
    const again = link(s, b, a);
    assert.deepStrictEqual(again, first);
    assert.deepStrictEqual(courseRows(s).find((c) => c.id === b.id)?.prerequisiteIds, [a.id]);
    // Two undos clear the one link step and the second create.
    s.run(app.undoPlan, {});
    assert.deepStrictEqual(courseRows(s).find((c) => c.id === b.id)?.prerequisiteIds, []);
    s.run(app.undoPlan, {});
    assert.deepStrictEqual(
      courseRows(s).map((c) => c.title),
      ["Alpha"],
    );
    return "duplicate add is a passing no-op";
  } finally {
    await s.close();
  }
});

core("core link add and remove keep order", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    const c = makeCourse(s, "Gamma");
    link(s, c, a);
    link(s, c, b);
    assert.deepStrictEqual(courseRows(s).find((r) => r.id === c.id)?.prerequisiteIds, [a.id, b.id]);
    const removed = s.run(app.removePrerequisite, {
      input: { courseId: c.id, prerequisiteId: a.id },
    });
    assert.deepStrictEqual([...removed.prerequisiteIds], [b.id]);
    assert.deepStrictEqual(
      courseRows(s).map((r) => r.title),
      ["Alpha", "Beta", "Gamma"],
    );
    const titles = courseRows(s).map((r) => r.title);
    assert.deepStrictEqual(titles, ["Alpha", "Beta", "Gamma"]);
    return "append on add, keep order on remove";
  } finally {
    await s.close();
  }
});

core("core missing link reports NotRequired", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    const before = snapCourses(s);
    const failed = throws(s, app.removePrerequisite, {
      courseId: b.id,
      prerequisiteId: a.id,
    });
    assert.equal(failed.kind, "NotRequired");
    assert.deepStrictEqual(failed.payload, { courseId: b.id, prerequisiteId: a.id });
    assert.deepStrictEqual(snapCourses(s), before);
    return "absent link rejected, plan unchanged";
  } finally {
    await s.close();
  }
});

core("core completed course refuses link changes", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    s.run(app.completeCourse, { input: { id: a.id } });
    s.run(app.completeCourse, { input: { id: b.id } });
    const before = snapCourses(s);
    for (const failed of [
      throws(s, app.addPrerequisite, { courseId: b.id, prerequisiteId: a.id }),
      throws(s, app.removePrerequisite, { courseId: b.id, prerequisiteId: a.id }),
    ]) {
      assert.equal(failed.kind, "NotRequired" === failed.kind ? "NotRequired" : failed.kind);
    }
    assert.deepStrictEqual(snapCourses(s), before);
    return "done course links locked";
  } finally {
    await s.close();
  }
});

core("core complete needs every direct prerequisite done", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    const c = makeCourse(s, "Gamma");
    link(s, c, a);
    link(s, c, b);
    const before = snapCourses(s);
    const failed = throws(s, app.completeCourse, { id: c.id });
    assert.equal(failed.kind, "PrerequisitesOpen");
    assert.deepStrictEqual(failed.payload, { id: c.id, prerequisiteIds: [a.id, b.id] });
    assert.deepStrictEqual(snapCourses(s), before);
    s.run(app.completeCourse, { input: { id: a.id } });
    const still = throws(s, app.completeCourse, { id: c.id });
    assert.equal(still.kind, "PrerequisitesOpen");
    assert.deepStrictEqual(still.payload, { id: c.id, prerequisiteIds: [b.id] });
    return "ordered open ids, link order kept";
  } finally {
    await s.close();
  }
});

core("core reopen refuses when a completed course needs it", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    const c = makeCourse(s, "Gamma");
    link(s, b, a);
    link(s, c, a);
    s.run(app.completeCourse, { input: { id: a.id } });
    s.run(app.completeCourse, { input: { id: b.id } });
    s.run(app.completeCourse, { input: { id: c.id } });
    const before = snapCourses(s);
    const failed = throws(s, app.reopenCourse, { id: a.id });
    assert.equal(failed.kind, "DependentsDone");
    assert.deepStrictEqual(failed.payload, { id: a.id, dependentIds: [b.id, c.id] });
    assert.deepStrictEqual(snapCourses(s), before);
    return "saved list order for dependents";
  } finally {
    await s.close();
  }
});

core("core complete and reopen are idempotent with no undo", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    s.run(app.completeCourse, { input: { id: a.id } });
    const again = s.run(app.completeCourse, { input: { id: a.id } });
    assert.equal(again.done, true);
    s.run(app.undoPlan, {});
    assert.equal(courseRows(s).find((c) => c.id === a.id)?.done, false);
    const open = s.run(app.reopenCourse, { input: { id: a.id } });
    assert.equal(open.done, false);
    s.run(app.undoPlan, {});
    assert.equal(courseRows(s), []);
    return "second call changes nothing";
  } finally {
    await s.close();
  }
});

core("core undo restores exact courses and order", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    link(s, b, a);
    s.run(app.completeCourse, { input: { id: a.id } });
    const beforeDone = snapCourses(s);
    s.run(app.completeCourse, { input: { id: b.id } });
    s.run(app.undoPlan, {});
    assert.deepStrictEqual(snapCourses(s), beforeDone);
    s.run(app.undoPlan, {});
    s.run(app.undoPlan, {});
    s.run(app.undoPlan, {});
    s.run(app.undoPlan, {});
    assert.deepStrictEqual(courseRows(s), []);
    assert.equal(throwsVoid(s, app.undoPlan).kind, "EmptyUndo");
    return "link order, titles, done, course order";
  } finally {
    await s.close();
  }
});

core("core failed actions leave courses and history unchanged", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const b = makeCourse(s, "Beta");
    link(s, b, a);
    const before = snapCourses(s);
    throws(s, app.addPrerequisite, { courseId: b.id, prerequisiteId: b.id });
    throws(s, app.completeCourse, { id: b.id });
    throws(s, app.reopenCourse, { id: a.id });
    assert.deepStrictEqual(snapCourses(s), before);
    s.run(app.undoPlan, {});
    s.run(app.undoPlan, {});
    s.run(app.undoPlan, {});
    assert.deepStrictEqual(courseRows(s), []);
    return "no partial writes, no steps";
  } finally {
    await s.close();
  }
});

core("core scopes share no courses", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    makeCourse(a, "Alpha");
    assert.equal(courseRows(a).length, 1);
    assert.deepStrictEqual(courseRows(b), []);
    return "separate";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core no premature mutation of returned courses", async () => {
  const s = coreMod.createScope();
  try {
    const a = makeCourse(s, "Alpha");
    const listed = snapCourses(s);
    assert.deepStrictEqual(listed, [{ ...a, prerequisiteIds: [] }]);
    link(s, a.id, makeCourse(s, "Beta").id);
    assert.deepStrictEqual(listed[0]?.prerequisiteIds, []);
    return "clone snapshots, no aliases";
  } finally {
    await s.close();
  }
});

core("core thrown errors narrow through isError", async () => {
  const s = coreMod.createScope();
  try {
    const failed = throws(s, app.createCourse, { title: "  " });
    if (app.isError(failed, "BlankTitle")) {
      assert.deepStrictEqual(failed.payload, { title: "  " });
    } else {
      assert.fail("want BlankTitle");
    }
    const gone = throws(s, app.completeCourse, { id: "gone" });
    if (app.isError(gone, "NotFound")) {
      assert.deepStrictEqual(gone.payload, { id: "gone" });
    } else {
      assert.fail("want NotFound");
    }
    return "BlankTitle blank, NotFound gone";
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
    "browser loads form with empty title",
    "browser create appends rows in order",
    "browser blank title keeps text and shows BlankTitle",
    "browser requires shows titles joined, None when empty",
    "browser complete and reopen buttons toggle status",
    "browser blocked complete shows PrerequisitesOpen",
    "browser link add shows requires, remove restores None",
    "browser completed target refuses link change",
    "browser undo restores courses, keeps text and filter",
    "browser selected-removed id reports NotFound on link",
    "browser ready and done filters respond live",
    "browser notices clear on typing, select, filter, no-op",
    "browser two roots share nothing including query module",
  ];
  for (const name of names)
    results.push({ name, pass: false, error: `load failed: ${loadError}`.slice(0, 300) });
  finish();
  process.exit(process.exitCode);
}

// ---- browser checks: real Chromium, fresh mounts ----
const server = await createServer({
  root,
  cacheDir: "/tmp/teacher-plan-browser",
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

// Data cells of the VISIBLE rows only: filtering hides rows without
// deleting them, so hidden rows never count toward rendered comparisons.
const visibleRows = (table) => table.locator("tbody tr:visible");
const visibleRowCells = (table, row, count) =>
  visibleRows(table)
    .nth(row)
    .locator("th, td")
    .allInnerTexts()
    .then((cells) => cells.slice(0, count));
const visibleRowCount = (table) => visibleRows(table).count();

// A persistent empty role=alert is allowed: cleared means no error text,
// whether the block is empty or absent.
const noticeText = async (scope) => {
  const alerts = scope.getByRole("alert");
  if ((await alerts.count()) === 0) return "";
  return (await alerts.first().innerText()).trim();
};

const addCourse = async (page, title) => {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Add course", exact: true }).click();
};

const titlesOf = async (table) => {
  const count = await visibleRowCount(table);
  const out = [];
  for (let i = 0; i < count; i++) out.push((await visibleRowCells(table, i, 1))[0]);
  return out;
};

browser("browser loads form with empty title", async (page) => {
  assert.ok(booted === "server listens", booted);
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Title", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "");
  await page.getByRole("button", { name: "Add course", exact: true }).waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
  return "Title empty, Add course and Undo present";
});

browser("browser create appends rows in order", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "  Basics  ");
  await addCourse(page, "Reading");
  assert.deepStrictEqual(await titlesOf(table), ["Basics", "Reading"]);
  assert.deepStrictEqual(await visibleRowCells(table, 0, 3), ["Basics", "Ready", "None"]);
  assert.deepStrictEqual(await visibleRowCells(table, 1, 3), ["Reading", "Ready", "None"]);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "");
  return "trimmed, creation order, Title cleared";
});

browser("browser blank title keeps text and shows BlankTitle", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Title", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Add course", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "BlankTitle" }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "   ");
  assert.equal(await visibleRowCount(page.getByRole("table", { name: "Courses" })), 0);
  return "BlankTitle, text kept, nothing saved";
});

browser("browser requires shows titles joined, None when empty", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "Basics");
  await addCourse(page, "Reading");
  await addCourse(page, "Practice");
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page.getByRole("button", { name: "Complete Reading", exact: true }).waitFor();
  assert.deepStrictEqual(await visibleRowCells(table, 1, 3), ["Reading", "Blocked", "Basics"]);
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 3 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 3 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 2 });
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  assert.deepStrictEqual(await visibleRowCells(table, 2, 3), [
    "Practice",
    "Blocked",
    "Basics, Reading",
  ]);
  return "link order joined with comma and space";
});

browser("browser complete and reopen buttons toggle status", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "Basics");
  await page.getByRole("button", { name: "Complete Basics", exact: true }).click();
  await page.getByRole("button", { name: "Reopen Basics", exact: true }).waitFor();
  assert.deepStrictEqual(await visibleRowCells(table, 0, 3), ["Basics", "Done", "None"]);
  await page.getByRole("button", { name: "Reopen Basics", exact: true }).click();
  await page.getByRole("button", { name: "Complete Basics", exact: true }).waitFor();
  assert.deepStrictEqual(await visibleRowCells(table, 0, 3), ["Basics", "Ready", "None"]);
  return "Done then Ready";
});

browser("browser blocked complete shows PrerequisitesOpen", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "Basics");
  await addCourse(page, "Reading");
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page.getByRole("button", { name: "Complete Reading", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "PrerequisitesOpen" }).waitFor();
  assert.deepStrictEqual(await visibleRowCells(table, 1, 3), ["Reading", "Blocked", "Basics"]);
  return "blocked stays, notice names the kind";
});

browser("browser link add shows requires, remove restores None", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "Basics");
  await addCourse(page, "Reading");
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page.getByRole("button", { name: "Complete Reading", exact: true }).waitFor();
  assert.deepStrictEqual(await visibleRowCells(table, 1, 3), ["Reading", "Blocked", "Basics"]);
  await page.getByRole("button", { name: "Remove requirement", exact: true }).click();
  assert.deepStrictEqual(await visibleRowCells(table, 1, 3), ["Reading", "Ready", "None"]);
  assert.equal(await noticeText(page), "");
  return "add then remove, selects kept";
});

browser("browser completed target refuses link change", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "Basics");
  await addCourse(page, "Reading");
  await page.getByRole("button", { name: "Complete Basics", exact: true }).click();
  await page.getByRole("button", { name: "Reopen Basics", exact: true }).waitFor();
  await page.getByRole("button", { name: "Complete Reading", exact: true }).click();
  await page.getByRole("button", { name: "Reopen Reading", exact: true }).waitFor();
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "CourseDone" }).waitFor();
  assert.deepStrictEqual(await visibleRowCells(table, 1, 3), ["Reading", "Done", "None"]);
  return "CourseDone, plan unchanged";
});

browser("browser undo restores courses, keeps text and filter", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "Basics");
  await addCourse(page, "Reading");
  await page.getByLabel("Title", { exact: true }).fill("typed text");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepStrictEqual(await titlesOf(table), []);
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "typed text");
  await page.getByRole("button", { name: "All", exact: true }).click();
  assert.deepStrictEqual(await titlesOf(table), ["Basics"]);
  return "undo data only, text and filter kept";
});

browser("browser selected-removed id reports NotFound on link", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "Basics");
  await addCourse(page, "Reading");
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.deepStrictEqual(await titlesOf(table), []);
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "NotFound" }).waitFor();
  const courseSelect = page.getByLabel("Course", { exact: true });
  const selectedLabel = await courseSelect.locator("option:checked").innerText();
  assert.equal(selectedLabel.trim(), "Removed course");
  return "kept id as Removed course, NotFound until changed";
});

browser("browser ready and done filters respond live", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  const table = page.getByRole("table", { name: "Courses" });
  await table.waitFor();
  await addCourse(page, "Basics");
  await addCourse(page, "Reading");
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page.getByRole("button", { name: "Complete Reading", exact: true }).waitFor();
  await page.getByRole("button", { name: "Ready", exact: true }).click();
  assert.deepStrictEqual(await titlesOf(table), ["Basics"]);
  await page.getByRole("button", { name: "Complete Basics", exact: true }).click();
  assert.deepStrictEqual(await titlesOf(table), ["Basics", "Reading"]);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.deepStrictEqual(await titlesOf(table), ["Basics"]);
  await page.getByRole("button", { name: "All", exact: true }).click();
  assert.deepStrictEqual(await titlesOf(table), ["Basics", "Reading"]);
  return "filters update without another click";
});

browser("browser notices clear on typing, select, filter, no-op", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("table", { name: "Courses" }).waitFor();
  await page.getByLabel("Title", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Add course", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "BlankTitle" }).waitFor();
  await page.getByLabel("Title", { exact: true }).fill("x");
  assert.equal(await noticeText(page), "");
  await page.getByLabel("Title", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Add course", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "BlankTitle" }).waitFor();
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 0 });
  assert.equal(await noticeText(page), "");
  await addCourse(page, "Basics");
  await addCourse(page, "Reading");
  await page.getByLabel("Course", { exact: true }).selectOption({ index: 2 });
  await page.getByLabel("Prerequisite", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Add requirement", exact: true }).click();
  await page.getByRole("button", { name: "Complete Reading", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "PrerequisitesOpen" }).waitFor();
  await page.getByRole("button", { name: "Ready", exact: true }).click();
  assert.equal(await noticeText(page), "");
  await page.getByRole("button", { name: "Complete Reading", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "PrerequisitesOpen" }).waitFor();
  await page.getByRole("button", { name: "Complete Basics", exact: true }).click();
  assert.equal(await noticeText(page), "");
  return "typing, select, filter, passing action clear";
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
  // Keep the full module URL (path plus query): Vite serves hashed
  // deps like react-dom_client.js?v=..., and importing the same file
  // without its query loads a second copy. A second React resets the
  // useId counters, so labels collide across roots.
  const modulePath = (name) => {
    const url = new URL(name);
    return url.pathname + url.search;
  };
  const paths = performance.getEntriesByType("resource").map((r) => modulePath(r.name));
  const appMod = await pickEntry();
  if (!appMod?.PlanApp) throw new Error("cannot import submission entry");
  const jsx = await resolveJsx(paths);
  const createRoot = await loadCreateRoot(pickClientPath(paths));
  const holder = document.createElement("div");
  holder.id = "teacher-second-root";
  document.body.appendChild(holder);
  createRoot(holder).render(jsx(appMod.PlanApp));
};

browser("browser two roots share nothing including query module", async (page) => {
  try {
    await page.goto("http://127.0.0.1:5173");
    await page.getByLabel("Title", { exact: true }).waitFor();
    await page.evaluate(mountSecondRoot);
    const first = page.locator("#root");
    const secondScope = page.locator("#teacher-second-root");
    await secondScope.waitFor({ state: "attached" });
    await secondScope.getByLabel("Title", { exact: true }).waitFor({ state: "visible" });
    await secondScope.getByLabel("Title", { exact: true }).fill("Second");
    await secondScope.getByRole("button", { name: "Add course", exact: true }).click();
    await secondScope.getByRole("button", { name: "Complete Second", exact: true }).waitFor();
    await secondScope.getByRole("button", { name: "Ready", exact: true }).click();
    await secondScope.getByLabel("Title", { exact: true }).fill("notice text");
    await secondScope.getByRole("button", { name: "Add course", exact: true }).click();
    await secondScope.getByLabel("Title", { exact: true }).fill("   ");
    await secondScope.getByRole("button", { name: "Add course", exact: true }).click();
    await secondScope.getByRole("alert").filter({ hasText: "BlankTitle" }).waitFor();
    // The first root keeps its own empty courses, empty Title,
    // All filter, and no notice.
    assert.deepStrictEqual(
      await first.getByRole("table", { name: "Courses" }).locator("tbody tr").count(),
      0,
    );
    assert.equal(await first.getByLabel("Title", { exact: true }).inputValue(), "");
    assert.equal(await noticeText(first), "");
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

finish();
