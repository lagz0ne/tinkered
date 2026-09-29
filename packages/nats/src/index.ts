import { extension, operation } from "@tinker/core";
import type { Operation, Scope } from "@tinker/core";
import type { NatsConnection, Subscription } from "@nats-io/transport-node";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

export declare namespace Nats {
  /** Payload bytes belong to this delivery; no client objects cross into the app. */
  type Message = { subject: string; payload: Uint8Array };
  type Load<T> = () => Operation.Handle<T, Message> | PromiseLike<Operation.Handle<T, Message>>;
  type Row = { subject: string; load: Load<unknown> };
  type Wiring = {
    env: { NATS_URL?: string };
    /** Borrowed from a dev host. Only this piece's subscriptions close with the scope. */
    connection?: NatsConnection;
  };
}

/** One row per subject. Wildcards follow NATS subject rules. */
export function subscribe<T>(
  subject: string,
  op: Operation.Handle<T, Nats.Message> | Nats.Load<T>,
): Nats.Row {
  return { subject, load: typeof op === "function" ? op : () => op };
}

/** A piece belongs to one live root at a time and can restart after close.
 * The extension owns the connection unless wiring lends one.
 * Close drains subscriptions while sessions can still run, then closes the root.
 * The start defer also reaps the connection when boot fails before the caller closes. */
export function nats(rows: readonly Nats.Row[], wiring: Nats.Wiring) {
  let owner: Scope.Handle | undefined;
  const bridge = extension({
    label: "nats",
    start: async (scope, ctx, next) => {
      if (owner) raise("PieceInUse", { label: ctx.label });
      owner = scope;
      let stopped = false;
      let closingScope = false;
      let quiet: (() => Promise<void>) | undefined;
      let close: (() => Promise<void>) | undefined;
      const release = () => {
        if (owner === scope) owner = undefined;
      };
      const closeScope = scope.close.bind(scope);
      /** Core's close hook has no scope. Bind here so closing a rejected or old scope
       * cannot drain the live owner's subscriptions. Keep the full core close chain. */
      scope.close = async (options) => {
        closingScope = true;
        const finish = () => closeScope(options);
        try {
          /** The defer reports drain errors. Keep the connection open for root cleanup. */
          return await (options?.graceful && quiet ? quiet().then(finish, finish) : finish());
        } finally {
          release();
        }
      };
      ctx.defer(async () => {
        stopped = true;
        try {
          await close?.();
        } finally {
          /** Failed boot closes through core without calling the scope handle. */
          if (!closingScope) release();
        }
      });
      const url = readUrl(wiring.env.NATS_URL);
      await next();
      const { connect } = await import("@nats-io/transport-node");
      const connection = wiring.connection ?? (await connect({ servers: url }));
      const subscriptions: Subscription[] = [];
      const pending = new Set<Promise<void>>();
      let stopping: Promise<void> | undefined;
      quiet = () => (stopping ??= stopSubscriptions(subscriptions, pending));
      let closing: Promise<void> | undefined;
      const stop = quiet;
      close = () => (closing ??= drain(connection, stop, !wiring.connection));
      const send = (message: Nats.Message): void =>
        connection.publish(message.subject, message.payload);
      if (stopped) {
        await close();
      } else {
        for (const row of rows) {
          const receive = await row.load();
          subscriptions.push(
            connection.subscribe(row.subject, {
              callback: (error, message) => {
                const work = scope.session((session) =>
                  session.run({
                    label: `nats ${row.subject}`,
                    depends: { receive },
                    run: async ({ receive }, runCtx) => {
                      if (error) {
                        runCtx.log.error("nats subscription failed", {
                          subject: row.subject,
                          error,
                        });
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
                const settled = () => pending.delete(work);
                work.then(settled, settled);
              },
            }),
          );
        }
        await connection.flush();
      }
      return { send };
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
  const url = URL.parse(String(value));
  if (!url || !["nats:", "tls:"].includes(url.protocol) || !url.hostname) {
    raise("InvalidConfig", { key: "NATS_URL" });
  }
  return url.href;
}

async function drain(
  connection: NatsConnection,
  stop: () => Promise<void>,
  owned: boolean,
): Promise<void> {
  try {
    await stop();
    if (owned) await connection.drain();
  } catch (error) {
    /** Connection drain can reject its final flush on disconnect without closing the client. */
    if (owned) await connection.close();
    throw error;
  }
}

async function stopSubscriptions(
  subscriptions: Subscription[],
  pending: Set<Promise<void>>,
): Promise<void> {
  await Promise.allSettled(
    subscriptions
      .filter((subscription) => !subscription.isClosed())
      .map((subscription) => subscription.drain()),
  );
  await Promise.all(pending);
}
