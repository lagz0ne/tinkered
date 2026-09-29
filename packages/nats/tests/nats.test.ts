import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { connect } from "@nats-io/transport-node";
import { startNatsServer, type NatsServer } from "@tinker/nats/testing";
import {
  createScope,
  data,
  extension,
  operation,
  resource,
  type Observe,
  type Operation,
} from "@tinker/core";
import { isError, nats, subscribe, type Nats } from "../src/index.ts";

let server: NatsServer.Handle;
beforeAll(async () => {
  server = await startNatsServer();
});
afterAll(async () => {
  await server.close();
});

const message: Nats.Message = {
  subject: "events.changed",
  payload: new TextEncoder().encode("hello"),
};

test("publish reaches a subscription operation with its subject and payload", async () => {
  const received = Promise.withResolvers<Nats.Message>();
  const receive = operation({
    label: "receive",
    run: (_deps, ctx: Operation.Ctx<Nats.Message>) => received.resolve(ctx.input),
  });
  const bus = nats([subscribe("events.*", receive)], { env: { NATS_URL: server.url } });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await scope.ready;
    const send = operation({
      label: "send",
      depends: { publish: bus.publish },
      run: ({ publish }) => publish.run({ input: message }),
    });
    scope.run(send);
    expect(await received.promise).toEqual(message);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("each message gets its own session resources and closes them", async () => {
  const seen: object[] = [];
  const closed: object[] = [];
  const local = resource({
    label: "local",
    target: "session",
    factory: (_deps, ctx) => {
      const state = {};
      ctx.defer(() => {
        closed.push(state);
      });
      return state;
    },
  });
  const state = data({ initial: 0 });
  const values: number[] = [];
  const receive = operation({
    label: "receive",
    depends: { local, state: state.controller },
    run: ({ local, state }, _ctx: Operation.Ctx<Nats.Message>) => {
      seen.push(local);
      values.push(state.get());
      state.set(1);
    },
  });
  const bus = nats([subscribe(message.subject, receive)], { env: { NATS_URL: server.url } });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await scope.ready;
    scope.run(bus.publish, { input: message });
    scope.run(bus.publish, { input: message });
    await expect.poll(() => closed.length).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(closed).toEqual(seen);
    expect(values).toEqual([0, 0]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a failed operation logs one error and the next message still runs", async () => {
  const logs: Observe.Log[] = [];
  const received: number[] = [];
  const failure = new Error("cannot handle first message");
  const receive = operation({
    label: "receive",
    run: (_deps, ctx: Operation.Ctx<Nats.Message>) => {
      const value = ctx.input.payload[0];
      if (value === 1) throw failure;
      received.push(value);
    },
  });
  const bus = nats([subscribe("failures", receive)], { env: { NATS_URL: server.url } });
  const scope = createScope({
    extensions: [bus.extension],
    observe: { log: (line) => logs.push(line) },
  });
  try {
    await scope.ready;
    scope.run(bus.publish, { input: { subject: "failures", payload: new Uint8Array([1]) } });
    await expect.poll(() => logs.length).toBe(1);
    scope.run(bus.publish, { input: { subject: "failures", payload: new Uint8Array([2]) } });
    await expect.poll(() => received).toEqual([2]);
    expect(logs).toMatchObject([
      {
        level: 50,
        message: "nats operation failed",
        attributes: { subject: "failures", error: failure },
      },
    ]);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("scope close drains queued messages and their replies before closing the connection", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const peer = await connect({ servers: server.url });
  const replies = peer.subscribe("replies");
  const received = (async () => {
    const values: number[] = [];
    for await (const reply of replies) {
      values.push(reply.data[0]);
      if (values.length === 2) break;
    }
    return values;
  })();
  const bus = nats([subscribe("drain", () => receive)], { env: { NATS_URL: server.url } });
  const receive = operation({
    label: "receive",
    depends: { publish: bus.publish },
    run: async ({ publish }, ctx: Operation.Ctx<Nats.Message>) => {
      started.resolve();
      await release.promise;
      publish.run({ input: { subject: "replies", payload: ctx.input.payload } });
    },
  });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await scope.ready;
    scope.run(bus.publish, { input: { subject: "drain", payload: new Uint8Array([1]) } });
    scope.run(bus.publish, { input: { subject: "drain", payload: new Uint8Array([2]) } });
    await started.promise;
    let closed = false;
    const closing = scope.close({ graceful: true }).then((result) => {
      closed = true;
      return result;
    });
    await peer.flush();
    expect(closed).toBe(false);
    release.resolve();
    expect(await closing).toEqual({ status: "success" });
    expect(await received).toEqual([1, 2]);
    await expect
      .poll(async () => (await fetch(`${server.monitorUrl}/connz`)).json())
      .toMatchObject({ num_connections: 1 });
  } finally {
    release.resolve();
    await scope.close();
    await peer.close();
  }
});

test("a borrowed connection stays open while this scope's subscriptions stop", async () => {
  const peer = await connect({ servers: server.url });
  const unrelated = peer.subscribe("unrelated");
  const seen: Nats.Message[] = [];
  const receive = operation({
    label: "receive",
    run: (_deps, ctx: Operation.Ctx<Nats.Message>) => {
      seen.push(ctx.input);
    },
  });
  const bus = nats([subscribe(message.subject, receive)], {
    env: { NATS_URL: server.url.replace("nats:", "tls:") },
    connection: peer,
  });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await scope.ready;
    scope.run(bus.publish, { input: message });
    await expect.poll(() => seen.length).toBe(1);
    await scope.close({ graceful: true });
    peer.publish(message.subject, message.payload);
    await peer.flush();
    expect(seen).toEqual([message]);
    expect(peer.isClosed()).toBe(false);
    expect(await (await fetch(`${server.monitorUrl}/connz`)).json()).toMatchObject({
      connections: [{ subscriptions: 1 }],
    });
    expect(unrelated.isClosed()).toBe(false);
  } finally {
    await scope.close();
    await peer.close();
  }
});

test("a publish-only scope flushes queued bytes to a peer before it closes", async () => {
  const peer = await connect({ servers: server.url });
  const received = Promise.withResolvers<Uint8Array>();
  peer.subscribe("outbound", {
    callback: (_error, message) => received.resolve(message.data),
  });
  await peer.flush();
  const bus = nats([], { env: { NATS_URL: server.url } });
  const scope = createScope({ extensions: [bus.extension] });
  const payload = new Uint8Array(512 * 1024).fill(7);
  try {
    await scope.ready;
    scope.run(bus.publish, { input: { subject: "outbound", payload } });
    await scope.close({ graceful: true });
    expect(Buffer.from(await received.promise).toString("base64")).toBe(
      Buffer.from(payload).toString("base64"),
    );
  } finally {
    await scope.close();
    await peer.close();
  }
});

test("a denied subscription logs its subject and still closes the connection", async () => {
  const restricted = await startNatsServer(`no_auth_user: "app"
  authorization {
    users: [{user: "app", password: "secret", permissions: {subscribe: "allowed"}}]
  }`);
  const logs: Observe.Log[] = [];
  const receive = operation({
    label: "receive",
    run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => expect.unreachable(),
  });
  const bus = nats([subscribe("denied", receive)], {
    env: { NATS_URL: restricted.url },
  });
  const scope = createScope({
    extensions: [bus.extension],
    observe: { log: (line) => logs.push(line) },
  });
  try {
    await scope.ready;
    await expect.poll(() => logs.length).toBe(1);
    expect(logs).toMatchObject([
      {
        level: 50,
        message: "nats subscription failed",
        attributes: { subject: "denied", error: expect.any(Error) },
      },
    ]);
    await scope.close({ graceful: true });
    await expect
      .poll(async () => (await fetch(`${restricted.monitorUrl}/connz`)).json())
      .toMatchObject({ num_connections: 0 });
  } finally {
    await scope.close();
    await restricted.close();
  }
});

test("missing NATS_URL fails boot naming the key", async () => {
  const bus = nats([], { env: {} });
  const scope = createScope({ extensions: [bus.extension] });
  expect.assertions(1);
  try {
    await scope.ready;
  } catch (error) {
    if (isError(error, "ChecksumMismatch")) throw error;
    if (!isError(error, "InvalidConfig")) throw error;
    expect(error.payload.key).toBe("NATS_URL");
  } finally {
    await scope.close();
  }
});

test("bad NATS_URL fails boot naming the key", async () => {
  for (const NATS_URL of ["", "not a URL", "http://localhost:4222", "nats://"]) {
    const bus = nats([], { env: { NATS_URL } });
    const scope = createScope({ extensions: [bus.extension] });
    try {
      await expect(scope.ready).rejects.toMatchObject({
        kind: "InvalidConfig",
        payload: { key: "NATS_URL" },
      });
    } finally {
      await scope.close();
    }
  }
});

test("forced close aborts a running message and closes the connection", async () => {
  const started = Promise.withResolvers<void>();
  const receive = operation({
    label: "waitForAbort",
    run: (_deps, ctx: Operation.Ctx<Nats.Message>) =>
      new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
        started.resolve();
      }),
  });
  const bus = nats([subscribe("abort", receive)], { env: { NATS_URL: server.url } });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await scope.ready;
    scope.run(bus.publish, { input: { subject: "abort", payload: new Uint8Array() } });
    await started.promise;
    expect(await scope.close()).toMatchObject({ status: "cancelled", teardownErrors: undefined });
    await expect
      .poll(async () => (await fetch(`${server.monitorUrl}/connz`)).json())
      .toMatchObject({ num_connections: 0 });
  } finally {
    await scope.close();
  }
});

test("close during boot reaps a connection that opens later", async () => {
  const release = Promise.withResolvers<void>();
  const gate = extension({ label: "bootGate", start: () => release.promise });
  const bus = nats([], { env: { NATS_URL: server.url } });
  const scope = createScope({ extensions: [bus.extension, gate] });
  try {
    await scope.close({ graceful: true });
    release.resolve();
    await scope.ready;
    await expect
      .poll(async () => (await fetch(`${server.monitorUrl}/connz`)).json())
      .toMatchObject({ num_connections: 0 });
  } finally {
    release.resolve();
    await scope.close();
  }
});

test("a failed subscription loader fails boot and closes the connection", async () => {
  const failure = new Error("cannot load the operation");
  const bus = nats([subscribe("bootFail", () => Promise.reject(failure))], {
    env: { NATS_URL: server.url },
  });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await expect(scope.ready).rejects.toBe(failure);
    await scope.close();
    await expect
      .poll(async () => (await fetch(`${server.monitorUrl}/connz`)).json())
      .toMatchObject({ num_connections: 0 });
  } finally {
    await scope.close();
  }
});
