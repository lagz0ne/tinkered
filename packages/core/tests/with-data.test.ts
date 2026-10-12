import { expect, test } from "vite-plus/test";
import { preset } from "@tinker/core/testing";
import {
  createScope,
  data,
  extension,
  isError,
  namespace,
  operation,
  resource,
  tag,
  type Scope,
} from "../src/index";

const draft = data({ label: "draft", initial: 0 });
const shared = data({ label: "shared", initial: "none" });
const zone = tag<string>({ label: "zone" });
const db = resource({ label: "db", factory: () => ({ open: true }) });
const bug = new Error("bug");

const panic = operation({
  label: "panic",
  run: async () => {
    throw bug;
  },
});

function thrown(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error;
  }
  return undefined;
}

test("a default close frees a session's data and returns none", async () => {
  const root = createScope();
  const session = root.createSession();
  session.controller(draft).set(1);

  const ended = await session.close();
  const error = thrown(() => session.resolve(draft));
  if (!isError(error, "Disposed")) throw error;

  expect(ended.data).toBeUndefined();
  await root.close();
});

test("a held controller reads the initial value once a parent's close frees its fast-closed child", async () => {
  const root = createScope();
  const session = root.createSession();
  const held = session.controller(draft);
  held.set(5);
  await root.close();

  expect(held.get()).toBe(0);
});

test("a held controller reads the initial value once its fast-closed session closes", async () => {
  const root = createScope();
  const session = root.createSession();
  const held = session.controller(draft);
  held.set(5);
  await session.close();

  expect(held.get()).toBe(0);
  await root.close();
});

test("a held controller reads the initial value once the root closes", async () => {
  const root = createScope();
  const held = root.controller(draft);
  held.set(5);
  await root.close();
  expect(held.get()).toBe(0);
});

test("a held controller on a preset data cell reads the initial value once the root closes", async () => {
  const root = createScope({ presets: [preset(draft, 7)] });
  const held = root.controller(draft);
  expect(held.get()).toBe(7);
  await root.close();
  expect(held.get()).toBe(0);
});

test("a closed leaf reads the open middle's write made after the leaf's own read", async () => {
  const root = createScope();
  root.controller(draft).set(5);

  const middle = root.createSession();
  const leaf = middle.createSession();
  const held = leaf.controller(draft);
  await leaf.close();

  expect(held.get()).toBe(5);
  middle.controller(draft).set(7);
  expect(held.get()).toBe(7);
  await middle.close();
  await root.close();
});

test("a closed leaf reads the open root's write made after the leaf's own read", async () => {
  const root = createScope();
  const middle = root.createSession();
  const leaf = middle.createSession();
  const held = leaf.controller(draft);
  await leaf.close();

  expect(held.get()).toBe(0);
  root.controller(draft).set(8);
  expect(held.get()).toBe(8);
  await middle.close();
  await root.close();
});

test("a closed leaf reads the initial value once every layer above it has closed", async () => {
  const root = createScope();
  root.controller(draft).set(5);

  const middle = root.createSession();
  const leaf = middle.createSession();
  const held = leaf.controller(draft);
  await leaf.close();

  expect(held.get()).toBe(5);
  await middle.close();
  await root.close();
  expect(held.get()).toBe(0);
});

test("a session hook reads its own held write after next", async () => {
  const seen: unknown[] = [];
  const reader = extension({
    label: "reader",
    hooks: {
      session: async (event) => {
        const ended = await event.next();
        seen.push(held.get());
        return ended;
      },
    },
  });
  const root = createScope({ extensions: [reader] });
  const session = root.createSession();
  const held = session.controller(draft);
  held.set(4);

  await session.close();

  expect(seen).toEqual([4]);
  await root.close();
});

test("a session hook reads an ancestor's write made after the session closed", async () => {
  const seen: unknown[] = [];
  const reader = extension({
    label: "reader",
    hooks: {
      session: async (event) => {
        const ended = await event.next();
        root.controller(draft).set(8);
        seen.push(held.get(), event.handle.resolve(draft));
        return ended;
      },
    },
  });
  const root = createScope({ extensions: [reader] });
  const session = root.createSession();
  const held = session.controller(draft);

  expect(held.get()).toBe(0);
  await session.close();
  expect(seen).toEqual([8, 8]);
  await root.close();
});

test("a withData close hands over what the session wrote, never what it inherited", async () => {
  const root = createScope();
  root.controller(shared).set("parent");
  const ends: Scope.Result[] = [];
  for (const end of ["success", "cancelled", "failed"]) {
    const session = root.createSession();
    session.controller(draft).set(7);
    if (end === "failed") {
      await session.run(panic).then(undefined, (error: unknown) => {
        if (error !== bug) throw error;
      });
    }
    ends.push(await session.close({ graceful: end === "success", withData: true }));
  }

  expect(ends.map((ended) => ended.status)).toEqual(["success", "cancelled", "failed"]);
  for (const ended of ends) {
    expect(ended.data?.get(draft)).toEqual({ present: true, value: 7 });
    expect(ended.data?.get(shared)).toEqual({ present: false });
  }
  await root.close();
});

test("a family member and a namespaced session's cell read back from data", async () => {
  const root = createScope();
  const alice = namespace();
  const bob = namespace();
  const member = root.createSession();
  member.controller(draft, { ns: alice }).set(3);

  const named = root.createSession({ ns: bob });
  named.controller(draft).set(4);
  const fromMember = (await member.close({ withData: true })).data;
  const fromNamed = (await named.close({ withData: true })).data;

  expect(fromMember?.get(draft, { ns: alice })).toEqual({ present: true, value: 3 });
  expect(fromMember?.get(draft, { ns: bob })).toEqual({ present: false });
  expect(fromNamed?.get(draft)).toEqual({ present: true, value: 4 });
  await root.close();
});

test("a graceful withData close keeps what in-flight work wrote before it settled", async () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = operation({
    label: "save",
    depends: { out: draft.controller },
    run: async ({ out }) => {
      out.set(9);
      await gate;
    },
  });
  const root = createScope();
  const session = root.createSession();
  const running = session.run(save);
  const closing = session.close({ graceful: true, withData: true });
  release();

  await running;
  const ended = await closing;

  expect(ended.status).toBe("success");
  expect(ended.data?.get(draft)).toEqual({ present: true, value: 9 });
  await root.close();
});

test("a session hook reads the session's cells and tags after next", async () => {
  const seen: unknown[] = [];
  const reader = extension({
    label: "reader",
    hooks: {
      session: async (event) => {
        const ended = await event.next();
        seen.push(event.handle.resolve(draft), event.handle.resolve(zone));
        return ended;
      },
    },
  });
  const root = createScope({ extensions: [reader] });
  await root.session({ tags: [zone("eu")] }, (scope) => {
    scope.controller(draft).set(5);
  });

  expect(seen).toEqual([5, "eu"]);
  await root.close();
});

test("a session hook reads the cell in the namespace its resolve names after next", async () => {
  const alice = namespace();
  const bob = namespace();
  const seen: unknown[] = [];
  const reader = extension({
    label: "reader",
    hooks: {
      session: async (event) => {
        const ended = await event.next();
        seen.push(
          event.handle.resolve(draft, { ns: alice }),
          event.handle.resolve(draft, { ns: bob }),
          event.handle.resolve(draft),
        );
        return ended;
      },
    },
  });
  const root = createScope({ extensions: [reader] });
  const session = root.createSession();
  session.controller(draft, { ns: alice }).set(3);

  session.controller(draft).set(4);
  await session.close();

  expect(seen).toEqual([3, 4, 4]);
  await root.close();
});

test("a session hook cannot write a cell or read a resource after next", async () => {
  const errors: unknown[] = [];
  const reader = extension({
    label: "reader",
    hooks: {
      session: async (event) => {
        const ended = await event.next();
        errors.push(
          thrown(() => event.handle.controller(draft).set(1)),
          thrown(() => event.handle.resolve(db)),
        );
        return ended;
      },
    },
  });
  const root = createScope({ extensions: [reader] });
  await root.session((scope) => scope.resolve(db));
  for (const error of errors) if (!isError(error, "Disposed")) throw error;

  expect(errors).toHaveLength(2);
  await root.close();
});

test("a hooked session's reads throw once its hooks return", async () => {
  const reader = extension({
    label: "reader",
    hooks: {
      session: async (event) => event.next(),
    },
  });
  const root = createScope({ extensions: [reader] });
  const session = root.createSession();
  session.controller(draft).set(2);

  await session.close();
  const error = thrown(() => session.resolve(draft));
  if (!isError(error, "Disposed")) throw error;
  await root.close();
});
