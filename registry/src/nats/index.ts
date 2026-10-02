import { extension, operation, resource, tag } from "@tinker/core";
import type { Namespace, Observe, Operation, Scope } from "@tinker/core";
import type { Msg, MsgHdrs, NatsConnection, Subscription } from "@nats-io/transport-node";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

export declare namespace Nats {
  /** Payload bytes belong to this delivery; no client objects cross into the app. */
  type Message = { subject: string; payload: Uint8Array };
  type Load<T> = () => Operation.Handle<T, Message> | PromiseLike<Operation.Handle<T, Message>>;
  type Row = { subject: string; load: Load<unknown> };
  type Config = {
    url: string;
    /** Borrowed from a dev host. Only this piece's subscriptions close with the scope. */
    connection?: NatsConnection;
  };
  type Wiring = {
    env: { NATS_URL?: string };
    /** Borrowed from a dev host. Only this piece's subscriptions close with the scope. */
    connection?: NatsConnection;
  };
  /** Resolving the resource prepares this namespace's incoming subscriptions too. */
  type Connection = { send(message: Message, span?: Observe.Span): void };
}

const closedConnection: Nats.Connection = {
  send: () => raise("NotStarted", {}),
};

/** One row per subject. Wildcards follow NATS subject rules. */
export function subscribe<T>(
  subject: string,
  op: Operation.Handle<T, Nats.Message> | Nats.Load<T>,
): Nats.Row {
  return { subject, load: typeof op === "function" ? op : () => op };
}

/** Share one definition across roots and namespaces. Each namespace owns its connection
 * and subscriptions until the root closes; a lent SDK connection stays with its lender.
 * The extension checks the initial config before later starts and prepares its namespace
 * after them. Resolving `connection` or publishing prepares another selected namespace.
 * Each definition needs its own config and driver identities to keep separate buses apart. */
export function nats(rows: readonly Nats.Row[], wiring?: Nats.Wiring) {
  const config = tag<Nats.Config>({ label: "nats.config" });
  const settings = resource({
    label: "nats.settings",
    target: "namespace",
    depends: { config: config.optional },
    factory: ({ config }) => ({
      url: readUrl(config.present ? config.value.url : wiring?.env.NATS_URL),
      connection: config.present ? config.value.connection : wiring?.connection,
    }),
  });
  const driver = resource({
    label: "nats.driver",
    target: "scope",
    factory: (_deps, ctx) => {
      const driver = new Driver();
      ctx.defer(() => driver.finish());
      return driver;
    },
  });
  const connection = resource({
    label: "nats.connection",
    target: "namespace",
    depends: { settings, driver },
    factory: async ({ settings, driver }, ctx): Promise<Nats.Connection> => {
      const scope = driver.readScope();
      const service = new Connection(!settings.connection);
      driver.connections.add(service);
      ctx.defer(async () => {
        try {
          await service.close();
        } finally {
          driver.connections.delete(service);
        }
      });
      const { connect, headers } = await import("@nats-io/transport-node");
      ctx.signal.throwIfAborted();
      const client = settings.connection ?? (await connect({ servers: settings.url }));
      service.attach(client, headers);
      ctx.signal.throwIfAborted();
      if (!driver.stopping) {
        for (const row of rows) {
          const receive = await row.load();
          ctx.signal.throwIfAborted();
          if (driver.stopping) break;
          service.subscriptions.push(
            client.subscribe(row.subject, {
              callback: (error, message) => {
                if (ctx.signal.aborted) return;
                const work = deliver(scope, ctx.ns, row.subject, receive, error, message);
                service.track(work);
              },
            }),
          );
        }
        await client.flush();
      }
      return { send: service.send };
    },
  });
  const bridge = extension({
    label: "nats",
    hooks: {
      start: async (event) => {
        const owner = event.resolve(driver);
        owner.start(event.scope);
        event.resolve(settings);
        await event.next();
        return owner.stopping ? closedConnection : event.resolve(connection);
      },
      close: async (event) => {
        const owner = event.resolve(driver);
        if (event.options.graceful) await owner.quiet();
        return event.next();
      },
    },
  });
  const publish = operation({
    label: "nats.publish",
    depends: { connection },
    run: async ({ connection }, ctx: Operation.Ctx<Nats.Message>) => {
      connection.send(ctx.input, ctx.obs.span);
    },
  });
  return { extension: bridge, publish, config, connection };
}

class Driver {
  private scope: Scope.Handle | undefined;
  readonly connections = new Set<Connection>();
  stopping = false;

  start(scope: Scope.Handle): void {
    this.scope = scope;
  }

  readScope(): Scope.Handle {
    if (!this.scope) raise("NotStarted", {});
    return this.scope;
  }

  async quiet(): Promise<void> {
    this.stopping = true;
    /** Resource cleanup reports a failed drain after the scope has closed its sessions. */
    await Promise.allSettled([...this.connections].map((connection) => connection.quiet()));
  }

  finish(): void {
    this.stopping = true;
    this.scope = undefined;
  }
}

class Connection {
  readonly subscriptions: Subscription[] = [];
  private pending = new Set<Promise<void>>();
  private live: { client: NatsConnection; headers: () => MsgHdrs } | undefined;
  private owned: boolean;
  private stopping: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  constructor(owned: boolean) {
    this.owned = owned;
  }

  attach(client: NatsConnection, headers: () => MsgHdrs): void {
    this.live = { client, headers };
  }

  readonly send = (message: Nats.Message, span?: Observe.Span): void => {
    const live = this.live;
    if (!live) raise("NotStarted", {});
    if (span) {
      const carrier = live.headers();
      carrier.set("traceparent", `00-${span.traceId}-${span.spanId}-${span.sampled ? "01" : "00"}`);
      live.client.publish(message.subject, message.payload, { headers: carrier });
    } else {
      live.client.publish(message.subject, message.payload);
    }
  };

  track(work: Promise<void>): void {
    this.pending.add(work);
    const settled = () => this.pending.delete(work);
    work.then(settled, settled);
  }

  quiet(): Promise<void> {
    return (this.stopping ??= stopSubscriptions(this.subscriptions, this.pending));
  }

  close(): Promise<void> {
    return (this.closing ??= this.finish());
  }

  private async finish(): Promise<void> {
    try {
      await this.quiet();
      if (this.owned) await this.live?.client.drain();
    } catch (error) {
      /** A failed final flush must still release an owned connection. */
      if (this.owned) await this.live?.client.close();
      throw error;
    } finally {
      this.live = undefined;
      this.subscriptions.length = 0;
      this.pending.clear();
    }
  }
}

/** The NATS carrier follows the same W3C validation as Hono: an invalid
 * or absent header clears any root seed before opening the message session. */
function readTraceparent(header: string | undefined): Observe.Trace | null {
  if (!header) return null;
  const match =
    /^(?<version>[0-9a-f]{2})-(?<traceId>[0-9a-f]{32})-(?<parentSpanId>[0-9a-f]{16})-(?<flags>[0-9a-f]{2})(?<suffix>-.*)?$/.exec(
      header,
    );
  if (!match) return null;
  const { version, traceId, parentSpanId, flags, suffix } = match.groups!;
  if (version === "ff" || (version === "00" && suffix !== undefined)) return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return null;
  return { traceId, parentSpanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 };
}

function readUrl(value: string | undefined): string {
  const url = URL.parse(String(value));
  if (!url || !["nats:", "tls:"].includes(url.protocol) || !url.hostname) {
    raise("InvalidConfig", { key: "NATS_URL" });
  }
  return url.href;
}

function deliver(
  scope: Scope.Handle,
  ns: readonly Namespace[] | undefined,
  subject: string,
  receive: Operation.Handle<unknown, Nats.Message>,
  error: Error | null,
  message: Msg,
): Promise<void> {
  return scope.session(
    { ns, trace: readTraceparent(error ? undefined : message.headers?.get("traceparent")) },
    (session) =>
      session.run({
        label: `nats ${subject}`,
        depends: { receive },
        run: async ({ receive }, ctx) => {
          if (error) {
            ctx.log.error("nats subscription failed", { subject, error });
            return;
          }
          const result = await receive.settle({
            input: { subject: message.subject, payload: new Uint8Array(message.data) },
          });
          if (result.status === "failed") {
            ctx.log.error("nats operation failed", {
              subject: message.subject,
              error: result.error,
            });
          }
        },
      }),
  );
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
