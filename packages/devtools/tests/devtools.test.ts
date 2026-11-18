import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createScope, data, operation, resource, transport } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { devtools, type Devtools } from "@/index";

const boom = new Error("boom");
const plain = operation({ label: "plain", run: () => 1 });

const failing = operation({
  label: "failing",
  run: () => {
    throw boom;
  },
});

const found = operation({ label: "found", run: () => ({ kind: "found" }) });
const alpha = operation({ label: "alpha", run: () => 1 });
const beta = operation({ label: "beta", run: () => 2 });

const denied = operation({
  label: "denied",
  depends: { flow: transport.lifecycle },
  run: ({ flow }) => flow.refuse({ signIn: true }),
});

const count = data({ label: "count", initial: 0 });

const broken = resource({
  label: "broken",
  factory: () => {
    throw boom;
  },
});

const useBroken = operation({
  label: "useBroken",
  depends: { broken },
  run: ({ broken }) => broken,
});

const noted = operation({
  label: "noted",
  run: (_deps, ctx) => {
    ctx.obs.event("hit", { n: 1 });
    return { kind: "found" };
  },
});

const cycle: { self?: object } = {};
cycle.self = cycle;

/** One operation per thrown value that is not an Error. */
const oddThrows = ["nope", { code: 1 }, 10n, cycle].map((value, n) =>
  operation({
    label: `odd${n}`,
    run: () => {
      throw value;
    },
  }),
);

const [one, two, three, four, five] = ["one", "two", "three", "four", "five"].map((label) =>
  operation({ label, run: () => 1 }),
);

/** A devtools capsule on a started scope. */
async function started(options?: Devtools.Options) {
  const dt = devtools(options);
  const scope = await createScope({ capsules: [dt] }).ready;
  return { dt, scope };
}

test("the scope state goes starting, ready, closing, closed, and ends success", async () => {
  const dt = devtools();
  const states: string[] = [];
  dt.moves(() => void states.push(dt.snapshot().scope.state));
  expect(dt.snapshot().scope).toStrictEqual({ state: "starting" });

  const scope = await createScope({ capsules: [dt] }).ready;
  await scope.close({ graceful: true });

  expect(states).toEqual(["starting", "ready", "closing", "closed"]);
  expect(dt.snapshot().scope).toEqual({ state: "closed", status: "success" });
});

test("the scope lists devtools under the label tinker.devtools", async () => {
  const { scope } = await started();

  expect(scope.capsules.map((record) => record.label)).toEqual(["tinker.devtools"]);
  await scope.close();
});

test("an operation run outside any session lands in runs", async () => {
  const { dt, scope } = await started();

  scope.run(plain);

  expect(dt.snapshot().runs.map((span) => span.name)).toEqual(["plain"]);
  await scope.close();
});

test("runs in a session and in a nested one land under that session, by id", async () => {
  const { dt, scope } = await started();
  const ids: (number | undefined)[] = [];

  await scope.session(async (outer) => {
    ids.push(outer.id);
    outer.run(alpha);
    await outer.session((nested) => {
      ids.push(nested.id);
      nested.run(beta);
    });
  });

  const { sessions, runs } = dt.snapshot();
  expect(sessions.map((session) => session.id)).toEqual(ids);
  expect(sessions.map((session) => session.runs.map((span) => span.name))).toEqual([
    ["alpha"],
    ["beta"],
  ]);
  expect(sessions.map((session) => session.status)).toEqual(["success", "success"]);
  expect(runs).toEqual([]);
  await scope.close();
});

test("a session shows open while it runs, then closed with its status", async () => {
  const { dt, scope } = await started();
  let during: Devtools.Session[] = [];

  const id = await scope.session((session) => {
    during = dt.snapshot().sessions;
    return session.id;
  });

  expect(during).toStrictEqual([{ id, state: "open", runs: [] }]);
  expect(dt.snapshot().sessions).toStrictEqual([
    { id, state: "closed", status: "success", runs: [] },
  ]);
  await scope.close();
});

test("a session whose function throws ends failed", async () => {
  const { dt, scope } = await started();
  const failure = new Error("session boom");

  await expect(
    scope.session(() => {
      throw failure;
    }),
  ).rejects.toBe(failure);

  expect(dt.snapshot().sessions.map((session) => session.status)).toEqual(["failed"]);
  await scope.close();
});

test("the session list keeps at most limit, dropping the oldest closed first", async () => {
  const { dt, scope } = await started({ limit: 2 });
  const ids: (number | undefined)[] = [];

  await scope.session(async (open) => {
    ids.push(open.id);
    await open.session((closed) => void ids.push(closed.id));
    await open.session((last) => void ids.push(last.id));
  });

  const [open, , last] = ids;
  expect(dt.snapshot().sessions.map((session) => session.id)).toEqual([open, last]);
  await scope.close();
});

test("with no closed session, the list drops the oldest open one, and its runs leave the snapshot", async () => {
  const { dt, scope } = await started({ limit: 2 });
  const ids: (number | undefined)[] = [];

  await scope.session(async (first) => {
    first.run(alpha);
    await first.session(async (second) => {
      ids.push(second.id);
      await second.session((third) => {
        ids.push(third.id);
        third.run(beta);
      });
    });
  });

  const { sessions, runs } = dt.snapshot();
  expect(
    sessions.map((session) => [session.id, session.status, session.runs.map((span) => span.name)]),
  ).toEqual([
    [ids[0], "success", []],
    [ids[1], "success", ["beta"]],
  ]);
  expect(runs).toEqual([]);
  await scope.close();
});

test("a resource whose factory throws is a failed span in resources", async () => {
  const { dt, scope } = await started();

  scope.settle(useBroken);

  const [span] = dt.snapshot().resources;
  expect(span?.name).toBe("broken");
  expect(span?.status).toBe("failed");
  await scope.close();
});

test("a failed operation keeps its error as text, since an Error is {} in JSON", async () => {
  const { dt, scope } = await started();

  scope.settle(failing);

  const [span] = dt.snapshot().runs;
  expect(span?.status).toBe("failed");
  expect(span?.error).toBe("Error: boom");
  await scope.close();
});

test("a thrown value that is not an Error is kept as its JSON, or as its type if JSON fails", async () => {
  const { dt, scope } = await started();

  for (const op of oddThrows) scope.settle(op);

  expect(dt.snapshot().runs.map((span) => span.error)).toEqual([
    '"nope"',
    '{"code":1}',
    "bigint",
    "object",
  ]);
  await scope.close();
});

test("a failed run counts no exit", async () => {
  const { dt, scope } = await started();

  scope.settle(failing);

  expect(dt.snapshot().exits).toEqual({});
  await scope.close();
});

test("an answer with a kind counts that kind; a plain value counts as value", async () => {
  const { dt, scope } = await started();

  scope.run(found);
  scope.run(plain);

  expect(dt.snapshot().exits).toEqual({ "found\tfound": 1, "plain\tvalue": 1 });
  await scope.close();
});

test("a refusal counts as refused", async () => {
  const { dt, scope } = await started();

  scope.run(denied);

  expect(dt.snapshot().exits).toEqual({ "denied\trefused": 1 });
  await scope.close();
});

test("the span ring keeps the newest limit spans, and exits still count every run", async () => {
  const { dt, scope } = await started({ limit: 3 });

  for (const op of [one, two, three, four, five]) scope.run(op);

  expect(dt.snapshot().runs.map((span) => span.name)).toEqual(["three", "four", "five"]);
  expect(dt.snapshot().exits).toEqual({
    "one\tvalue": 1,
    "two\tvalue": 1,
    "three\tvalue": 1,
    "four\tvalue": 1,
    "five\tvalue": 1,
  });
  await scope.close();
});

test("a write lands and counts by its cell label, with no value by default", async () => {
  const { dt, scope } = await started();

  scope.controller(count).set(1);
  scope.controller(count).set(2);

  expect(scope.controller(count).get()).toBe(2);
  expect(dt.snapshot().writes).toStrictEqual([{ label: "count", count: 2 }]);
  await scope.close();
});

test("with values on, a write keeps the last value", async () => {
  const { dt, scope } = await started({ values: true });

  scope.controller(count).set(1);
  scope.controller(count).set(2);

  expect(dt.snapshot().writes).toStrictEqual([{ label: "count", count: 2, value: 2 }]);
  await scope.close();
});

test("a moves listener is told once per record, and unsubscribing stops it", async () => {
  const { dt, scope } = await started();
  let told = 0;
  const stop = dt.moves(() => {
    told += 1;
  });

  scope.run(plain);
  expect(told).toBe(1);
  await scope.session(() => {});
  expect(told).toBe(3);
  scope.controller(count).set(1);
  expect(told).toBe(4);

  stop();
  scope.run(plain);
  expect(told).toBe(4);
  await scope.close();
});

/**
 * Runs in a child process: the listener's error is rethrown in a microtask, which the test
 * runner would count as its own failure. The child catches it as the host does.
 */
test("a listener that throws does not stop the run or the other listeners", async () => {
  const script = `
    import { createScope, operation } from "@tinkered/core";
    import { devtools } from "@tinkered/devtools";
    const reported = [];
    process.on("uncaughtException", (error) => reported.push(String(error)));
    const plain = operation({ label: "plain", run: () => 1 });
    const dt = devtools();
    const scope = await createScope({ capsules: [dt] }).ready;
    let told = 0;
    dt.moves(() => {
      throw new Error("boom");
    });
    dt.moves(() => {
      told += 1;
    });
    const result = scope.run(plain);
    await new Promise(setImmediate);
    console.log(JSON.stringify({ result, told, reported }));
  `;

  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", script],
    { cwd: fileURLToPath(new URL("..", import.meta.url)) },
  );

  expect(JSON.parse(stdout.trim())).toEqual({ result: 1, told: 1, reported: ["Error: boom"] });
});

test("the snapshot survives a JSON round trip unchanged", async () => {
  const { dt, scope } = await started({ values: true });
  scope.run(found);
  scope.settle(useBroken);
  scope.controller(count).set(1);

  const snapshot = dt.snapshot();

  expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  await scope.close();
});

const spanFields = new Set([
  "id",
  "parentId",
  "traceId",
  "spanId",
  "parentSpanId",
  "sampled",
  "name",
  "kind",
  "start",
  "end",
  "status",
  "error",
  "attributes",
  "events",
]);

/** The keys of `record` whose value is `undefined`. */
function undefinedKeys(record: object): string[] {
  return Object.entries(record)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
}

test("a snapshot span holds only span fields, with W3C ids, and no key is set to undefined", async () => {
  const { dt, scope } = await started();
  await scope.session((session) => {
    session.run(plain);
  });
  scope.run(found);
  scope.settle(useBroken);
  scope.controller(count).set(1);

  const snapshot = dt.snapshot();
  const spans = [
    ...snapshot.runs,
    ...snapshot.resources,
    ...snapshot.sessions.flatMap((session) => session.runs),
  ];

  expect(spans.length).toBeGreaterThan(0);
  for (const span of spans) {
    expect(Object.keys(span).filter((key) => !spanFields.has(key))).toStrictEqual([]);
    expect(typeof span.traceId).toBe("string");
    expect(typeof span.spanId).toBe("string");
  }
  const ok = spans.filter((span) => span.status === "ok");
  expect(ok.length).toBeGreaterThan(0);
  expect(ok.filter((span) => "error" in span)).toStrictEqual([]);
  expect(undefinedKeys(snapshot.scope)).toStrictEqual([]);
  expect(snapshot.sessions.flatMap(undefinedKeys)).toStrictEqual([]);
  expect(snapshot.writes.flatMap(undefinedKeys)).toStrictEqual([]);
  await scope.close();
});

test("a snapshot span keeps its attributes and its events", async () => {
  const { dt, scope } = await started();

  const id = await scope.session((session) => {
    session.run(noted);
    return session.id;
  });

  const span = dt.snapshot().sessions[0]?.runs[0];
  expect(span?.attributes).toStrictEqual({ "session.id": id, "tinker.exit": "found" });
  expect(span?.events).toStrictEqual([
    { name: "hit", time: expect.any(Number), attributes: { n: 1 } },
  ]);
  await scope.close();
});

test("changing a snapshot changes nothing devtools keeps", async () => {
  const { dt, scope } = await started();
  scope.run(plain);

  const taken = dt.snapshot();
  const [kept] = taken.runs;
  kept.attributes.changed = true;
  taken.runs.length = 0;
  taken.exits["plain\tvalue"] = 99;

  expect(dt.snapshot().runs.map((span) => span.name)).toEqual(["plain"]);
  expect(dt.snapshot().exits).toEqual({ "plain\tvalue": 1 });
  expect(dt.snapshot().runs[0]?.attributes).not.toHaveProperty("changed");
  await scope.close();
});
