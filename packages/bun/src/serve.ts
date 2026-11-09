import type { Scope } from "@tinker/core";
import type { HTMLBundle, Server, WebSocketHandler } from "bun";

/**
 * What the host gives a command: its inputs, and the stop. A command picks its own exit codes;
 * a startup throw exits 78 for a config error, else 1, so a command just lets it throw.
 */
export type MainContext = {
  env: Readonly<Record<string, string | undefined>>;
  args: readonly string[];
  /** The folder the process runs in; the host reads it, so commands read no process global. */
  cwd: string;
  signal: AbortSignal;
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
  exit: (code: number, reason?: unknown) => void;
};

/** The root close results, app first. A failed root exits 1, else its first teardown error. */
export type MainClosed = Promise<void | Scope.Result | readonly Scope.Result[]>;

/**
 * A server command. `fetch` answers undefined when the path is not the command's (404 here),
 * and null when it upgraded the request to a WebSocket (Bun owns it now).
 */
export type Main = (ctx: MainContext) => Promise<{
  fetch: (request: Request, server: Server<never>) => Promise<Response | null | undefined>;
  websocket?: WebSocketHandler<never>;
  /** The largest request body Bun takes (its own default is 128 MiB). */
  maxRequestBodySize?: number;
  closed: MainClosed;
}>;

/** POSIX exit codes for a stop by signal: 128 plus the signal's number. */
const signalCodes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;

/** A startup throw of these kinds is a config error: exit 78 (EX_CONFIG). */
const configKinds = ["MissingTag", "MissingConfig", "DataValidationFailed"];

/** The exit code for a startup throw: 78 for a config error or a bad URL, else 1. */
const startCode = (error: unknown) =>
  configKinds.includes(Object(error).kind) || Object(error).code === "ERR_INVALID_URL" ? 78 : 1;

/** The first failure in the root close results, app first: a failed root's error, else its first teardown error. */
const failureOf = (closed: Awaited<MainClosed>) =>
  [closed ?? []]
    .flat()
    .flatMap((end) => (end.status === "failed" ? [end.error] : (end.teardownErrors ?? [])))
    .at(0);

type Started = Awaited<ReturnType<Main>>;

/** The command's paths, each answered by its `fetch`: null is an upgrade, undefined a 404. */
const commandRoutes = (started: Started, paths: readonly string[]) =>
  Object.fromEntries(
    ["/api/*", "/rpc", "/rpc/*", ...paths].map((path) => [
      path,
      async (request: Request, server: Server<never>) => {
        const reply = await started.fetch(request, server);
        return reply === null ? undefined : (reply ?? new Response(null, { status: 404 }));
      },
    ]),
  );

/** One `Bun.serve` for a started command, its pages beside its paths. */
const listen = (
  started: Started,
  pages: Record<string, HTMLBundle | Response>,
  paths: readonly string[],
) =>
  Bun.serve({
    port: Number(process.env.PORT ?? 4318),
    // Bun's 10 s default cuts a slow request; 60 s (max 255) matches the socket idle time.
    idleTimeout: 60,
    maxRequestBodySize: started.maxRequestBodySize,
    // Bun's types want `fetch` beside `websocket`; unset, Bun reads `websocket` as absent.
    websocket: started.websocket as never,
    fetch: () => new Response(null, { status: 404 }),
    development: process.env.NODE_ENV !== "production" && { hmr: false, console: true },
    routes: { ...commandRoutes(started, paths), ...pages },
  });

/**
 * Runs one server command on `Bun.serve`, and owns OS signals and the exit code:
 * - a startup throw exits 78 for a config error (a missing tag or config key, a value that
 *   failed its schema, a bad URL), else 1;
 * - a failed root exits 1; a signal exits 128 + its number;
 * - SIGHUP (a closed terminal) stops it like SIGTERM, so `nohup` does not keep it alive;
 * - a stop during start ends with the stop's own code, and no second line.
 * A command that calls `exit` during start gets that code and no port. `/api/*`, `/rpc`,
 * `/rpc/*` and each of `options.paths` (Bun route patterns) go to the command; every other path
 * gets the page. `pages` are the client's routes: Bun's HTML import (dev, or a compiled binary
 * with the client inside), or a build's own files.
 */
export async function serve(
  main: Main,
  pages: Record<string, HTMLBundle | Response>,
  options: { paths?: readonly string[] } = {},
) {
  const stop = new AbortController();
  let code = 0;
  const exit = (next: number, reason?: unknown) => {
    const { kind, payload } = Object(reason);
    if (kind !== undefined) console.error(`tinker: ${kind} ${JSON.stringify(payload)}`);
    else if (reason !== undefined) console.error(reason);
    code ||= next;
    stop.abort(reason);
  };
  for (const [name, signalCode] of Object.entries(signalCodes)) {
    process.once(name, () => exit(signalCode));
  }

  const started = await main({
    env: process.env,
    args: process.argv.slice(2),
    cwd: process.cwd(),
    signal: stop.signal,
    stdout: process.stdout,
    stderr: process.stderr,
    exit,
  }).catch((error: unknown) => {
    if (stop.signal.aborted && error === stop.signal.reason) return;
    exit(startCode(error), error);
  });
  if (!started) return process.exit(code);

  // A command that called `exit` during start (a usage error) gets no port; its root still closes.
  const servers = stop.signal.aborted ? [] : [listen(started, pages, options.paths ?? [])];
  for (const server of servers) {
    console.log(`tinker: listening on ${server.url}`);
    stop.signal.addEventListener("abort", () => void server.stop());
  }

  const failure = failureOf(await started.closed);
  if (failure !== undefined) exit(1, failure);
  await Promise.all(servers.map((server) => server.stop()));
  process.exit(code);
}
