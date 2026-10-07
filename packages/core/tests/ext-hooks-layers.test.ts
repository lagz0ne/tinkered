import { expect, test } from "vite-plus/test";
import { createScope, data, extension, namespace, operation, tag } from "../src/index";

test("a tagged run invokes its hook once with the original call", async () => {
  const zone = tag({ label: "zone", default: "base" });
  const op = operation({ label: "op", depends: { zone }, run: ({ zone }) => zone });
  const seen: unknown[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        hooks: {
          run: (event) => {
            seen.push(event.call);
            return event.next();
          },
        },
      }),
    ],
  });
  const call = { tags: zone("west") };
  expect(await scope.run(op, call)).toBe("west");
  expect(seen).toEqual([call]);
  await scope.close();
});

test("a subflow run invokes its hook once", async () => {
  const child = operation({ label: "child", run: () => 3 });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run(),
  });
  const seen: string[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        hooks: {
          run: (event) => {
            seen.push(event.op.label ?? "inline");
            return event.next();
          },
        },
      }),
    ],
  });
  expect(scope.run(parent)).toBe(3);
  expect(seen).toEqual(["parent", "child"]);
  await scope.close();
});

test("a tagged run in a session invokes its hook once", async () => {
  const zone = tag({ label: "zone", default: "base" });
  const op = operation({ label: "op", depends: { zone }, run: ({ zone }) => zone });
  const seen: unknown[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        hooks: {
          run: (event) => {
            seen.push(event.call);
            return event.next();
          },
        },
      }),
    ],
  });
  const call = { tags: zone("west") };
  expect(await scope.session((session) => session.run(op, call))).toBe("west");
  expect(seen).toEqual([call]);
  await scope.close();
});

test("an inline run in a session invokes its hook with the inline config", async () => {
  const inline = { run: () => 4 };
  const seen: unknown[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        hooks: {
          run: (event) => {
            seen.push(event.op);
            return event.next();
          },
        },
      }),
    ],
  });
  expect(await scope.session((session) => session.run(inline))).toBe(4);
  expect(seen).toEqual([inline]);
  await scope.close();
});

test("a run hook that skips next stops a subflow with its substitute", async () => {
  let ran = false;
  const child = operation({
    label: "child",
    run: () => {
      ran = true;
      return "ran";
    },
  });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run(),
  });
  const scope = createScope({
    extensions: [
      extension({
        label: "deny",
        hooks: {
          run: (event) =>
            "label" in event.op && event.op.label === "child" ? "denied" : event.next(),
        },
      }),
    ],
  });
  expect(scope.run(parent)).toBe("denied");
  expect(ran).toBe(false);
  await scope.close();
});

test("a run hook that throws stops a subflow before its body", async () => {
  const cause = new Error("denied");
  let ran = false;
  const child = operation({
    label: "child",
    run: () => {
      ran = true;
      return 1;
    },
  });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run(),
  });
  const scope = createScope({
    extensions: [
      extension({
        label: "deny",
        hooks: {
          run: (event) => {
            if (event.op.label === "child") throw cause;
            return event.next();
          },
        },
      }),
    ],
  });
  expect(() => scope.run(parent)).toThrow(cause);
  expect(ran).toBe(false);
  await scope.close();
});

test("an async run hook keeps a dropped subflow's rejection on the scope", async () => {
  const cause = new Error("boom");
  const boom = operation({
    label: "boom",
    run: async () => {
      throw cause;
    },
  });
  const drop = operation({
    label: "drop",
    depends: { boom },
    run: async ({ boom }) => {
      void boom.run();
      return "dropped";
    },
  });
  const gate = extension({
    label: "gate",
    hooks: {
      run: async (event) => event.next(),
    },
  });
  const scope = createScope({ extensions: [gate] });
  await scope.ready;
  expect(await scope.run(drop)).toBe("dropped");
  expect(await scope.close()).toMatchObject({ status: "failed", error: cause });
});

test("a namespaced write invokes its hook once", async () => {
  const cell = data({ initial: 0 });
  const east = namespace();
  const seen: unknown[] = [];
  const scope = createScope({
    extensions: [
      extension({
        label: "spy",
        hooks: {
          write: (event) => {
            seen.push(event.value);
            event.next();
          },
        },
      }),
    ],
  });
  scope.controller(cell, { ns: east }).set(2);
  expect(scope.controller(cell, { ns: east }).get()).toBe(2);
  expect(seen).toEqual([2]);
  await scope.close();
});

test("two run hooks keep registration order on a subflow", async () => {
  const child = operation({ label: "child", run: () => 3 });
  const parent = operation({
    label: "parent",
    depends: { child },
    run: ({ child }) => child.run(),
  });
  const order: string[] = [];
  const hook = (label: string) =>
    extension({
      label,
      hooks: {
        run: (event) => {
          if (event.op.label !== "child") return event.next();
          order.push(`${label}:before`);
          const result = event.next();
          order.push(`${label}:after`);
          return result;
        },
      },
    });
  const scope = createScope({ extensions: [hook("a"), hook("b")] });
  expect(scope.run(parent)).toBe(3);
  expect(order).toEqual(["a:before", "b:before", "b:after", "a:after"]);
  await scope.close();
});

test("two hooks keep registration order on a child layer", async () => {
  const cell = data({ initial: 0 });
  const op = operation({ label: "op", run: () => 5 });
  const order: string[] = [];
  const hook = (label: string) =>
    extension({
      label,
      hooks: {
        run: (event) => {
          order.push(`${label}:run-before`);
          const result = event.next();
          order.push(`${label}:run-after`);
          return result;
        },
        write: (event) => {
          order.push(`${label}:write-before`);
          event.next();
          order.push(`${label}:write-after`);
        },
      },
    });
  const scope = createScope({ extensions: [hook("a"), hook("b")] });
  const session = scope.createSession();
  expect(session.run(op)).toBe(5);
  session.controller(cell).set(1);
  expect(order).toEqual([
    "a:run-before",
    "b:run-before",
    "b:run-after",
    "a:run-after",
    "a:write-before",
    "b:write-before",
    "b:write-after",
    "a:write-after",
  ]);
  await scope.close();
});
