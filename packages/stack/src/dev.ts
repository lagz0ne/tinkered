import { mkdir, readFile } from "node:fs/promises";
import { createServer, type Server as HttpServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { getRequestListener } from "@hono/node-server";
import { connect } from "@nats-io/transport-node";
import { createScope, extension, type Scope } from "@tinker/core";
import type { HonoScope } from "@tinker/hono";
import type { Nats } from "@tinker/nats";
import { startNatsServer } from "@tinker/nats/testing";
import { createServer as createVite, createRunnableDevEnvironment } from "vite-plus";
import type { ModuleRunner } from "vite-plus/module-runner";
import type { ViteDevServer } from "vite-plus";
import { raise } from "./errors.ts";
import { readExitCode } from "./exit.ts";
import { readSettings } from "./server.ts";

export declare namespace Dev {
  type App = Parameters<HonoScope.Serve>[0];
  /** The host retains these handles. A root borrows them until its exit promise settles.
   * Hand ready the app promise once; a rejection must follow the root's failed cleanup. */
  type Wiring = {
    client: PGlite;
    connection?: Nats.Wiring["connection"];
    ready(app: Promise<App>): void;
  };
  type Root = (env: NodeJS.ProcessEnv, stop: AbortSignal, wiring: Wiring) => Promise<number>;
  type Event = { kind: "ready"; url: string } | { kind: "error"; error: unknown };
  type Options = {
    root: string;
    entry: string;
    env: NodeJS.ProcessEnv;
    /** List this when the app uses a NATS piece. The host starts its own local server. */
    nats?: boolean;
    report?: (event: Event) => void;
  };
}

/** One process owns the listener, Vite, database and optional local NATS server.
 * Each root owns its scope and answers only after closed. Stop joins any reload
 * before releasing the retained services; a broken app stays editable on 503. */
export async function runDev(options: Dev.Options, stop: AbortSignal): Promise<number> {
  const host = new DevHost(options, stop);
  const scope = createScope({
    signal: stop,
    extensions: [
      extension({
        label: "stack.dev",
        hooks: {
          start: async (event) => {
            try {
              await host.open(event.defer);
            } finally {
              /** Root cleanup must precede service cleanup, including after a failed start. */
              event.defer(() => host.close());
            }
          },
        },
      }),
    ],
  });
  const phase = await scope.ready.then(
    () => "shutdown" as const,
    (error: unknown) => {
      options.report?.({ kind: "error", error });
      return "boot" as const;
    },
  );
  return readExitCode(await scope.closed, { clock: Date.now }, phase);
}

class DevHost {
  private options: Dev.Options;
  private signal: AbortSignal;
  private env: NodeJS.ProcessEnv;
  private entry: string;
  private listener: HttpServer;
  private vite?: ViteDevServer;
  private runner?: ModuleRunner;
  private client?: PGlite;
  private connection?: Nats.Wiring["connection"];
  private root?: { stop: AbortController; done: Promise<RootEnd> };
  private current?: Dev.App;
  private failure?: string;
  private pending = Promise.resolve();
  private stopping = false;
  private url?: string;

  constructor(options: Dev.Options, signal: AbortSignal) {
    this.options = options;
    this.signal = signal;
    this.entry = resolve(options.root, options.entry);
    this.env = {
      ...options.env,
      HOST: options.env.HOST ?? "127.0.0.1",
      PORT: options.env.PORT ?? "4311",
      DATA_PATH: resolve(options.root, options.env.DATA_PATH ?? "./data/issues"),
    };
    const answer = getRequestListener((request) => this.answer(request));
    this.listener = createServer((request, response) => {
      this.vite!.middlewares(request, response, () => answer(request, response));
    });
  }

  async open(defer: Scope.ExtensionCtx["defer"]): Promise<void> {
    const settings = readSettings(this.env);
    this.url = `http://${settings.host.includes(":") ? `[${settings.host}]` : settings.host}:${settings.port}`;
    await mkdir(this.env.DATA_PATH!, { recursive: true });
    const client = new PGlite(this.env.DATA_PATH);
    this.client = client;
    defer(() => client.close());
    await client.waitReady;
    if (this.options.nats) await this.openNats(defer);
    /** Vite releases HMR sockets before this listener close is awaited. */
    defer(
      () =>
        new Promise<void>((done, fail) => {
          if (!this.listener.listening) return done();
          this.listener.close((error) => (error ? fail(error) : done()));
          this.listener.closeIdleConnections();
        }),
    );
    await this.openVite(defer);
    await new Promise<void>((done, fail) => {
      this.listener.once("error", fail);
      this.listener.listen(settings.port, settings.host, () => {
        this.listener.removeListener("error", fail);
        done();
      });
    });
    await this.reload();
  }

  private async openNats(defer: Scope.ExtensionCtx["defer"]): Promise<void> {
    const server = await startNatsServer();
    defer(() => server.close());
    this.env.NATS_URL = server.url;
    const connection = await connect({ servers: server.url });
    this.connection = connection;
    defer(() => connection.close());
  }

  private async openVite(defer: Scope.ExtensionCtx["defer"]): Promise<void> {
    const reload = () => this.reload();
    const serverDirectory = `${dirname(this.entry)}${sep}`;
    const vite = await createVite({
      root: this.options.root,
      appType: "custom",
      logLevel: "silent",
      server: {
        middlewareMode: true,
        hmr: { server: this.listener },
        watch: {
          ignored: [`${this.env.DATA_PATH}/**`],
          /** Wait for a complete save; the watcher's direct change path drops rapid repeats. */
          awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 10 },
        },
      },
      environments: {
        ssr: {
          resolve: { external: true },
          dev: {
            createEnvironment: (name, config) => {
              const environment = createRunnableDevEnvironment(name, config, {
                runnerOptions: { hmr: false },
              });
              this.runner = environment.runner;
              return environment;
            },
          },
        },
      },
      plugins: [
        {
          name: "tinker-dev-root",
          async hotUpdate({ file, modules }) {
            if (this.environment.name !== "ssr") return;
            if (modules.length === 0 && !file.startsWith(serverDirectory)) return;
            this.environment.moduleGraph.invalidateAll();
            await reload();
            return [];
          },
        },
      ],
    });
    this.vite = vite;
    defer(() => vite.close());
  }

  /** The chain owns every watcher promise. A failure is a served 503, not an unhandled rejection. */
  private reload(): Promise<void> {
    this.pending = this.pending.then(async () => {
      if (this.stopping) return;
      this.current = undefined;
      this.failure = "reloading";
      try {
        await this.stopRoot();
        this.runner!.clearCache();
        const entry = await this.runner!.import<Record<string, unknown>>(this.entry);
        const run = readRoot(entry);
        const stop = new AbortController();
        const ready = Promise.withResolvers<Dev.App>();
        const done = run(this.env, AbortSignal.any([stop.signal, this.signal]), {
          client: this.client!,
          connection: this.connection,
          ready: (app) => ready.resolve(app),
        }).then<RootEnd, RootEnd>(
          (code) => ({ code }),
          (error: unknown) => ({ error }),
        );
        this.root = { stop, done };
        this.current = await Promise.race([
          ready.promise,
          done.then((end) => {
            if ("error" in end) throw end.error;
            return raise("DevRootStopped", { code: end.code });
          }),
        ]);
        this.options.report?.({ kind: "ready", url: this.url! });
      } catch (error) {
        await this.stopRoot();
        this.failure = error instanceof Error ? error.message : String(error);
        this.options.report?.({ kind: "error", error });
      }
    });
    return this.pending;
  }

  private async stopRoot(): Promise<RootEnd | undefined> {
    const root = this.root;
    this.root = undefined;
    if (!root) return;
    root.stop.abort();
    return root.done;
  }

  private async answer(request: Request): Promise<Response> {
    const app = this.current;
    if (!app) return new Response(this.failure, { status: 503 });
    const response = await app.fetch(request);
    if (response.status !== 404 || request.method !== "GET") return response;
    const url = new URL(request.url);
    if (url.pathname !== "/" && !request.headers.get("accept")?.includes("text/html")) {
      return response;
    }
    const html = await readFile(join(this.options.root, "index.html"), "utf8");
    return new Response(await this.vite!.transformIndexHtml(url.pathname, html), {
      headers: { "content-type": "text/html" },
    });
  }

  async close(): Promise<void> {
    this.stopping = true;
    this.current = undefined;
    this.failure = "stopping";
    await this.pending;
    const end = await this.stopRoot();
    if (end && "error" in end) throw end.error;
    if (end?.code) raise("DevRootStopped", { code: end.code });
  }
}

/** Vite loads an editable file: check the entry export at that boundary. */
function readRoot(entry: Record<string, unknown>): Dev.Root {
  if (typeof entry.runServer !== "function") return raise("BadDevEntry", {});
  return entry.runServer as Dev.Root;
}

type RootEnd = { code: number } | { error: unknown };
