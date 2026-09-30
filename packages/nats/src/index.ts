import { extension, operation, resource, tag } from "@tinker/core";
import type { Namespace, Operation, Scope } from "@tinker/core";
import type { NatsConnection, Subscription } from "@nats-io/transport-node";
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
  type Connection = { send(message: Message): void };
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
      const { connect } = await import("@nats-io/transport-node");
      ctx.signal.throwIfAborted();
      const client = settings.connection ?? (await connect({ servers: settings.url }));
      service.attach(client);
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
      connection.send(ctx.input);
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
  private client: NatsConnection | undefined;
  private owned: boolean;
  private stopping: Promise<void> | undefined;
  private closing: Promise<void> | undefined;

  constructor(owned: boolean) {
    this.owned = owned;
  }

  attach(client: NatsConnection): void {
    this.client = client;
  }

  readonly send = (message: Nats.Message): void => {
    const client = this.client;
    if (!client) raise("NotStarted", {});
    client.publish(message.subject, message.payload);
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
      if (this.owned) await this.client?.drain();
    } catch (error) {
      /** A failed final flush must still release an owned connection. */
      if (this.owned) await this.client?.close();
      throw error;
    } finally {
      this.client = undefined;
      this.subscriptions.length = 0;
      this.pending.clear();
    }
  }
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
  message: { subject: string; data: Uint8Array },
): Promise<void> {
  return scope.session({ ns }, (session) =>
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
          ctx.log.error("nats operation failed", { subject: message.subject, error: result.error });
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
