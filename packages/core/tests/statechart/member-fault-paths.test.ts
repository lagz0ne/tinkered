/**
 * Replays of the remote-part model (docs/states/remote-part/RemotePart.tla, member.cfg): each
 * test runs one model path, one step per action, on the real code.
 */
import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, data, operation, remoteData, transport } from "@/main";

const { hook } = transport;

type Issue = { teamId: string; id: string; title: string };
const Issue = z.object({ teamId: z.string(), id: z.string(), title: z.string() });

const issues = data({
  label: "member.issues",
  mode: "keyed",
  parse: Issue,
  key: (i) => ({ teamId: i.teamId, id: i.id }),
});

/** The teams the reader is a member of: the read guard checks it. Server side only. */
const access = data<readonly string[]>({ label: "member.access", initial: ["T1"] });

const board = remoteData({ issues });
const issue = (id: string): Issue => ({ teamId: "T1", id, title: id });

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

/**
 * A server with issues a, b, c in team T1, and a tab that reads the part `{ teamId: "T1" }`.
 * The guard refuses a team the reader is not a member of. With `failMember`, it throws on an
 * ask for one member: a fault that is not an answer.
 */
async function boot() {
  const rules = { failMember: false };
  const guard = operation({
    label: "member.guard",
    input: hook.start,
    depends: { access: access.controller },
    run: ({ access }, { input }) => {
      const part = Object(Object(input.input).part) as { teamId?: string; id?: string };
      if (rules.failMember && input.key.endsWith(".ask") && part.id) {
        throw new Error("the store is down");
      }
      if (part.teamId && !access.get().includes(part.teamId)) {
        return input.refuse({ notMember: part.teamId });
      }
    },
  });
  /** One run: the reader leaves the team (when `leave`), and the named issues go. */
  const change = operation({
    label: "member.change",
    input: z.object({ leave: z.boolean(), gone: z.array(z.string()) }),
    depends: { items: issues.controller, access: access.controller },
    run: ({ items, access }, { input }) => {
      if (input.leave) access.set([]);
      for (const id of input.gone) items.delete({ teamId: "T1", id });
    },
  });
  const add = operation({
    label: "member.add",
    input: Issue,
    depends: { items: issues.controller },
    run: ({ items }, { input }) => items.set(input),
  });

  const server = await createScope({
    capsules: [board({ serve: true, onStart: [guard] }), memory.server({ services: [board] })],
  }).ready;
  closers.push(() => server.close());
  for (const id of ["a", "b", "c"]) server.run(add, { input: issue(id) });

  const tab = await createScope({
    capsules: [memory.client({ peer: server }), board({ read: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  const part = board.issues.where({ teamId: "T1" });
  const reader = tab.resolve(part);
  closers.push(reader.watch(() => undefined));
  return {
    rules,
    tab,
    ids: () => reader.get().map((i) => i.id),
    status: () => tab.resolve(board.status(part)).get(),
    keyFault: () => tab.resolve(board.faults).get().issues,
    change: (leave: boolean, gone: string[]) => server.run(change, { input: { leave, gone } }),
  };
}

/**
 * Path 5. A reader reads the part, the stream opens, the server signals, and an answer comes. One
 * run: the reader leaves the team and one member goes, so the pass names that member. The ask for
 * that member is refused.
 */
test("MemberFaultReachesPart: a refused ask for one member puts the part in fault", async () => {
  const app = await boot();
  await expect.poll(() => app.status()?.status).toBe("ready");
  expect(app.ids()).toEqual(["a", "b", "c"]);

  app.change(true, ["a"]);
  await expect.poll(() => app.keyFault()).toBeDefined();

  expect(app.keyFault()).toMatchObject({ fault: "refused", payload: { notMember: "T1" } });
  expect(app.status()).toMatchObject({
    status: "fault",
    fault: { fault: "refused", payload: { notMember: "T1" } },
  });
});

test("control: a run that changes two members asks for the whole part, which goes to fault", async () => {
  const app = await boot();
  await expect.poll(() => app.status()?.status).toBe("ready");

  app.change(true, ["a", "b"]);

  await expect.poll(() => app.status()?.status).toBe("fault");
  expect(app.status()).toMatchObject({
    status: "fault",
    fault: { fault: "refused", payload: { notMember: "T1" } },
  });
});

test("MemberFaultReachesPart: an ask for one member that fails puts the part in fault", async () => {
  const app = await boot();
  await expect.poll(() => app.status()?.status).toBe("ready");

  app.rules.failMember = true;
  app.change(false, ["a"]);
  await expect.poll(() => app.keyFault()).toBeDefined();

  expect(app.keyFault()).toMatchObject({ fault: "failed" });
  expect(app.status()).toMatchObject({ status: "fault", fault: { fault: "failed" } });
});

test("control: a part's refused stream leaves an overlapping part with its own stream ready", async () => {
  const app = await boot();
  const mine = board.issues.where({ id: "a" });
  closers.push(app.tab.resolve(mine).watch(() => undefined));
  await expect.poll(() => app.tab.resolve(board.status(mine)).get()?.status).toBe("ready");

  const theirs = board.issues.where({ teamId: "T2" });
  closers.push(app.tab.resolve(theirs).watch(() => undefined));
  await expect.poll(() => app.tab.resolve(board.status(theirs)).get()?.status).toBe("fault");

  expect(app.tab.resolve(board.status(mine)).get()).toMatchObject({ status: "ready" });
});

/** ADR 0139 d4: a fault of an ask is a fault of each part in use that holds a member of it. */
test("MemberFaultReachesPart: a refused ask for a part puts an overlapping part in fault", async () => {
  const app = await boot();
  const mine = board.issues.where({ id: "a" });
  closers.push(app.tab.resolve(mine).watch(() => undefined));
  await expect.poll(() => app.tab.resolve(board.status(mine)).get()?.status).toBe("ready");
  await expect.poll(() => app.status()?.status).toBe("ready");

  app.change(true, ["b", "c"]);
  await expect.poll(() => app.status()?.status).toBe("fault");

  expect(app.tab.resolve(board.status(mine)).get()).toMatchObject({
    status: "fault",
    fault: { fault: "refused", payload: { notMember: "T1" } },
  });
});
