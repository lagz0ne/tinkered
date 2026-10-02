import { createScope, data, namespace, operation, resource, tag } from "@tinker/core";
import { hono, route } from "../../src/hono/index.ts";
import { nats } from "../../src/nats/index.ts";
import { startNatsServer } from "../../src/nats/testing.ts";
import { expect, test } from "vite-plus/test";
import { liveUpdates, publishAfterCommit } from "../../src/stack/index.ts";

const account = tag({ label: "account", default: "default" });
const alpha = namespace({ tags: [account("alpha")] });
const beta = namespace({ tags: [account("beta")] });
const saved = resource({
  label: "saved",
  target: "namespace",
  depends: { account },
  factory: ({ account }) => ({ value: account }),
});
const transaction = resource({
  label: "transaction",
  target: "session",
  depends: { saved },
  factory: ({ saved }, ctx) => {
    const draft = { value: saved.value };
    ctx.defer((end) => {
      if (end.status === "success") saved.value = draft.value;
    });
    return draft;
  },
});
const snapshot = data({ label: "snapshot", initial: "" });
const publish = operation({
  label: "publish",
  depends: { saved, snapshot: snapshot.controller },
  run: ({ saved, snapshot }) => snapshot.set(saved.value),
});
const save = operation({
  label: "save",
  depends: { transaction, snapshot: snapshot.controller },
  run: ({ transaction, snapshot }) => {
    transaction.value += " saved";
    snapshot.set("request draft");
    return "saved";
  },
});
const web = hono([route.post("/", save)], {
  ns: (c) => (c.req.header("x-account") === "alpha" ? alpha : beta),
}).extension;

test("a committed request publishes root state in its own namespace", async () => {
  const scope = createScope({ extensions: [web, publishAfterCommit(publish)] });
  try {
    await scope.ready;
    const app = scope.resolve(web);
    await app.request("/", { method: "POST", headers: { "x-account": "alpha" } });
    await app.request("/", { method: "POST", headers: { "x-account": "beta" } });
    expect({
      alpha: scope.resolve(snapshot, { ns: alpha }),
      beta: scope.resolve(snapshot, { ns: beta }),
      default: scope.resolve(snapshot),
    }).toEqual({ alpha: "alpha saved", beta: "beta saved", default: "default" });
  } finally {
    await scope.close();
  }
});

test("an incoming live signal refreshes root state in each receiving namespace", async () => {
  const server = await startNatsServer();
  const wiring = { env: { NATS_URL: server.url } };
  const sender = nats([], wiring);
  const source = createScope({ extensions: [sender.extension] });
  let refreshes = 0;
  const scope = createScope({
    extensions: [web, liveUpdates(publish, { ...wiring, subject: "namespaces.changed" })],
    observe: {
      export: (span) => {
        if (span.name === "stack.refresh") refreshes++;
      },
    },
  });
  try {
    await source.ready;
    await scope.ready;
    const app = scope.resolve(web);
    /** Drain each setup message before changing storage, so only the outside
     * signal can supply the new values. Boot prepared the default namespace. */
    await app.request("/", { method: "POST", headers: { "x-account": "alpha" } });
    await expect.poll(() => refreshes).toBe(2);
    await app.request("/", { method: "POST", headers: { "x-account": "beta" } });
    await expect.poll(() => refreshes).toBe(5);
    scope.resolve(saved, { ns: alpha }).value = "alpha remote";
    scope.resolve(saved, { ns: beta }).value = "beta remote";
    await source.run(sender.publish, {
      input: { subject: "namespaces.changed", payload: new Uint8Array() },
    });
    await expect
      .poll(() => ({
        alpha: scope.resolve(snapshot, { ns: alpha }),
        beta: scope.resolve(snapshot, { ns: beta }),
        default: scope.resolve(snapshot),
      }))
      .toEqual({ alpha: "alpha remote", beta: "beta remote", default: "default" });
  } finally {
    await scope.close();
    await source.close();
    await server.close();
  }
});
