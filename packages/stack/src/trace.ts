import { extension, LEVELS, type Clock, type Observe } from "@tinker/core";
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
}

/** Make one piece per root, passing both its extension and observe config.
 * The root owns the queue and timer. Env is read at start; queued data is copied.
 * Close joins the bounded network work after core exports its last spans. */
export function traceSink(wiring: TraceSink.Wiring) {
  const local = jsonLines(wiring.write);
  let queue: TraceQueue | undefined;
  const observe: Observe.Config = {
    export: (span) => {
      writeLocal(() => local.export?.(span));
      queue?.add("traces", () => encodeSpan(span));
    },
    log: (entry) => {
      writeLocal(() => local.log?.(entry));
      queue?.add("logs", () => encodeLog(entry));
    },
  };
  return {
    observe,
    extension: extension({
      label: "stack.trace",
      start: async (_scope, ctx, next) => {
        const settings = readSettings(wiring.env);
        queue = new TraceQueue(settings, ctx.clock, local);
        const timer = queue.start();
        ctx.defer(async () => {
          await queue!.stop(timer);
        });
        await next();
      },
      close: async (_options, next) => {
        const result = await next();
        await queue?.flush();
        queue = undefined;
        return result;
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
  private records = { traces: [] as string[], logs: [] as string[] };
  private bytes = 0;
  private warned = false;
  private pending?: Promise<void>;
  private stopTimer = new AbortController();

  constructor(
    settings: { endpoint: string; service: string },
    clock: Clock.Handle,
    local: Observe.Config,
  ) {
    this.settings = settings;
    this.clock = clock;
    this.local = local;
  }

  add(signal: "traces" | "logs", encode: () => string): void {
    try {
      const record = encode();
      const bytes = Buffer.byteLength(record);
      if (
        this.records.traces.length + this.records.logs.length >= 2048 ||
        this.bytes + bytes > 1_048_576
      ) {
        this.warn("queue full");
        return;
      }
      this.records[signal].push(record);
      this.bytes += bytes;
    } catch {
      this.warn("record could not be encoded");
    }
  }

  async start(): Promise<void> {
    while (!this.stopTimer.signal.aborted) {
      try {
        await this.clock.sleep(1000, this.stopTimer.signal);
      } catch {
        return;
      }
      await this.flush();
    }
  }

  async stop(timer: Promise<void>): Promise<void> {
    this.stopTimer.abort();
    await timer;
    await this.flush();
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.bytes === 0) return;
    const records = this.records;
    this.records = { traces: [], logs: [] };
    this.bytes = 0;
    this.pending = this.send(records);
    await this.pending;
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
        signal: controller.signal,
        redirect: "error",
      });
      await response.body?.cancel();
      return response.status === 200;
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
