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
  draftTags,
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
    tags: [
      storeConfig({ kind: "borrow", client }),
      draftTags({ enabled: true, baseUrl: "http://127.0.0.1:1" }),
    ],
    extensions: [web, page.extension, src, publish()],
  });
  await scope.ready;
  await scope.session((session) =>
    session.run(createIssue, { input: { title: "First HTML title", description: "from cells" } }),
  );
  await scope.run(publishIssues);
  const app = scope.resolve(web);
  const traffic = { syncs: 0 };
  project.provide("pageTraffic", traffic);
  const listener = serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/sync") traffic.syncs++;
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
  const unavailable = serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("sync is down", { status: 503 }),
  });
  await new Promise<void>((resolve) => unavailable.once("listening", resolve));
  const unavailableAddress = unavailable.address();
  if (unavailableAddress === null || typeof unavailableAddress === "string") return scope.close();
  project.provide("unavailable", `http://127.0.0.1:${unavailableAddress.port}`);
  const previous = process.env.TINKERED_PAGE_TEST_URL;
  process.env.TINKERED_PAGE_TEST_URL = `http://127.0.0.1:${address.port}`;
  return async () => {
    if (previous === undefined) delete process.env.TINKERED_PAGE_TEST_URL;
    else process.env.TINKERED_PAGE_TEST_URL = previous;
    await scope.close();
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      unavailable.close((error) => (error ? reject(error) : resolve())),
    );
    await client.close();
    await database.close();
  };
}
