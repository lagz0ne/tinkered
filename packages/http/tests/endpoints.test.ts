import { expect, test } from "vite-plus/test";
import { createScope, operation, preset, type Scope } from "@tinker/core";
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

/** Parse the repos JSON payload into a list of names. */
function parseRepos(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("bad repos");
  return raw.map((repo) => {
    if (typeof repo !== "object" || repo === null || !("name" in repo)) {
      throw new Error("bad repo");
    }
    return String((repo as { name: unknown }).name);
  });
}

const listRepos = github.operation({
  label: "listRepos",
  input: parseUser,
  request: (user) => HttpRequest.get(`/users/${user}/repos`, { urlParams: { per_page: "100" } }),
  response: (res) => res.json(parseRepos),
});

test("an endpoint resolves input, sends the built request, and reads the body", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording('[{"name":"a"}]', seen)), github.config({ baseUrl: "https://api" })],
  });
  const repos = await scope.run(listRepos, { input: "octocat" });
  expect(repos).toEqual(["a"]);
  expect(HttpRequest.toUrl(seen[0])).toBe("https://api/users/octocat/repos?per_page=100");
  expect(listRepos.label).toBe("github.listRepos");
  const trimmed = await scope.run(listRepos, { rawInput: " octocat " });
  expect(trimmed).toEqual(["a"]);
  await scope.close();
});

test("an endpoint without a response reader delivers the raw handle", async () => {
  const seen: HttpRequest.Record[] = [];
  const marker = { marker: true };
  const raw = github.operation({
    label: "raw",
    request: () => HttpRequest.get("https://api/users"),
  });
  const headed: HttpClient.Backend = async (request) => {
    seen.push(request);
    return HttpResponse.make(request, {
      status: 200,
      body: "hi",
      headers: { "X-Up": "1" },
      source: marker,
    });
  };
  const scope = createScope({ tags: [backend(headed)] });
  const res = await scope.run(raw);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hi");
  expect(res.headers["x-up"]).toBe("1");
  expect(res.source).toBe(marker);
  await scope.close();
});

test("a composing operation hands a fresh token to one subflow call via tags", async () => {
  const seen: HttpRequest.Record[] = [];
  const authed = operation({
    label: "authed",
    input: parseUser,
    depends: { repos: listRepos },
    run: ({ repos }, ctx) =>
      repos.run({
        input: ctx.input,
        tags: [github.config({ headers: { authorization: "Bearer fresh" } })],
      }),
  });
  const scope = createScope({
    tags: [backend(recording("[]", seen)), github.config({ baseUrl: "https://api" })],
  });
  await scope.run(authed, { input: "octocat" });
  expect(seen[seen.length - 1].headers["authorization"]).toBe("Bearer fresh");
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe(
    "https://api/users/octocat/repos?per_page=100",
  );
  await scope.run(listRepos, { input: "octocat" });
  expect(seen[seen.length - 1].headers["authorization"]).toBe(undefined);
  await scope.close();
});

test("a json post travels through an endpoint and the backend sees the record", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording("ok", seen)), github.config({ baseUrl: "https://api" })],
  });
  const createIssue = github.operation({
    label: "createIssue",
    request: () => HttpRequest.post("/issues", { body: HttpRequest.bodyJson({ title: "t" }) }),
    response: (res) => res.text(),
  });
  expect(await scope.run(createIssue)).toBe("ok");
  const sent = seen[seen.length - 1];
  expect(sent.method).toBe("POST");
  if (sent.body.kind !== "text") throw sent;
  expect(sent.body.contentType).toBe("application/json");
  expect(sent.body.text).toBe('{"title":"t"}');
  await scope.close();
});

test("put, patch, delete, head, and options travel through endpoints", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording("ok", seen)), github.config({ baseUrl: "https://api" })],
  });
  const verbs: [string, HttpRequest.Record][] = [
    ["PUT", HttpRequest.put("https://api/a")],
    ["PATCH", HttpRequest.patch("https://api/a")],
    ["DELETE", HttpRequest.del("https://api/a")],
    ["HEAD", HttpRequest.head("https://api/a")],
    ["OPTIONS", HttpRequest.options("https://api/a")],
  ];
  for (const [verb, record] of verbs) {
    const endpoint = github.operation({ label: verb, request: () => record });
    await scope.run(endpoint);
    expect(seen[seen.length - 1].method).toBe(verb);
  }
  await scope.close();
});

test("url-params bodies travel through endpoints", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording("ok", seen)), github.config({ baseUrl: "https://api" })],
  });
  const forms = github.operation({
    label: "forms",
    request: () =>
      HttpRequest.post("https://api/form", {
        body: HttpRequest.bodyUrlParams({ q: "x" }),
      }),
  });
  await scope.run(forms);
  expect(seen[seen.length - 1].body.kind).toBe("urlParams");
  await scope.close();
});

test("form bodies travel through endpoints", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording("ok", seen)), github.config({ baseUrl: "https://api" })],
  });
  const form = new FormData();
  form.append("k", "v");
  const multipart = github.operation({
    label: "multipart",
    request: () => HttpRequest.post("https://api/multi", { body: HttpRequest.bodyFormData(form) }),
  });
  await scope.run(multipart);
  expect(seen[seen.length - 1].body.kind).toBe("formData");
  await scope.close();
});

test("modify, appendUrl, and setHeader derive the record the backend sees", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording("ok", seen)), github.config({ baseUrl: "https://api" })],
  });
  const derived = HttpRequest.modify(
    HttpRequest.appendUrl(
      HttpRequest.setHeader(
        HttpRequest.post("/base", { body: HttpRequest.bodyText("b"), headers: { x: "1" } }),
        "y",
        "2",
      ),
      "/more",
    ),
    { urlParams: { p: "1" } },
  );
  const viaModify = github.operation({ label: "viaModify", request: () => derived });
  await scope.run(viaModify);
  const sent = seen[seen.length - 1];
  expect(HttpRequest.toUrl(sent)).toBe("https://api/base/more?p=1");
  expect(sent.headers["x"]).toBe("1");
  expect(sent.headers["y"]).toBe("2");
  await scope.close();
});

test("setUrlParams replaces the pairs the backend sees", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [backend(recording("ok", seen)), github.config({ baseUrl: "https://api" })],
  });
  const replaced = HttpRequest.setUrlParams(HttpRequest.get("/a", { urlParams: { p: "1" } }), {
    p: "2",
  });
  const viaParams = github.operation({ label: "viaParams", request: () => replaced });
  await scope.run(viaParams);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://api/a?p=2");
  await scope.close();
});

test("the frame filterStatus rejects a bad status before the response reader runs", async () => {
  const seen: HttpRequest.Record[] = [];
  const strict = httpClient({ label: "strict", filterStatus: (status) => status < 300 });
  let readerCalls = 0;
  const strictRepos = strict.operation({
    label: "repos",
    request: () => HttpRequest.get("https://api/repos"),
    response: (res) => {
      readerCalls += 1;
      return res.text();
    },
  });
  const loose = httpClient({ label: "loose" });
  const scope = createScope({
    tags: [backend(recording("nope", seen, 404)), strict.config({}), loose.config({})],
  });
  try {
    await scope.run(strictRepos);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("StatusCode");
    expect(error.payload.response.status).toBe(404);
    expect(await error.payload.response.text()).toBe("nope");
  }
  expect(readerCalls).toBe(0);
  await scope.close();
});

test("without filterStatus a bad status arrives raw", async () => {
  const loose = httpClient({ label: "loose" });
  const looseRepos = loose.operation({
    label: "repos",
    request: () => HttpRequest.get("https://api/repos"),
  });
  const scope = createScope({
    tags: [backend(recording("nope", [], 404)), loose.config({})],
  });
  const raw = await scope.run(looseRepos);
  expect(raw.status).toBe(404);
  await scope.close();
});

test("filterStatusOk rejects a bad status inside a response reader", async () => {
  const scope = createScope({ tags: [backend(recording("x", [], 500))] });
  const broken = github.operation({
    label: "broken",
    request: () => HttpRequest.get("https://api/a"),
    response: (res) => HttpResponse.filterStatusOk(res),
  });
  try {
    await scope.run(broken);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("StatusCode");
  }
  await scope.close();
});

test("matchStatus dispatches a received status to its class bucket", async () => {
  const scope = createScope({ tags: [backend(recording("x", [], 500))] });
  const open = github.operation({
    label: "open",
    request: () => HttpRequest.get("https://api/a"),
    response: (res) =>
      HttpResponse.matchStatus(res, {
        404: () => "exact",
        "5xx": () => "server",
        orElse: () => "else",
      }),
  });
  expect(await scope.run(open)).toBe("server");
  await scope.close();
});

test("an exact status beats its class bucket and anything unmatched falls to orElse", async () => {
  const scope = createScope({ tags: [backend(recording("nf", [], 404))] });
  const open = github.operation({
    label: "open",
    request: () => HttpRequest.get("https://api/a"),
    response: (res) =>
      HttpResponse.matchStatus(res, {
        404: () => "exact",
        "4xx": () => "class",
        orElse: () => "else",
      }),
  });
  expect(await scope.run(open)).toBe("exact");
  await scope.close();
});

test("a throwing body reader rejects ResponseFailed/Decode", async () => {
  const seen: HttpRequest.Record[] = [];
  const boom = new Error("parse boom");
  const decode = github.operation({
    label: "decode",
    request: () => HttpRequest.get("https://api/a"),
    response: (res) =>
      res.json(() => {
        throw boom;
      }),
  });
  const scope = createScope({ tags: [backend(recording('{"a":1}', seen))] });
  try {
    await scope.run(decode);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("Decode");
    expect(error.payload.cause).toBe(boom);
  }
  await scope.close();
});

test("an empty body rejects ResponseFailed/EmptyBody", async () => {
  const empty = github.operation({
    label: "empty",
    request: () => HttpRequest.get("https://api/a"),
    response: (res) => res.json(),
  });
  const hollow = createScope({ tags: [backend(recording("", [])), github.config({})] });
  try {
    await hollow.run(empty);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("EmptyBody");
  }
  await hollow.close();
});

test("presetting the client swaps the transport", async () => {
  const seen: HttpRequest.Record[] = [];
  const recorded: HttpRequest.Record[] = [];
  const fake: HttpClient.Backend = async (request) => {
    recorded.push(request);
    return HttpResponse.make(request, { status: 200, body: '[{"name":"fake"}]' });
  };
  const fakeExecute: HttpClient.Handle["execute"] = (request, ctx) => fake(request, ctx.signal);
  const clientScope = createScope({
    tags: [backend(recording("[]", seen)), github.config({ baseUrl: "https://api" })],
    presets: [preset(github.client, () => ({ label: "fake", execute: fakeExecute }))],
  });
  expect(await clientScope.run(listRepos, { input: "octocat" })).toEqual(["fake"]);
  expect(seen.length).toBe(0);
  expect(recorded.length).toBe(1);
  await clientScope.close();
});

test("presetting the endpoint short-circuits the transport", async () => {
  const seen: HttpRequest.Record[] = [];
  const endpointScope = createScope({
    tags: [backend(recording("[]", seen)), github.config({ baseUrl: "https://api" })],
    presets: [preset(listRepos, () => Promise.resolve([]))],
  });
  expect(await endpointScope.run(listRepos, { input: "octocat" })).toEqual([]);
  expect(seen.length).toBe(0);
  await endpointScope.close();
});

test("a forced close while an endpoint is parked aborts the run and settles cancelled", async () => {
  const parking: HttpClient.Backend = (_request, signal) =>
    new Promise<HttpResponse.Handle>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  const scope = createScope({
    tags: [backend(parking), github.config({ baseUrl: "https://api" })],
  });
  const ends: Scope.End[] = [];
  const watching = operation({
    label: "watching",
    input: parseUser,
    depends: { repos: listRepos },
    run: ({ repos }, ctx) => {
      ctx.defer((end) => {
        ends.push(end);
      });
      return repos.run({ input: "octocat" });
    },
  });
  const running = scope.run(watching, { input: "octocat" });
  const closing = scope.close();
  const outcome = await running.then(
    () => "resolved",
    (error: unknown) => error,
  );
  const result = await closing;
  expect(result.status).toBe("cancelled");
  if (result.status !== "cancelled") throw result;
  expect(outcome).toBe(result.reason);
  if (outcome instanceof Error && isHttpError(outcome, "RequestFailed")) throw outcome;
  expect(ends.length).toBe(1);
  expect(ends[0].status).toBe("cancelled");
});
