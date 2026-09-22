import assert from "node:assert/strict";
import { createServer } from "vite-plus";
import { chromium } from "playwright";
import { shapeCases } from "./acceptance-shape.mjs";

// Isolated teacher acceptance. Runs only inside the disposable container:
// submitted code is imported here, never on the host. Case-level results;
// any error or missing check fails its case, never passes.
const root = process.argv[2];
const mode = process.argv[3] ?? "repair";
assert.ok(root, "usage: acceptance.mjs <submission-dir> <repair|transfer>");
assert.ok(["repair", "transfer"].includes(mode), "mode is repair or transfer");

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

// Runs over submitted text only; never imports it.
for (const c of shapeCases(root).cases) results.push(c);
for (const a of shapeCases(root).advisory) advisory.push(a);

// ---- core checks (rounds 1-4 plus regressions) ----
const vite = await createServer({
  root,
  cacheDir: "/tmp/teacher-accept-core",
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
const rows = (scope) => scope.resolve(need(app.bookings, "bookings"));
const throws = (scope, op, input) => {
  try {
    scope.run(op, { input });
  } catch (error) {
    return error;
  }
  assert.fail("want throw");
};
const coreTests = [];
const core = (name, fn) => coreTests.push([name, fn]);

core("core loads public entry", async () => {
  assert.ok(!loadError, loadError);
  for (const label of ["bookings", "bookBooking", "cancelBooking"]) need(app[label], label);
  return "entry loads";
});

core("core r1: rooms, book, clash, rooms separate, cancel frees", async () => {
  const s = coreMod.createScope();
  try {
    assert.deepStrictEqual([...app.rooms], ["Cedar", "Maple"]);
    const one = s.run(app.bookBooking, {
      input: { title: "Standup", room: "Cedar", start: 540, end: 600 },
    });
    assert.equal(typeof one.id, "string");
    assert.equal(rows(s).length, 1);
    assert.equal(
      throws(s, app.bookBooking, { title: "B", room: "Cedar", start: 570, end: 630 }).kind,
      "Clash",
    );
    assert.equal(rows(s).length, 1);
    const cross = s.run(app.bookBooking, {
      input: { title: "C", room: "Maple", start: 570, end: 630 },
    });
    assert.equal(cross.room, "Maple");
    s.run(app.cancelBooking, { input: { id: one.id } });
    assert.equal(throws(s, app.cancelBooking, { id: one.id }).kind, "NotFound");
    const freed = s.run(app.bookBooking, {
      input: { title: "D", room: "Cedar", start: 540, end: 600 },
    });
    assert.equal(freed.title, "D");
    return "book, clash, cancel, free slot";
  } finally {
    await s.close();
  }
});

core("core r1: blank title rejected, failed action saves nothing", async () => {
  const s = coreMod.createScope();
  try {
    const before = rows(s).length;
    assert.equal(
      throws(s, app.bookBooking, { title: "   ", room: "Cedar", start: 540, end: 600 }).kind,
      "BlankTitle",
    );
    assert.equal(rows(s).length, before);
    return "BlankTitle keeps list";
  } finally {
    await s.close();
  }
});

core("core r1: order by start then creation", async () => {
  const s = coreMod.createScope();
  try {
    s.run(app.bookBooking, { input: { title: "Late", room: "Cedar", start: 660, end: 720 } });
    s.run(app.bookBooking, { input: { title: "Early", room: "Maple", start: 540, end: 600 } });
    assert.deepStrictEqual(
      rows(s).map((b) => b.title),
      ["Early", "Late"],
    );
    return "start order";
  } finally {
    await s.close();
  }
});

core("core: scopes are separate", async () => {
  const a = coreMod.createScope();
  const b = coreMod.createScope();
  try {
    a.run(app.bookBooking, { input: { title: "Only", room: "Cedar", start: 540, end: 600 } });
    assert.equal(rows(a).length, 1);
    assert.equal(rows(b).length, 0);
    return "separate";
  } finally {
    await a.close();
    await b.close();
  }
});

core("core r2: open copy, save, failed save keeps both, discard", async () => {
  const s = coreMod.createScope();
  try {
    const target = s.run(app.bookBooking, {
      input: { title: "E", room: "Maple", start: 60, end: 120 },
    });
    const draft = s.run(app.openEdit, { input: { id: target.id } });
    assert.equal(draft.title, "E");
    draft.title = "Mutated";
    assert.equal(rows(s).find((x) => x.id === target.id).title, "E");
    s.run(app.bookBooking, { input: { title: "Clash", room: "Maple", start: 570, end: 630 } });
    assert.equal(
      throws(s, app.saveEdit, { id: target.id, title: "E", room: "Maple", start: 570, end: 630 })
        .kind,
      "Clash",
    );
    assert.equal(rows(s).find((x) => x.id === target.id).start, 60);
    assert.equal(s.resolve(app.editDraft).id, target.id);
    const kept = s.run(app.saveEdit, {
      input: { id: target.id, title: "Renamed", room: "Maple", start: 60, end: 120 },
    });
    assert.equal(kept.title, "Renamed");
    assert.strictEqual(s.resolve(app.editDraft), undefined);
    return "edit save, clash keeps both";
  } finally {
    await s.close();
  }
});

core("core r2: unknown ids, closed draft, cancel closes draft", async () => {
  const s = coreMod.createScope();
  try {
    assert.equal(throws(s, app.openEdit, { id: "gone" }).kind, "NotFound");
    const target = s.run(app.bookBooking, {
      input: { title: "F", room: "Cedar", start: 60, end: 120 },
    });
    s.run(app.openEdit, { input: { id: target.id } });
    s.run(app.discardEdit, { input: { id: target.id } });
    assert.strictEqual(s.resolve(app.editDraft), undefined);
    assert.equal(
      throws(s, app.saveEdit, { id: target.id, title: "F", room: "Cedar", start: 60, end: 120 })
        .kind,
      "NotFound",
    );
    assert.equal(throws(s, app.discardEdit, { id: target.id }).kind, "NotFound");
    s.run(app.openEdit, { input: { id: target.id } });
    s.run(app.cancelBooking, { input: { id: target.id } });
    assert.strictEqual(s.resolve(app.editDraft), undefined);
    return "draft lifecycle";
  } finally {
    await s.close();
  }
});

core("core r2: second open drops first draft", async () => {
  const s = coreMod.createScope();
  try {
    const a = s.run(app.bookBooking, { input: { title: "A", room: "Cedar", start: 60, end: 120 } });
    const b = s.run(app.bookBooking, { input: { title: "B", room: "Maple", start: 60, end: 120 } });
    s.run(app.openEdit, { input: { id: a.id } });
    s.run(app.openEdit, { input: { id: b.id } });
    assert.equal(s.resolve(app.editDraft).id, b.id);
    return "second open wins";
  } finally {
    await s.close();
  }
});

core("core regression: creation-order ties after edits", async () => {
  const s = coreMod.createScope();
  try {
    const older = s.run(app.bookBooking, {
      input: { title: "Older", room: "Cedar", start: 600, end: 660 },
    });
    s.run(app.bookBooking, { input: { title: "Newer", room: "Maple", start: 540, end: 600 } });
    s.run(app.openEdit, { input: { id: older.id } });
    s.run(app.saveEdit, {
      input: { id: older.id, title: "Older", room: "Cedar", start: 540, end: 600 },
    });
    assert.deepStrictEqual(
      rows(s).map((b) => b.title),
      ["Older", "Newer"],
    );
    return "Older, Newer";
  } finally {
    await s.close();
  }
});

core("core r3: default date, series all-or-none, cancel one, cancel series", async () => {
  const s = coreMod.createScope();
  try {
    const solo = s.run(app.bookBooking, {
      input: { title: "Solo", room: "Cedar", start: 60, end: 120 },
    });
    assert.equal(solo.date, "2026-10-01");
    const made = s.run(app.bookSeries, {
      input: { title: "Standup", room: "Cedar", date: "2026-10-06", start: 60, end: 120, weeks: 3 },
    });
    assert.deepStrictEqual(
      made.map((b) => b.date),
      ["2026-10-06", "2026-10-13", "2026-10-20"],
    );
    const before = rows(s).length;
    s.run(app.bookBooking, {
      input: { title: "Taken", room: "Maple", date: "2026-10-13", start: 60, end: 120 },
    });
    assert.equal(
      throws(s, app.bookSeries, {
        title: "Nope",
        room: "Maple",
        date: "2026-10-06",
        start: 60,
        end: 120,
        weeks: 3,
      }).kind,
      "Clash",
    );
    assert.equal(rows(s).length, before + 1);
    s.run(app.cancelBooking, { input: { id: made[0].id } });
    assert.equal(rows(s).length, before);
    s.run(app.cancelSeries, { input: { seriesId: made[1].seriesId } });
    assert.equal(rows(s).filter((b) => b.seriesId === made[1].seriesId).length, 0);
    assert.equal(throws(s, app.cancelSeries, { seriesId: "gone" }).kind, "NotFound");
    return "series all-or-none, cancel one, cancel all";
  } finally {
    await s.close();
  }
});

core("core r3: invalid and blank dates BadDate, bad weeks BadCount", async () => {
  const s = coreMod.createScope();
  try {
    assert.equal(
      throws(s, app.bookBooking, {
        title: "X",
        room: "Cedar",
        date: "not-a-date",
        start: 60,
        end: 120,
      }).kind,
      "BadDate",
    );
    assert.equal(
      throws(s, app.bookBooking, { title: "X", room: "Cedar", date: "", start: 60, end: 120 }).kind,
      "BadDate",
    );
    assert.equal(
      throws(s, app.bookSeries, {
        title: "X",
        room: "Cedar",
        date: "2026-10-06",
        start: 60,
        end: 120,
        weeks: 0,
      }).kind,
      "BadCount",
    );
    return "BadDate and BadCount";
  } finally {
    await s.close();
  }
});

core("core regression: real year below 100 is valid", async () => {
  const s = coreMod.createScope();
  try {
    const saved = s.run(app.bookBooking, {
      input: { title: "Ancient", room: "Cedar", date: "0099-10-01", start: 540, end: 600 },
    });
    assert.equal(saved.date, "0099-10-01");
    return "0099-10-01";
  } finally {
    await s.close();
  }
});

core("core r4: undo book, cancel, series; failures add none", async () => {
  const s = coreMod.createScope();
  try {
    const size = rows(s).length;
    s.run(app.bookBooking, { input: { title: "Zed", room: "Maple", start: 700, end: 760 } });
    s.run(app.undoChange, {});
    assert.equal(rows(s).length, size);
    s.run(app.bookBooking, { input: { title: "Zed", room: "Maple", start: 700, end: 760 } });
    s.run(app.cancelBooking, { input: { id: rows(s).find((b) => b.title === "Zed").id } });
    s.run(app.undoChange, {});
    assert.ok(rows(s).some((b) => b.title === "Zed"));
    s.run(app.bookBooking, { input: { title: "A", room: "Cedar", start: 800, end: 860 } });
    assert.equal(
      throws(s, app.bookBooking, { title: "B", room: "Cedar", start: 820, end: 880 }).kind,
      "Clash",
    );
    s.run(app.undoChange, {});
    assert.ok(!rows(s).some((b) => b.title === "A"));
    const made = s.run(app.bookSeries, {
      input: { title: "Week", room: "Cedar", date: "2026-10-06", start: 60, end: 120, weeks: 3 },
    });
    s.run(app.undoChange, {});
    assert.equal(rows(s).filter((b) => b.seriesId === made[0].seriesId).length, 0);
    assert.ok(rows(s).some((b) => b.title === "Zed"));
    s.run(app.undoChange, {});
    assert.ok(!rows(s).some((b) => b.title === "Zed"));
    assert.equal(rows(s).length, size);
    assert.equal(throws(s, app.undoChange, {}).kind, "EmptyUndo");
    return "undo last, restore cancel, skip failure, empty at end";
  } finally {
    await s.close();
  }
});

core("core r4: empty undo reports EmptyUndo", async () => {
  const s = coreMod.createScope();
  try {
    assert.equal(throws(s, app.undoChange, {}).kind, "EmptyUndo");
    return "EmptyUndo on fresh scope";
  } finally {
    await s.close();
  }
});

core("core r4: undo preserves open draft", async () => {
  const s = coreMod.createScope();
  try {
    const a = s.run(app.bookBooking, { input: { title: "A", room: "Cedar", start: 60, end: 120 } });
    s.run(app.openEdit, { input: { id: a.id } });
    s.run(app.bookBooking, { input: { title: "B", room: "Maple", start: 60, end: 120 } });
    s.run(app.undoChange, {});
    assert.ok(!rows(s).some((b) => b.title === "B"));
    assert.equal(s.resolve(app.editDraft).id, a.id);
    return "draft survives undo";
  } finally {
    await s.close();
  }
});

core("core r4: undo restores exact prior list", async () => {
  const s = coreMod.createScope();
  try {
    const a = s.run(app.bookBooking, { input: { title: "A", room: "Cedar", start: 60, end: 120 } });
    s.run(app.openEdit, { input: { id: a.id } });
    s.run(app.saveEdit, { input: { id: a.id, title: "A2", room: "Cedar", start: 60, end: 120 } });
    s.run(app.undoChange, {});
    assert.deepStrictEqual(
      rows(s).map((b) => [b.id, b.title]),
      [[a.id, "A"]],
    );
    return "exact restore";
  } finally {
    await s.close();
  }
});

if (mode === "transfer") {
  core("core transfer: renameSeries exported", async () => {
    need(app.renameSeries, "renameSeries");
    return "renameSeries present";
  });

  const seriesFixture = async (s) => {
    s.run(app.bookBooking, { input: { title: "Solo", room: "Cedar", start: 60, end: 120 } });
    const made = s.run(app.bookSeries, {
      input: { title: "Alpha", room: "Cedar", date: "2026-10-06", start: 540, end: 600, weeks: 2 },
    });
    return { made, seriesId: made[0].seriesId };
  };

  core("core transfer: rename keeps ids and order, others untouched", async () => {
    const s = coreMod.createScope();
    try {
      need(app.renameSeries, "renameSeries");
      const { made, seriesId } = await seriesFixture(s);
      const renamed = s.run(app.renameSeries, { input: { seriesId, title: "  Gamma  " } });
      assert.equal(renamed.length, 2);
      assert.deepStrictEqual(
        renamed.map((b) => b.title),
        ["Gamma", "Gamma"],
      );
      assert.deepStrictEqual(
        renamed.map((b) => b.id),
        made.map((b) => b.id),
      );
      assert.ok(renamed.every((b) => b.seriesId === seriesId));
      assert.deepStrictEqual(
        renamed.map((b) => b.date),
        ["2026-10-06", "2026-10-13"],
      );
      assert.deepStrictEqual(
        renamed.map((b) => [b.room, b.start, b.end]),
        made.map((b) => [b.room, b.start, b.end]),
      );
      assert.deepStrictEqual(
        rows(s)
          .filter((b) => b.seriesId === seriesId)
          .map((b) => b.id),
        renamed.map((b) => b.id),
      );
      assert.equal(rows(s).find((b) => b.title === "Solo").title, "Solo");
      return "2 renamed in list order";
    } finally {
      await s.close();
    }
  });

  core("core transfer: blank title keeps original payload, saves nothing", async () => {
    const s = coreMod.createScope();
    try {
      need(app.renameSeries, "renameSeries");
      const { seriesId } = await seriesFixture(s);
      const before = rows(s).map((b) => ({ ...b }));
      const failed = throws(s, app.renameSeries, { seriesId, title: "   " });
      assert.equal(failed.kind, "BlankTitle");
      assert.equal(failed.payload.title, "   ");
      assert.deepStrictEqual(
        rows(s).map((b) => ({ ...b })),
        before,
      );
      s.run(app.undoChange, {});
      assert.ok(rows(s).some((b) => b.title === "Solo"));
      assert.ok(!rows(s).some((b) => b.title === "Alpha"));
      return "BlankTitle original text, no undo step";
    } finally {
      await s.close();
    }
  });

  core("core transfer: unknown series NotFound with id, saves nothing", async () => {
    const s = coreMod.createScope();
    try {
      need(app.renameSeries, "renameSeries");
      await seriesFixture(s);
      const before = rows(s).length;
      const failed = throws(s, app.renameSeries, { seriesId: "gone", title: "X" });
      assert.equal(failed.kind, "NotFound");
      assert.equal(failed.payload.id, "gone");
      assert.equal(rows(s).length, before);
      return "NotFound carries seriesId";
    } finally {
      await s.close();
    }
  });

  core("core transfer: rename is one undo step", async () => {
    const s = coreMod.createScope();
    try {
      need(app.renameSeries, "renameSeries");
      const { seriesId } = await seriesFixture(s);
      const before = rows(s).map((b) => ({ ...b }));
      s.run(app.renameSeries, { input: { seriesId, title: "Gamma" } });
      s.run(app.undoChange, {});
      assert.deepStrictEqual(
        rows(s).map((b) => ({ ...b })),
        before,
      );
      return "undo restores exact list";
    } finally {
      await s.close();
    }
  });

  core("core transfer: rename leaves open draft alone", async () => {
    const s = coreMod.createScope();
    try {
      need(app.renameSeries, "renameSeries");
      const { made, seriesId } = await seriesFixture(s);
      s.run(app.openEdit, { input: { id: made[0].id } });
      s.run(app.renameSeries, { input: { seriesId, title: "Gamma" } });
      const draft = s.resolve(app.editDraft);
      assert.equal(draft.id, made[0].id);
      assert.equal(draft.title, "Alpha");
      return "draft untouched";
    } finally {
      await s.close();
    }
  });

  core("core transfer: rename covers remaining occurrences only", async () => {
    const s = coreMod.createScope();
    try {
      need(app.renameSeries, "renameSeries");
      const made = s.run(app.bookSeries, {
        input: {
          title: "Alpha",
          room: "Cedar",
          date: "2026-10-06",
          start: 540,
          end: 600,
          weeks: 3,
        },
      });
      const seriesId = made[0].seriesId;
      s.run(app.cancelBooking, { input: { id: made[0].id } });
      const renamed = s.run(app.renameSeries, { input: { seriesId, title: "Gamma" } });
      assert.equal(renamed.length, 2);
      assert.deepStrictEqual(
        renamed.map((b) => b.date),
        ["2026-10-13", "2026-10-20"],
      );
      return "2 remaining renamed";
    } finally {
      await s.close();
    }
  });

  core("core transfer: rename in one scope leaves another alone", async () => {
    const a = coreMod.createScope();
    const b = coreMod.createScope();
    try {
      need(app.renameSeries, "renameSeries");
      const made = a.run(app.bookSeries, {
        input: {
          title: "Alpha",
          room: "Cedar",
          date: "2026-10-06",
          start: 540,
          end: 600,
          weeks: 2,
        },
      });
      b.run(app.bookBooking, { input: { title: "Other", room: "Cedar", start: 540, end: 600 } });
      a.run(app.renameSeries, { input: { seriesId: made[0].seriesId, title: "Gamma" } });
      assert.equal(rows(b).length, 1);
      assert.equal(rows(b)[0].title, "Other");
      return "scopes separate";
    } finally {
      await a.close();
      await b.close();
    }
  });
}

if (loadError) {
  for (const [name] of coreTests) {
    results.push({ name, pass: false, error: `load failed: ${loadError}`.slice(0, 300) });
  }
} else {
  for (const [name, fn] of coreTests) await test(name, fn);
}
await vite.close();

// ---- browser checks: real Chromium, fresh mounts ----
const server = await createServer({
  root,
  cacheDir: "/tmp/teacher-accept-browser",
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

browser("browser loads app", async (page) => {
  assert.ok(booted === "server listens", booted);
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Title", { exact: true }).waitFor();
  return "form shows";
});

const fillRoom = async (page, room) => {
  const field = page.getByLabel("Room", { exact: true });
  const tag = await field.evaluate((el) => el.tagName);
  if (tag === "SELECT") await field.selectOption({ label: room });
  else await field.fill(room);
};
const bookOne = async (page, title, room, start, end) => {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await fillRoom(page, room);
  await page.getByLabel("Start time", { exact: true }).fill(start);
  await page.getByLabel("End time", { exact: true }).fill(end);
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await page.getByRole("button", { name: `Cancel ${title}`, exact: true }).waitFor();
};
const cancel = (page, title) => page.getByRole("button", { name: `Cancel ${title}`, exact: true });

browser("browser r1: book, clash keeps form, filter preserves", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await bookOne(page, "Browser A", "Cedar", "09:00", "10:00");
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "");
  await page.getByLabel("Title", { exact: true }).fill("Browser clash");
  await fillRoom(page, "Cedar");
  await page.getByLabel("Start time", { exact: true }).fill("09:30");
  await page.getByLabel("End time", { exact: true }).fill("10:30");
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Clash" }).waitFor();
  assert.equal(await page.getByLabel("Title", { exact: true }).inputValue(), "Browser clash");
  assert.equal(await cancel(page, "Browser clash").count(), 0);
  await page.getByRole("button", { name: "Maple", exact: true }).click();
  await cancel(page, "Browser A").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await cancel(page, "Browser A").waitFor();
  await bookOne(page, "Beta", "Maple", "11:00", "12:00");
  return "save, failed form, filter preserves data";
});

browser("browser r2: switch drafts drops unsaved, discard, save", async (page) => {
  await page.getByRole("button", { name: "Edit Browser A", exact: true }).click();
  await page.getByLabel("Edit title", { exact: true }).fill("UNSAVED A");
  await page.getByRole("button", { name: "Edit Beta", exact: true }).click();
  assert.equal(await page.getByLabel("Edit title", { exact: true }).inputValue(), "Beta");
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await cancel(page, "Beta").waitFor();
  assert.equal(await cancel(page, "UNSAVED A").count(), 0);
  await page.getByRole("button", { name: "Edit Beta", exact: true }).click();
  await page.getByLabel("Edit title", { exact: true }).fill("Browser renamed");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await cancel(page, "Browser renamed").waitFor();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "hidden" });
  return "switch drops unsaved, discard and save";
});

browser("browser r2: failed save keeps draft open", async (page) => {
  try {
    await page.getByRole("button", { name: "Edit Browser A", exact: true }).click();
    await page.getByLabel("Edit start time", { exact: true }).fill("11:30");
    await page.getByLabel("Edit end time", { exact: true }).fill("12:30");
    await page.getByLabel("Edit room", { exact: true }).fill("Maple");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByLabel("Edit title", { exact: true }).waitFor();
    const alertText = await page
      .getByRole("alert")
      .innerText()
      .catch(() => "");
    assert.match(alertText, /Clash/, "failed save shows Clash");
    assert.equal(await page.getByLabel("Edit title", { exact: true }).inputValue(), "Browser A");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await cancel(page, "Browser A").waitFor();
    return "failed save keeps draft";
  } catch (error) {
    await page
      .getByRole("button", { name: "Discard", exact: true })
      .click()
      .catch(() => {});
    throw error;
  }
});

browser("browser r3: series create and cancel whole series", async (page) => {
  await page.getByLabel("Title", { exact: true }).fill("Browser series");
  await fillRoom(page, "Maple");
  await page.getByLabel("Date", { exact: true }).fill("2026-10-06");
  await page.getByLabel("Start time", { exact: true }).fill("11:00");
  await page.getByLabel("End time", { exact: true }).fill("12:00");
  await page.getByLabel("Weeks", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Book series", exact: true }).click();
  await cancel(page, "Browser series").nth(2).waitFor();
  assert.equal(await cancel(page, "Browser series").count(), 3);
  await page.getByRole("button", { name: "Cancel series", exact: true }).first().click();
  await cancel(page, "Browser series").first().waitFor({ state: "hidden" });
  assert.equal(await cancel(page, "Browser series").count(), 0);
  return "create and cancel whole series";
});

browser("browser regression: cleared Date is BadDate and saves nothing", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Title", { exact: true }).fill("BlankDate");
  await fillRoom(page, "Cedar");
  await page.getByLabel("Start time", { exact: true }).fill("09:00");
  await page.getByLabel("End time", { exact: true }).fill("10:00");
  await page.getByLabel("Date", { exact: true }).fill("");
  await page.getByRole("button", { name: "Book", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[role="alert"]')?.textContent?.includes("BadDate") ||
      Array.from(document.querySelectorAll("button")).some(
        (btn) => btn.textContent?.trim() === "Cancel BlankDate",
      ),
  );
  assert.equal(await cancel(page, "BlankDate").count(), 0);
  assert.match(await page.getByRole("alert").innerText(), /BadDate/);
  return "BadDate, nothing saved";
});

browser("browser r4: undo keeps draft text and filter choice", async (page) => {
  await page.goto("http://127.0.0.1:5173");
  await bookOne(page, "Undo A", "Cedar", "09:00", "10:00");
  await bookOne(page, "Undo B", "Maple", "11:00", "12:00");
  await bookOne(page, "Undo C", "Maple", "13:00", "14:00");
  await page.getByRole("button", { name: "Edit Undo A", exact: true }).click();
  await page.getByLabel("Edit title", { exact: true }).fill("Unsaved A");
  await page.getByRole("button", { name: "Maple", exact: true }).click();
  assert.equal(await cancel(page, "Undo A").count(), 0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await cancel(page, "Undo C").waitFor({ state: "hidden" });
  assert.equal(await cancel(page, "Undo B").count(), 1);
  assert.equal(await cancel(page, "Undo A").count(), 0);
  assert.equal(await page.getByLabel("Edit title", { exact: true }).inputValue(), "Unsaved A");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await cancel(page, "Undo A").waitFor();
  assert.equal(await cancel(page, "Undo B").count(), 1);
  assert.equal(await cancel(page, "Undo C").count(), 0);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "EmptyUndo" }).waitFor();
  return "undo data only, draft and filter kept";
});

if (mode === "transfer") {
  const bookSeries = async (page, title, room, date, start, end, weeks) => {
    await page.getByLabel("Title", { exact: true }).fill(title);
    await fillRoom(page, room);
    await page.getByLabel("Date", { exact: true }).fill(date);
    await page.getByLabel("Start time", { exact: true }).fill(start);
    await page.getByLabel("End time", { exact: true }).fill(end);
    await page.getByLabel("Weeks", { exact: true }).fill(weeks);
    await page.getByRole("button", { name: "Book series", exact: true }).click();
    await page
      .getByRole("button", { name: `Cancel ${title}`, exact: true })
      .nth(1)
      .waitFor();
  };
  const renameBtn = (page, title) =>
    page.getByRole("button", { name: `Rename series ${title}`, exact: true });
  const seriesTitle = (page) => page.getByLabel("Series title", { exact: true });

  browser("browser transfer: rename setup", async (page) => {
    await page.goto("http://127.0.0.1:5173");
    await bookOne(page, "Solo", "Cedar", "07:00", "08:00");
    await bookSeries(page, "Rone", "Cedar", "2026-10-06", "09:00", "10:00", "2");
    await bookSeries(page, "DoneA", "Maple", "2026-10-06", "11:00", "12:00", "2");
    await bookSeries(page, "DoneB", "Maple", "2026-10-06", "13:00", "14:00", "2");
    await bookSeries(page, "Alpha", "Cedar", "2026-10-06", "15:00", "16:00", "2");
    assert.equal(await renameBtn(page, "Rone").count(), 2);
    return "2 rows per series";
  });

  browser("browser transfer: save renames whole series only", async (page) => {
    await renameBtn(page, "Rone").first().click();
    assert.equal(await page.getByLabel("Series title", { exact: true }).count(), 1);
    assert.equal(await seriesTitle(page).inputValue(), "Rone");
    await seriesTitle(page).fill("Gamma");
    await page.getByRole("button", { name: "Save series title", exact: true }).click();
    await page.getByRole("button", { name: "Cancel Gamma", exact: true }).nth(1).waitFor();
    assert.equal(await page.getByLabel("Series title", { exact: true }).count(), 0);
    assert.equal(await cancel(page, "Gamma").count(), 2);
    assert.equal(await cancel(page, "Rone").count(), 0);
    assert.equal(await cancel(page, "Solo").count(), 1);
    assert.equal(await cancel(page, "DoneA").count(), 2);
    return "Gamma x2, Solo and DoneA untouched";
  });

  browser("browser transfer: blank save keeps editor and shows kind", async (page) => {
    await renameBtn(page, "Gamma").first().click();
    await seriesTitle(page).fill("   ");
    await page.getByRole("button", { name: "Save series title", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "BlankTitle" }).waitFor();
    assert.equal(await seriesTitle(page).inputValue(), "   ");
    assert.equal(await cancel(page, "Gamma").count(), 2);
    await page.getByRole("button", { name: "Discard series title", exact: true }).click();
    await page.getByLabel("Series title", { exact: true }).waitFor({ state: "hidden" });
    return "editor kept, BlankTitle shown";
  });

  browser("browser transfer: discard closes and changes nothing", async (page) => {
    await renameBtn(page, "Gamma").first().click();
    await seriesTitle(page).fill("Unsaved text");
    await page.getByRole("button", { name: "Discard series title", exact: true }).click();
    await page.getByLabel("Series title", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await cancel(page, "Gamma").count(), 2);
    assert.equal(await cancel(page, "Unsaved text").count(), 0);
    return "discard drops text";
  });

  browser("browser transfer: opening another series drops unsaved text", async (page) => {
    await renameBtn(page, "DoneA").first().click();
    await seriesTitle(page).fill("Unsaved text");
    await renameBtn(page, "DoneB").first().click();
    assert.equal(await seriesTitle(page).inputValue(), "DoneB");
    await page.getByRole("button", { name: "Discard series title", exact: true }).click();
    await page.getByLabel("Series title", { exact: true }).waitFor({ state: "hidden" });
    return "second series wins";
  });

  browser("browser transfer: editor seeds from clicked row", async (page) => {
    await page.getByRole("button", { name: "Edit Alpha", exact: true }).nth(1).click();
    await page.getByLabel("Edit title", { exact: true }).fill("Beta");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await renameBtn(page, "Beta").waitFor();
    await renameBtn(page, "Beta").click();
    assert.equal(await seriesTitle(page).inputValue(), "Beta");
    await page.getByRole("button", { name: "Discard series title", exact: true }).click();
    await page.getByLabel("Series title", { exact: true }).waitFor({ state: "hidden" });
    return "Series title is Beta";
  });
}

browser("browser: two roots on one page share nothing", async (page) => {
  try {
    await page.goto("http://127.0.0.1:5173");
    await page.getByLabel("Title", { exact: true }).waitFor();
    await page.evaluate(async () => {
      const paths = performance.getEntriesByType("resource").map((r) => new URL(r.name).pathname);
      const pick = (...subs) => paths.find((p) => subs.every((s) => p.includes(s)));
      const clientPath =
        pick("react-dom", "client") ?? "/node_modules/.vite/deps/react-dom_client.js";
      const rootPath =
        pick("_react@", "/react@") ?? pick("react") ?? "/node_modules/.vite/deps/react.js";
      let appMod;
      for (const entry of ["/src/index.ts", "/src/index.tsx"]) {
        try {
          appMod = await import(entry);
          break;
        } catch {}
      }
      if (!appMod?.BookingApp) throw new Error("cannot import submission entry");
      const clientMod = await import(clientPath);
      const jsxMod = await import("/@id/__x00__react/jsx-runtime").catch(() => null);
      const interop = (m) => m?.default ?? m;
      let jsx =
        jsxMod?.jsx ?? jsxMod?.jsxs ?? interop(jsxMod)?.jsx ?? interop(clientMod)?.createElement;
      if (typeof jsx !== "function") {
        const probe = await import("react/jsx-runtime").catch(() => null);
        jsx = probe?.jsx ?? probe?.jsxs ?? interop(probe)?.jsx;
      }
      if (typeof jsx !== "function") {
        const cands = paths
          .filter((p) => p.includes("jsx-runtime") || p.includes("react"))
          .slice(0, 8);
        for (const cand of cands) {
          try {
            const mod = await import(cand);
            jsx = mod.jsx ?? mod.jsxs ?? interop(mod)?.jsx ?? interop(mod)?.createElement;
            if (typeof jsx === "function") break;
          } catch {}
        }
      }
      if (typeof jsx !== "function") throw new Error(`cannot load jsx runtime from ${clientPath}`);
      const createRoot = clientMod.createRoot ?? clientMod.default?.createRoot ?? clientMod.default;
      if (typeof createRoot !== "function")
        throw new Error(
          `cannot load createRoot from ${clientPath}: ${Object.keys(clientMod).slice(0, 8).join(",")}`,
        );
      const holder = document.createElement("div");
      holder.id = "teacher-second-root";
      document.body.appendChild(holder);
      createRoot(holder).render(jsx(appMod.BookingApp));
    });
    const secondScope = page.locator("#teacher-second-root");
    await secondScope.waitFor({ state: "attached" });
    // Labels use `for` without an accessible-name link in one repair; fall
    // back to positional inputs inside the second root so a missing link
    // is a lead-review note, never a false isolation failure.
    let secondTitle = secondScope.getByLabel("Title", { exact: true });
    if ((await secondTitle.count()) === 0) secondTitle = secondScope.locator("input").first();
    let secondRoom = secondScope.getByLabel("Room", { exact: true });
    if ((await secondRoom.count()) === 0) secondRoom = secondScope.locator("input").nth(1);
    let secondStart = secondScope.getByLabel("Start time", { exact: true });
    if ((await secondStart.count()) === 0) secondStart = secondScope.locator("input").nth(3);
    let secondEnd = secondScope.getByLabel("End time", { exact: true });
    if ((await secondEnd.count()) === 0) secondEnd = secondScope.locator("input").nth(4);
    await secondTitle.waitFor({ state: "visible" });
    await secondTitle.fill("Root Two");
    await secondRoom.fill("Cedar");
    await secondStart.fill("09:00");
    await secondEnd.fill("10:00");
    await page
      .locator("#teacher-second-root")
      .getByRole("button", { name: "Book", exact: true })
      .click();
    await page
      .locator("#teacher-second-root")
      .getByRole("button", { name: "Cancel Root Two", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator("#root")
        .getByRole("button", { name: "Cancel Root Two", exact: true })
        .count(),
      0,
    );
    return "two roots on one page separate";
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
  if (!results.some((r) => r.name.startsWith("browser"))) {
    for (const [name] of browserTests) results.push({ name, pass: false, error: message });
  } else {
    for (const [name] of browserTests) {
      if (!results.some((r) => r.name === name))
        results.push({ name, pass: false, error: message });
    }
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
console.log(`ACCEPTANCE ${mode}: ${results.length - failed.length}/${results.length} pass`);
process.exitCode = failed.length ? 1 : 0;
