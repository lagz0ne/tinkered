import { expect, test } from "vite-plus/test";
import { createScope, operation } from "@tinker/core";
import { backend, HttpRequest, HttpResponse, isError as isHttpError, send } from "@tinker/http";
import { api } from "../src/client/api.ts";

/** A 500 through a baseUrl-only binding still rejects: the helper folds the policy in. */
test("api.config with no accept still rejects a 500 as ResponseFailed", async () => {
  const down = backend(async (request) => HttpResponse.make(request, { status: 500, body: "x" }));
  const scope = createScope({ tags: [down, api.config({ baseUrl: "http://x" })] });
  const raw = operation({
    label: "raw",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("http://x/a") }),
  });
  try {
    await scope.run(raw);
    expect.unreachable();
  } catch (error) {
    if (!isHttpError(error, "ResponseFailed")) throw error;
    expect(error.payload.reason).toBe("StatusCode");
  }
  await scope.close();
});

/** A 409 passes the helper's default filter and stays readable. */
test("api.config with no accept still delivers a 409", async () => {
  const conflict = backend(async (request) =>
    HttpResponse.make(request, { status: 409, body: '{"id":"i1"}' }),
  );
  const scope = createScope({ tags: [conflict, api.config({ baseUrl: "http://x" })] });
  const raw = operation({
    label: "raw",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("http://x/a") }),
  });
  const res = await scope.run(raw);
  expect(res.status).toBe(409);
  expect(await res.text()).toBe('{"id":"i1"}');
  await scope.close();
});

/** An explicit accept overrides the helper's default. */
test("api.config with an explicit accept uses it instead", async () => {
  const missing = backend(async (request) =>
    HttpResponse.make(request, { status: 404, body: "nf" }),
  );
  const scope = createScope({
    tags: [missing, api.config({ baseUrl: "http://x", accept: (_status) => true })],
  });
  const raw = operation({
    label: "raw",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("http://x/a") }),
  });
  const res = await scope.run(raw);
  expect(res.status).toBe(404);
  await scope.close();
});
