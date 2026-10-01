import { createScope } from "@tinker/core";
import { backend, config, HttpRequest, HttpResponse, isError } from "@tinker/http";
import { expect, test } from "vite-plus/test";
import { listRepos, onboard } from "./index.ts";

test("listing repos parses the reply from the configured request URL", async () => {
  const seen: HttpRequest.Record[] = [];
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: [
      backend((request) => {
        seen.push(request);
        return Promise.resolve(HttpResponse.make(request, { status: 200, body: '"ok"' }));
      }),
      config({
        baseUrl: "https://api.github.com",
        headers: { accept: "json" },
        accept: (status) => status < 300,
      }),
    ],
  });
  try {
    await scope.ready;
    expect(await scope.run(listRepos, { input: "octocat" })).toBe("ok");
    expect(seen.map((request) => HttpRequest.toUrl(request))).toEqual([
      "https://api.github.com/users/octocat/repos",
    ]);
  } finally {
    stop.abort();
    await scope.closed;
  }
});

test("onboarding uses the fresh token only for its issue request", async () => {
  const seen: HttpRequest.Record[] = [];
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: [
      backend((request) => {
        seen.push(request);
        return Promise.resolve(HttpResponse.make(request, { status: 200, body: '"ok"' }));
      }),
      config({
        baseUrl: "https://api.github.com",
        headers: { accept: "json", authorization: "Bearer original" },
      }),
    ],
  });
  try {
    await scope.ready;
    const created = await scope.run(onboard, { input: "octocat" });
    expect(created.status).toBe(200);
    await scope.run(listRepos, { input: "after" });
    expect(
      seen.map((request) => ({
        url: HttpRequest.toUrl(request),
        token: request.headers.authorization,
        accept: request.headers.accept,
      })),
    ).toEqual([
      {
        url: "https://api.github.com/users/octocat/repos",
        token: "Bearer original",
        accept: "json",
      },
      {
        url: "https://api.github.com/issues",
        token: "Bearer fresh",
        accept: "json",
      },
      {
        url: "https://api.github.com/users/after/repos",
        token: "Bearer original",
        accept: "json",
      },
    ]);
  } finally {
    stop.abort();
    await scope.closed;
  }
});

test("listing repos rejects a reply that is not a JSON string", async () => {
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    tags: [
      backend((request) =>
        Promise.resolve(HttpResponse.make(request, { status: 200, body: "42" })),
      ),
      config({ baseUrl: "https://api.github.com" }),
    ],
  });
  expect.assertions(1);
  try {
    await scope.ready;
    await scope.run(listRepos, { input: "octocat" });
  } catch (error) {
    if (!isError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("Decode");
  } finally {
    stop.abort();
    await scope.closed;
  }
});
