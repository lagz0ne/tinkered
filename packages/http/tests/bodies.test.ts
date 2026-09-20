import { expect, test } from "vite-plus/test";
import { HttpRequest, HttpResponse } from "../src/index.ts";

const req = HttpRequest.get("https://api/a");

test("builders default their content types and carry the value", async () => {
  const text = HttpRequest.bodyText("b");
  expect(text.kind).toBe("text");
  if (text.kind !== "text") throw text;
  expect(text.contentType).toBe("text/plain");
  expect(text.text).toBe("b");
  const bytes = HttpRequest.bodyBytes(new Uint8Array([7]));
  expect(bytes.kind).toBe("bytes");
  if (bytes.kind !== "bytes") throw bytes;
  expect(bytes.contentType).toBe("application/octet-stream");
  expect(bytes.bytes).toEqual(new Uint8Array([7]));
});

test("a body option rides along and an explicit builder body wins", async () => {
  const withBody = HttpRequest.post("https://api/a", { body: HttpRequest.bodyText("opt") });
  expect(withBody.body.kind).toBe("text");
  const bare = HttpRequest.get("https://api/a");
  expect(bare.body.kind).toBe("empty");
  const modified = HttpRequest.modify(bare, { body: HttpRequest.bodyText("new") });
  expect(modified.body.kind).toBe("text");
  expect(bare.body.kind).toBe("empty");
});

test("query params keep their pairs and the fragment stays at the end", async () => {
  const pairs: (readonly [string, string])[] = [
    ["p", "1"],
    ["p", "2"],
  ];
  const listed = HttpRequest.get("https://api/a", { urlParams: pairs });
  expect(HttpRequest.toUrl(listed)).toBe("https://api/a?p=1&p=2");
  const hashed = HttpRequest.modify(listed, { hash: "frag" });
  expect(HttpRequest.toUrl(hashed)).toBe("https://api/a?p=1&p=2#frag");
  const cleared = HttpRequest.setUrlParams(listed, []);
  expect(HttpRequest.toUrl(cleared)).toBe("https://api/a");
});

test("response bodies read through every reader", async () => {
  const bytes = HttpResponse.make(req, { status: 200, body: new Uint8Array([104, 105]) });
  expect(await bytes.text()).toBe("hi");
  const json = HttpResponse.make(req, { status: 200, body: '{"a":1}' });
  expect(await json.json()).toEqual({ a: 1 });
  const buffer = HttpResponse.make(req, { status: 200, body: "hi" });
  const view = new Uint8Array(await buffer.arrayBuffer());
  expect([...view]).toEqual([104, 105]);
  const dumped = HttpResponse.make(req, { status: 200, body: "hi" });
  expect(dumped.request).toBe(req);
});
