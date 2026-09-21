import { createScope, operation } from "@tinker/core";
import { backend, httpClient, HttpRequest, HttpResponse, type HttpClient } from "@tinker/http";
import { z } from "zod";

/** A cast-free tour of the frame: a frame, two declared operations on `send`, and a userland
 * operation that depends on both and hands a fresh token to one call via `tags`. Every value's
 * type is INFERRED — no `as`, no non-null `!`. */
export async function tour(): Promise<string> {
  const github = httpClient({ label: "github", filterStatus: (status) => status < 300 });

  const seen: HttpRequest.Record[] = [];
  const fake: HttpClient.Backend = (request) => {
    seen.push(request);
    return Promise.resolve(HttpResponse.make(request, { status: 200, body: '"ok"' }));
  };

  const listRepos = operation({
    label: "github.listRepos",
    input: z.string(),
    depends: { send: github.send },
    run: async ({ send }, ctx) => {
      const res = await send.run({
        input: HttpRequest.get(`/users/${ctx.input}/repos`),
      });
      return res.text();
    },
  });

  const createIssue = operation({
    label: "github.createIssue",
    input: z.string(),
    depends: { send: github.send },
    run: ({ send }) =>
      send.run({
        input: HttpRequest.post("/issues", { body: HttpRequest.bodyJson({ title: "t" }) }),
      }),
  });

  const onboard = operation({
    label: "onboard",
    input: z.string(),
    depends: { repos: listRepos, issue: createIssue },
    run: async ({ repos, issue }, ctx) => {
      const names = await repos.run({ input: ctx.input });
      return issue.run({
        input: `${ctx.input}:${names}`,
        tags: [github.config({ headers: { authorization: "Bearer fresh" } })],
      });
    },
  });

  const scope = createScope({
    tags: [
      backend(fake),
      github.config({ baseUrl: "https://api.github.com", headers: { accept: "json" } }),
    ],
  });
  const repos = await scope.run(listRepos, { input: "octocat" });
  const created = await scope.run(onboard, { input: "hello" });
  const sent = HttpRequest.toUrl(seen[0]);
  await scope.close();
  return `${repos} ${created.status} ${sent}`;
}
