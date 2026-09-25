import { expect, test } from "vite-plus/test";
import { createScope, isError as isCoreError, operation } from "@tinker/core";
import {
  backend,
  config,
  HttpRequest,
  HttpResponse,
  isError as isHttpError,
  mergeConfig,
  send,
  type HttpClient,
} from "../src/index.ts";

/** A closure backend that records the request it was given and answers `body` at `status`. */
function recording(body: string, seen: HttpRequest.Record[], status = 200): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status, body });
  };
}

const listUsers = operation({
  label: "listUsers",
  depends: { send },
  run: ({ send: sendIt }) =>
    sendIt.run({
      input: HttpRequest.get("/users", {
        headers: { x: "req" },
        urlParams: { page: "2" },
        hash: "top",
      }),
    }),
});

test("a scope-bound backend receives the merged url and headers, and delivers its response", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(recording("[]", seen)),
      config({ baseUrl: "https://api", headers: { a: "1", x: "cfg" } }),
    ],
  });
  const res = await scope.run(listUsers);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("[]");
  expect(seen.length).toBe(1);
  const sent = seen[0];
  expect(HttpRequest.toUrl(sent)).toBe("https://api/users?page=2#top");
  expect(sent.headers["a"]).toBe("1");
  expect(sent.headers["x"]).toBe("req");
  await scope.close();
});

test("scope, session, and per-call config bindings merge nearest-first", async () => {
  const seen: HttpRequest.Record[] = [];
  const callChild = operation({
    label: "callChild",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("/users") }),
  });
  const scope = createScope({
    tags: [backend(recording("[]", seen)), config({ baseUrl: "https://api", headers: { a: "1" } })],
  });
  await scope.run(callChild);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://api/users");
  const readConfig = operation({
    label: "readConfig",
    depends: { all: config.all },
    run: ({ all }) => mergeConfig(all),
  });
  const session = scope.createSession({
    tags: [config({ headers: { b: "2" } })],
  });
  const merged = await session.controller(readConfig).run({
    tags: [config({ baseUrl: "https://other" })],
  });
  expect(merged.baseUrl).toBe("https://other");
  expect(merged.headers).toEqual({ a: "1", b: "2" });
  await session.run(callChild);
  const sent = seen[seen.length - 1];
  expect(HttpRequest.toUrl(sent)).toBe("https://api/users");
  expect(sent.headers["a"]).toBe("1");
  expect(sent.headers["b"]).toBe("2");
  await scope.close();
});

test("a session-bound backend serves the session", async () => {
  const atScope: HttpRequest.Record[] = [];
  const atSession: HttpRequest.Record[] = [];
  const scope = createScope({ tags: [backend(recording("scope", atScope))] });
  const session = scope.createSession({ tags: [backend(recording("session", atSession))] });
  const call = operation({
    label: "call",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/users") }),
  });
  const fromSession = await session.run(call);
  expect(await fromSession.text()).toBe("session");
  expect(atSession.length).toBe(1);
  expect(atScope.length).toBe(0);
  await scope.close();
});

test("the scope keeps its own backend beside a session binding", async () => {
  const atScope: HttpRequest.Record[] = [];
  const scope = createScope({ tags: [backend(recording("scope", atScope))] });
  scope.createSession({ tags: [backend(recording("session", []))] });
  const call = operation({
    label: "call",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/users") }),
  });
  const fromScope = await scope.run(call);
  expect(await fromScope.text()).toBe("scope");
  expect(atScope.length).toBe(1);
  await scope.close();
});

test("no base url plus a relative path rejects RequestFailed/InvalidUrl", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({ tags: [backend(recording("[]", seen))] });
  const relative = operation({
    label: "relative",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("/users") }),
  });
  try {
    await scope.run(relative);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "RequestFailed")) throw error;
    expect(error.payload.reason).toBe("InvalidUrl");
    expect(error.payload.request.url).toBe("/users");
  }
  await scope.close();
});

test("a backend that throws rejects RequestFailed/Transport with the cause", async () => {
  const cause = new Error("down");
  const broken: HttpClient.Backend = () => Promise.reject(cause);
  const scope = createScope({ tags: [backend(broken)] });
  const call = operation({
    label: "call",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/users") }),
  });
  try {
    await scope.run(call);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "RequestFailed")) throw error;
    expect(error.payload.reason).toBe("Transport");
    expect(error.payload.cause).toBe(cause);
  }
  await scope.close();
});

test("a forced close while the backend parks on the signal rejects with the abort reason", async () => {
  const parking: HttpClient.Backend = (_request, signal) =>
    new Promise<HttpResponse.Handle>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const scope = createScope({ observe: { history: 20 }, tags: [backend(parking)] });
  const call = operation({
    label: "call",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/users") }),
  });
  const running = scope.run(call);
  await Promise.resolve();
  const closing = scope.close();
  const outcome = await running.then(
    () => "resolved",
    (error: unknown) => error,
  );
  const result = await closing;
  expect(result.status).toBe("cancelled");
  if (result.status !== "cancelled") throw result;
  expect(outcome).toBe(result.reason);
});

test("a response delivered after a forced close is returned; the close still reports cancelled", async () => {
  let deliver: (() => void) | undefined;
  const late: HttpClient.Backend = (request) =>
    new Promise<HttpResponse.Handle>((resolve) => {
      deliver = () => resolve(HttpResponse.make(request, { status: 200, body: "late" }));
    });
  const scope = createScope({ tags: [backend(late)] });
  const call = operation({
    label: "call",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/users") }),
  });
  const running = scope.run(call);
  for (let i = 0; i < 100 && deliver === undefined; i += 1) await Promise.resolve();
  if (deliver === undefined) throw new Error("the backend was never reached");
  const closing = scope.close();
  deliver();
  const received = await running;
  expect(received.status).toBe(200);
  expect((await closing).status).toBe("cancelled");
});

test("a backend failure the forced close lands on rejects with the abort reason", async () => {
  const cause = new Error("connection reset");
  const failing: HttpClient.Backend = () => Promise.reject(cause);
  const scope = createScope({
    observe: {
      log: (entry) => {
        if (entry.message === "http request failed") void scope.close();
      },
    },
    tags: [backend(failing)],
  });
  const call = operation({
    label: "call",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/users") }),
  });
  const outcome = await scope.run(call).then(
    () => "resolved",
    (error: unknown) => error,
  );
  const result = await scope.close();
  if (result.status !== "cancelled") throw result;
  expect(outcome).toBe(result.reason);
});

test("streaming a bodiless response rejects NoBody with the status", async () => {
  const nodata = operation({
    label: "github.nodata",
    depends: { send },
    run: async ({ send: sendIt }) => {
      const received = await sendIt.run({
        input: HttpRequest.get("https://api/empty"),
      });
      return received.stream();
    },
  });
  const empty: HttpClient.Backend = async (request) =>
    HttpResponse.make(request, { status: 204, body: null });
  const scope = createScope({ tags: [backend(empty)] });
  try {
    await scope.run(nodata);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "NoBody")) throw error;
    expect(error.payload.status).toBe(204);
  }
  await scope.close();
});

test("a close in the same tick surfaces Disposed, never a transport failure", async () => {
  const parked = backend(
    (_request, signal) =>
      new Promise<HttpResponse.Handle>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const call = operation({
    label: "call",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("https://api/users") }),
  });
  const scope = createScope({ tags: [parked] });
  const running = scope.run(call);
  void scope.close();
  try {
    await running;
    expect.unreachable();
  } catch (error) {
    if (!isCoreError(error, "Disposed")) throw error;
    expect(isHttpError(error, "RequestFailed")).toBe(false);
  }
});
