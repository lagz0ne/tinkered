import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import {
  data,
  operation,
  resource,
  tag,
  type Clock,
  type Operation,
  type Scope,
} from "@tinker/core";
import { makeTestClock, type Clock as TestClock } from "@tinker/core/testing";
import { z } from "zod";

export declare namespace Service {
  type Request = { route: string; path: string; body: unknown; key?: string; token?: string };
  type Reply = { status: number; body: unknown };
  type Call = { route: string; time: number; status: number };
  type Rule = { delayMs: number; status?: number; repeat: number; saved?: Reply };
  type Rules = Record<string, Rule>;
  type Options = { port: number; host: string; controlToken: string; signal: AbortSignal };
}

export const stopSignal = tag<AbortSignal>({ label: "service stop signal" });
export const port = tag({ label: "service port", default: 0 });
export const host = tag({ label: "service host", default: "127.0.0.1" });
export const controlToken = tag<string>({ label: "control token" });
export const calls = data<Service.Call[]>({ label: "HTTP calls", initial: [] });
export const rules = data<Service.Rules>({ label: "route rules", initial: {} });
const testClock = data<TestClock.Test | undefined>({
  label: "service test clock",
  initial: undefined,
});

/** The clock must switch without replacing the HTTP resource or losing pending virtual waits. */
export const clock = resource({
  label: "service clock",
  depends: { test: testClock.controller },
  factory({ test }, ctx) {
    const handle: Clock.Handle = {
      currentTimeMillis: () => (test.get() ?? ctx.clock).currentTimeMillis(),
      currentTimeNanos: () => (test.get() ?? ctx.clock).currentTimeNanos(),
      sleep: (ms, signal) => (test.get() ?? ctx.clock).sleep(ms, signal),
    };
    return {
      ...handle,
      setTime(now: number) {
        const current = test.get();
        if (current) current.setTime(now);
        else test.set(makeTestClock({ now }));
      },
      advance(ms: number) {
        const current = test.get() ?? makeTestClock({ now: ctx.clock.currentTimeMillis() });
        test.set(current);
        current.advance(ms);
      },
    };
  },
});

export function reply(status: number, body: unknown): Service.Reply {
  return { status, body };
}

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
    if (request.route === "GET /control/calls") return reply(200, { data: calls });
    if (request.route === "POST /control/routes") {
      const parsed = routeSchema.safeParse(request.body);
      if (!parsed.success) return reject("invalid_route_rule");
      const { route, ...rule } = parsed.data;
      rules.update((previous) => ({ ...previous, [route]: rule }));
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

/** Validate the wire once; route operations then validate their own JSON shapes. */
async function readRequest(request: IncomingMessage): Promise<Service.Request> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  let bytes = "";
  for await (const chunk of request) bytes += String(chunk);
  let body: unknown = {};
  if (bytes) {
    try {
      body = request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")
        ? Object.fromEntries(new URLSearchParams(bytes))
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

/** Node owns socket events; the resource owns their operation promises until shutdown. */
export function createHttp(action: Operation.Handle<Promise<Service.Reply>, Service.Request>) {
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
      let response: Service.Reply;
      if (request.path.startsWith("/control/")) {
        response =
          request.token === `Bearer ${token}`
            ? await action.run({ input: request })
            : reject("unauthorized", 401);
      } else {
        const rule = rules.get()[request.route];
        if (rule?.delayMs && !(await sleepUntilStopped(clock, rule.delayMs, stop, ctx.signal)))
          return reject("service_stopped", 503);
        response = await applyRule(rule, request, action);
        if (rule)
          rules.update((all) => ({
            ...all,
            [request.route]: {
              ...rule,
              saved: response,
              repeat: rule.saved ? Math.max(0, rule.repeat - 1) : rule.repeat,
            },
          }));
      }
      calls.update((all) => [...all, { route: request.route, time, status: response.status }]);
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
          response.writeHead(result.status, { "content-type": "application/json" });
          response.end(JSON.stringify(result.body));
        } catch (error) {
          ctx.log.error("HTTP request failed", { error });
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify(reject("internal_error", 500).body));
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
      if (address === null || typeof address === "string") return ctx.raise("InvalidAddress", {});
      return { url: `http://${host}:${address.port}` };
    },
  });
}

async function applyRule(
  rule: Service.Rule | undefined,
  request: Service.Request,
  action: Scope.OperationController<Promise<Service.Reply>, Service.Request>,
): Promise<Service.Reply> {
  if (rule?.saved && rule.repeat > 0) return rule.saved;
  if (rule?.status) return reject("injected_failure", rule.status);
  return action.run({ input: request });
}

/** A root stops gracefully; background waits must end before Core can drain that root. */
export async function sleepUntilStopped(
  clock: Clock.Handle,
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
