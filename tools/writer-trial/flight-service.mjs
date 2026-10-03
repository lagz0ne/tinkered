import { spawn } from "node:child_process";

/** Keep the landed process entry in charge of its scope and shutdown. */
const name = process.argv[2];
if (!["supplier-a", "supplier-b", "supplier-c", "payment"].includes(name))
  throw new Error("Choose supplier-a, supplier-b, supplier-c, or payment");
const child = spawn(
  process.execPath,
  [
    new URL(`../services/${name === "payment" ? "payment" : "supplier"}/main.ts`, import.meta.url)
      .pathname,
    name,
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
process.exitCode = await new Promise((done, fail) => {
  child.once("error", fail);
  child.once("exit", (code) => done(code ?? 1));
});
