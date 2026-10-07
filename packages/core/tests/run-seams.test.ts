import { expect, test } from "vite-plus/test";
import { createScope, extension, isError, operation, resource, tag } from "../src/index";

/** Seams the run side must keep; each one failed under a surviving mutant of the run-side cuts. */
const zone = tag<string>({ label: "zone", default: "base" });

test("a cached controller refuses a tagged run once its scope closed", async () => {
  const op = operation({ label: "op", run: () => 1 });
  const scope = createScope();
  const controller = scope.controller(op);
  await scope.close();
  const out = controller.run({ tags: [zone("x")] });
  expect(out instanceof Promise).toBe(true);
  try {
    await out;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("a cached controller refuses an untagged run once its scope closed", async () => {
  const op = operation({ label: "op", run: () => 1 });
  const scope = createScope();
  const controller = scope.controller(op);
  await scope.close();
  try {
    controller.run();
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
});

test("a tagged sync run that raises a managed error rejects with it", async () => {
  const required = tag<string>({ label: "required" });
  const op = operation({ label: "needs", depends: { required }, run: ({ required }) => required });
  const out = createScope().run(op, { tags: [zone("x")] });
  expect(out instanceof Promise).toBe(true);
  try {
    await out;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
  }
});

test("a run's borrow is released after its sync defer, so a release and a close do not wait on it", async () => {
  let cleaned = 0;
  const conn = resource({ label: "conn", factory: () => "c" });
  const op = operation({
    label: "use",
    depends: { conn },
    run: ({ conn }, ctx) => {
      ctx.defer(() => {
        cleaned++;
      });
      return conn;
    },
  });
  const scope = createScope();
  expect(scope.run(op)).toBe("c");
  expect(cleaned).toBe(1);
  scope.release(conn);
  expect(scope.run(op)).toBe("c");
  expect((await scope.close()).status).toBe("cancelled");
});

test("more than eight bindings on one layer: nearest wins and .all keeps authored order, newest first", () => {
  const many = tag<number>({ label: "many" });
  const bindings = Array.from({ length: 10 }, (_, i) => many(i));
  const scope = createScope({ tags: bindings });
  const nearest = operation({ label: "nearest", depends: { many }, run: ({ many }) => many });
  const all = operation({ label: "all", depends: { all: many.all }, run: ({ all }) => all });
  expect(scope.run(nearest)).toBe(9);
  expect(scope.run(all)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
});

test(".all reads a handful of bindings across layers, nearest layer first, newest first", () => {
  const few = tag<string>({ label: "few" });
  const all = operation({ label: "all", depends: { all: few.all }, run: ({ all }) => all });
  const scope = createScope({ tags: [few("r1"), few("r2"), few("r3")] });
  const session = scope.createSession({ tags: [few("s1"), few("s2")] });
  expect(session.run(all)).toEqual(["s2", "s1", "r3", "r2", "r1"]);
  expect(scope.run(all)).toEqual(["r3", "r2", "r1"]);
});

test("a closed scope with session hooks refuses a new session", async () => {
  let seen = 0;
  const scope = createScope({
    extensions: [
      extension({
        label: "hook",
        hooks: {
          session: async (event) => {
            seen++;
            return event.next();
          },
        },
      }),
    ],
  });
  await scope.ready;
  await scope.close();
  try {
    await scope.session(() => 1);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "Disposed")) throw error;
  }
  expect(seen).toBe(0);
});
