import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { backend, config, HttpRequest, HttpResponse, send } from "../../src/http/index.ts";

test("each traced HTTP attempt sends its own traceparent without changing the caller's request", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    observe: { history: 10 },
    tags: [
      config({ retry: { times: 1 } }),
      backend(async (request) => {
        seen.push(request);
        return HttpResponse.make(request, { status: seen.length === 1 ? 503 : 200 });
      }),
    ],
  });
  const input = HttpRequest.setHeader(
    HttpRequest.get("https://api.test"),
    "traceparent",
    "caller-value",
  );
  await scope.run(send, { input });
  const attempts = scope.spans().filter((span) => span.name === "http.attempt");
  expect(seen.map((request) => request.headers.traceparent)).toEqual(
    attempts.map((span) => `00-${span.traceId}-${span.spanId}-01`),
  );
  expect(input.headers.traceparent).toBe("caller-value");
  await scope.close();
});

test("an HTTP attempt keeps the remote unsampled flag", async () => {
  const seen: string[] = [];
  const scope = createScope({
    observe: { history: 10 },
    trace: {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      parentSpanId: "00f067aa0ba902b7",
      sampled: false,
    },
    tags: backend(async (request) => {
      seen.push(request.headers.traceparent);
      return HttpResponse.make(request, { status: 200 });
    }),
  });
  await scope.run(send, { input: HttpRequest.get("https://api.test") });
  const attempt = scope.spans().find((span) => span.name === "http.attempt")!;
  expect(seen).toEqual([`00-${attempt.traceId}-${attempt.spanId}-00`]);
  await scope.close();
});

test("observation off sends the caller's headers without adding traceparent", async () => {
  const seen: HttpRequest.Record[] = [];
  const scope = createScope({
    tags: backend(async (request) => {
      seen.push(request);
      return HttpResponse.make(request, { status: 200 });
    }),
  });
  const input = HttpRequest.get("https://api.test");
  await scope.run(send, { input });
  expect(seen[0]).toBe(input);
  expect(seen[0].headers.traceparent).toBeUndefined();
  await scope.close();
});
