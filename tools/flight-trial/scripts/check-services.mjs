import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

/** Start the public command and drive each child through HTTP before stopping the group. */
async function main() {
  const child = spawn(process.execPath, [new URL("start-services.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      SUPPLIER_A_PORT: "0",
      SUPPLIER_B_PORT: "0",
      SUPPLIER_C_PORT: "0",
      PAYMENT_PORT: "0",
      CONTROL_TOKEN: "process-proof",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = once(child, "exit");
  const lines = createInterface({ input: child.stdout });
  const ready = [];
  try {
    for await (const line of lines) {
      const service = JSON.parse(line);
      ready.push(service);
      process.stdout.write(`${line}\n`);
      if (ready.length === 4) break;
    }
    assert.equal(ready.length, 4);
    assert.equal(new Set(ready.map((service) => service.pid)).size, 4);
    for (const service of ready) {
      const response = await fetch(`${service.url}/control/calls`, {
        headers: { authorization: "Bearer process-proof" },
      });
      assert.equal(response.status, 200);
      if (service.service === "payment") {
        const intent = await fetch(`${service.url}/v1/payment_intents`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amount: 900, currency: "usd" }),
        });
        assert.equal(intent.status, 200);
      } else {
        const offers = await fetch(`${service.url}/air/offer_requests`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            data: { slices: [{ origin: "LHR", destination: "AMS", departure_date: "2027-01-15" }] },
          }),
        });
        assert.equal(offers.status, 201);
        assert.ok((await offers.json()).data.offers.length > 0);
      }
    }
    process.stdout.write("Four separate processes answered their service and control APIs.\n");
  } finally {
    lines.close();
    child.kill("SIGTERM");
    const [code] = await exited;
    assert.equal(code, 0);
    process.stdout.write("The start command and all four children stopped cleanly.\n");
  }
}

if (import.meta.main) await main();
