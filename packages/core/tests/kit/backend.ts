import { createScope, data, operation, remoteData, rpc, transport } from "@tinkered/core";
import type { Capsule, Scope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

// The backend kit (ADR 0140): the cases every backend runs, so the backends do not drift. It
// stays in this repo (Duke, 2026-11-14 15:47). Core runs it on `memory`, Bun on `ws`.

const { hook } = transport;

/** One server of a backend, as the kit starts it. `S` is what `link` needs to reach it. */
export type Backend<S> = {
  /** A server scope with these capsules, serving these services. */
  serve(
    capsules: readonly Capsule.Installable[],
    services: readonly unknown[],
  ): Promise<{ readonly scope: Scope.Handle; readonly at: S }>;
  /** A client of that server: the capsule to install, and the handle `rpc` and `remoteData`
   * read through. */
  link(at: S): { readonly capsule: Capsule.Installable; readonly remote: never };
};

const api = rpc({
  greet: { input: z.object({ name: z.string() }), output: z.string() },
  shut: { input: z.null(), output: z.null() },
  boom: { input: z.null(), output: z.null() },
});

/** What an older or other client knows: an address the server lacks, and a looser `greet`. */
const gone = rpc({ lost: { input: z.null(), output: z.null() } });
const loose = rpc({ greet: { input: z.unknown(), output: z.string() } });

const count = data({ label: "kit.count", initial: 0, parse: z.number() });

type Item = { list: string; id: string };

const items = data({
  label: "kit.items",
  mode: "keyed",
  key: (i: Item) => ({ list: i.list, id: i.id }),
});

const board = remoteData({ count, items });

const tick = (ms = 40) => new Promise((done) => setTimeout(done, ms));

const until = async (ok: () => boolean) => {
  for (let tries = 0; !ok(); tries++) {
    if (tries > 300) throw new Error("timed out");
    await tick(10);
  }
};

/** Runs every case of the kit on one backend. */
export function backendKit<S>(name: string, make: () => Backend<S>): void {
  const closers: Array<() => unknown> = [];

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
  });

  const rows = new Map<string, Item>([["a/1", { list: "a", id: "1" }]]);
  const loadItems = operation({
    label: "kit.load",
    input: z.object({ list: z.string() }),
    run: (_, { input }) => [...rows.values()].filter((i) => i.list === input.list),
  });
  const guard = operation({
    label: "kit.guard",
    input: hook.start,
    run: (_, { input }) => (input.key === "shut" ? input.refuse({ why: "closed" }) : undefined),
  });
  const ops = {
    greet: operation({
      label: "kit.greet",
      input: api.greet.input,
      run: (_, { input }) => `Hello, ${input.name}.`,
    }),
    shut: operation({ label: "kit.shut", input: z.null(), run: () => null }),
    boom: operation({
      label: "kit.boom",
      input: z.null(),
      run: (): null => {
        throw new Error("boom");
      },
    }),
  };

  const start = async () => {
    const backend = make();
    const server = await backend.serve(
      [
        api({ implement: ops, onStart: [guard] }),
        board({ serve: true, load: { items: loadItems } }),
      ],
      [api, board],
    );
    closers.push(() => server.scope.close());

    const client = async () => {
      const { capsule, remote } = backend.link(server.at);
      const scope = await createScope({
        capsules: [
          capsule,
          api({ remote }),
          gone({ remote }),
          loose({ remote }),
          board({ read: remote }),
        ],
      }).ready;
      closers.push(() => scope.close());
      return scope;
    };
    return { backend, server: server.scope, client };
  };

  const faultOf = (call: Promise<unknown>) =>
    call.then(
      () => undefined,
      (error: unknown) => {
        const { fault, from } = error as { fault?: string; from?: string };
        return { fault, from };
      },
    );

  test(`${name}: a call goes and its reply comes back`, async () => {
    const app = await start();
    const tab = await app.client();

    const all = await Promise.all(
      ["a", "b"].map((who) => tab.run(api.greet, { input: { name: who } })),
    );

    expect(all).toEqual(["Hello, a.", "Hello, b."]);
  });

  test(`${name}: each exit of a call is the server's answer`, async () => {
    const app = await start();
    const tab = await app.client();

    const faults = await Promise.all([
      faultOf(tab.run(loose.greet, { input: { name: 5 } })),
      faultOf(tab.run(api.shut, { input: null })),
      faultOf(tab.run(api.boom, { input: null })),
      faultOf(tab.run(gone.lost, { input: null })),
    ]);

    expect(faults).toEqual([
      { fault: "invalid", from: "server" },
      { fault: "refused", from: "server" },
      { fault: "failed", from: "server" },
      { fault: "missing", from: "server" },
    ]);
  });

  test(`${name}: a write on the server reaches each client that reads the cell`, async () => {
    const app = await start();
    const [one, two] = [await app.client(), await app.client()];
    const bump = operation({
      label: "kit.bump",
      depends: { n: count.controller },
      run: ({ n }) => n.set(n.get() + 1),
    });

    await app.server.run(bump);
    await until(() => one.resolve(board.count).get() === 1);
    await until(() => two.resolve(board.count).get() === 1);

    expect([one.resolve(board.count).get(), two.resolve(board.count).get()]).toEqual([1, 1]);
  });

  test(`${name}: a keyed part is asked, then asked again on invalidate`, async () => {
    const app = await start();
    const tab = await app.client();
    const reader = tab.resolve(board.items.where({ list: "a" }));
    const stop = reader.watch(() => undefined);
    closers.push(stop);
    await until(() => reader.get().length === 1);

    rows.set("a/2", { list: "a", id: "2" });
    await app.server.run(board.invalidate, { input: { items: { list: "a", id: "2" } } });
    await until(() => reader.get().length === 2);

    rows.delete("a/2");
    expect(reader.get().map((i) => i.id)).toEqual(["1", "2"]);
  });

  test(`${name}: a server that closes under a watch is a link fault`, async () => {
    const app = await start();
    const tab = await app.client();
    const read = board.items.where({ list: "a" });
    const stop = tab.resolve(read).watch(() => undefined);
    closers.push(stop);
    const state = tab.resolve(board.status(read));
    await until(() => state.get()?.status === "ready");

    await app.server.close();
    await until(() => state.get()?.status === "fault");

    expect(state.get()).toMatchObject({ fault: { fault: "link", from: "local" } });
  });

  test(`${name}: two services with one address fail the start`, async () => {
    const twin = rpc({ greet: { input: z.null(), output: z.null() } });
    const failed = await make()
      .serve(
        [
          api({ implement: ops }),
          twin({
            implement: {
              greet: operation({ label: "kit.twin", input: z.null(), run: () => null }),
            },
          }),
        ],
        [api, twin],
      )
      .then(
        ({ scope }) => scope.close(),
        (error: unknown) => error,
      );

    expect(failed).toMatchObject({ kind: "DuplicateAddress", payload: { address: "greet" } });
  });
}
