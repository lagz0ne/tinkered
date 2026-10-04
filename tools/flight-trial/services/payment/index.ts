import { createHmac } from "node:crypto";
import { data, extension, operation, resource, tag } from "@tinker/core";
import { z } from "zod";
import {
  calls,
  clock,
  rules,
  httpRequests,
  controlRoutes,
  errorShape,
  listener,
  wireErrors,
  commonErrors,
  stopSignal,
  type Wire,
} from "../http.ts";

const errors = {
  ...commonErrors,
  InvalidPaymentIntent: { code: "invalid_payment_intent", status: 400 },
  InvalidRefund: { code: "invalid_refund", status: 400 },
  InvalidPaymentPlan: { code: "invalid_payment_plan", status: 400, duffel: true },
  InvalidWebhookPlan: { code: "invalid_webhook_plan", status: 400, duffel: true },
  ResourceMissing: { code: "resource_missing", status: 404 },
  PaymentNotSucceeded: { code: "payment_not_succeeded", status: 409 },
  InvalidRefundAmount: { code: "invalid_refund_amount", status: 400 },
  IdempotencyKeyInUse: { code: "idempotency_key_in_use", status: 400, type: "idempotency_error" },
};

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
  type Event = {
    id: string;
    created: number;
    intent: Intent;
    copies: number;
    outcome: "succeeded" | "failed";
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
    response: Promise<boolean>;
    resolve: (saved: boolean) => void;
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

/** This client owns Stripe's event body, signature, and HTTP request. */
const webhookClient = resource({
  label: "signed webhook client",
  depends: { webhookUrl, secret, stop: stopSignal },
  factory({ webhookUrl, secret, stop }, ctx) {
    return {
      async *send(event: Payment.Event, signal: AbortSignal) {
        const timestamp = Math.floor(ctx.clock.currentTimeMillis() / 1000);
        const body = JSON.stringify({
          id: event.id,
          object: "event",
          created: event.created,
          type:
            event.outcome === "succeeded"
              ? "payment_intent.succeeded"
              : "payment_intent.payment_failed",
          data: { object: event.intent },
        });
        const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
        for (let copy = 0; copy < event.copies; copy++) {
          let status = 0;
          try {
            const response = await fetch(webhookUrl, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "Stripe-Signature": `t=${timestamp},v1=${signature}`,
              },
              body,
              signal: AbortSignal.any([stop, signal]),
            });
            status = response.status;
            await response.arrayBuffer();
          } catch (error) {
            ctx.log.error("webhook delivery failed", { error });
          }
          yield status;
        }
      },
    };
  },
});
const sendWebhook = operation({
  label: "deliver signed webhook",
  input: z.object({
    id: z.string(),
    created: z.number(),
    copies: z.number(),
    outcome: z.enum(["succeeded", "failed"]),
    intent: intentSchema.extend({
      id: z.string(),
      object: z.literal("payment_intent"),
      status: z.enum([
        "requires_confirmation",
        "processing",
        "succeeded",
        "requires_payment_method",
      ]),
      client_secret: z.string(),
      latest_charge: z.string().nullable(),
    }),
  }),
  depends: { client: webhookClient, clock, calls: calls.controller, stop: stopSignal },
  async run({ client, clock, calls, stop }, ctx) {
    for await (const status of client.send(ctx.input, ctx.signal)) {
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
    send: sendWebhook.controller,
  },
  async run({ state, clock, send }, ctx) {
    const current = structuredClone(state.get());
    const delivery = current.deliveries[ctx.input.id];
    if (!delivery) return;
    const intent = current.intents[delivery.intentId];
    delete current.deliveries[delivery.id];
    intent.status = delivery.outcome === "succeeded" ? "succeeded" : "requires_payment_method";
    if (delivery.outcome === "succeeded") intent.latest_charge = `ch_${intent.id}`;
    state.set(current);
    await send.run({
      input: {
        id: delivery.id,
        created: Math.floor(clock.currentTimeMillis() / 1000),
        outcome: delivery.outcome,
        intent,
        copies: delivery.copies,
      },
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
  target: "session",
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
  input: intentSchema,
  depends: { state: state.controller },
  run({ state }, ctx) {
    const id = `pi_${ctx.random.uuid()}`;
    const intent: Payment.Intent = {
      ...ctx.input,
      id,
      object: "payment_intent",
      status: "requires_confirmation",
      client_secret: `${id}_secret_trial`,
      latest_charge: null,
    };
    state.update((current) => ({ ...current, intents: { ...current.intents, [id]: intent } }));
    return intent;
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
    if (!intent) return ctx.raise("ResourceMissing", {});
    if (intent.status === "processing" || intent.status === "succeeded") return intent;
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
    return response;
  },
});
const refund = operation({
  label: "refund payment",
  input: refundSchema,
  depends: { state: state.controller },
  run({ state }, ctx) {
    const current = structuredClone(state.get());
    const intent = current.intents[ctx.input.payment_intent];
    if (!intent) return ctx.raise("ResourceMissing", {});
    if (intent.status !== "succeeded") return ctx.raise("PaymentNotSucceeded", {});
    const refunded = Object.values(current.refunds)
      .filter((entry) => entry.payment_intent === intent.id)
      .reduce((sum, entry) => sum + entry.amount, 0);
    const amount = ctx.input.amount ?? intent.amount - refunded;
    if (amount <= 0 || amount > intent.amount - refunded)
      return ctx.raise("InvalidRefundAmount", {});
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
    return result;
  },
});
const resetScenario = operation({
  label: "start payment scenario",
  input: scenarioSchema,
  depends: { paymentState: state.controller, rules: rules.controller, calls: calls.controller },
  async run({ paymentState, rules, calls }, ctx) {
    const initial = createState();
    if (ctx.input.name === "payment-failed") initial.plan.outcome = "failed";
    paymentState.set(initial);
    rules.set({});
    calls.set([]);
    return { name: ctx.input.name };
  },
});
const controlWebhook = operation({
  label: "choose intent webhook delivery",
  input: sendSchema,
  depends: { state: state.controller, clock },
  run({ state, clock }, ctx) {
    const current = structuredClone(state.get());
    const intent = current.intents[ctx.input.intent_id];
    if (!intent) return ctx.raise("ResourceMissing", {});
    for (const delivery of Object.values(current.deliveries).filter(
      (entry) => entry.intentId === intent.id,
    )) {
      delete current.deliveries[delivery.id];
    }
    const plan = { ...current.plan, ...ctx.input };
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
    return ctx.input;
  },
});
const setPlan = operation({
  label: "choose payment plan",
  input: planSchema,
  depends: { state: state.controller },
  run({ state }, ctx) {
    state.update((current) => ({ ...current, plan: ctx.input }));
    return ctx.input;
  },
});
const readIntent = operation({
  label: "read payment intent",
  input: z.object({ id: z.string() }),
  depends: { state },
  run({ state }, ctx) {
    const intent = state.intents[ctx.input.id];
    if (!intent) return ctx.raise("ResourceMissing", {});
    return intent;
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
const startIntentKey = operation({
  label: "start payment key",
  input: z.object({
    key: z.string(),
    fingerprint: z.string(),
  }),
  depends: { state: state.controller, inFlight },
  async run({ state, inFlight }, ctx): Promise<{ replay: true } | undefined> {
    const { key, fingerprint } = ctx.input;
    for (;;) {
      const previous = state.get().keys[key];
      if (previous)
        return previous.fingerprint === fingerprint
          ? { replay: true }
          : ctx.raise("IdempotencyKeyInUse", {});
      const pending = inFlight.get(key);
      if (pending) {
        if (pending.fingerprint !== fingerprint) return ctx.raise("IdempotencyKeyInUse", {});
        const response = await pending.response;
        if (response) return { replay: true };
        continue;
      }
      let resolve!: (saved: boolean) => void;
      const response = new Promise<boolean>((done) => {
        resolve = done;
      });
      inFlight.set(key, { fingerprint, response, resolve });
      return;
    }
  },
});

const saveIntentKey = operation({
  label: "save payment key reply",
  input: z.object({
    key: z.string(),
    fingerprint: z.string(),
    response: z.object({
      status: z.number(),
      body: z.unknown(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
  }),
  depends: { state: state.controller, inFlight },
  run({ state, inFlight }, ctx) {
    const { key, fingerprint, response } = ctx.input;
    state.update((current) => ({
      ...current,
      keys: { ...current.keys, [key]: { fingerprint, reply: structuredClone(response) } },
    }));
    inFlight.get(key)!.resolve(true);
  },
});

/** Startup supplies the scope to middleware; the resource owns the listener. */
export const app = extension({
  label: "start payment app",
  hooks: {
    async start(event) {
      const scope = event.scope.createSession({ tags: [errorShape("stripe"), wireErrors(errors)] });
      const http = await httpRequests.hooks!.start!({ ...event, scope });
      scope.resolve(controlRoutes);
      await scope.run(resetScenario, { rawInput: { name: "default" } });
      scope.resolve(webhooks);
      const pendingKeys = scope.resolve(inFlight);
      http.use("/v1/:rest{.*}", async (c, next) => {
        const key = c.req.header("idempotency-key");
        if (!key || c.req.method !== "POST") return next();
        const fingerprint = JSON.stringify({
          route: `${c.req.method} ${c.req.path}`,
          body: c.var.body,
        });
        const result = await c.var.scope.settle(startIntentKey, { input: { key, fingerprint } });
        if (result.status !== "success") return c.var.respond(result, 200, false);
        if (result.value?.replay)
          return c.var.json({
            ...c.var.scope.resolve(state).keys[key].reply,
            headers: { "Idempotent-Replayed": "true" },
          });
        try {
          await next();
          if (!c.error)
            c.var.scope.run(saveIntentKey, {
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
        } finally {
          pendingKeys.get(key)?.resolve(false);
          pendingKeys.delete(key);
        }
      });
      http.post("/control/scenario", async (c) => {
        const parsed = scenarioSchema.safeParse(c.var.body);
        if (!parsed.success) return c.var.error("InvalidScenario");
        const result = await c.var.scope.settle(resetScenario, { input: parsed.data });
        return c.var.respond(result, 200, true);
      });
      http.post("/v1/payment_intents", (c) => {
        const parsed = intentSchema.safeParse(c.var.body);
        if (!parsed.success) return c.var.error("InvalidPaymentIntent");
        const result = c.var.scope.settle(createIntent, { input: parsed.data });
        return c.var.respond(result, 200, false);
      });
      http.post("/v1/payment_intents/:id/confirm", (c) => {
        /** Keep raw percent-encoding; Hono's param reader decodes it. */
        const result = c.var.scope.settle(confirm, {
          input: { id: new URL(c.req.url).pathname.split("/").at(-2)! },
        });
        return c.var.respond(result, 200, false);
      });
      http.get("/v1/payment_intents/:id", (c) => {
        /** Keep raw percent-encoding; Hono's param reader decodes it. */
        const result = c.var.scope.settle(readIntent, {
          input: { id: new URL(c.req.url).pathname.split("/").at(-1)! },
        });
        return c.var.respond(result, 200, false);
      });
      http.post("/v1/refunds", (c) => {
        const parsed = refundSchema.safeParse(c.var.body);
        if (!parsed.success) return c.var.error("InvalidRefund");
        const result = c.var.scope.settle(refund, { input: parsed.data });
        return c.var.respond(result, 200, false);
      });
      http.post("/control/payment", (c) => {
        const parsed = planSchema.safeParse(c.var.body);
        if (!parsed.success) return c.var.error("InvalidPaymentPlan");
        const result = c.var.scope.settle(setPlan, { input: parsed.data });
        return c.var.respond(result, 200, true);
      });
      http.post("/control/webhooks", (c) => {
        const parsed = sendSchema.safeParse(c.var.body);
        if (!parsed.success) return c.var.error("InvalidWebhookPlan");
        const result = c.var.scope.settle(controlWebhook, { input: parsed.data });
        return c.var.respond(result, 200, true);
      });
      http.notFound((c) => c.var.error(c.var.control ? "NotFound" : "ResourceMissing"));
      return scope.resolve(listener);
    },
  },
});
