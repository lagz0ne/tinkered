import { extension, operation } from "@tinker/core";
import type { Operation } from "@tinker/core";
import type { NatsConnection, Subscription } from "@nats-io/transport-node";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

export declare namespace Nats {
  /** Payload bytes belong to this delivery; no client objects cross into the app. */
  type Message = { subject: string; payload: Uint8Array };
  type Row = { subject: string; operation: Operation.Handle<unknown, Message> };
  type Wiring = {
    env: { NATS_URL?: string };
    /** Borrowed from a dev host. Only this piece's subscriptions close with the scope. */
    connection?: NatsConnection;
  };
}

/** One row per subject. Wildcards follow NATS subject rules. */
export function subscribe<T>(subject: string, op: Operation.Handle<T, Nats.Message>): Nats.Row {
  return { subject, operation: op };
}

/** Create one piece per root. The extension owns the connection unless wiring lends one.
 * Close drains subscriptions while sessions can still run, then closes the root.
 * The start defer also reaps the connection when boot fails before the close hook runs. */
export function nats(rows: readonly Nats.Row[], wiring: Nats.Wiring) {
  let stop: (() => Promise<void>) | undefined;
  const bridge = extension({
    label: "nats",
    start: async (scope, ctx, next) => {
      const url = readUrl(wiring.env.NATS_URL);
      let stopped = false;
      ctx.defer(() => {
        stopped = true;
        return stop?.();
      });
      await next();
      const { connect } = await import("@nats-io/transport-node");
      const connection = wiring.connection ?? (await connect({ servers: url }));
      const subscriptions: Subscription[] = [];
      const pending = new Set<Promise<void>>();
      let stopping: Promise<void> | undefined;
      stop = () => (stopping ??= drain(connection, subscriptions, pending, !wiring.connection));
      const send = (message: Nats.Message): void =>
        connection.publish(message.subject, message.payload);
      if (stopped) {
        await stop();
        return { send };
      }
      for (const row of rows) {
        subscriptions.push(
          connection.subscribe(row.subject, {
            callback: (error, message) => {
              const work = scope.session((session) =>
                session.run({
                  label: `nats ${row.subject}`,
                  depends: { receive: row.operation },
                  run: async ({ receive }, runCtx) => {
                    if (error) {
                      runCtx.log.error("nats subscription failed", { subject: row.subject, error });
                      return;
                    }
                    const result = await receive.settle({
                      input: { subject: message.subject, payload: new Uint8Array(message.data) },
                    });
                    if (result.status === "failed") {
                      runCtx.log.error("nats operation failed", {
                        subject: message.subject,
                        error: result.error,
                      });
                    }
                  },
                }),
              );
              pending.add(work);
              work.then(
                () => pending.delete(work),
                () => pending.delete(work),
              );
            },
          }),
        );
      }
      await connection.flush();
      return { send };
    },
    close: async (options, next) => {
      if (!options.graceful) return next();
      await stop?.();
      return next();
    },
  });
  const publish = operation({
    label: "nats.publish",
    depends: { bridge },
    run: ({ bridge: live }, ctx: Operation.Ctx<Nats.Message>) => {
      live.send(ctx.input);
    },
  });
  return { extension: bridge, publish };
}

function readUrl(value: string | undefined): string {
  const url = value === undefined ? null : URL.parse(value);
  if (!url || !["nats:", "tls:"].includes(url.protocol) || !url.hostname) {
    raise("InvalidConfig", { key: "NATS_URL" });
  }
  return url.href;
}

async function drain(
  connection: NatsConnection,
  subscriptions: Subscription[],
  pending: Set<Promise<void>>,
  owned: boolean,
): Promise<void> {
  try {
    await Promise.all(subscriptions.map((subscription) => subscription.drain()));
    await Promise.all(pending);
    if (owned) await connection.drain();
  } finally {
    if (owned) await connection.close();
  }
}
