import { expect, test } from "vite-plus/test";
import { HttpRequest, HttpResponse } from "../src/index.ts";

const req = HttpRequest.get("https://api/a");

test("the accept shorthand sets the header and an explicit accept wins", async () => {
  const shorthand = HttpRequest.get("https://api/a", { acceptJson: true });
  expect(shorthand.headers["accept"]).toBe("application/json");
  const explicit = HttpRequest.get("https://api/a", {
    accept: "text/x",
    acceptJson: true,
  });
  expect(explicit.headers["accept"]).toBe("text/x");
  const res = HttpResponse.make(explicit, { status: 200, body: "hi" });
  expect(HttpRequest.toUrl(res.request)).toBe("https://api/a");
});

test("modify sets the accept header after the merge without moving the other keys", async () => {
  const base = HttpRequest.get("https://api/a", {
    headers: { x: "1", accept: "text/old" },
  });
  const next = HttpRequest.modify(base, { acceptJson: true });
  expect(next.headers["accept"]).toBe("application/json");
  expect(next.headers["x"]).toBe("1");
  const kept = HttpRequest.modify(base, { headers: { y: "2" } });
  expect(kept.headers["accept"]).toBe("text/old");
  expect(kept.headers["y"]).toBe("2");
});

test("a custom accept header reaches the record the endpoint builds", async () => {
  const built = HttpRequest.post("https://api/a", {
    accept: "application/vnd.x",
    headers: { "X-Up": "1" },
    urlParams: { p: "1" },
    hash: "frag",
  });
  expect(built.headers["accept"]).toBe("application/vnd.x");
  expect(built.headers["x-up"]).toBe("1");
  expect(HttpRequest.toUrl(built)).toBe("https://api/a?p=1#frag");
  expect(req.headers["accept"]).toBe(undefined);
});
