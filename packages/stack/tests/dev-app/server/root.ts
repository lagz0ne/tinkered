import { createRequire } from "node:module";
import { createScope, extension, operation, type Operation } from "@tinker/core";
import { hono, route } from "@tinker/hono";
import { nats, subscribe, type Nats } from "@tinker/nats";
import { readExitCode } from "@tinker/stack";
import type { Dev } from "@tinker/stack/dev";
import type { DevProbe } from "../../dev-fixtures.ts";
import { value } from "../shared/value.ts";
import config from "../shared/config.json" with { type: "json" };

const probe: DevProbe = createRequire(import.meta.url)("../probe.cjs");

export async function runServer(env: NodeJS.ProcessEnv, stop: AbortSignal, host: Dev.Wiring) {
  const page = await host.load<{ title: string }>("page.ts");
  probe.clients.push(host.client);
  probe.connections.push(host.connection);
  probe.signals.push(stop);
  const read = operation({ label: "read", run: () => value + config.suffix });
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
  const readPage = operation({ label: "readPage", run: () => page.title });
  const web = hono([
    route.get("/api/value", read),
    route.get("/api/slow", slow),
    route.get("/api/page", readPage),
  ]).extension;
  const scope = createScope({
    signal: stop,
    extensions: [
      web,
      host.connection ? bus.extension : [],
      extension({
        label: "database",
        hooks: {
          start: async (event) => {
            const timer = setInterval(() => probe.ticks++, 60_000);
            probe.timers.add(timer);
            event.defer(async () => {
              await host.client.query("select * from kept");
              await host.connection?.flush();
            });
            event.defer(() => {
              clearInterval(timer);
              probe.timers.delete(timer);
              probe.cleaned++;
              if (value === "close-broken" || value === "close-reject") {
                event.raise("CloseFailed", { value });
              }
            });
            await host.client.exec("create table if not exists kept (title text)");
            if (value === "slow-boot") {
              probe.entered.resolve();
              await probe.release.promise;
            }
            if (value === "broken") event.raise("BootFailed", { value });
          },
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
  const result = await scope.closed;
  if (value === "close-reject") throw result.teardownErrors?.at(0);
  return readExitCode(result, undefined, started ? "shutdown" : "boot");
}
