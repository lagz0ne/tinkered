import { expect, test } from "vite-plus/test";
import { createScope, operation } from "@tinker/core";
import {
  applyConfig,
  backend,
  httpClient,
  HttpRequest,
  HttpResponse,
  isError as isHttpError,
  mergeConfig,
  type HttpClient,
} from "../src/index.ts";

const github = httpClient({ label: "github" });

/** A closure backend that records the request it was given and answers `body` at `status`. */
function recording(body: string, seen: HttpRequest.Record[], status = 200): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status, body });
  };
}

const listUsers = operation({
  label: "listUsers",
  depends: { client: github.client, config: github.config.all },
  run: ({ client, config }, ctx) =>
    client.execute(
      applyConfig(
        HttpRequest.get("/users", {
          headers: { x: "req" },
          urlParams: { page: "2" },
          hash: "top",
        }),
        mergeConfig(config),
      ),
      ctx,
    ),
});

test("a scope-bound backend receives the merged url and headers, and delivers its response", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(recording("[]", seen)),
      github.config({ baseUrl: "https://api", headers: { a: "1", x: "cfg" } }),
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
  const child = httpClient({ label: "child" });
  const callChild = operation({
    label: "callChild",
    depends: { client: child.client, config: child.config.all },
    run: ({ client, config }, ctx) =>
      client.execute(applyConfig(HttpRequest.get("/users"), mergeConfig(config)), ctx),
  });
  const scope = createScope({
    tags: [
      backend(recording("[]", seen)),
      child.config({ baseUrl: "https://api", headers: { a: "1" } }),
    ],
  });
  await scope.run(callChild);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://api/users");
  const readConfig = operation({
    label: "readConfig",
    depends: { config: child.config.all },
    run: ({ config }) => mergeConfig(config),
  });
  const session = scope.createSession({
    tags: [child.config({ headers: { b: "2" } })],
  });
  const merged = await session.controller(readConfig).run({
    tags: [child.config({ baseUrl: "https://other" })],
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
    depends: { client: github.client },
    run: ({ client }, ctx) => client.execute(HttpRequest.get("https://api/users"), ctx),
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
    depends: { client: github.client },
    run: ({ client }, ctx) => client.execute(HttpRequest.get("https://api/users"), ctx),
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
    depends: { client: github.client },
    run: ({ client }, ctx) => client.execute(HttpRequest.get("/users"), ctx),
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
    depends: { client: github.client },
    run: ({ client }, ctx) => client.execute(HttpRequest.get("https://api/users"), ctx),
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
  const scope = createScope({ tags: [backend(parking)] });
  const call = operation({
    label: "call",
    depends: { client: github.client },
    run: ({ client }, ctx) => client.execute(HttpRequest.get("https://api/users"), ctx),
  });
  const running = scope.run(call);
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

test("fromWeb delegates readers to the web response", async () => {
  const req = HttpRequest.get("https://api/users");
  const source = new Response("x");
  const res = HttpResponse.fromWeb(req, source);
  expect(res.status).toBe(200);
  expect(res.source).toBe(source);
  expect(await res.text()).toBe("x");
});

test("streaming a bodiless response rejects NoBody with the status", async () => {
  const nodata = github.operation({
    label: "nodata",
    request: () => HttpRequest.get("https://api/empty"),
    response: (res) => res.stream(),
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
