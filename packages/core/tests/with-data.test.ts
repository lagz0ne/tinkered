import { expect, test } from "vite-plus/test";
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
} from "../src/index.ts";

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

test("a withData close hands over what the session wrote, never what it inherited", async () => {
  const root = createScope();
  root.controller(shared).set("parent");
  const ends: Scope.Result[] = [];
  for (const end of ["success", "cancelled", "failed"]) {
    const session = root.createSession();
    session.controller(draft).set(7);
    if (end === "failed")
      await session.run(panic).then(undefined, (error: unknown) => {
        if (error !== bug) throw error;
      });
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
    session: async (handle, next) => {
      const ended = await next();
      seen.push(handle.resolve(draft), handle.resolve(zone));
      return ended;
    },
  });
  const root = createScope({ extensions: [reader] });
  await root.session({ tags: [zone("eu")] }, (scope) => {
    scope.controller(draft).set(5);
  });
  expect(seen).toEqual([5, "eu"]);
  await root.close();
});

test("a session hook cannot write a cell or read a resource after next", async () => {
  const errors: unknown[] = [];
  const reader = extension({
    label: "reader",
    session: async (handle, next) => {
      const ended = await next();
      errors.push(
        thrown(() => handle.controller(draft).set(1)),
        thrown(() => handle.resolve(db)),
      );
      return ended;
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
    session: async (_handle, next) => next(),
  });
  const root = createScope({ extensions: [reader] });
  const session = root.createSession();
  session.controller(draft).set(2);
  await session.close();
  const error = thrown(() => session.resolve(draft));
  if (!isError(error, "Disposed")) throw error;
  await root.close();
});
