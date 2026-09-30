import type { Dev } from "@tinker/stack/dev";
import { join } from "node:path";
import { raise } from "../errors.ts";
import { createScope, extension } from "@tinker/core";
import { jsonLines, liveUpdates, readExitCode, server } from "@tinker/stack";
import { draftTags, type DraftConfig } from "./draft.ts";
import { issueServer } from "./routes.ts";
import { publish } from "./publish.ts";
import { storeConfig } from "./store.ts";
import { migrateIssues } from "./migrations.ts";
import { src } from "./sync.ts";
import { publishIssues } from "./operations.ts";

function readDraftOptIn(env: NodeJS.ProcessEnv): DraftConfig | undefined {
  if (env.DRAFT_HELPER !== "1" && env.DRAFT_HELPER !== "true") return undefined;
  return {
    enabled: true,
    baseUrl: env.PUBLIC_BASE_URL || `http://${env.HOST ?? ""}:${env.PORT ?? ""}`,
  };
}

/** The app's one full root. The dev host alone binds local defaults.
 * Dev lends handles and owns the listener; prod checks settings before serving. */
export async function runServer(
  env: NodeJS.ProcessEnv,
  stop: AbortSignal,
  host?: Dev.Wiring,
): Promise<number> {
  const observe = {
    ...jsonLines((line) => process.stdout.write(`${line}\n`)),
    clock: Date.now,
  };
  const web = issueServer();
  const scope = createScope({
    tags: [
      storeConfig(
        host
          ? { kind: "borrow", client: host.client }
          : { kind: "open", url: env.DATA_PATH },
      ),
      draftTags(readDraftOptIn(env)),
    ],
    extensions: [
      host
        ? []
        : server(web, { env, clientDir: join(process.cwd(), "dist", "client"), observe }),
      !host &&
        extension({
          label: "issues.data-settings",
          hooks: {
            start(event) {
              if (env.DATA_PATH === undefined || env.DATA_PATH === "") {
                raise("BadDataSettings", { keys: ["DATA_PATH"] });
              }
              return event.next();
            },
          },
        }),
      migrateIssues,
      web,
      src,
      env.NATS_URL === undefined
        ? publish()
        : liveUpdates(publishIssues, {
            subject: "issues.changed",
            env,
            connection: host?.connection,
          }),
    ],
    observe,
    signal: stop,
  });
  host?.ready(scope.ready.then(() => scope.resolve(web)));
  const phase = await scope.ready.then(
    () => "shutdown" as const,
    () => "boot" as const,
  );
  return readExitCode(await scope.closed, observe, phase);
}

if (import.meta.main) {
  const stop = new AbortController();
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  process.exitCode = await runServer(process.env, stop.signal);
}
