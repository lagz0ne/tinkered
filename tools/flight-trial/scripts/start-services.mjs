import { spawn } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";

/** The parent owns four child processes; it stops the whole group if any child exits. */
async function main() {
  const settings = z
    .object({
      SUPPLIER_A_PORT: z.coerce.number().int().min(0).max(65535).default(4311),
      SUPPLIER_B_PORT: z.coerce.number().int().min(0).max(65535).default(4312),
      SUPPLIER_C_PORT: z.coerce.number().int().min(0).max(65535).default(4313),
      PAYMENT_PORT: z.coerce.number().int().min(0).max(65535).default(4314),
      CONTROL_TOKEN: z.string().min(1).default("flight-local-control"),
    })
    .parse(process.env);
  const children = [];
  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const ended = [];
  for (const service of [
    { name: "supplier-a", port: settings.SUPPLIER_A_PORT },
    { name: "supplier-b", port: settings.SUPPLIER_B_PORT },
    { name: "supplier-c", port: settings.SUPPLIER_C_PORT },
    { name: "payment", port: settings.PAYMENT_PORT },
  ]) {
    const child = spawn(
      process.execPath,
      [
        new URL(
          `../services/${service.name === "payment" ? "payment" : "supplier"}/main.ts`,
          import.meta.url,
        ).pathname,
        service.name,
      ],
      {
        env: { ...process.env, PORT: String(service.port), CONTROL_TOKEN: settings.CONTROL_TOKEN },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    children.push(child);
    child.stdout.pipe(process.stdout);
    ended.push(
      once(child, "exit").then(([code]) => {
        if (!stopping) {
          process.exitCode = 1;
          stop();
        } else if (code !== 0 && code !== null) process.exitCode = 1;
      }),
    );
  }
  await Promise.all(ended);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}

if (import.meta.main) await main();
