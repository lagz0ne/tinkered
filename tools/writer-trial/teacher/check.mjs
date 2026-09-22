import assert from "node:assert/strict";
import { createServer } from "vite-plus";

const submission = process.argv[2];
assert.ok(submission, "usage: check.mjs <submission-dir> [round]");
const round = Number(process.argv[3] ?? "4");
assert.ok(Number.isInteger(round) && round >= 1 && round <= 4, "round is 1-4");

const vite = await createServer({
  root: submission,
  configFile: false,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "silent",
});
let scope;
try {
  const app = await vite.ssrLoadModule("/src/index.ts");
  const core = await vite.ssrLoadModule("@tinker/core");
  scope = core.createScope();

  const expectThrow = (fn, kind) => {
    try {
      fn();
    } catch (error) {
      assert.equal(error && error.kind, kind, `want ${kind}`);
      return error;
    }
    assert.fail(`want throw ${kind}`);
  };
  const rows = () => scope.resolve(app.bookings);

  // Round 1: book and cancel.
  assert.deepStrictEqual([...app.rooms], ["Cedar", "Maple"]);
  const one = scope.run(app.bookBooking, {
    input: { title: "Standup", room: "Cedar", start: 540, end: 600 },
  });
  assert.equal(typeof one.id, "string");
  assert.equal(rows().length, 1);
  expectThrow(
    () =>
      scope.run(app.bookBooking, {
        input: { title: "B", room: "Cedar", start: 570, end: 630 },
      }),
    "Clash",
  );
  assert.equal(rows().length, 1);
  const cross = scope.run(app.bookBooking, {
    input: { title: "C", room: "Maple", start: 570, end: 630 },
  });
  assert.equal(cross.room, "Maple");
  scope.run(app.cancelBooking, { input: { id: one.id } });
  expectThrow(() => scope.run(app.cancelBooking, { input: { id: one.id } }), "NotFound");
  const freed = scope.run(app.bookBooking, {
    input: { title: "D", room: "Cedar", start: 540, end: 600 },
  });
  assert.equal(freed.title, "D");
  console.log("r1 ok: book, clash, cancel, free slot");

  if (round >= 2) {
    // Round 2: draft edit, failed save keeps both.
    const target = scope.run(app.bookBooking, {
      input: { title: "E", room: "Maple", start: 60, end: 120 },
    });
    const draft = scope.run(app.openEdit, { input: { id: target.id } });
    assert.equal(draft.title, "E");
    expectThrow(
      () =>
        scope.run(app.saveEdit, {
          input: {
            id: target.id,
            title: "E",
            room: "Maple",
            start: 570,
            end: 630,
          },
        }),
      "Clash",
    );
    assert.equal(rows().find((b) => b.id === target.id).start, 60);
    assert.equal(scope.resolve(app.editDraft).id, target.id);
    const kept = scope.run(app.saveEdit, {
      input: {
        id: target.id,
        title: "Renamed",
        room: "Maple",
        start: 60,
        end: 120,
      },
    });
    assert.equal(kept.title, "Renamed");
    assert.strictEqual(scope.resolve(app.editDraft), undefined);
    console.log("r2 ok: edit save, clash keeps both");
  }

  if (round >= 3) {
    // Round 3: series books all dates or none.
    const solo = scope.run(app.bookBooking, {
      input: { title: "Solo", room: "Cedar", start: 60, end: 120 },
    });
    assert.equal(solo.date, "2026-10-01");
    const made = scope.run(app.bookSeries, {
      input: {
        title: "Standup",
        room: "Cedar",
        date: "2026-10-06",
        start: 60,
        end: 120,
        weeks: 3,
      },
    });
    assert.deepStrictEqual(
      made.map((b) => b.date),
      ["2026-10-06", "2026-10-13", "2026-10-20"],
    );
    const before = rows().length;
    scope.run(app.bookBooking, {
      input: {
        title: "Taken",
        room: "Maple",
        date: "2026-10-13",
        start: 60,
        end: 120,
      },
    });
    expectThrow(
      () =>
        scope.run(app.bookSeries, {
          input: {
            title: "Nope",
            room: "Maple",
            date: "2026-10-06",
            start: 60,
            end: 120,
            weeks: 3,
          },
        }),
      "Clash",
    );
    assert.equal(rows().length, before + 1);
    scope.run(app.cancelBooking, { input: { id: made[0].id } });
    assert.equal(rows().length, before);
    scope.run(app.cancelSeries, { input: { seriesId: made[1].seriesId } });
    assert.equal(rows().filter((b) => b.seriesId === made[1].seriesId).length, 0);
    console.log("r3 ok: series all-or-none, cancel one, cancel all");
  }

  if (round >= 4) {
    // Round 4: undo pops one change; failures add none.
    const size = rows().length;
    scope.run(app.bookBooking, {
      input: { title: "Zed", room: "Maple", start: 700, end: 760 },
    });
    scope.run(app.undoChange, {});
    assert.equal(rows().length, size);
    scope.run(app.bookBooking, {
      input: { title: "Zed", room: "Maple", start: 700, end: 760 },
    });
    scope.run(app.cancelBooking, {
      input: { id: rows().find((b) => b.title === "Zed").id },
    });
    scope.run(app.undoChange, {});
    assert.ok(rows().some((b) => b.title === "Zed"));
    scope.run(app.bookBooking, {
      input: { title: "A", room: "Cedar", start: 800, end: 860 },
    });
    expectThrow(
      () =>
        scope.run(app.bookBooking, {
          input: { title: "B", room: "Cedar", start: 820, end: 880 },
        }),
      "Clash",
    );
    scope.run(app.undoChange, {});
    assert.ok(!rows().some((b) => b.title === "A"));
    console.log("r4 ok: undo last, restore cancel, skip failure");
  }

  console.log(`teacher check round ${round}: pass`);
} finally {
  try {
    await scope?.close();
  } finally {
    await vite.close();
  }
}
