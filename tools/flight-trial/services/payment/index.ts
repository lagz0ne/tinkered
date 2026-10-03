import { createServer } from "node:http";
import { once } from "node:events";
import { failFlightService } from "../../src/errors.ts";
import { createHmac } from "node:crypto";
import { data, extension, operation, resource, tag } from "@tinker/core";
import { z } from "zod";
import {
  calls,
  clock,
  control,
  controlToken,
  decodeBody,
  host,
  port,
  reject,
  reply,
  rules,
  requestSchema,
  stopSignal,
  type Wire,
} from "../http.ts";

export declare namespace Payment {
  type Intent = {
    id: string;
    object: "payment_intent";
    amount: number;
    currency: string;
    status: "requires_confirmation" | "processing" | "succeeded" | "requires_payment_method";
    metadata: Record<string, string>;
    automatic_payment_methods?: { enabled: boolean };
    client_secret: string;
    latest_charge: string | null;
  };
  type Delivery = {
    id: string;
    intentId: string;
    at: number;
    copies: number;
    outcome: "succeeded" | "failed";
    sent: boolean;
  };
  type Refund = {
    id: string;
    object: "refund";
    payment_intent: string;
    amount: number;
    currency: string;
    status: "succeeded";
  };
  type Pending = { fingerprint: string; response: Promise<Wire.Reply> };
  type Saved = { fingerprint: string; reply: Wire.Reply };
  type Plan = {
    outcome: "succeeded" | "failed";
    mode: "now" | "late" | "twice" | "never";
    delayMs: number;
  };
  type State = {
    intents: Record<string, Intent>;
    deliveries: Record<string, Delivery>;
    refunds: Record<string, Refund>;
    keys: Record<string, Saved>;
    plan: Plan;
  };
}

export const webhookUrl = tag<string>({ label: "webhook URL" });
export const secret = tag<string>({ label: "webhook secret" });
export const webhookDelayMs = tag({ label: "webhook delay", default: 20 });
/** Each scenario owns a fresh plain value. */
function createState(): Payment.State {
  return {
    intents: {},
    deliveries: {},
    refunds: {},
    keys: {},
    plan: { outcome: "succeeded", mode: "now", delayMs: 1000 },
  };
}
const state = data({ label: "payment intents", initial: createState() });
const intentSchema = z.object({
  amount: z.coerce.number().int().positive(),
  metadata: z.record(z.string(), z.coerce.string()).default({}),
  automatic_payment_methods: z.object({ enabled: z.boolean() }).optional(),
  currency: z
    .string()
    .regex(/^[a-zA-Z]{3}$/)
    .transform((value) => value.toLowerCase()),
});
const refundSchema = z.object({
  payment_intent: z.string(),
  amount: z.coerce.number().int().positive().optional(),
});
const planSchema = z.object({
  outcome: z.enum(["succeeded", "failed"]).default("succeeded"),
  mode: z.enum(["now", "late", "twice", "never"]).default("now"),
  delayMs: z.number().int().nonnegative().default(1000),
});
const sendSchema = z.object({
  intent_id: z.string(),
  mode: z.enum(["now", "late", "twice", "never"]).default("now"),
  delayMs: z.number().int().nonnegative().default(1000),
});
const scenarioSchema = z.object({ name: z.enum(["default", "payment-failed"]) });

/**
 * Shapes a Stripe error from plain choices.
 * @param code - Error choice from the operation; needed for code and message.
 * @param status - HTTP choice from the operation; needed for the response code.
 * @param type - Stripe error family from the operation; needed for wire compatibility.
 */
function rejectPayment(code: string, status = 400, type = "invalid_request_error"): Wire.Reply {
  return reply(status, { error: { type, code, message: code } });
}

const sendWebhook = operation({
  label: "deliver signed webhook",
  input: z.object({ body: z.string(), signature: z.string(), copies: z.number() }),
  depends: { webhookUrl, clock, calls: calls.controller, stop: stopSignal },
  async run({ webhookUrl, clock, calls, stop }, ctx) {
    for (let copy = 0; copy < ctx.input.copies; copy++) {
      let status = 0;
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Stripe-Signature": ctx.input.signature,
          },
          body: ctx.input.body,
          signal: AbortSignal.any([stop, ctx.signal]),
        });
        status = response.status;
        await response.arrayBuffer();
      } catch (error) {
        ctx.log.error("webhook delivery failed", { error });
      }
      calls.update((previous) => [
        ...previous,
        {
          id: ctx.random.uuid(),
          kind: "webhook",
          route: "POST webhook",
          time: clock.currentTimeMillis(),
          status,
        },
      ]);
    }
  },
});
const finishDelivery = operation({
  label: "send payment webhook",
  input: z.object({ id: z.string(), intentId: z.string(), at: z.number() }),
  depends: {
    state: state.controller,
    clock,
    secret,
    send: sendWebhook.controller,
  },
  async run({ state, clock, secret, send }, ctx) {
    const current = structuredClone(state.get());
    const delivery = current.deliveries[ctx.input.id];
    const intent = current.intents[ctx.input.intentId];
    if (!delivery || !intent || delivery.sent) return;
    delivery.sent = true;
    intent.status = delivery.outcome === "succeeded" ? "succeeded" : "requires_payment_method";
    if (delivery.outcome === "succeeded") intent.latest_charge = `ch_${intent.id}`;
    state.set(current);
    const timestamp = Math.floor(ctx.clock.currentTimeMillis() / 1000);
    const body = JSON.stringify({
      id: delivery.id,
      object: "event",
      created: Math.floor(clock.currentTimeMillis() / 1000),
      type:
        delivery.outcome === "succeeded"
          ? "payment_intent.succeeded"
          : "payment_intent.payment_failed",
      data: { object: intent },
    });
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    await send.run({
      input: { body, signature: `t=${timestamp},v1=${signature}`, copies: delivery.copies },
    });
  },
});
const deliver = operation({
  label: "wait for payment webhook",
  input: z.object({ id: z.string(), intentId: z.string(), at: z.number() }),
  depends: { clock, stop: stopSignal, finish: finishDelivery.controller },
  async run({ clock, stop, finish }, ctx) {
    const signal = AbortSignal.any([stop, ctx.signal]);
    try {
      await clock.sleep(Math.max(0, ctx.input.at - clock.currentTimeMillis()), signal);
    } catch (error) {
      if (!signal.aborted) throw error;
      return;
    }
    if (!signal.aborted) await finish.run({ input: ctx.input });
  },
});
const webhooks = resource({
  label: "watch payment intents",
  depends: { state: state.controller, deliver: deliver.controller },
  factory({ state, deliver }, ctx) {
    ctx.defer(
      state.watch((next, previous) => {
        const delivery = Object.values(next.deliveries).find(
          (entry) => !entry.sent && !previous.deliveries[entry.id],
        );
        if (delivery) return deliver.run({ input: delivery });
      }),
    );
  },
});

const createIntent = operation({
  label: "create payment intent",
  input: (raw) => intentSchema.safeParse(raw),
  depends: { state: state.controller },
  run({ state }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return rejectPayment("invalid_payment_intent");
    const id = `pi_${ctx.random.uuid()}`;
    const intent: Payment.Intent = {
      ...parsed.data,
      id,
      object: "payment_intent",
      status: "requires_confirmation",
      client_secret: `${id}_secret_trial`,
      latest_charge: null,
    };
    state.update((current) => ({ ...current, intents: { ...current.intents, [id]: intent } }));
    return reply(200, intent);
  },
});
const confirm = operation({
  label: "confirm payment intent",
  input: requestSchema,
  depends: { state: state.controller, clock, webhookDelayMs },
  run({ state, clock, webhookDelayMs }, ctx) {
    const id = ctx.input.path.split("/").at(-2)!;
    const current = structuredClone(state.get());
    const intent = current.intents[id];
    if (!intent) return rejectPayment("resource_missing", 404);
    if (intent.status === "processing" || intent.status === "succeeded") return reply(200, intent);
    intent.status = "processing";
    const response = structuredClone(intent);
    const plan = current.plan;
    if (plan.mode !== "never") {
      const deliveryId = `evt_${ctx.random.uuid()}`;
      current.deliveries[deliveryId] = {
        id: deliveryId,
        intentId: intent.id,
        at: clock.currentTimeMillis() + (plan.mode === "late" ? plan.delayMs : webhookDelayMs),
        copies: plan.mode === "twice" ? 2 : 1,
        outcome: plan.outcome,
        sent: false,
      };
    }
    state.set(current);
    return reply(200, response);
  },
});
const refund = operation({
  label: "refund payment",
  input: (raw) => refundSchema.safeParse(raw),
  depends: { state: state.controller },
  run({ state }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return rejectPayment("invalid_refund");
    const current = structuredClone(state.get());
    const intent = current.intents[parsed.data.payment_intent];
    if (!intent) return rejectPayment("resource_missing", 404);
    if (intent.status !== "succeeded") return rejectPayment("payment_not_succeeded", 409);
    const refunded = Object.values(current.refunds)
      .filter((entry) => entry.payment_intent === intent.id)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const amount = parsed.data.amount ?? intent.amount - refunded;
    if (amount <= 0 || amount > intent.amount - refunded)
      return rejectPayment("invalid_refund_amount");
    const result: Payment.Refund = {
      id: `re_${ctx.random.uuid()}`,
      object: "refund",
      payment_intent: intent.id,
      amount,
      currency: intent.currency,
      status: "succeeded",
    };
    current.refunds[result.id] = result;
    state.set(current);
    return reply(200, result);
  },
});
const resetScenario = operation({
  label: "start payment scenario",
  input: (raw) => scenarioSchema.safeParse(raw),
  depends: { paymentState: state.controller, rules: rules.controller, calls: calls.controller },
  async run({ paymentState, rules, calls }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_scenario");
    const initial = createState();
    if (parsed.data.name === "payment-failed") initial.plan.outcome = "failed";
    paymentState.set(initial);
    rules.set({});
    calls.set([]);
    return reply(200, { data: { name: parsed.data.name } });
  },
});
const controlWebhook = operation({
  label: "choose intent webhook delivery",
  input: (raw) => sendSchema.safeParse(raw),
  depends: { state: state.controller, clock },
  run({ state, clock }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_webhook_plan");
    const current = structuredClone(state.get());
    const intent = current.intents[parsed.data.intent_id];
    if (!intent) return rejectPayment("resource_missing", 404);
    for (const delivery of Object.values(current.deliveries).filter(
      (entry) => entry.intentId === intent.id && !entry.sent,
    )) {
      delete current.deliveries[delivery.id];
    }
    const plan = { ...current.plan, ...parsed.data };
    if (plan.mode !== "never") {
      const id = `evt_${ctx.random.uuid()}`;
      current.deliveries[id] = {
        id,
        intentId: intent.id,
        at: clock.currentTimeMillis() + (plan.mode === "late" ? plan.delayMs : 0),
        copies: plan.mode === "twice" ? 2 : 1,
        outcome: plan.outcome,
        sent: false,
      };
    }
    state.set(current);
    return reply(200, { data: parsed.data });
  },
});
const setPlan = operation({
  label: "choose payment plan",
  input: (raw) => planSchema.safeParse(raw),
  depends: { state: state.controller },
  run({ state }, ctx) {
    const parsed = ctx.input;
    if (!parsed.success) return reject("invalid_payment_plan");
    state.update((current) => ({ ...current, plan: parsed.data }));
    return reply(200, { data: parsed.data });
  },
});
const paymentControl = operation({
  label: "control payment",
  input: requestSchema,
  depends: {
    common: control.controller,
    webhook: controlWebhook.controller,
    reset: resetScenario.controller,
    plan: setPlan.controller,
  },
  async run({ common, reset, webhook, plan }, ctx) {
    if (ctx.input.route === "POST /control/scenario")
      return reset.run({ rawInput: ctx.input.body });
    if (ctx.input.route === "POST /control/payment") return plan.run({ rawInput: ctx.input.body });
    if (ctx.input.route === "POST /control/webhooks")
      return webhook.run({ rawInput: ctx.input.body });
    return common.run({ input: ctx.input });
  },
});
const route = operation({
  label: "payment route",
  input: requestSchema,
  depends: {
    create: createIntent.controller,
    confirm: confirm.controller,
    refund: refund.controller,
    state,
    control: paymentControl.controller,
  },
  async run({ create, confirm, refund, state, control }, ctx) {
    if (ctx.input.path.startsWith("/control/")) return control.run({ input: ctx.input });
    if (ctx.input.route === "POST /v1/payment_intents")
      return create.run({ rawInput: ctx.input.body });
    if (ctx.input.route === "POST /v1/refunds") return refund.run({ rawInput: ctx.input.body });
    if (/^POST \/v1\/payment_intents\/[^/]+\/confirm$/.test(ctx.input.route))
      return confirm.run({ input: ctx.input });
    const intent = state.intents[ctx.input.path.split("/").at(-1)!];
    return /^GET \/v1\/payment_intents\/[^/]+$/.test(ctx.input.route) && intent
      ? reply(200, intent)
      : rejectPayment("resource_missing", 404);
  },
});
/** Live calls belong to this resource; payment data stores only settled wire replies. */
const inFlight = resource({
  label: "in-flight payment keys",
  factory(_deps, ctx) {
    const pending = new Map<string, Payment.Pending>();
    ctx.defer(() => pending.clear());
    return pending;
  },
});
const action = operation({
  label: "payment API",
  input: requestSchema,
  depends: { state: state.controller, route: route.controller, inFlight },
  async run({ state, route, inFlight }, ctx) {
    const request = ctx.input;
    if (!request.key || !request.route.startsWith("POST /v1/"))
      return route.run({ input: request });
    const fingerprint = JSON.stringify({ route: request.route, body: request.body });
    const previous = state.get().keys[request.key];
    if (previous)
      return previous.fingerprint === fingerprint
        ? { ...previous.reply, headers: { "Idempotent-Replayed": "true" } }
        : rejectPayment("idempotency_key_in_use", 400, "idempotency_error");
    const pending = inFlight.get(request.key);
    if (pending)
      return pending.fingerprint === fingerprint
        ? { ...(await pending.response), headers: { "Idempotent-Replayed": "true" } }
        : rejectPayment("idempotency_key_in_use", 400, "idempotency_error");
    const responsePromise = route.run({ input: request });
    inFlight.set(request.key, { fingerprint, response: responsePromise });
    try {
      const response = await responsePromise;
      state.update((current) => ({
        ...current,
        keys: {
          ...current.keys,
          [request.key!]: { fingerprint, reply: structuredClone(response) },
        },
      }));
      return response;
    } finally {
      inFlight.delete(request.key);
    }
  },
});
const applyRoute = operation({
  label: "apply route rule",
  input: z.object({
    request: requestSchema,
    revision: z.string().optional(),
    stopped: z.boolean(),
  }),
  depends: { action: action.controller, rules: rules.controller },
  async run({ action, rules }, ctx) {
    const { request, revision, stopped } = ctx.input;
    let selected: Wire.Rule | undefined;
    rules.update((all) => {
      const current = all[request.route];
      if (!revision || current?.revision !== revision) return all;
      selected = current;
      return current.saved && current.repeat > 0
        ? { ...all, [request.route]: { ...current, repeat: current.repeat - 1 } }
        : all;
    });
    let response: Wire.Reply;
    if (stopped) response = rejectPayment("service_stopped", 503);
    else if (selected?.saved && selected.repeat > 0) response = selected.saved;
    else if (selected?.status) response = rejectPayment("injected_failure", selected.status);
    else response = await action.run({ input: request });
    if (revision)
      rules.update((all) => {
        const current = all[request.route];
        return current?.revision === revision
          ? { ...all, [request.route]: { ...current, saved: response } }
          : all;
      });
    return response;
  },
});
const delayRoute = operation({
  label: "delay service route",
  input: requestSchema,
  depends: { rules, clock, stop: stopSignal, apply: applyRoute.controller },
  async run({ rules, clock, stop, apply }, ctx) {
    const rule = rules[ctx.input.route];
    const signal = AbortSignal.any([stop, ctx.signal]);
    let stopped = false;
    if (rule?.delayMs) {
      try {
        await clock.sleep(rule.delayMs, signal);
        stopped = signal.aborted;
      } catch (error) {
        if (!signal.aborted) throw error;
        stopped = true;
      }
    }
    return apply.run({ input: { request: ctx.input, revision: rule?.revision, stopped } });
  },
});
const dispatch = operation({
  label: "serve payment HTTP request",
  input: requestSchema,
  depends: {
    action: action.controller,
    route: delayRoute.controller,
    calls: calls.controller,
    clock,
    token: controlToken,
  },
  async run({ action, route, calls, clock, token }, ctx) {
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
    const response = request.path.startsWith("/control/")
      ? request.token === `Bearer ${token}`
        ? await action.run({ input: request })
        : reject("unauthorized", 401)
      : await route.run({ input: request });
    calls.update((all) =>
      all.map((call) => (call.id === id ? { ...call, status: response.status } : call)),
    );
    return response;
  },
});
const http = resource({
  label: "payment HTTP listener",
  depends: { dispatch: dispatch.controller, decode: decodeBody.controller, port, host },
  async factory({ dispatch, decode, port, host }, ctx) {
    const server = createServer(async (request, response) => {
      try {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = await decode.run({
          input: {
            bytes: Buffer.concat(chunks).toString("utf8"),
            form:
              request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded") ??
              false,
          },
        });
        const result = await dispatch.run({
          rawInput: {
            path,
            route: `${request.method} ${path}`,
            body,
            key: z.string().optional().parse(request.headers["idempotency-key"]),
            token: z.string().optional().parse(request.headers.authorization),
          },
        });
        response.writeHead(result.status, {
          "content-type": "application/json",
          ...result.headers,
        });
        response.end(JSON.stringify(result.body));
      } catch (error) {
        ctx.log.error("HTTP request failed", { error });
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify(rejectPayment("internal_error", 500).body));
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

/** Startup belongs to Core so a failed listener closes its root and all built resources. */
export const app = extension({
  label: "start payment app",
  hooks: {
    async start({ scope, next }) {
      await next();
      await scope.run(resetScenario, {
        rawInput: { name: "default" },
      });
      scope.resolve(webhooks);
      return scope.resolve(http);
    },
  },
});
