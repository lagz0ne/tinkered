import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { backend, httpClient, HttpRequest, HttpResponse, type HttpClient } from "../src/index.ts";

const github = httpClient({ label: "github" });

/** A closure backend that records the request it was given and answers `body` at `status`. */
function recording(body: string, seen: HttpRequest.Record[], status = 200): HttpClient.Backend {
  return async (request) => {
    seen.push(request);
    return HttpResponse.make(request, { status, body });
  };
}

test("text and bytes bodies arrive with their content types", async () => {
  const seen: HttpRequest.Record[] = [];
  const send = github.operation({
    label: "send",
    request: () => HttpRequest.post("/a", { body: HttpRequest.bodyBytes(new Uint8Array([7])) }),
    response: (res) => res.text(),
  });
  const scope = createScope({
    tags: [backend(recording("hi", seen)), github.config({ baseUrl: "https://api" })],
  });
  await scope.run(send);
  const sent = seen[seen.length - 1];
  if (sent.body.kind !== "bytes") throw sent;
  expect([...sent.body.bytes]).toEqual([7]);
  expect(sent.body.contentType).toBe("application/octet-stream");
  await scope.close();
});

test("a body option rides along and an explicit builder body wins", async () => {
  const seen: HttpRequest.Record[] = [];
  const send = github.operation({
    label: "send",
    request: () => HttpRequest.post("/a", { body: HttpRequest.bodyText("opt") }),
  });
  const scope = createScope({
    tags: [backend(recording("ok", seen)), github.config({ baseUrl: "https://api" })],
  });
  await scope.run(send);
  const sent = seen[seen.length - 1];
  if (sent.body.kind !== "text") throw sent;
  expect(sent.body.text).toBe("opt");
  await scope.close();
});

test("query params keep their pairs and the fragment stays at the end", async () => {
  const seen: HttpRequest.Record[] = [];
  const send = github.operation({
    label: "send",
    request: () =>
      HttpRequest.get("/a", {
        urlParams: [
          ["p", "1"],
          ["p", "2"],
        ],
        hash: "frag",
      }),
  });
  const scope = createScope({
    tags: [backend(recording("ok", seen)), github.config({ baseUrl: "https://api" })],
  });
  await scope.run(send);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://api/a?p=1&p=2#frag");
  await scope.close();
});

test("response bodies read through json", async () => {
  const json = github.operation({
    label: "json",
    request: () => HttpRequest.get("https://api/a"),
    response: (res) => res.json(),
  });
  const scope = createScope({ tags: [backend(recording('{"a":1}', []))] });
  expect(await scope.run(json)).toEqual({ a: 1 });
  await scope.close();
});
