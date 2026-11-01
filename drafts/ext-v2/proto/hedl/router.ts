// hedl cmds/router.ts, scope wiring only. Compare: hedl main 3cc37eb lines 37-61.

import { createScope } from "../core.js";
import { sync, telemetry } from "./libs.js";

const parser = { parse: (raw: unknown) => raw };

export async function getRouter(ssr: boolean) {
  const stop = new AbortController();
  const tools = ssr
    ? undefined
    : createScope({
        extensions: [telemetry.browser({ service: "tinker-browser", output: console as never })],
      });
  await tools?.ready;

  const app = createScope({
    extensions: [
      sync.tab({
        stop: stop.signal,
        records: {},
        readBatch: parser,
        readBootstrap: parser,
        readSnapshot: parser,
        streamMessage: parser,
      }),
    ],
  });
  await app.ready;
  return app;
}
