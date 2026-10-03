import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { data, operation, resource, tag, type Clock, type Operation } from "@tinker/core";
import { z } from "zod";
import { failFlightService } from "../src/errors.ts";

export declare namespace Service {
  type Request = { route: string; path: string; body: unknown; key?: string; token?: string };
  type Reply = { status: number; body: unknown; headers?: Record<string, string> };
  type Failure = (code: string, status?: number) => Reply;
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
  type Wait = { at: number; wake: () => void };
  type Options = { port: number; host: string; controlToken: string; signal: AbortSignal };
}

export const stopSignal = tag<AbortSignal>({ label: "service stop signal" });
export const port = tag({ label: "service port", default: 0 });
export const host = tag({ label: "service host", default: "127.0.0.1" });
export const controlToken = tag<string>({ label: "control token" });
export const calls = data<Service.Entry[]>({ label: "HTTP calls", initial: [] });
export const rules = data<Service.Rules>({ label: "route rules", initial: {} });
/** Real waits stay on Core's clock; grader time owns only the waits started after a switch. */
class ServiceClock {
  private real: Clock.Handle;
  private now?: number;
  private waits = new Set<Service.Wait>();

  constructor(real: Clock.Handle) {
    this.real = real;
  }

  currentTimeMillis() {
    return this.now ?? this.real.currentTimeMillis();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (this.now === undefined) return this.real.sleep(ms, signal);
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      if (ms <= 0) return resolve();
      const wait = {
        at: this.currentTimeMillis() + ms,
        wake: () => {
          this.waits.delete(wait);
          signal?.removeEventListener("abort", abort);
          resolve();
        },
      };
      const abort = () => {
        this.waits.delete(wait);
        reject(signal?.reason);
      };
      this.waits.add(wait);
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  setTime(now: number) {
    this.now = now;
    for (const wait of [...this.waits].sort((a, b) => a.at - b.at)) {
      if (wait.at <= now) wait.wake();
    }
  }

  advance(ms: number) {
    this.setTime(this.currentTimeMillis() + ms);
  }
}

export const clock = resource({
  label: "service clock",
  factory: (_deps, ctx) => new ServiceClock(ctx.clock),
});

/** Wire values are pure copies; the HTTP resource owns the socket. */
export function reply(status: number, body: unknown): Service.Reply {
  return { status, body };
}

/** Pure error shaping does not throw into the service scope. */
export function reject(code: string, status = 400): Service.Reply {
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

export const control = operation({
  label: "control common settings",
  depends: { rules: rules.controller, calls, clock },
  run({ rules, calls, clock }, ctx: Operation.Ctx<Service.Request>) {
    const request = ctx.input;
    if (request.route === "GET /control/calls")
      return reply(200, { data: calls.map(({ id: _id, ...call }) => call) });
    if (request.route === "POST /control/routes") {
      const parsed = routeSchema.safeParse(request.body);
      if (!parsed.success) return reject("invalid_route_rule");
      const { route, ...rule } = parsed.data;
      rules.update((previous) => ({
        ...previous,
        [route]: { ...rule, revision: ctx.random.uuid() },
      }));
      return reply(200, { data: parsed.data });
    }
    if (request.route === "POST /control/clock") {
      const parsed = clockSchema.safeParse(request.body);
      if (!parsed.success) return reject("invalid_clock");
      if ("now" in parsed.data) clock.setTime(parsed.data.now);
      else clock.advance(parsed.data.advanceMs);
      return reply(200, { data: { now: clock.currentTimeMillis() } });
    }
    return reject("not_found", 404);
  },
});

/** Bracket keys carry nested Stripe fields; unsafe object keys never reach the body. */
function readForm(bytes: string): Service.Form {
  const body: Service.Form = {};
  for (const [key, value] of new URLSearchParams(bytes)) {
    const parts = key.split(/[[\]]/).filter(Boolean);
    if (parts.some((part) => ["__proto__", "constructor", "prototype"].includes(part))) continue;
    let current = body;
    for (const part of parts.slice(0, -1)) {
      const nested = current[part];
      if (typeof nested === "object") current = nested;
      else {
        const next: Service.Form = {};
        current[part] = next;
        current = next;
      }
    }
    const name = parts.at(-1);
    if (name) current[name] = value === "true" || value === "false" ? value === "true" : value;
  }
  return body;
}

/** Validate the wire once; route operations then validate their own JSON shapes. */
async function readRequest(request: IncomingMessage): Promise<Service.Request> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const bytes = Buffer.concat(chunks).toString("utf8");
  let body: unknown = {};
  if (bytes) {
    try {
      body = request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")
        ? readForm(bytes)
        : JSON.parse(bytes);
    } catch {
      body = null;
    }
  }
  return {
    path,
    route: `${request.method} ${path}`,
    body,
    key: z.string().optional().parse(request.headers["idempotency-key"]),
    token: z.string().optional().parse(request.headers.authorization),
  };
}

/** Node owns socket events; the resource owns request work. The caller supplies its wire error shape. */
export function createHttp(
  action: Operation.Handle<Promise<Service.Reply>, Service.Request>,
  failure: Service.Failure = reject,
) {
  const dispatch = operation({
    label: "serve HTTP request",
    depends: {
      action: action.controller,
      rules: rules.controller,
      calls: calls.controller,
      clock,
      token: controlToken,
      stop: stopSignal,
    },
    async run({ action, rules, calls, clock, token, stop }, ctx: Operation.Ctx<Service.Request>) {
      const request = ctx.input;
      const time = clock.currentTimeMillis();
      const id = ctx.random.uuid();
      calls.update((all) => [
        ...all,
        {
          id,
          kind: request.path.startsWith("/control/") ? "control" : "service",
          route: request.route,
          time,
          status: 0,
        },
      ]);
      let response: Service.Reply;
      if (request.path.startsWith("/control/")) {
        response =
          request.token === `Bearer ${token}`
            ? await action.run({ input: request })
            : reject("unauthorized", 401);
      } else {
        const rule = rules.get()[request.route];
        const stopped =
          rule &&
          rule.delayMs > 0 &&
          !(await sleepUntilStopped(clock, rule.delayMs, stop, ctx.signal));
        let selected: Service.Rule | undefined;
        rules.update((all) => {
          const current = all[request.route];
          if (!rule || current?.revision !== rule.revision) return all;
          selected = current;
          return current.saved && current.repeat > 0
            ? { ...all, [request.route]: { ...current, repeat: current.repeat - 1 } }
            : all;
        });
        response = stopped
          ? failure("service_stopped", 503)
          : (readRuleReply(selected, failure) ?? (await action.run({ input: request })));
        if (rule)
          rules.update((all) => {
            const current = all[request.route];
            return current?.revision === rule.revision
              ? { ...all, [request.route]: { ...current, saved: response } }
              : all;
          });
      }
      calls.update((all) =>
        all.map((call) => (call.id === id ? { ...call, status: response.status } : call)),
      );
      return response;
    },
  });
  return resource({
    label: "HTTP listener",
    depends: { dispatch: dispatch.controller, port, host },
    async factory({ dispatch, port, host }, ctx) {
      const server = createServer(async (request, response) => {
        try {
          const result = await dispatch.run({ input: await readRequest(request) });
          response.writeHead(result.status, {
            "content-type": "application/json",
            ...result.headers,
          });
          response.end(JSON.stringify(result.body));
        } catch (error) {
          ctx.log.error("HTTP request failed", { error });
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify(failure("internal_error", 500).body));
        }
      });
      server.listen(port, host);
      await once(server, "listening");
      ctx.defer(async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      });
      const address = server.address();
      if (address === null || typeof address === "string")
        failFlightService({ reason: "The listener has no TCP address" });
      return { url: `http://${host}:${address.port}` };
    },
  });
}

/** The dispatch operation keeps ownership of any action selected by this pure choice. */
function readRuleReply(
  rule: Service.Rule | undefined,
  failure: Service.Failure,
): Service.Reply | undefined {
  if (rule?.saved && rule.repeat > 0) return rule.saved;
  if (rule?.status) return failure("injected_failure", rule.status);
}

/** A root stops gracefully; background waits must end before Core can drain that root. */
export async function sleepUntilStopped(
  clock: Pick<Clock.Handle, "sleep">,
  ms: number,
  stop: AbortSignal,
  signal: AbortSignal,
): Promise<boolean> {
  const combined = AbortSignal.any([stop, signal]);
  try {
    await clock.sleep(ms, combined);
    return !combined.aborted;
  } catch (error) {
    if (!combined.aborted) throw error;
    return false;
  }
}
