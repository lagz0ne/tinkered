import { fileURLToPath } from "node:url";
import { runDev } from "@tinker/stack/dev";
import { describeError } from "@tinker/stack";

if (import.meta.main) {
  const stop = new AbortController();
  const abort = () => stop.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  try {
    process.exitCode = await runDev(
      {
        root: fileURLToPath(new URL("../", import.meta.url)),
        entry: "src/server/main.ts",
        env: process.env,
        nats: true,
        report: (event) => {
          const line =
            event.kind === "error" ? { kind: "error", ...describeError(event.error) } : event;
          process.stdout.write(`${JSON.stringify(line)}\n`);
        },
      },
      stop.signal,
    );
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
