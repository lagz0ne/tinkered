// Hedl's libraries in the new shape. Tag labels and defaults copy hedl main 3cc37eb.
// Each index would export ONLY the extension(s); tags stay private in the library.

import { extension, operation, resource, tag } from "../core.js";

type Sink = { write(chunk: string): unknown };
type Snapshot = { stream: string; revision: number };

/* ---------- telemetry: one library, three scopes ---------- */

const telemetryService = tag<string>({ label: "telemetry.service", default: "tinker" });
const tracesUrl = tag<URL | undefined>({ label: "telemetry.tracesUrl", default: undefined });
const logsUrl = tag<URL | undefined>({ label: "telemetry.logsUrl", default: undefined });
const logLevel = tag<number>({ label: "telemetry.logLevel", default: 30 });
const spanHistory = tag<number>({ label: "telemetry.spanHistory", default: 80 });
const consoleOutput = tag<Sink>({ label: "telemetry.console" });
const workerUrl = tag<URL | undefined>({ label: "telemetry.worker", default: undefined });
const ingestSink = tag<(batch: unknown) => void>({ label: "telemetry.browserIngest" });

const observer = resource<(event: unknown) => void>("telemetry.observer");
const exporter = resource<void>("telemetry.export");
const threadExporter = resource<void>("telemetry.threadExport");
const ingest = resource<{ ingest(batch: unknown): void }>("telemetry.ingest");
const drain = operation<void>("telemetry.threadDrain");
const renderObserve = resource<unknown>("telemetry.renderObserve");

const telemetryServer = extension({
  label: "telemetry.server",
  config: {
    output: consoleOutput,
    worker: workerUrl,
    service: telemetryService,
    tracesUrl,
    logsUrl,
    logLevel,
    spanHistory,
  },
  exports: { observer, ingest, renderObserve },
  hooks: {
    async start({ config, load, next }) {
      // The backend switch is plain code: only the chosen exporter loads.
      await (config.worker
        ? load(threadExporter, { explain: "Sends spans and logs from a worker thread" })
        : load(exporter, { explain: "Sends spans and logs on this thread" }));
      await next();
    },
  },
});

const telemetryBrowser = extension({
  label: "telemetry.browser",
  config: { service: telemetryService, output: consoleOutput },
  exports: { observer },
});

const telemetryWorker = extension({
  label: "telemetry.worker",
  config: { output: consoleOutput, service: telemetryService, tracesUrl, logsUrl },
  exports: { drain },
});

/** The app scope's end of telemetry: what the browser posts goes to the tools scope. */
const telemetryApp = extension({
  label: "telemetry.app",
  config: { ingest: ingestSink },
});

export const telemetry = {
  server: telemetryServer,
  browser: telemetryBrowser,
  worker: telemetryWorker,
  app: telemetryApp,
};

/* ---------- requests ---------- */

const backendStop = tag<AbortSignal>({ label: "requests.stop" });
const requestContext = resource<unknown>("requests.context");

export const requests = extension({
  label: "requests",
  config: { stop: backendStop },
  exports: { context: requestContext },
});

/* ---------- database (SQLite) ---------- */

const databaseUrl = tag<URL | string>({ label: "database.url" });
const databaseFolder = tag<string | undefined>({ label: "database.folder", default: undefined });
const migrationsFolder = tag<string>({ label: "database.migrationsFolder", default: "migrations" });
const migrationTimeout = tag<number>({ label: "database.migrationTimeout", default: 5000 });

const migrate = operation<void>("database.migrate");
const database = resource<unknown>("database");
const transaction = resource<unknown>("database.transaction");

export const sqlite = extension({
  label: "database",
  config: {
    url: databaseUrl,
    folder: databaseFolder,
    migrations: migrationsFolder,
    migrationTimeout,
  },
  exports: { database, transaction },
  hooks: {
    async start({ load, next }) {
      await load(migrate, { explain: "Brings the schema up to the newest migration" });
      await next();
    },
  },
});

/* ---------- auth ---------- */

const authSettings = tag<{ origin: string; secret: string }>({ label: "auth.settings" });
const onUserCreated = tag<readonly unknown[]>({ label: "auth.userCreated", default: [] });
const principal = resource<unknown>("request.principal");

export const auth = extension({
  label: "auth",
  config: { settings: authSettings, onUserCreated },
  exports: { principal },
});

/* ---------- sync: one library, two sides ---------- */

type Op<O> = ReturnType<typeof operation<O>>;

const bootstrapSlot = tag<Op<Snapshot>>({ label: "sync.bootstrap" });
const readAccountSlot = tag<Op<string | null>>({ label: "sync.readAccount" });
const tabStop = tag<AbortSignal>({ label: "sync.tabStop" });
const recordsSlot = tag<unknown>({ label: "sync.records" });
const readBatchSlot = tag<{ parse(raw: unknown): unknown }>({ label: "sync.readBatch" });
const readBootstrapSlot = tag<{ parse(raw: unknown): unknown }>({ label: "sync.readBootstrap" });
const readSnapshotSlot = tag<{ parse(raw: unknown): unknown }>({ label: "sync.readSnapshot" });
const streamMessageSlot = tag<{ parse(raw: unknown): unknown }>({ label: "sync.streamMessage" });

const history = resource<unknown>("sync.history");
const createAccountStream = operation<void>("sync.accountCreated");
const notifications = operation<void>("sync.notifications");
const syncRouter = resource<unknown>("sync.router");

const syncServer = extension({
  label: "sync.server",
  config: { bootstrap: bootstrapSlot, readAccount: readAccountSlot },
  exports: { history, createAccountStream },
  hooks: {
    async start({ load, next }) {
      load(notifications, {
        explain: "Wakes open tabs when a stream commits",
        watches: [history],
      });
      await next();
    },
  },
});

const syncTab = extension({
  label: "sync.tab",
  config: {
    stop: tabStop,
    records: recordsSlot,
    readBatch: readBatchSlot,
    readBootstrap: readBootstrapSlot,
    readSnapshot: readSnapshotSlot,
    streamMessage: streamMessageSlot,
  },
  exports: { router: syncRouter },
});

export const sync = { server: syncServer, tab: syncTab };

/* ---------- app units (src/) ---------- */

export const bootstrap = operation<Snapshot>("hedl.bootstrap");
export const readAccount = operation<string | null>("hedl.readAccount");
