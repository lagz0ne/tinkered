import { createScope, operation } from "@tinker/core";
import {
  applyConfig,
  backend,
  httpClient,
  HttpRequest,
  HttpResponse,
  mergeConfig,
  type HttpClient,
} from "../src/index.ts";

/** A cast-free tour of the frame: build it, bind a closure backend + config on a scope, run an
 * operation through it. Every value's type is INFERRED — no `as`, no non-null `!`. */
export async function tour(): Promise<string> {
  const github = httpClient({ label: "github" });

  const seen: HttpRequest.Record[] = [];
  const fake: HttpClient.Backend = (request) => {
    seen.push(request);
    return Promise.resolve(HttpResponse.make(request, { status: 200, body: '"ok"' }));
  };

  const listUsers = operation({
    label: "listUsers",
    depends: { client: github.client, config: github.config.all },
    run: ({ client, config }, ctx) =>
      client.execute(
        applyConfig(HttpRequest.get("/users", { urlParams: { page: "2" } }), mergeConfig(config)),
        ctx,
      ),
  });

  const scope = createScope({
    tags: [
      backend(fake),
      github.config({ baseUrl: "https://api.github.com", headers: { accept: "json" } }),
    ],
  });
  const res = await scope.run(listUsers);
  const body = await res.text();
  const sent = HttpRequest.toUrl(seen[0]);
  await scope.close();
  return `${res.status} ${body} ${sent}`;
}
