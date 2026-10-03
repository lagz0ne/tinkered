import { once } from "node:events";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { data, extension, operation, resource, tag, type Scope } from "@tinker/core";
import { failFlightService } from "../src/errors.ts";
import { z } from "zod";

export declare namespace Wire {
  type Env = {
    Variables: {
      scope: Scope.Handle;
      json: (result: Reply) => Response;
      body: unknown;
      control: boolean;
    };
  };
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
  factory(_deps, ctx) {
    let now: number | undefined;
    const waits = new Set<{ at: number; wake: () => void }>();
    const handle = {
      currentTimeMillis() {
        return now ?? ctx.clock.currentTimeMillis();
      },
      sleep(ms: number, signal: AbortSignal): Promise<void> {
        if (now === undefined) return ctx.clock.sleep(ms, signal);
        return new Promise<void>((resolve, reject) => {
          if (signal.aborted) return reject(signal.reason);
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
            reject(signal.reason);
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
  input: (raw) => routeSchema.safeParse(raw),
  depends: { rules: rules.controller },
  run({ rules }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_route_rule");
    const { name, ...rule } = parsed.data;
    rules.update((previous) => ({
      ...previous,
      [name]: { ...rule, revision: ctx.random.uuid() },
    }));
    return reply(200, { data: { route: name, ...rule } });
  },
});
export const setClock = operation({
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
export const readCalls = operation({
  label: "read HTTP calls",
  depends: { calls },
  run({ calls }) {
    return reply(200, { data: calls.map(({ id: _id, ...call }) => call) });
  },
});

/**
 * Shapes a Stripe error from plain choices.
 * @param code - Error choice from the operation; needed for code and message.
 * @param status - HTTP choice from the operation; needed for the response code.
 * @param type - Stripe error family from the operation; needed for wire compatibility.
 */
export function rejectPayment(
  code: string,
  status = 400,
  type = "invalid_request_error",
): Wire.Reply {
  return reply(status, { error: { type, code, message: code } });
}

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
  depends: { rules: rules.controller, shape: errorShape },
  run({ rules, shape }, ctx): { revision?: string; response?: Wire.Reply } {
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
    if (selected.saved && selected.repeat > 0) return { revision, response: selected.saved };
    if (!selected.status) return { revision };
    return {
      revision,
      response:
        shape === "stripe"
          ? rejectPayment("injected_failure", selected.status)
          : reject("injected_failure", selected.status),
    };
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
  depends: { rules, clock, stop: stopSignal, apply: applyRule.controller, shape: errorShape },
  async run({ rules, clock, stop, apply, shape }, ctx) {
    const rule = rules[ctx.input.name] ?? { delayMs: 0, revision: undefined };
    const signal = AbortSignal.any([stop, ctx.signal]);
    if (rule.delayMs) {
      try {
        await clock.sleep(rule.delayMs, signal);
      } catch (error) {
        if (!signal.aborted) throw error;
      }
      if (signal.aborted)
        return {
          response:
            shape === "stripe"
              ? rejectPayment("service_stopped", 503)
              : reject("service_stopped", 503),
        };
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
  depends: { stop: stopSignal },
  factory({ stop }) {
    return {
      json: (result: Wire.Reply): Response =>
        new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { "content-type": "application/json", ...result.headers },
        }),
      log: createMiddleware<Wire.Env>(async (c, next) => {
        const id = c.var.scope.run(startCall, {
          rawInput: {
            name: `${c.req.method} ${c.req.path}`,
            kind: c.var.control ? "control" : "service",
          },
        });
        await next();
        if (!stop.aborted && !c.error)
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
          return c.var.json(reject("unauthorized", 401));
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
        const selected = await c.var.scope.run(routeRule, { rawInput: params });
        if (selected.response) {
          const response = selected.response;
          c.res = c.var.json(response);
        } else if (c.req.method === "HEAD") {
          c.res = await c.notFound();
        } else {
          await next();
        }
        if (selected.revision && !c.error)
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

/** Service start hooks borrow their event here; all HTTP setup has one owner. */
export const httpRequests = extension({
  label: "shared HTTP requests",
  hooks: {
    async start({ scope, next }) {
      await next();
      const http = scope.resolve(web);
      const shared = scope.resolve(middleware);
      http.use("*", async (c, next) => {
        c.set("scope", scope);
        c.set("json", shared.json);
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
      http.post("/control/clock", (c) => {
        const result = c.var.scope.run(setClock, { rawInput: c.var.body });
        return c.var.json(result);
      });
      http.get("/control/calls", (c) => {
        const result = c.var.scope.run(readCalls);
        return c.var.json(result);
      });
      http.post("/control/routes", (c) => {
        const parsed = z.record(z.string(), z.unknown()).safeParse(c.var.body);
        const { route: name, ...settings } = parsed.success ? parsed.data : {};
        const result = c.var.scope.run(setRoute, { rawInput: { ...settings, name } });
        return c.var.json(result);
      });
      return http;
    },
  },
});

/** The extension finishes Hono setup before resolving this owned Node listener. */
export const listener = resource({
  label: "service HTTP listener",
  target: "session",
  depends: { web, port, host, shape: errorShape, stop: stopSignal },
  async factory({ web, port, host, shape, stop }, ctx) {
    web.onError((error, c) => {
      ctx.log.error("HTTP request failed", { error });
      return c.var.json(
        shape === "stripe" ? rejectPayment("internal_error", 500) : reject("internal_error", 500),
      );
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
            stop.removeEventListener("abort", abortBody);
            pending.delete(finished);
            resolve();
          };
          env.outgoing.once("finish", complete);
          env.outgoing.once("close", complete);
        });
        pending.add(finished);
        stop.addEventListener("abort", abortBody, { once: true });
        if (stop.aborted) abortBody();
        return web.fetch(request);
      },
      port,
      hostname: host,
      overrideGlobalObjects: false,
    });
    await once(server, "listening");
    ctx.defer(async () => {
      await Promise.all(pending);
      if ("closeAllConnections" in server) server.closeAllConnections();
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
