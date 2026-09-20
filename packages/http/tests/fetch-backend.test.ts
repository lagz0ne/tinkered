import { createServer } from "node:http";
import { expect, test } from "vite-plus/test";
import { fetchBackend, HttpRequest } from "../src/index.ts";

/** One request the loopback server saw: its method, headers, and raw body text. */
type Echo = { readonly method: string; readonly contentType: string; readonly body: string };

/** A loopback echo server: records method/headers/body, answers "ok". A real transport. */
function startEcho(seen: Echo[]): Promise<{ origin: string; stop: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        contentType: String(req.headers["content-type"] ?? ""),
        body: Buffer.concat(chunks).toString(),
      });
      res.end("ok");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      const origin = `http://127.0.0.1:${address.port}`;
      resolve({ origin, stop: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

test("fetchBackend sends the method, headers, and JSON body to the server", async () => {
  const seen: Echo[] = [];
  const { origin, stop } = await startEcho(seen);
  const res = await fetchBackend(
    HttpRequest.post(`${origin}/issues`, {
      headers: { x: "1" },
      body: HttpRequest.bodyJson({ title: "t" }),
    }),
    new AbortController().signal,
  );
  expect(await res.text()).toBe("ok");
  expect(seen.length).toBe(1);
  expect(seen[0].method).toBe("POST");
  expect(seen[0].contentType).toBe("application/json");
  expect(seen[0].body).toBe('{"title":"t"}');
  await stop();
});

test("fetchBackend keeps the record's own content type", async () => {
  const seen: Echo[] = [];
  const { origin, stop } = await startEcho(seen);
  await fetchBackend(
    HttpRequest.post(`${origin}/a`, { body: HttpRequest.bodyText("b", "text/x") }),
    new AbortController().signal,
  );
  expect(seen[0].contentType).toBe("text/x");
  expect(seen[0].body).toBe("b");
  await stop();
});
