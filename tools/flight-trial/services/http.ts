import { data, operation, resource, tag } from "@tinker/core";
import { z } from "zod";

export declare namespace Wire {
  type Request = z.infer<typeof requestSchema>;
  type Reply = { status: number; body: unknown; headers?: Record<string, string> };
  type Form = { [key: string]: string | boolean | Form };
  type Call = {
    kind: "service" | "control" | "webhook";
    route: string;
    time: number;
    status: number;
  };
  type Entry = Call & { id: string };
  type Rule = { revision: string; delayMs: number; status?: number; repeat: number; saved?: Reply };
  type Rules = Record<string, Rule>;
}

export const requestSchema = z.object({
  route: z.string(),
  path: z.string(),
  body: z.unknown(),
  key: z.string().optional(),
  token: z.string().optional(),
});
export const stopSignal = tag<AbortSignal>({ label: "service stop signal" });
export const port = tag({ label: "service port", default: 0 });
export const host = tag({ label: "service host", default: "127.0.0.1" });
export const controlToken = tag<string>({ label: "control token" });
export const calls = data<Wire.Entry[]>({ label: "HTTP calls", initial: [] });
export const rules = data<Wire.Rules>({ label: "route rules", initial: {} });

/** Grader time owns only waits started after the switch; the root clock stays real. */
export const clock = resource({
  label: "service clock",
  factory(_deps, ctx) {
    let now: number | undefined;
    const waits = new Set<{ at: number; wake: () => void }>();
    const handle = {
      currentTimeMillis() {
        return now ?? ctx.clock.currentTimeMillis();
      },
      sleep(ms: number, signal?: AbortSignal): Promise<void> {
        if (now === undefined) return ctx.clock.sleep(ms, signal);
        return new Promise<void>((resolve, reject) => {
          if (signal?.aborted) return reject(signal.reason);
          if (ms <= 0) return resolve();
          const wait = {
            at: handle.currentTimeMillis() + ms,
            wake: () => {
              waits.delete(wait);
              signal?.removeEventListener("abort", abort);
              resolve();
            },
          };
          const abort = () => {
            waits.delete(wait);
            reject(signal?.reason);
          };
          waits.add(wait);
          signal?.addEventListener("abort", abort, { once: true });
        });
      },
      setTime(value: number) {
        now = value;
        for (const wait of [...waits].sort((a, b) => a.at - b.at))
          if (wait.at <= value) wait.wake();
      },
      advance(ms: number) {
        handle.setTime(handle.currentTimeMillis() + ms);
      },
    };
    return handle;
  },
});

/**
 * Borrows plain wire data; the listener owns the response socket.
 * @param status - Chosen by the calling operation; needed for the HTTP response code.
 * @param body - Plain JSON from the calling operation; needed for the response payload.
 */
export function reply(status: number, body: unknown): Wire.Reply {
  return { status, body };
}

/**
 * Shapes a Duffel error without throwing into the service scope.
 * @param code - Error choice from the calling operation; needed for the Duffel code and title.
 * @param status - HTTP choice from the calling operation; needed to distinguish bad input from missing or conflicting state.
 */
export function reject(code: string, status = 400): Wire.Reply {
  return reply(status, { errors: [{ type: "invalid_request_error", code, title: code }] });
}

const routeSchema = z.object({
  route: z.string().min(1),
  delayMs: z.number().int().nonnegative().default(0),
  status: z.number().int().min(400).max(599).optional(),
  repeat: z.number().int().nonnegative().default(0),
});
const clockSchema = z.union([
  z.object({ now: z.number().int().nonnegative() }),
  z.object({ advanceMs: z.number().int().nonnegative() }),
]);

const setRoute = operation({
  label: "set route rule",
  input: (raw) => routeSchema.safeParse(raw),
  depends: { rules: rules.controller },
  run({ rules }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_route_rule");
    const { route, ...rule } = parsed.data;
    rules.update((previous) => ({
      ...previous,
      [route]: { ...rule, revision: ctx.random.uuid() },
    }));
    return reply(200, { data: parsed.data });
  },
});
const setClock = operation({
  label: "set service time",
  input: (raw) => clockSchema.safeParse(raw),
  depends: { clock },
  run({ clock }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_clock");
    if ("now" in parsed.data) clock.setTime(parsed.data.now);
    else clock.advance(parsed.data.advanceMs);
    return reply(200, { data: { now: clock.currentTimeMillis() } });
  },
});
export const control = operation({
  label: "control common settings",
  input: requestSchema,
  depends: { routes: setRoute.controller, time: setClock.controller, calls },
  async run({ routes, time, calls }, ctx) {
    const request = ctx.input;
    if (request.route === "GET /control/calls")
      return reply(200, { data: calls.map(({ id: _id, ...call }) => call) });
    if (request.route === "POST /control/routes") return routes.run({ rawInput: request.body });
    if (request.route === "POST /control/clock") return time.run({ rawInput: request.body });
    return reject("not_found", 404);
  },
});

/** Both listeners give this operation owned UTF-8 text; it owns no socket. */
export const decodeBody = operation({
  label: "decode HTTP body",
  input: z.object({ bytes: z.string(), form: z.boolean() }),
  run(_deps, ctx): unknown {
    if (!ctx.input.bytes) return {};
    try {
      if (!ctx.input.form) return JSON.parse(ctx.input.bytes);
      const body: Wire.Form = {};
      const booleans: Record<string, boolean> = { true: true, false: false };
      for (const [key, value] of new URLSearchParams(ctx.input.bytes)) {
        const parts = key.split(/[[\]]/).filter(Boolean);
        if (parts.some((part) => ["__proto__", "constructor", "prototype"].includes(part)))
          continue;
        const current = parts.slice(0, -1).reduce((parent, part) => {
          const nested = parent[part];
          if (typeof nested === "object") return nested;
          const next: Wire.Form = {};
          parent[part] = next;
          return next;
        }, body);
        const name = parts.at(-1);
        if (name) current[name] = Object.hasOwn(booleans, value) ? booleans[value] : value;
      }
      return body;
    } catch {
      return null;
    }
  },
});
