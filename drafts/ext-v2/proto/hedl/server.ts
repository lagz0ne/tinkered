// hedl cmds/server.ts, scope wiring only, in the new shape. Compare: hedl main 3cc37eb lines 57-111.

import { createScope } from "../core.js";
import { auth, bootstrap, readAccount, requests, sqlite, sync, telemetry } from "./libs.js";

type Env = Record<string, string | undefined>;
type Sink = { write(chunk: string): unknown };

export async function main({ env, cwd, signal, stdout }: {
  env: Env;
  cwd: string;
  signal: AbortSignal;
  stdout: Sink;
}) {
  const threaded = env.NODE_ENV === "production";

  const tools = createScope({
    extensions: [
      telemetry.server({
        output: stdout,
        worker: threaded ? new URL("./telemetry-worker.js", "file:///app/") : undefined,
        service: env.OTEL_SERVICE_NAME,
        tracesUrl: env.VICTORIA_TRACES_URL ? new URL(env.VICTORIA_TRACES_URL) : undefined,
        logsUrl: env.VICTORIA_LOGS_URL ? new URL(env.VICTORIA_LOGS_URL) : undefined,
        logLevel: env.LOG_LEVEL ? Number(env.LOG_LEVEL) : undefined,
        spanHistory: env.SPAN_HISTORY ? Number(env.SPAN_HISTORY) : undefined,
      }),
    ],
  });
  await tools.ready;

  const app = createScope({
    extensions: [
      requests({ stop: signal }),
      sqlite({
        url: env.DATABASE_URL, // undefined -> start fails: "Missing config: database.url"
        folder: cwd,
        migrations: "sqlite/migrations",
        migrationTimeout: env.DATABASE_MIGRATION_TIMEOUT_MS
          ? Number(env.DATABASE_MIGRATION_TIMEOUT_MS)
          : undefined,
      }),
      auth({
        settings:
          env.PUBLIC_ORIGIN && env.AUTH_SECRET
            ? { origin: env.PUBLIC_ORIGIN, secret: env.AUTH_SECRET }
            : undefined,
        onUserCreated: [sync.server.createAccountStream],
      }),
      sync.server({ bootstrap, readAccount }),
      telemetry.app({ ingest: (batch) => void batch }),
    ],
  });
  await app.ready;
  return { tools, app };
}
