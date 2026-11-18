// Replays the UnsentNeverRuns bug path of the RpcCall model
// (/home/paseo/statechart/core/rpc-call), one step per model action, on the real ws client
// and ws server. Rule (ADR 0141, kept by ADR 0154): `link`, `sent: false` means nothing left,
// so nothing ran. A failure means the path reproduces.
//
// Test seams (no change to src): `setImmediate` is wrapped before the client module loads, so
// the test can hold the client's next tick (the frame buffer's send); `WebSocket` is wrapped
// to list the sockets the client opens. Step 4 fires the socket's `close` event in the window
// between the post and the tick, as a real close event can (both are tasks).
import { createScope, execution, operation, rpc } from "@tinkered/core";
import type { Scope } from "@tinkered/core";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

const realImmediate = globalThis.setImmediate;
let hold = false;
const held: Array<() => void> = [];

globalThis.setImmediate = ((fn: (...args: unknown[]) => void, ...args: unknown[]) => {
  if (!hold) return realImmediate(fn, ...args);
  held.push(() => fn(...args));
  return undefined as never;
}) as typeof setImmediate;

const RealWebSocket = globalThis.WebSocket;
const sockets: WebSocket[] = [];

globalThis.WebSocket = class extends RealWebSocket {
  constructor(...args: ConstructorParameters<typeof RealWebSocket>) {
    super(...args);
    sockets.push(this);
  }
} as typeof WebSocket;

const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  if (!ok()) throw new Error("timed out");
};

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

const api = rpc({ add: { input: z.object({ n: z.number() }), output: z.string() } });

test("UnsentNeverRuns path: a call failed as link, sent: false still runs on the server", async () => {
  const { ws: wsClient } = await import("@/client");
  const { ws: wsServer } = await import("@/index");
  const { listen } = await import("./support");

  const runs: string[] = [];
  const add = operation({
    label: "add",
    input: api.add.input,
    depends: { id: execution.required },
    run: ({ id }) => (runs.push(id), id),
  });
  const wire = wsServer.server({ path: "/api", services: [api] });
  const server = await createScope({ capsules: [api({ implement: { add } }), wire] }).ready;
  closers.push(() => server.close());
  const { bun, url } = listen(server, [wire]);
  closers.push(() => bun.stop(true));
  const tab: Scope.Handle = await createScope({
    capsules: [wsClient.client({ url: `${url}/api` }), api({ remote: wsClient.client })],
  }).ready;
  closers.push(() => tab.close());

  const faultOf = (e: unknown) =>
    api.fault.is(e) ? { fault: e.fault, sent: e.sent, execution: e.execution } : e;

  // 1. the app calls (call A)
  const a = tab.run(api.add, { input: { n: 1 } }).catch(faultOf);
  // 2. the frame goes out: the client opens a socket
  await until(() => sockets.length === 1);
  // 3. the app calls (call B): its message waits in the frame buffer for the next tick
  hold = true;
  const b = tab.run(api.add, { input: { n: 2 } }).catch(faultOf);
  await until(() => held.length > 0);
  // 4. the link closes, before that tick
  const first = sockets[0]!;
  first.dispatchEvent(new Event("close"));
  first.close();
  const bGot = (await b) as { fault: string; sent: boolean; execution: string };
  await a;
  expect([bGot.fault, bGot.sent]).toEqual(["link", false]);
  // 5. the frame goes out (the held tick runs): it opens a new socket
  hold = false;
  for (const tick of held.splice(0)) tick();
  // 6. the link opens; 7. the server answers
  await until(() => sockets.length === 2);
  await new Promise((r) => setTimeout(r, 200));

  // ADR 0141 (kept by ADR 0154): sent: false means nothing ran.
  expect({ sockets: sockets.length, ranB: runs.includes(bGot.execution) }).toEqual({
    sockets: 2,
    ranB: false,
  });
});
