import { operation } from "@tinker/core";
import { io } from "@tinker/process";

const ping = operation({ label: "ping", run: () => "pong" });

/** Importing this module declares the command once, without starting a root. */
export const pingCommand = operation({
  label: "ping",
  depends: { io: io.required, ping },
  run: ({ io: out, ping: flow }) => {
    out.write(`${JSON.stringify(flow.run())}\n`);
    return 0;
  },
});
