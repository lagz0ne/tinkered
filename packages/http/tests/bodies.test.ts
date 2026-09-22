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

test("text and bytes bodies arrive with their content types", async () => {
  const seen: HttpRequest.Record[] = [];
  const posts = operation({
    label: "posts",
    depends: { send },
    run: async ({ send: sendIt }) => {
      const received = await sendIt.run({
        input: HttpRequest.post("/a", { body: HttpRequest.bodyBytes(new Uint8Array([7])) }),
      });
      return received.text();
    },
  });
  const scope = createScope({
    tags: [backend(recording("hi", seen)), config({ baseUrl: "https://api" })],
  });
  await scope.run(posts);
  const sent = seen[seen.length - 1];
  if (sent.body.kind !== "bytes") throw sent;
  expect([...sent.body.bytes]).toEqual([7]);
  expect(sent.body.contentType).toBe("application/octet-stream");
  await scope.close();
});

test("a body option rides along and an explicit builder body wins", async () => {
  const seen: HttpRequest.Record[] = [];
  const posts = operation({
    label: "posts",
    depends: { send },
    run: ({ send: sendIt }) =>
      sendIt.run({
        input: HttpRequest.post("/a", { body: HttpRequest.bodyText("opt") }),
      }),
  });
  const scope = createScope({
    tags: [backend(recording("ok", seen)), config({ baseUrl: "https://api" })],
  });
  await scope.run(posts);
  const sent = seen[seen.length - 1];
  if (sent.body.kind !== "text") throw sent;
  expect(sent.body.text).toBe("opt");
  await scope.close();
});

test("query params keep their pairs and the fragment stays at the end", async () => {
  const seen: HttpRequest.Record[] = [];
  const posts = operation({
    label: "posts",
    depends: { send },
    run: ({ send: sendIt }) =>
      sendIt.run({
        input: HttpRequest.get("/a", {
          urlParams: [
            ["p", "1"],
            ["p", "2"],
          ],
          hash: "frag",
        }),
      }),
  });
  const scope = createScope({
    tags: [backend(recording("ok", seen)), config({ baseUrl: "https://api" })],
  });
  await scope.run(posts);
  expect(HttpRequest.toUrl(seen[seen.length - 1])).toBe("https://api/a?p=1&p=2#frag");
  await scope.close();
});

test("response bodies read through json", async () => {
  const json = operation({
    label: "github.json",
    depends: { send },
    run: async ({ send: sendIt }) => {
      const received = await sendIt.run({
        input: HttpRequest.get("https://api/a"),
      });
      return received.json();
    },
  });
  const scope = createScope({ tags: [backend(recording('{"a":1}', []))] });
  expect(await scope.run(json)).toEqual({ a: 1 });
  await scope.close();
});
