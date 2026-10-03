import { createHmac } from "node:crypto";
import {
  createScope,
  data,
  extension,
  operation,
  resource,
  tag,
  type Operation,
} from "@tinker/core";
import { preset } from "@tinker/core/testing";
import { z } from "zod";
import {
  calls,
  clock,
  control,
  controlToken,
  createHttp,
  host,
  port,
  reject,
  reply,
  rules,
  stopSignal,
  sleepUntilStopped,
  type Service,
} from "../http.ts";

export declare namespace Payment {
  type Options = Service.Options & { webhookUrl: string; secret: string; webhookDelayMs?: number };
  type Intent = {
    id: string;
    object: "payment_intent";
    amount: number;
    currency: string;
    status: "requires_confirmation" | "processing" | "succeeded" | "requires_payment_method";
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
  type Saved = { fingerprint: string; reply: Service.Reply };
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

const webhookUrl = tag<string>({ label: "webhook URL" });
const secret = tag<string>({ label: "webhook secret" });
const webhookDelayMs = tag({ label: "webhook delay", default: 20 });
/** Each scenario owns a fresh plain value for its preset. */
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

/** Pure wire shaping keeps Stripe errors separate from Duffel errors. */
function rejectPayment(code: string, status = 400): Service.Reply {
  return reply(status, { error: { type: "invalid_request_error", code, message: code } });
}

/** Only the controlling operation writes state; the watcher owns delivery work. */
function schedule(
  current: Payment.State,
  intent: Payment.Intent,
  plan: Payment.Plan,
  now: number,
  delayMs: number,
  id: string,
): void {
  if (plan.mode === "never") return;
  current.deliveries[id] = {
    id,
    intentId: intent.id,
    at: now + (plan.mode === "late" ? plan.delayMs : delayMs),
    copies: plan.mode === "twice" ? 2 : 1,
    outcome: plan.outcome,
    sent: false,
  };
}

const sendWebhook = operation({
  label: "deliver signed webhook",
  depends: { webhookUrl, clock, calls: calls.controller, stop: stopSignal },
  async run(
    { webhookUrl, clock, calls, stop },
    ctx: Operation.Ctx<{ body: string; signature: string; copies: number }>,
  ) {
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
        { route: "POST webhook", time: clock.currentTimeMillis(), status },
      ]);
    }
  },
});
const deliver = operation({
  label: "send payment webhook",
  depends: {
    state: state.controller,
    clock,
    secret,
    stop: stopSignal,
    send: sendWebhook.controller,
  },
  async run({ state, clock, secret, stop, send }, ctx: Operation.Ctx<Payment.Delivery>) {
    if (
      !(await sleepUntilStopped(
        clock,
        Math.max(0, ctx.input.at - clock.currentTimeMillis()),
        stop,
        ctx.signal,
      ))
    )
      return;
    const current = structuredClone(state.get());
    const delivery = current.deliveries[ctx.input.id];
    const intent = current.intents[ctx.input.intentId];
    if (!delivery || !intent || delivery.sent) return;
    delivery.sent = true;
    intent.status = delivery.outcome === "succeeded" ? "succeeded" : "requires_payment_method";
    if (delivery.outcome === "succeeded") intent.latest_charge = `ch_${intent.id}`;
    state.set(current);
    const timestamp = Math.floor(clock.currentTimeMillis() / 1000);
    const body = JSON.stringify({
      id: delivery.id,
      object: "event",
      created: timestamp,
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
const webhooks = resource({
  label: "watch payment intents",
  depends: { state: state.controller, deliver: deliver.controller },
  factory({ state, deliver }, ctx) {
    ctx.defer(
      state.watch((next, previous) => {
        for (const delivery of Object.values(next.deliveries)) {
          if (!delivery.sent && !previous.deliveries[delivery.id])
            void deliver.run({ input: delivery });
        }
      }),
    );
  },
});

const createIntent = operation({
  label: "create payment intent",
  depends: { state: state.controller },
  run({ state }, ctx: Operation.Ctx<Service.Request>) {
    const parsed = intentSchema.safeParse(ctx.input.body);
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
  depends: { state: state.controller, clock, webhookDelayMs },
  run({ state, clock, webhookDelayMs }, ctx: Operation.Ctx<Service.Request>) {
    const id = ctx.input.path.split("/").at(-2)!;
    const current = structuredClone(state.get());
    const intent = current.intents[id];
    if (!intent) return rejectPayment("resource_missing", 404);
    if (intent.status === "processing" || intent.status === "succeeded") return reply(200, intent);
    intent.status = "processing";
    const response = structuredClone(intent);
    schedule(
      current,
      intent,
      current.plan,
      clock.currentTimeMillis(),
      webhookDelayMs,
      `evt_${ctx.random.uuid()}`,
    );
    state.set(current);
    return reply(200, response);
  },
});
const refund = operation({
  label: "refund payment",
  depends: { state: state.controller },
  run({ state }, ctx: Operation.Ctx<Service.Request>) {
    const parsed = refundSchema.safeParse(ctx.input.body);
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
  depends: { paymentState: state.controller, rules: rules.controller, calls: calls.controller },
  async run({ paymentState, rules, calls }, ctx: Operation.Ctx<Service.Request>) {
    const parsed = scenarioSchema.safeParse(ctx.input.body);
    if (!parsed.success) return reject("invalid_scenario");
    const initial = createState();
    if (parsed.data.name === "payment-failed") initial.plan.outcome = "failed";
    /** Presets apply on a fresh scope; the control call transfers its seeded state to this app. */
    const seed = createScope({ presets: [preset(state, initial)] });
    paymentState.set(seed.resolve(state));
    const ended = await seed.close();
    if (ended.status !== "success") return reject("scenario_failed", 500);
    rules.set({});
    calls.set([]);
    return reply(200, { data: { name: parsed.data.name } });
  },
});
const paymentControl = operation({
  label: "control payment",
  depends: {
    state: state.controller,
    clock,
    common: control.controller,
    reset: resetScenario.controller,
  },
  async run({ state, clock, common, reset }, ctx: Operation.Ctx<Service.Request>) {
    if (ctx.input.route === "POST /control/scenario") return reset.run({ input: ctx.input });
    if (ctx.input.route === "POST /control/payment") {
      const parsed = planSchema.safeParse(ctx.input.body);
      if (!parsed.success) return reject("invalid_payment_plan");
      state.update((current) => ({ ...current, plan: parsed.data }));
      return reply(200, { data: parsed.data });
    }
    if (ctx.input.route === "POST /control/webhooks") {
      const parsed = sendSchema.safeParse(ctx.input.body);
      if (!parsed.success) return reject("invalid_webhook_plan");
      const current = structuredClone(state.get());
      const intent = current.intents[parsed.data.intent_id];
      if (!intent) return rejectPayment("resource_missing", 404);
      schedule(
        current,
        intent,
        { ...current.plan, ...parsed.data },
        clock.currentTimeMillis(),
        0,
        `evt_${ctx.random.uuid()}`,
      );
      state.set(current);
      return reply(200, { data: parsed.data });
    }
    return common.run({ input: ctx.input });
  },
});
const route = operation({
  label: "payment route",
  depends: {
    create: createIntent.controller,
    confirm: confirm.controller,
    refund: refund.controller,
    state,
    control: paymentControl.controller,
  },
  async run({ create, confirm, refund, state, control }, ctx: Operation.Ctx<Service.Request>) {
    if (ctx.input.path.startsWith("/control/")) return control.run({ input: ctx.input });
    if (ctx.input.route === "POST /v1/payment_intents") return create.run({ input: ctx.input });
    if (ctx.input.route === "POST /v1/refunds") return refund.run({ input: ctx.input });
    if (/^POST \/v1\/payment_intents\/[^/]+\/confirm$/.test(ctx.input.route))
      return confirm.run({ input: ctx.input });
    const intent = state.intents[ctx.input.path.split("/").at(-1)!];
    return /^GET \/v1\/payment_intents\/[^/]+$/.test(ctx.input.route) && intent
      ? reply(200, intent)
      : rejectPayment("resource_missing", 404);
  },
});
const inFlight = data<Record<string, { fingerprint: string; response: Promise<Service.Reply> }>>({
  label: "in-flight payment keys",
  initial: {},
});
const action = operation({
  label: "payment API",
  depends: { state: state.controller, route: route.controller, inFlight: inFlight.controller },
  async run({ state, route, inFlight }, ctx: Operation.Ctx<Service.Request>) {
    const request = ctx.input;
    if (!request.key || !request.route.startsWith("POST /v1/"))
      return route.run({ input: request });
    const fingerprint = JSON.stringify({ route: request.route, body: request.body });
    const previous = state.get().keys[request.key];
    if (previous)
      return previous.fingerprint === fingerprint
        ? previous.reply
        : rejectPayment("idempotency_key_in_use", 409);
    const pending = inFlight.get()[request.key];
    if (pending)
      return pending.fingerprint === fingerprint
        ? pending.response
        : rejectPayment("idempotency_key_in_use", 409);
    const responsePromise = route.run({ input: request });
    inFlight.update((all) => ({
      ...all,
      [request.key!]: { fingerprint, response: responsePromise },
    }));
    const response = await responsePromise;
    inFlight.update((all) => {
      const next = { ...all };
      delete next[request.key!];
      return next;
    });
    state.update((current) => ({
      ...current,
      keys: { ...current.keys, [request.key!]: { fingerprint, reply: response } },
    }));
    return response;
  },
});
const http = createHttp(action);

/** Startup belongs to Core so a failed listener closes its root and all built resources. */
const app = extension({
  label: "start payment app",
  hooks: {
    async start({ scope, next }) {
      await next();
      scope.resolve(webhooks);
      return scope.resolve(http);
    },
  },
});

/** The caller owns the stop signal; Core owns all webhook work and socket cleanup. */
export async function startPayment(options: Payment.Options) {
  const scope = createScope({
    signal: options.signal,
    extensions: app,
    tags: [
      port(options.port),
      host(options.host),
      controlToken(options.controlToken),
      stopSignal(options.signal),
      webhookUrl(options.webhookUrl),
      secret(options.secret),
      webhookDelayMs(options.webhookDelayMs ?? 20),
    ],
    presets: [preset(state, createState())],
  });
  await scope.ready;
  const listening = scope.resolve(app);
  return { ...listening, closed: scope.closed };
}
