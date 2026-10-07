import { spawn } from "node:child_process";

/** Keep the landed process entry in charge of its scope and shutdown. */
const name = process.argv[2];
if (!["supplier-a", "supplier-b", "supplier-c", "payment"].includes(name))
  throw new Error("Choose supplier-a, supplier-b, supplier-c, or payment");
const child = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import { ${name === "payment" ? "paymentMain" : "supplierMain"} as main } from ${JSON.stringify(new URL("../dist/index.mjs", import.meta.url).href)}; process.exitCode = await main(process.env, process.argv.at(1));`,
    name,
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
process.exitCode = await new Promise((done, fail) => {
  child.once("error", fail);
  child.once("exit", (code) => done(code ?? 1));
});
