import { extension, operation, resource, type Operation, type Scope } from "@tinker/core";
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

/** The operation writes the root's published cells in the request's namespace
 * from committed storage.
 * Boot failures reject ready; failures after commit are logged and leave the
 * request's answer intact. Manual sessions and GET requests stay silent. */
export function publishAfterCommit(
  publish: Operation.Handle<unknown, void>,
): Scope.Extension<void> {
  return createPublisher(publish);
}

/** List the returned wiring as one nested row in the root's extensions.
 * The publisher and NATS extension belong to that root. Each empty signal
 * re-runs the operation at the root in the receiving namespace, including on
 * the sender. That read must be safe to repeat; it never sends a signal.
 * NATS owns subscription cleanup. */
export function liveUpdates(
  publish: Operation.Handle<unknown, void>,
  wiring: LiveUpdates.Wiring,
): readonly Scope.Extension[] {
  const refresh = resource({
    label: "stack.rootPublish",
    target: "namespace",
    depends: { publish },
    factory: ({ publish }) => publish,
  });
  const receive = operation({
    label: "stack.refresh",
    depends: { refresh },
    run: ({ refresh }, _ctx: Operation.Ctx<Nats.Message>) => refresh.run(),
  });
  const bus = nats([subscribe(wiring.subject, receive)], { env: wiring.env });
  const changed = operation({
    label: "stack.changed",
    depends: { send: bus.publish },
    run: ({ send }) => send.run({ input: { subject: wiring.subject, payload: new Uint8Array() } }),
  });
  const publisher = createPublisher(publish, changed, () => {
    if (!/^[^\s.*>]+(?:\.[^\s.*>]+)*$/.test(wiring.subject)) {
      raise("BadLiveSubject", { subject: wiring.subject });
    }
  });
  return [publisher, bus.extension];
}

function createPublisher(
  publish: Operation.Handle<unknown, void>,
  changed?: Operation.Handle<unknown, void>,
  onStart?: () => void,
): Scope.Extension<void> {
  const republish = operation({
    label: "publish after commit",
    depends: { publish, ...(changed ? { changed } : {}) },
    run: async ({ publish, changed }, ctx) => {
      try {
        await publish.run();
        if (changed) await changed.run();
      } catch (error) {
        ctx.log.error("publish failed", describeError(error));
      }
    },
  });
  const root = resource({
    label: "stack.rootPublisher",
    target: "namespace",
    depends: { republish },
    factory: ({ republish }) => republish,
  });
  return extension({
    label: "stack.publish",
    hooks: {
      start: async (event) => {
        onStart?.();
        await event.next();
        event.scope.resolve(root);
        await event.scope.run(publish);
      },
      session: async (event) => {
        /** Resolve while the session is live; the controller belongs to the root
         * and keeps this session's namespace after the session closes. */
        const republish = event.handle.resolve(root);
        const ended = await event.next();
        const found = event.handle.resolve(request.optional);
        if (
          ended.status === "success" &&
          !ended.teardownErrors?.length &&
          found.present &&
          found.value.method !== "GET"
        ) {
          await republish.run();
        }
        return ended;
      },
    },
  });
}
