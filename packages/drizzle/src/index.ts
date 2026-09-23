import type { Resource, Scope, Tag } from "@tinker/core";
import { resource, tag } from "@tinker/core";
import { isError, raise } from "./errors.ts";

export { isError };
export type { Errors } from "./errors.ts";

export declare namespace DrizzleStore {
  /** Drizzle's logger shape, declared structurally: one call per statement. */
  export type Logger = {
    logQuery(query: string, params: unknown[]): void;
  };
  /** The smallest structural shape a Drizzle database satisfies: a callback-scoped
   * transaction that commits when the callback resolves and rolls back when it rejects.
   * The callback parameter is `any` (the ADR's shape): `never` would read precise but
   * rejects real databases at the constraint — a method taking the concrete handle is not
   * assignable to one taking `never` — while `any` accepts every database and `Tx<DB>`
   * still infers the real handle from `DB`'s own parameter. The one `any` in the package. */
  export type Transactional = {
    transaction<T>(cb: (tx: any) => Promise<T>): Promise<T>;
  };
  /** The transaction handle for one database: the callback's first parameter. */
  export type Tx<DB extends Transactional> = Parameters<Parameters<DB["transaction"]>[0]>[0];
  /** The tools `open` receives: a Drizzle logger bound to the db resource's `ctx.log`. */
  export type Tools = { readonly logger: Logger };
  /** The frame `drizzleStore` returns: its label, its `config` tag, its per-namespace
   * `db` resource, and its per-session `tx` resource. */
  export type Frame<Config, DB extends Transactional> = {
    readonly label: string;
    readonly config: Tag.Handle<Config>;
    readonly db: Resource.Handle<Promise<DB>>;
    readonly tx: Resource.Handle<Promise<Tx<DB>>>;
  };
}

/** Build the frame: a `config` tag labelled `${label}.config` (no default — an unbound read
 * raises core's `MissingTag`), a `db` resource labelled `${label}.db` (`target: "namespace"`,
 * `depends: { config }`, so `open` runs once per namespace and `close` runs by `defer` when the
 * scope closes), and a `tx` resource labelled `${label}.tx` (`target: "session"`, `depends:
 * { db }`). The `tx` factory starts `db.transaction(cb)` and resolves the handle from INSIDE
 * the callback, holding the callback open on a promise the `defer` settles: `success` returns
 * from the callback (commit); anything else raises `Rollback` inside it (rollback). The
 * `defer` awaits the transaction's own promise, so a graceful close resolves only after the
 * commit (or rollback) completed. After the handle resolves, a begin failure is impossible —
 * the callback already ran — so the rejection tracker is a no-op by then, which is intended.
 * A root-level `tx` (no session) builds at the root: a graceful `scope.close()` commits it,
 * a forced close rolls it back like every other resource. */
export function drizzleStore<Config, DB extends DrizzleStore.Transactional>(config: {
  label?: string;
  open: (config: Config, tools: DrizzleStore.Tools) => DB | PromiseLike<DB>;
  close?: (db: DB) => void | PromiseLike<void>;
  meta?: Tag.Bindings;
}): DrizzleStore.Frame<Config, DB> {
  const openDb = config.open;
  const closeDb = config.close;
  const frameLabel = config.label ?? "drizzle";
  const configTag: Tag.Handle<Config> = tag({ label: `${frameLabel}.config` });
  const db: Resource.Handle<Promise<DB>> = resource({
    label: `${frameLabel}.db`,
    target: "namespace",
    depends: { config: configTag },
    meta: config.meta,
    factory: ({ config: bound }, ctx) => {
      const opened = openDb(bound, { logger: readLogger(ctx) });
      return Promise.resolve(opened).then((instance) => {
        if (closeDb) ctx.defer(() => closeDb(instance));
        return instance;
      });
    },
  });
  const tx: Resource.Handle<Promise<DrizzleStore.Tx<DB>>> = resource({
    label: `${frameLabel}.tx`,
    target: "session",
    depends: { db },
    meta: config.meta,
    factory: ({ db: client }, ctx) => {
      const started = readTransaction(client);
      ctx.defer((end) => settleTransaction(started, end));
      return started.handle;
    },
  });
  return { label: frameLabel, config: configTag, db, tx };
}

/** The live pieces of one open transaction: `handle` resolves from inside the callback,
 * `done` resolves on commit and rejects with `Rollback` on rollback, and `settle` wakes the
 * parked callback with the owning layer's end. */
type OpenTransaction<DB extends DrizzleStore.Transactional> = {
  readonly handle: Promise<DrizzleStore.Tx<DB>>;
  readonly done: Promise<void>;
  readonly settle: (end: Scope.End) => void;
};

/** Start `db.transaction(cb)` (or wait for `db`, then start) and hand back the handle from
 * inside the callback. The callback parks on `outcome` until the owning layer settles: `end.status
 * === "success"` returns (commit); anything else raises `Rollback` inside the callback
 * (rollback). `done` rejects with that `Rollback` — the `defer` swallows it by design
 * ({@link settleTransaction}), so nobody outside ever sees it. After the handle resolves, a
 * begin failure is impossible — the callback already ran — so the rejection tracker is a no-op
 * by then, which is intended. */
function readTransaction<DB extends DrizzleStore.Transactional>(db: DB): OpenTransaction<DB> {
  let resolveOutcome!: (end: Scope.End) => void;
  const outcome = new Promise<Scope.End>((resolve) => {
    resolveOutcome = resolve;
  });
  let resolveTx!: (tx: DrizzleStore.Tx<DB>) => void;
  let rejectTx!: (cause: unknown) => void;
  const handle = new Promise<DrizzleStore.Tx<DB>>((resolve, reject) => {
    resolveTx = resolve;
    rejectTx = reject;
  });
  const done = db.transaction(async (tx: DrizzleStore.Tx<DB>) => {
    resolveTx(tx);
    const end = await outcome;
    if (end.status !== "success") raise("Rollback", { status: end.status });
  });
  ignoreRejection(done.then(noop, rejectTx));
  return { handle, done, settle: resolveOutcome };
}

/** Settle the parked callback with the layer's end, then await the transaction's own promise so
 * a graceful close resolves only after the commit (or rollback) completed. */
function settleTransaction<DB extends DrizzleStore.Transactional>(
  started: OpenTransaction<DB>,
  end: Scope.End,
): Promise<void> {
  started.settle(end);
  return started.done.then(noop, swallowRollback);
}

const noop = (): void => undefined;

/** A Drizzle logger that writes one `db query` log line per statement (`{ sql }` only —
 * params are data, never logged), bound to the db resource's `ctx.log`. */
function readLogger(ctx: Resource.Ctx): DrizzleStore.Logger {
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
