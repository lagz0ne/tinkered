import { expect, test } from "vite-plus/test";
import { createScope, operation } from "@tinker/core";
import { backend, config, HttpRequest, HttpResponse, send, type HttpClient } from "../src/index.ts";

/** A closure backend that records the request it was given and answers `body` at `status`. */
function recording(body: string, seen: HttpRequest.Record[], status = 200): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status, body });
  };
}

const callIt = operation({
  label: "callIt",
  depends: { send },
  run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("/a") }),
});

test("nearer config headers win per key and the request's own headers win over config", async () => {
  const seen: HttpRequest.Record[] = [];
  const callHeaders = operation({
    label: "github.raw",
    depends: { send },
    run: ({ send: sendIt }) =>
      sendIt.run({
        input: HttpRequest.get("https://api/a", { headers: { x: "req", y: "req" } }),
      }),
  });
  const scope = createScope({
    tags: [
      backend(recording("[]", seen)),
      config({ headers: { x: "scope", z: "scope" } }),
      config({ headers: { x: "near", y: "near" } }),
    ],
  });
  await scope.run(callHeaders);
  expect(seen[seen.length - 1].headers["x"]).toBe("req");
  expect(seen[seen.length - 1].headers["y"]).toBe("req");
  expect(seen[seen.length - 1].headers["z"]).toBe("scope");
  await scope.close();
});

test("a nearer config baseUrl wins and one binding without headers still merges", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: [
      backend(recording("[]", seen)),
      config({ baseUrl: "https://far", headers: { a: "1" } }),
    ],
  });
  const session = scope.createSession({
    tags: [config({ baseUrl: "https://near" })],
  });
  await session.run(callIt);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://near/a");
  expect(seen[seen.length - 1].headers["a"]).toBe("1");
  await scope.close();
});

test("header keys merge case-insensitively with the nearer binding winning", async () => {
  const seen: HttpRequest.Record[] = [];
  const callToken = operation({
    label: "callToken",
    depends: { send },
    run: ({ send: sendIt }) =>
      sendIt.run({ input: HttpRequest.get("https://api/a") }),
  });
  const scope = createScope({
    tags: [backend(recording("[]", seen)), config({ headers: { "X-Token": "far" } })],
  });
  const session = scope.createSession({
    tags: [config({ headers: { "x-token": "near" } })],
  });
  await session.run(callToken);
  expect(seen[seen.length - 1].headers["x-token"]).toBe("near");
  expect(seen[seen.length - 1].headers["X-Token"]).toBe(undefined);
  await scope.close();
});

test("two sessions bind two configs and each keeps its own base url", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({ tags: [backend(recording("[]", seen))] });
  const github = scope.createSession({
    tags: [config({ baseUrl: "https://api.github.com" })],
  });
  const stripe = scope.createSession({
    tags: [config({ baseUrl: "https://api.stripe.com" })],
  });
  await github.run(callIt);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://api.github.com/a");
  await stripe.run(callIt);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://api.stripe.com/a");
  await scope.close();
});

test("retry and accept merge nearest-wins like baseUrl", async () => {
  const seen: HttpRequest.Record[] = [];
  let calls = 0;
  const wobbly: HttpClient.Backend = async (request) => {
    calls += 1;
    seen.push(request);
    return HttpResponse.make(request, { status: calls === 1 ? 503 : 200, body: "back" });
  };
  const scope = createScope({
    tags: [backend(wobbly), config({ retry: { times: 0 } })],
  });
  const session = scope.createSession({
    tags: [config({ retry: { times: 2 } })],
  });
  const text = operation({
    label: "text",
    depends: { send },
    run: async ({ send: sendIt }) => {
      const received = await sendIt.run({ input: HttpRequest.get("https://api/a") });
      return received.text();
    },
  });
  expect(await session.run(text)).toBe("back");
  expect(calls).toBe(2);
  await scope.close();
});
