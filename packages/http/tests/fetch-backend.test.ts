import { createServer } from "node:http";
import { expect, test } from "vite-plus/test";
import { fetchBackend, HttpRequest } from "../src/index.ts";

/** One request the loopback server saw: its method, headers, and raw body text. */
type Echo = { readonly method: string; readonly contentType: string; readonly body: string };

/** A loopback echo server: records method/headers/body, answers "ok". A real transport. */
function startEcho(seen: Echo[]): Promise<EchoServer> {
  const server = createServer((req, res) => {
    readBody(req).then((body) => {
      seen.push({
        method: req.method ?? "",
        contentType: String(req.headers["content-type"] ?? ""),
        body,
      });
      res.end("ok");
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      const origin = `http://127.0.0.1:${address.port}`;
      resolve({ origin, [Symbol.dispose]: () => server.close() });
    });
  });
}

/** Read a request's body as text. */
function readBody(req: {
  on(event: string, listener: (chunk: Uint8Array) => void): void;
}): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

/** What `startEcho` returns: the base URL plus disposal that stops the server. */
type EchoServer = { readonly origin: string; readonly [Symbol.dispose]: () => void };

test("fetchBackend sends the method, headers, and JSON body to the server", async () => {
  const seen: Echo[] = [];
  using server = await startEcho(seen);
  const res = await fetchBackend(
    HttpRequest.post(`${server.origin}/issues`, {
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
});

test("fetchBackend keeps the record's own content type", async () => {
  const seen: Echo[] = [];
  using server = await startEcho(seen);
  await fetchBackend(
    HttpRequest.post(`${server.origin}/a`, { body: HttpRequest.bodyText("b", "text/x") }),
    new AbortController().signal,
  );
  expect(seen[0].contentType).toBe("text/x");
  expect(seen[0].body).toBe("b");
});

test("fetchBackend sends no body for a GET record", async () => {
  const seen: Echo[] = [];
  using server = await startEcho(seen);
  const res = await fetchBackend(
    HttpRequest.get(`${server.origin}/users`),
    new AbortController().signal,
  );
  expect(await res.text()).toBe("ok");
  expect(seen[0].method).toBe("GET");
  expect(seen[0].body).toBe("");
});

test("fetchBackend sends bytes bodies with the octet-stream content type", async () => {
  const seen: Echo[] = [];
  using server = await startEcho(seen);
  await fetchBackend(
    HttpRequest.post(`${server.origin}/bytes`, {
      body: HttpRequest.bodyBytes(new Uint8Array([1, 2])),
    }),
    new AbortController().signal,
  );
  expect(seen[0].contentType).toBe("application/octet-stream");
});

test("fetchBackend sends url-params bodies url-encoded", async () => {
  const seen: Echo[] = [];
  using server = await startEcho(seen);
  await fetchBackend(
    HttpRequest.post(`${server.origin}/form`, {
      body: HttpRequest.bodyUrlParams({ q: "x" }),
    }),
    new AbortController().signal,
  );
  expect(seen[0].body).toBe("q=x");
});
