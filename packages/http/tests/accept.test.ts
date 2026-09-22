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

test("acceptJson sets the accept header the backend sees", async () => {
  const seen: HttpRequest.Record[] = [];
  const call = operation({
    label: "github.call",
    depends: { send },
    run: ({ send: sendIt }) => sendIt.run({ input: HttpRequest.get("/a", { acceptJson: true }) }),
  });
  const scope = createScope({
    tags: [backend(recording("ok", seen)), config({ baseUrl: "https://api" })],
  });
  await scope.run(call);
  expect(seen[seen.length - 1].headers["accept"]).toBe("application/json");
  await scope.close();
});

test("an explicit accept wins over acceptJson and modify keeps the other headers", async () => {
  const seen: HttpRequest.Record[] = [];
  const call = operation({
    label: "github.call",
    depends: { send },
    run: ({ send: sendIt }) =>
      sendIt.run({
        input: HttpRequest.modify(
          HttpRequest.get("/a", { headers: { x: "1" }, accept: "text/x", acceptJson: true }),
          { headers: { y: "2" } },
        ),
      }),
  });
  const scope = createScope({
    tags: [backend(recording("ok", seen)), config({ baseUrl: "https://api" })],
  });
  await scope.run(call);
  const sent = seen[seen.length - 1];
  expect(sent.headers["accept"]).toBe("text/x");
  expect(sent.headers["x"]).toBe("1");
  expect(sent.headers["y"]).toBe("2");
  await scope.close();
});
