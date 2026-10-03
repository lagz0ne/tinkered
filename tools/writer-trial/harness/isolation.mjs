import assert from "node:assert/strict";
import { Client } from "pg";
import nodemailer from "nodemailer";
import { connect } from "node:net";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";

for (const url of ["https://example.com", "https://1.1.1.1"]) {
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }));
  console.log(`PASS no internet: ${url}`);
}
for (const [index, name] of ["supplier-a", "supplier-b", "supplier-c", "payment"].entries()) {
  const response = await fetch(`http://${name}:${4311 + index}/control/calls`, {
    signal: AbortSignal.timeout(2000),
    headers: { authorization: "Bearer deliberately-known-control-token" },
  });
  assert.equal(response.status, 403, name);
  await assert.rejects(
    fetch(`http://control-${name}:4310/control/calls`, { signal: AbortSignal.timeout(2000) }),
  );
  console.log(`PASS private controls: ${name}`);
}
for (const key of ["SUPPLIER_A_URL", "SUPPLIER_B_URL", "SUPPLIER_C_URL"]) {
  const request = await fetch(process.env[key] + "/air/offer_requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: { slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-15" }] },
    }),
  });
  assert.equal(request.status, 201);
  assert.ok((await request.json()).data.offers.length);
}
const intent = await fetch(process.env.PAYMENT_URL + "/v1/payment_intents", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ amount: 100, currency: "usd" }),
});
assert.equal(intent.status, 200);
console.log("PASS service APIs");
const database = new Client({ connectionString: process.env.DATABASE_URL });
await database.connect();
assert.equal((await database.query("select 1 as ready")).rows[0].ready, 1);
await database.end();
console.log("PASS Postgres");
const mail = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
});
await mail.sendMail({
  from: process.env.SMTP_FROM,
  to: "proof@example.com",
  subject: "flight harness proof",
  text: "real SMTP",
});
mail.close();
assert.ok(
  (await (await fetch("http://mailpit:8025/api/v1/messages")).json()).messages.some(
    (message) => message.Subject === "flight harness proof",
  ),
);
console.log("PASS Mailpit SMTP and inbox");
const keys = Object.keys(process.env).filter((key) =>
  /CONTROL_TOKEN|GATEWAY|DOCKER_HOST/.test(key),
);
assert.deepEqual(keys, []);
console.log("PASS no teacher token or host credentials");
await assert.rejects(
  new Promise((resolve, reject) => {
    const socket = connect({ host: process.argv[2], port: 4310 });
    socket.setTimeout(2000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("private IP is unreachable"));
    });
  }),
);
console.log("PASS cannot reach a control service by IP");

await assert.rejects(
  fetch("http://payment:4300/webhooks/stripe", {
    method: "POST",
    body: "{}",
    signal: AbortSignal.timeout(2000),
  }),
);
console.log("PASS writer cannot reach the callback listener");
let receive;
const received = new Promise((done) => {
  receive = done;
});
const callback = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  response.writeHead(200);
  response.end();
  receive({
    body: Buffer.concat(chunks).toString(),
    signature: request.headers["stripe-signature"],
  });
});
await new Promise((done) => callback.listen(4318, "0.0.0.0", done));
try {
  const object = await intent.json();
  const confirm = await fetch(
    process.env.PAYMENT_URL + `/v1/payment_intents/${object.id}/confirm`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(confirm.status, 200);
  const timeout = AbortSignal.timeout(10000);
  const event = await Promise.race([
    received,
    new Promise((_, reject) => {
      timeout.addEventListener("abort", () => reject(timeout.reason), { once: true });
    }),
  ]);
  const values = Object.fromEntries(event.signature.split(",").map((entry) => entry.split("=")));
  assert.equal(
    values.v1,
    createHmac("sha256", process.env.WEBHOOK_SECRET)
      .update(`${values.t}.${event.body}`)
      .digest("hex"),
  );
  assert.equal(JSON.parse(event.body).type, "payment_intent.succeeded");
  console.log("PASS signed payment callback reaches the writer app");
} finally {
  await new Promise((done) => callback.close(done));
}
