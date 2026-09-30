import { once } from "node:events";
import { connect } from "node:net";
import { createScope, extension, operation } from "@tinker/core";
import { emit, hono, route, stream } from "@tinker/hono";
import { expect, test } from "vite-plus/test";
import { jsonLines, readExitCode, server } from "../src/index.ts";
import { readFreePort } from "./fixtures.ts";

const answer = operation({ label: "answer", run: () => "ready" });

test("a server piece restarts after close", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const lines: string[] = [];
  const observe = jsonLines((line) => lines.push(line));
  const web = hono([route.get("/ready", answer)]).extension;
  const piece = server(web, { env, clientDir: "/missing-client", observe });
  const url = `http://${env.HOST}:${env.PORT}/ready`;
  for (let round = 0; round < 2; round++) {
    const scope = createScope({ extensions: [piece, web], observe });
    try {
      await scope.ready;
      expect(await (await fetch(url)).json()).toBe("ready");
    } finally {
      await scope.close({ graceful: true });
    }
    await expect(fetch(url)).rejects.toThrow();
  }
  expect(
    lines.map((line) => JSON.parse(line)).filter((line) => line.message === "listening"),
  ).toHaveLength(2);
});

test("a second live root cannot take or stop the server piece", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const web = hono([route.get("/ready", answer)]).extension;
  const piece = server(web, { env, clientDir: "/missing-client" });
  const drained = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const tail = extension({
    label: "tail",
    close: async (_options, next) => {
      const result = await next();
      drained.resolve();
      await release.promise;
      return result;
    },
  });
  const owner = createScope({ extensions: [piece, web, tail] });
  try {
    await owner.ready;
    const refused = createScope({ extensions: [piece, web] });
    try {
      await expect(refused.ready).rejects.toMatchObject({
        kind: "PieceInUse",
        payload: { label: "stack.server" },
      });
    } finally {
      await refused.close({ graceful: true });
    }
    expect(await (await fetch(`http://${env.HOST}:${env.PORT}/ready`)).json()).toBe("ready");
    const closing = owner.close({ graceful: true });
    await drained.promise;
    const duringClose = createScope({ extensions: [piece, web] });
    try {
      await expect(duringClose.ready).rejects.toMatchObject({
        kind: "PieceInUse",
        payload: { label: "stack.server" },
      });
    } finally {
      release.resolve();
      await duringClose.close({ graceful: true });
      await closing;
    }
  } finally {
    release.resolve();
    await owner.close({ graceful: true });
  }
});

test("an old root's second close keeps the new server owner", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const web = hono([route.get("/ready", answer)]).extension;
  const piece = server(web, { env, clientDir: "/missing-client" });
  const first = createScope({ extensions: [piece, web] });
  const roots = [first];
  try {
    await first.ready;
    const result = await first.close({ graceful: true });
    expect(result).toEqual({ status: "success" });
    const second = createScope({ extensions: [piece, web] });
    roots.push(second);
    await second.ready;
    expect(await first.close({ graceful: true })).toEqual(result);
    const refused = createScope({ extensions: [piece, web] });
    roots.push(refused);
    await expect(refused.ready).rejects.toMatchObject({
      kind: "PieceInUse",
      payload: { label: "stack.server" },
    });
    await refused.close({ graceful: true });
    expect(await (await fetch(`http://${env.HOST}:${env.PORT}/ready`)).json()).toBe("ready");
  } finally {
    for (const root of roots.reverse()) await root.close({ graceful: true });
  }
});

test("a failed start closes its listener and frees the server piece", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const web = hono([route.get("/ready", answer)]).extension;
  const failure = new Error("log sink closed");
  let fail = true;
  const piece = server(web, {
    env,
    clientDir: "/missing-client",
    observe: {
      log: () => {
        if (fail) {
          fail = false;
          throw failure;
        }
      },
    },
  });
  const first = createScope({ extensions: [piece, web] });
  const roots = [first];
  const url = `http://${env.HOST}:${env.PORT}/ready`;
  try {
    await expect(first.ready).rejects.toBe(failure);
    await expect
      .poll(() =>
        fetch(url).then(
          () => false,
          () => true,
        ),
      )
      .toBe(true);
    const second = createScope({ extensions: [piece, web] });
    roots.push(second);
    await second.ready;
    expect(await (await fetch(url)).json()).toBe("ready");
  } finally {
    for (const root of roots.reverse()) await root.close({ graceful: true });
  }
});

test("stop closes the keep-alive socket after the last stream chunk", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const release = Promise.withResolvers<void>();
  const body = operation({
    label: "body",
    depends: { emit: emit.required },
    run: async ({ emit }) => {
      emit("first");
      await release.promise;
      emit("last");
    },
  });
  const web = hono([
    route.get("/ready", answer),
    route.get("/stream", answer, { respond: (_value, c) => stream(c, body) }),
  ]).extension;
  const scope = createScope({
    extensions: [server(web, { env, clientDir: "/missing-client" }), web],
  });
  await scope.ready;
  const socket = connect({ host: env.HOST, port: Number(env.PORT) });
  let wire = "";
  let closed = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    wire += chunk;
  });
  socket.once("close", () => {
    closed = true;
  });
  try {
    await once(socket, "connect");
    socket.write("GET /ready HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await expect.poll(() => wire).toContain('"ready"');
    wire = "";
    socket.write("GET /stream HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
    await expect.poll(() => wire).toContain("first");
    const closing = scope.close({ graceful: true });
    release.resolve();
    await expect.poll(() => closed).toBe(true);
    expect(wire).toContain("last\r\n0\r\n\r\n");
    expect(await closing).toEqual({ status: "success" });
    await expect(fetch(`http://${env.HOST}:${env.PORT}/ready`)).rejects.toThrow();
  } finally {
    release.resolve();
    socket.destroy();
    await scope.close({ graceful: true });
  }
});

test("opens the port only after every other start finishes", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const later = extension({
    label: "later",
    start: async (_scope, _ctx, next) => {
      await next();
      entered.resolve();
      await release.promise;
    },
  });
  const lines: string[] = [];
  const observe = jsonLines((line) => lines.push(line));
  const web = hono([route.get("/ready", answer)]).extension;
  const scope = createScope({
    extensions: [server(web, { env, clientDir: "/missing-client", observe }), web, later],
    observe,
  });
  const base = `http://${env.HOST}:${env.PORT}`;
  try {
    await entered.promise;
    await expect(fetch(`${base}/ready`)).rejects.toThrow();
    release.resolve();
    await scope.ready;
    expect(await (await fetch(`${base}/ready`)).json()).toBe("ready");
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        kind: "log",
        message: "listening",
        host: env.HOST,
        port: Number(env.PORT),
      }),
    );
  } finally {
    release.resolve();
    await scope.close();
  }
  await expect(fetch(`${base}/ready`)).rejects.toThrow();
});

test("a stop refuses new requests while it waits for an in-flight request", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const closing = Promise.withResolvers<void>();
  const slow = operation({
    label: "slow",
    run: async (_deps, ctx) => {
      entered.resolve();
      await release.promise;
      return { aborted: ctx.signal.aborted };
    },
  });
  const web = hono([route.get("/slow", slow)]).extension;
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    extensions: [
      server(web, { env, clientDir: "/missing-client" }),
      web,
      extension({
        label: "closing",
        close: (_opts, next) => {
          closing.resolve();
          return next();
        },
      }),
    ],
  });
  const ended = scope.closed.then((result) =>
    readExitCode(result, { clock: Date.now }, "shutdown"),
  );
  let didEnd = false;
  const joined = ended.then((code) => {
    didEnd = true;
    return code;
  });
  try {
    await scope.ready;
    const request = fetch(`http://${env.HOST}:${env.PORT}/slow`);
    await entered.promise;
    stop.abort();
    await closing.promise;
    expect(didEnd).toBe(false);
    await expect(fetch(`http://${env.HOST}:${env.PORT}/late`)).rejects.toThrow();
    release.resolve();
    expect(await (await request).json()).toEqual({ aborted: false });
    expect(await joined).toBe(0);
    await expect(fetch(`http://${env.HOST}:${env.PORT}/slow`)).rejects.toThrow();
  } finally {
    release.resolve();
    stop.abort();
    await joined;
  }
});

test.each(["127.0.0.1", "::1"])(
  "an already stopped signal closes after boot and answers zero (%s)",
  async (HOST) => {
    const env = { HOST, PORT: await readFreePort() };
    const web = hono([]).extension;
    const scope = createScope({
      extensions: [server(web, { env, clientDir: "/missing" }), web],
      signal: AbortSignal.abort(),
    });
    const lines: string[] = [];
    expect(
      readExitCode(
        await scope.closed,
        {
          ...jsonLines((line) => lines.push(line)),
          clock: Date.now,
        },
        "shutdown",
      ),
    ).toBe(0);
    expect(lines).toEqual([]);
    await expect(
      fetch(`http://[${env.HOST === "::1" ? "::1" : "::ffff:127.0.0.1"}]:${env.PORT}/`),
    ).rejects.toThrow();
  },
);

test("failed boot waits for cleanup before logging and answering one", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const cleaned = Promise.withResolvers<void>();
  const cleaning = Promise.withResolvers<void>();
  const afterClose = Promise.withResolvers<void>();
  const finishClose = Promise.withResolvers<void>();
  const web = hono([]).extension;
  const broken = extension({
    label: "broken",
    start: (_scope, ctx) => {
      ctx.defer(() => {
        cleaning.resolve();
        return cleaned.promise;
      });
      throw new Error("boot broke");
    },
    close: async (_options, next) => {
      const result = await next();
      afterClose.resolve();
      await finishClose.promise;
      return result;
    },
  });
  const scope = createScope({
    extensions: [server(web, { env, clientDir: "/missing" }), web, broken],
    signal: new AbortController().signal,
  });
  const lines: string[] = [];
  const observe = { ...jsonLines((line) => lines.push(line)), clock: () => 42 };
  const ended = scope.closed.then((result) => readExitCode(result, observe, "boot"));
  try {
    await cleaning.promise;
    expect(lines).toEqual([]);
    await expect(fetch(`http://${env.HOST}:${env.PORT}/`)).rejects.toThrow();
    cleaned.resolve();
    await afterClose.promise;
    expect(lines).toEqual([]);
  } finally {
    cleaned.resolve();
    finishClose.resolve();
  }
  expect(await ended).toBe(1);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      kind: "log",
      time: 42,
      level: 50,
      message: "boot failed",
      error: "boot broke",
    }),
  ]);
});

test("a failed boot with teardown errors logs both on one boot failed line", async () => {
  const cleanup = extension({
    label: "cleanup",
    start: (scope, _ctx, next) => {
      scope.onClose(() => {
        throw new Error("close broke");
      });
      return next();
    },
  });
  const broken = extension({
    label: "broken",
    start: () => {
      throw new Error("boot broke");
    },
  });
  const scope = createScope({
    extensions: [cleanup, broken],
    signal: new AbortController().signal,
  });
  const lines: string[] = [];
  const observe = { ...jsonLines((line) => lines.push(line)), clock: () => 42 };
  expect(readExitCode(await scope.closed, observe, "boot")).toBe(1);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    {
      kind: "log",
      time: 42,
      level: 50,
      message: "boot failed",
      error: "boot broke",
      name: "Error",
      stack: expect.any(String),
      teardown: [{ error: "close broke", name: "Error", stack: expect.any(String) }],
    },
  ]);
});

test("a failed close logs shutdown failed and answers one", async () => {
  const failed = operation({
    label: "failed",
    run: async () => {
      throw new Error("work broke");
    },
  });
  const stop = new AbortController();
  const scope = createScope({ signal: stop.signal });
  await scope.ready;
  await expect(scope.run(failed)).rejects.toThrow();
  stop.abort();
  const lines: string[] = [];
  expect(
    readExitCode(
      await scope.closed,
      {
        ...jsonLines((line) => lines.push(line)),
        clock: Date.now,
      },
      "shutdown",
    ),
  ).toBe(1);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      message: "shutdown failed",
      error: "work broke",
      time: expect.any(Number),
      level: 50,
    }),
  ]);
});

test("teardown errors log shutdown failed and answer one", async () => {
  const stop = new AbortController();
  const scope = createScope({ signal: stop.signal });
  scope.onClose(() => {
    throw new Error("close broke");
  });
  stop.abort();
  const lines: string[] = [];
  expect(
    readExitCode(
      await scope.closed,
      {
        ...jsonLines((line) => lines.push(line)),
        clock: Date.now,
      },
      "shutdown",
    ),
  ).toBe(1);
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({
      message: "shutdown failed",
      teardown: [expect.objectContaining({ error: "close broke" })],
    }),
  ]);
});

test("a port already in use fails boot without closing its owner", async () => {
  const env = { HOST: "127.0.0.1", PORT: await readFreePort() };
  const first = hono([route.get("/ready", answer)]).extension;
  const owner = createScope({ extensions: [server(first, { env, clientDir: "/missing" }), first] });
  const second = hono([]).extension;
  await owner.ready;
  const refused = createScope({
    extensions: [server(second, { env, clientDir: "/missing" }), second],
    signal: new AbortController().signal,
  });
  try {
    const lines: string[] = [];
    expect(
      readExitCode(
        await refused.closed,
        {
          ...jsonLines((line) => lines.push(line)),
          clock: Date.now,
        },
        "boot",
      ),
    ).toBe(1);
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({ message: "boot failed" }),
    );
    expect(await (await fetch(`http://${env.HOST}:${env.PORT}/ready`)).json()).toBe("ready");
  } finally {
    await owner.close();
  }
});

test.each([
  { detail: "without teardown errors", broken: false, code: 0 },
  { detail: "with teardown errors", broken: true, code: 1 },
])("a cancelled root $detail answers $code", async ({ broken, code }) => {
  const release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const waiting = operation({
    label: "waiting",
    run: () => {
      entered.resolve();
      return release.promise;
    },
  });
  const scope = createScope({ signal: new AbortController().signal });
  await scope.ready;
  if (broken)
    scope.onClose(() => {
      throw new Error("cancel cleanup broke");
    });
  const work = scope.run(waiting);
  await entered.promise;
  const closing = scope.close();
  release.resolve();
  await work;
  await closing;
  const result = await scope.closed;
  expect(result.status).toBe("cancelled");
  const lines: string[] = [];
  expect(
    readExitCode(
      result,
      {
        ...jsonLines((line) => lines.push(line)),
        clock: Date.now,
      },
      "shutdown",
    ),
  ).toBe(code);
  expect(lines.map((line) => JSON.parse(line))).toEqual(
    broken
      ? [
          expect.objectContaining({
            message: "shutdown failed",
            teardown: [expect.objectContaining({ error: "cancel cleanup broke" })],
          }),
        ]
      : [],
  );
});
