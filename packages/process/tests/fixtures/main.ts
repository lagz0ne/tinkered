import { extension, operation } from "@tinker/core";
import { argv, env, io, main, stop, type Process } from "../../src/index.ts";

const output = operation({
  label: "output",
  depends: { io: io.required },
  run: ({ io }) => {
    io.write("o".repeat(1_048_576));
    io.error("e".repeat(1_048_576));
    return 7;
  },
});
const facts = operation({
  label: "facts",
  depends: { argv: argv.required, env: env.required, io: io.required },
  run: ({ argv, env, io }) => {
    io.write(`${argv.join("+")} ${env["TK_PROBE"]}\n`);
    return 0;
  },
});
const hang = operation({
  label: "hang",
  depends: { io: io.required },
  run: ({ io }, ctx) =>
    new Promise<number>((_resolve, reject) => {
      const aborted = (): void => reject(ctx.signal.reason);
      ctx.signal.addEventListener("abort", aborted, { once: true });
      ctx.defer(() => ctx.signal.removeEventListener("abort", aborted));
      process.stdin.resume();
      ctx.defer(() => {
        process.stdin.pause();
      });
      io.write("ready\n");
    }),
});
const service = extension({
  label: "stdio",
  hooks: {
    start: (event) => {
      const requestStop = event.resolve(stop.required);
      const out = event.resolve(io.required);
      const args = event.resolve(argv.required);
      process.stdin.once("end", requestStop);
      process.stdin.resume();
      event.defer(async () => {
        process.stdin.removeListener("end", requestStop);
        out.write(
          `closing ${process.listenerCount("SIGINT")} ${process.listenerCount("SIGTERM")}\n`,
        );
        if (args.includes("stalled")) await new Promise<void>(() => {});
        process.stdin.pause();
        out.write("closed\n");
      });
      out.write("ready\n");
      return event.next();
    },
  },
});
const shell: Process.Shell = {
  name: "fixture",
  version: "1.0.0",
  commands: [
    { name: "output", entry: () => ({ kind: "command", op: output }) },
    { name: "facts", entry: () => ({ kind: "command", op: facts }) },
    { name: "hang", entry: () => ({ kind: "command", op: hang }) },
    { name: "serve", entry: () => ({ kind: "service", options: { extensions: [service] } }) },
  ],
};

if (import.meta.main) {
  const args = process.argv.includes("--explicit") ? ["facts", "given"] : undefined;
  process.exitCode = await main({ shell, args });
  if (process.argv.includes("--listeners")) {
    process.stdout.write(
      `listeners ${process.listenerCount("SIGINT")} ${process.listenerCount("SIGTERM")}\n`,
    );
  }
}
