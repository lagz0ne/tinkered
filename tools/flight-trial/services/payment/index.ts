import { createHmac } from "node:crypto";
import { data, extension, operation, resource, tag } from "@tinker/core";
import { z } from "zod";
import {
  calls,
  clock,
  reject,
  reply,
  rules,
  web,
  middleware,
  listener,
  readCalls,
  setRoute,
  setClock,
  rejectPayment,
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
  };
  type Refund = {
    id: string;
    object: "refund";
    payment_intent: string;
    amount: number;
    currency: string;
    status: "succeeded";
  };
  type Pending = {
    fingerprint: string;
    response: Promise<Wire.Reply>;
    resolve: (reply: Wire.Reply) => void;
  };
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
      if (!stop.aborted)
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
/** New event IDs each get one timer; creation and reset keep each event with its intent. */
const finishDelivery = operation({
  label: "send payment webhook",
  input: z.object({ id: z.string() }),
  depends: {
    state: state.controller,
    clock,
    secret,
    send: sendWebhook.controller,
  },
  async run({ state, clock, secret, send }, ctx) {
    const current = structuredClone(state.get());
    const delivery = current.deliveries[ctx.input.id];
    if (!delivery) return;
    const intent = current.intents[delivery.intentId];
    delete current.deliveries[delivery.id];
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
      rawInput: { body, signature: `t=${timestamp},v1=${signature}`, copies: delivery.copies },
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
    if (!signal.aborted) await finish.run({ rawInput: { id: ctx.input.id } });
  },
});
const webhooks = resource({
  label: "watch payment intents",
  depends: { state: state.controller, deliver: deliver.controller },
  factory({ state, deliver }, ctx) {
    ctx.defer(
      state.watch((next, previous) => {
        const delivery = Object.values(next.deliveries).find(
          (entry) => !previous.deliveries[entry.id],
        );
        if (delivery) return deliver.run({ rawInput: delivery });
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
  input: z.object({ id: z.string() }),
  depends: { state: state.controller, clock, webhookDelayMs },
  run({ state, clock, webhookDelayMs }, ctx) {
    const { id } = ctx.input;
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
      (entry) => entry.intentId === intent.id,
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
const readIntent = operation({
  label: "read payment intent",
  input: z.object({ id: z.string() }),
  depends: { state },
  run({ state }, ctx) {
    const intent = state.intents[ctx.input.id];
    return intent ? reply(200, intent) : rejectPayment("resource_missing", 404);
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
/** The key fingerprints are facts supplied by Hono, never operation choices. */
const intentKey = operation({
  label: "retain payment reply for key",
  input: z.object({
    key: z.string(),
    fingerprint: z.string(),
    response: z
      .object({
        status: z.number(),
        body: z.unknown(),
        headers: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
  }),
  depends: { state: state.controller, inFlight },
  async run({ state, inFlight }, ctx): Promise<Wire.Reply | undefined> {
    const { key, fingerprint, response } = ctx.input;
    if (response) {
      state.update((current) => ({
        ...current,
        keys: { ...current.keys, [key]: { fingerprint, reply: structuredClone(response) } },
      }));
      inFlight.get(key)!.resolve(response);
      inFlight.delete(key);
      return;
    }
    const previous = state.get().keys[key];
    if (previous)
      return previous.fingerprint === fingerprint
        ? { ...previous.reply, headers: { "Idempotent-Replayed": "true" } }
        : rejectPayment("idempotency_key_in_use", 400, "idempotency_error");
    const pending = inFlight.get(key);
    if (pending)
      return pending.fingerprint === fingerprint
        ? { ...(await pending.response), headers: { "Idempotent-Replayed": "true" } }
        : rejectPayment("idempotency_key_in_use", 400, "idempotency_error");
    let resolve!: (reply: Wire.Reply) => void;
    const responsePromise = new Promise<Wire.Reply>((done) => {
      resolve = done;
    });
    inFlight.set(key, { fingerprint, response: responsePromise, resolve });
  },
});

/** Startup supplies the scope to middleware; the resource owns the listener. */
export const app = extension({
  label: "start payment app",
  hooks: {
    async start({ scope, next }) {
      await next();
      await scope.run(resetScenario, { rawInput: { name: "default" } });
      scope.resolve(webhooks);
      const http = scope.resolve(web);
      const shared = scope.resolve(middleware);
      http.use("*", async (c, next) => {
        c.set("scope", scope);
        c.set("payment", true);
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
      http.use("/v1/:rest{.*}", async (c, next) => {
        const key = c.req.header("idempotency-key");
        if (!key || c.req.method !== "POST") return next();
        const fingerprint = JSON.stringify({
          route: `${c.req.method} ${c.req.path}`,
          body: c.var.body,
        });
        const result = await c.var.scope.run(intentKey, { rawInput: { key, fingerprint } });
        if (result)
          return new Response(JSON.stringify(result.body), {
            status: result.status,
            headers: result.headers,
          });
        await next();
        await c.var.scope.run(intentKey, {
          rawInput: {
            key,
            fingerprint,
            response: {
              status: c.res.status,
              body: await c.res.clone().json(),
              headers: Object.fromEntries(c.res.headers),
            },
          },
        });
      });
      http.on("HEAD", "*", (c) => c.notFound());
      http.post("/control/scenario", async (c) => {
        const result = await c.var.scope.run(resetScenario, { rawInput: c.var.body });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.post("/control/clock", (c) => {
        const result = c.var.scope.run(setClock, { rawInput: c.var.body });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.get("/control/calls", (c) => {
        const result = c.var.scope.run(readCalls);
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.post("/control/routes", (c) => {
        const parsed = z.record(z.string(), z.unknown()).safeParse(c.var.body);
        const { route: name, ...settings } = parsed.success ? parsed.data : {};
        const result = c.var.scope.run(setRoute, { rawInput: { name, ...settings } });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.post("/v1/payment_intents", (c) => {
        const result = c.var.scope.run(createIntent, { rawInput: c.var.body });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.post("/v1/payment_intents/:id/confirm", (c) => {
        const result = c.var.scope.run(confirm, { rawInput: { id: c.req.param("id") } });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.get("/v1/payment_intents/:id", (c) => {
        const result = c.var.scope.run(readIntent, { rawInput: { id: c.req.param("id") } });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.post("/v1/refunds", (c) => {
        const result = c.var.scope.run(refund, { rawInput: c.var.body });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.post("/control/payment", (c) => {
        const result = c.var.scope.run(setPlan, { rawInput: c.var.body });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.post("/control/webhooks", (c) => {
        const result = c.var.scope.run(controlWebhook, { rawInput: c.var.body });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: result.headers,
        });
      });
      http.notFound((c) => {
        if (c.var.control) return c.json(reject("not_found", 404).body, 404);
        return c.json(rejectPayment("resource_missing", 404).body, 404);
      });
      return scope.resolve(listener);
    },
  },
});
