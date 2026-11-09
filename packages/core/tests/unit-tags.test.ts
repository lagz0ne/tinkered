import { expect, test } from "vite-plus/test";

// ADR 0129 decision 2: units carry tags as fixed facts.
import { capsule, createScope, data, operation, resource, tag } from "@/index";

const effect = tag<"db" | "net" | "fs" | "clock">({ label: "tinker.effect" });
const raises = tag<readonly string[]>({ label: "tinker.raises" });
const entry = tag<string>({ label: "http.route" });
const token = tag<string>({ label: "auth.token", secret: true });

const db = resource({
  label: "database.transaction",
  tags: [effect("db")],
  factory: () => ({ rows: [{ id: "t1", status: "asked" }] }),
});

const seen = data({ label: "task.seen", initial: 0, tags: [effect("clock")] });

const taskCancel = operation({
  label: "hedl.task.cancel",
  tags: [raises(["refused"]), token("never-on-span")],
  depends: { db },
  run: ({ db: tx }, { raise }) => tx.rows[0] ?? raise("refused", { message: "no task" }),
});

/** Declares only "refused", but raises "NotFound". */
const sloppy = operation({
  label: "hedl.task.sloppy",
  tags: [raises(["refused"])],
  run: (_deps, { raise }) => raise("NotFound", {}),
});

const route = operation({
  label: "transport.tasksCancel",
  tags: [entry("POST /p/{project}/api/tasks/{id}/cancel")],
  depends: { cancel: taskCancel.controller },
  run: ({ cancel }) => cancel.run(),
});

const plain = operation({ label: "plain", run: () => 1 });

/** A run hook reads the op's facts: a raised kind it does not declare is a finding. */
function faultsCheck() {
  const breaks: string[] = [];
  const faults = capsule({
    label: "faults",
    hooks: {
      async run(event) {
        const declared = event.op.tags?.find((b) => b.tag === raises)?.value as
          | readonly string[]
          | undefined;

        try {
          return await event.next();
        } catch (error) {
          const kind = error instanceof Error && "kind" in error ? String(error.kind) : "";
          if (declared !== undefined && !declared.includes(kind)) {
            breaks.push(`${event.op.label} raised ${kind}, declares ${declared.join("|")}`);
          }

          throw error;
        }
      },
    },
  });

  return { breaks, faults };
}

test("a unit keeps its tags as fixed facts a tool can read without a scope", () => {
  expect(db.tags.map((b) => [b.tag.label, b.value])).toEqual([["tinker.effect", "db"]]);
  expect(seen.tags.map((b) => b.value)).toEqual(["clock"]);
  expect(route.tags[0]?.value).toBe("POST /p/{project}/api/tasks/{id}/cancel");
});

test("a unit with no tags holds an empty list", () => {
  expect(plain.tags).toEqual([]);
});

test("each tag lands on the unit's span; a secret tag does not", async () => {
  const live = createScope({ observe: { history: 50 } });

  await live.run(route);

  const spans = live.spans().map((s) => ({ name: s.name, attributes: s.attributes }));
  expect(spans.find((s) => s.name === "transport.tasksCancel")?.attributes).toMatchObject({
    "http.route": "POST /p/{project}/api/tasks/{id}/cancel",
  });
  expect(spans.find((s) => s.name === "database.transaction")?.attributes).toMatchObject({
    "tinker.effect": "db",
  });

  const cancel = spans.find((s) => s.name === "hedl.task.cancel")?.attributes ?? {};
  expect(cancel["tinker.raises"]).toEqual(["refused"]);
  expect("auth.token" in cancel).toBe(false);
  await live.close();
});

test("a run hook reads the op's tags", async () => {
  const { breaks, faults } = faultsCheck();
  const live = await createScope({ capsules: [faults] }).ready;

  await live.settle(sloppy);

  expect(breaks).toEqual(["hedl.task.sloppy raised NotFound, declares refused"]);
  await live.close();
});

test("an inline op has no tags", async () => {
  const kinds: unknown[] = [];
  const watch = capsule({
    label: "watch",
    hooks: {
      run(event) {
        kinds.push(event.op.tags);
        return event.next();
      },
    },
  });
  const live = await createScope({ capsules: [watch] }).ready;

  live.run({ run: () => 1 });

  expect(kinds).toEqual([undefined]);
  await live.close();
});
