import { once } from "node:events";
import { serve } from "@hono/node-server";
import { Hono, type Context, type Next } from "hono";
import { createMiddleware } from "hono/factory";
import { data, operation, resource, tag, type Scope, type RunResult } from "@tinker/core";
import { failFlightService } from "../src/errors.ts";
import { z } from "zod";

export declare namespace Wire {
  type Env = {
    Variables: {
      scope: Scope.Handle;
      json: (result: Reply) => Response;
      error: (kind: string, status?: number) => Response;
      respond: (result: RunResult<unknown>, status: number, envelope: boolean) => Response;
      body: unknown;
      control: boolean;
    };
  };
  type Selection = { revision?: string; replay?: boolean; failure?: number };
  type Error = { code: string; status: number; type?: string; duffel?: boolean };
  type Reply = { status: number; body: unknown; headers?: Record<string, string> };
  type Form = { [key: string]: string | boolean | Form };
  type Call = {
    kind: "service" | "control" | "webhook";
    route: string;
    time: number;
    status: number;
  };
  type Entry = Call & { id: string; delivery?: "delivered" | "rejected" | "unreachable" };
  type Rule = { revision: string; delayMs: number; status?: number; repeat: number; saved?: Reply };
  type Rules = Record<string, Rule>;
}

/** Shared control failures always keep the Duffel body, even on the payment service. */
export const commonErrors = {
  InvalidRouteRule: { code: "invalid_route_rule", status: 400, duffel: true },
  InvalidClock: { code: "invalid_clock", status: 400, duffel: true },
  InvalidScenario: { code: "invalid_scenario", status: 400, duffel: true },
  Unauthorized: { code: "unauthorized", status: 401, duffel: true },
  NotFound: { code: "not_found", status: 404, duffel: true },
  InjectedFailure: { code: "injected_failure", status: 503 },
  ServiceStopped: { code: "service_stopped", status: 503 },
  InternalError: { code: "internal_error", status: 500 },
};
export const wireErrors = tag<Record<string, Wire.Error>>({ label: "service wire errors" });

export const errorShape = tag<"duffel" | "stripe">({ label: "service error shape" });
export const stopSignal = tag<AbortSignal>({ label: "service stop signal" });
export const port = tag({ label: "service port", default: 0 });
export const host = tag({ label: "service host", default: "127.0.0.1" });
export const controlToken = tag<string>({ label: "control token" });
export const calls = data<Wire.Entry[]>({ label: "HTTP calls", initial: [] });
export const rules = data<Wire.Rules>({ label: "route rules", initial: {} });

/** Grader time owns only waits started after the switch; the root clock stays real. */
export const clock = resource({
  label: "service clock",
  depends: { stop: stopSignal },
  factory({ stop }, { clock, closing }) {
    let now: number | undefined;
    const waits = new Set<{ at: number; wake: () => void }>();
    const handle = {
      signal: AbortSignal.any([stop, closing]),
      currentTimeMillis() {
        return now ?? clock.currentTimeMillis();
      },
      sleep(ms: number, signal: AbortSignal): Promise<void> {
        if (now === undefined) return clock.sleep(ms, signal);
        return new Promise<void>((resolve, fail) => {
          if (signal.aborted) return fail(signal.reason);
          if (ms <= 0) return resolve();
          const wait = {
            at: handle.currentTimeMillis() + ms,
            wake: () => {
              waits.delete(wait);
              signal.removeEventListener("abort", abort);
              resolve();
            },
          };
          const abort = () => {
            waits.delete(wait);
            fail(signal.reason);
          };
          waits.add(wait);
          signal.addEventListener("abort", abort, { once: true });
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

const routeSchema = z.object({
  name: z.string().min(1),
  delayMs: z.number().int().nonnegative().default(0),
  status: z.number().int().min(400).max(599).optional(),
  repeat: z.number().int().nonnegative().default(0),
});
const clockSchema = z.union([
  z.object({ now: z.number().int().nonnegative() }),
  z.object({ advanceMs: z.number().int().nonnegative() }),
]);

export const setRoute = operation({
  label: "set route rule",
  input: routeSchema,
  depends: { rules: rules.controller },
  run({ rules }, ctx) {
    const { name, ...rule } = ctx.input;
    rules.update((previous) => ({
      ...previous,
      [name]: { ...rule, revision: ctx.random.uuid() },
    }));
    return { route: name, ...rule };
  },
});
export const setClock = operation({
  label: "set service time",
  input: clockSchema,
  depends: { clock },
  run({ clock }, ctx) {
    if ("now" in ctx.input) clock.setTime(ctx.input.now);
    else clock.advance(ctx.input.advanceMs);
    return { now: clock.currentTimeMillis() };
  },
});
export const readCalls = operation({
  label: "read HTTP calls",
  depends: { calls },
  run({ calls }) {
    return calls.map(({ id: _id, delivery: _delivery, ...call }) => call);
  },
});

const startCall = operation({
  label: "start HTTP call",
  input: z.object({ name: z.string(), kind: z.enum(["control", "service"]) }),
  depends: { calls: calls.controller, clock },
  run({ calls, clock }, ctx) {
    const { kind, name } = ctx.input;
    const id = ctx.random.uuid();
    calls.update((all) => [
      ...all,
      {
        id,
        kind,
        route: name,
        time: clock.currentTimeMillis(),
        status: 0,
      },
    ]);
    return id;
  },
});
const saveCall = operation({
  label: "save HTTP call status",
  input: z.object({ id: z.string(), status: z.number() }),
  depends: { calls: calls.controller },
  run({ calls }, ctx) {
    const { id, status } = ctx.input;
    calls.update((all) => all.map((call) => (call.id === id ? { ...call, status } : call)));
  },
});
const checkToken = operation({
  label: "check control token",
  input: z.object({ token: z.string().optional() }),
  depends: { token: controlToken },
  run({ token }, ctx) {
    return ctx.input.token === `Bearer ${token}`;
  },
});
const replySchema = z.object({
  status: z.number(),
  body: z.unknown(),
  headers: z.record(z.string(), z.string()).optional(),
});
/** Rule names index data only; Hono owns the action between the two calls. */
const applyRule = operation({
  label: "select HTTP rule",
  input: z.object({ name: z.string(), revision: z.string().optional() }),
  depends: { rules: rules.controller },
  run({ rules }, ctx): Wire.Selection {
    const { name, revision } = ctx.input;
    let selected: Wire.Rule | undefined;
    rules.update((all) => {
      const current = all[name];
      if (!revision || current?.revision !== revision) return all;
      selected = current;
      return current.saved && current.repeat > 0
        ? { ...all, [name]: { ...current, repeat: current.repeat - 1 } }
        : all;
    });
    if (!selected) return { revision };
    if (selected.saved && selected.repeat > 0) return { revision, replay: true };
    if (!selected.status) return { revision };
    return { revision, failure: selected.status };
  },
});
const saveRule = operation({
  label: "save HTTP rule reply",
  input: z.object({ name: z.string(), revision: z.string(), response: replySchema }),
  depends: { rules: rules.controller },
  run({ rules }, ctx) {
    const { name, revision, response } = ctx.input;
    rules.update((all) => {
      const current = all[name];
      return current?.revision === revision
        ? { ...all, [name]: { ...current, saved: response } }
        : all;
    });
  },
});
const routeRule = operation({
  label: "wait for HTTP rule",
  input: z.object({ name: z.string() }),
  depends: { rules, clock, apply: applyRule.controller },
  async run({ rules, clock, apply }, ctx) {
    const rule = rules[ctx.input.name] ?? { delayMs: 0, revision: undefined };
    const signal = AbortSignal.any([clock.signal, ctx.signal]);
    if (rule.delayMs) {
      try {
        await clock.sleep(rule.delayMs, signal);
      } catch (error) {
        if (!signal.aborted) throw error;
      }
      if (signal.aborted) return ctx.raise("ServiceStopped", {});
    }
    return apply.run({ input: { ...ctx.input, revision: rule.revision } });
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

export const web = resource({
  label: "service Hono app",
  factory: () => new Hono<Wire.Env>({ getPath: (request) => new URL(request.url).pathname }),
});

/** The service extension installs these after its scope binding, before its routes. */
export const middleware = resource({
  label: "shared HTTP middleware",
  target: "session",
  depends: { stop: stopSignal, shape: errorShape, errors: wireErrors },
  factory({ stop, shape, errors }, { closing }) {
    const stopped = AbortSignal.any([stop, closing]);
    const json = (result: Wire.Reply): Response =>
      new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json", ...result.headers },
      });
    const error = (kind: string, status?: number): Response => {
      const entry = errors[kind];
      const { code, type = "invalid_request_error" } = entry;
      return json({
        status: status ?? entry.status,
        body:
          shape === "duffel" || entry.duffel
            ? { errors: [{ type, code, title: code }] }
            : { error: { type, code, message: code } },
      });
    };
    const dispatch = async (c: Context<Wire.Env>, next: Next, selected: Wire.Selection) => {
      if (selected.replay)
        c.res = c.var.json(c.var.scope.resolve(rules)[`${c.req.method} ${c.req.path}`].saved!);
      else if (selected.failure) c.res = c.var.error("InjectedFailure", selected.failure);
      else if (c.req.method === "HEAD") c.res = await c.notFound();
      else await next();
    };
    return {
      json,
      error,
      respond(this: void, result: RunResult<unknown>, status: number, envelope: boolean): Response {
        if (result.status === "success")
          return json({ status, body: envelope ? { data: result.value } : result.value });
        if (result.status === "cancelled") throw result.reason;
        const failure = z.object({ kind: z.string() }).safeParse(result.error);
        if (result.kind === "error" && failure.success && Object.hasOwn(errors, failure.data.kind))
          return error(failure.data.kind);
        throw result.error;
      },
      log: createMiddleware<Wire.Env>(async (c, next) => {
        const id = c.var.scope.run(startCall, {
          rawInput: {
            name: `${c.req.method} ${c.req.path}`,
            kind: c.var.control ? "control" : "service",
          },
        });
        await next();
        if (!stopped.aborted && !c.error)
          c.var.scope.run(saveCall, { rawInput: { id, status: c.res.status } });
        if (c.req.method !== "HEAD") c.header("transfer-encoding", "chunked");
      }),
      token: createMiddleware<Wire.Env>(async (c, next) => {
        c.set("control", true);
        if (
          !c.var.scope.run(checkToken, {
            rawInput: { token: c.req.header("authorization") },
          })
        )
          return c.var.error("Unauthorized");
        await next();
      }),
      body: createMiddleware<Wire.Env>(async (c, next) => {
        c.set(
          "body",
          c.var.scope.run(decodeBody, {
            rawInput: {
              bytes: await c.req.text(),
              form:
                c.req.header("content-type")?.startsWith("application/x-www-form-urlencoded") ??
                false,
            },
          }),
        );
        await next();
      }),
      rule: createMiddleware<Wire.Env>(async (c, next) => {
        if (c.var.control) {
          if (c.req.method === "HEAD") return c.notFound();
          return next();
        }
        const params = { name: `${c.req.method} ${c.req.path}` };
        const result = await c.var.scope.settle(routeRule, { input: params });
        if (result.status !== "success") return c.var.respond(result, 200, false);
        const selected = result.value;
        await dispatch(c, next, selected);
        if (!stopped.aborted && selected.revision && !c.error)
          c.var.scope.run(saveRule, {
            rawInput: {
              ...params,
              revision: selected.revision,
              response: {
                status: c.res.status,
                body: await c.res.clone().json(),
                headers: Object.fromEntries(c.res.headers),
              },
            },
          });
      }),
    };
  },
});

/** Each service binds its session as `c.var.scope` before resolving this stack. */
export const requests = resource({
  label: "shared HTTP requests",
  target: "session",
  depends: { http: web, shared: middleware },
  factory({ http, shared }) {
    http.use("*", async (c, next) => {
      c.set("json", shared.json);
      c.set("error", shared.error);
      c.set("respond", shared.respond);
      c.set("control", false);
      await next();
    });
    http.use("/control/:rest{.*}", async (c, next) => {
      c.set("control", true);
      await next();
    });
    http.use("*", shared.log);
    http.use("/control/:rest{.*}", shared.token);
    http.use("*", shared.body);
    http.use("*", shared.rule);
    return http;
  },
});

/** Services register their own middleware before resolving these shared control routes. */
export const controlRoutes = resource({
  label: "shared HTTP control routes",
  target: "session",
  depends: { http: web },
  factory({ http }) {
    http.post("/control/clock", (c) => {
      const parsed = clockSchema.safeParse(c.var.body);
      if (!parsed.success) return c.var.error("InvalidClock");
      const result = c.var.scope.settle(setClock, { input: parsed.data });
      return c.var.respond(result, 200, true);
    });
    http.get("/control/calls", (c) => {
      const result = c.var.scope.settle(readCalls);
      return c.var.respond(result, 200, true);
    });
    http.post("/control/routes", (c) => {
      const body = z.record(z.string(), z.unknown()).safeParse(c.var.body);
      const { route: name, ...settings } = body.success ? body.data : {};
      const parsed = routeSchema.safeParse({ ...settings, name });
      if (!parsed.success) return c.var.error("InvalidRouteRule");
      const result = c.var.scope.settle(setRoute, { input: parsed.data });
      return c.var.respond(result, 200, true);
    });
    return http;
  },
});

/** The extension finishes Hono setup before resolving this owned Node listener. */
export const listener = resource({
  label: "service HTTP listener",
  target: "session",
  depends: { web, port, host, stop: stopSignal },
  async factory({ web, port, host, stop }, { closing, defer, log }) {
    const stopped = AbortSignal.any([stop, closing]);
    web.onError((error, c) => {
      log.error("HTTP request failed", { error });
      return c.var.error("InternalError");
    });
    const pending = new Set<Promise<void>>();
    const server = serve({
      fetch(request, env) {
        const abortBody = () => {
          if (!env.incoming.complete) env.incoming.destroy();
        };
        const finished = new Promise<void>((resolve) => {
          const complete = () => {
            env.outgoing.removeListener("finish", complete);
            env.outgoing.removeListener("close", complete);
            stopped.removeEventListener("abort", abortBody);
            pending.delete(finished);
            resolve();
          };
          env.outgoing.once("finish", complete);
          env.outgoing.once("close", complete);
        });
        pending.add(finished);
        stopped.addEventListener("abort", abortBody, { once: true });
        if (stopped.aborted) abortBody();
        return web.fetch(request);
      },
      port,
      hostname: host,
      overrideGlobalObjects: false,
    });
    const ended = new Promise<void>((resolve) => server.once("close", resolve));
    await once(server, "listening");
    const stopServer = () => server.close();
    closing.addEventListener("abort", stopServer, { once: true });
    if (closing.aborted) stopServer();
    defer(async () => {
      closing.removeEventListener("abort", stopServer);
      stopServer();
      await Promise.all(pending);
      if ("closeAllConnections" in server) server.closeAllConnections();
      await ended;
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      failFlightService({ reason: "The listener has no TCP address" });
    return { url: `http://${host}:${address.port}` };
  },
});
