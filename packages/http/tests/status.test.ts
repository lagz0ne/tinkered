import { expect, test } from "vite-plus/test";
import { HttpRequest, HttpResponse } from "../src/index.ts";

const req = HttpRequest.get("https://api/a");

test("response headers lowercase their keys and a custom source rides along", async () => {
  const res = HttpResponse.fromWeb(req, new Response("hi", { headers: { "X-Up": "1" } }));
  expect(res.headers["x-up"]).toBe("1");
  expect(res.headers["X-Up"]).toBe(undefined);
  const marker = { marker: true };
  const withSource = HttpResponse.make(req, { status: 200, body: "hi", source: marker });
  expect(withSource.source).toBe(marker);
  expect(await withSource.text()).toBe("hi");
});

test("filterStatusOk accepts the 2xx edges and matchStatus dispatches every class", async () => {
  expect(
    HttpResponse.filterStatusOk(HttpResponse.make(req, { status: 200, body: "a" })).status,
  ).toBe(200);
  expect(
    HttpResponse.filterStatusOk(HttpResponse.make(req, { status: 299, body: "a" })).status,
  ).toBe(299);
  for (const bucket of ["2xx", "3xx", "4xx", "5xx"] as const) {
    const status = { "2xx": 200, "3xx": 301, "4xx": 400, "5xx": 500 }[bucket];
    const picked = HttpResponse.matchStatus(HttpResponse.make(req, { status, body: "a" }), {
      [bucket]: () => bucket,
      orElse: () => "else",
    });
    expect(picked).toBe(bucket);
  }
  const unmatched = HttpResponse.matchStatus(HttpResponse.make(req, { status: 200, body: "a" }), {
    "5xx": () => "server",
    orElse: () => "else",
  });
  expect(unmatched).toBe("else");
  const early = HttpResponse.make(req, { status: 200, body: "a" });
  const asEarly = { ...early, status: 100 };
  const picked = HttpResponse.matchStatus(asEarly, { orElse: () => "else" });
  expect(picked).toBe("else");
});
