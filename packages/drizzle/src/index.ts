import type { Resource, Scope } from "@tinker/core";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

export declare namespace QueryLogger {
  /** Drizzle's logger shape, declared structurally: one call per statement. */
  export type Handle = {
    logQuery(query: string, params: unknown[]): void;
  };
}

export declare namespace Transaction {
  /** A callback transaction commits when its callback resolves and rolls back when it rejects.
   * The callback parameter needs `any`: `never` rejects native databases whose methods take
   * their concrete transaction handle. `Handle<DB>` still infers that exact handle from `DB`.
   * This is the one `any` in the package. */
  export type Database = {
    transaction<T>(cb: (tx: any) => Promise<T>): Promise<T>;
  };
  export type Handle<DB extends Database> = Parameters<Parameters<DB["transaction"]>[0]>[0];
}

/** Borrow the native database and keep its transaction callback open until this resource ends.
 * A successful end commits; other outcomes roll back. Cleanup waits for the database's
 * commit or rollback, preserving begin failures and unexpected cleanup errors. */
export function openTransaction<DB extends Transaction.Database>(
  db: DB,
  ctx: Resource.Ctx,
): Promise<Transaction.Handle<DB>> {
  const started = readTransaction(db);
  ctx.defer((end) => settleTransaction(started, end));
  return started.handle;
}

/** The live pieces of one open transaction: `handle` resolves from inside the callback,
 * `done` resolves on commit and rejects with `Rollback` on rollback, and `settle` wakes the
 * parked callback with the owning layer's end. */
type OpenTransaction<DB extends Transaction.Database> = {
  readonly handle: Promise<Transaction.Handle<DB>>;
  readonly done: Promise<void>;
  readonly settle: (end: Scope.End) => void;
};

/** Start `db.transaction(cb)` and hand back the handle from
 * inside the callback. The callback parks on `outcome` until the owning layer settles:
 * `end.status === "success"` returns (commit); anything else raises `Rollback` inside the callback
 * (rollback). `done` rejects with that `Rollback` — the `defer` swallows it by design
 * ({@link settleTransaction}), so nobody outside ever sees it. After the handle resolves, a
 * begin failure is impossible — the callback already ran — so the rejection tracker is a no-op
 * by then, which is intended. */
function readTransaction<DB extends Transaction.Database>(db: DB): OpenTransaction<DB> {
  let resolveOutcome!: (end: Scope.End) => void;
  const outcome = new Promise<Scope.End>((resolve) => {
    resolveOutcome = resolve;
  });
  let resolveTx!: (tx: Transaction.Handle<DB>) => void;
  let rejectTx!: (cause: unknown) => void;
  const handle = new Promise<Transaction.Handle<DB>>((resolve, reject) => {
    resolveTx = resolve;
    rejectTx = reject;
  });
  const done = db.transaction(async (tx: Transaction.Handle<DB>) => {
    resolveTx(tx);
    const end = await outcome;
    if (end.status !== "success") raise("Rollback", { status: end.status });
  });
  ignoreRejection(done.then(noop, rejectTx));
  return { handle, done, settle: resolveOutcome };
}

/** Settle the parked callback with the layer's end, then await the transaction's own promise so
 * a graceful close resolves only after the commit (or rollback) completed. */
function settleTransaction<DB extends Transaction.Database>(
  started: OpenTransaction<DB>,
  end: Scope.End,
): Promise<void> {
  started.settle(end);
  return started.done.then(noop, swallowRollback);
}

const noop = (): void => undefined;

/** A Drizzle logger that writes one `db query` log line per statement (`{ sql }` only —
 * params are data, never logged), bound to the db resource's `ctx.log`. */
export function createQueryLogger(ctx: Resource.Ctx): QueryLogger.Handle {
  return {
    logQuery: (query) => {
      ctx.log("db query", { sql: query });
    },
  };
}

/** Swallow the transaction's own rejection after teardown: a commit resolves (nothing to do),
 * a rollback rejects with the `Rollback` the factory raised on purpose — the layer's real
 * outcome was already recorded, so this error must not escape into `teardownErrors`. */
function swallowRollback(error: unknown): void {
  if (!isError(error, "Rollback")) throw error;
}

/** Track a begin failure the factory could not deliver (the callback never ran, so the handle
 * has no value): attach the shared no-op so the rejection is never unhandled, while the handle
 * keeps its rejection for a later `resolve`. After the handle resolved this is a no-op. */
function ignoreRejection(promise: Promise<unknown>): void {
  promise.then(noop, noop);
}
