import { expect, test } from "vite-plus/test";
import { createScope, operation } from "@tinker/core";
import { backend, httpClient, HttpRequest, HttpResponse, type HttpClient } from "../src/index.ts";

const github = httpClient({ label: "github" });

/** A closure backend that records the request it was given and answers `body` at `status`. */
function recording(body: string, seen: HttpRequest.Record[], status = 200): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status, body });
  };
}

test("nearer config headers win per key and the request's own headers win over config", async () => {
  const seen: HttpRequest.Record[] = [];
  const child = httpClient({ label: "child" });
  const callChild = operation({
    label: "github.raw",
    depends: { send: github.send },
    run: ({ send }) =>
      send.run({
        input: HttpRequest.get("https://api/a", { headers: { x: "req", y: "req" } }),
      }),
  });
  const scope = createScope({
    tags: [
      backend(recording("[]", seen)),
      child.config({ headers: { x: "scope", z: "scope" } }),
      github.config({ headers: { x: "near", y: "near" } }),
    ],
  });
  await scope.run(callChild);
  expect(seen[seen.length - 1].headers["x"]).toBe("req");
  expect(seen[seen.length - 1].headers["y"]).toBe("req");
  expect(seen[seen.length - 1].headers["z"]).toBe(undefined);
  await scope.close();
});

test("a nearer config baseUrl wins and one binding without headers still merges", async () => {
  const seen: HttpRequest.Record[] = [];
  const child = httpClient({ label: "child" });
  const callChild = operation({
    label: "child.raw",
    depends: { send: child.send },
    run: ({ send }) => send.run({ input: HttpRequest.get("/a") }),
  });
  const scope = createScope({
    tags: [
      backend(recording("[]", seen)),
      child.config({ baseUrl: "https://far", headers: { a: "1" } }),
    ],
  });
  const session = scope.createSession({
    tags: [child.config({ baseUrl: "https://near" })],
  });
  await session.run(callChild);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://near/a");
  expect(seen[seen.length - 1].headers["a"]).toBe("1");
  await scope.close();
});

test("header keys merge case-insensitively with the nearer binding winning", async () => {
  const seen: HttpRequest.Record[] = [];
  const child = httpClient({ label: "child" });
  const callChild = operation({
    label: "child.raw",
    depends: { send: child.send },
    run: ({ send }) => send.run({ input: HttpRequest.get("https://api/a") }),
  });
  const scope = createScope({
    tags: [backend(recording("[]", seen)), child.config({ headers: { "X-Token": "far" } })],
  });
  const session = scope.createSession({
    tags: [child.config({ headers: { "x-token": "near" } })],
  });
  await session.run(callChild);
  expect(seen[seen.length - 1].headers["x-token"]).toBe("near");
  expect(seen[seen.length - 1].headers["X-Token"]).toBe(undefined);
  await scope.close();
});
