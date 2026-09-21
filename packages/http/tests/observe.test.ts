import { expect, test } from "vite-plus/test";
import { createScope, operation, type Observe } from "@tinker/core";
import {
  backend,
  httpClient,
  HttpRequest,
  HttpResponse,
  isError as isHttpError,
  type HttpClient,
} from "../src/index.ts";

const github = httpClient({ label: "github" });

/** A closure backend that records every request it was given and answers `body` at `status`. */
function recording(body: string, seen: HttpRequest.Record[], status = 200): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status, body });
  };
}

/** Parse a bare string into a trimmed username (the `{ rawInput }` path runs it). */
function parseUser(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("bad user");
  return raw.trim();
}

const listRepos = operation({
  label: "github.listRepos",
  input: parseUser,
  depends: { send: github.send },
  run: async ({ send }, ctx) => {
    const received = await send.run({
      input: HttpRequest.get(`/users/${ctx.input}/repos`, {
        urlParams: { per_page: "100" },
      }),
    });
    return received.text();
  },
});

const url = "https://api/users/octocat/repos?per_page=100";

test("a request opens one attempt span with method, url, and status", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    observe: { history: 20 },
    tags: [backend(recording("[]", seen)), github.config({ baseUrl: "https://api" })],
  });
  await scope.run(listRepos, { input: "octocat" });
  const spans = scope.spans();
  const op = spans.find((span) => span.name === "github.listRepos");
  expect(op?.kind).toBe("operation");
  const send = spans.find((span) => span.parentId === op?.id && span.name === "github.send");
  expect(send?.kind).toBe("operation");
  const child = spans.find((span) => span.parentId === send?.id && span.name === "github.attempt");
  expect(child?.kind).toBe("operation");
  expect(child?.status).toBe("ok");
  expect(child?.attributes).toEqual({ method: "GET", url, status: 200, attempt: 1 });
  await scope.close();
});

test("a backend failure marks the child failed and logs one line", async () => {
  const boom = new Error("boom");
  const failing: HttpClient.Backend = async () => {
    throw boom;
  };
  const logs: Observe.Log[] = [];
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    tags: [backend(failing), github.config({ baseUrl: "https://api" })],
  });
  try {
    await scope.run(listRepos, { input: "octocat" });
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "RequestFailed")) throw error;
    expect(error.payload.reason).toBe("Transport");
  }
  const spans = scope.spans();
  const op = spans.find((span) => span.name === "github.listRepos");
  const send = spans.find((span) => span.parentId === op?.id && span.name === "github.send");
  const child = spans.find((span) => span.parentId === send?.id && span.name === "github.attempt");
  expect(child?.status).toBe("failed");
  expect(logs.length).toBe(1);
  expect(logs[0].message).toBe("http request failed");
  expect(logs[0].attributes.method).toBe("GET");
  expect(logs[0].attributes.url).toBe(url);
  expect(logs[0].span?.id).toBe(child?.id);
  await scope.close();
});

test("a rejected status marks the child failed and logs nothing", async () => {
  const strict = httpClient({ label: "strict", filterStatus: (status) => status < 300 });
  const strictRepos = operation({
    label: "strict.repos",
    depends: { send: strict.send },
    run: ({ send }, ctx) => send.run({ input: HttpRequest.get("https://api/repos") }),
  });
  const logs: Observe.Log[] = [];
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    tags: [backend(recording("nope", [], 404)), strict.config({})],
  });
  try {
    await scope.run(strictRepos);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("StatusCode");
  }
  const child = scope.spans().find((span) => span.name === "strict.attempt");
  expect(child?.kind).toBe("operation");
  expect(child?.status).toBe("failed");
  expect(child?.attributes.status).toBe(404);
  expect(logs.length).toBe(0);
  await scope.close();
});

test("with observation off the request succeeds and no span is kept", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording("[]", seen)), github.config({ baseUrl: "https://api" })],
  });
  expect(await scope.run(listRepos, { input: "octocat" })).toBe("[]");
  expect(scope.spans().length).toBe(0);
  await scope.close();
});

test("a forced close while parked rejects with the abort reason, logs nothing, child failed", async () => {
  const parking: HttpClient.Backend = (_request, signal) =>
    new Promise<HttpResponse.Handle>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const logs: Observe.Log[] = [];
  const scope = createScope({
    observe: { history: 20, log: (entry) => logs.push(entry) },
    tags: [backend(parking), github.config({ baseUrl: "https://api" })],
  });
  const running = scope.run(listRepos, { input: "octocat" });
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
  expect(logs.length).toBe(0);
  const child = scope.spans().find((span) => span.name === "github.attempt");
  expect(child?.status).toBe("failed");
});
