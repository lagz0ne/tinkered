import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import type { Scope } from "@tinker/core";
import type { Nats } from "@tinker/nats";
import { onTestFinished } from "vite-plus/test";
import { runDev, type Dev } from "@tinker/stack/dev";
import { readFreePort } from "./fixtures.ts";

export type DevProbe = {
  clients: PGlite[];
  connections: Nats.Wiring["connection"][];
  signals: AbortSignal[];
  closed: Promise<Scope.Result>[];
  entered: PromiseWithResolvers<void>;
  release: PromiseWithResolvers<void>;
  cleaned: number;
  deliveries: number;
  ticks: number;
  timers: Set<NodeJS.Timeout>;
};

const require = createRequire(import.meta.url);

async function createDevDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "tinker-dev-"));
  await cp(fileURLToPath(new URL("./dev-app", import.meta.url)), directory, { recursive: true });
  await symlink(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(directory, "node_modules"),
  );
  return directory;
}

function startFixture(options: Dev.Options) {
  const events: Dev.Event[] = [];
  const first = Promise.withResolvers<Dev.Event>();
  const stop = new AbortController();
  const done = runDev(
    {
      ...options,
      report: (event) => {
        events.push(event);
        first.resolve(event);
      },
    },
    stop.signal,
  );
  return { events, ready: first.promise, stop, done };
}

export async function createDevFixture(nats = true, env: NodeJS.ProcessEnv = {}) {
  const directory = await createDevDirectory();
  const probe: DevProbe = require(join(directory, "probe.cjs"));
  const PORT = env.PORT ?? (await readFreePort());
  const host = startFixture({ root: directory, entry: "root.ts", env: { ...env, PORT }, nats });
  onTestFinished(async () => {
    probe.release.resolve();
    host.stop.abort();
    await host.done;
    delete require.cache[join(directory, "probe.cjs")];
    await rm(directory, { recursive: true, force: true });
  });
  return { ...host, directory, probe, url: `http://127.0.0.1:${PORT}` };
}
