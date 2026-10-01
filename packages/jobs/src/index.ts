import {
  extension,
  operation,
  resource,
  type Operation,
  type Resource,
  type Scope,
} from "@tinker/core";
import type { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import { jobsClock } from "./time.ts";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

export declare namespace Jobs {
  type Input = { queue: string; data: object };
  type Options = {
    retryLimit?: number;
    retryDelay?: number;
    retryBackoff?: boolean;
    cron?: string;
  };
  type Row = Options & { queue: string; operation: Operation.Handle<unknown, unknown> };
  /** Borrow the store's transaction. It is never committed or closed by send. */
  type Transaction = { execute(query: SQL): Promise<{ rows: unknown[] } | unknown[]> };
  type Wiring = {
    tx: Resource.Handle<Promise<Transaction>>;
    /** Borrow the store's own PGlite client; this piece never closes it. */
    pglite?: Resource.Handle<Promise<{ $client: PGlite }>>;
    env: { JOBS_URL?: string };
  };
}

/** A queue's operation reads job data through its usual input parser. */
export function job<T, I>(
  queue: string,
  op: Operation.Handle<T, I>,
  options?: Jobs.Options,
): Jobs.Row {
  return { queue, operation: op, ...options };
}

const errors = resource({
  label: "jobs.errors",
  depends: { clock: jobsClock.optional },
  factory: ({ clock }, { log }) => ({ clock: clock.present ? clock.value : undefined, log }),
});

/** List after stack.migrate: pg-boss installs its own schema under its own lock.
 * One live root owns this piece. Sending borrows the current session's transaction;
 * fetching and settling happen outside that transaction, after its owner closes it. */
export function jobs(rows: readonly Jobs.Row[], wiring: Jobs.Wiring) {
  let owner: Scope.Handle | undefined;
  const bridge = extension({
    label: "jobs",
    hooks: {
      async start(event) {
        const { scope } = event;
        if (owner) raise("PieceInUse", { label: event.label });
        const connectionString = wiring.pglite ? undefined : readUrl(wiring.env.JOBS_URL);
        owner = scope;
        let closing = false;
        let closingScope = false;
        let boss: PgBoss | undefined;
        const closeScope = scope.close.bind(scope);
        const release = () => {
          if (owner === scope) owner = undefined;
        };
        /** Core's close hook has no scope. Stop fetches before core closes sessions,
         * without waiting for a fetch blocked behind a request's open transaction. */
        scope.close = async (options) => {
          closingScope = true;
          closing = true;
          try {
            await stopFetching(boss, rows, false);
            return await closeScope(options);
          } finally {
            release();
          }
        };
        event.defer(() => {
          if (!closingScope) release();
        });
        const client = wiring.pglite ? (await scope.resolve(wiring.pglite)).$client : undefined;
        const { log, clock } = scope.resolve(errors);
        const { PgBoss, fromPglite, fromDrizzle } = await import("pg-boss");
        const { sql } = await import("drizzle-orm");
        const worker = new PgBoss({
          ...(client ? { db: fromPglite(client), backend: "pglite" } : { connectionString }),
          cronMonitorIntervalSeconds: 1,
          clock,
        });
        boss = worker;
        worker.on("error", (error) => log.error("jobs worker failed", { error }));
        event.defer(async () => {
          closing = true;
          await stopFetching(worker, rows, true);
          await worker.stop({ graceful: false });
        });
        await worker.start();
        await configureQueues(worker, rows);
        await event.next();
        for (const row of rows) {
          await worker.work(
            row.queue,
            { includeMetadata: true, pollingIntervalSeconds: 0.5 },
            async (batch) => {
              await scope.ready;
              for (const item of batch) {
                try {
                  if (closing) raise("JobCancelled", { queue: row.queue });
                  await runJob(scope, row, item);
                } catch (error) {
                  if (item.retryCount >= item.retryLimit) {
                    log.error("job failed", { queue: row.queue, id: item.id, error });
                  }
                  throw error;
                }
              }
            },
          );
        }
        return {
          send: (input: Jobs.Input, tx: Jobs.Transaction) => {
            if (!rows.some((row) => row.queue === input.queue)) {
              raise("UnknownQueue", { queue: input.queue });
            }
            return worker.send(input.queue, input.data, { db: fromDrizzle(tx, sql) });
          },
        };
      },
    },
  });
  const send = operation({
    label: "jobs.send",
    depends: { bridge, tx: wiring.tx },
    run: ({ bridge: live, tx }, ctx: Operation.Ctx<Jobs.Input>) => live.send(ctx.input, tx),
  });
  return { extension: bridge, send };
}

function readUrl(value: string | undefined): string {
  const url = URL.parse(String(value));
  if (!url || !["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
    raise("InvalidConfig", { keys: ["JOBS_URL"] });
  }
  return url.href;
}

async function configureQueues(worker: PgBoss, rows: readonly Jobs.Row[]): Promise<void> {
  for (const row of rows) {
    /** Match pg-boss 12.35.0 defaults so omitted settings reset on restart. */
    const { queue, cron, retryLimit = 2, retryDelay = 0, retryBackoff = false } = row;
    const retry = { retryLimit, retryDelay, retryBackoff };
    await worker.createQueue(queue, retry);
    await worker.updateQueue(queue, retry);
    if (cron !== undefined) await worker.schedule(queue, cron, {}, retry);
    else await worker.unschedule(queue);
  }
}

async function stopFetching(
  boss: PgBoss | undefined,
  rows: readonly Jobs.Row[],
  wait: boolean,
): Promise<void> {
  if (boss) await Promise.all(rows.map((row) => boss.offWork(row.queue, { wait })));
}

async function runJob(
  scope: Scope.Handle,
  row: Jobs.Row,
  item: JobWithMetadata<unknown>,
): Promise<void> {
  const session = scope.createSession();
  const call = row.operation.input ? { rawInput: item.data } : { input: item.data };
  const result = await session.settle(row.operation, call);
  const end = await session.close({ graceful: result.status === "success" });
  if (result.status === "failed") throw result.error;
  if (result.status === "cancelled" || end.status === "cancelled")
    raise("JobCancelled", { queue: row.queue });
  if (end.status === "failed") throw end.error;
  if (end.teardownErrors?.length) raise("CommitFailed", { errors: end.teardownErrors });
}
