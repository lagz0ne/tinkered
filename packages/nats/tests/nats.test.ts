import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { connect } from "@nats-io/transport-node";
import { startNatsServer, type NatsServer } from "@tinker/nats/testing";
import {
  createScope,
  data,
  extension,
  namespace,
  operation,
  resource,
  tag,
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
    void scope.run(send);
    expect(await received.promise).toEqual(message);
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a shared piece serves independent roots and restarts after one closes", async () => {
  const identity = tag<string>({ label: "identity" });
  const received: string[] = [];
  const receive = operation({
    label: "receive",
    depends: { identity },
    run: ({ identity }, ctx: Operation.Ctx<Nats.Message>) => {
      received.push(`${identity}:${ctx.input.payload[0]}`);
    },
  });
  const bus = nats([subscribe("shared", receive)], { env: { NATS_URL: server.url } });
  const first = createScope({ tags: [identity("first")], extensions: [bus.extension] });
  const second = createScope({ tags: [identity("second")], extensions: [bus.extension] });
  const scopes = [first, second];
  try {
    await Promise.all([first.ready, second.ready]);
    void first.run(bus.publish, { input: { subject: "shared", payload: new Uint8Array([1]) } });
    await expect.poll(() => received.toSorted()).toEqual(["first:1", "second:1"]);
    await first.close({ graceful: true });
    const restarted = createScope({ tags: [identity("restarted")], extensions: [bus.extension] });
    scopes.push(restarted);
    await restarted.ready;
    await first.close({ graceful: true });
    void second.run(bus.publish, { input: { subject: "shared", payload: new Uint8Array([2]) } });
    await expect
      .poll(() => received.toSorted())
      .toEqual(["first:1", "restarted:2", "second:1", "second:2"]);
  } finally {
    for (const scope of scopes.reverse()) await scope.close({ graceful: true });
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
    void scope.run(bus.publish, { input: message });
    void scope.run(bus.publish, { input: message });
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
    void scope.run(bus.publish, { input: { subject: "failures", payload: new Uint8Array([1]) } });
    await expect.poll(() => logs.length).toBe(1);
    void scope.run(bus.publish, { input: { subject: "failures", payload: new Uint8Array([2]) } });
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
  const received: number[] = [];
  peer.subscribe("replies", {
    callback: (_error, reply) => {
      received.push(reply.data[0]);
    },
  });
  const bus = nats([subscribe("drain", () => receive)], { env: { NATS_URL: server.url } });
  const receive = operation({
    label: "receive",
    depends: { publish: bus.publish },
    run: async ({ publish }, ctx: Operation.Ctx<Nats.Message>) => {
      started.resolve();
      await release.promise;
      void publish.run({ input: { subject: "replies", payload: ctx.input.payload } });
    },
  });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await scope.ready;
    void scope.run(bus.publish, { input: { subject: "drain", payload: new Uint8Array([1]) } });
    void scope.run(bus.publish, { input: { subject: "drain", payload: new Uint8Array([2]) } });
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
    await expect.poll(() => received).toEqual([1, 2]);
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
  const bus = nats([subscribe(message.subject, receive)]);
  const scope = createScope({
    tags: [bus.config({ url: server.url.replace("nats:", "tls:"), connection: peer })],
    extensions: [bus.extension],
  });
  try {
    await scope.ready;
    void scope.run(bus.publish, { input: message });
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
    void scope.run(bus.publish, { input: { subject: "outbound", payload } });
    await scope.close({ graceful: true });
    expect(Buffer.from(await received.promise).toString("base64")).toBe(
      Buffer.from(payload).toString("base64"),
    );
  } finally {
    await scope.close();
    await peer.close();
  }
});

test("a denied subscription logs its subject and closes only an owned connection", async () => {
  const restricted = await startNatsServer(`no_auth_user: "app"
  authorization {
    users: [{user: "app", password: "secret", permissions: {subscribe: "allowed"}}]
  }`);
  try {
    for (const borrowed of [false, true]) {
      const peer = borrowed ? await connect({ servers: restricted.url }) : undefined;
      const logs: Observe.Log[] = [];
      const receive = operation({
        label: "receive",
        run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => expect.unreachable(),
      });
      const bus = nats([subscribe("denied", receive)], {
        env: { NATS_URL: restricted.url },
        connection: peer,
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
        expect(await scope.close({ graceful: true })).toEqual({ status: "success" });
        await expect
          .poll(async () => (await fetch(`${restricted.monitorUrl}/connz`)).json())
          .toMatchObject({ num_connections: borrowed ? 1 : 0 });
      } finally {
        await scope.close();
        await peer?.close();
      }
    }
  } finally {
    await restricted.close();
  }
});

test("missing NATS_URL fails boot before later starts and names the key", async () => {
  for (const bus of [nats([]), nats([], { env: {} })]) {
    let started = false;
    const later = extension({
      label: "later",
      hooks: {
        start: () => {
          started = true;
        },
      },
    });
    const scope = createScope({ extensions: [bus.extension, later] });
    try {
      try {
        await scope.ready;
        expect.unreachable();
      } catch (error) {
        if (!isError(error, "InvalidConfig")) throw error;
        expect(error.payload.key).toBe("NATS_URL");
      }
      expect(started).toBe(false);
    } finally {
      await scope.close();
    }
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
    void scope.run(bus.publish, { input: { subject: "abort", payload: new Uint8Array() } });
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
  const gate = extension({ label: "bootGate", hooks: { start: () => release.promise } });
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

test("failed boot keeps its cause and closes any connection without cleanup errors", async () => {
  const failure = new Error("cannot load the operation");
  for (const failBeforeConnect of [true, false]) {
    const gate = extension({
      label: "badStart",
      hooks: {
        start: () => {
          if (failBeforeConnect) throw failure;
        },
      },
    });
    const bus = nats([subscribe("bootFail", () => Promise.reject(failure))], {
      env: { NATS_URL: server.url },
    });
    const scope = createScope({ extensions: [bus.extension, gate] });
    try {
      await expect(scope.ready).rejects.toBe(failure);
      expect(await scope.close()).toMatchObject({
        status: "failed",
        error: failure,
        teardownErrors: undefined,
      });
      await expect
        .poll(async () => (await fetch(`${server.monitorUrl}/connz`)).json())
        .toMatchObject({ num_connections: 0 });
    } finally {
      await scope.close();
    }
  }
});

test("namespace config routes publish and incoming sessions through separate connections", async () => {
  const other = await startNatsServer();
  const identity = tag<string>({ label: "identity" });
  const received: string[] = [];
  const receive = operation({
    label: "receive",
    depends: { identity },
    run: ({ identity }, ctx: Operation.Ctx<Nats.Message>) => {
      received.push(`${identity}:${ctx.input.payload[0]}`);
    },
  });
  const bus = nats([subscribe("namespaced", receive)]);
  const east = namespace({ tags: [bus.config({ url: server.url }), identity("east")] });
  const west = namespace({ tags: [bus.config({ url: other.url }), identity("west")] });
  const scope = createScope({ ns: east, extensions: [bus.extension] });
  try {
    await scope.ready;
    await scope.run(bus.publish, {
      input: { subject: "namespaced", payload: new Uint8Array([1]) },
    });
    await scope.run(bus.publish, {
      ns: west,
      input: { subject: "namespaced", payload: new Uint8Array([2]) },
    });
    await scope.run(bus.publish, {
      ns: west,
      input: { subject: "namespaced", payload: new Uint8Array([3]) },
    });
    await expect.poll(() => received.toSorted()).toEqual(["east:1", "west:2", "west:3"]);
    await scope.close({ graceful: true });
    await expect
      .poll(async () => (await fetch(`${other.monitorUrl}/connz`)).json())
      .toMatchObject({ num_connections: 0 });
  } finally {
    await scope.close();
    await other.close();
  }
});

test("resolving a selected connection prepares incoming service without a publish", async () => {
  const other = await startNatsServer();
  const identity = tag<string>({ label: "identity" });
  const received: string[] = [];
  const receive = operation({
    label: "receive",
    depends: { identity },
    run: ({ identity }, _ctx: Operation.Ctx<Nats.Message>) => {
      received.push(identity);
    },
  });
  const bus = nats([subscribe("prepared", receive)], { env: { NATS_URL: server.url } });
  const east = namespace({ tags: [identity("east")] });
  const west = namespace({ tags: [bus.config({ url: other.url }), identity("west")] });
  const scope = createScope({ ns: east, extensions: [bus.extension] });
  const peer = await connect({ servers: other.url });
  try {
    await scope.ready;
    await scope.resolve(bus.connection, { ns: west });
    peer.publish("prepared", new Uint8Array());
    await peer.flush();
    await expect.poll(() => received).toEqual(["west"]);
  } finally {
    await scope.close({ graceful: true });
    await peer.close();
    await other.close();
  }
});

test("closing a failed root leaves a later root using the same piece alive", async () => {
  const failure = new Error("later start failed");
  const later = extension({
    label: "later",
    hooks: {
      start: () => {
        throw failure;
      },
    },
  });
  const received: Nats.Message[] = [];
  const receive = operation({
    label: "receive",
    run: (_deps, ctx: Operation.Ctx<Nats.Message>) => {
      received.push(ctx.input);
    },
  });
  const bus = nats([subscribe(message.subject, receive)], { env: { NATS_URL: server.url } });
  const failed = createScope({ extensions: [bus.extension, later] });
  await expect(failed.ready).rejects.toBe(failure);
  const live = createScope({ extensions: [bus.extension] });
  try {
    await live.ready;
    await failed.close({ graceful: true });
    await live.run(bus.publish, { input: message });
    await expect.poll(() => received).toEqual([message]);
  } finally {
    await failed.close();
    await live.close({ graceful: true });
  }
});

test("connection setup requires the bus extension on its root", async () => {
  const bus = nats([], { env: { NATS_URL: server.url } });
  const scope = createScope();
  try {
    await scope.resolve(bus.connection);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "NotStarted")) throw error;
  } finally {
    await scope.close();
  }
});

test("resolving the extension returns its root namespace's prepared sender", async () => {
  const identity = tag({ label: "identity", default: "default" });
  const received = Promise.withResolvers<{ identity: string; message: Nats.Message }>();
  const receive = operation({
    label: "receive",
    depends: { identity },
    run: ({ identity }, ctx: Operation.Ctx<Nats.Message>) => {
      received.resolve({ identity, message: ctx.input });
    },
  });
  const bus = nats([subscribe(message.subject, receive)]);
  const owner = namespace({ tags: [bus.config({ url: server.url }), identity("owner")] });
  const scope = createScope({ ns: owner, extensions: [bus.extension] });
  try {
    await scope.ready;
    scope.resolve(bus.extension).send(message);
    expect(await received.promise).toEqual({ identity: "owner", message });
  } finally {
    await scope.close({ graceful: true });
  }
});

test("a saved sender reports NotStarted after its root closes", async () => {
  const bus = nats([], { env: { NATS_URL: server.url } });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await scope.ready;
    const sender = scope.resolve(bus.extension);
    await scope.close({ graceful: true });
    try {
      sender.send(message);
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "NotStarted")) throw error;
    }
  } finally {
    await scope.close();
  }
});

test("a refused connection keeps its boot error without teardown errors", async () => {
  const stopped = await startNatsServer();
  await stopped.close();
  const bus = nats([], { env: { NATS_URL: stopped.url } });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    const failure = await scope.ready.then(
      () => expect.unreachable(),
      (error: unknown) => error,
    );
    expect(await scope.close()).toMatchObject({
      status: "failed",
      error: failure,
      teardownErrors: undefined,
    });
  } finally {
    await scope.close();
  }
});

test("graceful close during namespace setup leaves no late borrowed subscription", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const peer = await connect({ servers: server.url });
  const receive = operation({
    label: "receive",
    run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => undefined,
  });
  let loads = 0;
  const bus = nats(
    [
      subscribe("late", async () => {
        loads++;
        if (loads === 2) {
          started.resolve();
          await release.promise;
        }
        return receive;
      }),
    ],
    { env: { NATS_URL: server.url } },
  );
  const west = namespace({ tags: [bus.config({ url: server.url, connection: peer })] });
  const scope = createScope({ extensions: [bus.extension] });
  try {
    await scope.ready;
    const preparing = scope.resolve(bus.connection, { ns: west });
    await started.promise;
    const closing = scope.close({ graceful: true });
    await peer.flush();
    release.resolve();
    await preparing;
    expect(await closing).toEqual({ status: "success" });
    const received = peer.stats().inMsgs;
    peer.publish("late", message.payload);
    await peer.flush();
    expect(peer.stats().inMsgs).toBe(received);
  } finally {
    release.resolve();
    await scope.close();
    await peer.close();
  }
});

test("forced close stops pending setup before later subscription loaders run", async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const peer = await connect({ servers: server.url });
  const loads: string[] = [];
  const receive = operation({
    label: "receive",
    run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => undefined,
  });
  const bus = nats([
    subscribe("first", async () => {
      loads.push("first");
      started.resolve();
      await release.promise;
      return receive;
    }),
    subscribe("second", () => {
      loads.push("second");
      return receive;
    }),
  ]);
  const scope = createScope({
    tags: [bus.config({ url: server.url, connection: peer })],
    extensions: [bus.extension],
  });
  try {
    await started.promise;
    const closing = scope.close();
    release.resolve();
    const result = await closing;
    if (result.status !== "failed") expect.unreachable();
    await expect(scope.ready).rejects.toBe(result.error);
    expect(loads).toEqual(["first"]);
  } finally {
    release.resolve();
    await scope.close();
    await peer.close();
  }
});
