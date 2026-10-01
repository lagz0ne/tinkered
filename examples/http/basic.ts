import { createScope, operation, type Scope } from "@tinker/core";
import { backend, config, HttpRequest, HttpResponse, send, type HttpClient } from "@tinker/http";
import { z } from "zod";

const replySchema = z.string();

export const listRepos = operation({
  label: "github.listRepos",
  input: z.string(),
  depends: { send },
  run: async ({ send: sendIt }, ctx) => {
    const res = await sendIt.run({
      input: HttpRequest.get(`/users/${ctx.input}/repos`),
    });
    return res.json(replySchema);
  },
});

const createIssue = operation({
  label: "github.createIssue",
  input: z.string(),
  depends: { send },
  run: ({ send: sendIt }) =>
    sendIt.run({
      input: HttpRequest.post("/issues", { body: HttpRequest.bodyJson({ title: "t" }) }),
    }),
});

export const onboard = operation({
  label: "onboard",
  input: z.string(),
  depends: { repos: listRepos, issue: createIssue },
  run: async ({ repos, issue }, ctx) => {
    const names = await repos.run({ input: ctx.input });
    return issue.run({
      input: `${ctx.input}:${names}`,
      tags: [config({ headers: { authorization: "Bearer fresh" } })],
    });
  },
});

if (import.meta.main) {
  const seen: HttpRequest.Record[] = [];
  const fake: HttpClient.Backend = (request) => {
    seen.push(request);
    return Promise.resolve(HttpResponse.make(request, { status: 200, body: '"ok"' }));
  };

  const stop = new AbortController();
  const requestStop = () => stop.abort();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  const scope = createScope({
    signal: stop.signal,
    tags: [
      backend(fake),
      config({
        baseUrl: "https://api.github.com",
        headers: { accept: "json" },
        accept: (status) => status < 300,
      }),
    ],
  });
  let output: string;
  let end: Scope.Result;
  try {
    await scope.ready;
    const repos = await scope.run(listRepos, { input: "octocat" });
    const created = await scope.run(onboard, { input: "hello" });
    const [firstRequest] = seen;
    output = `${repos} ${created.status} ${HttpRequest.toUrl(firstRequest)}`;
  } finally {
    stop.abort();
    end = await scope.closed;
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
  }
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) {
    const [error] = end.teardownErrors;
    throw error;
  }
  process.stdout.write(`${output}\n`);
}
