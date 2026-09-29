import { extension, operation, type Operation, type Scope } from "@tinker/core";
import { request } from "@tinker/hono";
import { nats, subscribe, type Nats } from "@tinker/nats";
import { describeError } from "./observe.ts";
import { raise } from "./errors.ts";

export declare namespace LiveUpdates {
  type Wiring = {
    /** One literal subject per app, shared by its server processes. */
    subject: string;
    env: Nats.Wiring["env"];
  };
}

/** The operation writes the root's published cells from committed storage.
 * Boot failures reject ready; failures after commit are logged and leave the
 * request's answer intact. Manual sessions and GET requests stay silent. */
export function publishAfterCommit(
  publish: Operation.Handle<unknown, void>,
): Scope.Extension<void> {
  return createPublisher(publish);
}

/** List the returned wiring as one nested row in the root's extensions.
 * The publisher and NATS extension belong to that root. Each empty signal
 * re-runs the operation at the root, including on the sender. That read must
 * be safe to repeat; it never sends a signal. NATS owns subscription cleanup. */
export function liveUpdates(
  publish: Operation.Handle<unknown, void>,
  wiring: LiveUpdates.Wiring,
): readonly Scope.Extension[] {
  let refresh: () => unknown;
  const receive = operation({
    label: "stack.refresh",
    run: (_deps, _ctx: Operation.Ctx<Nats.Message>) => refresh(),
  });
  const bus = nats([subscribe(wiring.subject, receive)], { env: wiring.env });
  const changed = operation({
    label: "stack.changed",
    depends: { send: bus.publish },
    run: ({ send }) => send.run({ input: { subject: wiring.subject, payload: new Uint8Array() } }),
  });
  const publisher = createPublisher(publish, changed, (run) => {
    if (!/^[^\s.*>]+(?:\.[^\s.*>]+)*$/.test(wiring.subject)) {
      raise("BadLiveSubject", { subject: wiring.subject });
    }
    refresh = run;
  });
  return [publisher, bus.extension];
}

function createPublisher(
  publish: Operation.Handle<unknown, void>,
  changed?: Operation.Handle<unknown, void>,
  onStart?: (refresh: () => unknown) => void,
): Scope.Extension<void> {
  let republish: () => Promise<unknown>;
  return extension({
    label: "stack.publish",
    start: async (scope, _ctx, next) => {
      onStart?.(() => scope.run(publish));
      republish = () =>
        scope.run({
          label: "publish after commit",
          depends: { publish },
          run: async ({ publish: read }, ctx) => {
            try {
              await read.run();
              if (changed) await scope.run(changed);
            } catch (error) {
              ctx.log.error("publish failed", describeError(error));
            }
          },
        });
      await next();
      await scope.run(publish);
    },
    session: async (handle, next) => {
      const ended = await next();
      const found = handle.resolve(request.optional);
      if (
        ended.status === "success" &&
        !ended.teardownErrors?.length &&
        found.present &&
        found.value.method !== "GET"
      ) {
        await republish();
      }
      return ended;
    },
  });
}
