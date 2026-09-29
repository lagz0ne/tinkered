import { join } from "node:path";
import { createScope } from "@tinker/core";
import { jsonLines, liveUpdates, runUntilStop, server } from "@tinker/stack";
import { draftTags, type DraftConfig } from "./draft.ts";
import { issueServer } from "./routes.ts";
import { publish } from "./publish.ts";
import { store } from "./store.ts";
import { migrateIssues } from "./migrations.ts";
import { src } from "./sync.ts";
import { publishIssues } from "./operations.ts";

function readDraftOptIn(
  env: NodeJS.ProcessEnv,
  host: string,
  port: string,
): DraftConfig | undefined {
  if (env.DRAFT_HELPER !== "1" && env.DRAFT_HELPER !== "true") return undefined;
  return {
    enabled: true,
    baseUrl: env.PUBLIC_BASE_URL || `http://${host}:${port}`,
  };
}

/** The app's one full root. Dev defaults belong here; server checks them first.
 * Migrations and saved-issue publishing finish before the server opens its port. */
export async function runServer(env: NodeJS.ProcessEnv, stop: AbortSignal): Promise<number> {
  const listen = { PORT: env.PORT ?? "4311", HOST: env.HOST ?? "127.0.0.1" };
  const observe = {
    ...jsonLines((line) => process.stdout.write(`${line}\n`)),
    clock: Date.now,
  };
  const web = issueServer();
  const scope = createScope({
    tags: [
      store.config(env.DATA_PATH ?? "./data/issues"),
      draftTags(readDraftOptIn(env, listen.HOST, listen.PORT)),
    ],
    extensions: [
      server(web, { env: listen, clientDir: join(process.cwd(), "dist", "client"), observe }),
      migrateIssues,
      web,
      src,
      env.NATS_URL === undefined
        ? publish()
        : liveUpdates(publishIssues, { subject: "issues.changed", env }),
    ],
    observe,
  });
  return runUntilStop(scope, stop, observe);
}

if (import.meta.main) {
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  process.exitCode = await runServer(process.env, stop.signal);
}
