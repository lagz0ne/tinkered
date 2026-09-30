import {
  data,
  extension,
  LEVELS,
  operation,
  resource,
  tag,
  type Clock,
  type Observe,
  type Operation,
  type Scope,
  type Tag,
} from "@tinker/core";
import { raise } from "./errors.ts";
import { jsonLines } from "./observe.ts";
import { encodeBatch, encodeLog, encodeSpan } from "./otlp.ts";

export declare namespace TraceSink {
  type Env = { OTEL_EXPORTER_OTLP_ENDPOINT?: string; OTEL_SERVICE_NAME?: string };
  type Wiring = {
    env: Env;
    /** Local JSON lines, without a trailing newline. Never sent back to OTLP. */
    write: (line: string) => void;
  };
  type Extension = Scope.Extension<Observe.Config> & {
    readonly config: Tag.Handle<Wiring>;
  };
}

/** Reuse this definition in telemetry roots with their own config tags.
 * Resolve it after ready and lend its observe config to app roots. Close the
 * apps before telemetry so graceful close exports their final records. */
export function traceSink(): TraceSink.Extension;
/** Legacy root-only wiring: make a fresh piece per observed root and pass
 * both its extension and observe config. Only graceful close flushes. */
export function traceSink(wiring: TraceSink.Wiring): {
  observe: Observe.Config;
  extension: Scope.Extension<void>;
};
export function traceSink(wiring?: TraceSink.Wiring) {
  return wiring === undefined ? createTraceExtension() : createRootTraceSink(wiring);
}

function createTraceExtension(): TraceSink.Extension {
  const config = tag<TraceSink.Wiring>({ label: "stack.trace.config" });
  /** Close must not resolve a failed queue and block the rest of cleanup. */
  const startedQueue = data<TraceQueue | undefined>({
    label: "stack.trace.startedQueue",
    initial: undefined,
  });
  const queue = resource({
    label: "stack.trace.queue",
    target: "scope",
    depends: { config: config.required },
    factory: ({ config }, ctx) => {
      const owned = new TraceQueue(readSettings(config.env), ctx.clock, jsonLines(config.write));
      ctx.defer(() => owned.stop());
      return owned;
    },
  });
  const ingest = operation({
    label: "stack.trace.ingest",
    depends: { queue },
    run: ({ queue }, ctx: Operation.Ctx<Observe.Span | Observe.Log>) => queue.ingest(ctx.input),
  });
  const exportBatch = operation({
    label: "stack.trace.export",
    depends: { queue },
    run: ({ queue }) => queue.flush(),
  });
  const observe = resource({
    label: "stack.trace.observe",
    target: "scope",
    depends: { ingest },
    factory: ({ ingest }): Observe.Config => ({
      export: (span) => ingest.run({ input: span }),
      log: (entry) => ingest.run({ input: entry }),
    }),
  });
  return Object.assign(
    extension({
      label: "stack.trace",
      hooks: {
        start: async (event) => {
          const owned = event.resolve(queue);
          event.controller(startedQueue).set(owned);
          const exporter = event.controller(exportBatch);
          owned.start(() => exporter.run());
          await event.next();
          return event.resolve(observe);
        },
        close: async (event) => {
          const owned = event.resolve(startedQueue);
          owned?.beginClose(event.options.graceful === true);
          try {
            return await event.next();
          } finally {
            await owned?.finishClose();
          }
        },
      },
    }),
    { config },
  );
}

function createRootTraceSink(wiring: TraceSink.Wiring) {
  const local = jsonLines(wiring.write);
  let queue: TraceQueue | undefined;
  const observe: Observe.Config = {
    export: (span) => {
      writeLocal(() => local.export?.(span));
      queue?.add(span);
    },
    log: (entry) => {
      writeLocal(() => local.log?.(entry));
      queue?.add(entry);
    },
  };
  return {
    observe,
    extension: extension({
      label: "stack.trace",
      start: async (_scope, ctx, next) => {
        const settings = readSettings(wiring.env);
        const owned = new TraceQueue(settings, ctx.clock, local);
        queue = owned;
        owned.start(() => owned.flush());
        ctx.defer(async () => {
          await owned.stop();
        });
        await next();
      },
      close: async (options, next) => {
        const owned = queue;
        owned?.beginClose(options.graceful === true);
        try {
          return await next();
        } finally {
          await owned?.finishClose();
          queue = undefined;
        }
      },
    }),
  };
}

function readSettings(env: TraceSink.Env): { endpoint: string; service: string } {
  const keys: string[] = [];
  const url = URL.parse(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "");
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    [url.username, url.password, url.search, url.hash].some(Boolean)
  ) {
    keys.push("OTEL_EXPORTER_OTLP_ENDPOINT");
  }
  const service = (env.OTEL_SERVICE_NAME ?? "").trim();
  if (!service) keys.push("OTEL_SERVICE_NAME");
  if (keys.length) raise("BadTraceSettings", { keys });
  return { endpoint: url!.href.replace(/\/$/, ""), service };
}

/** A broken local writer must not stop export or turn a collector fault into
 * a scope fault. This boundary is also used outside core's sink isolation. */
function writeLocal(write: () => void): void {
  try {
    write();
  } catch {
    return;
  }
}

class TraceQueue {
  private settings: { endpoint: string; service: string };
  private clock: Clock.Handle;
  private local: Observe.Config;
  private records: (Observe.Span | Observe.Log)[] = [];
  private state: "open" | "graceful" | "stopped" = "open";
  private warned = false;
  private pending?: Promise<void>;
  private timer?: Promise<void>;
  private stopTimer = new AbortController();
  private stopDeadline = new AbortController();
  private requests = new AbortController();
  private deadline?: Promise<void>;

  constructor(
    settings: { endpoint: string; service: string },
    clock: Clock.Handle,
    local: Observe.Config,
  ) {
    this.settings = settings;
    this.clock = clock;
    this.local = local;
  }

  ingest(record: Observe.Span | Observe.Log): void {
    writeLocal(() => ("level" in record ? this.local.log?.(record) : this.local.export?.(record)));
    this.add(record);
  }

  add(record: Observe.Span | Observe.Log): void {
    if (this.state === "stopped") {
      this.warn("scope closed");
      return;
    }
    if (this.records.length >= 2048) {
      this.warn("queue full");
      return;
    }
    this.records.push(record);
  }

  start(flush: () => Promise<void>): void {
    this.timer = this.runTimer(flush);
  }

  private async runTimer(flush: () => Promise<void>): Promise<void> {
    while (!this.stopTimer.signal.aborted) {
      try {
        await this.clock.sleep(1000, this.stopTimer.signal);
      } catch {
        return;
      }
      if (this.stopTimer.signal.aborted) return;
      await flush();
    }
  }

  async stop(): Promise<void> {
    /** A failed start can run defers without running the close hook. */
    if (this.state === "open") this.beginClose(false);
    await this.timer;
  }

  beginClose(graceful: boolean): void {
    this.stopTimer.abort();
    if (!graceful) this.drop("scope closed");
    else if (this.state === "open") {
      this.state = "graceful";
      this.deadline = this.waitForDeadline();
    }
  }

  async finishClose(): Promise<void> {
    if (this.state === "graceful") await this.flush();
    this.state = "stopped";
    this.stopDeadline.abort();
    await this.deadline;
  }

  private async waitForDeadline(): Promise<void> {
    try {
      await this.clock.sleep(1000, this.stopDeadline.signal);
    } catch {
      return;
    }
    this.drop("collector unavailable");
  }

  private drop(reason: string): void {
    this.state = "stopped";
    if (this.records.length || this.pending) this.warn(reason);
    this.records = [];
    this.requests.abort();
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.state === "stopped") return;
    const records = this.records;
    this.records = [];
    const batch = { traces: [] as string[], logs: [] as string[] };
    let bytes = 0;
    for (const record of records) {
      try {
        const log = "level" in record;
        const encoded = log ? encodeLog(record) : encodeSpan(record);
        const size = Buffer.byteLength(encoded);
        if (bytes + size > 1_048_576) {
          this.warn("queue full");
          continue;
        }
        batch[log ? "logs" : "traces"].push(encoded);
        bytes += size;
      } catch {
        this.warn("record could not be encoded");
      }
    }
    if (bytes === 0) return;
    this.pending = this.send(batch);
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  private async send(records: { traces: string[]; logs: string[] }): Promise<void> {
    const results = await Promise.all([
      this.post("traces", records.traces),
      this.post("logs", records.logs),
    ]);
    if (results.every(Boolean)) this.warned = false;
    else this.warn("collector unavailable");
  }

  private async post(signal: "traces" | "logs", records: string[]): Promise<boolean> {
    if (records.length === 0) return true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const response = await fetch(`${this.settings.endpoint}/v1/${signal}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: encodeBatch(this.settings.service, signal, records),
        signal: AbortSignal.any([controller.signal, this.requests.signal]),
        redirect: "error",
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private warn(reason: string): void {
    if (this.warned) return;
    this.warned = true;
    writeLocal(() =>
      this.local.log?.({
        time: this.clock.currentTimeMillis(),
        level: LEVELS.warn,
        message: "OTLP records dropped",
        attributes: { reason },
        span: undefined,
      }),
    );
  }
}
