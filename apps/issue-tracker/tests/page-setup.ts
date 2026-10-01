import { serve } from "@hono/node-server";
import { createScope } from "@tinker/core";
import { createTestDatabase } from "@tinker/stack";
import type { TestProject } from "vite-plus/test/node";
import { createIssuePages } from "@tinker-issue-tracker/server-pages";
import {
  createIssue,
  issueServer,
  migrations,
  publish,
  publishIssues,
  src,
  storeConfig,
} from "../src/index.ts";

export default async function setup(project: TestProject) {
  const database = await createTestDatabase(migrations);
  const client = await database.clone();
  const page = createIssuePages({
    script: "/assets/client.js",
    styles: ["/assets/page.css"],
    dev: false,
  });
  const web = issueServer({ mount: page.mount });
  const scope = createScope({
    tags: [storeConfig({ kind: "borrow", client })],
    extensions: [web, page.extension, src, publish()],
  });
  await scope.ready;
  await scope.session((session) =>
    session.run(createIssue, { input: { title: "First HTML title", description: "from cells" } }),
  );
  await scope.run(publishIssues);
  const app = scope.resolve(web);
  const listener = serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const response = request.method === "OPTIONS" ? new Response(null) : await app.fetch(request);
      response.headers.set("access-control-allow-origin", "*");
      response.headers.set("access-control-allow-methods", "GET, POST");
      response.headers.set("access-control-allow-headers", "content-type");
      return response;
    },
  });
  await new Promise<void>((resolve) => listener.once("listening", resolve));
  const address = listener.address();
  if (address === null || typeof address === "string") return scope.close();
  project.provide("tracker", `http://127.0.0.1:${address.port}`);
  return async () => {
    await scope.close();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    await client.close();
    await database.close();
  };
}
