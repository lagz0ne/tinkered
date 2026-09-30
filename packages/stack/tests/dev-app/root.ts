import { createRequire } from "node:module";
import { createScope, extension, operation, type Operation } from "@tinker/core";
import { hono, route } from "@tinker/hono";
import { nats, subscribe, type Nats } from "@tinker/nats";
import { readExitCode } from "@tinker/stack";
import type { Dev } from "@tinker/stack/dev";
import type { DevProbe } from "../dev-fixtures.ts";
import { value } from "./value.ts";

const probe: DevProbe = createRequire(import.meta.url)("./probe.cjs");

export async function runServer(env: NodeJS.ProcessEnv, stop: AbortSignal, host: Dev.Wiring) {
  probe.clients.push(host.client);
  probe.connections.push(host.connection);
  probe.signals.push(stop);
  const read = operation({ label: "read", run: () => value });
  const slow = operation({
    label: "slow",
    run: async (_deps, ctx) => {
      probe.entered.resolve();
      await probe.release.promise;
      return { value, aborted: ctx.signal.aborted };
    },
  });
  const receive = operation({
    label: "receive",
    run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => {
      probe.deliveries++;
    },
  });
  const bus = nats([subscribe("dev.changed", receive)], {
    env,
    connection: host.connection,
  });
  const web = hono([route.get("/api/value", read), route.get("/api/slow", slow)]).extension;
  const scope = createScope({
    signal: stop,
    extensions: [
      web,
      host.connection ? bus.extension : [],
      extension({
        label: "database",
        start: async (_scope, ctx) => {
          const timer = setInterval(() => probe.ticks++, 60_000);
          probe.timers.add(timer);
          ctx.defer(() => {
            clearInterval(timer);
            probe.timers.delete(timer);
            probe.cleaned++;
            if (value === "close-broken") ctx.raise("CloseFailed", { value });
          });
          await host.client.exec("create table if not exists kept (title text)");
          if (value === "slow-boot") {
            probe.entered.resolve();
            await probe.release.promise;
          }
          if (value === "broken") ctx.raise("BootFailed", { value });
        },
      }),
    ],
  });
  probe.closed.push(scope.closed);
  host.ready(scope.ready.then(() => scope.resolve(web)));
  const started = await scope.ready.then(
    () => true,
    () => false,
  );
  return readExitCode(await scope.closed, { clock: Date.now }, started ? "shutdown" : "boot");
}
