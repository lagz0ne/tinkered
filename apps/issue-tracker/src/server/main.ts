import { join } from "node:path";
import { createScope } from "@tinker/core";
import { jsonLines, runUntilStop, server } from "@tinker/stack";
import { draftTags, type DraftConfig } from "./draft.ts";
import { issueServer } from "./routes.ts";
import { publish } from "./publish.ts";
import { store } from "./store.ts";
import { src } from "./sync.ts";

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

/** The app's one full root. Dev defaults belong here; stack start checks them.
 * List the listener first so saved issues publish before any request arrives. */
export async function runServer(env: NodeJS.ProcessEnv, stop: AbortSignal): Promise<number> {
  const listen = { PORT: env.PORT ?? "4311", HOST: env.HOST ?? "127.0.0.1" };
  const observe = {
    ...jsonLines((line) => process.stdout.write(`${line}\n`)),
    clock: Date.now,
  };
  const web = issueServer({ observe });
  const scope = createScope({
    tags: [
      store.config(env.DATA_PATH ?? "./data/issues"),
      draftTags(readDraftOptIn(env, listen.HOST, listen.PORT)),
    ],
    extensions: [
      server(web, { env: listen, clientDir: join(process.cwd(), "dist", "client"), observe }),
      web,
      src,
      publish(),
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
