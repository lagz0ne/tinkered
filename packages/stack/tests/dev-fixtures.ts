import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
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

export async function createDevFixture(nats = true) {
  const base = fileURLToPath(new URL("../../../scratch/", import.meta.url));
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, "dev-"));
  await cp(fileURLToPath(new URL("./dev-app", import.meta.url)), directory, { recursive: true });
  await symlink(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(directory, "node_modules"),
  );
  const probe: DevProbe = createRequire(import.meta.url)(join(directory, "probe.cjs"));
  const events: Dev.Event[] = [];
  const first = Promise.withResolvers<Dev.Event>();
  const stop = new AbortController();
  const options = {
    root: directory,
    entry: "root.ts",
    env: { PORT: await readFreePort() },
    nats,
    report: (event: Dev.Event) => {
      events.push(event);
      first.resolve(event);
    },
  };
  const done = runDev(options, stop.signal);
  onTestFinished(async () => {
    probe.release.resolve();
    stop.abort();
    await done;
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    probe,
    events,
    stop,
    done,
    ready: first.promise,
    url: `http://127.0.0.1:${options.env.PORT}`,
  };
}
